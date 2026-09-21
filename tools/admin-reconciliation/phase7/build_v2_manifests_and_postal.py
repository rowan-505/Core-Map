#!/usr/bin/env python3
"""Build Phase 7 completion-v2 release artifacts (no production writes).

Approvals applied:
  - Pangsang create_missing_township_placeholder (frozen public_id)
  - 4 ward merges approved
  - match_existing / create_new reopen decisions + 189128→match_existing
  - Ma Har Myaing as two distinct wards (shared PCode defect)

Outputs under reports/admin-reconciliation-v2/phase7-completion-v2/:
  frozen-v2/*, postal/*, import/*, decisions/04-approvals.json, checksums/*
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
import unicodedata
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "reports/admin-reconciliation-v2/phase7-completion-v2"
FROZEN = REPO / "reports/admin-reconciliation-v2/phase3-frozen"
PREVIEWS = REPO / "reports/admin-reconciliation-v2/phase3-previews"
PANG = json.loads((OUT / "decisions/01-pangsang-township-freeze.json").read_text(encoding="utf-8"))

csv.field_size_limit(min(2**31 - 1, 100_000_000))


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def clean(v) -> str:
    return "" if v is None else str(v).strip()


def load_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_csv(path: Path, rows: list[dict], fields: list[str] | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows and not fields:
        path.write_text("", encoding="utf-8")
        return
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


def compact_name(value: str, level: str = "") -> str:
    text = clean(value)
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text).casefold()
    text = text.replace("nay pyi taw", "naypyitaw").replace("ayeyawady", "ayeyarwady")
    text = text.replace("irrawaddy", "ayeyarwady")
    suffixes = [
        r"\bunion territory\b", r"\bstate\b", r"\bregion\b", r"\bdistrict\b",
        r"\btownship\b", r"\btown\b", r"\bquarter\b", r"\bward\b",
        r"\bvillage[ -]?tract\b", r"\bself[ -]?administered (?:zone|division)\b",
        "ပြည်ထောင်စုနယ်မြေ", "တိုင်းဒေသကြီး", "ပြည်နယ်", "ခရိုင်", "မြို့နယ်",
        "ကျေးရွာအုပ်စု", "ရပ်ကွက်", "မြို့",
    ]
    for suffix in suffixes:
        text = re.sub(suffix, " ", text)
    text = re.sub(r"\b(?:no|number)\s*[.(]?\s*([0-9]+)\s*[).]?", r"\1", text)
    text = text.replace("အမှတ်", "")
    text = re.sub(r"[^0-9a-z\u1000-\u109f\uaa60-\uaa7f\ua9e0-\ua9ff]+", "", text)
    return text


def source_key(row: dict) -> str:
    entity = clean(row.get("source_entity_type"))
    pcode = clean(row.get("source_pcode")) or "nopcode"
    srow = clean(row.get("source_row"))
    safe_file = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(clean(row.get("source_file"))).name)[:80]
    return f"{entity}:{pcode}:row{srow}:{safe_file}"


def new_uuid() -> str:
    return str(uuid.uuid4())


def slug_for(name_en: str, sk: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", (name_en or "area").casefold()).strip("-") or "area"
    digest = hashlib.sha1(sk.encode()).hexdigest()[:10]
    return f"coremap:v2:{base[:48]}:{digest}"


def looks_non_admin(locality_en: str, locality_mm: str) -> bool:
    joined = f"{locality_en} {locality_mm}".casefold()
    if any(x in joined for x in ("quarter", "ward", "village tract", "village-tract")):
        return False
    if "ရပ်ကွက်" in locality_mm or "ကျေးရွာအုပ်စု" in locality_mm:
        return False
    markers = (
        "industrial zone", "market", "airport", "university", "hospital", "camp",
        "base", "port", "station", "ဆိပ်ကမ်း", "ဈေး", "လေဆိပ်", "town", "မြို့",
    )
    return any(m in joined for m in markers) or (not clean(locality_en) and not clean(locality_mm))


def record_approvals() -> dict:
    approvals = {
        "approved_at": utc_now(),
        "pangsang": {
            "decision": "create_missing_township_placeholder",
            "target_public_id": PANG["target_public_id"],
            "target_slug": PANG["target_slug"],
            "parent_public_id": PANG["parent_public_id"],
        },
        "merges_approved": [
            {"source_pcode": "MMR013018701526", "survivor": 5182, "loser": 5183},
            {"source_pcode": "MMR013018701525", "survivor": 5185, "loser": 5186},
            {"source_pcode": "MMR007008701505", "survivor": 5891, "loser": 5897},
            {"source_pcode": "MMR010018701504", "survivor": 6907, "loser": 6908},
        ],
        "ward_match_existing": [
            {"source_pcode": "MMR018002701509", "source_row": "1574", "match_id": 6023},
            {"source_pcode": "MMR013029701504", "source_row": "1840", "match_id": 5119},
            {"source_pcode": "MMR005011701503", "source_row": "1589", "match_id": 6797},
            {"source_pcode": "MMR005011701503", "source_row": "1611", "match_id": 6794},
        ],
        "village_match_existing": [
            {"source_pcode": "189255", "match_id": 170019},
            {"source_pcode": "189131", "match_id": 169993},
            {"source_pcode": "189128", "match_id": 169991, "note": "flipped from create_new after hard-check safe match"},
        ],
        "village_create_new": ["189254", "176854", "219883", "209771", "209638", "201878"],
        "ma_har_myaing": "potentially_distinct_wards_shared_pcode",
    }
    path = OUT / "decisions/04-approvals.json"
    path.write_text(json.dumps(approvals, indent=2, ensure_ascii=False), encoding="utf-8")
    return approvals


def build_admin_manifest(approvals: dict) -> tuple[list[dict], dict]:
    rows = load_csv(FROZEN / "03-approved-local-admin.csv")
    used_public: set[str] = set()
    used_slug: set[str] = set()

    # Seed with known existing public_ids from keep/update rows
    for r in rows:
        pid = clean(r.get("matched_public_id"))
        if pid:
            used_public.add(pid)

    used_public.add(PANG["target_public_id"])
    used_slug.add(PANG["target_slug"])
    used_public.add(PANG["parent_public_id"])

    def alloc_ids(row: dict) -> tuple[str, str]:
        sk = source_key(row)
        while True:
            pid = new_uuid()
            if pid not in used_public:
                break
        used_public.add(pid)
        slug = slug_for(clean(row.get("source_name_en")), sk)
        base = slug
        n = 2
        while slug in used_slug:
            slug = f"{base}-v{n}"
            n += 1
        used_slug.add(slug)
        return pid, slug

    merge_by_pcode = {m["source_pcode"]: m for m in approvals["merges_approved"]}
    match_ward = {(m["source_pcode"], m["source_row"]): m for m in approvals["ward_match_existing"]}

    # Index public_ids for known match targets — leave matched_public_id if already set;
    # for reopen we set matched_coremap_id and clear create.

    out: list[dict] = []

    # Township create first (synthetic row)
    township_row = {
        "source_entity_type": "township",
        "source_pcode": "MMR015005",
        "source_name_en": "Pangsang (Panghkam)",
        "source_name_my": "ပန်ဆန်း (ပန်ခမ်း)",
        "source_region": "Shan (North)",
        "source_ts_pcode": "MMR015005",
        "source_ts_name": "Pangsang (Panghkam)",
        "source_st_name": "Shan (North)",
        "source_parent_path": "Shan (North) > Matman > Pangsang (Panghkam)",
        "source_file": "township_boundary_mimu_v94",
        "source_row": "0",
        "approved_township_id": "",  # parent is district
        "matched_coremap_id": "",
        "matched_public_id": "",
        "matched_canonical_name": "",
        "matched_type": "",
        "matched_parent_id": str(PANG["parent_core_id"]),
        "action": "create_mimu_placeholder",
        "confidence": "100",
        "preserve_existing_geom": "true",
        "name_evidence": "approved_create_missing_township",
        "spatial_evidence": "mimu_township_geom",
        "candidate_coremap_ids": "",
        "manual_review_reason": "",
        "review_notes": "Approved Phase7 completion-v2: create_missing_township_placeholder; never merge 6484",
        "review_decision": "create_new",
        "review_note": "approved",
        "losing_core_ids": "",
        "name_source": "mimu",
        "geometry_policy": "mimu_placeholder",
        "merge_losing_core_ids": "",
        "merge_source_key": "",
        "source_key": "township:MMR015005:row0:township_boundary_mimu_v94",
        "target_public_id": PANG["target_public_id"],
        "target_slug": PANG["target_slug"],
        "parent_public_id": PANG["parent_public_id"],
        "admin_level": "township",
        "admin_type": "township",
        "is_public_usable": "false",
        "boundary_status": "approximate",
        "is_official_boundary": "false",
        "verification_status": "needs_fix",
        "geometry_source": "mimu_placeholder",
        "source_license_status": "permission_pending",
        "store_pcode_as_external_id": "false",
        "pcode_audit_key": "MMR015005",
    }
    out.append(township_row)

    for r in rows:
        item = dict(r)
        sk = source_key(r)
        item["source_key"] = sk
        action = clean(r.get("action"))
        pcode = clean(r.get("source_pcode"))
        srow = clean(r.get("source_row"))

        # Pangsang children: attach to new township
        if clean(r.get("source_ts_pcode")) == "MMR015005" and action == "create_mimu_placeholder":
            item["approved_township_id"] = ""  # resolve via parent_public_id at runtime
            item["parent_public_id"] = PANG["target_public_id"]
            item["review_notes"] = (clean(r.get("review_notes")) + " | parent→frozen Pangsang township").strip(" |")

        # Reopen merges
        if pcode in merge_by_pcode and action == "reject_source_error":
            m = merge_by_pcode[pcode]
            item["action"] = "merge_duplicate_candidate"
            item["matched_coremap_id"] = str(m["survivor"])
            item["losing_core_ids"] = str(m["loser"])
            item["merge_losing_core_ids"] = str(m["loser"])
            item["review_decision"] = "merge_confirmed_duplicate"
            item["review_note"] = "approved Phase7 completion-v2"
            action = item["action"]

        # Reopen match_existing wards (including both Ma Har rows)
        key = (pcode, srow)
        if key in match_ward and clean(r.get("action")) == "reject_source_error":
            m = match_ward[key]
            item["action"] = "keep_existing"
            item["matched_coremap_id"] = str(m["match_id"])
            item["review_decision"] = "match_existing"
            item["review_note"] = "approved Phase7 completion-v2 hard-check pass"
            action = item["action"]

        # Freeze public_id for creates
        if action == "create_mimu_placeholder":
            if clean(r.get("source_ts_pcode")) == "MMR015005" or True:
                pid, slug = alloc_ids(item)
                item["target_public_id"] = pid
                item["target_slug"] = slug
                item["admin_level"] = "ward_village_tract"
                item["admin_type"] = clean(r.get("source_entity_type")) or "village_tract"
                item["is_public_usable"] = "false"
                item["boundary_status"] = "approximate"
                item["is_official_boundary"] = "false"
                item["verification_status"] = "needs_fix"
                item["geometry_source"] = "mimu_placeholder"
                item["source_license_status"] = "permission_pending"
                item["store_pcode_as_external_id"] = "false"
                item["pcode_audit_key"] = pcode
                if not clean(item.get("parent_public_id")):
                    # existing township numeric id remains; public_id resolved at runtime
                    item["parent_public_id"] = ""
                    item["parent_core_id"] = clean(item.get("approved_township_id"))

        out.append(item)

    # Uniqueness gates
    pubs = [clean(r.get("target_public_id")) for r in out if clean(r.get("target_public_id"))]
    slugs = [clean(r.get("target_slug")) for r in out if clean(r.get("target_slug"))]
    assert len(pubs) == len(set(pubs)), "duplicate target_public_id"
    assert len(slugs) == len(set(slugs)), "duplicate target_slug"

    meta = {
        "admin_rows": len(out),
        "township_creates": sum(1 for r in out if r.get("source_entity_type") == "township" and r.get("action") == "create_mimu_placeholder"),
        "wvt_creates": sum(1 for r in out if r.get("action") == "create_mimu_placeholder" and r.get("source_entity_type") != "township"),
        "merges": sum(1 for r in out if r.get("action") == "merge_duplicate_candidate"),
        "rejects": sum(1 for r in out if r.get("action") == "reject_source_error"),
        "pangsang_children": sum(1 for r in out if clean(r.get("parent_public_id")) == PANG["target_public_id"] and r.get("source_entity_type") != "township"),
    }
    return out, meta


def build_village_manifest(approvals: dict) -> tuple[list[dict], dict]:
    rows = load_csv(FROZEN / "03-approved-villages.csv")
    match = {m["source_pcode"]: m for m in approvals["village_match_existing"]}
    create = set(approvals["village_create_new"])
    used_public: set[str] = set()
    used_slug: set[str] = set()
    out = []
    for r in rows:
        item = dict(r)
        pcode = clean(r.get("source_pcode"))
        action = clean(r.get("action"))
        sk = f"village:{pcode}:row{clean(r.get('source_row'))}"
        item["source_key"] = sk
        if pcode in match and action == "reject_source_error":
            item["action"] = "keep_existing"
            item["matched_coremap_id"] = str(match[pcode]["match_id"])
            item["review_decision"] = "match_existing"
            item["review_note"] = "approved Phase7 completion-v2"
            action = item["action"]
        elif pcode in create and action == "reject_source_error":
            item["action"] = "create_mimu_placeholder"
            item["review_decision"] = "create_new"
            item["review_note"] = "approved Phase7 completion-v2"
            action = item["action"]
        if action == "create_mimu_placeholder":
            while True:
                pid = new_uuid()
                if pid not in used_public:
                    break
            used_public.add(pid)
            slug = slug_for(clean(r.get("source_name_en")), sk)
            base = slug
            n = 2
            while slug in used_slug:
                slug = f"{base}-v{n}"
                n += 1
            used_slug.add(slug)
            item["target_public_id"] = pid
            item["target_slug"] = slug
            item["is_public_usable"] = "false"
            item["verification_status"] = "needs_fix"
            item["geometry_source"] = "mimu_placeholder"
            item["source_license_status"] = "permission_pending"
            item["store_pcode_as_external_id"] = "false"
        out.append(item)
    meta = {
        "village_rows": len(out),
        "creates": sum(1 for r in out if r.get("action") == "create_mimu_placeholder"),
        "rejects": sum(1 for r in out if r.get("action") == "reject_source_error"),
        "reopened_match": len(match),
        "reopened_create": len(create),
    }
    return out, meta


def build_postal(admin_rows: list[dict]) -> tuple[list[dict], dict]:
    postal = load_csv(FROZEN / "04-postal-actions.frozen.csv")

    # Inventory: township_key -> norm -> list of identities
    # township_key is approved_township_id OR parent marker NEW:<public_id>
    by_ts: dict[str, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))

    for r in admin_rows:
        action = clean(r.get("action"))
        if action not in {
            "create_mimu_placeholder",
            "keep_existing",
            "update_names",
            "update_type",
            "merge_duplicate_candidate",
        }:
            continue
        if clean(r.get("source_entity_type")) == "township":
            continue
        typ = clean(r.get("source_entity_type")) or clean(r.get("matched_type")) or "ward"
        norms = {
            compact_name(clean(r.get("source_name_en")), "ward_village_tract"),
            compact_name(clean(r.get("source_name_my")), "ward_village_tract"),
            compact_name(clean(r.get("matched_canonical_name")), "ward_village_tract"),
        } - {""}
        if action == "create_mimu_placeholder":
            ts_key = clean(r.get("approved_township_id"))
            if clean(r.get("parent_public_id")) == PANG["target_public_id"]:
                ts_key = f"NEW:{PANG['target_public_id']}"
            elif not ts_key and clean(r.get("parent_public_id")):
                ts_key = f"NEW:{clean(r.get('parent_public_id'))}"
            ident = {
                "kind": "create",
                "target_public_id": clean(r.get("target_public_id")),
                "core_id": "",
                "type": typ,
                "source_key": clean(r.get("source_key")),
                "name_en": clean(r.get("source_name_en")),
                "name_my": clean(r.get("source_name_my")),
            }
        else:
            ts_key = clean(r.get("approved_township_id")) or clean(r.get("matched_parent_id"))
            core_id = clean(r.get("matched_coremap_id"))
            if action == "merge_duplicate_candidate":
                core_id = clean(r.get("matched_coremap_id"))
            ident = {
                "kind": "existing",
                "target_public_id": clean(r.get("matched_public_id")),
                "core_id": core_id,
                "type": typ,
                "source_key": clean(r.get("source_key")),
                "name_en": clean(r.get("source_name_en")) or clean(r.get("matched_canonical_name")),
                "name_my": clean(r.get("source_name_my")),
            }
        if not ts_key:
            continue
        for n in norms:
            by_ts[ts_key][n].append(ident)

    # Also index Pangsang postal remapping: township names
    pang_norms = {
        compact_name("Pangsang (Panghkam)"),
        compact_name("Pangsang"),
        compact_name("Panghkam"),
        compact_name("ပန်ဆန်း (ပန်ခမ်း)"),
        compact_name("ပန်ဆန်း"),
    }

    out = []
    stats = Counter()
    review = []
    by_region = Counter()
    by_township = Counter()

    # Deduplicate postal by code preferring EN row completeness — frozen already unique for valid
    # Keep all rows but track unique codes for gate
    seen_codes: set[str] = set()

    for r in postal:
        item = dict(r)
        code = clean(r.get("postal_code"))
        status = clean(r.get("status"))
        method = clean(r.get("match_method"))
        ts_id = clean(r.get("matched_township_id"))
        loc_en = clean(r.get("locality_en"))
        loc_mm = clean(r.get("locality_mm"))
        norms = {compact_name(loc_en, "ward_village_tract"), compact_name(loc_mm, "ward_village_tract")} - {""}

        # Remap Pangsang township away from 6484
        ts_en = clean(r.get("township_en"))
        ts_mm = clean(r.get("township_mm"))
        is_pang = bool({compact_name(ts_en), compact_name(ts_mm)} & pang_norms) or "Pangsang" in ts_en
        if is_pang:
            ts_id = f"NEW:{PANG['target_public_id']}"
            item["matched_township_id"] = ""  # numeric unknown until import
            item["matched_township_public_id"] = PANG["target_public_id"]
        else:
            item["matched_township_public_id"] = ""

        def find_hits(township_key: str) -> list[dict]:
            hits = []
            pool = by_ts.get(township_key) or {}
            for n in norms:
                hits.extend(pool.get(n) or [])
            # unique by target/core
            uniq = {}
            for h in hits:
                k = h.get("target_public_id") or h.get("core_id") or id(h)
                uniq[k] = h
            return list(uniq.values())

        # Already exact linked — keep, attach public_id if inventory has it
        if status == "linked_exact_local_area":
            hits = find_hits(ts_id) if ts_id else []
            # Prefer existing core_id match
            local_id = clean(r.get("matched_local_admin_area_id"))
            pub = ""
            for h in hits:
                if h.get("core_id") == local_id and h.get("target_public_id"):
                    pub = h["target_public_id"]
                    break
            item["matched_local_admin_public_id"] = pub
            item["v2_status"] = "linked_exact_local_area"
            item["v2_reason"] = clean(r.get("reason")) or "preserved exact link"
            stats["linked_exact_local_area"] += 1

        elif status == "linked_after_review":
            item["matched_local_admin_public_id"] = ""
            item["v2_status"] = "linked_after_review"
            item["v2_reason"] = clean(r.get("reason"))
            stats["linked_after_review"] += 1

        elif status == "ambiguous_local_area" or method == "ambiguous_exact_local":
            item["matched_local_admin_public_id"] = ""
            item["v2_status"] = "ambiguous_local_area"
            item["v2_reason"] = clean(r.get("reason"))
            stats["ambiguous_local_area"] += 1
            review.append(item)

        elif status == "malformed_rejected":
            item["matched_local_admin_public_id"] = ""
            item["v2_status"] = "rejected_source_error"
            item["v2_reason"] = clean(r.get("reason"))
            stats["rejected_source_error"] += 1

        elif method == "exact_pending_create" or (method == "missing_local" and is_pang):
            key = ts_id if not is_pang else f"NEW:{PANG['target_public_id']}"
            hits = find_hits(key)
            creates = [h for h in hits if h["kind"] == "create"]
            exist = [h for h in hits if h["kind"] == "existing"]
            if len(creates) == 1 and not exist:
                h = creates[0]
                item["matched_local_admin_area_id"] = ""
                item["matched_local_admin_public_id"] = h["target_public_id"]
                item["v2_status"] = "linked_exact_local_area"
                item["v2_reason"] = f"linked to frozen create {h['source_key']} via exact name under township"
                item["match_method"] = "exact_local_frozen_create"
                stats["linked_exact_local_area"] += 1
            elif len(exist) == 1 and not creates:
                h = exist[0]
                item["matched_local_admin_area_id"] = h["core_id"]
                item["matched_local_admin_public_id"] = h.get("target_public_id") or ""
                item["v2_status"] = "linked_exact_local_area"
                item["v2_reason"] = f"linked to existing core {h['core_id']}"
                item["match_method"] = "exact_local_existing"
                stats["linked_exact_local_area"] += 1
            elif len(creates) + len(exist) > 1:
                # Prefer a single create when all hits share one source_pcode prefix / identical names
                # (duplicate Phase-3 rows). Otherwise keep ambiguous with non-pending method.
                uniq_keys = {(h.get("source_key") or "") for h in creates + exist}
                if len(creates) >= 1 and len(exist) == 0 and len({h["target_public_id"] for h in creates}) > 1:
                    # Same-name duplicate creates in inventory: pick stable source_key winner
                    names = {(h.get("name_en"), h.get("name_my")) for h in creates}
                    h = sorted(creates, key=lambda x: x.get("source_key") or "")[0]
                    item["matched_local_admin_public_id"] = h["target_public_id"]
                    if len(names) == 1:
                        item["v2_status"] = "linked_exact_local_area"
                        item["v2_reason"] = (
                            f"duplicate same-name creates ({len(creates)}); linked to stable {h['source_key']}"
                        )
                        item["match_method"] = "exact_local_frozen_create_dedup"
                        stats["linked_exact_local_area"] += 1
                    else:
                        item["v2_status"] = "linked_after_review"
                        item["v2_reason"] = (
                            f"multiple similar creates ({len(creates)}); deterministic pick {h['source_key']}"
                        )
                        item["match_method"] = "deterministic_multi_create_pick"
                        stats["linked_after_review"] += 1
                        review.append(item)
                else:
                    item["v2_status"] = "ambiguous_local_area"
                    item["v2_reason"] = f"multiple inventory hits: {len(creates)} creates + {len(exist)} existing; keys={sorted(uniq_keys)[:4]}"
                    item["matched_local_admin_public_id"] = ""
                    item["match_method"] = "ambiguous_frozen_inventory"
                    stats["ambiguous_local_area"] += 1
                    review.append(item)
            else:
                # pending create name no longer resolves (inventory gap)
                if looks_non_admin(loc_en, loc_mm):
                    item["v2_status"] = "non_admin_postal_locality"
                    item["v2_reason"] = "no ward/VT inventory hit; locality appears non-admin"
                    item["match_method"] = "non_admin_postal_locality"
                    stats["non_admin_postal_locality"] += 1
                else:
                    item["v2_status"] = "missing_local_admin_identity"
                    item["v2_reason"] = "exact pending create could not be rebound to frozen inventory identity"
                    item["match_method"] = "missing_local_after_rebind"
                    stats["missing_local_admin_identity"] += 1
                item["matched_local_admin_public_id"] = ""
                review.append(item)

        elif method == "township_unresolved":
            # Try Pangsang / alias — already handled if is_pang
            if looks_non_admin(loc_en, loc_mm) or "town" in ts_en.casefold() or ts_en.endswith(" Town"):
                item["v2_status"] = "non_admin_postal_locality"
                item["v2_reason"] = "township name unresolved as CoreMap township; locality treated as non-admin postal place/town"
                item["match_method"] = "non_admin_unresolved_township_name"
                stats["non_admin_postal_locality"] += 1
            else:
                item["v2_status"] = "missing_township"
                item["v2_reason"] = "could not resolve approved CoreMap township from postal region/township names"
                item["match_method"] = "missing_township"
                stats["missing_township"] += 1
            item["matched_local_admin_public_id"] = ""
            review.append(item)

        elif method == "missing_local":
            hits = find_hits(ts_id) if ts_id else []
            creates = [h for h in hits if h["kind"] == "create"]
            exist = [h for h in hits if h["kind"] == "existing"]
            if len(creates) == 1:
                h = creates[0]
                item["matched_local_admin_public_id"] = h["target_public_id"]
                item["v2_status"] = "linked_exact_local_area"
                item["v2_reason"] = "rebound missing_local to frozen create"
                item["match_method"] = "exact_local_frozen_create"
                stats["linked_exact_local_area"] += 1
            elif len(exist) == 1:
                h = exist[0]
                item["matched_local_admin_area_id"] = h["core_id"]
                item["matched_local_admin_public_id"] = h.get("target_public_id") or ""
                item["v2_status"] = "linked_exact_local_area"
                item["v2_reason"] = "rebound missing_local to existing"
                stats["linked_exact_local_area"] += 1
            elif looks_non_admin(loc_en, loc_mm):
                item["v2_status"] = "non_admin_postal_locality"
                item["v2_reason"] = "township resolved but locality is not an official ward/VT name"
                item["matched_local_admin_public_id"] = ""
                item["match_method"] = "non_admin_postal_locality"
                stats["non_admin_postal_locality"] += 1
                review.append(item)
            else:
                item["v2_status"] = "missing_local_admin_identity"
                item["v2_reason"] = "township resolved; no exact inventory identity for locality"
                item["matched_local_admin_public_id"] = ""
                item["match_method"] = "missing_local_after_rebind"
                stats["missing_local_admin_identity"] += 1
                review.append(item)
        else:
            item["v2_status"] = status or "missing_local_admin_identity"
            item["v2_reason"] = clean(r.get("reason"))
            item["matched_local_admin_public_id"] = ""
            stats[item["v2_status"]] += 1
            review.append(item)

        # Final status field used by import
        item["status"] = item["v2_status"]
        if item["status"] == "linked_exact_local_area" and not clean(item.get("matched_local_admin_public_id")) and not clean(item.get("matched_local_admin_area_id")):
            # should not happen often
            pass

        region = clean(item.get("region_en")) or clean(item.get("region_mm")) or "_unknown"
        tsp = clean(item.get("township_en")) or clean(item.get("township_mm")) or "_unknown"
        by_region[(region, item["status"])] += 1
        by_township[(region, tsp, item["status"])] += 1
        out.append(item)
        if re.fullmatch(r"[0-9]{7}", code):
            seen_codes.add(code)

    # exclusive status for valid 17297
    valid = [r for r in out if re.fullmatch(r"[0-9]{7}", clean(r.get("postal_code")))]
    # frozen file may have 17297 + malformed extras; unique by code preferring linked
    by_code: dict[str, dict] = {}
    for r in valid:
        c = clean(r["postal_code"])
        prev = by_code.get(c)
        if not prev:
            by_code[c] = r
            continue
        # prefer linked statuses
        rank = {
            "linked_exact_local_area": 0,
            "linked_after_review": 1,
            "ambiguous_local_area": 2,
            "non_admin_postal_locality": 3,
            "missing_local_admin_identity": 4,
            "missing_township": 5,
            "rejected_source_error": 6,
        }
        if rank.get(r["status"], 9) < rank.get(prev["status"], 9):
            by_code[c] = r
    unique = list(by_code.values())
    unique_stats = Counter(r["status"] for r in unique)

    meta = {
        "postal_rows_written": len(out),
        "unique_valid_codes": len(unique),
        "unique_status_counts": dict(unique_stats),
            "exact_pending_create_remaining": sum(1 for r in unique if r.get("match_method") == "exact_pending_create"),
        "status_sum": sum(unique_stats.values()),
        "gates": {
            "unique_codes_17297": len(unique) == 17297,
            "status_sum_17297": sum(unique_stats.values()) == 17297,
            "exact_pending_create_0": sum(1 for r in unique if r.get("match_method") == "exact_pending_create") == 0,
            "township_unresolved_method_0": sum(1 for r in unique if r.get("match_method") == "township_unresolved") == 0,
            "missing_township_status": unique_stats.get("missing_township", 0),
            "linked_exact": unique_stats.get("linked_exact_local_area", 0),
        },
    }

    # by region / township CSVs from unique
    region_rows = []
    for (region, status), n in sorted(Counter((clean(r.get("region_en")) or "_", r["status"]) for r in unique).items()):
        region_rows.append({"region_en": region, "status": status, "count": n})
    tsp_rows = []
    for (region, tsp, status), n in sorted(
        Counter(((clean(r.get("region_en")) or "_", clean(r.get("township_en")) or "_", r["status"]) for r in unique)).items()
    ):
        tsp_rows.append({"region_en": region, "township_en": tsp, "status": status, "count": n})

    return unique, {
        **meta,
        "all_rows": out,
        "review": review,
        "region_rows": region_rows,
        "township_rows": tsp_rows,
        "raw_stats": dict(stats),
    }


def write_import_scripts() -> None:
    """Write apply_v2_disposable.py companion notes + SQL order doc."""
    md = f"""# V2 one-time import order

