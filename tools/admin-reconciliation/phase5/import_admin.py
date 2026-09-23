#!/usr/bin/env python3
"""Phase 5 one-time admin (ward / village_tract) import — dry-run by default.

Consumes frozen Phase 3 local-admin manifest.
Preserves existing geometry and IDs. Creates mimu_placeholder rows only when
valid MultiPolygon geometry is available (core_admin_areas.geom is NOT NULL).

Does not create permanent staging tables.
Never hardcodes ref IDs — resolves by code.

Usage:
  uv run --with 'psycopg[binary]' python tools/admin-reconciliation/phase5/import_admin.py \\
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
    REPORTS,
    as_int,
    clean,
    connect,
    load_csv,
    new_public_id,
    require_frozen_manifests,
    resolve_ref_ids,
    slugify,
    write_csv,
)

REPO = Path(__file__).resolve().parents[3]


def load_preview_geojson(preview_path: str) -> str | None:
    if not preview_path:
        return None
    candidates = [
        REPO / preview_path,
        REPO / f"{preview_path}.geojson",
        REPORTS / "phase3-previews" / Path(preview_path).name,
        REPORTS / "phase3-previews" / f"{Path(preview_path).name}.geojson",
    ]
    path = next((p for p in candidates if p.exists()), None)
    if not path:
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    # Prefer first polygon feature
    if data.get("type") == "FeatureCollection":
        for feat in data.get("features") or []:
            g = feat.get("geometry")
            if g and g.get("type") in {"Polygon", "MultiPolygon"}:
                return json.dumps(g)
    if data.get("type") == "Feature":
        g = data.get("geometry")
        if g and g.get("type") in {"Polygon", "MultiPolygon"}:
            return json.dumps(g)
    if data.get("type") in {"Polygon", "MultiPolygon"}:
        return json.dumps(data)
    return None


def preview_path_for_row(row: dict[str, str], queue_by_key: dict[str, dict[str, str]]) -> str:
    key = clean(row.get("source_key")) or (
        f"{clean(row.get('source_entity_type'))}:{clean(row.get('source_pcode'))}:row{clean(row.get('source_row'))}"
    )
    q = queue_by_key.get(key) or {}
    return clean(q.get("source_geometry_preview_path")) or clean(row.get("source_geometry_preview_path"))


def ensure_names(
    cur,
    area_id: int,
    name_en: str,
    name_mm: str,
    *,
    dry_run: bool,
    set_name_reference: bool,
) -> bool:
    changed = False
    for lang, name in (("en", name_en), ("my", name_mm)):
        name = clean(name)
        if not name:
            continue
        cur.execute(
            """
            SELECT id, name FROM core.core_admin_area_names
            WHERE admin_area_id=%s AND language_code=%s AND is_primary IS TRUE AND deleted_at IS NULL
            LIMIT 1
            """,
            (area_id, lang),
        )
        row = cur.fetchone()
        if row and clean(row[1]) == name:
            continue
        changed = True
        if dry_run:
            continue
        if row:
            cur.execute(
                """
                UPDATE core.core_admin_area_names
                SET name=%s, updated_at=now(),
                    source_refs = CASE
                      WHEN %s THEN coalesce(source_refs,'{}'::jsonb) || jsonb_build_object('name_reference','mimu')
                      ELSE source_refs
                    END
                WHERE id=%s
                """,
                (name, set_name_reference, row[0]),
            )
        else:
            cur.execute(
                """
                INSERT INTO core.core_admin_area_names (
                  admin_area_id, name, language_code, name_type, is_primary, source_refs
                ) VALUES (%s,%s,%s,'imported',true, CASE WHEN %s THEN jsonb_build_object('name_reference','mimu') ELSE '{}'::jsonb END)
                """,
                (area_id, name, lang, set_name_reference),
            )
    return changed


def soft_retire(cur, area_id: int, *, dry_run: bool, note: str) -> None:
    if dry_run:
        return
    cur.execute(
        """
        UPDATE core.core_admin_areas
        SET is_active=false,
            deleted_at=COALESCE(deleted_at, now()),
            updated_at=now(),
            boundary_note = CASE
              WHEN boundary_note IS NULL OR btrim(boundary_note)='' THEN %s
              ELSE boundary_note || ' | ' || %s
            END
        WHERE id=%s AND deleted_at IS NULL
        """,
        (note, note, area_id),
    )


def create_placeholder(
    cur,
    row: dict[str, str],
    refs: dict[str, Any],
    geom_geojson: str,
    *,
    dry_run: bool,
) -> dict[str, Any]:
    parent_id = as_int(row.get("approved_township_id"))
    entity = clean(row.get("source_entity_type"))
    level_id = refs["levels"]["ward_village_tract"]
    type_id = refs["types"]["ward" if entity == "ward" else "village_tract"]
    source_type_id = refs["sources"]["partner"]
    name_en = clean(row.get("source_name_en"))
    name_mm = clean(row.get("source_name_my"))
    canonical = name_mm or name_en
    source_key = (
        f"{entity}:{clean(row.get('source_pcode'))}:row{clean(row.get('source_row'))}:"
        f"{Path(clean(row.get('source_file'))).name}"
    )
    plan = {
        "source_key": source_key,
        "action": clean(row.get("action")),
        "outcome": "would_create_mimu_placeholder" if dry_run else "created_mimu_placeholder",
        "coremap_id": "",
        "parent_id": parent_id or "",
        "entity_type": entity,
        "note": "",
    }
    if parent_id is None:
        plan["outcome"] = "create_skipped_unresolved_parent"
        return plan
    if dry_run:
        return plan

    public_id = new_public_id()
    slug = slugify(name_en, source_key)
    marker = {
        IMPORT_MARKER: {
            "source_key": source_key,
            "source_pcode_audit_only": clean(row.get("source_pcode")),
            "mimu_version": MIMU_VERSION,
        }
    }
    cur.execute(
        """
        WITH raw AS (
          SELECT ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326) AS g
        ),
        cleaned AS (
          SELECT CASE WHEN NOT ST_IsValid(g) THEN ST_MakeValid(g) ELSE g END AS g FROM raw
        ),
        normalized AS (
          SELECT ST_Multi(ST_CollectionExtract(g, 3))::geometry(MultiPolygon, 4326) AS g
          FROM cleaned
        ),
        checked AS (
          SELECT g, ST_PointOnSurface(g) AS c
          FROM normalized
          WHERE g IS NOT NULL AND NOT ST_IsEmpty(g) AND ST_IsValid(g)
        )
        INSERT INTO core.core_admin_areas (
          public_id, parent_id, admin_level_id, admin_area_type_id,
          canonical_name, slug, geom, centroid, source_type_id,
          external_id, is_active, is_verified, verification_status,
          boundary_status, is_official_boundary, boundary_confidence_score,
          address_usage, is_public_usable, address_confidence_score,
          geometry_source, reference_source, source_license_status,
          source_refs, normalized_data, boundary_note
        )
        SELECT
          %s::uuid, %s, %s, %s,
          %s, %s, g, c, %s,
          NULL, true, false, 'needs_fix',
          'approximate', false, 50,
          'search_only', true, 50,
          'mimu_placeholder', 'mimu', 'permission_pending',
          %s::jsonb, %s::jsonb,
          'phase5:create_mimu_placeholder'
        FROM checked
        RETURNING id
        """,
        (
            geom_geojson,
            public_id,
            parent_id,
            level_id,
            type_id,
            canonical,
            slug,
            source_type_id,
            json.dumps({"source": "mimu", "source_version": MIMU_VERSION}),
            json.dumps(marker),
        ),
    )
    fetched = cur.fetchone()
    if not fetched:
        plan["outcome"] = "create_skipped_invalid_geometry"
        return plan
    area_id = int(fetched[0])
    plan["coremap_id"] = area_id
    ensure_names(cur, area_id, name_en, name_mm, dry_run=False, set_name_reference=True)
    return plan


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--mode", choices=["dry-run", "apply"], default="dry-run")
    parser.add_argument("--out-dir", type=Path, default=PHASE5)
    args = parser.parse_args()
    dry_run = args.mode == "dry-run"

    local_path, _, _ = require_frozen_manifests()
    rows = load_csv(local_path)
    queue_by_key = {
        clean(r.get("source_key")): r for r in load_csv(REPORTS / "03-local-admin-review-queue.csv")
    }
    merge_dec = load_csv(REPORTS / "03-merge-decisions.csv")

    conn = connect(args.database_url)
    plans: list[dict[str, Any]] = []
    try:
        with conn.cursor() as cur:
            refs = resolve_ref_ids(cur)

            # Soft-retire merge losers first (preserve rows; never hard delete).
            for d in merge_dec:
                if clean(d.get("review_decision")) != "merge_confirmed_duplicate":
                    continue
                surv = as_int(d.get("selected_core_id"))
                for raw in clean(d.get("losing_core_ids")).split(";"):
                    lid = as_int(raw)
                    if not lid or lid == surv:
                        continue
                    soft_retire(
                        cur,
                        lid,
                        dry_run=dry_run,
                        note=f"phase5:merge_loser survivor={surv}",
                    )
                    plans.append(
                        {
                            "source_key": clean(d.get("source_key") or d.get("review_id")),
                            "action": "merge_confirmed_duplicate",
                            "outcome": "soft_retired_loser",
                            "coremap_id": lid,
                            "parent_id": "",
                            "entity_type": "",
                            "note": f"survivor={surv}",
                        }
                    )

            for row in rows:
                action = clean(row.get("action"))
                entity = clean(row.get("source_entity_type"))
                if entity not in {"ward", "village_tract"}:
                    continue
                matched = as_int(row.get("matched_coremap_id"))
                source_key = (
                    f"{entity}:{clean(row.get('source_pcode'))}:row{clean(row.get('source_row'))}"
                )

                if action in {
                    "keep_existing",
                    "update_names",
                    "update_type",
                    "update_parent",
                    "update_names_and_type",
                }:
                    if not matched:
                        plans.append(
                            {
                                "source_key": source_key,
                                "action": action,
                                "outcome": "skip_missing_core_id",
                                "coremap_id": "",
                                "parent_id": clean(row.get("approved_township_id")),
                                "entity_type": entity,
                                "note": "",
                            }
                        )
                        continue
                    # Preserve geometry; optional name update with name_reference=mimu
                    renamed = ensure_names(
                        cur,
                        matched,
                        clean(row.get("source_name_en")),
                        clean(row.get("source_name_my")),
                        dry_run=dry_run,
                        set_name_reference=action.startswith("update_name"),
                    )
                    if action in {"update_type", "update_names_and_type"} and not dry_run:
                        level_id = refs["levels"]["ward_village_tract"]
                        type_id = refs["types"]["ward" if entity == "ward" else "village_tract"]
                        cur.execute(
                            """
                            UPDATE core.core_admin_areas
                            SET admin_level_id=%s, admin_area_type_id=%s, updated_at=now()
                            WHERE id=%s
                              AND (admin_level_id IS DISTINCT FROM %s OR admin_area_type_id IS DISTINCT FROM %s)
                            """,
                            (level_id, type_id, matched, level_id, type_id),
                        )
                    if action in {"update_parent"} and not dry_run:
                        parent = as_int(row.get("approved_township_id"))
                        if parent:
                            cur.execute(
                                """
                                UPDATE core.core_admin_areas
                                SET parent_id=%s, updated_at=now()
                                WHERE id=%s AND parent_id IS DISTINCT FROM %s
                                """,
                                (parent, matched, parent),
                            )
                    # Never set geometry_source=mimu_placeholder on existing matched rows
                    plans.append(
                        {
                            "source_key": source_key,
                            "action": action,
                            "outcome": "updated_preserve_geom" if renamed or action.startswith("update") else "kept",
                            "coremap_id": matched,
                            "parent_id": clean(row.get("approved_township_id")),
                            "entity_type": entity,
                            "note": "geometry_preserved",
                        }
                    )
                    continue

                if action == "create_mimu_placeholder":
                    preview = preview_path_for_row(row, queue_by_key)
                    geom = load_preview_geojson(preview)
                    if not geom:
                        # Try Phase-1/2 comparison geom path conventions — skip if absent
                        plans.append(
                            {
                                "source_key": source_key,
                                "action": action,
                                "outcome": "create_skipped_no_valid_geometry",
                                "coremap_id": "",
                                "parent_id": clean(row.get("approved_township_id")),
                                "entity_type": entity,
                                "note": "geom required; no preview polygon",
                            }
                        )
                        continue
                    plans.append(
                        create_placeholder(cur, row, refs, geom, dry_run=dry_run)
                    )
                    continue

                if action == "reject_source_error":
                    plans.append(
                        {
                            "source_key": source_key,
                            "action": action,
                            "outcome": "rejected_source_skipped",
                            "coremap_id": "",
                            "parent_id": clean(row.get("approved_township_id")),
                            "entity_type": entity,
                            "note": "",
                        }
                    )
                    continue

                if action == "merge_duplicate_candidate":
                    plans.append(
                        {
                            "source_key": source_key,
                            "action": action,
                            "outcome": "merge_survivor_kept",
                            "coremap_id": matched or "",
                            "parent_id": clean(row.get("approved_township_id")),
                            "entity_type": entity,
                            "note": "losers handled via merge decisions",
                        }
                    )
                    continue

                plans.append(
                    {
                        "source_key": source_key,
                        "action": action,
                        "outcome": "unhandled_action",
                        "coremap_id": matched or "",
                        "parent_id": clean(row.get("approved_township_id")),
                        "entity_type": entity,
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
    headers = ["source_key", "action", "outcome", "coremap_id", "parent_id", "entity_type", "note"]
    write_csv(out / "05-admin-import-plan.csv", plans, headers)
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": args.mode,
        "manifest": str(local_path.relative_to(REPO)),
        "counts": dict(Counter(p["outcome"] for p in plans)),
        "production_writes": not dry_run,
    }
    (out / "05-admin-import-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))
    print(f"Wrote {out / '05-admin-import-plan.csv'}")
    if dry_run:
        print("DRY-RUN only — no production changes committed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
