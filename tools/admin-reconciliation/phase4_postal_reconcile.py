#!/usr/bin/env python3
"""Phase 4 — read-only postal ↔ approved local-admin reconcile.

Uses Phase 3 ward/village-tract decisions as the future local-admin inventory.
Reads Myanmar Post EN+MY CSVs from the postal ZIP. No database writes.

Outputs under reports/admin-reconciliation-v2/:
  04-postal-actions.csv
  04-postal-review.csv
  04-postal-unmatched.csv
  04-postal-summary.md
"""

from __future__ import annotations

import argparse
import collections
import csv
import difflib
import hashlib
import io
import re
import unicodedata
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

csv.field_size_limit(min(2**31 - 1, 100_000_000))

SEVEN_DIGIT = re.compile(r"^[0-9]{7}$")
EXPECTED_VALID = 17297
EXPECTED_DUP_EXTRA = 33
EXPECTED_MALFORMED = {"114560"}

REPO = Path(__file__).resolve().parents[2]
REPORTS = REPO / "reports" / "admin-reconciliation-v2"
EXPORT = REPO / "data" / "local" / "admin-reconciliation" / "phase2-export"
DEFAULT_ZIP = Path("/Users/nyihtet/Downloads/Complete Data.zip")

ACTION_HEADERS = [
    "postal_code",
    "status",
    "region_mm",
    "region_en",
    "township_mm",
    "township_en",
    "locality_mm",
    "locality_en",
    "inferred_locality_type",
    "matched_township_id",
    "matched_local_admin_area_id",
    "name_evidence",
    "match_method",
    "duplicate_extra_source_rows",
    "source_row_count_en",
    "source_row_count_my",
    "reason",
]

REVIEW_HEADERS = [
    "postal_code",
    "region_mm",
    "region_en",
    "township_mm",
    "township_en",
    "locality_mm",
    "locality_en",
    "candidate_admin_ids",
    "candidate_names",
    "candidate_types",
    "name_evidence",
    "recommended_action",
    "review_decision",
    "selected_local_admin_area_id",
    "review_note",
]

UNCERTAIN_ACTIONS = {"manual_review", "merge_duplicate_candidate", "reject_source_error"}
SR_PARENT_REMAP = {
    "MMR014": "MMR222",  # Shan South → Shan
    "MMR015": "MMR222",  # Shan North
    "MMR016": "MMR222",  # Shan East
    "MMR007": "MMR111",  # Bago East → Bago
    "MMR008": "MMR111",  # Bago West
}


def clean(value: Any) -> str:
    return "" if value is None else str(value).strip()


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_csv(path: Path, rows: list[dict[str, str]], headers: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=headers, extrasaction="ignore")
        w.writeheader()
        for row in rows:
            w.writerow({h: row.get(h, "") for h in headers})


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def compact_name(value: Any, level: str = "") -> str:
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


def source_key_from_action(row: dict[str, str]) -> str:
    entity = clean(row.get("source_entity_type"))
    pcode = clean(row.get("source_pcode")) or "nopcode"
    srow = clean(row.get("source_row"))
    safe_file = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(clean(row.get("source_file"))).name)[:80]
    return f"{entity}:{pcode}:row{srow}:{safe_file}"


def map_decision_to_action(decision: str, selected_core_id: str) -> tuple[str, str]:
    d = clean(decision)
    sid = clean(selected_core_id)
    if d in {"match_existing", "selective_merge", "selective_merge_union"}:
        return ("keep_existing" if sid else ""), sid
    if d == "create_new":
        return "create_mimu_placeholder", ""
    if d == "keep_both":
        return "create_mimu_placeholder", ""
    if d == "merge_confirmed_duplicate":
        return "merge_duplicate_candidate", sid
    if d == "reject_source_error":
        return "reject_source_error", ""
    if d == "defer":
        return "defer", ""
    return "", ""


def infer_locality_type(locality_en: str, locality_mm: str) -> str:
    joined = f"{locality_en} {locality_mm}".casefold()
    if "quarter" in joined or "ward" in joined or "ရပ်ကွက်" in locality_mm:
        return "ward"
    if "village tract" in joined or "village-tract" in joined or "ကျေးရွာအုပ်စု" in locality_mm:
        return "village_tract"
    return ""


def looks_non_admin_locality(locality_en: str, locality_mm: str) -> bool:
    """Postal locality that is not a ward / village-tract style name."""
    if not clean(locality_en) and not clean(locality_mm):
        return True
    typ = infer_locality_type(locality_en, locality_mm)
    if typ:
        return False
    # Common non-admin postal labels
    blob = f"{locality_en} {locality_mm}".casefold()
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
    )
    return any(m in blob for m in markers)


