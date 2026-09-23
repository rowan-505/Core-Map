#!/usr/bin/env python3
"""Generate the approved one-time CoreMap admin/postal reconciliation migration.

The generator consumes the reviewed Phase 1 CSVs and the pinned local OSM
extract.  It never connects to PostgreSQL.  All comparison tables created by
the generated SQL are temporary and disappear at commit.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any


MIMU_VERSION = "9.7 (January 2026)"
MIMU_SOURCE_URL = "https://themimu.info/place-codes"
POSTAL_VERSION = "V1.0 (September 2021)"
POSTAL_SOURCE_URL = "https://github.com/MyanmarPost/MyanmarPostalCode"
RELEASE_KEY = "admin_postal_reconciliation_20260921"

csv.field_size_limit(sys.maxsize)

SUPPLEMENTAL_TOWNSHIP_DECISIONS = {
    "MMR006009": {"coremap_id": 7444, "target_parent_id": 7438, "action": "update_names", "method": "approved_alias_exact_parent"},
    "MMR006010": {"coremap_id": 5035, "target_parent_id": 7438, "action": "update_parent", "method": "approved_unique_bilingual_name"},
    "MMR013038": {"coremap_id": 5596, "target_parent_id": 5310, "action": "update_parent", "method": "approved_unique_bilingual_name"},
}

# Useful Wa/de-facto polygons: preserve as searchable reference geometry, but
# exclude from official/address counts.  The two first-level Wa areas are
# included at the end.
REFERENCE_ONLY_IDS = [
    6288, 6334, 6336, 6338, 6399, 6410, 6414, 6417, 6419, 6429,
    6430, 6434, 6443, 6445, 6446, 6448, 6450, 6453, 6454, 6466,
    6469, 6470, 6472, 6473, 6486, 6487, 6491, 6597, 6620, 6378,
    6485,
]

FOREIGN_IDS = [5985, 5986, 6675, 6734, 6735]
FOREIGN_STREET_REASSIGNMENTS = {307007: 6385, 307110: 6093, 307115: 6093}


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def clean(value: Any) -> str:
    return "" if value is None else str(value).strip()


def as_int(value: Any) -> int | None:
    value = clean(value)
    return int(value) if value else None


def json_literal(value: Any, tag: str) -> str:
    raw = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if f"${tag}$" in raw:
        raise ValueError(f"dollar-quote tag collision: {tag}")
    return f"${tag}${raw}${tag}$::jsonb"


def load_osm_polygons(path: Path, wanted_pcodes: set[str]) -> dict[str, dict[str, Any]]:
    found: dict[str, list[dict[str, Any]]] = {pcode: [] for pcode in wanted_pcodes}
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.lstrip("\x1e").strip()
            if not line:
                continue
            feature = json.loads(line)
            props = feature.get("properties") or {}
            pcode = clean(props.get("pcode") or props.get("PCode") or props.get("PCODE") or props.get("ref:MMR"))
            feature_id = clean(feature.get("id"))
            geometry = feature.get("geometry")
            if pcode in found and feature_id.startswith("a") and geometry and geometry.get("type") in {"Polygon", "MultiPolygon"}:
                found[pcode].append(feature)
    result: dict[str, dict[str, Any]] = {}
    for pcode, features in found.items():
        if len(features) != 1:
            raise ValueError(f"expected exactly one OSM polygon for {pcode}, got {len(features)}")
        result[pcode] = features[0]
    return result


def build_admin_stages(
    report_dir: Path,
    core_snapshot_dir: Path,
    osm_path: Path,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, int]]:
    report = read_csv(report_dir / "admin-match-report.csv")
    core_rows = {int(row["id"]): row for row in read_csv(core_snapshot_dir / "core_areas.csv")}

    by_pcode = {row["mimu_pcode"]: row for row in report if row["mimu_pcode"]}
    for pcode, decision in SUPPLEMENTAL_TOWNSHIP_DECISIONS.items():
        row = by_pcode[pcode]
        area = core_rows[decision["coremap_id"]]
        row.update({
            "coremap_id": str(decision["coremap_id"]),
            "candidate_coremap_ids": str(decision["coremap_id"]),
            "current_name": area["canonical_name"],
            "current_parent_id": area["parent_id"],
            "target_parent_id": str(decision["target_parent_id"]),
            "match_method": decision["method"],
            "proposed_action": decision["action"],
            "confidence_score": "100",
            "review_reason": "Approved Phase 2 manual identity resolution",
            "core_geom_md5_before": area["geom_md5"],
        })

    applied_actions = {"exact_keep", "update_names", "update_parent", "reclassify"}
    existing: list[dict[str, Any]] = []
    pcode_to_id: dict[str, int] = {}
    for row in report:
        if row["source_official"] != "True" or row["proposed_action"] not in applied_actions or not row["coremap_id"]:
            continue
        area_id = int(row["coremap_id"])
        area = core_rows[area_id]
        pcode = row["mimu_pcode"]
        if pcode in pcode_to_id and pcode_to_id[pcode] != area_id:
            raise ValueError(f"duplicate applied PCode: {pcode}")
        pcode_to_id[pcode] = area_id
        existing.append({
            "id": area_id,
            "pcode": pcode,
            "parent_pcode": row["parent_pcode"],
            "target_parent_id": as_int(row["target_parent_id"]),
            "target_name_en": row["target_name_en"],
            "target_name_my": row["target_name_my"],
            "subtype": row["source_subtype"],
            "action": row["proposed_action"],
            "match_method": row["match_method"],
            "expected_parent_id": as_int(area["parent_id"]),
            "expected_canonical_name": area["canonical_name"],
            "expected_geom_md5": area["geom_md5"],
        })

    if len({row["id"] for row in existing}) != len(existing):
        raise ValueError("one CoreMap admin row was assigned to multiple official MIMU rows")
    township_count = sum(row["source_level"] == "township" for row in report if row["source_official"] == "True" and row["proposed_action"] in applied_actions and row["coremap_id"])
    if township_count != 330:
        raise ValueError(f"expected 330 resolved official townships, got {township_count}")

    create_report = read_csv(report_dir / "admin-create-missing.csv")
    wanted = {row["mimu_pcode"] for row in create_report}
    osm = load_osm_polygons(osm_path, wanted)
    creates: list[dict[str, Any]] = []
    for row in create_report:
        pcode = row["mimu_pcode"]
        parent_id = pcode_to_id.get(row["parent_pcode"])
        if parent_id is None:
            raise ValueError(f"create candidate {pcode} has unresolved parent {row['parent_pcode']}")
        feature = osm[pcode]
        area_id = int(clean(feature["id"])[1:])
        if area_id % 2 != 1:
            raise ValueError(f"OSM area {feature['id']} is not a relation-derived area")
        relation_id = (area_id - 1) // 2
        creates.append({
            "pcode": pcode,
            "parent_pcode": row["parent_pcode"],
            "parent_id": parent_id,
            "target_name_en": row["target_name_en"],
            "target_name_my": row["target_name_my"],
            "subtype": row["source_subtype"],
            "osm_relation_id": relation_id,
            "osm_feature_id": feature["id"],
            "geometry": feature["geometry"],
        })
    if len(creates) != 124:
        raise ValueError(f"expected 124 approved creates, got {len(creates)}")
    return existing, creates, pcode_to_id


def postal_stage(report_dir: Path) -> list[dict[str, Any]]:
    rows = read_csv(report_dir / "postal-match-report.csv")
    result: list[dict[str, Any]] = []
    for row in rows:
        result.append({
            "postal_code": row["postal_code"],
            "region_name_en": row["region_name_en"] or None,
            "region_name_my": row["region_name_my"] or None,
            "township_name_en": row["township_name_en"] or None,
            "township_name_my": row["township_name_my"] or None,
            "locality_name_en": row["locality_name_en"] or None,
            "locality_name_my": row["locality_name_my"] or None,
            "locality_type": row["locality_type"] or None,
            "township_pcode": row["township_pcode"] or None,
            "township_admin_area_id": as_int(row["township_admin_area_id"]),
            "local_pcode": row["local_pcode"] or None,
            "local_admin_area_id": as_int(row["local_admin_area_id"]),
            "match_status": row["match_status"],
            "match_method": row["match_method"] or "unmatched",
            "source_row_count_en": int(row["source_row_count_en"]),
            "source_row_count_my": int(row["source_row_count_my"]),
            "candidate_township_pcodes": row["candidate_township_pcodes"] or None,
            "candidate_local_pcodes": row["candidate_local_pcodes"] or None,
        })
    if len(result) != 17297 or len({row["postal_code"] for row in result}) != 17297:
        raise ValueError("postal stage must contain exactly 17,297 unique valid codes")
    return result


def build_sql(existing: list[dict[str, Any]], creates: list[dict[str, Any]], postal: list[dict[str, Any]]) -> str:
    existing_json = json_literal(existing, "admin_existing")
    creates_json = json_literal(creates, "admin_create")
    postal_json = json_literal(postal, "postal_rows")
    reference_ids = ",".join(map(str, REFERENCE_ONLY_IDS))
    foreign_ids = ",".join(map(str, FOREIGN_IDS))
    reassigned_street_ids = ",".join(map(str, FOREIGN_STREET_REASSIGNMENTS))
    reassignment_values = ",\n        ".join(f"({street_id}::bigint,{township_id}::bigint)" for street_id, township_id in FOREIGN_STREET_REASSIGNMENTS.items())

    return f"""-- Generated by tools/admin-reconciliation/phase2_generate_migration.py