Generated: `{utc_now()}`

Production import order (runtime resolves numeric IDs from frozen `public_id`):

1. Township parent creates/updates (incl. Pangsang `{PANG['target_public_id']}`)
2. Ward / village-tract creates/updates
3. Approved admin duplicate merges
4. Village creates/updates
5. Approved settlement duplicate merges
6. Approved name aliases
7. Postal-row import
8. Postal FK resolution (`local_admin_area_id` / `township_admin_area_id` via public_id map)

Rules:
- Temporary transaction-local source_key → id mapping allowed
- Permanent MIMU staging/mapping table forbidden
- Do not store MIMU PCode as `external_id`
- Do not use disposable numeric IDs in manifests
- Placeholders: `geometry_source=mimu_placeholder`, `verification_status=needs_fix`, `is_verified=false`, `is_public_usable=false`, `boundary_status=approximate`, `is_official_boundary=false`
- Public exposure remains **PASS_DATABASE_ONLY**
"""
    (OUT / "import/07-v2-import-order.md").write_text(md, encoding="utf-8")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "frozen-v2").mkdir(exist_ok=True)
    (OUT / "postal").mkdir(exist_ok=True)
    (OUT / "import").mkdir(exist_ok=True)
    (OUT / "checksums").mkdir(exist_ok=True)

    approvals = record_approvals()
    admin, admin_meta = build_admin_manifest(approvals)
    vill, vill_meta = build_village_manifest(approvals)

    admin_fields = list(dict.fromkeys([*admin[0].keys(), "target_public_id", "target_slug", "parent_public_id", "source_key"]))
    write_csv(OUT / "frozen-v2/03-approved-local-admin.v2.csv", admin, admin_fields)
    write_csv(OUT / "frozen-v2/03-approved-villages.v2.csv", vill)

    postal_unique, postal_meta = build_postal(admin)
    # Write unique 17297 as actions v2
    postal_fields = list(postal_unique[0].keys())
    write_csv(OUT / "postal/03-postal-actions-v2.csv", postal_unique, postal_fields)
    write_csv(OUT / "postal/03-postal-review-v2.csv", postal_meta["review"])
    write_csv(OUT / "postal/03-postal-by-region-v2.csv", postal_meta["region_rows"])
    write_csv(OUT / "postal/03-postal-by-township-v2.csv", postal_meta["township_rows"])

    # Also mirror names requested at completion-v2 root
    write_csv(OUT / "03-postal-actions-v2.csv", postal_unique, postal_fields)
    write_csv(OUT / "03-postal-review-v2.csv", postal_meta["review"])
    write_csv(OUT / "03-postal-by-region-v2.csv", postal_meta["region_rows"])
    write_csv(OUT / "03-postal-by-township-v2.csv", postal_meta["township_rows"])

    st = postal_meta["unique_status_counts"]
    summary = f"""# Postal reconciliation v2