@dataclass
class LocalIdentity:
    core_id: str
    township_id: str
    typ: str
    name_mm: str
    name_en: str
    norms: set[str] = field(default_factory=set)
    origin: str = ""
    pending_create: bool = False


def load_core_name_index() -> tuple[dict[str, dict[str, str]], dict[str, set[str]]]:
    """core_id -> meta; core_id -> normalized name set."""
    meta: dict[str, dict[str, str]] = {}
    norms: dict[str, set[str]] = collections.defaultdict(set)
    wvt = load_csv(EXPORT / "ward_village_tracts.csv")
    for row in wvt:
        cid = clean(row.get("id"))
        if not cid:
            continue
        meta[cid] = {
            "township_id": clean(row.get("parent_id")),
            "typ": clean(row.get("admin_area_type")),
            "canonical": clean(row.get("canonical_name")),
        }
        if meta[cid]["canonical"]:
            norms[cid].add(compact_name(meta[cid]["canonical"], "ward_village_tract"))
    for row in load_csv(EXPORT / "wvt_names.csv"):
        cid = clean(row.get("admin_area_id"))
        name = clean(row.get("name"))
        if not cid or not name:
            continue
        norms[cid].add(compact_name(name, "ward_village_tract"))
        lang = clean(row.get("language_code")).lower()
        if cid not in meta:
            meta[cid] = {"township_id": "", "typ": "", "canonical": name}
        if lang in {"my", "mm"} and not meta[cid].get("name_mm"):
            meta[cid]["name_mm"] = name
        if lang == "en" and not meta[cid].get("name_en"):
            meta[cid]["name_en"] = name
    return meta, norms


def build_phase3_inventory(
    reports: Path,
    core_meta: dict[str, dict[str, str]],
    core_norms: dict[str, set[str]],
) -> tuple[list[LocalIdentity], dict[str, Any]]:
    local_actions = load_csv(reports / "02-local-admin-actions.csv")
    local_dec = {
        clean(r.get("review_id") or r.get("source_key")): r
        for r in load_csv(reports / "03-local-admin-decisions.csv")
    }
    local_queue = {
        clean(r.get("source_key")): r for r in load_csv(reports / "03-local-admin-review-queue.csv")
    }
    merge_dec = load_csv(reports / "03-merge-decisions.csv")

    loser_ids: set[str] = set()
    survivor_ids: set[str] = set()
    for d in merge_dec:
        if clean(d.get("review_decision")) != "merge_confirmed_duplicate":
            continue
        surv = clean(d.get("selected_core_id"))
        if surv:
            survivor_ids.add(surv)
        for x in clean(d.get("losing_core_ids")).split(";"):
            if clean(x):
                loser_ids.add(clean(x))

    stats: dict[str, Any] = collections.Counter()
    identities: list[LocalIdentity] = []
    seen_core: set[str] = set()
    undecided_keys: list[str] = []

    def add_core(cid: str, township_fallback: str, typ_fallback: str, origin: str) -> None:
        cid = clean(cid)
        if not cid or cid in loser_ids or cid in seen_core:
            return
        m = core_meta.get(cid, {})
        township_id = clean(m.get("township_id")) or clean(township_fallback)
        typ = clean(m.get("typ")) or clean(typ_fallback)
        name_mm = clean(m.get("name_mm")) or clean(m.get("canonical"))
        name_en = clean(m.get("name_en"))
        norms = set(core_norms.get(cid) or set())
        if name_mm:
            norms.add(compact_name(name_mm, "ward_village_tract"))
        if name_en:
            norms.add(compact_name(name_en, "ward_village_tract"))
        norms.discard("")
        identities.append(
            LocalIdentity(
                core_id=cid,
                township_id=township_id,
                typ=typ,
                name_mm=name_mm,
                name_en=name_en,
                norms=norms,
                origin=origin,
                pending_create=False,
            )
        )
        seen_core.add(cid)
        stats["core_identities"] += 1

    def add_pending(row: dict[str, str], origin: str) -> None:
        township_id = clean(row.get("approved_township_id"))
        typ = clean(row.get("source_entity_type"))
        name_mm = clean(row.get("source_name_my"))
        name_en = clean(row.get("source_name_en"))
        norms = {
            compact_name(name_mm, "ward_village_tract"),
            compact_name(name_en, "ward_village_tract"),
        } - {""}
        identities.append(
            LocalIdentity(
                core_id="",
                township_id=township_id,
                typ=typ,
                name_mm=name_mm,
                name_en=name_en,
                norms=norms,
                origin=origin,
                pending_create=True,
            )
        )
        stats["pending_creates"] += 1

    for row in local_actions:
        action = clean(row.get("action"))
        key = source_key_from_action(row)
        out_action = action
        matched_id = clean(row.get("matched_coremap_id"))
        review_decision = ""

        if action in UNCERTAIN_ACTIONS or action == "manual_review":
            # Prefer separate decision CSV; fall back to queue column.
            d = local_dec.get(key) or local_queue.get(key) or {}
            review_decision = clean(d.get("review_decision"))
            if not review_decision:
                undecided_keys.append(key)
                stats["undecided_skipped"] += 1
                continue
            mapped, sid = map_decision_to_action(review_decision, clean(d.get("selected_core_id")))
            out_action = mapped
            matched_id = sid
            if review_decision == "keep_both":
                # Keep any listed CoreMap candidates as surviving extras.
                q = local_queue.get(key) or {}
                cand_raw = clean(q.get("candidate_core_ids")) or clean(row.get("candidate_coremap_ids"))
                for cid in cand_raw.split(";"):
                    add_core(
                        cid,
                        clean(row.get("approved_township_id")),
                        clean(row.get("source_entity_type")),
                        "keep_both_core",
                    )
            if review_decision == "selective_merge":
                out_action = "keep_existing"

        if out_action in {"keep_existing", "update_names", "update_type", "update_parent", "update_names_and_type"}:
            add_core(
                matched_id,
                clean(row.get("approved_township_id")),
                clean(row.get("source_entity_type")) or clean(row.get("matched_type")),
                out_action,
            )
        elif out_action == "create_mimu_placeholder":
            add_pending(row, out_action)
        elif out_action == "merge_duplicate_candidate":
            add_core(
                matched_id,
                clean(row.get("approved_township_id")),
                clean(row.get("source_entity_type")),
                "merge_survivor",
            )
        elif out_action == "reject_source_error":
            stats["rejected_source"] += 1
        elif out_action == "defer":
            undecided_keys.append(key)
            stats["deferred_skipped"] += 1
        else:
            stats[f"other_action_{out_action or 'empty'}"] += 1

    # Ensure merge survivors are present even if only referenced from merge CSV.
    for sid in survivor_ids:
        add_core(sid, "", "", "merge_survivor")

    stats["loser_ids_excluded"] = len(loser_ids)
    stats["undecided_keys"] = len(undecided_keys)
    stats["inventory_total"] = len(identities)
    return identities, {
        "counts": dict(stats),
        "undecided_sample": undecided_keys[:20],
        "loser_ids": len(loser_ids),
    }


