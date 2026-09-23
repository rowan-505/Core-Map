#!/usr/bin/env python3
"""Phase 6 region-scoped apply on disposable / non-production databases only.

One state/region per transaction. Default is dry-run. Apply requires an
explicit non-production host (or --allow-disposable-host).

Usage:
  uv run --with 'psycopg[binary]' python tools/admin-reconciliation/phase6/apply_region.py \\
    --database-url "$LOCAL_DATABASE_URL" --mode dry-run|apply
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "phase5"))
from _common import (  # noqa: E402
    FROZEN,
    IMPORT_MARKER,
    MIMU_VERSION,
    POSTAL_SOURCE_VERSION,
    REPORTS,
    as_int,
    clean,
    connect,
    json_merge_patch,
    load_csv,
    new_public_id,
    require_frozen_manifests,
    resolve_ref_ids,
    slugify,
    write_csv,
)

REPO = Path(__file__).resolve().parents[3]
PHASE6 = REPORTS / "phase6"
SEVEN = re.compile(r"^[0-9]{7}$")

PRODUCTION_HOST_MARKERS = (
    "locghyuranqaqsnbxflc",
    "supabase.co",
    "pooler.supabase.com",
)

ENTITY_REPORT_FIELDS = (
    "entity",
    "source_count",
    "matched",
    "updated",
    "merged",
    "created_placeholder",
    "rejected",
    "manual_review",
    "unaccounted",
)

POSTAL_REGION_MAP = {
    "Ayeyarwady Region": "Ayeyarwady",
    "Sagaing Region": "Sagaing",
    "Magway Region": "Magway",
    "Mandalay Region": "Mandalay",
    "Yangon Region": "Yangon",
    "Rakhine State": "Rakhine",
    "Shan State (North)": "Shan (North)",
    "Shan State (South)": "Shan (South)",
    "Shan State (East)": "Shan (East)",
    "Bago Region (East)": "Bago (East)",
    "Bago Region (West)": "Bago (West)",
    "Kachin State": "Kachin",
    "Chin State": "Chin",
    "Mon State": "Mon",
    "Kayin State": "Kayin",
    "Tanintharyi Region": "Tanintharyi",
    "Naypyitaw Union Territory": "Nay Pyi Taw",
    "Kayah state": "Kayah",
    "Kayah State": "Kayah",
}

ALLOWED_POSTAL_STATUS = {
    "linked_exact_local_area",
    "linked_after_review",
    "ambiguous_local_area",
    "missing_local_area",
    "non_admin_postal_locality",
}


def assert_disposable_url(url: str, allow: bool) -> None:
    host = (urlparse(url).hostname or "").lower()
    if allow:
        return
    if any(m in url.lower() or m in host for m in PRODUCTION_HOST_MARKERS):
        raise SystemExit(
            f"Refusing production-like host '{host}'. "
            "Use disposable Docker/local URL, or pass --allow-disposable-host only for a "
            "confirmed Supabase development branch (never production)."
        )
    if host not in {"127.0.0.1", "localhost"} and not allow:
        raise SystemExit(
            f"Host '{host}' is not localhost. Pass --allow-disposable-host only for a "
            "confirmed disposable / development-branch database."
        )


def empty_counts(entity: str) -> dict[str, Any]:
    return {k: (entity if k == "entity" else 0) for k in ENTITY_REPORT_FIELDS}


def source_key(row: dict[str, str]) -> str:
    entity = clean(row.get("source_entity_type"))
    pcode = clean(row.get("source_pcode")) or "nopcode"
    srow = clean(row.get("source_row"))
    safe_file = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(clean(row.get("source_file"))).name)[:80]
    return f"{entity}:{pcode}:row{srow}:{safe_file}"


def load_geom_index() -> dict[str, str]:
    """Map source_pcode -> GeoJSON geometry string from Phase-1 normalized files."""
    index: dict[str, str] = {}
    for name in ("01-wards-normalized.geojson", "01-village-tracts-normalized.geojson"):
        path = REPORTS / name
        if not path.exists():
            raise SystemExit(f"Missing geometry file: {path}")
        data = json.loads(path.read_text(encoding="utf-8"))
        for feat in data.get("features") or []:
            props = feat.get("properties") or {}
            pcode = clean(props.get("source_pcode"))
            geom = feat.get("geometry")
            if pcode and geom and geom.get("type") in {"Polygon", "MultiPolygon"}:
                index[pcode] = json.dumps(geom)
    # Clip overrides (Phase-3 create_new+clip)
    clip_path = REPORTS / "03-local-create-new-clip-plan.csv"
    if clip_path.exists():
        for row in load_csv(clip_path):
            if clean(row.get("status")) != "ok":
                continue
            preview = clean(row.get("preview_path"))
            pcode = clean(row.get("source_pcode"))
            if not preview or not pcode:
                continue
            candidates = [
                REPO / preview,
                REPORTS / "phase3-previews" / Path(preview).name,
                REPORTS / "phase3-previews" / f"{Path(preview).name}.geojson",
            ]
            path = next((p for p in candidates if p.exists()), None)
            if not path:
                continue
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            g = None
            if data.get("type") == "FeatureCollection":
                for feat in data.get("features") or []:
                    gg = feat.get("geometry")
                    if gg and gg.get("type") in {"Polygon", "MultiPolygon"}:
                        g = gg
                        break
            elif data.get("type") == "Feature":
                g = data.get("geometry")
            elif data.get("type") in {"Polygon", "MultiPolygon"}:
                g = data
            if g:
                index[pcode] = json.dumps(g)
    return index


def snapshot_matched_hashes(cur, admin_ids: list[int], settlement_ids: list[int]) -> dict[str, Any]:
    admin: dict[int, str] = {}
    settle: dict[int, str] = {}
    if admin_ids:
        cur.execute(
            """
            SELECT id, md5(ST_AsBinary(geom))
            FROM core.core_admin_areas
            WHERE id = ANY(%s) AND geom IS NOT NULL
            """,
            (admin_ids,),
        )
        admin = {int(i): h for i, h in cur.fetchall()}
    if settlement_ids:
        cur.execute(
            """
            SELECT id, md5(ST_AsBinary(point_geom))
            FROM core.core_settlements
            WHERE id = ANY(%s) AND point_geom IS NOT NULL
            """,
            (settlement_ids,),
        )
        settle = {int(i): h for i, h in cur.fetchall()}
    return {"admin_geom_md5": admin, "settlement_point_md5": settle}


def ensure_admin_names(
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
            WHERE admin_area_id=%s AND language_code=%s AND is_primary IS TRUE
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
                "UPDATE core.core_admin_area_names SET name=%s WHERE id=%s",
                (name, row[0]),
            )
        else:
            cur.execute(
                """
                INSERT INTO core.core_admin_area_names (
                  admin_area_id, name, language_code, name_type, is_primary
                ) VALUES (%s,%s,%s,'imported',true)
                """,
                (area_id, name, lang),
            )
    if changed and set_name_reference and not dry_run:
        cur.execute(
            """
            UPDATE core.core_admin_areas
            SET source_refs = coalesce(source_refs,'{}'::jsonb)
              || jsonb_build_object('name_reference','mimu'),
                updated_at = now()
            WHERE id=%s
            """,
            (area_id,),
        )
    return changed


def soft_retire_admin(cur, area_id: int, note: str, *, dry_run: bool) -> None:
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


def soft_retire_settlement(cur, settlement_id: int, *, dry_run: bool) -> None:
    if dry_run:
        return
    cur.execute(
        """
        UPDATE core.core_settlements
        SET deleted_at=COALESCE(deleted_at, now()), updated_at=now()
        WHERE id=%s AND deleted_at IS NULL
        """,
        (settlement_id,),
    )


def discover_admin_fk_targets(cur) -> list[tuple[str, str, str]]:
    """Return (schema, table, column) that reference core.core_admin_areas(id)."""
    cur.execute(
        """
        SELECT n.nspname, c.relname, a.attname
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (con.conkey)
        JOIN pg_class refc ON refc.oid = con.confrelid
        JOIN pg_namespace refn ON refn.oid = refc.relnamespace
        WHERE con.contype = 'f'
          AND refn.nspname = 'core' AND refc.relname = 'core_admin_areas'
          AND NOT (n.nspname='core' AND c.relname='core_admin_areas' AND a.attname='id')
        ORDER BY 1,2,3
        """
    )
    return [(r[0], r[1], r[2]) for r in cur.fetchall()]


def repoint_admin_deps(cur, loser_id: int, survivor_id: int, targets: list[tuple[str, str, str]], *, dry_run: bool) -> None:
    if dry_run:
        return
    for schema, table, column in targets:
        if schema == "core" and table == "core_admin_areas" and column == "parent_id":
            cur.execute(
                f'UPDATE "{schema}"."{table}" SET "{column}"=%s, updated_at=now() WHERE "{column}"=%s',
                (survivor_id, loser_id),
            )
        elif schema == "core" and table == "core_admin_area_names" and column == "admin_area_id":
            # Keep names on loser for history; do not move primary names blindly.
            continue
        else:
            # Best-effort repoint when column exists; skip if table missing updated_at.
            cur.execute(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_schema=%s AND table_name=%s AND column_name='updated_at'
                """,
                (schema, table),
            )
            has_updated = cur.fetchone() is not None
            sql = f'UPDATE "{schema}"."{table}" SET "{column}"=%s'
            if has_updated:
                sql += ", updated_at=now()"
            sql += f' WHERE "{column}"=%s'
            cur.execute(sql, (survivor_id, loser_id))


