#!/usr/bin/env python3
"""Phase 5 one-time postal import — dry-run by default.

Consumes frozen Phase 4 postal actions (04-postal-actions.csv).
Upserts into ref.ref_postal_codes (table must exist / be migrated first).
Never stores malformed codes. Idempotent on postal_code.

Usage:
  uv run --with 'psycopg[binary]' python tools/admin-reconciliation/phase5/import_postal.py \\
    --database-url "$DATABASE_URL" --mode dry-run|apply
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (  # noqa: E402
    PHASE5,
    POSTAL_SOURCE_VERSION,
    as_int,
    clean,
    connect,
    load_csv,
    require_frozen_manifests,
    write_csv,
)

SEVEN = re.compile(r"^[0-9]{7}$")
REPO = Path(__file__).resolve().parents[3]

# Phase-4 statuses stored as-is (after Phase-5 DDL alignment).
ALLOWED_STATUS = {
    "linked_exact_local_area",
    "linked_after_review",
    "ambiguous_local_area",
    "missing_local_area",
    "non_admin_postal_locality",
}


def normalize_status(raw: str) -> str:
    s = clean(raw)
    if s in ALLOWED_STATUS:
        return s
    # legacy → phase5
    return {
        "linked_local_area": "linked_exact_local_area",
        "linked_township_only": "missing_local_area",
        "ambiguous": "ambiguous_local_area",
        "unmatched": "missing_local_area",
    }.get(s, "missing_local_area")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--mode", choices=["dry-run", "apply"], default="dry-run")
    parser.add_argument("--out-dir", type=Path, default=PHASE5)
    args = parser.parse_args()
    dry_run = args.mode == "dry-run"

    _, _, postal_path = require_frozen_manifests()
    rows = load_csv(postal_path)
    valid_rows = [r for r in rows if clean(r.get("status")) != "malformed_rejected"]
    if len(valid_rows) != 17297:
        # Allow frozen file that only contains valid codes
        codes = {clean(r.get("postal_code")) for r in valid_rows if SEVEN.fullmatch(clean(r.get("postal_code")))}
        if len(codes) != 17297:
            raise SystemExit(f"Expected 17297 valid postal codes, got {len(codes)}")

    # Deduplicate by postal_code (keep first)
    by_code: dict[str, dict[str, str]] = {}
    for r in valid_rows:
        code = clean(r.get("postal_code"))
        if not SEVEN.fullmatch(code):
            continue
        if code not in by_code:
            by_code[code] = r
    if len(by_code) != 17297:
        raise SystemExit(f"Expected 17297 unique codes after dedupe, got {len(by_code)}")

    conn = connect(args.database_url)
    plans: list[dict[str, Any]] = []
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT to_regclass('ref.ref_postal_codes')")
            if cur.fetchone()[0] is None:
                raise SystemExit(
                    "ref.ref_postal_codes missing. Apply "
                    "infrastructure/database/migrations/supabase/20260921180000_phase5_ref_postal_codes.sql "
                    "first (still no data apply from this script until --mode apply)."
                )

            # Detect mm vs my column names
            cur.execute(
                """
                SELECT column_name FROM information_schema.columns
                WHERE table_schema='ref' AND table_name='ref_postal_codes'
                """
            )
            cols = {r[0] for r in cur.fetchall()}
            mm = "region_name_mm" in cols
            region_mm_col = "region_name_mm" if mm else "region_name_my"
            tsp_mm_col = "township_name_mm" if mm else "township_name_my"
            loc_mm_col = "locality_name_mm" if mm else "locality_name_my"

            upsert_sql = f"""
                INSERT INTO ref.ref_postal_codes (
                  postal_code,
                  township_admin_area_id,
                  local_admin_area_id,
                  {region_mm_col}, region_name_en,
                  {tsp_mm_col}, township_name_en,
                  {loc_mm_col}, locality_name_en,
                  locality_type, match_status, match_method, source_version,
                  created_at, updated_at
                ) VALUES (
                  %(postal_code)s,
                  %(township_admin_area_id)s,
                  %(local_admin_area_id)s,
                  %(region_mm)s, %(region_en)s,
                  %(township_mm)s, %(township_en)s,
                  %(locality_mm)s, %(locality_en)s,
                  %(locality_type)s, %(match_status)s, %(match_method)s, %(source_version)s,
                  now(), now()
                )
                ON CONFLICT (postal_code) DO UPDATE SET
                  township_admin_area_id = EXCLUDED.township_admin_area_id,
                  local_admin_area_id = EXCLUDED.local_admin_area_id,
                  {region_mm_col} = EXCLUDED.{region_mm_col},
                  region_name_en = EXCLUDED.region_name_en,
                  {tsp_mm_col} = EXCLUDED.{tsp_mm_col},
                  township_name_en = EXCLUDED.township_name_en,
                  {loc_mm_col} = EXCLUDED.{loc_mm_col},
                  locality_name_en = EXCLUDED.locality_name_en,
                  locality_type = EXCLUDED.locality_type,
                  match_status = EXCLUDED.match_status,
                  match_method = EXCLUDED.match_method,
                  source_version = EXCLUDED.source_version,
                  updated_at = now()
            """

            # Validate FKs exist (null invalid)
            tsp_ids = {
                as_int(r.get("matched_township_id"))
                for r in by_code.values()
                if as_int(r.get("matched_township_id"))
            }
            loc_ids = {
                as_int(r.get("matched_local_admin_area_id"))
                for r in by_code.values()
                if as_int(r.get("matched_local_admin_area_id"))
            }
            active: set[int] = set()
            all_ids = sorted({i for i in (tsp_ids | loc_ids) if i})
            if all_ids:
                cur.execute(
                    """
                    SELECT id FROM core.core_admin_areas
                    WHERE id = ANY(%s) AND is_active IS TRUE AND deleted_at IS NULL
                    """,
                    (all_ids,),
                )
                active = {int(r[0]) for r in cur.fetchall()}

            for code, r in sorted(by_code.items()):
                status = normalize_status(r.get("status") or "")
                if status not in ALLOWED_STATUS:
                    status = "missing_local_area"
                tsp = as_int(r.get("matched_township_id"))
                loc = as_int(r.get("matched_local_admin_area_id"))
                if tsp and tsp not in active:
                    tsp = None
                    loc = None
                    if status == "linked_exact_local_area":
                        status = "missing_local_area"
                if loc and loc not in active:
                    loc = None
                    if status == "linked_exact_local_area":
                        status = "missing_local_area" if not tsp else "missing_local_area"
                if loc and not tsp:
                    loc = None
                loc_type = clean(r.get("inferred_locality_type") or r.get("locality_type"))
                if loc_type not in {"ward", "village_tract"}:
                    loc_type = None

                payload = {
                    "postal_code": code,
                    "township_admin_area_id": tsp,
                    "local_admin_area_id": loc,
                    "region_mm": clean(r.get("region_mm") or r.get("region_name_my")),
                    "region_en": clean(r.get("region_en") or r.get("region_name_en")),
                    "township_mm": clean(r.get("township_mm") or r.get("township_name_my")),
                    "township_en": clean(r.get("township_en") or r.get("township_name_en")),
                    "locality_mm": clean(r.get("locality_mm") or r.get("locality_name_my")),
                    "locality_en": clean(r.get("locality_en") or r.get("locality_name_en")),
                    "locality_type": loc_type,
                    "match_status": status,
                    "match_method": clean(r.get("match_method")),
                    "source_version": POSTAL_SOURCE_VERSION,
                }
                plans.append(
                    {
                        "postal_code": code,
                        "match_status": status,
                        "township_admin_area_id": tsp or "",
                        "local_admin_area_id": loc or "",
                        "outcome": "would_upsert" if dry_run else "upserted",
                    }
                )
                if not dry_run:
                    cur.execute(upsert_sql, payload)

            if not dry_run:
                cur.execute("SELECT count(*) FROM ref.ref_postal_codes")
                count = int(cur.fetchone()[0])
                if count != 17297:
                    raise SystemExit(f"Post-import count {count} != 17297")

        if dry_run:
            conn.rollback()
        else:
            conn.commit()
    finally:
        conn.close()

    out = args.out_dir
    out.mkdir(parents=True, exist_ok=True)
    write_csv(
        out / "05-postal-import-plan.csv",
        plans,
        ["postal_code", "match_status", "township_admin_area_id", "local_admin_area_id", "outcome"],
    )
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": args.mode,
        "manifest": str(postal_path.relative_to(REPO)),
        "unique_codes": len(by_code),
        "status_counts": dict(Counter(p["match_status"] for p in plans)),
        "production_writes": not dry_run,
    }
    (out / "05-postal-import-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))
    print(f"Wrote {out / '05-postal-import-plan.csv'}")
    if dry_run:
        print("DRY-RUN only — no production changes committed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