def build_township_indexes(
    reports: Path,
) -> tuple[dict[str, str], dict[tuple[str, str], set[str]], dict[str, dict[str, str]]]:
    """Return pcode->core_id, (state_norm, ts_norm)->core_ids, core_id->meta."""
    pcode_to_core: dict[str, str] = {}
    by_name: dict[tuple[str, str], set[str]] = collections.defaultdict(set)
    core_meta: dict[str, dict[str, str]] = {}

    for row in load_csv(reports / "02-township-map.csv"):
        core_id = clean(row.get("core_township_id"))
        pcode = clean(row.get("source_ts_pcode"))
        if pcode and core_id:
            pcode_to_core[pcode] = core_id
        if not core_id:
            continue
        st = compact_name(row.get("source_st_name"), "state_region")
        ts = compact_name(row.get("source_ts_name"), "township")
        core_meta[core_id] = {
            "pcode": pcode,
            "name_en": clean(row.get("source_ts_name")),
            "name_mm": "",
            "state_en": clean(row.get("source_st_name")),
            "core_name": clean(row.get("core_canonical_name")),
        }
        if st and ts:
            by_name[(st, ts)].add(core_id)
        if ts:
            by_name[("", ts)].add(core_id)

    # Enrich with CoreMap township names
    for row in load_csv(EXPORT / "township_names.csv"):
        tid = clean(row.get("admin_area_id") or row.get("township_id") or row.get("id"))
        name = clean(row.get("name"))
        lang = clean(row.get("language_code")).lower()
        if not tid or not name:
            continue
        core_meta.setdefault(tid, {})
        if lang in {"my", "mm"}:
            core_meta[tid]["name_mm"] = name
            by_name[("", compact_name(name, "township"))].add(tid)
        if lang == "en":
            core_meta[tid]["name_en"] = name
            by_name[("", compact_name(name, "township"))].add(tid)

    # Town → township from Phase-2 local parent paths (… > Township > Town)
    for row in load_csv(reports / "02-local-admin-actions.csv"):
        core_id = clean(row.get("approved_township_id"))
        if not core_id:
            continue
        path = clean(row.get("source_parent_path"))
        parts = [p.strip() for p in path.split(">") if p.strip()]
        st_name = parts[0] if parts else clean(row.get("source_st_name"))
        ts_name = clean(row.get("source_ts_name"))
        st = compact_name(st_name, "state_region")
        ts = compact_name(ts_name, "township")
        if st and ts:
            by_name[(st, ts)].add(core_id)
        if ts:
            by_name[("", ts)].add(core_id)
        if len(parts) >= 4:
            town = compact_name(parts[-1], "town")
            if town:
                by_name[(st, town)].add(core_id)
                by_name[("", town)].add(core_id)

    rebuilt: dict[tuple[str, str], set[str]] = collections.defaultdict(set)
    for (st, ts), ids in by_name.items():
        st2 = re.sub(r"(east|west|north|south)$", "", st)
        rebuilt[(st2, ts)] |= ids
        rebuilt[("", ts)] |= ids
    return pcode_to_core, rebuilt, core_meta