def create_admin_placeholder(
    cur,
    row: dict[str, str],
    refs: dict[str, Any],
    geom_geojson: str,
    *,
    dry_run: bool,
) -> str:
    parent_id = as_int(row.get("approved_township_id"))
    entity = clean(row.get("source_entity_type"))
    if parent_id is None:
        return "create_skipped_unresolved_parent"
    sk = source_key(row)
    cur.execute(
        """
        SELECT id FROM core.core_admin_areas
        WHERE deleted_at IS NULL
          AND geometry_source='mimu_placeholder'
          AND normalized_data->>'source_key' = %s
        LIMIT 1
        """,
        (sk,),
    )
    if cur.fetchone():
        return "already_created"
    if dry_run:
        return "would_create_placeholder"
    level_id = refs["levels"]["ward_village_tract"]
    type_id = refs["types"]["ward" if entity == "ward" else "village_tract"]
    source_type_id = refs["sources"]["partner"]
    name_en = clean(row.get("source_name_en"))
    name_mm = clean(row.get("source_name_my"))
    canonical = name_mm or name_en or clean(row.get("source_pcode")) or "unnamed"
    public_id = new_public_id()
    slug = slugify(name_en or canonical, sk)
    marker = {
        IMPORT_MARKER: True,
        "source_key": sk,
        "source_pcode_audit_only": clean(row.get("source_pcode")),
        "mimu_version": MIMU_VERSION,
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
          'phase6:create_mimu_placeholder'
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
        return "create_skipped_invalid_geometry"
    ensure_admin_names(
        cur, int(fetched[0]), name_en, name_mm, dry_run=False, set_name_reference=True
    )
    return "created_placeholder"


def normalize_postal_status(raw: str) -> str:
    s = clean(raw)
    if s in ALLOWED_POSTAL_STATUS:
        return s
    return {
        "linked_local_area": "linked_exact_local_area",
        "linked_township_only": "missing_local_area",
        "ambiguous": "ambiguous_local_area",
        "unmatched": "missing_local_area",
    }.get(s, "missing_local_area")


def process_region(
    cur,
    region: str,
    local_rows: list[dict[str, str]],
    village_rows: list[dict[str, str]],
    postal_rows: list[dict[str, str]],
    merge_admin: list[dict[str, str]],
    merge_village: list[dict[str, str]],
    refs: dict[str, Any],
    geom_index: dict[str, str],
    fk_targets: list[tuple[str, str, str]],
    *,
    dry_run: bool,
) -> dict[str, dict[str, Any]]:
    report = {
        "ward": empty_counts("ward"),
        "village_tract": empty_counts("village_tract"),
        "village": empty_counts("village"),
        "postal": empty_counts("postal"),
    }

    # ---- 1) Admin name/type/parent updates ----
    for row in local_rows:
        entity = clean(row.get("source_entity_type"))
        if entity not in report:
            continue
        action = clean(row.get("action"))
        report[entity]["source_count"] += 1
        matched = as_int(row.get("matched_coremap_id"))

        if action in {"manual_review", "defer", ""}:
            report[entity]["manual_review"] += 1
            continue
        if action == "reject_source_error":
            report[entity]["rejected"] += 1
            continue
        if action in {
            "keep_existing",
            "update_names",
            "update_type",
            "update_parent",
            "update_names_and_type",
        }:
            if not matched:
                report[entity]["unaccounted"] += 1
                continue
            report[entity]["matched"] += 1
            renamed = ensure_admin_names(
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
            if action == "update_parent" and not dry_run:
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
            if renamed or action.startswith("update"):
                report[entity]["updated"] += 1
            continue
        if action == "merge_duplicate_candidate":
            # counted in merge step
            report[entity]["matched"] += 1
            continue
        if action == "create_mimu_placeholder":
            # counted in create step
            continue
        report[entity]["unaccounted"] += 1

    # ---- 2) Admin merges ----
    for d in merge_admin:
        surv = as_int(d.get("selected_core_id") or d.get("survivor_core_id"))
        losers_raw = clean(d.get("losing_core_ids") or d.get("duplicate_core_ids"))
        entity_guess = clean(d.get("entity_type")) or "ward"
        if entity_guess not in {"ward", "village_tract"}:
            entity_guess = "ward"
        for raw in losers_raw.replace(",", ";").split(";"):
            lid = as_int(raw)
            if not lid or lid == surv:
                continue
            if surv:
                repoint_admin_deps(cur, lid, surv, fk_targets, dry_run=dry_run)
            soft_retire_admin(
                cur, lid, f"phase6:merge_loser survivor={surv}", dry_run=dry_run
            )
            report[entity_guess]["merged"] += 1

    # ---- 3) Admin placeholder creates ----
    for row in local_rows:
        entity = clean(row.get("source_entity_type"))
        if entity not in {"ward", "village_tract"}:
            continue
        if clean(row.get("action")) != "create_mimu_placeholder":
            continue
        pcode = clean(row.get("source_pcode"))
        geom = geom_index.get(pcode)
        if not geom:
            report[entity]["unaccounted"] += 1
            continue
        outcome = create_admin_placeholder(cur, row, refs, geom, dry_run=dry_run)
        if outcome in {"created_placeholder", "would_create_placeholder", "already_created"}:
            report[entity]["created_placeholder"] += 1
        elif outcome.startswith("create_skipped"):
            report[entity]["unaccounted"] += 1
        else:
            report[entity]["unaccounted"] += 1

    # ---- 4–6) Villages ----
    cur.execute("SELECT id FROM ref.ref_settlement_types WHERE code='village' LIMIT 1")
    st = cur.fetchone()
    if not st:
        raise SystemExit("ref.ref_settlement_types.code=village missing")
    village_type_id = int(st[0])
    partner_id = refs["sources"]["partner"]

    for row in village_rows:
        report["village"]["source_count"] += 1
        action = clean(row.get("action"))
        matched = as_int(row.get("matched_coremap_id"))
        name_en = clean(row.get("source_name_en"))
        name_mm = clean(row.get("source_name_my"))
        township_id = as_int(row.get("approved_township_id"))

        if action in {"manual_review", "defer", ""}:
            report["village"]["manual_review"] += 1
            continue
        if action == "reject_source_error":
            report["village"]["rejected"] += 1
            continue
        if action in {
            "keep_existing",
            "update_names",
            "update_parent",
            "update_type",
        }:
            if not matched:
                report["village"]["unaccounted"] += 1
                continue
            report["village"]["matched"] += 1
            if dry_run:
                if action.startswith("update"):
                    report["village"]["updated"] += 1
                continue
            cur.execute(
                """
                SELECT id, source_refs, name_en, name_mm
                FROM core.core_settlements
                WHERE id=%s AND deleted_at IS NULL
                """,
                (matched,),
            )
            existing = cur.fetchone()
            if not existing:
                report["village"]["unaccounted"] += 1
                continue
            _id, source_refs, old_en, old_mm = existing
            names_changed = (name_en and name_en != clean(old_en)) or (
                name_mm and name_mm != clean(old_mm)
            )
            patch: dict[str, Any] = {
                "source": "mimu",
                "source_version": MIMU_VERSION,
                IMPORT_MARKER: True,
            }
            if names_changed or action == "update_names":
                patch["name_reference"] = "mimu"
            merged = json_merge_patch(source_refs, patch)
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
                    matched,
                ),
            )
            if names_changed or action.startswith("update"):
                report["village"]["updated"] += 1
            continue
        if action == "merge_duplicate_candidate":
            report["village"]["matched"] += 1
            continue
        if action == "create_mimu_placeholder":
            lon = lat = None
            try:
                if clean(row.get("source_lon")) and clean(row.get("source_lat")):
                    lon = float(row["source_lon"])
                    lat = float(row["source_lat"])
            except (TypeError, ValueError):
                lon = lat = None
            if lon is None or lat is None:
                report["village"]["unaccounted"] += 1
                continue
            # Idempotent: skip if a Phase-6 placeholder already exists for this pcode+coords
            sk = source_key(row)
            cur.execute(
                """
                SELECT id FROM core.core_settlements
                WHERE deleted_at IS NULL
                  AND coalesce(source_refs->>'geometry_status','')='mimu_placeholder'
                  AND coalesce(source_refs->>'source_key','')=%s
                LIMIT 1
                """,
                (sk,),
            )
            if cur.fetchone():
                report["village"]["created_placeholder"] += 1
                continue
            if dry_run:
                report["village"]["created_placeholder"] += 1
                continue
            refs_json = {
                "source": "mimu",
                "source_version": MIMU_VERSION,
                "geometry_status": "mimu_placeholder",
                "needs_geometry_replacement": True,
                "source_key": sk,
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
                    new_public_id(),
                    village_type_id,
                    name_mm or name_en or "unnamed",
                    name_mm,
                    name_en,
                    lon,
                    lat,
                    township_id,
                    partner_id,
                    json.dumps(refs_json),
                ),
            )
            if cur.fetchone():
                report["village"]["created_placeholder"] += 1
            else:
                report["village"]["unaccounted"] += 1
            continue
        report["village"]["unaccounted"] += 1

    # Village merges
    for d in merge_village:
        surv = as_int(d.get("selected_core_id") or d.get("survivor_core_id"))
        losers_raw = clean(d.get("losing_core_ids") or d.get("duplicate_core_ids"))
        for raw in losers_raw.replace(",", ";").split(";"):
            lid = as_int(raw)
            if not lid or lid == surv:
                continue
            soft_retire_settlement(cur, lid, dry_run=dry_run)
            report["village"]["merged"] += 1

    # ---- 7–8) Postal upsert + exact local link ----
    # Detect mm vs my columns
    cur.execute(
        """
        SELECT column_name FROM information_schema.columns
        WHERE table_schema='ref' AND table_name='ref_postal_codes'
        """
    )
    cols = {r[0] for r in cur.fetchall()}
    cur.execute("SELECT to_regclass('ref.ref_postal_codes')")
    if cur.fetchone()[0] is None:
        raise SystemExit("ref.ref_postal_codes missing — apply Phase 5 DDL on disposable first")

    mm = "region_name_mm" in cols
    region_mm_col = "region_name_mm" if mm else "region_name_my"
    tsp_mm_col = "township_name_mm" if mm else "township_name_my"
    loc_mm_col = "locality_name_mm" if mm else "locality_name_my"

    # Active admin ids for FK safety
    ids = sorted(
        {
            i
            for r in postal_rows
            for i in (
                as_int(r.get("matched_township_id")),
                as_int(r.get("matched_local_admin_area_id")),
            )
            if i
        }
    )
    active: set[int] = set()
    if ids:
        cur.execute(
            """
            SELECT id FROM core.core_admin_areas
            WHERE id = ANY(%s) AND is_active IS TRUE AND deleted_at IS NULL
            """,
            (ids,),
        )
        active = {int(r[0]) for r in cur.fetchall()}

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

    seen_codes: set[str] = set()
    for r in postal_rows:
        report["postal"]["source_count"] += 1
        code = clean(r.get("postal_code"))
        status_raw = clean(r.get("status"))
        if status_raw == "malformed_rejected" or not SEVEN.fullmatch(code):
            report["postal"]["rejected"] += 1
            continue
        if code in seen_codes:
            report["postal"]["unaccounted"] += 1
            continue
        seen_codes.add(code)
        status = normalize_postal_status(status_raw)
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
                status = "missing_local_area"
        if loc and not tsp:
            loc = None
        loc_type = clean(r.get("inferred_locality_type") or r.get("locality_type"))
        if loc_type not in {"ward", "village_tract"}:
            loc_type = None

        if status == "linked_exact_local_area" and loc:
            report["postal"]["matched"] += 1
        elif status in {"linked_after_review"} and loc:
            report["postal"]["matched"] += 1
            report["postal"]["updated"] += 1
        elif status in {"ambiguous_local_area"}:
            report["postal"]["manual_review"] += 1
        elif status == "missing_local_area":
            report["postal"]["unaccounted"] += 1
        else:
            report["postal"]["unaccounted"] += 1

        if dry_run:
            report["postal"]["created_placeholder"] += 1  # upsert planned
            continue

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
        cur.execute(upsert_sql, payload)
        report["postal"]["created_placeholder"] += 1  # upserted row

    return report


