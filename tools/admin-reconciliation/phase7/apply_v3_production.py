#!/usr/bin/env python3
"""Phase 7 completion-v3 PRODUCTION database import (DB only).

Requires explicit:
  --i-approve-production-database-import-only

Scope:
  - postal schema align (Phase-5 migration SQL + v3 status CHECK expand)
  - admin / village / alias / postal import from frozen v3 manifests
  - PASS_DATABASE_ONLY (no search rebuild, no tiles, no CDN)

Does not invent admin from postal text. Does not store MIMU PCode as external_id.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import psycopg

REPO = Path(__file__).resolve().parents[3]
V3 = REPO / "reports/admin-reconciliation-v2/phase7-completion-v3"
V2 = REPO / "reports/admin-reconciliation-v2/phase7-completion-v2"
OUT = V3 / "production-apply"
REPORTS = REPO / "reports/admin-reconciliation-v2"
PREVIEWS = REPORTS / "phase3-previews"
PANG_GEOM = V2 / "01-pangsang-map-preview/mimu_MMR015005.geojson"
PANG = json.loads((V2 / "decisions/01-pangsang-township-freeze.json").read_text(encoding="utf-8"))
POSTAL_MIG = REPO / "infrastructure/database/migrations/supabase/20260921180000_phase5_ref_postal_codes.sql"
BACKUP = REPO / "reports/admin-reconciliation-v2/phase7-final-release/backup/07-prod-prephase7-affected.dump"
BACKUP_SHA = "73e505abd3efe529ad0ac25093f2663a98298b7038dec475efb387e8c4cd8b0a"

PRODUCTION_MARKERS = ("locghyuranqaqsnbxflc", "supabase.co", "pooler.supabase.com")
SEVEN = re.compile(r"^[0-9]{7}$")
UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)

csv.field_size_limit(min(2**31 - 1, 100_000_000))


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def clean(v: Any) -> str:
    return "" if v is None else str(v).strip()


def as_int(v: Any) -> int | None:
    t = clean(v)
    return int(t) if t else None


def load_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def clean_db_url(url: str) -> str:
    p = urlparse(url)
    q = [
        (k, v)
        for k, v in parse_qsl(p.query, keep_blank_values=True)
        if k.lower() not in {"pgbouncer", "connection_limit", "pool_timeout"}
    ]
    host = p.hostname or ""
    port = p.port
    if "pooler.supabase.com" in host and port == 6543:
        port = 5432  # session mode for long transaction
    netloc = p.netloc
    if p.port is not None:
        # rebuild user:pass@host:port
        if "@" in netloc:
            userinfo, hostport = netloc.rsplit("@", 1)
            host_only = hostport.rsplit(":", 1)[0]
            netloc = f"{userinfo}@{host_only}:{port}"
        else:
            netloc = f"{host}:{port}"
    return urlunparse((p.scheme, netloc, p.path, p.params, urlencode(q), p.fragment))


def assert_production_allowed(url: str, approved: bool) -> str:
    host = (urlparse(url).hostname or "").lower()
    is_prod = any(m in host for m in PRODUCTION_MARKERS)
    if not approved:
        raise SystemExit("Refusing production import without --i-approve-production-database-import-only")
    if not is_prod:
        raise SystemExit(f"This runner is for production only; host={host}")
    if "locghyuranqaqsnbxflc" not in host and "supabase" not in host:
        raise SystemExit(f"Unexpected production host: {host}")
    return host


def load_geom_index() -> dict[str, str]:
    index: dict[str, str] = {}
    for name in ("01-wards-normalized.geojson", "01-village-tracts-normalized.geojson"):
        path = REPORTS / name
        data = json.loads(path.read_text(encoding="utf-8"))
        for feat in data.get("features") or []:
            props = feat.get("properties") or {}
            pcode = clean(props.get("source_pcode") or props.get("mimu_audit_pcode"))
            geom = feat.get("geometry")
            if pcode and geom and geom.get("type") in {"Polygon", "MultiPolygon"}:
                index[pcode] = json.dumps(geom)
    for path in PREVIEWS.glob("*.geojson"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        feat = data["features"][0] if data.get("type") == "FeatureCollection" and data.get("features") else data
        props = feat.get("properties") or {}
        pcode = clean(props.get("source_pcode") or props.get("pcode"))
        if not pcode:
            m = re.search(r"(MMR[0-9A-Z]+)", path.name)
            pcode = m.group(1) if m else ""
        geom = feat.get("geometry")
        if pcode and geom and pcode not in index and geom.get("type") in {"Polygon", "MultiPolygon"}:
            index[pcode] = json.dumps(geom)
    return index


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


def log(msg: str) -> None:
    print(msg, flush=True)


def ensure_names(cur, admin_id: int, name_en: str, name_mm: str, *, name_type: str = "official", primary: bool = True) -> None:
    for lang, name in (("en", name_en), ("my", name_mm)):
        if not name:
            continue
        cur.execute(
            """
            INSERT INTO core.core_admin_area_names (admin_area_id, name, language_code, name_type, is_primary, search_weight)
            SELECT %s, %s, %s, %s, %s, %s
            WHERE NOT EXISTS (
              SELECT 1 FROM core.core_admin_area_names
              WHERE admin_area_id=%s AND name=%s AND language_code=%s
            )
            """,
            (admin_id, name, lang, name_type, primary, 100 if primary else 50, admin_id, name, lang),
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
    existing_pubs: set[str],
) -> str:
    """Idempotent create keyed by frozen public_id only (no JSONB source_key scan)."""
    sk = clean(row.get("source_key"))
    pub = clean(row.get("target_public_id"))
    slug = clean(row.get("target_slug"))
    if not pub or not slug or not UUID_RE.match(pub):
        return "skip_missing_frozen_ids"
    if pub in existing_pubs:
        # id_map should already hold public: mapping from preload / prior create
        if f"public:{pub}" in id_map:
            aid = id_map[f"public:{pub}"]
            if sk:
                id_map[sk] = aid
        return "already_created"
    name_en = clean(row.get("source_name_en"))
    name_mm = clean(row.get("source_name_my"))
    canonical = name_mm or name_en or clean(row.get("source_pcode")) or "unnamed"
    marker = {
        "phase7_completion_v3": True,
        "source_key": sk,
        "source_pcode_audit_only": clean(row.get("source_pcode")),
        "mimu_version": "9.7",
        "licence": "PASS_DATABASE_ONLY",
    }
    # Prefer MakeValid only when needed; avoid JSONB OR lookup (was O(n^2) over remote).
    cur.execute(
        """
        WITH raw AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON(%s),4326) AS g),
        cleaned AS (
          SELECT CASE WHEN ST_IsValid(g) THEN g ELSE ST_MakeValid(g) END AS g FROM raw
        ),
        normalized AS (
          SELECT ST_Multi(ST_CollectionExtract(g,3))::geometry(MultiPolygon,4326) AS g FROM cleaned
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
          'search_only', false, 50,
          'mimu_placeholder', 'mimu', 'permission_pending',
          %s::jsonb, %s::jsonb, 'phase7_completion_v3:create'
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
    existing_pubs.add(pub)
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
            normalized_data = normalized_data || jsonb_build_object('merged_into', %s::text, 'phase7_completion_v3_merge', true),
            updated_at=now()
        WHERE id=%s AND deleted_at IS NULL
        """,
        (str(survivor), loser),
    )
    cur.execute("UPDATE core.core_admin_areas SET parent_id=%s, updated_at=now() WHERE parent_id=%s", (survivor, loser))
    cur.execute("UPDATE core.core_settlements SET township_id=%s, updated_at=now() WHERE township_id=%s", (survivor, loser))
    cur.execute("UPDATE ref.ref_postal_codes SET local_admin_area_id=%s WHERE local_admin_area_id=%s", (survivor, loser))
    cur.execute("UPDATE ref.ref_postal_codes SET township_admin_area_id=%s WHERE township_admin_area_id=%s", (survivor, loser))
    return "merged"


def create_settlement(
    cur,
    row: dict[str, str],
    refs: dict[str, Any],
    township_id: int | None,
    existing_settle_pubs: set[str],
) -> str:
    pub = clean(row.get("target_public_id"))
    if not pub or not UUID_RE.match(pub):
        return "skip_missing_public_id"
    if pub in existing_settle_pubs:
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
                    "phase7_completion_v3": True,
                    "source_key": clean(row.get("source_key")),
                    "source_pcode_audit_only": clean(row.get("source_pcode")),
                    "geometry_source": "mimu_placeholder",
                    "licence": "PASS_DATABASE_ONLY",
                }
            ),
        ),
    )
    if cur.fetchone():
        existing_settle_pubs.add(pub)
        return "created"
    return "failed"


def apply_aliases(cur, id_map: dict[str, int]) -> Counter:
    rows = load_csv(V3 / "03-admin-alias-actions-v3.csv")
    stats = Counter()
    for r in rows:
        pub = clean(r.get("admin_public_id"))
        name = clean(r.get("alias_name"))
        lang = clean(r.get("language_code")).lower() or "en"
        if not pub or not name:
            stats["skip_blank"] += 1
            continue
        if clean(r.get("replace_primary")) == "true":
            stats["skip_replace_primary"] += 1
            continue
        admin_id = id_map.get(f"public:{pub}")
        if not admin_id:
            cur.execute("SELECT id FROM core.core_admin_areas WHERE public_id=%s::uuid", (pub,))
            hit = cur.fetchone()
            if not hit:
                stats["skip_missing_admin"] += 1
                continue
            admin_id = int(hit[0])
            id_map[f"public:{pub}"] = admin_id
        # never insert duplicate; never mark primary
        cur.execute(
            """
            INSERT INTO core.core_admin_area_names (admin_area_id, name, language_code, name_type, is_primary, search_weight)
            SELECT %s, %s, %s, 'alias', false, 50
            WHERE NOT EXISTS (
              SELECT 1 FROM core.core_admin_area_names
              WHERE admin_area_id=%s AND name=%s AND language_code=%s
            )
            """,
            (admin_id, name, lang if lang in {"en", "my", "mm"} else "en", admin_id, name, lang if lang != "mm" else "my"),
        )
        stats["alias_inserted_or_exists"] += 1
    return stats


def postal_region_cols(cur) -> tuple[str, str, str]:
    cur.execute(
        """
        SELECT column_name FROM information_schema.columns
        WHERE table_schema='ref' AND table_name='ref_postal_codes'
          AND column_name IN ('region_name_mm','region_name_my','township_name_mm','township_name_my','locality_name_mm','locality_name_my')
        """
    )
    cols = {r[0] for r in cur.fetchall()}
    region = "region_name_mm" if "region_name_mm" in cols else "region_name_my"
    township = "township_name_mm" if "township_name_mm" in cols else "township_name_my"
    locality = "locality_name_mm" if "locality_name_mm" in cols else "locality_name_my"
    return region, township, locality


def map_postal_status(status: str) -> str:
    return {
        "linked_exact": "linked_exact_local_area",
        "linked_exact_local_area": "linked_exact_local_area",
        "linked_after_review": "linked_after_review",
        "confirmed_non_admin": "confirmed_non_admin",
        "non_admin_postal_locality": "non_admin_postal_locality",
        "rejected_source_error": "rejected_source_error",
        "unmatched": "unmatched",
    }.get(status, status)


def apply_postal(cur, id_map: dict[str, int]) -> Counter:
    rows = load_csv(V3 / "03-postal-actions-v3.csv")
    stats = Counter()
    region_c, township_c, locality_c = postal_region_cols(cur)
    sql = f"""
        INSERT INTO ref.ref_postal_codes (
          postal_code, match_status, match_method,
          region_name_en, {region_c}, township_name_en, {township_c},
          locality_name_en, {locality_c}, locality_type,
          township_admin_area_id, local_admin_area_id, source_version, updated_at
        ) VALUES (
          %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'phase7_completion_v3', now()
        )
        ON CONFLICT (postal_code) DO UPDATE SET
          match_status=EXCLUDED.match_status,
          match_method=EXCLUDED.match_method,
          region_name_en=EXCLUDED.region_name_en,
          {region_c}=EXCLUDED.{region_c},
          township_name_en=EXCLUDED.township_name_en,
          {township_c}=EXCLUDED.{township_c},
          locality_name_en=EXCLUDED.locality_name_en,
          {locality_c}=EXCLUDED.{locality_c},
          locality_type=EXCLUDED.locality_type,
          township_admin_area_id=EXCLUDED.township_admin_area_id,
          local_admin_area_id=EXCLUDED.local_admin_area_id,
          source_version=EXCLUDED.source_version,
          updated_at=now()
    """
    for r in rows:
        code = clean(r.get("postal_code"))
        if not SEVEN.match(code):
            stats["skipped_malformed"] += 1
            continue
        status = clean(r.get("status"))
        db_status = map_postal_status(status)
        pub = clean(r.get("matched_local_admin_public_id"))
        local_id = None
        if pub:
            local_id = id_map.get(f"public:{pub}")
            if not local_id:
                cur.execute("SELECT id FROM core.core_admin_areas WHERE public_id=%s::uuid", (pub,))
                hit = cur.fetchone()
                if hit:
                    local_id = int(hit[0])
                    id_map[f"public:{pub}"] = local_id
        ts_pub = clean(r.get("matched_township_public_id"))
        ts_id = None
        if ts_pub:
            ts_id = id_map.get(f"public:{ts_pub}")
            if not ts_id:
                cur.execute("SELECT id FROM core.core_admin_areas WHERE public_id=%s::uuid", (ts_pub,))
                hit = cur.fetchone()
                if hit:
                    ts_id = int(hit[0])
                    id_map[f"public:{ts_pub}"] = ts_id
        if local_id and not ts_id:
            cur.execute("SELECT parent_id FROM core.core_admin_areas WHERE id=%s", (local_id,))
            hit = cur.fetchone()
            if hit and hit[0]:
                ts_id = int(hit[0])
        if db_status in {"linked_exact_local_area", "linked_after_review"} and not local_id:
            stats["linked_missing_fk"] += 1
            db_status = "missing_local_area"
            local_id = None
        if local_id and not ts_id:
            local_id = None
            if db_status.startswith("linked"):
                db_status = "missing_local_area"
                stats["linked_dropped_no_township"] += 1
        if db_status in {"confirmed_non_admin", "rejected_source_error", "non_admin_postal_locality", "unmatched"}:
            local_id = None
        loc_type = clean(r.get("inferred_locality_type"))
        if loc_type not in {"ward", "village_tract"}:
            loc_type = None
        cur.execute(
            sql,
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
    return stats


def prepare_postal_schema(cur) -> None:
    # Apply Phase-5 alignment SQL (idempotent)
    sql = POSTAL_MIG.read_text(encoding="utf-8")
    # Strip outer BEGIN/COMMIT so we stay in caller transaction
    sql = re.sub(r"(?i)^\s*BEGIN\s*;", "", sql)
    sql = re.sub(r"(?i)^\s*COMMIT\s*;\s*$", "", sql)
    cur.execute(sql)
    # Expand CHECK for v3 statuses
    cur.execute("ALTER TABLE ref.ref_postal_codes DROP CONSTRAINT IF EXISTS ref_postal_codes_match_status_chk")
    cur.execute(
        """
        ALTER TABLE ref.ref_postal_codes
        ADD CONSTRAINT ref_postal_codes_match_status_chk
        CHECK (match_status IN (
          'linked_exact_local_area',
          'linked_after_review',
          'ambiguous_local_area',
          'missing_local_area',
          'non_admin_postal_locality',
          'confirmed_non_admin',
          'rejected_source_error',
          'linked_local_area',
          'linked_township_only',
          'ambiguous',
          'unmatched',
          'malformed_rejected'
        ))
        """
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--database-url", required=True)
    ap.add_argument(
        "--i-approve-production-database-import-only",
        action="store_true",
        help="Required written approval gate for production DB import only",
    )
    ap.add_argument("--skip-search-tiles-cdn", action="store_true", default=True)
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    url = clean_db_url(args.database_url)
    host = assert_production_allowed(url, args.i_approve_production_database_import_only)

    if not BACKUP.exists() or sha256_file(BACKUP) != BACKUP_SHA:
        raise SystemExit("Backup SHA mismatch or missing — hard stop")

    # Verify frozen checksums
    cs = json.loads((V3 / "checksums/03-v3-frozen-manifest.checksums.json").read_text(encoding="utf-8"))
    for rel, meta in cs["files"].items():
        got = sha256_file(V3 / rel)
        if got != meta["sha256"]:
            raise SystemExit(f"Frozen manifest checksum mismatch: {rel}")

    admin_rows = load_csv(V3 / "03-admin-actions-v3.csv")
    village_rows = load_csv(V3 / "03-village-actions-v3.csv")
    log("Loading geometry index...")
    geom_index = load_geom_index()
    log(f"Geometry index size: {len(geom_index)}")

    pre_hashes: dict[str, str] = {}
    id_map: dict[str, int] = {}
    outcomes: Counter = Counter()
    existing_pubs: set[str] = set()
    existing_settle_pubs: set[str] = set()
    COMMIT_EVERY = 200

    with psycopg.connect(url, connect_timeout=60) as conn:
        conn.execute("SET search_path TO core, ref, public")
        conn.execute("SET statement_timeout = 0")
        conn.execute("SET idle_in_transaction_session_timeout = 0")
        conn.execute("SET synchronous_commit = off")

        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  (SELECT count(*) FROM core.core_admin_areas WHERE deleted_at IS NULL),
                  (SELECT count(*) FROM core.core_admin_areas WHERE deleted_at IS NULL AND geometry_source='mimu_placeholder'),
                  (SELECT count(*) FROM core.core_settlements WHERE deleted_at IS NULL),
                  (SELECT count(*) FROM core.core_admin_areas WHERE public_id=%s::uuid)
                """,
                (PANG["target_public_id"],),
            )
            pre = cur.fetchone()
            log(f"preflight {pre}")
            if pre[1] and pre[1] > 0:
                log("WARNING: placeholders already present — continue is idempotent for public_id")
            if pre[3]:
                log("Pangsang already exists — create will short-circuit")

            keep_ids = []
            for r in admin_rows:
                if clean(r.get("action")) in {"keep_existing", "update_names", "update_type"}:
                    mid = as_int(r.get("matched_coremap_id"))
                    if mid:
                        keep_ids.append(mid)
            keep_ids = sorted(set(keep_ids))
            if keep_ids:
                cur.execute(
                    """
                    SELECT id::text, md5(ST_AsEWKB(geom))
                    FROM core.core_admin_areas
                    WHERE id = ANY(%s) AND deleted_at IS NULL
                    """,
                    (keep_ids,),
                )
                pre_hashes = {i: h for i, h in cur.fetchall()}
            log(f"pre_hashed_keep_existing {len(pre_hashes)}")

            log("Preparing postal schema...")
            prepare_postal_schema(cur)
            conn.commit()
            log("postal schema committed")

            refs = resolve_refs(cur)
            cur.execute("SELECT id, public_id::text FROM core.core_admin_areas WHERE deleted_at IS NULL")
            for i, p in cur.fetchall():
                id_map[f"public:{p}"] = int(i)
                existing_pubs.add(p)
            cur.execute("SELECT public_id::text FROM core.core_settlements WHERE deleted_at IS NULL")
            existing_settle_pubs = {r[0] for r in cur.fetchall()}
            log(f"preloaded admins={len(existing_pubs)} settlements={len(existing_settle_pubs)}")

            since_commit = 0

            def maybe_commit(force: bool = False) -> None:
                nonlocal since_commit
                if force or since_commit >= COMMIT_EVERY:
                    conn.commit()
                    since_commit = 0

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
                if clean(row.get("source_pcode")) == "MMR015005" and PANG_GEOM.exists():
                    gj = json.loads(PANG_GEOM.read_text(encoding="utf-8"))
                    geom = json.dumps(gj["geometry"] if "geometry" in gj else gj)
                if not geom:
                    outcomes["township_skip_no_geom"] += 1
                    continue
                out = create_admin(
                    cur, row, refs, parent_id, geom,
                    level_code="township", type_code="township",
                    id_map=id_map, existing_pubs=existing_pubs,
                )
                outcomes["township_" + out] += 1
                if out == "created":
                    since_commit += 1
                    maybe_commit()

            pang_id = id_map.get(f"public:{PANG['target_public_id']}")
            if not pang_id:
                cur.execute("SELECT id FROM core.core_admin_areas WHERE public_id=%s::uuid", (PANG["target_public_id"],))
                hit = cur.fetchone()
                pang_id = int(hit[0]) if hit else None
            maybe_commit(force=True)
            log(f"township phase done pang_id={pang_id}")
            log("starting wvt phase...")

            wvt_done = 0
            wvt_created = 0
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
                    geom = geom_index.get(pcode)
                    if not geom:
                        outcomes["wvt_skip_no_geom"] += 1
                        continue
                    type_code = "ward" if entity == "ward" else "village_tract"
                    out = create_admin(
                        cur, row, refs, parent_id, geom,
                        level_code="ward_village_tract", type_code=type_code,
                        id_map=id_map, existing_pubs=existing_pubs,
                    )
                    outcomes["wvt_" + out] += 1
                    wvt_done += 1
                    if out == "created":
                        wvt_created += 1
                        since_commit += 1
                        maybe_commit()
                    if wvt_done % 100 == 0:
                        log(f"wvt progress done={wvt_done} created={wvt_created}")
                elif action in {"keep_existing", "update_names", "update_type"}:
                    mid = as_int(row.get("matched_coremap_id"))
                    if mid and action == "update_names":
                        ensure_names(cur, mid, clean(row.get("source_name_en")), clean(row.get("source_name_my")))
                        since_commit += 1
                        maybe_commit()
                    outcomes[f"wvt_{action}"] += 1
                elif action == "merge_duplicate_candidate":
                    outcomes["wvt_merge_pending"] += 1
                elif action == "reject_source_error":
                    outcomes["wvt_rejected"] += 1

            maybe_commit(force=True)
            log(f"wvt phase done created={wvt_created}")

            for row in admin_rows:
                if clean(row.get("action")) != "merge_duplicate_candidate":
                    continue
                survivor = as_int(row.get("matched_coremap_id"))
                loser_raw = clean(row.get("losing_core_ids") or row.get("merge_losing_core_ids"))
                loser = as_int(loser_raw.split(";")[0] if loser_raw else None)
                if survivor and loser:
                    outcomes["merge_" + merge_admins(cur, survivor, loser)] += 1
                    since_commit += 1
                    maybe_commit()
                else:
                    outcomes["merge_skip"] += 1
            maybe_commit(force=True)
            log("merge phase done")

            settle_done = 0
            settle_created = 0
            for row in village_rows:
                action = clean(row.get("action"))
                if action == "create_mimu_placeholder":
                    ts = as_int(row.get("approved_township_id"))
                    out = create_settlement(cur, row, refs, ts, existing_settle_pubs)
                    outcomes["settle_" + out] += 1
                    settle_done += 1
                    if out == "created":
                        settle_created += 1
                        since_commit += 1
                        maybe_commit()
                    if settle_done % 500 == 0:
                        log(f"settle progress done={settle_done} created={settle_created}")
                elif action == "merge_duplicate_candidate":
                    survivor = as_int(row.get("matched_coremap_id"))
                    losers = [as_int(x) for x in clean(row.get("losing_core_ids")).split(";") if clean(x)]
                    for loser in losers:
                        if survivor and loser:
                            cur.execute(
                                """
                                UPDATE core.core_settlements
                                SET deleted_at=COALESCE(deleted_at, now()),
                                    source_refs = source_refs || jsonb_build_object('merged_into', %s::text, 'phase7_completion_v3_merge', true),
                                    updated_at=now()
                                WHERE id=%s AND deleted_at IS NULL
                                """,
                                (str(survivor), loser),
                            )
                            outcomes["settle_merged"] += 1
                            since_commit += 1
                            maybe_commit()
                elif action in {"keep_existing", "update_names", "update_type"}:
                    outcomes[f"settle_{action}"] += 1
                elif action == "reject_source_error":
                    outcomes["settle_rejected"] += 1
            maybe_commit(force=True)
            log(f"settle phase done created={settle_created}")

            log("applying aliases...")
            alias_stats = apply_aliases(cur, id_map)
            maybe_commit(force=True)
            log(f"alias stats {dict(alias_stats)}")

            log("applying postal...")
            postal_stats = apply_postal(cur, id_map)
            maybe_commit(force=True)
            log(f"postal stats {dict(postal_stats)}")

            changed_geom = 0
            if pre_hashes:
                ids = [int(i) for i in pre_hashes.keys()]
                cur.execute(
                    """
                    SELECT id::text, md5(ST_AsEWKB(geom))
                    FROM core.core_admin_areas
                    WHERE id = ANY(%s) AND deleted_at IS NULL
                    """,
                    (ids,),
                )
                for i, h in cur.fetchall():
                    if pre_hashes.get(i) != h:
                        changed_geom += 1

            cur.execute(
                """
                SELECT
                  (SELECT count(*) FROM core.core_admin_areas WHERE deleted_at IS NULL) AS admin_active,
                  (SELECT count(*) FROM core.core_admin_areas WHERE deleted_at IS NULL AND geometry_source='mimu_placeholder') AS admin_ph,
                  (SELECT count(*) FROM core.core_settlements WHERE deleted_at IS NULL) AS settle_active,
                  (SELECT count(*) FROM core.core_settlements WHERE deleted_at IS NULL AND (source_refs ? 'phase7_completion_v3')) AS settle_ph,
                  (SELECT count(*) FROM ref.ref_postal_codes) AS postal,
                  (SELECT count(*) FROM core.core_admin_areas WHERE public_id=%s::uuid) AS pang_exists,
                  (SELECT count(*) FROM core.core_admin_areas a
                     JOIN core.core_admin_areas p ON p.id=a.parent_id
                    WHERE a.deleted_at IS NULL AND p.public_id=%s::uuid) AS pang_children
                """,
                (PANG["target_public_id"], PANG["target_public_id"]),
            )
            snap = cur.fetchone()

            cur.execute(
                """
                SELECT match_status, count(*)
                FROM ref.ref_postal_codes
                GROUP BY 1 ORDER BY 2 DESC
                """
            )
            postal_breakdown = {k: int(v) for k, v in cur.fetchall()}

            conn.commit()
            log("final commit done")

    result = {
        "generated_at": utc_now(),
        "scope": "production_database_import_only",
        "licence": "PASS_DATABASE_ONLY",
        "search_rebuild": False,
        "tiles_rebuild": False,
        "cdn_invalidate": False,
        "database_host": host,
        "backup_sha256": BACKUP_SHA,
        "frozen_checksums": cs["files"],
        "preflight": {
            "admin_active": pre[0],
            "admin_placeholders": pre[1],
            "settle_active": pre[2],
            "pangsang_exists": pre[3],
        },
        "outcomes": dict(outcomes),
        "alias_stats": dict(alias_stats),
        "postal_stats": dict(postal_stats),
        "postal_breakdown": postal_breakdown,
        "geometry_preservation": {
            "keep_existing_prehashed": len(pre_hashes),
            "changed_keep_existing_geom": changed_geom,
            "result": "PASS" if changed_geom == 0 else "FAIL",
        },
        "snapshot": {
            "admin_active": snap[0],
            "admin_placeholders": snap[1],
            "settle_active": snap[2],
            "settle_v3_placeholders": snap[3],
            "postal": snap[4],
            "pangsang_exists": snap[5],
            "pangsang_children": snap[6],
        },
    }
    (OUT / "03-production-apply-result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")

    summary = f"""# Phase 7 v3 — production database import result

Generated: `{result['generated_at']}`  
Scope: **database import only** (`PASS_DATABASE_ONLY`)  
Search rebuild: **not run**  
Tiles/CDN: **not run**

## Preflight
- Backup SHA verified: `{BACKUP_SHA}`
- Frozen v3 checksums verified
- Host: `{host}`

## Snapshot
| Metric | Pre | Post |
|---|---:|---:|
| Admin active | {pre[0]} | {snap[0]} |
| Admin mimu_placeholder | {pre[1]} | {snap[1]} |
| Settlements active | {pre[2]} | {snap[2]} |
| Pangsang township | {pre[3]} | {snap[5]} |
| Pangsang VT children | - | {snap[6]} |
| Postal rows | - | {snap[4]} |

## Geometry preservation
- keep_existing geom changed: **{changed_geom}** ({result['geometry_preservation']['result']})

## Postal status breakdown
{chr(10).join(f"- `{k}`: {v}" for k,v in sorted(postal_breakdown.items(), key=lambda kv: (-kv[1], kv[0])))}

## Notes
- Empty-PCode Pangsang VT remained rejected (not created).
- Placeholders are `is_public_usable=false`, `geometry_source=mimu_placeholder`, `verification_status=needs_fix`.
"""
    (OUT / "03-production-apply-summary.md").write_text(summary, encoding="utf-8")
    log(json.dumps(result["snapshot"], indent=2))
    log(f"geometry_changed {changed_geom}")
    log(f"wrote {OUT}")
    if changed_geom != 0:
        return 2
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        import traceback
        log(f"FATAL: {exc}")
        traceback.print_exc()
        raise