def resolve_township(
    region_en: str,
    region_mm: str,
    township_en: str,
    township_mm: str,
    by_name: dict[tuple[str, str], set[str]],
) -> tuple[str, str, str]:
    """Return (township_core_id, method, reason)."""
    state_norms = {
        compact_name(region_en, "state_region"),
        compact_name(region_mm, "state_region"),
    } - {""}
    fixed_states: set[str] = set()
    for s in state_norms:
        s2 = re.sub(r"(east|west|north|south)$", "", s)
        fixed_states.add(s2 or s)
    ts_norms = {
        compact_name(township_en, "township"),
        compact_name(township_mm, "township"),
        compact_name(township_en, "town"),
        compact_name(township_mm, "town"),
    } - {""}

    hits: set[str] = set()
    method = ""
    for st in fixed_states or {""}:
        for ts in ts_norms:
            found = by_name.get((st, ts)) or set()
            if found:
                hits |= found
                method = "exact_township_or_town_under_region" if st else method
    if not hits:
        for ts in ts_norms:
            found = by_name.get(("", ts)) or set()
            hits |= found
        if hits:
            method = "exact_township_or_town_global"

    if len(hits) == 1:
        return next(iter(hits)), method or "exact_township", "Unique approved township"
    if len(hits) > 1:
        # Prefer hits that appear under the resolved state when possible
        return "", "ambiguous_township", f"Ambiguous township candidates: {sorted(hits)[:8]}"
    return "", "township_unresolved", "Could not resolve approved CoreMap township from postal region/township names"


def fuzzy_candidates(
    targets: set[str],
    pool: list[LocalIdentity],
    limit: int = 5,
) -> list[tuple[LocalIdentity, float, str]]:
    if not targets or not pool:
        return []
    scored: list[tuple[LocalIdentity, float, str]] = []
    for ident in pool:
        best = 0.0
        evidence = ""
        for t in targets:
            for n in ident.norms:
                if not n or not t:
                    continue
                ratio = difflib.SequenceMatcher(None, t, n).ratio()
                if ratio > best:
                    best = ratio
                    evidence = f"fuzzy:{ratio:.2f}"
        if best >= 0.84:
            scored.append((ident, best, evidence))
    scored.sort(key=lambda x: (-x[1], x[0].core_id or x[0].name_en))
    return scored[:limit]


def load_postal_frames(zip_path: Path) -> tuple[dict[str, list[dict[str, str]]], dict[str, list[dict[str, str]]], dict[str, str]]:
    with zipfile.ZipFile(zip_path) as archive:
        names = {Path(name).name: name for name in archive.namelist()}
        frames: dict[str, list[dict[str, str]]] = {}
        hashes: dict[str, str] = {}
        for language, filename in [
            ("en", "Myanmar_Locations_Postal_Code_EN.csv"),
            ("my", "Myanmar_Locations_Postal_Code_MM.csv"),
        ]:
            raw = archive.read(names[filename])
            hashes[language] = hashlib.sha256(raw).hexdigest()
            text = raw.decode("utf-8-sig")
            frames[language] = [
                {k: clean(v) for k, v in row.items()} for row in csv.DictReader(io.StringIO(text))
            ]
    hashes["zip"] = sha256_file(zip_path)
    grouped: dict[str, dict[str, list[dict[str, str]]]] = {"en": collections.defaultdict(list), "my": collections.defaultdict(list)}
    for language, rows in frames.items():
        for row in rows:
            grouped[language][row.get("Postal Code", "")].append(row)
    return grouped["en"], grouped["my"], hashes


