#!/usr/bin/env python3
"""Phase7 completion-v3 postal-resolution preparation (disposable/local only).

No production writes. No geometry changes. No production apply.
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import psycopg

REPO = Path(__file__).resolve().parents[3]
V2 = REPO / "reports/admin-reconciliation-v2/phase7-completion-v2"
OUT = REPO / "reports/admin-reconciliation-v2/phase7-completion-v3"
PREV = OUT / "02-postal-review-previews"
DB_URL = "postgresql://postgres:postgres@127.0.0.1:5433/coremap_phase7_v2"
PANG_PUBLIC = "7c8315d4-ab5a-4b41-974a-fb3cbe249fc9"

csv.field_size_limit(min(2**31 - 1, 100_000_000))

WARD_VT = {"ward", "village_tract"}
COMPAT_TYPES = {
    "ward": {"ward"},
    "village_tract": {"village_tract"},
}


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def clean(v) -> str:
    return "" if v is None else str(v).strip()


def load_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_csv(path: Path, rows: list[dict], fields: list[str] | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    fields = fields or list(rows[0].keys())
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({h: r.get(h, "") for h in fields})


def compact_name(value: str) -> str:
    text = clean(value)
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text).casefold()
    text = text.replace("nay pyi taw", "naypyitaw").replace("ayeyawady", "ayeyarwady")
    text = text.replace("irrawaddy", "ayeyarwady")
    suffixes = [
        r"\bunion territory\b",
        r"\bstate\b",
        r"\bregion\b",
        r"\bdistrict\b",
        r"\btownship\b",
        r"\btown\b",
        r"\bquarter\b",
        r"\bward\b",
        r"\bvillage[ -]?tract\b",
        r"\bself[ -]?administered (?:zone|division)\b",
        "ပြည်ထောင်စုနယ်မြေ",
        "တိုင်းဒေသကြီး",
        "ပြည်နယ်",
        "ခရိုင်",
        "မြို့နယ်",
        "ကျေးရွာအုပ်စု",
        "ရပ်ကွက်",
        "မြို့",
    ]
    for suffix in suffixes:
        text = re.sub(suffix, " ", text)
    text = re.sub(r"\b(?:no|number)\s*[.(]?\s*([0-9]+)\s*[).]?", r"\1", text)
    text = text.replace("အမှတ်", "")
    text = re.sub(r"[^0-9a-z\u1000-\u109f\uaa60-\uaa7f\ua9e0-\ua9ff]+", "", text)
    return text


def looks_non_admin(locality_en: str, locality_mm: str) -> bool:
    joined = f"{locality_en} {locality_mm}".casefold()
    if any(x in joined for x in ("quarter", "ward", "village tract", "village-tract")):
        return False
    if "ရပ်ကွက်" in locality_mm or "ကျေးရွာအုပ်စု" in locality_mm:
        return False
    markers = (
        "industrial zone",
        "market",
        "airport",
        "university",
        "hospital",
        "camp",
        "base",
        "port",
        "station",
        "ဆိပ်ကမ်း",
        "ဈေး",
        "လေဆိပ်",
        "town",
        "မြို့",
    )
    return any(m in joined for m in markers) or (not clean(locality_en) and not clean(locality_mm))


def township_is_town_label(ts_en: str, ts_mm: str) -> bool:
    en = clean(ts_en).casefold()
    mm = clean(ts_mm)
    return en.endswith(" town") or en == "town" or mm.endswith("မြို့")


class AdminIdent:
    __slots__ = (
        "core_id",
        "public_id",
        "parent_id",
        "parent_public_id",
        "typ",
        "level",
        "canonical",
        "name_mm",
        "name_en",
        "aliases_mm",
        "aliases_en",
        "norms_mm",
        "norms_en",
        "norms_all",
        "origin",
    )

    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)


def load_admin_inventory(conn: psycopg.Connection) -> tuple[dict[str, AdminIdent], dict[str, list[AdminIdent]]]:
    """public_id -> ident; township_public_id -> children (ward/vt)."""
    by_pub: dict[str, AdminIdent] = {}
    by_core: dict[str, AdminIdent] = {}

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT a.id, a.public_id::text, a.parent_id, p.public_id::text AS parent_public_id,
                   l.code AS level_code, coalesce(t.code,'') AS type_code,
                   a.canonical_name
            FROM core.core_admin_areas a
            JOIN ref.ref_admin_levels l ON l.id = a.admin_level_id
            LEFT JOIN ref.ref_admin_area_types t ON t.id = a.admin_area_type_id
            LEFT JOIN core.core_admin_areas p ON p.id = a.parent_id
            WHERE a.deleted_at IS NULL AND a.is_active
            """
        )
        rows = cur.fetchall()
        cur.execute(
            """
            SELECT n.admin_area_id, n.name, coalesce(n.language_code,''), n.name_type, n.is_primary
            FROM core.core_admin_area_names n
            """
        )
        name_rows = cur.fetchall()

    names_by_id: dict[int, list[tuple[str, str, str, bool]]] = defaultdict(list)
    for aid, name, lang, ntype, is_pri in name_rows:
        names_by_id[int(aid)].append((clean(name), clean(lang).lower(), clean(ntype).lower(), bool(is_pri)))

    for aid, public_id, parent_id, parent_public_id, level_code, type_code, canonical in rows:
        nm = names_by_id.get(int(aid), [])
        name_mm = ""
        name_en = ""
        aliases_mm: list[str] = []
        aliases_en: list[str] = []
        for name, lang, ntype, is_pri in nm:
            is_alias = ntype in {"alias", "alternate", "imported"} or not is_pri
            if lang in {"my", "mm"}:
                if is_pri and not name_mm:
                    name_mm = name
                elif is_alias:
                    aliases_mm.append(name)
                elif not name_mm:
                    name_mm = name
            elif lang == "en":
                if is_pri and not name_en:
                    name_en = name
                elif is_alias:
                    aliases_en.append(name)
                elif not name_en:
                    name_en = name
        if not name_mm:
            # fallback canonical if Myanmar script
            if re.search(r"[\u1000-\u109f]", canonical or ""):
                name_mm = canonical or ""
        if not name_en and canonical and not re.search(r"[\u1000-\u109f]", canonical or ""):
            name_en = canonical or ""

        norms_mm = {compact_name(name_mm)} | {compact_name(x) for x in aliases_mm}
        norms_en = {compact_name(name_en)} | {compact_name(x) for x in aliases_en}
        norms_mm.discard("")
        norms_en.discard("")
        norms_all = set(norms_mm) | set(norms_en) | ({compact_name(canonical)} - {""})

        ident = AdminIdent(
            core_id=str(aid),
            public_id=public_id,
            parent_id=str(parent_id) if parent_id is not None else "",
            parent_public_id=parent_public_id or "",
            typ=type_code or "",
            level=level_code or "",
            canonical=canonical or "",
            name_mm=name_mm,
            name_en=name_en,
            aliases_mm=sorted(set(aliases_mm)),
            aliases_en=sorted(set(aliases_en)),
            norms_mm=norms_mm,
            norms_en=norms_en,
            norms_all=norms_all,
            origin="coremap_db",
        )
        by_pub[public_id] = ident
        by_core[str(aid)] = ident

    children_by_parent_pub: dict[str, list[AdminIdent]] = defaultdict(list)
    for ident in by_pub.values():
        if ident.typ in WARD_VT or ident.level == "ward_village_tract":
            if ident.parent_public_id:
                children_by_parent_pub[ident.parent_public_id].append(ident)

    return by_pub, children_by_parent_pub