def run_validation(cur, pre: dict[str, Any], matched_admin: list[int], matched_settle: list[int]) -> dict[str, Any]:
    post = snapshot_matched_hashes(cur, matched_admin, matched_settle)
    admin_changed = sum(
        1
        for i, h in pre["admin_geom_md5"].items()
        if post["admin_geom_md5"].get(i) and post["admin_geom_md5"][i] != h
    )
    settle_changed = sum(
        1
        for i, h in pre["settlement_point_md5"].items()
        if post["settlement_point_md5"].get(i) and post["settlement_point_md5"][i] != h
    )
    cur.execute(
        """
        SELECT count(*) FROM core.core_admin_areas
        WHERE geometry_source='mimu_placeholder'
          AND deleted_at IS NULL
          AND (geom IS NULL OR ST_IsEmpty(geom) OR NOT ST_IsValid(geom))
        """
    )
    bad_admin = int(cur.fetchone()[0])
    cur.execute(
        """
        SELECT count(*) FROM core.core_settlements s
        WHERE deleted_at IS NULL
          AND coalesce(s.source_refs->>'geometry_status','')='mimu_placeholder'
          AND (point_geom IS NULL OR ST_IsEmpty(point_geom) OR NOT ST_IsValid(point_geom))
        """
    )
    bad_settle = int(cur.fetchone()[0])
    cur.execute(
        """
        SELECT count(*) FROM core.core_admin_areas a
        JOIN ref.ref_admin_levels l ON l.id=a.admin_level_id
        LEFT JOIN core.core_admin_areas p ON p.id=a.parent_id
        LEFT JOIN ref.ref_admin_levels pl ON pl.id=p.admin_level_id
        WHERE a.geometry_source='mimu_placeholder'
          AND a.deleted_at IS NULL AND a.is_active
          AND l.code='ward_village_tract'
          AND (pl.code IS DISTINCT FROM 'township')
        """
    )
    bad_parent = int(cur.fetchone()[0])
    cur.execute(
        """
        SELECT count(*) FROM core.core_admin_areas a
        JOIN ref.ref_admin_levels l ON l.id=a.admin_level_id
        JOIN ref.ref_admin_area_types t ON t.id=a.admin_area_type_id
        WHERE a.geometry_source='mimu_placeholder'
          AND a.deleted_at IS NULL
          AND l.code='ward_village_tract'
          AND t.code NOT IN ('ward','village_tract')
        """
    )
    bad_type = int(cur.fetchone()[0])
    # Baseline (pre-existing) WVT anomalies — reported but not Phase-6 fail gates
    cur.execute(
        """
        SELECT count(*) FROM core.core_admin_areas a
        JOIN ref.ref_admin_levels l ON l.id=a.admin_level_id
        LEFT JOIN core.core_admin_areas p ON p.id=a.parent_id
        LEFT JOIN ref.ref_admin_levels pl ON pl.id=p.admin_level_id
        WHERE l.code='ward_village_tract' AND a.deleted_at IS NULL AND a.is_active
          AND coalesce(a.geometry_source,'') <> 'mimu_placeholder'
          AND (pl.code IS DISTINCT FROM 'township')
        """
    )
    baseline_bad_parent = int(cur.fetchone()[0])
    cur.execute(
        """
        SELECT count(*) FROM core.core_admin_areas a
        JOIN ref.ref_admin_levels l ON l.id=a.admin_level_id
        JOIN ref.ref_admin_area_types t ON t.id=a.admin_area_type_id
        WHERE l.code='ward_village_tract' AND a.deleted_at IS NULL
          AND coalesce(a.geometry_source,'') <> 'mimu_placeholder'
          AND t.code NOT IN ('ward','village_tract')
        """
    )
    baseline_bad_type = int(cur.fetchone()[0])
    cur.execute(
        """
        SELECT count(*) AS total,
               count(DISTINCT postal_code) AS distinct_codes,
               count(*) FILTER (WHERE postal_code !~ '^[0-9]{7}$') AS bad_codes
        FROM ref.ref_postal_codes
        """
    )
    total, distinct, bad_codes = cur.fetchone()
    cur.execute(
        """
        SELECT count(*) FROM ref.ref_postal_codes p
        JOIN core.core_admin_areas loc ON loc.id=p.local_admin_area_id
        WHERE p.local_admin_area_id IS NOT NULL
          AND p.township_admin_area_id IS NOT NULL
          AND loc.parent_id IS DISTINCT FROM p.township_admin_area_id
        """
    )
    bad_postal_link = int(cur.fetchone()[0])
    cur.execute(
        """
        SELECT count(*) FROM core.core_admin_areas
        WHERE geometry_source='mimu_placeholder' AND deleted_at IS NULL
          AND (
            reference_source IS DISTINCT FROM 'mimu'
            OR source_license_status IS DISTINCT FROM 'permission_pending'
            OR verification_status IS DISTINCT FROM 'needs_fix'
            OR is_verified IS DISTINCT FROM false
            OR boundary_status IS DISTINCT FROM 'approximate'
            OR is_official_boundary IS DISTINCT FROM false
          )
        """
    )
    bad_tag = int(cur.fetchone()[0])
    return {
        "matched_admin_geom_changed": admin_changed,
        "matched_settlement_point_changed": settle_changed,
        "invalid_new_admin_geom": bad_admin,
        "invalid_new_village_point": bad_settle,
        "placeholder_parent_not_township": bad_parent,
        "placeholder_type_not_ward_or_vt": bad_type,
        "baseline_local_parent_not_township": baseline_bad_parent,
        "baseline_local_type_not_ward_or_vt": baseline_bad_type,
        "postal_total": int(total),
        "postal_distinct": int(distinct),
        "postal_bad_codes": int(bad_codes),
        "postal_local_township_mismatch": bad_postal_link,
        "placeholder_meta_mismatch": bad_tag,
        "pass": all(
            v == 0
            for k, v in {
                "matched_admin_geom_changed": admin_changed,
                "matched_settlement_point_changed": settle_changed,
                "invalid_new_admin_geom": bad_admin,
                "invalid_new_village_point": bad_settle,
                "placeholder_parent_not_township": bad_parent,
                "placeholder_type_not_ward_or_vt": bad_type,
                "postal_bad_codes": int(bad_codes),
                "postal_dupes": int(total) - int(distinct),
                "postal_local_township_mismatch": bad_postal_link,
                "placeholder_meta_mismatch": bad_tag,
            }.items()
        )
        and int(total) == 17297
        and int(distinct) == 17297,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--mode", choices=["dry-run", "apply"], default="dry-run")
    parser.add_argument("--out-dir", type=Path, default=PHASE6)
    parser.add_argument(
        "--allow-disposable-host",
        action="store_true",
        help="Allow non-localhost disposable hosts (development branch). Never production.",
    )
    parser.add_argument("--regions", nargs="*", help="Optional subset of source_region names")
    args = parser.parse_args()
    dry_run = args.mode == "dry-run"
    assert_disposable_url(args.database_url, args.allow_disposable_host)

    local_path, village_path, postal_path = require_frozen_manifests()
    local_rows = load_csv(local_path)
    village_rows = load_csv(village_path)
    postal_rows = load_csv(postal_path)
    merge_dec = load_csv(REPORTS / "03-merge-decisions.csv")

    # Split merges by entity
    merge_admin = [
        d
        for d in merge_dec
        if clean(d.get("review_decision")) == "merge_confirmed_duplicate"
        and clean(d.get("entity_type") or d.get("source_entity_type")) in {"ward", "village_tract", ""}
        and not clean(d.get("source_key") or "").startswith("village:")
    ]
    # Prefer entity from source_key
    merge_admin = []
    merge_village = []
    for d in merge_dec:
        if clean(d.get("review_decision")) != "merge_confirmed_duplicate":
            continue
        sk = clean(d.get("source_key") or d.get("review_id"))
        if sk.startswith("village:") or clean(d.get("entity_type")) == "village":
            merge_village.append(d)
        else:
            merge_admin.append(d)

    print("Loading geometry index...")
    geom_index = load_geom_index()
    print(f"Geometry index size: {len(geom_index)}")

    # Group by region
    local_by: dict[str, list] = defaultdict(list)
    for r in local_rows:
        local_by[clean(r.get("source_region")) or "_unknown"].append(r)
    village_by: dict[str, list] = defaultdict(list)
    for r in village_rows:
        village_by[clean(r.get("source_region")) or "_unknown"].append(r)
    postal_by: dict[str, list] = defaultdict(list)
    for r in postal_rows:
        region = POSTAL_REGION_MAP.get(clean(r.get("region_en")), clean(r.get("region_en")) or "_unknown")
        # normalize Nay Pyi Taw naming
        if region in {"Naypyitaw", "Nay Pyi Taw Union Territory"}:
            region = "Nay Pyi Taw"
        postal_by[region].append(r)

    regions = sorted(set(local_by) | set(village_by) | set(postal_by))
    if args.regions:
        regions = [r for r in regions if r in set(args.regions)]

    # Matched IDs for hash guard
    matched_admin = sorted(
        {
            i
            for r in local_rows
            if clean(r.get("action"))
            in {
                "keep_existing",
                "update_names",
                "update_type",
                "update_parent",
                "update_names_and_type",
                "merge_duplicate_candidate",
            }
            for i in [as_int(r.get("matched_coremap_id"))]
            if i
        }
    )
    matched_settle = sorted(
        {
            i
            for r in village_rows
            if clean(r.get("action"))
            in {
                "keep_existing",
                "update_names",
                "update_parent",
                "update_type",
                "merge_duplicate_candidate",
            }
            for i in [as_int(r.get("matched_coremap_id"))]
            if i
        }
    )

    # Filter merges to region by survivor township? Apply all merges in first region
    # that owns the survivor, or apply merges once globally before regions.
    # Spec: one region per transaction — attach merges when survivor's matched row region matches.
    admin_id_region: dict[int, str] = {}
    for r in local_rows:
        mid = as_int(r.get("matched_coremap_id"))
        if mid:
            admin_id_region.setdefault(mid, clean(r.get("source_region")) or "_unknown")
    settle_id_region: dict[int, str] = {}
    for r in village_rows:
        mid = as_int(r.get("matched_coremap_id"))
        if mid:
            settle_id_region.setdefault(mid, clean(r.get("source_region")) or "_unknown")

    merges_admin_by: dict[str, list] = defaultdict(list)
    for d in merge_admin:
        surv = as_int(d.get("selected_core_id"))
        region = admin_id_region.get(surv or -1, "_unknown")
        merges_admin_by[region].append(d)
    merges_village_by: dict[str, list] = defaultdict(list)
    for d in merge_village:
        surv = as_int(d.get("selected_core_id"))
        region = settle_id_region.get(surv or -1, "_unknown")
        merges_village_by[region].append(d)

    out = args.out_dir
    out.mkdir(parents=True, exist_ok=True)
    conn = connect(args.database_url)
    region_reports: list[dict[str, Any]] = []
    try:
        with conn.cursor() as cur:
            # Pre-run counts
            cur.execute(
                """
                SELECT
                  (SELECT count(*) FROM core.core_admin_areas WHERE deleted_at IS NULL) AS admin,
                  (SELECT count(*) FROM core.core_settlements WHERE deleted_at IS NULL) AS settlements,
                  (SELECT count(*) FROM ref.ref_postal_codes) AS postal,
                  (SELECT count(*) FROM core.core_admin_areas WHERE geometry_source='mimu_placeholder' AND deleted_at IS NULL) AS placeholders
                """
            )
            pre_counts = dict(
                zip(["admin", "settlements", "postal", "placeholders"], cur.fetchone())
            )
            print("PRE-RUN COUNTS:", json.dumps(pre_counts, default=int))
            (out / "06-pre-run-counts.json").write_text(
                json.dumps(
                    {"generated_at": datetime.now(timezone.utc).isoformat(), **pre_counts},
                    indent=2,
                    default=int,
                )
                + "\n"
            )

            print("Snapshotting matched geometry hashes...")
            pre_hashes = snapshot_matched_hashes(cur, matched_admin, matched_settle)
            (out / "06-pre-geom-hashes.json").write_text(
                json.dumps(
                    {
                        "admin_count": len(pre_hashes["admin_geom_md5"]),
                        "settlement_count": len(pre_hashes["settlement_point_md5"]),
                        "admin_sha256": hashlib.sha256(
                            json.dumps(pre_hashes["admin_geom_md5"], sort_keys=True).encode()
                        ).hexdigest(),
                        "settlement_sha256": hashlib.sha256(
                            json.dumps(
                                pre_hashes["settlement_point_md5"], sort_keys=True
                            ).encode()
                        ).hexdigest(),
                    },
                    indent=2,
                )
                + "\n"
            )
            # Keep full hash map for validation (may be large)
            (out / "06-pre-geom-hashes-full.json").write_text(
                json.dumps({str(k): v for k, v in pre_hashes["admin_geom_md5"].items()}) 
            )

            refs = resolve_ref_ids(cur)
            fk_targets = discover_admin_fk_targets(cur)
            print(f"FK repoint targets: {len(fk_targets)}")

            for region in regions:
                print(f"\n=== REGION {region} ===")
                # One transaction per region
                report = process_region(
                    cur,
                    region,
                    local_by.get(region, []),
                    village_by.get(region, []),
                    postal_by.get(region, []),
                    merges_admin_by.get(region, []),
                    merges_village_by.get(region, []),
                    refs,
                    geom_index,
                    fk_targets,
                    dry_run=dry_run,
                )
                if dry_run:
                    conn.rollback()
                else:
                    conn.commit()
                # After commit/rollback, begin next implicitly
                row_out = {"region": region, "entities": report}
                region_reports.append(row_out)
                # Print per-entity table
                for ent in ("ward", "village_tract", "village", "postal"):
                    e = report[ent]
                    print(
                        f"{ent:14} src={e['source_count']:5} matched={e['matched']:5} "
                        f"upd={e['updated']:4} merged={e['merged']:4} "
                        f"created={e['created_placeholder']:5} rej={e['rejected']:3} "
                        f"manual={e['manual_review']:3} unacc={e['unaccounted']:5}"
                    )
                write_csv(
                    out / f"06-region-{re.sub(r'[^A-Za-z0-9]+','_', region)}.csv",
                    [report[e] for e in ("ward", "village_tract", "village", "postal")],
                    list(ENTITY_REPORT_FIELDS),
                )

            # Final validation (needs data committed — dry-run validates pre-state + logic only)
            if dry_run:
                # Re-open fresh transaction for read-only validation of baseline
                validation = run_validation(cur, pre_hashes, matched_admin, matched_settle)
                validation["note"] = "dry-run: geom-change checks should be 0 on baseline; creates not persisted"
            else:
                validation = run_validation(cur, pre_hashes, matched_admin, matched_settle)

        summary = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "mode": args.mode,
            "database_host": urlparse(args.database_url).hostname,
            "production_writes": not dry_run,
            "pre_counts": pre_counts,
            "regions": len(region_reports),
            "validation": validation,
            "totals": {},
        }
        totals = Counter()
        for rr in region_reports:
            for ent, e in rr["entities"].items():
                for k in ENTITY_REPORT_FIELDS:
                    if k == "entity":
                        continue
                    totals[f"{ent}.{k}"] += int(e[k])
        summary["totals"] = dict(totals)
        (out / "06-summary.json").write_text(json.dumps(summary, indent=2, default=int) + "\n")
        (out / "06-region-reports.json").write_text(
            json.dumps(region_reports, indent=2, default=int) + "\n"
        )
        print("\nVALIDATION:", json.dumps(validation, indent=2, default=int))
        print(f"Wrote {out / '06-summary.json'}")
        if dry_run:
            print("DRY-RUN only — no production / disposable commits.")
    finally:
        conn.close()
    return 0 if summary.get("validation", {}).get("pass") or dry_run else 1


if __name__ == "__main__":
    raise SystemExit(main())