-- Approved one-time administrative + postal reconciliation, 2026-09-21.
-- Existing matched geometry, IDs, public IDs, external IDs and slugs are preserved.

BEGIN;

SELECT pg_advisory_xact_lock(hashtextextended('{RELEASE_KEY}', 0));
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '0';

CREATE TEMP TABLE phase2_existing_admin ON COMMIT DROP AS
SELECT *
FROM jsonb_to_recordset({existing_json}) AS x(
    id bigint, pcode text, parent_pcode text, target_parent_id bigint,
    target_name_en text, target_name_my text, subtype text, action text,
    match_method text, expected_parent_id bigint, expected_canonical_name text,
    expected_geom_md5 text
);

CREATE TEMP TABLE phase2_new_admin ON COMMIT DROP AS
SELECT *, NULL::bigint AS new_id
FROM jsonb_to_recordset({creates_json}) AS x(
    pcode text, parent_pcode text, parent_id bigint, target_name_en text,
    target_name_my text, subtype text, osm_relation_id bigint,
    osm_feature_id text, geometry jsonb
);

CREATE TEMP TABLE phase2_postal ON COMMIT DROP AS
SELECT *
FROM jsonb_to_recordset({postal_json}) AS x(
    postal_code text, region_name_en text, region_name_my text,
    township_name_en text, township_name_my text, locality_name_en text,
    locality_name_my text, locality_type text, township_pcode text,
    township_admin_area_id bigint, local_pcode text, local_admin_area_id bigint,
    match_status text, match_method text, source_row_count_en integer,
    source_row_count_my integer, candidate_township_pcodes text,
    candidate_local_pcodes text
);

DO $$
DECLARE
    v_count bigint;