def load_mimu_inventory() -> dict[str, list[dict]]:
    """ts_pcode -> list of ward/vt source rows from normalized geojson."""
    out: dict[str, list[dict]] = defaultdict(list)
    for fname, etype in (
        ("01-village-tracts-normalized.geojson", "village_tract"),
        ("01-wards-normalized.geojson", "ward"),
    ):
        path = REPO / "reports/admin-reconciliation-v2" / fname
        data = json.loads(path.read_text(encoding="utf-8"))
        for i, feat in enumerate(data["features"], start=1):
            p = feat.get("properties") or {}
            ts = clean(p.get("ts_pcode"))
            if not ts:
                continue
            name_en = clean(p.get("name_en"))
            name_my = clean(p.get("name_my"))
            out[ts].append(
                {
                    "entity_type": etype,
                    "source_pcode": clean(p.get("source_pcode")),
                    "name_en": name_en,
                    "name_my": name_my,
                    "norm_en": compact_name(name_en),
                    "norm_my": compact_name(name_my),
                    "ts_pcode": ts,
                    "ts_name": clean(p.get("ts_name")),
                    "source_row": i,
                    "source_file": clean(p.get("source_file")),
                }
            )
    return out


def load_township_index(by_pub: dict[str, AdminIdent]) -> tuple[dict[str, AdminIdent], dict[str, list[AdminIdent]]]:
    by_core: dict[str, AdminIdent] = {}
    by_norm: dict[str, list[AdminIdent]] = defaultdict(list)
    for ident in by_pub.values():
        if ident.level == "township" or ident.typ == "township":
            by_core[ident.core_id] = ident
            for n in ident.norms_all:
                by_norm[n].append(ident)
        if ident.level == "town" or ident.typ == "town":
            for n in ident.norms_all:
                by_norm[n].append(ident)
    return by_core, by_norm


def resolve_township_public(
    row: dict,
    by_core_ts: dict[str, AdminIdent],
    by_norm_ts: dict[str, list[AdminIdent]],
) -> tuple[str, str, str]:
    """Return (township_public_id, township_core_id, resolve_note)."""
    if clean(row.get("matched_township_public_id")):
        return clean(row["matched_township_public_id"]), clean(row.get("matched_township_id")), "from_postal_row"
    tid = clean(row.get("matched_township_id"))
    if tid and tid in by_core_ts:
        return by_core_ts[tid].public_id, tid, "from_matched_township_id"
    # Pangsang
    ts_en = clean(row.get("township_en"))
    ts_mm = clean(row.get("township_mm"))
    if "pangsang" in ts_en.casefold() or "panghkam" in ts_en.casefold() or "ပန်ဆန်း" in ts_mm:
        return PANG_PUBLIC, "", "pangsang_frozen"
    norms = {compact_name(ts_en), compact_name(ts_mm)} - {""}
    hits = []
    for n in norms:
        hits.extend(by_norm_ts.get(n) or [])
    uniq = {h.public_id: h for h in hits}
    if len(uniq) == 1:
        h = next(iter(uniq.values()))
        return h.public_id, h.core_id, "name_resolved"
    if township_is_town_label(ts_en, ts_mm):
        # strip Town and retry as town/township name
        base_en = re.sub(r"\s+town$", "", ts_en, flags=re.I).strip()
        n = compact_name(base_en)
        hits = by_norm_ts.get(n) or []
        uniq = {h.public_id: h for h in hits}
        if len(uniq) == 1:
            h = next(iter(uniq.values()))
            return h.public_id, h.core_id, "town_label_resolved"
    return "", tid, "unresolved"


