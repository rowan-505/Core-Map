#!/usr/bin/env python3
"""Validate Phase7 v3 decisions and freeze final manifests (local only).

No production writes. Stops if any required gate fails.
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import psycopg

REPO = Path(__file__).resolve().parents[3]
V2 = REPO / "reports/admin-reconciliation-v2/phase7-completion-v2"
V3 = REPO / "reports/admin-reconciliation-v2/phase7-completion-v3"
OUT = V3
DB_URL = "postgresql://postgres:postgres@127.0.0.1:5433/coremap_phase7_v2"

csv.field_size_limit(min(2**31 - 1, 100_000_000))

FINAL_STATUSES = {
    "linked_exact",
    "linked_after_review",
    "confirmed_non_admin",
    "rejected_source_error",
}
WARD_VT = {"ward", "village_tract"}


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
        raise SystemExit(f"refusing to write empty CSV: {path}")
    fields = fields or list(rows[0].keys())
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({h: r.get(h, "") for h in fields})


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def compact_name(value: str) -> str:
    text = clean(value)
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text).casefold()
    suffixes = [
        r"\btownship\b",
        r"\btown\b",
        r"\bquarter\b",
        r"\bward\b",
        r"\bvillage[ -]?tract\b",
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


def is_uuid(value: str) -> bool:
    return bool(
        re.fullmatch(
            r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
            clean(value),
        )
    )


def fail(gate: str, detail: str, failures: list[str]) -> None:
    msg = f"GATE FAIL [{gate}]: {detail}"
    failures.append(msg)
    print(msg, file=sys.stderr)


def main() -> int:
    now = utc_now()
    failures: list[str] = []

    postal_v2 = load_csv(V2 / "postal/03-postal-actions-v2.csv")
    admin_v2 = load_csv(V2 / "frozen-v2/03-approved-local-admin.v2.csv")
    vill_v2 = load_csv(V2 / "frozen-v2/03-approved-villages.v2.csv")
    group_actions = load_csv(OUT / "02-postal-group-actions.csv")
    non_admin_audit = load_csv(OUT / "02-postal-non-admin-audit.csv")
    group_review = load_csv(OUT / "02-postal-group-review.csv")
    empty_vt = load_csv(OUT / "01-empty-pcode-vt-decision.csv")
    lar = json.loads((OUT / "02-postal-review-previews/linked_after_review_validation.json").read_text(encoding="utf-8"))

    if len(postal_v2) != 17297:
        fail("postal_count", f"expected 17297 rows, got {len(postal_v2)}", failures)

    # --- Decision completeness ---
    for label, rows in (
        ("admin_v2", admin_v2),
        ("village_v2", vill_v2),
        ("group_actions", group_actions),
        ("group_review", group_review),
        ("non_admin_audit", non_admin_audit),
    ):
        for i, r in enumerate(rows):
            action = clean(r.get("action") or r.get("review_decision") or r.get("audit_decision") or r.get("decision"))
            if not action:
                fail("blank_decision", f"{label} row {i} blank", failures)
            if action == "defer":
                fail("defer", f"{label} row {i} defer", failures)

    for r in empty_vt:
        if clean(r.get("decision")) in {"", "defer"}:
            fail("blank_decision", "empty-pcode VT decision blank/defer", failures)
        if clean(r.get("decision")) != "reject_source_error":
            fail("empty_pcode_vt", f"expected reject_source_error, got {r.get('decision')}", failures)

    # Admin/village: every row has exactly one action; creates have UUID public_id
    admin_actions_out = []
    seen_admin_keys = set()
    for r in admin_v2:
        item = dict(r)
        action = clean(item.get("action"))
        sk = clean(item.get("source_key")) or f"{item.get('source_entity_type')}:{item.get('source_pcode')}:row{item.get('source_row')}"
        if sk in seen_admin_keys:
            fail("admin_unique", f"duplicate source_key {sk}", failures)
        seen_admin_keys.add(sk)
        if not action:
            fail("blank_decision", f"admin {sk}", failures)
        if action == "defer":
            fail("defer", f"admin {sk}", failures)
        # Production manifest: identity via public_id for creates; never store disposable-only numeric as target
        if action == "create_mimu_placeholder":
            pid = clean(item.get("target_public_id"))
            if not is_uuid(pid):
                fail("create_public_id", f"admin create missing UUID public_id: {sk}", failures)
            # Do not persist matched_coremap_id for creates (would be disposable after dry-run)
            item["matched_coremap_id"] = ""
        # Strip any accidental numeric target_public_id
        if clean(item.get("target_public_id")) and not is_uuid(clean(item.get("target_public_id"))):
            if clean(item.get("target_public_id")).isdigit():
                fail("disposable_numeric", f"admin target_public_id numeric {sk}", failures)
        item["manifest_version"] = "v3"
        item["production_apply"] = "false"
        admin_actions_out.append(item)

    # Ensure empty-pcode reject present and sole reject for that key
    reject_keys = [r for r in admin_actions_out if clean(r.get("action")) == "reject_source_error"]
    if len(reject_keys) != 1 or "row12402" not in clean(reject_keys[0].get("source_key")):
        fail("empty_pcode_vt", f"expected single row12402 reject, got {len(reject_keys)}", failures)

    vill_actions_out = []
    seen_vill = set()
    for r in vill_v2:
        item = dict(r)
        action = clean(item.get("action"))
        sk = clean(item.get("source_key")) or f"village:{item.get('source_pcode')}:row{item.get('source_row')}"
        if sk in seen_vill:
            fail("village_unique", f"duplicate {sk}", failures)
        seen_vill.add(sk)
        if not action or action == "defer":
            fail("blank_decision" if not action else "defer", f"village {sk}", failures)
        if action == "create_mimu_placeholder":
            pid = clean(item.get("target_public_id"))
            if not is_uuid(pid):
                fail("create_public_id", f"village create missing UUID: {sk}", failures)
            item["matched_coremap_id"] = ""
        if clean(item.get("target_public_id")) and clean(item.get("target_public_id")).isdigit():
            fail("disposable_numeric", f"village numeric target_public_id {sk}", failures)
        item["manifest_version"] = "v3"
        item["production_apply"] = "false"
        vill_actions_out.append(item)

    # --- Index group actions / non-admin / LAR ---
    code_group: dict[str, dict] = {}
    for r in group_actions:
        for c in clean(r.get("postal_codes")).split(";"):
            c = c.strip()
            if c:
                code_group[c] = r

    na_link: dict[str, dict] = {}
    na_confirm: set[str] = set()
    for r in non_admin_audit:
        codes = [c.strip() for c in clean(r.get("postal_codes")).split(";") if c.strip()]
        if clean(r.get("audit_decision")) == "reclassify_as_official_local_area":
            pubs = [p for p in clean(r.get("coremap_candidate_public_ids")).split(";") if p]
            if len(pubs) != 1:
                fail("non_admin_reclassify", f"expected 1 public_id for {r.get('group_key')}", failures)
            for c in codes:
                na_link[c] = {**r, "selected_admin_public_id": pubs[0]}
        else:
            na_confirm.update(codes)

    valid_lar = set(lar.get("valid_postal_codes") or [])
    invalid_lar = {x["postal_code"] for x in (lar.get("invalid") or [])}

    # --- Load admin inventory for validation ---
    print("loading disposable admin inventory for validation...")
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT a.id, a.public_id::text, a.parent_id, p.public_id::text,
                       coalesce(t.code,''), l.code
                FROM core.core_admin_areas a
                JOIN ref.ref_admin_levels l ON l.id=a.admin_level_id
                LEFT JOIN ref.ref_admin_area_types t ON t.id=a.admin_area_type_id
                LEFT JOIN core.core_admin_areas p ON p.id=a.parent_id
                WHERE a.deleted_at IS NULL AND a.is_active
                """
            )
            admin_rows = cur.fetchall()
            cur.execute(
                """
                SELECT n.admin_area_id, n.name, coalesce(n.language_code,''), n.name_type, n.is_primary
                FROM core.core_admin_area_names n
                """
            )
            name_rows = cur.fetchall()

    by_pub: dict[str, dict] = {}
    by_core: dict[str, dict] = {}
    for aid, pub, parent_id, parent_pub, typ, level in admin_rows:
        rec = {
            "core_id": str(aid),
            "public_id": pub,
            "parent_id": str(parent_id) if parent_id is not None else "",
            "parent_public_id": parent_pub or "",
            "typ": typ or "",
            "level": level or "",
            "names_mm": set(),
            "names_en": set(),
            "primary_mm": "",
            "primary_en": "",
            "alias_mm": set(),
            "alias_en": set(),
        }
        by_pub[pub] = rec
        by_core[str(aid)] = rec

    for aid, name, lang, ntype, is_pri in name_rows:
        rec = by_core.get(str(aid))
        if not rec:
            continue
        name = clean(name)
        lang = clean(lang).lower()
        ntype = clean(ntype).lower()
        is_alias = ntype in {"alias", "alternate", "imported"} or not is_pri
        if lang in {"my", "mm"}:
            rec["names_mm"].add(compact_name(name))
            if is_pri and not rec["primary_mm"]:
                rec["primary_mm"] = name
            elif is_alias:
                rec["alias_mm"].add(name)
        elif lang == "en":
            rec["names_en"].add(compact_name(name))
            if is_pri and not rec["primary_en"]:
                rec["primary_en"] = name
            elif is_alias:
                rec["alias_en"].add(name)

    # Map frozen create public_ids from admin manifest (may not all be in DB if naming differs — they should be after v2 apply)
    frozen_pub_parent: dict[str, str] = {}
    frozen_pub_type: dict[str, str] = {}
    for r in admin_actions_out:
        pid = clean(r.get("target_public_id"))
        if is_uuid(pid):
            frozen_pub_parent[pid] = clean(r.get("parent_public_id"))
            frozen_pub_type[pid] = clean(r.get("admin_type") or r.get("source_entity_type"))

    def resolve_pub_from_core(core_id: str) -> str:
        rec = by_core.get(clean(core_id))
        return rec["public_id"] if rec else ""

    def admin_meta(pub: str) -> dict | None:
        if pub in by_pub:
            return by_pub[pub]
        # Fallback to frozen manifest metadata only for type/parent checks
        if pub in frozen_pub_type:
            return {
                "public_id": pub,
                "parent_public_id": frozen_pub_parent.get(pub, ""),
                "parent_id": "",
                "typ": frozen_pub_type.get(pub, ""),
                "level": "ward_village_tract",
                "names_mm": set(),
                "names_en": set(),
                "primary_mm": "",
                "primary_en": "",
                "alias_mm": set(),
                "alias_en": set(),
                "from_frozen_only": True,
            }
        return None

    # Township public_id helpers from postal row
    def township_public_for(row: dict, selected_pub: str = "") -> str:
        tp = clean(row.get("matched_township_public_id"))
        if is_uuid(tp):
            return tp
        tid = clean(row.get("matched_township_id"))
        if tid and tid in by_core:
            return by_core[tid]["public_id"]
        # Infer from selected admin parent
        if selected_pub:
            meta = admin_meta(selected_pub)
            if meta and meta.get("parent_public_id"):
                return meta["parent_public_id"]
        return ""

    # --- Build postal v3 + aliases ---
    postal_out: list[dict] = []
    alias_out: list[dict] = []
    alias_keys: set[tuple[str, str, str]] = set()  # public_id, lang, compact_name
    status_counts: Counter = Counter()
    method_counts: Counter = Counter()

    # Seed existing aliases to avoid duplicates
    for pub, rec in by_pub.items():
        for name in rec["alias_mm"]:
            alias_keys.add((pub, "my", compact_name(name)))
        for name in rec["alias_en"]:
            alias_keys.add((pub, "en", compact_name(name)))
        if rec["primary_mm"]:
            alias_keys.add((pub, "my", compact_name(rec["primary_mm"])))
        if rec["primary_en"]:
            alias_keys.add((pub, "en", compact_name(rec["primary_en"])))

    def add_alias(pub: str, name: str, lang: str, postal_code: str, note: str) -> None:
        name = clean(name)
        if not name or not is_uuid(pub):
            return
        cn = compact_name(name)
        if not cn:
            return
        key = (pub, lang, cn)
        if key in alias_keys:
            return
        meta = admin_meta(pub)
        if not meta:
            fail("alias_target", f"alias target missing {pub} for {postal_code}", failures)
            return
        # Never replace primary
        if lang == "my" and cn == compact_name(meta.get("primary_mm") or ""):
            return
        if lang == "en" and cn == compact_name(meta.get("primary_en") or ""):
            return
        alias_keys.add(key)
        alias_out.append(
            {
                "admin_public_id": pub,
                "admin_core_id_reference_only": meta.get("core_id", ""),  # documentation; not a production write key
                "language_code": lang,
                "alias_name": name,
                "normalized_alias": cn,
                "preserve_primary": "true",
                "replace_primary": "false",
                "source_postal_code": postal_code,
                "reason": note,
                "manifest_version": "v3",
                "production_apply": "false",
            }
        )
        # Do not store disposable numeric in production-facing alias identity
        if alias_out[-1]["admin_core_id_reference_only"] and not meta.get("from_frozen_only"):
            # Keep reference_only empty in frozen production manifest per rule
            alias_out[-1]["admin_core_id_reference_only"] = ""

    seen_codes: set[str] = set()
    for r in postal_v2:
        code = clean(r.get("postal_code"))
        if not code:
            fail("postal_code", "blank postal_code", failures)
            continue
        if code in seen_codes:
            fail("postal_unique", f"duplicate postal_code {code}", failures)
        seen_codes.add(code)

        v2_status = clean(r.get("v2_status"))
        loc_en = clean(r.get("locality_en"))
        loc_mm = clean(r.get("locality_mm"))
        loc_type = clean(r.get("inferred_locality_type"))

        final_status = ""
        selected_pub = ""
        local_area_id = ""  # production manifest: prefer null unless keep_existing known production id — we omit disposable
        match_method = clean(r.get("match_method"))
        reason = clean(r.get("v2_reason") or r.get("reason"))
        township_pub = clean(r.get("matched_township_public_id"))

        if v2_status == "linked_exact_local_area":
            final_status = "linked_exact"
            selected_pub = clean(r.get("matched_local_admin_public_id"))
            if not selected_pub:
                # resolve from production-baseline core id (not disposable insert)
                core_id = clean(r.get("matched_local_admin_area_id"))
                selected_pub = resolve_pub_from_core(core_id)
            if not is_uuid(selected_pub):
                fail("linked_public_id", f"{code} linked_exact missing admin public_id", failures)
            # Do not persist numeric local_admin_area_id into frozen production postal manifest
            local_area_id = ""
            if not township_pub:
                township_pub = township_public_for(r, selected_pub)

        elif v2_status == "linked_after_review":
            if code in valid_lar:
                final_status = "linked_after_review"
                selected_pub = clean(r.get("matched_local_admin_public_id"))
                if not is_uuid(selected_pub):
                    fail("linked_public_id", f"{code} valid LAR missing public_id", failures)
                local_area_id = ""
                reason = clean(r.get("v2_reason")) or "validated linked_after_review"
                match_method = "linked_after_review_validated"
                if not township_pub:
                    township_pub = township_public_for(r, selected_pub)
            else:
                g = code_group.get(code)
                if not g:
                    fail("lar_invalid", f"{code} invalid LAR without group action", failures)
                    continue
                action = clean(g.get("action"))
                selected_pub = clean(g.get("selected_admin_public_id"))
                if action == "link_existing":
                    final_status = "linked_after_review"
                    match_method = "v3_rematch_link_existing"
                    reason = clean(g.get("reason"))
                elif action == "add_alias_and_link":
                    final_status = "linked_after_review"
                    match_method = "v3_add_alias_and_link"
                    reason = clean(g.get("reason"))
                    add_alias(selected_pub, clean(g.get("proposed_alias_mm")), "my", code, "v3 proposed alias mm")
                    add_alias(selected_pub, clean(g.get("proposed_alias_en")), "en", code, "v3 proposed alias en")
                elif action == "confirmed_non_admin":
                    final_status = "confirmed_non_admin"
                    selected_pub = ""
                    match_method = "v3_confirmed_non_admin"
                    reason = clean(g.get("reason"))
                elif action == "source_error":
                    final_status = "rejected_source_error"
                    selected_pub = ""
                    match_method = "v3_source_error"
                    reason = clean(g.get("reason"))
                else:
                    fail("blank_decision", f"{code} bad LAR rematch action {action}", failures)
                    continue
                if final_status.startswith("linked") and not is_uuid(selected_pub):
                    fail("linked_public_id", f"{code} rematch link missing public_id", failures)
                if not township_pub:
                    township_pub = clean(g.get("township_public_id")) or township_public_for(r, selected_pub)

        elif v2_status == "non_admin_postal_locality":
            if code in na_link:
                final_status = "linked_after_review"
                selected_pub = clean(na_link[code]["selected_admin_public_id"])
                match_method = "v3_non_admin_reclassify_link"
                reason = clean(na_link[code].get("audit_note"))
                if not is_uuid(selected_pub):
                    fail("linked_public_id", f"{code} reclassify missing public_id", failures)
                if not township_pub:
                    township_pub = clean(na_link[code].get("resolved_township_public_id")) or township_public_for(
                        r, selected_pub
                    )
            else:
                final_status = "confirmed_non_admin"
                selected_pub = ""
                local_area_id = ""
                match_method = "v3_confirmed_non_admin"
                reason = "town-labeled / non-admin postal locality confirmed"

        elif v2_status in {"missing_local_admin_identity", "ambiguous_local_area"}:
            g = code_group.get(code)
            if not g:
                fail("missing_coverage", f"{code} {v2_status} has no group action", failures)
                continue
            action = clean(g.get("action"))
            selected_pub = clean(g.get("selected_admin_public_id"))
            if action == "link_existing":
                final_status = "linked_after_review"
                match_method = "v3_rematch_link_existing"
                reason = clean(g.get("reason"))
            elif action == "add_alias_and_link":
                final_status = "linked_after_review"
                match_method = "v3_add_alias_and_link"
                reason = clean(g.get("reason"))
                add_alias(selected_pub, clean(g.get("proposed_alias_mm")), "my", code, "v3 proposed alias mm")
                add_alias(selected_pub, clean(g.get("proposed_alias_en")), "en", code, "v3 proposed alias en")
            elif action == "confirmed_non_admin":
                final_status = "confirmed_non_admin"
                selected_pub = ""
                match_method = "v3_confirmed_non_admin"
                reason = clean(g.get("reason"))
            elif action == "source_error":
                final_status = "rejected_source_error"
                selected_pub = ""
                match_method = "v3_source_error"
                reason = clean(g.get("reason"))
            elif action in {"", "defer"}:
                fail("blank_decision" if not action else "defer", f"{code}", failures)
                continue
            else:
                fail("blank_decision", f"{code} unknown action {action}", failures)
                continue
            if final_status.startswith("linked") and not is_uuid(selected_pub):
                fail("linked_public_id", f"{code} missing public_id", failures)
            if not township_pub:
                township_pub = clean(g.get("township_public_id")) or township_public_for(r, selected_pub)
        else:
            fail("postal_status", f"{code} unexpected v2_status {v2_status}", failures)
            continue

        # Validate linked rows
        if final_status in {"linked_exact", "linked_after_review"}:
            meta = admin_meta(selected_pub)
            if not meta:
                fail("linked_admin_exists", f"{code} admin public_id not found: {selected_pub}", failures)
            else:
                typ = clean(meta.get("typ"))
                if typ not in WARD_VT and clean(meta.get("level")) != "ward_village_tract":
                    fail("linked_type", f"{code} selected type {typ!r} not ward/village_tract", failures)
                # Township membership
                parent_pub = clean(meta.get("parent_public_id"))
                if township_pub and parent_pub and township_pub != parent_pub:
                    # Allow town parent: if selected parent is town, compare township via town's parent
                    parent_rec = by_pub.get(parent_pub)
                    if parent_rec and parent_rec.get("level") == "town":
                        if parent_rec.get("parent_public_id") and parent_rec["parent_public_id"] != township_pub:
                            # also allow township_pub == town itself when postal parent was town-resolved
                            if township_pub != parent_pub:
                                fail(
                                    "township_membership",
                                    f"{code} admin parent {parent_pub} not in township {township_pub}",
                                    failures,
                                )
                    elif township_pub != parent_pub:
                        fail(
                            "township_membership",
                            f"{code} admin parent {parent_pub} != township {township_pub}",
                            failures,
                        )
                # Propose aliases for proven alternate postal spellings (do not replace primary)
                if loc_mm and compact_name(loc_mm) not in (meta.get("names_mm") or set()):
                    # only if unique link already proven — add as alias proposal
                    add_alias(selected_pub, loc_mm, "my", code, "postal MM spelling not in primary/alias set")
                if loc_en and compact_name(loc_en) not in (meta.get("names_en") or set()):
                    add_alias(selected_pub, loc_en, "en", code, "postal EN spelling not in primary/alias set")

        if final_status == "confirmed_non_admin":
            if local_area_id or selected_pub:
                # force nulls
                local_area_id = ""
                selected_pub = ""

        if final_status not in FINAL_STATUSES:
            fail("final_status", f"{code} bad final status {final_status}", failures)

        # Forbidden residual statuses/methods
        if final_status in {"missing_local_admin_identity", "ambiguous_local_area"}:
            fail("missing_local_admin_identity", f"{code} still missing/ambiguous", failures)
        if "township_unresolved" in match_method:
            fail("township_unresolved", f"{code} method {match_method}", failures)
        if match_method == "exact_pending_create":
            fail("exact_pending_create", f"{code}", failures)

        # No postal-text-only admin creation marker
        if "invent" in reason.casefold() and "do not invent" not in reason.casefold():
            fail("no_postal_invent", f"{code} suspicious invent reason", failures)

        status_counts[final_status] += 1
        method_counts[match_method] += 1

        postal_out.append(
            {
                "postal_code": code,
                "status": final_status,
                "region_mm": clean(r.get("region_mm")),
                "region_en": clean(r.get("region_en")),
                "township_mm": clean(r.get("township_mm")),
                "township_en": clean(r.get("township_en")),
                "locality_mm": loc_mm,
                "locality_en": loc_en,
                "inferred_locality_type": loc_type,
                "matched_township_public_id": township_pub if is_uuid(township_pub) else "",
                # Explicitly no disposable/production numeric township id in frozen v3 postal manifest
                "matched_township_id": "",
                "matched_local_admin_public_id": selected_pub if final_status.startswith("linked") else "",
                "matched_local_admin_area_id": "",  # always null in frozen v3; resolve via public_id at apply
                "name_evidence": clean(r.get("name_evidence")),
                "match_method": match_method,
                "reason": reason,
                "v2_status": v2_status,
                "manifest_version": "v3",
                "production_apply": "false",
                "preserve_existing_geom": "true",
            }
        )

    # --- Gates ---
    total = sum(status_counts.values())
    arith = (
        status_counts["linked_exact"]
        + status_counts["linked_after_review"]
        + status_counts["confirmed_non_admin"]
        + status_counts["rejected_source_error"]
    )
    if total != 17297 or arith != 17297:
        fail("arithmetic", f"sum={arith} total={total} counts={dict(status_counts)}", failures)

    if status_counts.get("missing_local_admin_identity", 0) != 0:
        fail("missing_local_admin_identity", f"count={status_counts['missing_local_admin_identity']}", failures)
    # ensure none slipped into postal status field
    bad_status = [p for p in postal_out if p["status"] in {"missing_local_admin_identity", "ambiguous_local_area"}]
    if bad_status:
        fail("ambiguous_local_area", f"{len(bad_status)} residual missing/ambiguous statuses", failures)

    if any("township_unresolved" in p["match_method"] for p in postal_out):
        fail("township_unresolved", "residual township_unresolved methods", failures)
    if any(p["match_method"] == "exact_pending_create" for p in postal_out):
        fail("exact_pending_create", "residual exact_pending_create", failures)

    if any(not clean(p["status"]) or p["status"] == "defer" for p in postal_out):
        fail("blank/defer", "postal blank/defer remain", failures)

    # confirmed non-admin null ids
    for p in postal_out:
        if p["status"] == "confirmed_non_admin":
            if p["matched_local_admin_area_id"] or p["matched_local_admin_public_id"]:
                fail("non_admin_null", f"{p['postal_code']} non-admin has local admin id", failures)

    # linked rows one public_id
    for p in postal_out:
        if p["status"] in {"linked_exact", "linked_after_review"}:
            if not is_uuid(p["matched_local_admin_public_id"]):
                fail("linked_public_id", f"{p['postal_code']} missing public_id", failures)

    # No disposable numeric IDs in frozen outputs
    for rows, label in (
        (admin_actions_out, "admin"),
        (vill_actions_out, "village"),
        (postal_out, "postal"),
        (alias_out, "alias"),
    ):
        for r in rows:
            for k, v in r.items():
                if k.endswith("_public_id") or k == "admin_public_id" or k == "target_public_id":
                    continue
                if k in {"matched_township_id", "matched_local_admin_area_id", "matched_coremap_id", "approved_township_id"}:
                    # admin/village may retain baseline production numeric refs for apply planning,
                    # but postal/alias must not.
                    if label in {"postal", "alias"} and clean(v) and clean(v).isdigit():
                        fail("disposable_numeric", f"{label} {k}={v}", failures)

    # Postal must not invent admin creates
    if any(p["status"] == "create_mimu_placeholder" for p in postal_out):
        fail("no_postal_invent", "postal status invents admin", failures)

    # Alias integrity: no duplicate keys, no primary replacement
    if len(alias_out) != len({(a["admin_public_id"], a["language_code"], a["normalized_alias"]) for a in alias_out}):
        fail("alias_duplicate", "duplicate alias rows", failures)
    if any(a.get("replace_primary") == "true" for a in alias_out):
        fail("alias_primary", "alias replaces primary", failures)

    # Review blank/defer already checked; also group_review
    if any(clean(r.get("review_decision")) in {"", "defer"} for r in group_review):
        fail("blank/defer", "group review blank/defer", failures)

    gate_results = {
        "missing_local_admin_identity": 0,
        "ambiguous_local_area": 0,
        "township_unresolved": 0,
        "exact_pending_create": 0,
        "blank/defer": 0,
        "arithmetic_17297": arith,
        "linked_exact": status_counts["linked_exact"],
        "linked_after_review": status_counts["linked_after_review"],
        "confirmed_non_admin": status_counts["confirmed_non_admin"],
        "rejected_source_error": status_counts["rejected_source_error"],
    }

    if failures:
        summary_fail = OUT / "03-final-status-summary.md"
        summary_fail.write_text(
            "# 03 Final status summary — GATES FAILED\n\n"
            + f"Generated: `{now}`\n\n"
            + "## Failures\n\n"
            + "\n".join(f"- {f}" for f in failures)
            + "\n",
            encoding="utf-8",
        )
        print(f"Stopped: {len(failures)} gate failure(s). Summary: {summary_fail}")
        return 1

    # --- Write manifests ---
    write_csv(OUT / "03-admin-actions-v3.csv", admin_actions_out)
    write_csv(OUT / "03-village-actions-v3.csv", vill_actions_out)
    # Alias CSV always written (may be empty header-only if none — but write_csv forbids empty).
    if not alias_out:
        alias_out = [
            {
                "admin_public_id": "",
                "admin_core_id_reference_only": "",
                "language_code": "",
                "alias_name": "",
                "normalized_alias": "",
                "preserve_primary": "true",
                "replace_primary": "false",
                "source_postal_code": "",
                "reason": "no_alias_actions_required",
                "manifest_version": "v3",
                "production_apply": "false",
            }
        ]
        # Remove placeholder if we want truly empty — user expects file; use marker row then filter?
        # Better: write header with zero data rows manually
        path = OUT / "03-admin-alias-actions-v3.csv"
        fields = [
            "admin_public_id",
            "language_code",
            "alias_name",
            "normalized_alias",
            "preserve_primary",
            "replace_primary",
            "source_postal_code",
            "reason",
            "manifest_version",
            "production_apply",
        ]
        path.write_text(",".join(fields) + "\n", encoding="utf-8")
        alias_count = 0
    else:
        # Drop core id column entirely from production alias manifest
        alias_write = []
        for a in alias_out:
            alias_write.append(
                {
                    "admin_public_id": a["admin_public_id"],
                    "language_code": a["language_code"],
                    "alias_name": a["alias_name"],
                    "normalized_alias": a["normalized_alias"],
                    "preserve_primary": "true",
                    "replace_primary": "false",
                    "source_postal_code": a["source_postal_code"],
                    "reason": a["reason"],
                    "manifest_version": "v3",
                    "production_apply": "false",
                }
            )
        write_csv(OUT / "03-admin-alias-actions-v3.csv", alias_write)
        alias_count = len(alias_write)

    write_csv(OUT / "03-postal-actions-v3.csv", postal_out)

    checksum_files = [
        "03-admin-actions-v3.csv",
        "03-village-actions-v3.csv",
        "03-admin-alias-actions-v3.csv",
        "03-postal-actions-v3.csv",
    ]
    checksums = {
        "generated_at": now,
        "git_commit": "",
        "files": {},
        "postal_status_counts": dict(status_counts),
        "gates": gate_results,
        "production_touched": False,
    }
    try:
        import subprocess

        checksums["git_commit"] = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=str(REPO), text=True
        ).strip()
    except Exception:
        checksums["git_commit"] = ""

    for rel in checksum_files:
        p = OUT / rel
        checksums["files"][rel] = {"sha256": sha256_file(p), "bytes": p.stat().st_size}

    (OUT / "checksums").mkdir(parents=True, exist_ok=True)
    (OUT / "checksums/03-v3-frozen-manifest.checksums.json").write_text(
        json.dumps(checksums, indent=2), encoding="utf-8"
    )

    summary = f"""# 03 Final status summary (Phase7 completion-v3)

Generated: `{now}`  
Production: **not touched**  
Production apply: **not generated**

## Postal arithmetic

| Status | Count |
|---|---:|
| `linked_exact` | {status_counts['linked_exact']} |
| `linked_after_review` | {status_counts['linked_after_review']} |
| `confirmed_non_admin` | {status_counts['confirmed_non_admin']} |
| `rejected_source_error` | {status_counts['rejected_source_error']} |
| **Sum** | **{arith}** |

Required: `linked_exact + linked_after_review + confirmed_non_admin + rejected_source_error = 17297` → **PASS**

## Gates

| Gate | Value | Result |
|---|---:|---|
| missing_local_admin_identity | 0 | PASS |
| ambiguous_local_area | 0 | PASS |
| township_unresolved | 0 | PASS |
| exact_pending_create | 0 | PASS |
| blank/defer | 0 | PASS |

## Admin / village

| Manifest | Rows |
|---|---:|
| `03-admin-actions-v3.csv` | {len(admin_actions_out)} |
| `03-village-actions-v3.csv` | {len(vill_actions_out)} |
| `03-admin-alias-actions-v3.csv` | {alias_count} |
| `03-postal-actions-v3.csv` | {len(postal_out)} |

- Every admin/village row has exactly one action (no blank/defer).
- Empty-PCode Pangsang VT remains `reject_source_error` (not created from postal text).
- Creates use frozen UUID `target_public_id` only (no disposable numeric target id).
- Postal linked rows reference exactly one admin `public_id`; type ward/village_tract; township parent checked.
- Confirmed non-admin rows have null `matched_local_admin_area_id` and null `matched_local_admin_public_id`.
- Alias actions preserve primary names; duplicates suppressed.

## Checksums

See `checksums/03-v3-frozen-manifest.checksums.json`.
"""
    (OUT / "03-final-status-summary.md").write_text(summary, encoding="utf-8")

    print("PASS")
    print(dict(status_counts), "sum", arith)
    print("aliases", alias_count)
    print("wrote manifests under", OUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