BEGIN
    IF to_regclass('ref.ref_postal_codes') IS NOT NULL THEN
        RAISE EXCEPTION 'ref.ref_postal_codes already exists; reconciliation is one-time and will not overwrite it';
    END IF;
    IF EXISTS (
        SELECT 1 FROM system.audit_logs
        WHERE action_type = '{RELEASE_KEY}_completed'
    ) THEN
        RAISE EXCEPTION 'reconciliation completion marker already exists';
    END IF;
    IF (SELECT count(*) FROM phase2_existing_admin) <> {len(existing)} THEN
        RAISE EXCEPTION 'existing admin stage count changed';
    END IF;
    IF (SELECT count(*) FROM phase2_new_admin) <> {len(creates)} THEN
        RAISE EXCEPTION 'new admin stage count changed';
    END IF;
    IF (SELECT count(*) FROM phase2_postal) <> 17297 THEN
        RAISE EXCEPTION 'postal stage count changed';
    END IF;
    SELECT count(*) INTO v_count
    FROM core.core_admin_areas a
    JOIN phase2_existing_admin s ON s.id = a.id
    WHERE a.parent_id IS NOT DISTINCT FROM s.expected_parent_id
      AND a.canonical_name = s.expected_canonical_name
      AND md5(ST_AsEWKB(a.geom)) = s.expected_geom_md5;
    IF v_count <> {len(existing)} THEN
        RAISE EXCEPTION 'approved admin preconditions changed: % of {len(existing)} rows match', v_count;
    END IF;
    IF EXISTS (
        SELECT 1 FROM core.core_admin_areas
        WHERE source_refs #>> '{{mimu,pcode}}' IN (
            SELECT pcode FROM phase2_new_admin
        )
    ) THEN
        RAISE EXCEPTION 'one or more approved create PCodes already exist';
    END IF;
    IF (SELECT count(*) FROM core.core_admin_areas a JOIN ref.ref_admin_levels l ON l.id=a.admin_level_id WHERE l.code='state_region' AND a.is_active AND a.deleted_at IS NULL) <> 17
       OR (SELECT count(*) FROM core.core_admin_areas a JOIN ref.ref_admin_levels l ON l.id=a.admin_level_id WHERE l.code='township' AND a.is_active AND a.deleted_at IS NULL) <> 364
       OR (SELECT count(*) FROM core.core_admin_areas a JOIN ref.ref_admin_levels l ON l.id=a.admin_level_id WHERE l.code='ward_village_tract' AND a.is_active AND a.deleted_at IS NULL) <> 1995 THEN
        RAISE EXCEPTION 'production admin baseline differs from approved audit';
    END IF;
    IF (SELECT count(*) FROM core.core_streets WHERE admin_area_id IN ({foreign_ids})) <> 514
       OR (SELECT count(*) FROM core.core_buildings WHERE admin_area_id IN ({foreign_ids})) <> 6
       OR (SELECT count(*) FROM core.core_places WHERE admin_area_id IN ({foreign_ids})) <> 22
       OR (SELECT count(*) FROM core.core_settlements WHERE township_id IN ({foreign_ids})) <> 13
       OR (SELECT count(*) FROM transport.stops WHERE admin_area_id IN ({foreign_ids})) <> 5
       OR (SELECT count(*) FROM transport.terminals WHERE admin_area_id IN ({foreign_ids})) <> 2 THEN
        RAISE EXCEPTION 'foreign dependency counts differ from approved audit';
    END IF;
END $$;

-- Full before snapshots make the supplied rollback recoverable without a
-- permanent backup/crosswalk table.
INSERT INTO system.audit_logs(action_type, entity_type, entity_id, before_snapshot, after_snapshot)
SELECT '{RELEASE_KEY}_admin_before', 'core_admin_areas', a.id,
       to_jsonb(a), jsonb_build_object('release', '{RELEASE_KEY}')
FROM core.core_admin_areas a
WHERE a.id IN (
    SELECT id FROM phase2_existing_admin
    UNION SELECT unnest(ARRAY[{reference_ids}]::bigint[])
    UNION SELECT unnest(ARRAY[{foreign_ids}]::bigint[])
);

CREATE TEMP TABLE phase2_name_area_ids(id bigint PRIMARY KEY) ON COMMIT DROP;
INSERT INTO phase2_name_area_ids(id)
SELECT id FROM phase2_existing_admin
UNION
SELECT admin_area_id
FROM (
    SELECT admin_area_id,
           row_number() OVER (
               PARTITION BY admin_area_id, coalesce(lower(btrim(language_code)), ''), lower(btrim(name))
               ORDER BY id
           ) AS rn
    FROM core.core_admin_area_names
) d
WHERE d.rn > 1;

INSERT INTO system.audit_logs(action_type, entity_type, entity_id, before_snapshot, after_snapshot)
SELECT '{RELEASE_KEY}_names_before', 'core_admin_area_names', ids.id,
       jsonb_build_object(
           'rows', coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.id) FILTER (WHERE n.id IS NOT NULL), '[]'::jsonb)
       ),
       jsonb_build_object('release', '{RELEASE_KEY}')
FROM phase2_name_area_ids ids
LEFT JOIN core.core_admin_area_names n ON n.admin_area_id = ids.id
GROUP BY ids.id;

UPDATE core.core_admin_areas a
SET parent_id = coalesce(s.target_parent_id, a.parent_id),
    canonical_name = s.target_name_my,
    admin_area_type_id = CASE
        WHEN s.subtype = 'ward' THEN (SELECT id FROM ref.ref_admin_area_types WHERE code='ward')
        WHEN s.subtype = 'village_tract' THEN (SELECT id FROM ref.ref_admin_area_types WHERE code='village_tract')
        ELSE a.admin_area_type_id
    END,
    source_refs = coalesce(a.source_refs, '{{}}'::jsonb) || jsonb_build_object(
        'mimu', jsonb_build_object(
            'pcode', s.pcode,
            'parent_pcode', s.parent_pcode,
            'version', '{MIMU_VERSION}',
            'source_url', '{MIMU_SOURCE_URL}',
            'match_method', s.match_method
        )
    ),
    normalized_data = coalesce(a.normalized_data, '{{}}'::jsonb) || jsonb_build_object(
        'admin_reconciliation', jsonb_build_object('release', '{RELEASE_KEY}', 'action', s.action)
    ),
    reference_source = concat_ws('; ', nullif(a.reference_source, ''), 'MIMU PCode v9.7 names/hierarchy'),
    updated_at = now()
FROM phase2_existing_admin s
WHERE a.id = s.id;

-- Preserve useful Wa/de-facto geometry as reference/search-only areas.
UPDATE core.core_admin_areas
SET admin_area_type_id = (SELECT id FROM ref.ref_admin_area_types WHERE code='special_area'),
    is_official_boundary = false,
    address_usage = 'search_only',
    boundary_status = 'approximate',
    is_public_usable = true,
    reference_source = concat_ws('; ', nullif(reference_source, ''), 'local/de-facto reference area'),
    normalized_data = coalesce(normalized_data, '{{}}'::jsonb) || jsonb_build_object(
        'admin_reconciliation', jsonb_build_object('release', '{RELEASE_KEY}', 'classification', 'reference_only')
    ),
    updated_at = now()
WHERE id IN ({reference_ids});

UPDATE phase2_new_admin
SET new_id = nextval('core.core_admin_areas_id_seq');