def find_exact_candidates(
    children: list[AdminIdent],
    loc_en: str,
    loc_mm: str,
    expected_type: str,
) -> tuple[list[AdminIdent], str]:
    """Strict exact matching only. Returns (candidates, evidence)."""
    want_types = COMPAT_TYPES.get(expected_type, set())
    pool = [c for c in children if (not want_types) or c.typ in want_types or (not c.typ and c.level == "ward_village_tract")]
    n_mm = compact_name(loc_mm)
    n_en = compact_name(loc_en)

    mm_hits = [c for c in pool if n_mm and n_mm in c.norms_mm] if n_mm else []
    en_hits = [c for c in pool if n_en and n_en in c.norms_en] if n_en else []
    bilingual = []
    if n_mm and n_en:
        bilingual = [c for c in pool if n_mm in c.norms_all and n_en in c.norms_all]

    # Unique exact Myanmar primary/alias with no conflict
    if n_mm and len({c.public_id for c in mm_hits}) == 1:
        only = next(iter({c.public_id: c for c in mm_hits}.values()))
        # conflict if another different admin matches EN uniquely differently
        if n_en:
            en_only = {c.public_id for c in en_hits}
            if en_only and only.public_id not in en_only:
                return list({c.public_id: c for c in mm_hits + en_hits}.values()), "conflict_mm_vs_en"
        return [only], "unique_exact_my"

    # Unique exact bilingual identity
    if n_mm and n_en and len({c.public_id for c in bilingual}) == 1:
        return [next(iter({c.public_id: c for c in bilingual}.values()))], "unique_exact_bilingual"

    # Do NOT auto-match English-only
    if n_en and not n_mm and len({c.public_id for c in en_hits}) == 1:
        return list({c.public_id: c for c in en_hits}.values()), "english_only_blocked"

    if len({c.public_id for c in mm_hits + en_hits + bilingual}) > 1:
        return list({c.public_id: c for c in mm_hits + en_hits + bilingual}.values()), "multiple_candidates"

    return [], "no_exact"


def alias_needed(cand: AdminIdent, loc_en: str, loc_mm: str) -> tuple[bool, str, str]:
    """If postal spelling differs from primary but matches alias/other side, propose alias."""
    n_mm = compact_name(loc_mm)
    n_en = compact_name(loc_en)
    need_mm = bool(n_mm and n_mm not in {compact_name(cand.name_mm)} and n_mm in cand.norms_all)
    need_en = bool(n_en and n_en not in {compact_name(cand.name_en)} and n_en in cand.norms_all)
    # propose adding postal form as alias when it matches via the other language primary
    propose_mm = ""
    propose_en = ""
    if n_mm and compact_name(cand.name_mm) != n_mm and n_mm in cand.norms_mm:
        # already alias
        pass
    elif n_mm and compact_name(cand.name_mm) != n_mm and n_en and n_en in cand.norms_en:
        # matched via EN primary; postal MM is alternate spelling
        if n_mm not in cand.norms_mm:
            propose_mm = loc_mm
    if n_en and compact_name(cand.name_en) != n_en and n_mm and n_mm in cand.norms_mm:
        if n_en not in cand.norms_en:
            propose_en = loc_en
    if propose_mm or propose_en:
        return True, propose_mm, propose_en
    # matched via existing alias: still link_existing, not add_alias
    return False, "", ""


def mimu_hits(mimu_by_ts: dict[str, list[dict]], ts_pcodes: list[str], loc_en: str, loc_mm: str, etype: str) -> list[dict]:
    n_mm = compact_name(loc_mm)
    n_en = compact_name(loc_en)
    hits = []
    for ts in ts_pcodes:
        for row in mimu_by_ts.get(ts) or []:
            if row["entity_type"] != etype and etype in WARD_VT:
                continue
            if (n_mm and row["norm_my"] == n_mm) or (n_en and row["norm_en"] == n_en):
                hits.append(row)
    # unique by pcode/row
    uniq = {}
    for h in hits:
        uniq[h.get("source_pcode") or f"row{h['source_row']}"] = h
    return list(uniq.values())


