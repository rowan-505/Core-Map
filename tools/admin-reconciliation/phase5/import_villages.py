#!/usr/bin/env python3
"""Phase 5 one-time village (core_settlements) import — dry-run by default.

Villages stay in core.core_settlements with required point_geom.
No schema changes. source_type resolved by code 'partner'.
source_refs merged without overwriting existing keys.

Usage:
  uv run --with 'psycopg[binary]' python tools/admin-reconciliation/phase5/import_villages.py \\
    --database-url "$DATABASE_URL" --mode dry-run|apply
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (  # noqa: E402
    IMPORT_MARKER,
    MIMU_VERSION,
    PHASE5,
    as_int,
    clean,
    connect,
    json_merge_patch,
    load_csv,
    new_public_id,
    require_frozen_manifests,
    resolve_ref_ids,
    write_csv,
)

REPO = Path(__file__).resolve().parents[3]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--mode", choices=["dry-run", "apply"], default="dry-run")
    parser.add_argument("--out-dir", type=Path, default=PHASE5)
    args = parser.parse_args()
    dry_run = args.mode == "dry-run"

    _, village_path, _ = require_frozen_manifests()
    rows = load_csv(village_path)

    conn = connect(args.database_url)
    plans: list[dict[str, Any]] = []
    try:
        with conn.cursor() as cur:
            refs = resolve_ref_ids(cur)
            partner_id = refs["sources"]["partner"]

            # Resolve village settlement_type by code when possible
            cur.execute(
                "SELECT id FROM ref.ref_settlement_types WHERE code = 'village' LIMIT 1"
            )
            st = cur.fetchone()
            if not st:
                raise SystemExit("ref.ref_settlement_types.code=village not found")
            village_type_id = int(st[0])

            for row in rows:
                action = clean(row.get("action"))
                matched = as_int(row.get("matched_coremap_id"))
                # Village manifest uses matched_coremap_id for settlement id in Phase 2/3
                settlement_id = matched
                source_key = (
                    f"village:{clean(row.get('source_pcode'))}:row{clean(row.get('source_row'))}"
                )
                name_en = clean(row.get("source_name_en"))
                name_mm = clean(row.get("source_name_my"))
                township_id = as_int(row.get("approved_township_id"))

                if action == "reject_source_error":
                    plans.append(
                        {
                            "source_key": source_key,
                            "action": action,
                            "outcome": "rejected_source_skipped",
                            "settlement_id": "",
                            "note": "",
                        }
                    )
                    continue

                if action in {
                    "keep_existing",
                    "update_names",
                    "update_parent",
                    "update_type",
                    "merge_duplicate_candidate",
                }:
                    if not settlement_id:
                        plans.append(
                            {
                                "source_key": source_key,
                                "action": action,
                                "outcome": "skip_missing_settlement_id",
                                "settlement_id": "",
                                "note": "",
                            }
                        )
                        continue
                    if dry_run:
                        plans.append(
                            {
                                "source_key": source_key,
                                "action": action,
                                "outcome": "would_update_preserve_point",
                                "settlement_id": settlement_id,
                                "note": "point_geom preserved",
                            }
                        )
                        continue
                    cur.execute(
                        """
                        SELECT id, source_refs, name_en, name_mm, township_id, source_type_id
                        FROM core.core_settlements
                        WHERE id=%s AND deleted_at IS NULL
                        """,
                        (settlement_id,),
                    )
                    existing = cur.fetchone()
                    if not existing:
                        plans.append(
                            {
                                "source_key": source_key,
                                "action": action,
                                "outcome": "skip_settlement_not_found",
                                "settlement_id": settlement_id,
                                "note": "",
                            }
                        )
                        continue
                    _id, source_refs, old_en, old_mm, old_tsp, old_st = existing
                    names_changed = (
                        (name_en and name_en != clean(old_en))
                        or (name_mm and name_mm != clean(old_mm))
                    )
                    patch: dict[str, Any] = {
                        "source": "mimu",
                        "source_version": MIMU_VERSION,
                        IMPORT_MARKER: True,
                    }
                    if names_changed or action == "update_names":
                        patch["name_reference"] = "mimu"
                    merged = json_merge_patch(source_refs, patch)
                    # Do NOT mark existing geometry as mimu_placeholder
                    cur.execute(
                        """
                        UPDATE core.core_settlements
                        SET
                          name_en = CASE WHEN %s <> '' THEN %s ELSE name_en END,
                          name_mm = CASE WHEN %s <> '' THEN %s ELSE name_mm END,
                          township_id = COALESCE(%s, township_id),
                          settlement_type_id = CASE WHEN %s THEN %s ELSE settlement_type_id END,
                          source_type_id = COALESCE(source_type_id, %s),
                          source_refs = %s::jsonb,
                          updated_at = now()
                        WHERE id = %s
                        """,
                        (
                            name_en,
                            name_en,
                            name_mm,
                            name_mm,
                            township_id,
                            action == "update_type",
                            village_type_id,
                            partner_id,
                            json.dumps(merged),
                            settlement_id,
                        ),
                    )
                    plans.append(
                        {
                            "source_key": source_key,
                            "action": action,
                            "outcome": "updated_preserve_point",
                            "settlement_id": settlement_id,
                            "note": "point_geom preserved; source_refs merged",
                        }
                    )
                    continue

                if action == "create_mimu_placeholder":
                    # Require a point — from export of an existing unmatched source
                    # or skip. Villages need point_geom NOT NULL.
                    # Prefer lon/lat on the action row if present; else skip.
                    lon = lat = None
                    for key_lon, key_lat in (("source_lon", "source_lat"), ("lon", "lat")):
                        try:
                            if clean(row.get(key_lon)) and clean(row.get(key_lat)):
                                lon = float(row[key_lon])
                                lat = float(row[key_lat])
                                break
                        except (TypeError, ValueError, KeyError):
                            pass
                    if lon is None:
                        plans.append(
                            {
                                "source_key": source_key,
                                "action": action,
                                "outcome": "create_skipped_no_point_geom",
                                "settlement_id": "",
                                "note": "point_geom required; no coordinates on manifest",
                            }
                        )
                        continue
                    if dry_run:
                        plans.append(
                            {
                                "source_key": source_key,
                                "action": action,
                                "outcome": "would_create_settlement_placeholder",
                                "settlement_id": "",
                                "note": f"point=({lon},{lat})",
                            }
                        )
                        continue
                    public_id = new_public_id()
                    canonical = name_mm or name_en or "unnamed"
                    refs_json = {
                        "source": "mimu",
                        "source_version": MIMU_VERSION,
                        "geometry_status": "mimu_placeholder",
                        "needs_geometry_replacement": True,
                        IMPORT_MARKER: True,
                    }
                    cur.execute(
                        """
                        INSERT INTO core.core_settlements (
                          public_id, settlement_type_id, canonical_name, name_mm, name_en,
                          point_geom, township_id, source_type_id, source_refs,
                          is_verified, verification_status, is_public
                        ) VALUES (
                          %s::uuid, %s, %s, NULLIF(%s,''), NULLIF(%s,''),
                          ST_SetSRID(ST_MakePoint(%s,%s),4326), %s, %s, %s::jsonb,
                          false, 'needs_fix', true
                        )
                        RETURNING id
                        """,
                        (
                            public_id,
                            village_type_id,
                            canonical,
                            name_mm,
                            name_en,
                            lon,
                            lat,
                            township_id,
                            partner_id,
                            json.dumps(refs_json),
                        ),
                    )
                    new_id = int(cur.fetchone()[0])
                    plans.append(
                        {
                            "source_key": source_key,
                            "action": action,
                            "outcome": "created_settlement_placeholder",
                            "settlement_id": new_id,
                            "note": "geometry_status=mimu_placeholder in source_refs only",
                        }
                    )
                    continue

                plans.append(
                    {
                        "source_key": source_key,
                        "action": action,
                        "outcome": "unhandled_action",
                        "settlement_id": settlement_id or "",
                        "note": "",
                    }
                )

        if dry_run:
            conn.rollback()
        else:
            conn.commit()
    finally:
        conn.close()

    out = args.out_dir
    out.mkdir(parents=True, exist_ok=True)
    headers = ["source_key", "action", "outcome", "settlement_id", "note"]
    write_csv(out / "05-village-import-plan.csv", plans, headers)
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": args.mode,
        "manifest": str(village_path.relative_to(REPO)),
        "counts": dict(Counter(p["outcome"] for p in plans)),
        "production_writes": not dry_run,
    }
    (out / "05-village-import-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))
    print(f"Wrote {out / '05-village-import-plan.csv'}")
    if dry_run:
        print("DRY-RUN only — no production changes committed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