INSERT INTO core.core_admin_areas(
    id, parent_id, admin_level_id, admin_area_type_id, canonical_name, slug,
    geom, centroid, source_type_id, is_active, external_id, source_refs,
    normalized_data, is_verified, verification_status, verified_at,
    verification_note, boundary_status, is_official_boundary,
    boundary_confidence_score, address_usage, geometry_source,
    reference_source, source_license_status, is_public_usable,
    address_confidence_score, created_at, updated_at
)
SELECT
    s.new_id,
    s.parent_id,
    (SELECT id FROM ref.ref_admin_levels WHERE code='ward_village_tract'),
    (SELECT id FROM ref.ref_admin_area_types WHERE code=s.subtype),
    s.target_name_my,
    lower('mimu-' || s.pcode),
    g.geom,
    ST_PointOnSurface(g.geom)::geometry(Point,4326),
    (SELECT id FROM ref.ref_source_types WHERE code='osm'),
    true,
    'osm:R:' || s.osm_relation_id,
    jsonb_build_object(
        'mimu', jsonb_build_object(
            'pcode', s.pcode, 'parent_pcode', s.parent_pcode,
            'version', '{MIMU_VERSION}', 'source_url', '{MIMU_SOURCE_URL}',
            'match_method', 'exact_pcode_osm_polygon'
        ),
        'osm', jsonb_build_object(
            'type', 'relation', 'id', s.osm_relation_id,
            'feature_id', s.osm_feature_id,
            'extract', 'myanmar-260823.osm.pbf'
        )
    ),
    jsonb_build_object(
        'admin_reconciliation', jsonb_build_object('release', '{RELEASE_KEY}', 'action', 'create_missing')
    ),
    true, 'verified', now(),
    'Exact MIMU PCode on OSM relation; reviewed in Phase 1/2 reconciliation',
    'official', true, 100, 'official', 'osm',
    'MIMU v9.7 identity/hierarchy; OpenStreetMap geometry',
    'odbl-1.0', true, 95, now(), now()
FROM phase2_new_admin s
CROSS JOIN LATERAL (
    SELECT ST_Multi(
        ST_CollectionExtract(
            ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(s.geometry), 4326)), 3
        )
    )::geometry(MultiPolygon,4326) AS geom
) g;

INSERT INTO phase2_name_area_ids(id)
SELECT new_id FROM phase2_new_admin
ON CONFLICT DO NOTHING;

INSERT INTO system.audit_logs(action_type, entity_type, entity_id, before_snapshot, after_snapshot)
SELECT '{RELEASE_KEY}_admin_created', 'core_admin_areas', a.id, NULL, to_jsonb(a)
FROM core.core_admin_areas a
JOIN phase2_new_admin s ON s.new_id=a.id;

-- Remove only exact duplicate name rows within the same area/language.
WITH ranked AS (
    SELECT id,
           row_number() OVER (
               PARTITION BY admin_area_id, coalesce(lower(btrim(language_code)), ''), lower(btrim(name))
               ORDER BY id
           ) AS rn
    FROM core.core_admin_area_names
)
DELETE FROM core.core_admin_area_names n
USING ranked r
WHERE n.id=r.id AND r.rn>1;

CREATE TEMP TABLE phase2_target_names ON COMMIT DROP AS
SELECT id AS admin_area_id, target_name_my AS name, 'my'::text AS language_code,
       'MYMR'::text AS script_code
FROM phase2_existing_admin
UNION ALL
SELECT id, target_name_en, 'en', 'LATN' FROM phase2_existing_admin
UNION ALL
SELECT new_id, target_name_my, 'my', 'MYMR' FROM phase2_new_admin
UNION ALL
SELECT new_id, target_name_en, 'en', 'LATN' FROM phase2_new_admin;

UPDATE core.core_admin_area_names n
SET is_primary=false,
    name_type=CASE
        WHEN EXISTS (
            SELECT 1 FROM phase2_target_names t
            WHERE t.admin_area_id=n.admin_area_id
              AND t.language_code=CASE
                    WHEN lower(coalesce(n.language_code,'')) IN ('my','mm') OR upper(coalesce(n.script_code,''))='MYMR' THEN 'my'
                    WHEN lower(coalesce(n.language_code,''))='en' OR upper(coalesce(n.script_code,''))='LATN' THEN 'en'
                    ELSE ''
                  END
              AND lower(btrim(t.name)) <> lower(btrim(n.name))
        ) THEN 'alternate'
        ELSE n.name_type
    END
WHERE n.admin_area_id IN (SELECT admin_area_id FROM phase2_target_names)
  AND n.is_primary
  AND (
      lower(coalesce(n.language_code,'')) IN ('my','mm','en')
      OR upper(coalesce(n.script_code,'')) IN ('MYMR','LATN')
  );

WITH chosen AS (
    SELECT t.*, (
        SELECT min(n.id)
        FROM core.core_admin_area_names n
        WHERE n.admin_area_id=t.admin_area_id
          AND lower(btrim(n.name))=lower(btrim(t.name))
          AND (
              lower(coalesce(n.language_code,''))=t.language_code
              OR (t.language_code='my' AND upper(coalesce(n.script_code,''))='MYMR')
              OR (t.language_code='en' AND upper(coalesce(n.script_code,''))='LATN')
          )
    ) AS name_id
    FROM phase2_target_names t
)
UPDATE core.core_admin_area_names n
SET name=c.name, language_code=c.language_code, script_code=c.script_code,
    name_type='official', is_primary=true, search_weight=100
FROM chosen c
WHERE n.id=c.name_id;

INSERT INTO core.core_admin_area_names(
    id, admin_area_id, name, language_code, script_code,
    name_type, is_primary, search_weight
)
SELECT nextval('core.core_admin_area_names_id_seq'), t.admin_area_id, t.name,
       t.language_code, t.script_code, 'official', true, 100
FROM phase2_target_names t
WHERE NOT EXISTS (
    SELECT 1 FROM core.core_admin_area_names n
    WHERE n.admin_area_id=t.admin_area_id
      AND lower(btrim(n.name))=lower(btrim(t.name))
      AND n.language_code=t.language_code
);

CREATE UNIQUE INDEX IF NOT EXISTS core_admin_area_names_one_primary_language_uidx
ON core.core_admin_area_names(admin_area_id, lower(language_code))
WHERE is_primary AND lower(language_code) IN ('en','my');