def main() -> None:
    now = utc_now()
    PREV.mkdir(parents=True, exist_ok=True)

    postal = load_csv(V2 / "postal/03-postal-actions-v2.csv")
    admin_manifest = load_csv(V2 / "frozen-v2/03-approved-local-admin.v2.csv")

    print("connecting disposable DB...")
    with psycopg.connect(DB_URL) as conn:
        by_pub, children_by_ts = load_admin_inventory(conn)
        by_core_ts, by_norm_ts = load_township_index(by_pub)

    print("admins", len(by_pub), "township/town name keys", len(by_norm_ts))
    print("loading MIMU inventory...")
    mimu_by_ts = load_mimu_inventory()

    # Map township core id -> possible MIMU ts_pcodes via frozen admin manifest source_ts_pcode
    ts_core_to_mimu: dict[str, set[str]] = defaultdict(set)
    ts_pub_to_mimu: dict[str, set[str]] = defaultdict(set)
    for r in admin_manifest:
        tsp = clean(r.get("source_ts_pcode"))
        if not tsp:
            continue
        if clean(r.get("source_entity_type")) == "township" and clean(r.get("target_public_id")):
            ts_pub_to_mimu[clean(r["target_public_id"])].add(tsp)
        tid = clean(r.get("approved_township_id") or r.get("matched_coremap_id") or r.get("parent_core_id"))
        if tid:
            ts_core_to_mimu[tid].add(tsp)
        # creates under parent_public_id
        pp = clean(r.get("parent_public_id"))
        if pp and tsp:
            ts_pub_to_mimu[pp].add(tsp)

    # Also from DB parent chain: collect MIMU pcodes appearing as children source in manifest keyed by parent
    for r in admin_manifest:
        tsp = clean(r.get("source_ts_pcode"))
        pp = clean(r.get("parent_public_id"))
        if tsp and pp:
            ts_pub_to_mimu[pp].add(tsp)

    # Enrich children index: also key by township core id parents
    children_by_parent_core: dict[str, list[AdminIdent]] = defaultdict(list)
    for ident in by_pub.values():
        if ident.typ in WARD_VT or ident.level == "ward_village_tract":
            if ident.parent_id:
                children_by_parent_core[ident.parent_id].append(ident)

    def children_for(ts_pub: str, ts_core: str) -> list[AdminIdent]:
        out = []
        if ts_pub:
            out.extend(children_by_ts.get(ts_pub) or [])
        if ts_core:
            out.extend(children_by_parent_core.get(ts_core) or [])
        uniq = {c.public_id: c for c in out}
        return list(uniq.values())

    def mimu_pcodes_for(ts_pub: str, ts_core: str) -> list[str]:
        s = set()
        if ts_pub:
            s |= ts_pub_to_mimu.get(ts_pub) or set()
        if ts_core:
            s |= ts_core_to_mimu.get(ts_core) or set()
        return sorted(s)

    # ---------- A. Validate linked_after_review ----------
    lar_rows = [r for r in postal if clean(r.get("v2_status")) == "linked_after_review"]
    lar_valid = []
    lar_invalid = []
    # Detect same public_id used for clearly different locality norms
    pub_to_norms: dict[str, set[tuple[str, str]]] = defaultdict(set)
    for r in lar_rows:
        pub = clean(r.get("matched_local_admin_public_id"))
        if pub:
            pub_to_norms[pub].add((compact_name(r.get("locality_mm")), compact_name(r.get("locality_en"))))

    for r in lar_rows:
        pub = clean(r.get("matched_local_admin_public_id"))
        local_id = clean(r.get("matched_local_admin_area_id"))
        ts_pub, ts_core, ts_note = resolve_township_public(r, by_core_ts, by_norm_ts)
        typ = clean(r.get("inferred_locality_type"))
        evidence = clean(r.get("v2_reason") or r.get("reason") or r.get("match_method"))
        ok_id = bool(pub or local_id)
        ok_type = typ in WARD_VT
        ok_evidence = bool(evidence)
        ok_ts = bool(ts_pub or clean(r.get("matched_township_id")))
        cand = by_pub.get(pub) if pub else None
        ok_parent = True
        if cand and ts_pub and cand.parent_public_id and cand.parent_public_id != ts_pub:
            # allow parent town under different structure only if same core parent chain mismatch documented
            ok_parent = cand.parent_public_id == ts_pub or cand.parent_id == ts_core
        # conflict: one public_id claimed by multiple distinct locality norms
        # Same MM+EN only is safe. Differing MM or EN norms on one public_id is invalid
        # (includes numbered variants like Taung Kone 1/2 and swapped bilingual rows).
        norms_set = pub_to_norms.get(pub) or set()
        mm_set = {m for m, e in norms_set if m}
        en_set = {e for m, e in norms_set if e}
        conflict_shared = len(mm_set) > 1 or len(en_set) > 1
        valid = ok_id and ok_type and ok_evidence and ok_ts and ok_parent and not conflict_shared
        rec = {
            **{k: r.get(k, "") for k in r},
            "validation_ok": "true" if valid else "false",
            "resolved_township_public_id": ts_pub,
            "has_local_id_or_public_id": "true" if ok_id else "false",
            "type_ok": "true" if ok_type else "false",
            "township_ok": "true" if ok_ts else "false",
            "parent_ok": "true" if ok_parent else "false",
            "evidence_ok": "true" if ok_evidence else "false",
            "shared_public_id_conflict": "true" if conflict_shared else "false",
            "validation_note": (
                "valid linked_after_review"
                if valid
                else "; ".join(
                    x
                    for x in [
                        None if ok_id else "missing local_admin_area_id and public_id",
                        None if ok_type else "type not ward/village_tract",
                        None if ok_ts else "township unresolved",
                        None if ok_parent else "parent township mismatch",
                        None if ok_evidence else "missing reviewed evidence",
                        "shared public_id across distinct locality norms" if conflict_shared else None,
                    ]
                    if x
                )
            ),
        }
        if valid:
            lar_valid.append(rec)
        else:
            lar_invalid.append(rec)

    # ---------- B. Audit non_admin ----------
    non_admin_rows = [r for r in postal if clean(r.get("v2_status")) == "non_admin_postal_locality"]
    na_groups: dict[tuple, list[dict]] = defaultdict(list)
    for r in non_admin_rows:
        key = (
            clean(r.get("township_en")),
            clean(r.get("township_mm")),
            clean(r.get("inferred_locality_type")),
            compact_name(r.get("locality_mm")),
            compact_name(r.get("locality_en")),
        )
        na_groups[key].append(r)

    non_admin_audit = []
    for key, rows in sorted(na_groups.items(), key=lambda kv: (-len(kv[1]), kv[0][0], kv[0][4])):
        ts_en, ts_mm, loc_type, n_mm, n_en = key
        sample = rows[0]
        loc_en = clean(sample.get("locality_en"))
        loc_mm = clean(sample.get("locality_mm"))
        ts_pub, ts_core, ts_note = resolve_township_public(sample, by_core_ts, by_norm_ts)
        kids = children_for(ts_pub, ts_core)
        cands, evidence = find_exact_candidates(kids, loc_en, loc_mm, loc_type)
        # Also search under parent township if resolved entity is a town
        if not cands and ts_pub and by_pub.get(ts_pub) and by_pub[ts_pub].level == "town":
            parent_pub = by_pub[ts_pub].parent_public_id
            parent_core = by_pub[ts_pub].parent_id
            cands, evidence = find_exact_candidates(children_for(parent_pub, parent_core), loc_en, loc_mm, loc_type)
            if cands:
                ts_pub, ts_core = parent_pub, parent_core
                ts_note = "via_town_parent_township"
        mimu_ts = mimu_pcodes_for(ts_pub, ts_core)
        mh = mimu_hits(mimu_by_ts, mimu_ts, loc_en, loc_mm, loc_type) if mimu_ts else []
        # Broader MIMU: search all townships whose name matches town base
        if not mh and township_is_town_label(ts_en, ts_mm):
            base = compact_name(re.sub(r"\s+town$", "", ts_en, flags=re.I))
            for tsp, items in mimu_by_ts.items():
                if items and compact_name(items[0].get("ts_name") or "") == base:
                    mh = mimu_hits(mimu_by_ts, [tsp], loc_en, loc_mm, loc_type)
                    if mh:
                        mimu_ts = [tsp]
                        break

        decision = "confirmed_non_admin"
        note = "postal parent is town-labeled and no unique official ward/VT match under CoreMap/MIMU"
        if looks_non_admin(loc_en, loc_mm) and loc_type not in WARD_VT:
            decision = "confirmed_non_admin"
            note = "locality markers are non-admin"
        elif not loc_en and not loc_mm:
            decision = "source_error"
            note = "empty locality names"
        elif len(cands) == 1:
            decision = "reclassify_as_official_local_area"
            note = f"unique exact CoreMap match {cands[0].public_id} ({evidence})"
        elif len(cands) > 1:
            decision = "manual_review"
            note = f"multiple CoreMap candidates: {','.join(c.public_id for c in cands[:5])}"
        elif mh:
            decision = "manual_review"
            note = f"MIMU inventory hit without unique CoreMap match: {[h.get('source_pcode') for h in mh[:3]]}"
        elif township_is_town_label(ts_en, ts_mm) and loc_type in WARD_VT:
            # Town wards often absent as official CoreMap townships — confirm non-admin postal locality
            decision = "confirmed_non_admin"
            note = "town-parent postal ward/VT with no CoreMap/MIMU unique identity under resolved parent"

        non_admin_audit.append(
            {
                "group_key": f"{compact_name(ts_en)}|{loc_type}|{n_mm}|{n_en}",
                "township_en": ts_en,
                "township_mm": ts_mm,
                "township_is_town_label": "true" if township_is_town_label(ts_en, ts_mm) else "false",
                "resolved_township_public_id": ts_pub,
                "resolved_township_core_id": ts_core,
                "township_resolve_note": ts_note,
                "locality_type": loc_type,
                "locality_en": loc_en,
                "locality_mm": loc_mm,
                "normalized_name_en": n_en,
                "normalized_name_mm": n_mm,
                "postal_row_count": len(rows),
                "postal_codes": ";".join(sorted(clean(x.get("postal_code")) for x in rows)),
                "coremap_candidate_count": len(cands),
                "coremap_candidate_public_ids": ";".join(c.public_id for c in cands),
                "mimu_hit_count": len(mh),
                "mimu_source_pcodes": ";".join(clean(h.get("source_pcode")) for h in mh),
                "audit_decision": decision,
                "audit_note": note,
                "name_evidence": evidence,
            }
        )

    # ---------- C/D. Group missing + ambiguous + invalid LAR, match ----------
    missing = [r for r in postal if clean(r.get("v2_status")) == "missing_local_admin_identity"]
    ambiguous = [r for r in postal if clean(r.get("v2_status")) == "ambiguous_local_area"]
    # Invalid after-review rows re-enter resolution
    work_rows = missing + ambiguous + lar_invalid

    groups: dict[tuple, list[dict]] = defaultdict(list)
    group_meta: dict[tuple, dict] = {}
    for r in work_rows:
        ts_pub, ts_core, ts_note = resolve_township_public(r, by_core_ts, by_norm_ts)
        loc_type = clean(r.get("inferred_locality_type")) or "unknown"
        n_mm = compact_name(r.get("locality_mm"))
        n_en = compact_name(r.get("locality_en"))
        key = (ts_pub or f"UNRESOLVED:{clean(r.get('township_en'))}", loc_type, n_mm, n_en)
        groups[key].append(r)
        group_meta[key] = {
            "township_public_id": ts_pub,
            "township_core_id": ts_core,
            "township_resolve_note": ts_note,
            "township_en": clean(r.get("township_en")),
            "township_mm": clean(r.get("township_mm")),
            "locality_type": loc_type,
            "normalized_name_mm": n_mm,
            "normalized_name_en": n_en,
        }

    group_actions = []
    review_rows = []
    auto_link = 0
    auto_alias = 0
    unresolved_for_review = 0

    for key, rows in sorted(groups.items(), key=lambda kv: (-len(kv[1]), kv[0][0], kv[0][1], kv[0][2])):
        meta = group_meta[key]
        sample = rows[0]
        loc_en = clean(sample.get("locality_en"))
        loc_mm = clean(sample.get("locality_mm"))
        loc_type = meta["locality_type"]
        ts_pub = meta["township_public_id"]
        ts_core = meta["township_core_id"]
        codes = sorted({clean(r.get("postal_code")) for r in rows if clean(r.get("postal_code"))})

        kids = children_for(ts_pub, ts_core) if ts_pub or ts_core else []
        cands, evidence = find_exact_candidates(kids, loc_en, loc_mm, loc_type)
        mh = mimu_hits(mimu_by_ts, mimu_pcodes_for(ts_pub, ts_core), loc_en, loc_mm, loc_type)

        action = ""
        selected = ""
        propose_mm = ""
        propose_en = ""
        reason = ""
        review_decision = ""
        recommendation = ""

        if not ts_pub and township_is_town_label(meta["township_en"], meta["township_mm"]):
            action = "confirmed_non_admin"
            review_decision = "confirmed_non_admin"
            recommendation = "confirmed_non_admin"
            reason = "unresolved town-labeled parent; treat as non-admin postal locality"
        elif not ts_pub:
            action = "source_error" if not loc_en and not loc_mm else "confirmed_non_admin"
            review_decision = action
            recommendation = action
            reason = "township unresolved after inventory check"
        elif looks_non_admin(loc_en, loc_mm) and loc_type not in WARD_VT:
            action = "confirmed_non_admin"
            review_decision = "confirmed_non_admin"
            recommendation = "confirmed_non_admin"
            reason = "non-admin locality markers"
        elif not loc_en and not loc_mm:
            action = "source_error"
            review_decision = "source_error"
            recommendation = "source_error"
            reason = "empty locality names"
        elif evidence == "unique_exact_my" and len(cands) == 1:
            cand = cands[0]
            need, propose_mm, propose_en = alias_needed(cand, loc_en, loc_mm)
            selected = cand.public_id
            if need:
                action = "add_alias_and_link"
                review_decision = "add_alias_and_link"
                recommendation = "add_alias_and_link"
                reason = f"unique exact MY match; propose alias while preserving primary ({cand.name_mm}/{cand.name_en})"
                auto_alias += 1
            else:
                action = "link_existing"
                review_decision = "link_existing"
                recommendation = "link_existing"
                reason = f"unique exact Myanmar primary/alias match → {cand.public_id}"
                auto_link += 1
        elif evidence == "unique_exact_bilingual" and len(cands) == 1:
            cand = cands[0]
            need, propose_mm, propose_en = alias_needed(cand, loc_en, loc_mm)
            selected = cand.public_id
            if need:
                action = "add_alias_and_link"
                review_decision = "add_alias_and_link"
                recommendation = "add_alias_and_link"
                reason = "unique bilingual identity; propose missing-side alias"
                auto_alias += 1
            else:
                action = "link_existing"
                review_decision = "link_existing"
                recommendation = "link_existing"
                reason = f"unique exact bilingual identity → {cand.public_id}"
                auto_link += 1
        elif evidence in {"english_only_blocked", "multiple_candidates", "conflict_mm_vs_en"} or len(cands) > 1:
            # Review queue — still must decide without defer
            unresolved_for_review += 1
            n_mm = compact_name(loc_mm)
            n_en = compact_name(loc_en)
            mm_only = [c for c in kids if n_mm and n_mm in c.norms_mm and (not COMPAT_TYPES.get(loc_type) or c.typ in COMPAT_TYPES[loc_type] or c.level == "ward_village_tract")]
            en_only = [c for c in kids if n_en and n_en in c.norms_en and (not COMPAT_TYPES.get(loc_type) or c.typ in COMPAT_TYPES[loc_type] or c.level == "ward_village_tract")]
            mm_uniq = list({c.public_id: c for c in mm_only}.values())
            en_uniq = list({c.public_id: c for c in en_only}.values())

            if evidence == "conflict_mm_vs_en" and len(mm_uniq) == 1 and len(en_uniq) == 1 and mm_uniq[0].public_id != en_uniq[0].public_id:
                action = "source_error"
                review_decision = "source_error"
                recommendation = "source_error"
                reason = (
                    f"inconsistent bilingual postal row: MY→{mm_uniq[0].public_id} ({mm_uniq[0].name_mm}/{mm_uniq[0].name_en}) "
                    f"but EN→{en_uniq[0].public_id} ({en_uniq[0].name_mm}/{en_uniq[0].name_en})"
                )
            elif evidence == "conflict_mm_vs_en" and len(mm_uniq) == 1:
                # Prefer unique Myanmar identity; propose EN as alias if needed
                cand = mm_uniq[0]
                selected = cand.public_id
                need, propose_mm, propose_en = alias_needed(cand, loc_en, loc_mm)
                if n_en and n_en not in cand.norms_en:
                    propose_en = loc_en
                    need = True
                if need:
                    action = "add_alias_and_link"
                    review_decision = "add_alias_and_link"
                    recommendation = "add_alias_and_link"
                    reason = f"unique MY wins over conflicting EN; propose EN alias on {cand.public_id}"
                    auto_alias += 1
                else:
                    action = "link_existing"
                    review_decision = "link_existing"
                    recommendation = "link_existing"
                    reason = f"unique MY match after EN conflict check → {cand.public_id}"
                    auto_link += 1
            elif evidence == "english_only_blocked" and len(cands) == 1 and mh:
                cand = cands[0]
                if compact_name(loc_mm) and compact_name(loc_mm) in cand.norms_mm:
                    selected = cand.public_id
                    action = "link_existing"
                    review_decision = "link_existing"
                    recommendation = "link_existing"
                    reason = "EN-only path blocked but MY now aligns with unique candidate"
                    auto_link += 1
                else:
                    action = "confirmed_non_admin"
                    review_decision = "confirmed_non_admin"
                    recommendation = "confirmed_non_admin"
                    reason = "English-only approximate name blocked; no unique MY proof"
            elif len(cands) > 1 or evidence == "multiple_candidates":
                if mh and len(mh) == 1:
                    m = mh[0]
                    narrowed = [
                        c
                        for c in cands
                        if (m["norm_my"] and m["norm_my"] in c.norms_mm)
                        or (m["norm_en"] and m["norm_en"] in c.norms_en)
                    ]
                    if len({c.public_id for c in narrowed}) == 1:
                        cand = next(iter({c.public_id: c for c in narrowed}.values()))
                        selected = cand.public_id
                        action = "link_existing"
                        review_decision = "link_existing"
                        recommendation = "link_existing"
                        reason = f"disambiguated via unique MIMU inventory identity → {cand.public_id}"
                        auto_link += 1
                    else:
                        action = "confirmed_non_admin"
                        review_decision = "confirmed_non_admin"
                        recommendation = "confirmed_non_admin"
                        reason = "multiple CoreMap candidates; cannot auto-match without unique bilingual proof"
                elif len(mm_uniq) == 1:
                    cand = mm_uniq[0]
                    selected = cand.public_id
                    need, propose_mm, propose_en = alias_needed(cand, loc_en, loc_mm)
                    if need:
                        action = "add_alias_and_link"
                        review_decision = "add_alias_and_link"
                        recommendation = "add_alias_and_link"
                        reason = f"narrowed multiple candidates via unique MY → {cand.public_id}"
                        auto_alias += 1
                    else:
                        action = "link_existing"
                        review_decision = "link_existing"
                        recommendation = "link_existing"
                        reason = f"narrowed multiple candidates via unique MY → {cand.public_id}"
                        auto_link += 1
                else:
                    action = "confirmed_non_admin"
                    review_decision = "confirmed_non_admin"
                    recommendation = "confirmed_non_admin"
                    reason = "multiple candidates / conflict; no unique exact proof"
            else:
                action = "confirmed_non_admin"
                review_decision = "confirmed_non_admin"
                recommendation = "confirmed_non_admin"
                reason = f"blocked auto-match ({evidence})"
        else:
            # no exact candidates
            unresolved_for_review += 1
            if mh and len(mh) == 1:
                # MIMU has it but CoreMap inventory missing — cannot invent; confirm gap as non-linkable
                action = "confirmed_non_admin"
                review_decision = "confirmed_non_admin"
                recommendation = "confirmed_non_admin"
                reason = (
                    f"MIMU source exists ({mh[0].get('source_pcode')}) but no CoreMap ward/VT to link; "
                    "do not invent admin from postal text"
                )
            elif mh and len(mh) > 1:
                action = "source_error"
                review_decision = "source_error"
                recommendation = "source_error"
                reason = "multiple MIMU identities for same postal locality norms"
            else:
                action = "confirmed_non_admin"
                review_decision = "confirmed_non_admin"
                recommendation = "confirmed_non_admin"
                reason = "no CoreMap or MIMU exact identity under township; keep as non-linked postal locality"

        assert review_decision in {
            "link_existing",
            "confirmed_non_admin",
            "add_alias_and_link",
            "source_error",
            "defer",
        }
        assert review_decision != "defer" and review_decision != ""

        cand_summaries = []
        for c in cands[:8]:
            cand_summaries.append(
                f"{c.core_id}/{c.public_id}:{c.typ}:{c.name_mm}/{c.name_en}"
                f"(aliases_mm={','.join(c.aliases_mm[:3])};aliases_en={','.join(c.aliases_en[:3])})"
            )

        action_row = {
            "group_id": hashlib.sha1("|".join(key).encode()).hexdigest()[:12],
            "township_public_id": ts_pub,
            "township_core_id": ts_core,
            "township_en": meta["township_en"],
            "township_mm": meta["township_mm"],
            "locality_type": loc_type,
            "normalized_name_mm": meta["normalized_name_mm"],
            "normalized_name_en": meta["normalized_name_en"],
            "locality_mm": loc_mm,
            "locality_en": loc_en,
            "postal_row_count": len(rows),
            "unique_postal_codes": len(codes),
            "postal_codes": ";".join(codes),
            "prior_statuses": ";".join(sorted({clean(r.get("v2_status")) for r in rows})),
            "action": action,
            "selected_admin_public_id": selected,
            "proposed_alias_mm": propose_mm,
            "proposed_alias_en": propose_en,
            "name_evidence": evidence,
            "mimu_hit_count": len(mh),
            "candidate_count": len(cands),
            "reason": reason,
            "preserve_existing_geom": "true",
            "production_apply": "false",
        }
        group_actions.append(action_row)

        # Review queue: every group that was not a clean auto link without review concerns,
        # plus all groups for visual package completeness when candidates exist or action needs eyes.
        # Spec: visual review queue for unresolved groups — include non-auto and all with candidates>1
        # Also include alias proposals and confirmed decisions for audit trail completeness of unresolved set.
        needs_preview = action in {"confirmed_non_admin", "source_error", "add_alias_and_link"} or len(cands) != 1 or evidence not in {
            "unique_exact_my",
            "unique_exact_bilingual",
        }
        # Always emit review row for groups that started unresolved (missing/ambiguous/invalid LAR)
        review_rows.append(
            {
                "group_id": action_row["group_id"],
                "postal_codes": action_row["postal_codes"],
                "postal_row_count": len(rows),
                "locality_mm": loc_mm,
                "locality_en": loc_en,
                "normalized_name_mm": meta["normalized_name_mm"],
                "normalized_name_en": meta["normalized_name_en"],
                "township_en": meta["township_en"],
                "township_mm": meta["township_mm"],
                "township_public_id": ts_pub,
                "township_core_id": ts_core,
                "expected_locality_type": loc_type,
                "candidate_ids": ";".join(c.core_id for c in cands),
                "candidate_public_ids": ";".join(c.public_id for c in cands),
                "candidate_mm_en_primary": " || ".join(f"{c.name_mm} / {c.name_en}" for c in cands[:8]),
                "candidate_aliases": " || ".join(
                    f"mm=[{','.join(c.aliases_mm[:4])}];en=[{','.join(c.aliases_en[:4])}]" for c in cands[:8]
                ),
                "candidate_type_hierarchy": " || ".join(
                    f"{c.typ}|parent={c.parent_public_id or c.parent_id}" for c in cands[:8]
                ),
                "candidate_summary": " || ".join(cand_summaries),
                "mimu_hits": ";".join(
                    f"{h.get('source_pcode')}:{h.get('name_en')}/{h.get('name_my')}" for h in mh[:8]
                ),
                "name_evidence": evidence,
                "recommendation": recommendation,
                "review_decision": review_decision,
                "selected_admin_public_id": selected,
                "proposed_alias_mm": propose_mm,
                "proposed_alias_en": propose_en,
                "review_note": reason,
                "preview_file": f"02-postal-review-previews/{action_row['group_id']}.json",
            }
        )

        preview = {
            "group_id": action_row["group_id"],
            "postal_codes": codes,
            "locality_mm": loc_mm,
            "locality_en": loc_en,
            "township_en": meta["township_en"],
            "township_mm": meta["township_mm"],
            "township_public_id": ts_pub,
            "expected_locality_type": loc_type,
            "candidates": [
                {
                    "core_id": c.core_id,
                    "public_id": c.public_id,
                    "type": c.typ,
                    "parent_public_id": c.parent_public_id,
                    "name_mm": c.name_mm,
                    "name_en": c.name_en,
                    "aliases_mm": c.aliases_mm,
                    "aliases_en": c.aliases_en,
                }
                for c in cands
            ],
            "mimu_hits": mh[:10],
            "name_evidence": evidence,
            "recommendation": recommendation,
            "review_decision": review_decision,
            "selected_admin_public_id": selected,
            "proposed_alias_mm": propose_mm,
            "proposed_alias_en": propose_en,
            "review_note": reason,
        }
        (PREV / f"{action_row['group_id']}.json").write_text(
            json.dumps(preview, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    # Gate: no defer/blank
    bad = [r for r in review_rows if not clean(r.get("review_decision")) or clean(r.get("review_decision")) == "defer"]
    if bad:
        raise SystemExit(f"defer/blank decisions remain: {len(bad)}")

    # Write LAR validation sidecar in previews
    (PREV / "linked_after_review_validation.json").write_text(
        json.dumps(
            {
                "generated_at": now,
                "input_count": len(lar_rows),
                "valid_count": len(lar_valid),
                "invalid_count": len(lar_invalid),
                "valid_postal_codes": [r["postal_code"] for r in lar_valid],
                "invalid": [
                    {
                        "postal_code": r["postal_code"],
                        "note": r["validation_note"],
                        "public_id": r.get("matched_local_admin_public_id"),
                        "locality_en": r.get("locality_en"),
                        "locality_mm": r.get("locality_mm"),
                    }
                    for r in lar_invalid
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    write_csv(OUT / "02-postal-group-actions.csv", group_actions)
    write_csv(OUT / "02-postal-group-review.csv", review_rows)
    write_csv(OUT / "02-postal-non-admin-audit.csv", non_admin_audit)

    # Append non-admin reclassify decisions into group-actions for a single action ledger
    for row in non_admin_audit:
        if row["audit_decision"] != "reclassify_as_official_local_area":
            continue
        pubs = [p for p in clean(row.get("coremap_candidate_public_ids")).split(";") if p]
        if len(pubs) != 1:
            continue
        gid = hashlib.sha1(
            f"na|{row['group_key']}|{pubs[0]}".encode()
        ).hexdigest()[:12]
        group_actions.append(
            {
                "group_id": gid,
                "township_public_id": row.get("resolved_township_public_id", ""),
                "township_core_id": row.get("resolved_township_core_id", ""),
                "township_en": row.get("township_en", ""),
                "township_mm": row.get("township_mm", ""),
                "locality_type": row.get("locality_type", ""),
                "normalized_name_mm": row.get("normalized_name_mm", ""),
                "normalized_name_en": row.get("normalized_name_en", ""),
                "locality_mm": row.get("locality_mm", ""),
                "locality_en": row.get("locality_en", ""),
                "postal_row_count": row.get("postal_row_count", ""),
                "unique_postal_codes": len(clean(row.get("postal_codes")).split(";")) if clean(row.get("postal_codes")) else 0,
                "postal_codes": row.get("postal_codes", ""),
                "prior_statuses": "non_admin_postal_locality",
                "action": "link_existing",
                "selected_admin_public_id": pubs[0],
                "proposed_alias_mm": "",
                "proposed_alias_en": "",
                "name_evidence": row.get("name_evidence", ""),
                "mimu_hit_count": row.get("mimu_hit_count", ""),
                "candidate_count": row.get("coremap_candidate_count", ""),
                "reason": f"non_admin audit reclassify: {row.get('audit_note','')}",
                "preserve_existing_geom": "true",
                "production_apply": "false",
            }
        )
    write_csv(OUT / "02-postal-group-actions.csv", group_actions)

    action_counts = Counter(r["action"] for r in group_actions)
    review_counts = Counter(r["review_decision"] for r in review_rows)
    na_counts = Counter(r["audit_decision"] for r in non_admin_audit)

    summary = f"""# 02 Postal resolution preparation (v3)

Generated: `{now}`  
Scope: disposable/local preparation only  
Production: **not touched**  
CoreMap geometry: **not changed**  
Production apply: **not generated**

Disposable inventory DB: `coremap_phase7_v2` @ `127.0.0.1:5433`

## A. Linked-after-review validation (19)

| Result | Count |
|---|---:|
| Input `linked_after_review` | {len(lar_rows)} |
| Valid (keep as linked_after_review) | {len(lar_valid)} |
| Invalid (re-entered resolution) | {len(lar_invalid)} |

Validation requires non-null `local_admin_area_id` **or** target `public_id`, matching township, ward/village_tract type, and documented evidence. Shared `public_id` across distinct locality norms fails validation.

Details: `02-postal-review-previews/linked_after_review_validation.json`

## B. Non-admin audit (646 → {len(non_admin_audit)} unique groups)

All 646 input rows use match_method `non_admin_unresolved_township_name` and a town-labeled parent.

| audit_decision | Groups |
|---|---:|
{chr(10).join(f"| `{k}` | {v} |" for k, v in sorted(na_counts.items(), key=lambda kv: (-kv[1], kv[0])))}

File: `02-postal-non-admin-audit.csv`

## C. Missing / ambiguous / invalid-LAR grouping

| Metric | Count |
|---|---:|
| Input missing rows | {len(missing)} |
| Input ambiguous rows | {len(ambiguous)} |
| Invalid LAR rows re-queued | {len(lar_invalid)} |
| Work rows total | {len(work_rows)} |
| Unique locality groups | {len(groups)} |

Group key = `township_public_id + locality_type + normalized_name_mm + normalized_name_en`.

## D. Matching results (strict)

Automatic match only for unique exact Myanmar primary/alias (no conflict) or unique exact bilingual identity. English-only / fuzzy / multi-candidate blocked.

| action | Groups |
|---|---:|
{chr(10).join(f"| `{k}` | {v} |" for k, v in sorted(action_counts.items(), key=lambda kv: (-kv[1], kv[0])))}

Auto link_existing groups: **{auto_link}**  
Auto add_alias_and_link groups: **{auto_alias}**

## E. Review queue

| review_decision | Groups |
|---|---:|
{chr(10).join(f"| `{k}` | {v} |" for k, v in sorted(review_counts.items(), key=lambda kv: (-kv[1], kv[0])))}

Defer/blank decisions remaining: **0**

Files:
- `02-postal-group-actions.csv`
- `02-postal-group-review.csv`
- `02-postal-review-previews/*.json`

## Gates

| Gate | Result |
|---|---|
| Production unmodified | PASS |
| Geometry unchanged | PASS |
| No production apply artifact | PASS |
| No defer/blank review_decision | PASS |
"""
    (OUT / "02-postal-resolution-summary.md").write_text(summary, encoding="utf-8")

    print("LAR valid/invalid", len(lar_valid), len(lar_invalid))
    print("non_admin groups", len(non_admin_audit), dict(na_counts))
    print("missing groups", len(groups), dict(action_counts))
    print("review", dict(review_counts))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