Generated: `{utc_now()}`

## Exclusive status counts (unique valid codes = {postal_meta['unique_valid_codes']})

| Status | Count |
|---|---:|
"""
    for k, v in sorted(st.items(), key=lambda kv: (-kv[1], kv[0])):
        summary += f"| `{k}` | {v} |\n"
    summary += f"""
**Sum:** {sum(st.values())}

## Gates

| Gate | Result |
|---|---|
| unique codes = 17297 | {'PASS' if postal_meta['gates']['unique_codes_17297'] else 'FAIL'} |
| status sum = 17297 | {'PASS' if postal_meta['gates']['status_sum_17297'] else 'FAIL'} |
| exact_pending_create method = 0 | {'PASS' if postal_meta['gates']['exact_pending_create_0'] else 'FAIL'} |
| township_unresolved method = 0 | {'PASS' if postal_meta['gates']['township_unresolved_method_0'] else 'FAIL'} |

## Notes

- `exact_pending_create` rows rebound to frozen `target_public_id` where unique inventory identity exists.
- Pangsang postal township remapped from CoreMap `6484` to frozen township `{PANG['target_public_id']}`.
- Unresolved townships that are towns/non-admin localities classified as `non_admin_postal_locality` (not forced links).
- True remaining ward/VT gaps: `missing_local_admin_identity` / `missing_township` / `ambiguous_local_area`.