INSERT INTO system.audit_logs(action_type, entity_type, entity_id, before_snapshot, after_snapshot)
SELECT '{RELEASE_KEY}_names_after', 'core_admin_area_names', ids.id,
       jsonb_build_object('release', '{RELEASE_KEY}'),
       jsonb_build_object(
           'rows', coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.id) FILTER (WHERE n.id IS NOT NULL), '[]'::jsonb)
       )
FROM phase2_name_area_ids ids
LEFT JOIN core.core_admin_area_names n ON n.admin_area_id=ids.id
GROUP BY ids.id;

-- Audit and resolve dependencies of confirmed foreign polygons.  Only three
-- streets are inside Myanmar with exactly one containing official township;
-- all other dependent features are outside Myanmar and are soft-excluded.
INSERT INTO system.audit_logs(action_type, entity_type, entity_id, before_snapshot, after_snapshot)
SELECT '{RELEASE_KEY}_dependency_before', 'core_streets', id, to_jsonb(s), jsonb_build_object('release','{RELEASE_KEY}')
FROM core.core_streets s WHERE admin_area_id IN ({foreign_ids})
UNION ALL SELECT '{RELEASE_KEY}_dependency_before','core_buildings',id,to_jsonb(b),jsonb_build_object('release','{RELEASE_KEY}') FROM core.core_buildings b WHERE admin_area_id IN ({foreign_ids})
UNION ALL SELECT '{RELEASE_KEY}_dependency_before','core_places',id,to_jsonb(p),jsonb_build_object('release','{RELEASE_KEY}') FROM core.core_places p WHERE admin_area_id IN ({foreign_ids})
UNION ALL SELECT '{RELEASE_KEY}_dependency_before','core_settlements',id,to_jsonb(s),jsonb_build_object('release','{RELEASE_KEY}') FROM core.core_settlements s WHERE township_id IN ({foreign_ids})
UNION ALL SELECT '{RELEASE_KEY}_dependency_before','transport.stops',id,to_jsonb(s),jsonb_build_object('release','{RELEASE_KEY}') FROM transport.stops s WHERE admin_area_id IN ({foreign_ids})
UNION ALL SELECT '{RELEASE_KEY}_dependency_before','transport.terminals',id,to_jsonb(t),jsonb_build_object('release','{RELEASE_KEY}') FROM transport.terminals t WHERE admin_area_id IN ({foreign_ids});

UPDATE core.core_streets s
SET admin_area_id=v.new_admin_area_id, updated_at=now()
FROM (VALUES {reassignment_values}) v(street_id,new_admin_area_id)
WHERE s.id=v.street_id AND s.admin_area_id IN ({foreign_ids});

UPDATE core.core_streets
SET admin_area_id=NULL, is_active=false, deleted_at=coalesce(deleted_at,now()), updated_at=now()
WHERE admin_area_id IN ({foreign_ids}) AND id NOT IN ({reassigned_street_ids});
UPDATE core.core_buildings SET admin_area_id=NULL, is_active=false, deleted_at=coalesce(deleted_at,now()), updated_at=now() WHERE admin_area_id IN ({foreign_ids});
UPDATE core.core_places SET admin_area_id=NULL, is_public=false, deleted_at=coalesce(deleted_at,now()), updated_at=now() WHERE admin_area_id IN ({foreign_ids});
UPDATE core.core_settlements SET township_id=NULL, is_public=false, deleted_at=coalesce(deleted_at,now()), updated_at=now() WHERE township_id IN ({foreign_ids});
UPDATE transport.stops SET admin_area_id=NULL, is_active=false, deleted_at=coalesce(deleted_at,now()), updated_at=now() WHERE admin_area_id IN ({foreign_ids});
UPDATE transport.terminals SET admin_area_id=NULL, is_active=false, deleted_at=coalesce(deleted_at,now()), updated_at=now() WHERE admin_area_id IN ({foreign_ids});

UPDATE core.core_admin_areas
SET is_active=false, deleted_at=coalesce(deleted_at,now()),
    is_official_boundary=false, is_public_usable=false,
    address_usage='disabled', boundary_status='unknown',
    normalized_data=coalesce(normalized_data,'{{}}'::jsonb) || jsonb_build_object(
        'admin_reconciliation',jsonb_build_object('release','{RELEASE_KEY}','classification','foreign_disabled')
    ), updated_at=now()
WHERE id IN ({foreign_ids});

CREATE TABLE ref.ref_postal_codes (
    id bigserial PRIMARY KEY,
    postal_code text NOT NULL UNIQUE,
    township_admin_area_id bigint REFERENCES core.core_admin_areas(id) ON DELETE RESTRICT,
    local_admin_area_id bigint REFERENCES core.core_admin_areas(id) ON DELETE RESTRICT,
    region_name_en text,
    region_name_my text,
    township_name_en text,
    township_name_my text,
    locality_name_en text,
    locality_name_my text,
    locality_type text,
    match_status text NOT NULL,
    match_method text NOT NULL,
    source_version text NOT NULL,
    source_license text NOT NULL,
    source_refs jsonb NOT NULL DEFAULT '{{}}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ref_postal_codes_seven_digit_chk CHECK (postal_code ~ '^[0-9]{{7}}$'),
    CONSTRAINT ref_postal_codes_locality_type_chk CHECK (locality_type IS NULL OR locality_type IN ('ward','village_tract')),
    CONSTRAINT ref_postal_codes_local_requires_township_chk CHECK (local_admin_area_id IS NULL OR township_admin_area_id IS NOT NULL)
);
ALTER TABLE ref.ref_postal_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ref.ref_postal_codes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE ref.ref_postal_codes_id_seq FROM PUBLIC, anon, authenticated;
CREATE INDEX ref_postal_codes_township_idx ON ref.ref_postal_codes(township_admin_area_id, postal_code);
CREATE INDEX ref_postal_codes_local_idx ON ref.ref_postal_codes(local_admin_area_id, postal_code) WHERE local_admin_area_id IS NOT NULL;
CREATE INDEX ref_postal_codes_region_idx ON ref.ref_postal_codes(region_name_en, township_name_en);
CREATE INDEX ref_postal_codes_source_refs_gin_idx ON ref.ref_postal_codes USING gin(source_refs);
COMMENT ON TABLE ref.ref_postal_codes IS 'Myanmar Post V1.0 postal codes linked conservatively to MIMU v9.7/CoreMap admin areas; API-only access.';

