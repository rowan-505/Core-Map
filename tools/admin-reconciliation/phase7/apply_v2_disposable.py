#!/usr/bin/env python3
"""Apply Phase7 completion-v2 release on a disposable database only.

Order:
  1 township creates  2 WVT creates/updates  3 admin merges
  4 village creates/updates  5 settlement merges  6 aliases
  7 postal rows  8 postal FK by public_id

Never touches production hosts.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import psycopg

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "reports/admin-reconciliation-v2/phase7-completion-v2"
V2 = OUT / "frozen-v2"
POSTAL = OUT / "postal/03-postal-actions-v2.csv"
PREVIEWS = REPO / "reports/admin-reconciliation-v2/phase3-previews"
MIMU_TS = Path("/tmp/mimu_pangsang_township.geojson")
PANG = json.loads((OUT / "decisions/01-pangsang-township-freeze.json").read_text(encoding="utf-8"))
REPORTS = REPO / "reports/admin-reconciliation-v2"

PRODUCTION_MARKERS = ("locghyuranqaqsnbxflc", "supabase.co", "pooler.supabase.com")
SEVEN = re.compile(r"^[0-9]{7}$")


def load_geom_index() -> dict[str, str]:
    index: dict[str, str] = {}
    for name in ("01-wards-normalized.geojson", "01-village-tracts-normalized.geojson"):
        path = REPORTS / name
        data = json.loads(path.read_text(encoding="utf-8"))
        for feat in data.get("features") or []:
            props = feat.get("properties") or {}
            pcode = clean(props.get("source_pcode") or props.get("pcode") or props.get("ST_PCODE") or props.get("VT_PCODE") or props.get("W_PCODE"))
            geom = feat.get("geometry")
            if pcode and geom and geom.get("type") in {"Polygon", "MultiPolygon"}:
                index[pcode] = json.dumps(geom)
    # Also phase3 previews as fallback
    for path in PREVIEWS.glob("*.geojson"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        feat = data["features"][0] if data.get("type") == "FeatureCollection" and data.get("features") else data
        props = feat.get("properties") or {}
        pcode = clean(props.get("source_pcode") or props.get("pcode"))
        if not pcode:
            # filename ward_MMR... or village_tract_MMR...
            m = re.search(r"(MMR[0-9A-Z]+)", path.name)
            pcode = m.group(1) if m else ""
        geom = feat.get("geometry")
        if pcode and geom and pcode not in index and geom.get("type") in {"Polygon", "MultiPolygon"}:
            index[pcode] = json.dumps(geom)
    return index


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def clean(v: Any) -> str:
    return "" if v is None else str(v).strip()


def as_int(v: Any) -> int | None:
    t = clean(v)
    return int(t) if t else None


def load_csv(path: Path) -> list[dict[str, str]]:
    import csv

    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def assert_disposable(url: str) -> None:
    host = (urlparse(url).hostname or "").lower()
    if any(m in host for m in PRODUCTION_MARKERS):
        raise SystemExit(f"Refusing production host: {host}")
    if host not in {"127.0.0.1", "localhost"}:
        raise SystemExit(f"Refusing non-local host without explicit disposable policy: {host}")


def resolve_refs(cur) -> dict[str, Any]:
    cur.execute("SELECT id, code FROM ref.ref_admin_levels")
    levels = {c: int(i) for i, c in cur.fetchall()}
    cur.execute("SELECT id, code FROM ref.ref_admin_area_types")
    types = {c: int(i) for i, c in cur.fetchall()}
    cur.execute("SELECT id, code FROM ref.ref_source_types")
    sources = {c: int(i) for i, c in cur.fetchall()}
    cur.execute("SELECT id, code FROM ref.ref_settlement_types")
    settle_types = {c: int(i) for i, c in cur.fetchall()}
    return {"levels": levels, "types": types, "sources": sources, "settle_types": settle_types}


def load_preview_geojson(entity: str, pcode: str, source_row: str | None = None) -> str | None:
    if source_row:
        hits = sorted(PREVIEWS.glob(f"{entity}_{pcode}_row{source_row}_*.geojson"))
        if hits:
            data = json.loads(hits[0].read_text(encoding="utf-8"))
            geom = data["features"][0]["geometry"] if data.get("type") == "FeatureCollection" else data.get("geometry", data)
            return json.dumps(geom)
    hits = sorted(PREVIEWS.glob(f"{entity}_{pcode}_*.geojson"))
    if not hits:
        return None
    data = json.loads(hits[0].read_text(encoding="utf-8"))
    geom = data["features"][0]["geometry"] if data.get("type") == "FeatureCollection" else data.get("geometry", data)
    return json.dumps(geom)


def ensure_names(cur, admin_id: int, name_en: str, name_mm: str) -> None:
    for lang, name, primary in (("en", name_en, True), ("my", name_mm, True)):
        if not name:
            continue
        cur.execute(
            """
            INSERT INTO core.core_admin_area_names (admin_area_id, name, language_code, name_type, is_primary, search_weight)
            SELECT %s, %s, %s, 'official', %s, 100
            WHERE NOT EXISTS (
              SELECT 1 FROM core.core_admin_area_names
              WHERE admin_area_id=%s AND name=%s AND language_code=%s
            )
            """,
            (admin_id, name, lang, primary, admin_id, name, lang),
        )


def create_admin(
    cur,
    row: dict[str, str],
    refs: dict[str, Any],
    parent_id: int,
    geom_geojson: str,
    *,
    level_code: str,
    type_code: str,
    id_map: dict[str, int],
) -> str:
    sk = clean(row.get("source_key"))
    pub = clean(row.get("target_public_id"))
    slug = clean(row.get("target_slug"))
    if not pub or not slug:
        return "skip_missing_frozen_ids"
    cur.execute(
        "SELECT id FROM core.core_admin_areas WHERE public_id=%s::uuid OR (deleted_at IS NULL AND normalized_data->>'source_key'=%s) LIMIT 1",
        (pub, sk),
    )
    existing = cur.fetchone()
    if existing:
        id_map[sk] = int(existing[0])
        id_map[f"public:{pub}"] = int(existing[0])
        return "already_created"
    name_en = clean(row.get("source_name_en"))
    name_mm = clean(row.get("source_name_my"))
    canonical = name_mm or name_en or clean(row.get("source_pcode")) or "unnamed"
    marker = {
        "phase7_completion_v2": True,
        "source_key": sk,
        "source_pcode_audit_only": clean(row.get("source_pcode")),
        "mimu_version": "9.7",
    }
    cur.execute(
        """
        WITH raw AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON(%s),4326) AS g),
        cleaned AS (SELECT CASE WHEN NOT ST_IsValid(g) THEN ST_MakeValid(g) ELSE g END AS g FROM raw),
        normalized AS (SELECT ST_Multi(ST_CollectionExtract(g,3))::geometry(MultiPolygon,4326) AS g FROM cleaned),
        checked AS (SELECT g, ST_PointOnSurface(g) AS c FROM normalized WHERE g IS NOT NULL AND NOT ST_IsEmpty(g) AND ST_IsValid(g))
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
          'search_only', false, 50,
          'mimu_placeholder', 'mimu', 'permission_pending',
          %s::jsonb, %s::jsonb, 'phase7_completion_v2:create'
        FROM checked
        RETURNING id
        """,
        (
            geom_geojson,
            pub,
            parent_id,
            refs["levels"][level_code],
            refs["types"][type_code],
            canonical,
            slug,
            refs["sources"]["partner"],
            json.dumps({"source": "mimu", "source_version": "9.7"}),
            json.dumps(marker),
        ),
    )
    fetched = cur.fetchone()
    if not fetched:
        return "create_skipped_invalid_geometry"
    admin_id = int(fetched[0])
    ensure_names(cur, admin_id, name_en, name_mm)
    id_map[sk] = admin_id
    id_map[f"public:{pub}"] = admin_id
    return "created"


def merge_admins(cur, survivor: int, loser: int) -> str:
    if survivor == loser:
        return "merge_same_id"
    cur.execute("SELECT id FROM core.core_admin_areas WHERE id=%s AND deleted_at IS NULL", (survivor,))
    if not cur.fetchone():
        return "survivor_missing"
    cur.execute(
        """
        UPDATE core.core_admin_areas
        SET deleted_at=COALESCE(deleted_at, now()), is_active=false,
            normalized_data = normalized_data || jsonb_build_object('merged_into', %s::text, 'phase7_completion_v2_merge', true),
            updated_at=now()
        WHERE id=%s AND deleted_at IS NULL
        """,
        (survivor, loser),
    )
    # repoint children
    cur.execute("UPDATE core.core_admin_areas SET parent_id=%s, updated_at=now() WHERE parent_id=%s", (survivor, loser))
    cur.execute("UPDATE core.core_settlements SET township_id=%s, updated_at=now() WHERE township_id=%s", (survivor, loser))
    cur.execute(
        "UPDATE ref.ref_postal_codes SET local_admin_area_id=%s WHERE local_admin_area_id=%s",
        (survivor, loser),
    )
    cur.execute(
        "UPDATE ref.ref_postal_codes SET township_admin_area_id=%s WHERE township_admin_area_id=%s",
        (survivor, loser),
    )
    return "merged"


def create_settlement(cur, row: dict[str, str], refs: dict[str, Any], township_id: int | None) -> str:
    pub = clean(row.get("target_public_id"))
    if not pub:
        return "skip_missing_public_id"
    cur.execute("SELECT id FROM core.core_settlements WHERE public_id=%s::uuid LIMIT 1", (pub,))
    if cur.fetchone():
        return "already_created"
    lon = clean(row.get("source_lon"))
    lat = clean(row.get("source_lat"))
    if not lon or not lat:
        return "skip_no_point"
    name_en = clean(row.get("source_name_en"))
    name_mm = clean(row.get("source_name_my"))
    canonical = name_mm or name_en or clean(row.get("source_pcode")) or "unnamed"
    stype = refs["settle_types"].get("village") or next(iter(refs["settle_types"].values()))
    cur.execute(
        """
        INSERT INTO core.core_settlements (
          public_id, settlement_type_id, canonical_name, name_mm, name_en,
          point_geom, township_id, source_type_id, source_refs,
          is_public, is_verified, verification_status, external_id
        ) VALUES (
          %s::uuid, %s, %s, %s, %s,
          ST_SetSRID(ST_MakePoint(%s::float8,%s::float8),4326), %s, %s,
          %s::jsonb, false, false, 'needs_fix', NULL
        )
        RETURNING id
        """,
        (
            pub,
            stype,
            canonical,
            name_mm or None,
            name_en or None,
            lon,
            lat,
            township_id,
            refs["sources"].get("partner"),
            json.dumps(
                {
                    "phase7_completion_v2": True,
                    "source_key": clean(row.get("source_key")),
                    "source_pcode_audit_only": clean(row.get("source_pcode")),
                    "geometry_source": "mimu_placeholder",
                }
            ),
        ),
    )
    return "created" if cur.fetchone() else "failed"


def apply_postal(cur, id_map: dict[str, int]) -> Counter:
    rows = load_csv(POSTAL)
    stats = Counter()

    def map_status(status: str) -> str:
        return {
            "linked_exact_local_area": "linked_exact_local_area",
            "linked_after_review": "linked_after_review",
            "ambiguous_local_area": "ambiguous_local_area",
            "missing_local_area": "missing_local_area",
            "missing_local_admin_identity": "missing_local_area",
            "missing_township": "missing_local_area",
            "non_admin_postal_locality": "non_admin_postal_locality",
            "rejected_source_error": "unmatched",
        }.get(status, "missing_local_area")

    for r in rows:
        code = clean(r.get("postal_code"))
        if not SEVEN.match(code):
            stats["skipped_malformed"] += 1
            continue
        status = clean(r.get("status"))
        db_status = map_status(status)

        local_id = as_int(r.get("matched_local_admin_area_id"))
        pub = clean(r.get("matched_local_admin_public_id"))
        if not local_id and pub:
            local_id = id_map.get(f"public:{pub}")
            if not local_id:
                cur.execute("SELECT id FROM core.core_admin_areas WHERE public_id=%s::uuid", (pub,))
                hit = cur.fetchone()
                if hit:
                    local_id = int(hit[0])
                    id_map[f"public:{pub}"] = local_id

        ts_id = as_int(r.get("matched_township_id"))
        ts_pub = clean(r.get("matched_township_public_id"))
        if not ts_id and ts_pub:
            ts_id = id_map.get(f"public:{ts_pub}")
            if not ts_id:
                cur.execute("SELECT id FROM core.core_admin_areas WHERE public_id=%s::uuid", (ts_pub,))
                hit = cur.fetchone()
                if hit:
                    ts_id = int(hit[0])
                    id_map[f"public:{ts_pub}"] = ts_id

        # If local linked, ensure township parent is set (DB check constraint)
        if local_id and not ts_id:
            cur.execute("SELECT parent_id FROM core.core_admin_areas WHERE id=%s", (local_id,))
            hit = cur.fetchone()
            if hit and hit[0]:
                ts_id = int(hit[0])

        if local_id and not ts_id:
            # cannot store local without township
            local_id = None
            if db_status.startswith("linked"):
                db_status = "missing_local_area"
                stats["linked_dropped_no_township"] += 1

        loc_type = clean(r.get("inferred_locality_type"))
        if loc_type not in {"ward", "village_tract"}:
            loc_type = None

        cur.execute(
            """
            INSERT INTO ref.ref_postal_codes (
              postal_code, match_status, match_method,
              region_name_en, region_name_mm, township_name_en, township_name_mm,
              locality_name_en, locality_name_mm, locality_type,
              township_admin_area_id, local_admin_area_id, source_version, updated_at
            ) VALUES (
              %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'phase7_completion_v2', now()
            )
            ON CONFLICT (postal_code) DO UPDATE SET
              match_status=EXCLUDED.match_status,
              match_method=EXCLUDED.match_method,
              region_name_en=EXCLUDED.region_name_en,
              region_name_mm=EXCLUDED.region_name_mm,
              township_name_en=EXCLUDED.township_name_en,
              township_name_mm=EXCLUDED.township_name_mm,
              locality_name_en=EXCLUDED.locality_name_en,
              locality_name_mm=EXCLUDED.locality_name_mm,
              locality_type=EXCLUDED.locality_type,
              township_admin_area_id=EXCLUDED.township_admin_area_id,
              local_admin_area_id=EXCLUDED.local_admin_area_id,
              source_version=EXCLUDED.source_version,
              updated_at=now()
            """,
            (
                code,
                db_status,
                clean(r.get("match_method")) or None,
                clean(r.get("region_en")) or None,
                clean(r.get("region_mm")) or None,
                clean(r.get("township_en")) or None,
                clean(r.get("township_mm")) or None,
                clean(r.get("locality_en")) or None,
                clean(r.get("locality_mm")) or None,
                loc_type,
                ts_id,
                local_id,
            ),
        )
        stats[db_status] += 1
        if status.startswith("linked") and not local_id:
            stats["linked_missing_fk"] += 1
    return stats


def inspect_postal_schema(cur) -> None:
    cur.execute(
        """
        SELECT column_name FROM information_schema.columns
        WHERE table_schema='ref' AND table_name='ref_postal_codes'
        ORDER BY ordinal_position
        """
    )
    cols = [r[0] for r in cur.fetchall()]
    print("postal_cols", cols)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--database-url", required=True)
    ap.add_argument("--mode", choices=["apply"], default="apply")
    args = ap.parse_args()
    assert_disposable(args.database_url)

    admin_rows = load_csv(V2 / "03-approved-local-admin.v2.csv")
    village_rows = load_csv(V2 / "03-approved-villages.v2.csv")
    id_map: dict[str, int] = {}
    outcomes = Counter()
    print("Loading geometry index...")
    geom_index = load_geom_index()
    print(f"Geometry index size: {len(geom_index)}")

    with psycopg.connect(args.database_url) as conn:
        conn.execute("SET search_path TO core, ref, public")
        with conn.cursor() as cur:
            refs = resolve_refs(cur)
            # Preload existing public_ids
            cur.execute("SELECT id, public_id::text FROM core.core_admin_areas WHERE deleted_at IS NULL")
            for i, p in cur.fetchall():
                id_map[f"public:{p}"] = int(i)

            # 1) Township creates
            for row in admin_rows:
                if clean(row.get("source_entity_type")) != "township":
                    continue
                if clean(row.get("action")) != "create_mimu_placeholder":
                    continue
                parent_pub = clean(row.get("parent_public_id"))
                parent_id = id_map.get(f"public:{parent_pub}") or as_int(row.get("matched_parent_id"))
                if not parent_id:
                    outcomes["township_skip_no_parent"] += 1
                    continue
                geom = None
                if clean(row.get("source_pcode")) == "MMR015005" and MIMU_TS.exists():
                    gj = json.loads(MIMU_TS.read_text(encoding="utf-8"))
                    geom = json.dumps(gj["geometry"])
                if not geom:
                    outcomes["township_skip_no_geom"] += 1
                    continue
                outcomes[create_admin(cur, row, refs, parent_id, geom, level_code="township", type_code="township", id_map=id_map)] += 1

            # Refresh Pangsang id
            pang_id = id_map.get(f"public:{PANG['target_public_id']}")
            if not pang_id:
                cur.execute("SELECT id FROM core.core_admin_areas WHERE public_id=%s::uuid", (PANG["target_public_id"],))
                hit = cur.fetchone()
                pang_id = int(hit[0]) if hit else None

            # 2) WVT creates / keep / update
            for row in admin_rows:
                entity = clean(row.get("source_entity_type"))
                if entity == "township":
                    continue
                action = clean(row.get("action"))
                if action == "create_mimu_placeholder":
                    parent_id = None
                    if clean(row.get("parent_public_id")):
                        parent_id = id_map.get(f"public:{clean(row.get('parent_public_id'))}")
                    if not parent_id:
                        parent_id = as_int(row.get("approved_township_id"))
                    if not parent_id:
                        outcomes["wvt_skip_no_parent"] += 1
                        continue
                    pcode = clean(row.get("source_pcode"))
                    geom = geom_index.get(pcode) or load_preview_geojson(
                        entity, pcode, clean(row.get("source_row"))
                    )
                    if not geom:
                        outcomes["wvt_skip_no_geom"] += 1
                        continue
                    type_code = "ward" if entity == "ward" else "village_tract"
                    outcomes[
                        "wvt_"
                        + create_admin(
                            cur,
                            row,
                            refs,
                            parent_id,
                            geom,
                            level_code="ward_village_tract",
                            type_code=type_code,
                            id_map=id_map,
                        )
                    ] += 1
                elif action in {"keep_existing", "update_names", "update_type"}:
                    outcomes[f"wvt_{action}"] += 1
                elif action == "merge_duplicate_candidate":
                    outcomes["wvt_merge_pending"] += 1
                elif action == "reject_source_error":
                    outcomes["wvt_rejected"] += 1

            # 3) Admin merges
            for row in admin_rows:
                if clean(row.get("action")) != "merge_duplicate_candidate":
                    continue
                survivor = as_int(row.get("matched_coremap_id"))
                loser = as_int(clean(row.get("losing_core_ids")).split(";")[0] if clean(row.get("losing_core_ids")) else None)
                if survivor and loser:
                    outcomes["merge_" + merge_admins(cur, survivor, loser)] += 1
                else:
                    outcomes["merge_skip"] += 1

            # 4/5 villages
            for row in village_rows:
                action = clean(row.get("action"))
                if action == "create_mimu_placeholder":
                    ts = as_int(row.get("approved_township_id"))
                    outcomes["settle_" + create_settlement(cur, row, refs, ts)] += 1
                elif action == "merge_duplicate_candidate":
                    survivor = as_int(row.get("matched_coremap_id"))
                    losers = [as_int(x) for x in clean(row.get("losing_core_ids")).split(";") if clean(x)]
                    for loser in losers:
                        if survivor and loser:
                            cur.execute(
                                """
                                UPDATE core.core_settlements
                                SET deleted_at=COALESCE(deleted_at, now()),
                                    source_refs = source_refs || jsonb_build_object('merged_into', %s::text),
                                    updated_at=now()
                                WHERE id=%s AND deleted_at IS NULL
                                """,
                                (survivor, loser),
                            )
                            outcomes["settle_merged"] += 1
                elif action in {"keep_existing", "update_names", "update_type"}:
                    outcomes[f"settle_{action}"] += 1
                elif action == "reject_source_error":
                    outcomes["settle_rejected"] += 1

            # 7/8 postal — adapt to actual schema
            inspect_postal_schema(cur)
            # Discover column set and build dynamic upsert if default fails
            try:
                postal_stats = apply_postal(cur, id_map)
            except Exception as exc:
                print("postal_apply_error", exc)
                # Fallback minimal upsert matching phase6 style
                cur.execute("ROLLBACK")
                raise

            conn.commit()

            # Validation snapshot
            cur.execute(
                """
                SELECT
                  (SELECT count(*) FROM core.core_admin_areas WHERE deleted_at IS NULL) AS admin_active,
                  (SELECT count(*) FROM core.core_admin_areas WHERE deleted_at IS NULL AND geometry_source='mimu_placeholder') AS admin_ph,
                  (SELECT count(*) FROM core.core_settlements WHERE deleted_at IS NULL) AS settle_active,
                  (SELECT count(*) FROM core.core_settlements WHERE deleted_at IS NULL AND (source_refs ? 'phase7_completion_v2')) AS settle_ph,
                  (SELECT count(*) FROM ref.ref_postal_codes) AS postal,
                  (SELECT count(*) FROM core.core_admin_areas WHERE public_id=%s::uuid) AS pang_exists
                """,
                (PANG["target_public_id"],),
            )
            snap = cur.fetchone()

    result = {
        "generated_at": utc_now(),
        "database_url_host": urlparse(args.database_url).hostname,
        "outcomes": dict(outcomes),
        "postal_stats": dict(postal_stats),
        "snapshot": {
            "admin_active": snap[0],
            "admin_placeholders": snap[1],
            "settle_active": snap[2],
            "settle_v2_placeholders": snap[3],
            "postal": snap[4],
            "pangsang_exists": snap[5],
        },
        "id_map_size": len(id_map),
    }
    (OUT / "validation").mkdir(exist_ok=True)
    (OUT / "validation/07-v2-apply-result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