def join_values(rows: list[dict[str, str]], key: str) -> str:
    return " | ".join(sorted({clean(row.get(key)) for row in rows if clean(row.get(key))}))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--postal-zip", type=Path, default=DEFAULT_ZIP)
    parser.add_argument("--reports", type=Path, default=REPORTS)
    parser.add_argument("--out-dir", type=Path, default=None)
    args = parser.parse_args()
    out_dir = args.out_dir or args.reports
    out_dir.mkdir(parents=True, exist_ok=True)

    if not args.postal_zip.exists():
        raise SystemExit(f"Postal ZIP not found: {args.postal_zip}")

    print("Loading CoreMap name index…")
    core_meta, core_norms = load_core_name_index()
    print(f"  WVT ids with names: {len(core_norms)}")

    print("Building Phase 3 local-admin inventory…")
    inventory, inv_meta = build_phase3_inventory(args.reports, core_meta, core_norms)
    print(f"  inventory={inv_meta['counts']}")

    by_township: dict[str, list[LocalIdentity]] = collections.defaultdict(list)
    for ident in inventory:
        if ident.township_id:
            by_township[ident.township_id].append(ident)

    print("Building township indexes…")
    _, ts_by_name, _ = build_township_indexes(args.reports)

    print("Reading postal CSVs…")
    en_by_code, my_by_code, hashes = load_postal_frames(args.postal_zip)
    all_codes = set(en_by_code) | set(my_by_code)
    valid = sorted(c for c in all_codes if SEVEN_DIGIT.fullmatch(c))
    malformed = sorted(c for c in all_codes if c and not SEVEN_DIGIT.fullmatch(c))
    dup_extra_en = sum(max(0, len(en_by_code.get(c, [])) - 1) for c in valid)
    dup_extra_my = sum(max(0, len(my_by_code.get(c, [])) - 1) for c in valid)
    codes_with_dup = sum(
        1 for c in valid if len(en_by_code.get(c, [])) > 1 or len(my_by_code.get(c, [])) > 1
    )

    source_checks = {
        "valid_unique": len(valid),
        "valid_unique_ok": len(valid) == EXPECTED_VALID,
        "duplicate_extra_en": dup_extra_en,
        "duplicate_extra_my": dup_extra_my,
        "duplicate_extra_ok": dup_extra_en == EXPECTED_DUP_EXTRA and dup_extra_my == EXPECTED_DUP_EXTRA,
        "codes_with_duplicate_rows": codes_with_dup,
        "malformed": malformed,
        "malformed_ok": set(malformed) == EXPECTED_MALFORMED,
    }
    print(
        f"  valid={len(valid)} dup_extra_en={dup_extra_en} dup_extra_my={dup_extra_my} "
        f"malformed={malformed}"
    )

    actions: list[dict[str, str]] = []
    review_rows: list[dict[str, str]] = []
    unmatched: list[dict[str, str]] = []
    status_counts: collections.Counter[str] = collections.Counter()

    # Malformed rejected (not part of 17297)
    for code in malformed:
        for language, bucket in [("en", en_by_code), ("my", my_by_code)]:
            for row in bucket.get(code, []):
                actions.append(
                    {
                        "postal_code": code,
                        "status": "malformed_rejected",
                        "region_mm": clean(row.get("Region")) if language == "my" else "",
                        "region_en": clean(row.get("Region")) if language == "en" else "",
                        "township_mm": clean(row.get("Town / Township")) if language == "my" else "",
                        "township_en": clean(row.get("Town / Township")) if language == "en" else "",
                        "locality_mm": clean(row.get("Quarter / Village Tract")) if language == "my" else "",
                        "locality_en": clean(row.get("Quarter / Village Tract")) if language == "en" else "",
                        "inferred_locality_type": "",
                        "matched_township_id": "",
                        "matched_local_admin_area_id": "",
                        "name_evidence": "",
                        "match_method": "malformed",
                        "duplicate_extra_source_rows": "0",
                        "source_row_count_en": str(len(en_by_code.get(code, []))),
                        "source_row_count_my": str(len(my_by_code.get(code, []))),
                        "reason": "postal_code must be exactly seven ASCII digits",
                    }
                )
                status_counts["malformed_rejected"] += 1

    for code in valid:
        en_rows = en_by_code.get(code, [])
        my_rows = my_by_code.get(code, [])
        region_en = join_values(en_rows, "Region")
        region_mm = join_values(my_rows, "Region")
        township_en = join_values(en_rows, "Town / Township")
        township_mm = join_values(my_rows, "Town / Township")
        locality_en = join_values(en_rows, "Quarter / Village Tract")
        locality_mm = join_values(my_rows, "Quarter / Village Tract")
        extra_dup = max(0, len(en_rows) - 1) + max(0, len(my_rows) - 1)
        inferred = infer_locality_type(locality_en, locality_mm)

        base = {
            "postal_code": code,
            "region_mm": region_mm,
            "region_en": region_en,
            "township_mm": township_mm,
            "township_en": township_en,
            "locality_mm": locality_mm,
            "locality_en": locality_en,
            "inferred_locality_type": inferred,
            "duplicate_extra_source_rows": str(extra_dup),
            "source_row_count_en": str(len(en_rows)),
            "source_row_count_my": str(len(my_rows)),
        }

        if looks_non_admin_locality(locality_en, locality_mm) and not inferred:
            row = {
                **base,
                "status": "non_admin_postal_locality",
                "matched_township_id": "",
                "matched_local_admin_area_id": "",
                "name_evidence": "non_admin_or_empty_locality",
                "match_method": "non_admin",
                "reason": "Locality is empty or not a ward/village-tract style name; not linked",
            }
            actions.append(row)
            unmatched.append(row)
            status_counts["non_admin_postal_locality"] += 1
            continue

        ts_id, ts_method, ts_reason = resolve_township(
            region_en, region_mm, township_en, township_mm, ts_by_name
        )
        if not ts_id:
            row = {
                **base,
                "status": "missing_local_area",
                "matched_township_id": "",
                "matched_local_admin_area_id": "",
                "name_evidence": ts_method,
                "match_method": ts_method,
                "reason": ts_reason + "; local match skipped (township must resolve first)",
            }
            actions.append(row)
            unmatched.append(row)
            review_rows.append(
                {
                    **{h: base.get(h, "") for h in REVIEW_HEADERS if h in base},
                    "candidate_admin_ids": "",
                    "candidate_names": "",
                    "candidate_types": "",
                    "name_evidence": ts_method,
                    "recommended_action": "resolve_township_then_local",
                    "review_decision": "",
                    "selected_local_admin_area_id": "",
                    "review_note": ts_reason,
                }
            )
            status_counts["missing_local_area"] += 1
            continue

        targets = {
            compact_name(locality_en, "ward_village_tract"),
            compact_name(locality_mm, "ward_village_tract"),
        } - {""}
        pool = by_township.get(ts_id, [])

        exact_core: list[LocalIdentity] = []
        exact_pending: list[LocalIdentity] = []
        evidence = ""
        for ident in pool:
            if ident.norms & targets:
                if ident.pending_create or not ident.core_id:
                    exact_pending.append(ident)
                else:
                    exact_core.append(ident)
                if not evidence:
                    if targets & {compact_name(ident.name_mm, "ward_village_tract")} and targets & {
                        compact_name(ident.name_en, "ward_village_tract")
                    }:
                        evidence = "exact_my+en"
                    elif targets & {compact_name(ident.name_mm, "ward_village_tract")}:
                        evidence = "exact_my"
                    elif targets & {compact_name(ident.name_en, "ward_village_tract")}:
                        evidence = "exact_en"
                    else:
                        evidence = "exact_normalized_alias"

        # Dedupe by core_id / pending name
        uniq_core: dict[str, LocalIdentity] = {i.core_id: i for i in exact_core}
        exact_core = list(uniq_core.values())

        if len(exact_core) == 1:
            hit = exact_core[0]
            row = {
                **base,
                "status": "linked_exact_local_area",
                "matched_township_id": ts_id,
                "matched_local_admin_area_id": hit.core_id,
                "name_evidence": evidence or "exact",
                "match_method": "exact_local_under_township",
                "reason": "Unique exact approved local-admin under matched township",
            }
            actions.append(row)
            status_counts["linked_exact_local_area"] += 1
            continue

        if len(exact_core) > 1:
            ids = [i.core_id for i in exact_core]
            names = [f"{i.name_mm or i.name_en} [{i.name_en}/{i.name_mm}]" for i in exact_core]
            types = [i.typ for i in exact_core]
            row = {
                **base,
                "status": "ambiguous_local_area",
                "matched_township_id": ts_id,
                "matched_local_admin_area_id": "",
                "name_evidence": evidence or "exact_multi",
                "match_method": "ambiguous_exact_local",
                "reason": f"Multiple exact approved locals under township: {','.join(ids)}",
            }
            actions.append(row)
            unmatched.append(row)
            review_rows.append(
                {
                    "postal_code": code,
                    "region_mm": region_mm,
                    "region_en": region_en,
                    "township_mm": township_mm,
                    "township_en": township_en,
                    "locality_mm": locality_mm,
                    "locality_en": locality_en,
                    "candidate_admin_ids": ";".join(ids),
                    "candidate_names": " | ".join(names),
                    "candidate_types": " | ".join(types),
                    "name_evidence": evidence or "exact_multi",
                    "recommended_action": "manual_pick_one_local",
                    "review_decision": "",
                    "selected_local_admin_area_id": "",
                    "review_note": row["reason"],
                }
            )
            status_counts["ambiguous_local_area"] += 1
            continue

        if exact_pending and not exact_core:
            # Exact name matches an approved create_new / placeholder — no core id yet.
            row = {
                **base,
                "status": "missing_local_area",
                "matched_township_id": ts_id,
                "matched_local_admin_area_id": "",
                "name_evidence": evidence or "exact_pending_create",
                "match_method": "exact_pending_create",
                "reason": (
                    "Exact name matches Phase-3 approved create_mimu_placeholder / create_new, "
                    "but no local_admin_area_id exists yet — do not invent id from postal text"
                ),
            }
            actions.append(row)
            unmatched.append(row)
            review_rows.append(
                {
                    "postal_code": code,
                    "region_mm": region_mm,
                    "region_en": region_en,
                    "township_mm": township_mm,
                    "township_en": township_en,
                    "locality_mm": locality_mm,
                    "locality_en": locality_en,
                    "candidate_admin_ids": "",
                    "candidate_names": " | ".join(
                        f"{p.name_mm or p.name_en} [{p.name_en}/{p.name_mm}]" for p in exact_pending[:5]
                    ),
                    "candidate_types": " | ".join(p.typ for p in exact_pending[:5]),
                    "name_evidence": "exact_pending_create",
                    "recommended_action": "link_after_create_applied",
                    "review_decision": "",
                    "selected_local_admin_area_id": "",
                    "review_note": row["reason"],
                }
            )
            status_counts["missing_local_area"] += 1
            continue

        # Fuzzy review-only (never auto-link)
        fuzzy = fuzzy_candidates(targets, [i for i in pool if i.core_id and not i.pending_create])
        if fuzzy:
            ids = [i.core_id for i, _, _ in fuzzy]
            names = [
                f"{i.name_mm or i.name_en} [{i.name_en}/{i.name_mm}] ({ev})"
                for i, _, ev in fuzzy
            ]
            types = [i.typ for i, _, _ in fuzzy]
            row = {
                **base,
                "status": "linked_after_review",
                "matched_township_id": ts_id,
                "matched_local_admin_area_id": "",
                "name_evidence": fuzzy[0][2],
                "match_method": "fuzzy_review_only",
                "reason": "No exact approved local; fuzzy candidates listed for human review only (not auto-linked)",
            }
            actions.append(row)
            review_rows.append(
                {
                    "postal_code": code,
                    "region_mm": region_mm,
                    "region_en": region_en,
                    "township_mm": township_mm,
                    "township_en": township_en,
                    "locality_mm": locality_mm,
                    "locality_en": locality_en,
                    "candidate_admin_ids": ";".join(ids),
                    "candidate_names": " | ".join(names),
                    "candidate_types": " | ".join(types),
                    "name_evidence": fuzzy[0][2],
                    "recommended_action": "review_fuzzy_then_link_or_missing",
                    "review_decision": "",
                    "selected_local_admin_area_id": "",
                    "review_note": row["reason"],
                }
            )
            status_counts["linked_after_review"] += 1
            continue

        row = {
            **base,
            "status": "missing_local_area",
            "matched_township_id": ts_id,
            "matched_local_admin_area_id": "",
            "name_evidence": "no_exact_or_fuzzy",
            "match_method": "missing_local",
            "reason": (
                f"Township {ts_id} resolved, but no exact approved ward/village-tract "
                "identity matched; will not invent admin from postal text"
            ),
        }
        actions.append(row)
        unmatched.append(row)
        review_rows.append(
            {
                "postal_code": code,
                "region_mm": region_mm,
                "region_en": region_en,
                "township_mm": township_mm,
                "township_en": township_en,
                "locality_mm": locality_mm,
                "locality_en": locality_en,
                "candidate_admin_ids": "",
                "candidate_names": "",
                "candidate_types": "",
                "name_evidence": "no_exact_or_fuzzy",
                "recommended_action": "missing_or_non_inventory",
                "review_decision": "",
                "selected_local_admin_area_id": "",
                "review_note": row["reason"],
            }
        )
        status_counts["missing_local_area"] += 1

    # Valid-code action rows only for the 17297 accounting (exclude malformed from that set)
    valid_actions = [r for r in actions if r["status"] != "malformed_rejected"]
    # Deduplicate malformed rows to unique codes for summary clarity
    malformed_unique = sorted({r["postal_code"] for r in actions if r["status"] == "malformed_rejected"})

    actions_path = out_dir / "04-postal-actions.csv"
    review_path = out_dir / "04-postal-review.csv"
    unmatched_path = out_dir / "04-postal-unmatched.csv"
    summary_path = out_dir / "04-postal-summary.md"

    write_csv(actions_path, actions, ACTION_HEADERS)
    write_csv(review_path, review_rows, REVIEW_HEADERS)
    write_csv(unmatched_path, unmatched, ACTION_HEADERS)

    # Valid unique accounting
    valid_status = collections.Counter(r["status"] for r in valid_actions)
    linked_exact = valid_status.get("linked_exact_local_area", 0)
    unresolved = (
        valid_status.get("missing_local_area", 0)
        + valid_status.get("ambiguous_local_area", 0)
        + valid_status.get("linked_after_review", 0)
        + valid_status.get("non_admin_postal_locality", 0)
    )

    # Reason breakdown for unresolved
    reason_counts = collections.Counter(
        r.get("match_method") or r.get("reason", "")[:80]
        for r in valid_actions
        if r["status"] != "linked_exact_local_area"
    )

    lines = [
        "# Phase 4 — Postal ↔ approved local-admin (read-only)",
        "",
        f"**Generated:** {now_iso()}",
        f"**Postal ZIP:** `{args.postal_zip}`",
        f"**SHA256 zip:** `{hashes.get('zip', '')}`",
        f"**SHA256 EN:** `{hashes.get('en', '')}`",
        f"**SHA256 MY:** `{hashes.get('my', '')}`",
        "**Database writes:** none",
        "",
        "## Source checks (independent)",
        "",
        "| Check | Value | Expected | Pass |",
        "|---|---:|---:|---|",
        f"| Valid unique seven-digit codes | {source_checks['valid_unique']} | {EXPECTED_VALID} | {'yes' if source_checks['valid_unique_ok'] else 'no'} |",
        f"| Duplicate extra source rows (EN) | {source_checks['duplicate_extra_en']} | {EXPECTED_DUP_EXTRA} | {'yes' if source_checks['duplicate_extra_en'] == EXPECTED_DUP_EXTRA else 'no'} |",
        f"| Duplicate extra source rows (MY) | {source_checks['duplicate_extra_my']} | {EXPECTED_DUP_EXTRA} | {'yes' if source_checks['duplicate_extra_my'] == EXPECTED_DUP_EXTRA else 'no'} |",
        f"| Codes with duplicate rows | {source_checks['codes_with_duplicate_rows']} | {EXPECTED_DUP_EXTRA} | {'yes' if source_checks['codes_with_duplicate_rows'] == EXPECTED_DUP_EXTRA else 'no'} |",
        f"| Malformed codes | {source_checks['malformed']} | {sorted(EXPECTED_MALFORMED)} | {'yes' if source_checks['malformed_ok'] else 'no'} |",
        "",
        "## Phase 3 inventory used",
        "",
        f"- Core identities (linkable ids): **{inv_meta['counts'].get('core_identities', 0)}**",
        f"- Pending creates (name-only, no id): **{inv_meta['counts'].get('pending_creates', 0)}**",
        f"- Merge losers excluded: **{inv_meta['counts'].get('loser_ids_excluded', 0)}**",
        f"- Undecided Phase-3 locals skipped: **{inv_meta['counts'].get('undecided_keys', 0)}**",
        "",
        "## Matching rules",
        "",
        "1. Resolve approved CoreMap township from postal region + township names.",
        "2. Normalize Myanmar + English ward/village-tract locality names.",
        "3. Match **only inside that township** against Phase-3 approved inventory.",
        "4. Require **one exact** approved local-admin identity to auto-link.",
        "5. Fuzzy candidates → review only (`linked_after_review`); never auto-link.",
        "6. Never create an admin area from postal text alone.",
        "7. Never link by geographic proximity.",
        "",
        "## Status counts (valid codes)",
        "",
    ]
    for status, n in sorted(valid_status.items()):
        lines.append(f"- `{status}`: **{n}**")
    lines += [
        "",
        f"- Malformed rejected (unique codes, not in 17297): **{len(malformed_unique)}** → {malformed_unique}",
        f"- Valid actions rows: **{len(valid_actions)}** (expect {EXPECTED_VALID})",
        f"- Exact linked: **{linked_exact}**",
        f"- Unresolved / review / non-admin: **{unresolved}**",
        "",
        "## Unresolved reasons (match_method)",
        "",
    ]
    for method, n in reason_counts.most_common(30):
        lines.append(f"- `{method}`: **{n}**")
    lines += [
        "",
        "## Outputs",
        "",
        f"- `{actions_path.relative_to(REPO)}`",
        f"- `{review_path.relative_to(REPO)}` ({len(review_rows)} rows)",
        f"- `{unmatched_path.relative_to(REPO)}` ({len(unmatched)} rows)",
        "",
        "## Target gap",
        "",
        "- Final production target still requires human review for "
        f"**{valid_status.get('linked_after_review', 0)}** fuzzy + "
        f"**{valid_status.get('ambiguous_local_area', 0)}** ambiguous + "
        f"**{valid_status.get('missing_local_area', 0)}** missing "
        "(including exact matches to pending Phase-3 creates without ids).",
        "- No code was linked from proximity. No admin area was invented from postal text.",
        "",
    ]
    summary_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"Wrote {actions_path}")
    print(f"Wrote {review_path} ({len(review_rows)})")
    print(f"Wrote {unmatched_path} ({len(unmatched)})")
    print(f"Wrote {summary_path}")
    print("Status:", dict(valid_status))
    if len(valid_actions) != EXPECTED_VALID:
        print(f"WARNING: valid action rows={len(valid_actions)} expected {EXPECTED_VALID}")
        return 1
    if not source_checks["valid_unique_ok"] or not source_checks["malformed_ok"]:
        print("WARNING: source expectation checks failed")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