INSERT INTO ref.ref_postal_codes(
    postal_code, township_admin_area_id, local_admin_area_id,
    region_name_en, region_name_my, township_name_en, township_name_my,
    locality_name_en, locality_name_my, locality_type,
    match_status, match_method, source_version, source_license, source_refs
)
SELECT
    p.postal_code,
    coalesce(p.township_admin_area_id, tx.id),
    CASE
        WHEN p.match_status='exact_local_admin_match' THEN p.local_admin_area_id
        WHEN created_local.new_id IS NOT NULL THEN created_local.new_id
        ELSE NULL
    END,
    p.region_name_en, p.region_name_my, p.township_name_en, p.township_name_my,
    p.locality_name_en, p.locality_name_my, p.locality_type,
    CASE
        WHEN created_local.new_id IS NOT NULL THEN 'exact_local_admin_match'
        WHEN coalesce(p.township_admin_area_id,tx.id) IS NOT NULL AND p.match_status='township_source_match_core_unresolved' THEN 'township_only'
        ELSE p.match_status
    END,
    CASE
        WHEN created_local.new_id IS NOT NULL THEN 'exact_mimu_local_pcode_osm_geometry'
        WHEN p.township_admin_area_id IS NULL AND tx.id IS NOT NULL THEN p.match_method || '+approved_phase2_township'
        ELSE p.match_method
    END,
    '{POSTAL_VERSION}', 'GPL-3.0; copyright Myanmar Post',
    jsonb_strip_nulls(jsonb_build_object(
        'myanmar_post',jsonb_build_object(
            'source_url','{POSTAL_SOURCE_URL}', 'version','{POSTAL_VERSION}',
            'source_row_count_en',p.source_row_count_en,
            'source_row_count_my',p.source_row_count_my
        ),
        'matching',jsonb_build_object(
            'township_pcode',p.township_pcode,
            'local_pcode',p.local_pcode,
            'candidate_township_pcodes',p.candidate_township_pcodes,
            'candidate_local_pcodes',p.candidate_local_pcodes
        )
    ))
FROM phase2_postal p
LEFT JOIN phase2_existing_admin tx ON tx.pcode=p.township_pcode
LEFT JOIN phase2_new_admin created_local ON created_local.pcode=p.local_pcode;