Admin meta: `{json.dumps(admin_meta)}`  
Village meta: `{json.dumps(vill_meta)}`
"""
    (OUT / "03-postal-summary-v2.md").write_text(summary, encoding="utf-8")
    (OUT / "postal/03-postal-summary-v2.md").write_text(summary, encoding="utf-8")

    write_import_scripts()

    checksums = {}
    for rel in [
        "frozen-v2/03-approved-local-admin.v2.csv",
        "frozen-v2/03-approved-villages.v2.csv",
        "postal/03-postal-actions-v2.csv",
        "decisions/01-pangsang-township-freeze.json",
        "decisions/04-approvals.json",
    ]:
        p = OUT / rel
        checksums[rel] = {"sha256": sha256_file(p), "bytes": p.stat().st_size}
    checksums["git_commit_at_build"] = __import__("subprocess").check_output(
        ["git", "rev-parse", "HEAD"], cwd=REPO, text=True
    ).strip()
    checksums["generated_at"] = utc_now()
    (OUT / "checksums/07-v2-frozen-manifest.checksums.json").write_text(
        json.dumps(checksums, indent=2), encoding="utf-8"
    )

    stats = {
        "generated_at": utc_now(),
        "admin": admin_meta,
        "villages": vill_meta,
        "postal": {
            "unique_valid_codes": postal_meta["unique_valid_codes"],
            "status_counts": st,
            "gates": postal_meta["gates"],
        },
        "approvals": approvals,
        "checksums": checksums,
    }
    (OUT / "validation").mkdir(exist_ok=True)
    (OUT / "validation/07-v2-build-stats.json").write_text(json.dumps(stats, indent=2), encoding="utf-8")
    print(json.dumps({"admin": admin_meta, "villages": vill_meta, "postal_status": st, "gates": postal_meta["gates"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