CREATE UNIQUE INDEX core_admin_areas_mimu_pcode_uidx
ON core.core_admin_areas ((source_refs #>> '{{mimu,pcode}}'))
WHERE nullif(source_refs #>> '{{mimu,pcode}}','') IS NOT NULL;

DO $$
DECLARE
    v_search jsonb;
    v_count bigint;
BEGIN
    v_search := search.rebuild_search_documents(ARRAY['admin_areas']);
    IF v_search->>'status' <> 'completed' THEN
        RAISE EXCEPTION 'admin search rebuild failed: %', v_search;
    END IF;

    SELECT count(*) INTO v_count
    FROM core.core_admin_areas a JOIN ref.ref_admin_levels l ON l.id=a.admin_level_id
    WHERE l.code='state_region' AND a.is_active AND a.deleted_at IS NULL
      AND a.is_official_boundary AND a.address_usage='official';
    IF v_count <> 15 THEN RAISE EXCEPTION 'expected 15 active official first-level areas, got %',v_count; END IF;

    SELECT count(*) INTO v_count
    FROM core.core_admin_areas a JOIN ref.ref_admin_levels l ON l.id=a.admin_level_id
    WHERE l.code='township' AND a.is_active AND a.deleted_at IS NULL
      AND a.is_official_boundary AND a.address_usage='official';
    IF v_count <> 330 THEN RAISE EXCEPTION 'expected 330 active official townships, got %',v_count; END IF;

    SELECT count(*) INTO v_count
    FROM core.core_admin_areas
    WHERE source_refs #>> '{{mimu,pcode}}' ~ '^MMR[0-9]{{3}}[0-9]{{3}}$'
      AND is_active AND deleted_at IS NULL AND is_official_boundary;
    IF v_count <> 330 THEN RAISE EXCEPTION 'expected 330 unique official township PCodes, got %',v_count; END IF;

    IF EXISTS (
        SELECT 1 FROM phase2_existing_admin s JOIN core.core_admin_areas a ON a.id=s.id
        WHERE md5(ST_AsEWKB(a.geom)) <> s.expected_geom_md5
    ) THEN RAISE EXCEPTION 'matched geometry hash changed'; END IF;

    IF EXISTS (
        SELECT 1 FROM phase2_new_admin s JOIN core.core_admin_areas a ON a.id=s.new_id
        WHERE a.geom IS NULL OR ST_IsEmpty(a.geom) OR NOT ST_IsValid(a.geom) OR ST_SRID(a.geom)<>4326
    ) THEN RAISE EXCEPTION 'new admin geometry validation failed'; END IF;

    IF EXISTS (
        SELECT 1 FROM core.core_admin_area_names
        GROUP BY admin_area_id,coalesce(lower(btrim(language_code)),''),lower(btrim(name))
        HAVING count(*)>1
    ) THEN RAISE EXCEPTION 'exact duplicate admin name rows remain'; END IF;

    IF EXISTS (
        SELECT 1 FROM (
            SELECT a.id,
                   count(*) FILTER (WHERE n.is_primary AND n.language_code='en') en_count,
                   count(*) FILTER (WHERE n.is_primary AND n.language_code='my') my_count
            FROM core.core_admin_areas a
            JOIN core.core_admin_area_names n ON n.admin_area_id=a.id
            WHERE a.id IN (SELECT id FROM phase2_existing_admin UNION SELECT new_id FROM phase2_new_admin)
            GROUP BY a.id
        ) x WHERE en_count<>1 OR my_count<>1
    ) THEN RAISE EXCEPTION 'one-primary-name verification failed'; END IF;

    IF EXISTS (SELECT 1 FROM core.core_admin_areas WHERE id IN ({foreign_ids}) AND (is_active OR is_official_boundary OR coalesce(is_public_usable,false) OR address_usage<>'disabled'))
       OR EXISTS (SELECT 1 FROM core.core_streets WHERE admin_area_id IN ({foreign_ids}))
       OR EXISTS (SELECT 1 FROM core.core_buildings WHERE admin_area_id IN ({foreign_ids}))
       OR EXISTS (SELECT 1 FROM core.core_places WHERE admin_area_id IN ({foreign_ids}))
       OR EXISTS (SELECT 1 FROM core.core_settlements WHERE township_id IN ({foreign_ids}))
       OR EXISTS (SELECT 1 FROM transport.stops WHERE admin_area_id IN ({foreign_ids}))
       OR EXISTS (SELECT 1 FROM transport.terminals WHERE admin_area_id IN ({foreign_ids})) THEN
        RAISE EXCEPTION 'foreign polygon disable/dependency verification failed';
    END IF;

    IF (SELECT count(*) FROM ref.ref_postal_codes)<>17297
       OR EXISTS (SELECT 1 FROM ref.ref_postal_codes WHERE postal_code !~ '^[0-9]{{7}}$')
       OR EXISTS (SELECT 1 FROM ref.ref_postal_codes WHERE township_admin_area_id IS NULL AND match_status NOT IN ('ambiguous','unmatched_postal_locality','township_source_match_core_unresolved'))
       OR EXISTS (SELECT 1 FROM ref.ref_postal_codes WHERE local_admin_area_id IS NOT NULL AND match_status<>'exact_local_admin_match') THEN
        RAISE EXCEPTION 'postal verification failed';
    END IF;

    IF EXISTS (
        WITH RECURSIVE walk AS (
            SELECT id,parent_id,ARRAY[id] path,false cycle
            FROM core.core_admin_areas WHERE is_active AND deleted_at IS NULL
            UNION ALL
            SELECT p.id,p.parent_id,w.path||p.id,p.id=ANY(w.path)
            FROM walk w JOIN core.core_admin_areas p ON p.id=w.parent_id
            WHERE NOT w.cycle
        ) SELECT 1 FROM walk WHERE cycle
    ) THEN RAISE EXCEPTION 'admin hierarchy cycle detected'; END IF;

    INSERT INTO system.audit_logs(action_type,entity_type,before_snapshot,after_snapshot)
    VALUES(
        '{RELEASE_KEY}_completed','admin_postal_reconciliation',NULL,
        jsonb_build_object(
            'existing_admin_updated',{len(existing)}, 'admin_created',{len(creates)},
            'postal_codes',17297, 'official_state_regions',15,
            'official_townships',330, 'search_rebuild',v_search
        )
    );
END $$;

COMMIT;
"""


def build_rollback_sql() -> str:
    return f"""-- Recovery script for {RELEASE_KEY}.
-- Run only after reviewing post-release writes that may depend on new admin rows.
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('{RELEASE_KEY}',0));

DROP TABLE IF EXISTS ref.ref_postal_codes;
DROP INDEX IF EXISTS core.core_admin_areas_mimu_pcode_uidx;
DROP INDEX IF EXISTS core.core_admin_area_names_one_primary_language_uidx;

-- Restore dependency rows from immutable before snapshots.
DO $$
DECLARE r record; b jsonb;
BEGIN
  FOR r IN SELECT entity_type,entity_id,before_snapshot FROM system.audit_logs WHERE action_type='{RELEASE_KEY}_dependency_before' ORDER BY id LOOP
    b:=r.before_snapshot;
    IF r.entity_type='core_streets' THEN
      UPDATE core.core_streets SET admin_area_id=(b->>'admin_area_id')::bigint,is_active=(b->>'is_active')::boolean,deleted_at=(b->>'deleted_at')::timestamptz,updated_at=(b->>'updated_at')::timestamptz WHERE id=r.entity_id;
    ELSIF r.entity_type='core_buildings' THEN
      UPDATE core.core_buildings SET admin_area_id=(b->>'admin_area_id')::bigint,is_active=(b->>'is_active')::boolean,deleted_at=(b->>'deleted_at')::timestamptz,updated_at=(b->>'updated_at')::timestamptz WHERE id=r.entity_id;
    ELSIF r.entity_type='core_places' THEN
      UPDATE core.core_places SET admin_area_id=(b->>'admin_area_id')::bigint,is_public=(b->>'is_public')::boolean,deleted_at=(b->>'deleted_at')::timestamptz,updated_at=(b->>'updated_at')::timestamptz WHERE id=r.entity_id;
    ELSIF r.entity_type='core_settlements' THEN
      UPDATE core.core_settlements SET township_id=(b->>'township_id')::bigint,is_public=(b->>'is_public')::boolean,deleted_at=(b->>'deleted_at')::timestamptz,updated_at=(b->>'updated_at')::timestamptz WHERE id=r.entity_id;
    ELSIF r.entity_type='transport.stops' THEN
      UPDATE transport.stops SET admin_area_id=(b->>'admin_area_id')::bigint,is_active=(b->>'is_active')::boolean,deleted_at=(b->>'deleted_at')::timestamptz,updated_at=(b->>'updated_at')::timestamptz WHERE id=r.entity_id;
    ELSIF r.entity_type='transport.terminals' THEN
      UPDATE transport.terminals SET admin_area_id=(b->>'admin_area_id')::bigint,is_active=(b->>'is_active')::boolean,deleted_at=(b->>'deleted_at')::timestamptz,updated_at=(b->>'updated_at')::timestamptz WHERE id=r.entity_id;
    END IF;
  END LOOP;
END $$;

-- Remove rows created by the release after dependent postal rows are gone.
DELETE FROM core.core_admin_area_names n USING core.core_admin_areas a
WHERE n.admin_area_id=a.id AND a.normalized_data #>> '{{admin_reconciliation,release}}'='{RELEASE_KEY}'
  AND a.normalized_data #>> '{{admin_reconciliation,action}}'='create_missing';
DELETE FROM core.core_admin_areas
WHERE normalized_data #>> '{{admin_reconciliation,release}}'='{RELEASE_KEY}'
  AND normalized_data #>> '{{admin_reconciliation,action}}'='create_missing';

-- Restore complete pre-release name sets for every touched area.
DO $$
DECLARE r record; item jsonb;
BEGIN
  FOR r IN SELECT entity_id,before_snapshot FROM system.audit_logs WHERE action_type='{RELEASE_KEY}_names_before' ORDER BY id LOOP
    DELETE FROM core.core_admin_area_names WHERE admin_area_id=r.entity_id;
    FOR item IN SELECT value FROM jsonb_array_elements(coalesce(r.before_snapshot->'rows','[]'::jsonb)) LOOP
      INSERT INTO core.core_admin_area_names(id,admin_area_id,name,language_code,script_code,name_type,is_primary,search_weight)
      VALUES((item->>'id')::bigint,(item->>'admin_area_id')::bigint,item->>'name',item->>'language_code',nullif(item->>'script_code',''),item->>'name_type',(item->>'is_primary')::boolean,(item->>'search_weight')::integer);
    END LOOP;
  END LOOP;
END $$;

-- Restore mutable admin fields from full before snapshots; geometry was never changed.
DO $$
DECLARE r record; b jsonb;
BEGIN
  FOR r IN SELECT entity_id,before_snapshot FROM system.audit_logs WHERE action_type='{RELEASE_KEY}_admin_before' ORDER BY id LOOP
    b:=r.before_snapshot;
    UPDATE core.core_admin_areas SET
      parent_id=(b->>'parent_id')::bigint,admin_level_id=(b->>'admin_level_id')::bigint,
      admin_area_type_id=(b->>'admin_area_type_id')::bigint,canonical_name=b->>'canonical_name',
      slug=b->>'slug',external_id=nullif(b->>'external_id',''),is_active=(b->>'is_active')::boolean,
      deleted_at=(b->>'deleted_at')::timestamptz,is_official_boundary=(b->>'is_official_boundary')::boolean,
      is_public_usable=(b->>'is_public_usable')::boolean,address_usage=b->>'address_usage',
      boundary_status=b->>'boundary_status',source_refs=coalesce(b->'source_refs','{{}}'::jsonb),
      normalized_data=coalesce(b->'normalized_data','{{}}'::jsonb),geometry_source=b->>'geometry_source',
      reference_source=b->>'reference_source',source_license_status=b->>'source_license_status',
      updated_at=(b->>'updated_at')::timestamptz
    WHERE id=r.entity_id;
  END LOOP;
END $$;

SELECT search.rebuild_search_documents(ARRAY['admin_areas']);
INSERT INTO system.audit_logs(action_type,entity_type,before_snapshot,after_snapshot)
VALUES('{RELEASE_KEY}_rolled_back','admin_postal_reconciliation',NULL,jsonb_build_object('rolled_back_at',now()));
COMMIT;
"""


def build_verification_sql() -> str:
    foreign_ids = ",".join(map(str, FOREIGN_IDS))
    return f"""-- Read-only verification for {RELEASE_KEY}.
BEGIN READ ONLY;
SELECT 'official_state_regions' metric,count(*)::bigint value FROM core.core_admin_areas a JOIN ref.ref_admin_levels l ON l.id=a.admin_level_id WHERE l.code='state_region' AND a.is_active AND a.deleted_at IS NULL AND a.is_official_boundary AND a.address_usage='official'
UNION ALL SELECT 'official_townships',count(*) FROM core.core_admin_areas a JOIN ref.ref_admin_levels l ON l.id=a.admin_level_id WHERE l.code='township' AND a.is_active AND a.deleted_at IS NULL AND a.is_official_boundary AND a.address_usage='official'
UNION ALL SELECT 'unique_official_township_pcodes',count(*) FROM core.core_admin_areas WHERE source_refs #>> '{{mimu,pcode}}' ~ '^MMR[0-9]{{6}}$' AND is_active AND deleted_at IS NULL AND is_official_boundary
UNION ALL SELECT 'postal_codes',count(*) FROM ref.ref_postal_codes
UNION ALL SELECT 'postal_township_linked',count(*) FROM ref.ref_postal_codes WHERE township_admin_area_id IS NOT NULL
UNION ALL SELECT 'postal_local_linked',count(*) FROM ref.ref_postal_codes WHERE local_admin_area_id IS NOT NULL
UNION ALL SELECT 'foreign_admin_dependencies',(
  (SELECT count(*) FROM core.core_streets WHERE admin_area_id IN ({foreign_ids}))+
  (SELECT count(*) FROM core.core_buildings WHERE admin_area_id IN ({foreign_ids}))+
  (SELECT count(*) FROM core.core_places WHERE admin_area_id IN ({foreign_ids}))+
  (SELECT count(*) FROM core.core_settlements WHERE township_id IN ({foreign_ids}))+
  (SELECT count(*) FROM transport.stops WHERE admin_area_id IN ({foreign_ids}))+
  (SELECT count(*) FROM transport.terminals WHERE admin_area_id IN ({foreign_ids}))
);

SELECT match_status,count(*) FROM ref.ref_postal_codes GROUP BY match_status ORDER BY match_status;
SELECT action_type,created_at,after_snapshot FROM system.audit_logs WHERE action_type IN ('{RELEASE_KEY}_completed','{RELEASE_KEY}_rolled_back') ORDER BY id DESC;
ROLLBACK;
"""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report-dir", type=Path, required=True)
    parser.add_argument("--core-snapshot-dir", type=Path, required=True)
    parser.add_argument("--osm-admin", type=Path, required=True)
    parser.add_argument("--migration-output", type=Path, required=True)
    parser.add_argument("--rollback-output", type=Path, required=True)
    parser.add_argument("--verification-output", type=Path, required=True)
    args = parser.parse_args()

    existing, creates, _pcode_to_id = build_admin_stages(args.report_dir, args.core_snapshot_dir, args.osm_admin)
    postal = postal_stage(args.report_dir)
    args.migration_output.parent.mkdir(parents=True, exist_ok=True)
    args.rollback_output.parent.mkdir(parents=True, exist_ok=True)
    args.verification_output.parent.mkdir(parents=True, exist_ok=True)
    args.migration_output.write_text(build_sql(existing, creates, postal), encoding="utf-8")
    args.rollback_output.write_text(build_rollback_sql(), encoding="utf-8")
    args.verification_output.write_text(build_verification_sql(), encoding="utf-8")
    print(json.dumps({
        "existing_admin": len(existing),
        "new_admin": len(creates),
        "postal_codes": len(postal),
        "migration": str(args.migration_output),
    }))


if __name__ == "__main__":
    main()
