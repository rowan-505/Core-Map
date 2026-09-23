#!/usr/bin/env python3
"""Idempotent Phase 2 admin import from approved 01-admin-actions.csv.

Modes:
  dry-run  — plan actions + postcondition report; no writes
  apply    — execute against DATABASE_URL (disposable/local only)

Rules (summary):
  - Never overwrite matched geometry with MIMU geometry.
  - Never import action=manual_review.
  - Never insert villages into core_admin_areas.
  - create_mimu_placeholder with spatial core_id=N is promoted to a matched
    update of N (idempotent; avoids duplicate identities).
  - create_mimu_placeholder without valid Myanmar geometry is skipped.
  - New placeholders (rare) use geometry_source='mimu_placeholder',
    is_official_boundary=false, external_id=null, no persisted MIMU PCode.
  - Do not apply to production until the dry-run report is approved.
"""

from __future__ import annotations

import argparse
import collections
import csv
import hashlib
import json
import re
import sys
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

csv.field_size_limit(min(2**31 - 1, 100_000_000))

LEVEL_ORDER = [
    "country",
    "state_region",
    "self_administered_zone",
    "district",
    "township",
    "town",
    "ward_village_tract",
]

# admin_level_id / admin_area_type_id (ref tables)
LEVEL_IDS = {
    "country": 1,
    "state_region": 2,
    "district": 3,
    "self_administered_zone": 9,
    "township": 4,
    "town": 5,
    "ward_village_tract": 6,
}
TYPE_IDS = {
    "country": 1,
    "state": 2,
    "region": 3,
    "union_territory": 4,
    "self_administered_zone": 5,
    "self_administered_division": 6,
    "district": 7,
    "township": 8,
    "town": 9,
    "ward": 10,
    "village_tract": 11,
    "special_area": 14,
}

IMPORT_MARKER = "phase2_manifest_import"
SOURCE_TYPE_MANUAL = 2
COUNTRY_ID = 11
CORE_ID_RE = re.compile(r"core_id=(\d+)")
SLUG_RE = re.compile(r"[^a-z0-9]+")


def clean(value: Any) -> str:
    return "" if value is None else str(value).strip()


def as_int(value: Any) -> int | None:
    text = clean(value)
    return int(text) if text else None


def boolish(value: Any) -> bool:
    return clean(value).lower() in {"1", "true", "t", "yes", "y"}


def parse_spatial_core_id(spatial_evidence: str) -> int | None:
    match = CORE_ID_RE.search(spatial_evidence or "")
    return int(match.group(1)) if match else None


def slugify(name_en: str, source_key: str) -> str:
    base = SLUG_RE.sub("-", (name_en or "area").casefold()).strip("-") or "area"
    digest = hashlib.sha1(source_key.encode("utf-8")).hexdigest()[:10]
    return f"coremap:ph:{base[:48]}:{digest}"


def subtype_type_id(level: str, subtype: str) -> int:
    subtype = clean(subtype)
    if subtype in TYPE_IDS:
        return TYPE_IDS[subtype]
    if level == "state_region":
        return TYPE_IDS["state"]
    if level == "self_administered_zone":
        return TYPE_IDS["self_administered_zone"]
    if level == "ward_village_tract":
        return TYPE_IDS["village_tract"]
    if level in TYPE_IDS:
        return TYPE_IDS[level]
    return 15  # unknown


@dataclass
class PlanRow:
    source_key: str
    level: str
    action: str
    outcome: str
    coremap_id: int | None = None
    target_parent_id: int | None = None
    name_en: str = ""
    name_my: str = ""
    official: bool = False
    notes: str = ""
    rename: bool = False
    reparent: bool = False
    reclassify: bool = False
    create: bool = False
    geom_md5_before: str | None = None


@dataclass
class Stats:
    by_level: dict[str, collections.Counter] = field(default_factory=lambda: collections.defaultdict(collections.Counter))
    totals: collections.Counter = field(default_factory=collections.Counter)
    postconditions: dict[str, Any] = field(default_factory=dict)
    village_note: str = ""


def read_manifest(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def load_mimu_geoms(path: Path | None) -> dict[str, str]:
    """Map audit_only_source_pcode -> geojson text. Stream to avoid huge RAM spikes."""
    if path is None or not path.exists():
        return {}
    result: dict[str, str] = {}
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            pcode = clean(row.get("pcode"))
            geom = row.get("geom_geojson") or ""
            if pcode and geom:
                result[pcode] = geom
    return result


def connect(database_url: str):
    try:
        import psycopg
    except ImportError as exc:  # pragma: no cover
        raise SystemExit(
            "psycopg is required. Run with: uv run --with 'psycopg[binary]' "
            "tools/admin-reconciliation/phase2_import_manifest.py ..."
        ) from exc
    return psycopg.connect(database_url)


def fetch_area_index(conn) -> dict[int, dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT a.id, a.public_id::text, a.parent_id, a.slug, a.canonical_name,
                   a.admin_level_id, a.admin_area_type_id, a.address_usage,
                   a.is_official_boundary, a.is_public_usable, a.geometry_source,
                   a.verification_status, a.is_active, a.deleted_at,
                   md5(ST_AsEWKB(a.geom)) AS geom_md5,
                   l.code AS level_code
            FROM core.core_admin_areas a
            JOIN ref.ref_admin_levels l ON l.id = a.admin_level_id
            """
        )
        cols = [d.name for d in cur.description]
        return {int(row[0]): dict(zip(cols, row)) for row in cur.fetchall()}


def compact(text: str) -> str:
    import unicodedata

    value = unicodedata.normalize("NFKC", clean(text)).casefold()
    return re.sub(r"[^0-9a-z\u1000-\u109f]+", "", value)


def build_name_index(conn, areas: dict[int, dict[str, Any]]) -> dict[tuple[str, str], list[int]]:
    """(level_code, compact_name) -> [ids] from primary names + canonical."""
    index: dict[tuple[str, str], list[int]] = collections.defaultdict(list)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT n.admin_area_id, n.name, l.code
            FROM core.core_admin_area_names n
            JOIN core.core_admin_areas a ON a.id = n.admin_area_id
            JOIN ref.ref_admin_levels l ON l.id = a.admin_level_id
            WHERE n.is_primary AND a.deleted_at IS NULL
            """
        )
        for admin_id, name, level_code in cur.fetchall():
            key = (level_code, compact(name))
            if key[1] and admin_id not in index[key]:
                index[key].append(int(admin_id))
    for area in areas.values():
        key = (area["level_code"], compact(area["canonical_name"]))
        if key[1] and int(area["id"]) not in index[key]:
            index[key].append(int(area["id"]))
    return index


def resolve_by_name(
    row: dict[str, str],
    name_index: dict[tuple[str, str], list[int]],
    areas: dict[int, dict[str, Any]],
) -> int | None:
    level = row["hierarchy_level"]
    candidates: list[int] = []
    for label in (row.get("source_name_my"), row.get("source_name_en")):
        key = (level, compact(label or ""))
        candidates.extend(name_index.get(key, []))
    # SAZ/SAD also searchable under either level code used in CoreMap
    if level == "self_administered_zone":
        for label in (row.get("source_name_my"), row.get("source_name_en")):
            for lvl in ("self_administered_zone", "district", "state_region"):
                key = (lvl, compact(label or ""))
                candidates.extend(name_index.get(key, []))
    # unique
    uniq = []
    for cid in candidates:
        if cid in areas and cid not in uniq:
            uniq.append(cid)
    if len(uniq) == 1:
        return uniq[0]
    # Prefer parent-scoped uniqueness
    parent = as_int(row.get("target_parent_coremap_id"))
    if parent:
        scoped = [c for c in uniq if int(areas[c]["parent_id"] or 0) == parent]
        if len(scoped) == 1:
            return scoped[0]
    return None


def fetch_import_source_map(conn) -> dict[str, int]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, normalized_data->%s->>'source_key'
            FROM core.core_admin_areas
            WHERE normalized_data ? %s
            """,
            (IMPORT_MARKER, IMPORT_MARKER),
        )
        return {sk: int(i) for i, sk in cur.fetchall() if sk}


def fetch_saz_name_index(conn) -> dict[str, int]:
    """Map compact EN/MY names of existing SAZ/SAD rows for promote-before-create."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT a.id, n.language_code, n.name
            FROM core.core_admin_areas a
            JOIN ref.ref_admin_levels l ON l.id = a.admin_level_id
            JOIN core.core_admin_area_names n ON n.admin_area_id = a.id
            WHERE l.code = 'self_administered_zone'
              AND a.deleted_at IS NULL
              AND n.language_code IN ('en', 'my')
            """
        )
        out: dict[str, int] = {}
        for area_id, lang, name in cur.fetchall():
            out[f"{lang}:{clean(name).casefold()}"] = int(area_id)
            compact = "".join(ch for ch in clean(name).casefold() if ch.isalnum() or ch.isspace())
            out[f"{lang}:compact:{compact}"] = int(area_id)
        return out


def match_existing_saz(row: dict[str, str], saz_index: dict[str, int]) -> int | None:
    en = clean(row.get("source_name_en"))
    my = clean(row.get("source_name_my"))
    for lang, name in (("en", en), ("my", my)):
        if not name:
            continue
        direct = saz_index.get(f"{lang}:{name.casefold()}")
        if direct:
            return direct
        compact = "".join(ch for ch in name.casefold() if ch.isalnum() or ch.isspace())
        hit = saz_index.get(f"{lang}:compact:{compact}")
        if hit:
            return hit
    en_l = en.casefold()
    token_map = [
        ("naga", "naga"),
        ("danu", "danu"),
        ("pa-o", "ပအိုဝ်း"),
        ("pa'o", "ပအိုဝ်း"),
        ("pa o", "ပအိုဝ်း"),
        ("pa laung", "ပလောင်"),
        ("palaung", "ပလောင်"),
        ("kokang", "ကိုးကန့်"),
        ("wa self", "ဝကိုယ်ပိုင်"),
    ]
    for token, needle in token_map:
        if token not in en_l:
            continue
        for key, area_id in saz_index.items():
            if needle.casefold() in key:
                return area_id
    return None


def fetch_primary_names(conn, area_ids: list[int]) -> dict[int, dict[str, str]]:
    if not area_ids:
        return {}
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT admin_area_id, language_code, name
            FROM core.core_admin_area_names
            WHERE is_primary AND language_code IN ('en','my')
              AND admin_area_id = ANY(%s)
            ORDER BY admin_area_id, language_code, id
            """,
            (area_ids,),
        )
        out: dict[int, dict[str, str]] = collections.defaultdict(dict)
        for admin_id, lang, name in cur.fetchall():
            out[int(admin_id)].setdefault(lang, name)
        return out


def ensure_primary_names(
    cur,
    area_id: int,
    name_en: str,
    name_my: str,
    *,
    dry_run: bool,
) -> bool:
    """Ensure one primary EN and one primary MY. Former primaries become aliases. Returns True if renamed."""
    renamed = False
    cur.execute(
        """
        SELECT id, language_code, name, is_primary, name_type
        FROM core.core_admin_area_names
        WHERE admin_area_id = %s AND language_code IN ('en','my')
        ORDER BY id
        """,
        (area_id,),
    )
    rows = cur.fetchall()
    by_lang: dict[str, list] = collections.defaultdict(list)
    for row in rows:
        by_lang[row[1]].append(row)

    desired = {"en": clean(name_en), "my": clean(name_my)}
    for lang, wanted in desired.items():
        if not wanted:
            continue
        existing = by_lang.get(lang, [])
        primary = next((r for r in existing if r[3]), None)
        if primary and primary[2] == wanted:
            # demote extras
            for r in existing:
                if r[3] and r[0] != primary[0]:
                    renamed = True
                    if not dry_run:
                        cur.execute(
                            "UPDATE core.core_admin_area_names SET is_primary=false, name_type='alias' WHERE id=%s",
                            (r[0],),
                        )
            continue
        renamed = True
        if dry_run:
            continue
        # demote all current primaries for lang
        for r in existing:
            if r[3]:
                cur.execute(
                    "UPDATE core.core_admin_area_names SET is_primary=false, name_type='alias' WHERE id=%s",
                    (r[0],),
                )
        match = next((r for r in existing if r[2] == wanted), None)
        if match:
            cur.execute(
                "UPDATE core.core_admin_area_names SET is_primary=true, name_type='official' WHERE id=%s",
                (match[0],),
            )
        else:
            cur.execute(
                """
                INSERT INTO core.core_admin_area_names
                  (admin_area_id, name, language_code, name_type, is_primary, search_weight)
                VALUES (%s, %s, %s, 'official', true, 100)
                """,
                (area_id, wanted, lang),
            )
    return renamed


def apply_reference_flags(cur, area_id: int, *, dry_run: bool) -> None:
    if dry_run:
        return
    cur.execute(
        """
        UPDATE core.core_admin_areas
        SET address_usage = CASE WHEN address_usage = 'disabled' THEN address_usage ELSE 'search_only' END,
            is_public_usable = false,
            is_official_boundary = false,
            verification_status = 'needs_fix',
            is_verified = false,
            updated_at = now()
        WHERE id = %s
        """,
        (area_id,),
    )


def apply_match_updates(
    cur,
    area: dict[str, Any],
    row: dict[str, str],
    target_parent: int | None,
    *,
    dry_run: bool,
) -> PlanRow:
    area_id = int(area["id"])
    plan = PlanRow(
        source_key=row["source_key"],
        level=row["hierarchy_level"],
        action=row["action"],
        outcome="kept",
        coremap_id=area_id,
        target_parent_id=target_parent,
        name_en=row["source_name_en"],
        name_my=row["source_name_my"],
        official=boolish(row["source_official"]),
        geom_md5_before=area.get("geom_md5"),
    )

    # Parent
    if target_parent and int(area["parent_id"] or 0) != int(target_parent):
        plan.reparent = True
        plan.outcome = "reparented"
        if not dry_run:
            cur.execute(
                "UPDATE core.core_admin_areas SET parent_id=%s, updated_at=now() WHERE id=%s",
                (target_parent, area_id),
            )

    # Type / level for update_type or subtype mismatch on SAZ
    wanted_level = LEVEL_IDS.get(row["hierarchy_level"])
    wanted_type = subtype_type_id(row["hierarchy_level"], row.get("source_subtype") or "")
    if row["action"] == "update_type" or (
        row["hierarchy_level"] == "self_administered_zone"
        and int(area["admin_level_id"]) != wanted_level
    ):
        if int(area["admin_level_id"]) != wanted_level or int(area.get("admin_area_type_id") or 0) != wanted_type:
            plan.reclassify = True
            plan.outcome = "reclassified"
            if not dry_run:
                cur.execute(
                    """
                    UPDATE core.core_admin_areas
                    SET admin_level_id=%s, admin_area_type_id=%s, updated_at=now()
                    WHERE id=%s
                    """,
                    (wanted_level, wanted_type, area_id),
                )

    # Names
    if row["action"] in {"update_name", "update_name_and_parent", "create_mimu_placeholder", "keep_existing", "update_type"}:
        if ensure_primary_names(
            cur, area_id, row["source_name_en"], row["source_name_my"], dry_run=dry_run
        ):
            plan.rename = True
            if plan.outcome == "kept":
                plan.outcome = "renamed"

    # Canonical name prefer Myanmar then English
    canonical = clean(row["source_name_my"]) or clean(row["source_name_en"])
    if canonical and canonical != clean(area["canonical_name"]):
        plan.rename = True
        if plan.outcome == "kept":
            plan.outcome = "renamed"
        if not dry_run:
            cur.execute(
                "UPDATE core.core_admin_areas SET canonical_name=%s, updated_at=now() WHERE id=%s",
                (canonical, area_id),
            )

    if row["action"] == "mark_reference_only":
        plan.outcome = "extra/reference"
        apply_reference_flags(cur, area_id, dry_run=dry_run)

    # Official inventory flags for matched official Active rows (do not flip geom)
    if boolish(row["source_official"]) and clean(row["source_gad_status"]).lower() == "active":
        if row["action"] != "mark_reference_only" and not dry_run:
            cur.execute(
                """
                UPDATE core.core_admin_areas
                SET address_usage = 'official',
                    is_public_usable = COALESCE(is_public_usable, true),
                    updated_at = now()
                WHERE id = %s AND address_usage <> 'disabled'
                """,
                (area_id,),
            )

    plan.notes = "matched_preserve_geom"
    return plan


def try_create_placeholder(
    cur,
    row: dict[str, str],
    parent_id: int | None,
    geom_geojson: str | None,
    *,
    dry_run: bool,
) -> PlanRow:
    plan = PlanRow(
        source_key=row["source_key"],
        level=row["hierarchy_level"],
        action=row["action"],
        outcome="newly_created_placeholder",
        target_parent_id=parent_id,
        name_en=row["source_name_en"],
        name_my=row["source_name_my"],
        official=boolish(row["source_official"]),
        create=True,
    )
    if parent_id is None:
        plan.outcome = "create_skipped_unresolved_parent"
        plan.create = False
        plan.notes = "target parent not resolved"
        return plan
    if not geom_geojson:
        plan.outcome = "create_skipped_no_valid_geometry"
        plan.create = False
        plan.notes = "no MIMU comparison geometry"
        return plan

    if dry_run:
        plan.notes = "would_create_mimu_placeholder"
        plan.coremap_id = None
        return plan

    public_id = str(uuid.uuid4())
    slug = slugify(row["source_name_en"], row["source_key"])
    level_id = LEVEL_IDS[row["hierarchy_level"]]
    type_id = subtype_type_id(row["hierarchy_level"], row.get("source_subtype") or "")
    canonical = clean(row["source_name_my"]) or clean(row["source_name_en"])
    official = boolish(row["source_official"]) and clean(row["source_gad_status"]).lower() == "active"
    marker = {
        IMPORT_MARKER: {
            "source_key": row["source_key"],
            "hierarchy_level": row["hierarchy_level"],
            # audit-only: never write pcode into external_id / dedicated column
            "audit_source_key_only": True,
        }
    }

    cur.execute(
        """
        WITH raw AS (
          SELECT ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326) AS g
        ),
        cleaned AS (
          SELECT
            CASE
              WHEN NOT ST_IsValid(g) THEN ST_MakeValid(g)
              ELSE g
            END AS g
          FROM raw
        ),
        normalized AS (
          SELECT ST_Multi(ST_CollectionExtract(g, 3))::geometry(MultiPolygon, 4326) AS g
          FROM cleaned
        ),
        checked AS (
          SELECT g,
                 ST_PointOnSurface(g) AS c
          FROM normalized
          WHERE g IS NOT NULL
            AND NOT ST_IsEmpty(g)
            AND ST_IsValid(g)
            AND ST_Within(
                  ST_PointOnSurface(g),
                  (SELECT geom FROM core.core_admin_areas WHERE id = %s)
                )
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
          CASE WHEN %s THEN 'official' ELSE 'search_only' END,
          CASE WHEN %s THEN true ELSE false END,
          50,
          'mimu_placeholder', 'phase2_manifest_import', 'permission_pending',
          '{}'::jsonb, %s::jsonb,
          'phase2:create_mimu_placeholder'
        FROM checked
        RETURNING id
        """,
        (
            geom_geojson,
            COUNTRY_ID,
            public_id,
            parent_id,
            level_id,
            type_id,
            canonical,
            slug,
            SOURCE_TYPE_MANUAL,
            official,
            official,
            json.dumps(marker, ensure_ascii=False),
        ),
    )
    inserted = cur.fetchone()
    if not inserted:
        plan.outcome = "create_rejected_invalid_or_non_myanmar_geometry"
        plan.create = False
        plan.notes = "geometry failed validity/Myanmar containment"
        return plan
    area_id = int(inserted[0])
    plan.coremap_id = area_id
    ensure_primary_names(cur, area_id, row["source_name_en"], row["source_name_my"], dry_run=False)
    return plan


def resolve_core_id(
    row: dict[str, str],
    areas: dict[int, dict[str, Any]],
    import_map: dict[str, int],
    saz_index: dict[str, int] | None = None,
) -> tuple[int | None, str]:
    """Return (coremap_id, resolution_note)."""
    matched = as_int(row.get("matched_coremap_id"))
    if matched and matched in areas:
        return matched, "matched_coremap_id"

    # Idempotent re-run
    if row["source_key"] in import_map:
        return import_map[row["source_key"]], "import_marker"

    # Promote create when spatial evidence already identifies a CoreMap polygon
    spatial_id = parse_spatial_core_id(row.get("spatial_evidence") or "")
    if spatial_id and spatial_id in areas:
        return spatial_id, "spatial_core_id_promote"

    if row["hierarchy_level"] == "self_administered_zone" and saz_index:
        saz_id = match_existing_saz(row, saz_index)
        if saz_id and saz_id in areas:
            return saz_id, "saz_name_promote"

    return None, "unresolved"


def resolve_parent(
    row: dict[str, str],
    areas: dict[int, dict[str, Any]],
    import_map: dict[str, int],
    pcode_to_id: dict[str, int],
) -> int | None:
    parent = as_int(row.get("target_parent_coremap_id"))
    if parent and parent in areas:
        return parent
    parent_pcode = clean(row.get("audit_only_parent_pcode"))
    if parent_pcode and parent_pcode in pcode_to_id:
        return pcode_to_id[parent_pcode]
    # parent may be a placeholder created earlier this run
    # (tracked via pcode_to_id after creates)
    return None


def process_manifest(
    conn,
    rows: list[dict[str, str]],
    mimu_geoms: dict[str, str],
    *,
    dry_run: bool,
) -> tuple[list[PlanRow], Stats]:
    areas = fetch_area_index(conn)
    import_map = fetch_import_source_map(conn)
    saz_index = fetch_saz_name_index(conn)
    pcode_to_id: dict[str, int] = {}
    # Seed pcode map from matched rows (in-memory only; never persisted as external_id)
    for row in rows:
        cid = as_int(row.get("matched_coremap_id"))
        pcode = clean(row.get("audit_only_source_pcode"))
        if cid and pcode and cid in areas:
            pcode_to_id[pcode] = cid

    plans: list[PlanRow] = []
    stats = Stats()
    stats.village_note = (
        "Complete official village coverage cannot yet be verified: approved inventory has no "
        "complete village sheet in 01-admin-actions.csv. Villages must not be inserted into "
        "core_admin_areas; reconcile separately in core_settlements. Preserve existing village "
        "settlement points (production baseline 54,768) unless a duplicate is proven."
    )

    # Parent-first
    ordered: list[dict[str, str]] = []
    for level in LEVEL_ORDER:
        ordered.extend([r for r in rows if r["hierarchy_level"] == level])
    # Any unexpected levels last
    known = set(LEVEL_ORDER)
    ordered.extend([r for r in rows if r["hierarchy_level"] not in known])

    with conn.cursor() as cur:
        for row in ordered:
            level = row["hierarchy_level"]
            action = row["action"]

            if action == "manual_review":
                plan = PlanRow(
                    source_key=row["source_key"],
                    level=level,
                    action=action,
                    outcome="manual_review_remaining",
                    name_en=row["source_name_en"],
                    name_my=row["source_name_my"],
                    official=boolish(row["source_official"]),
                    notes=clean(row.get("manual_review_reason") or row.get("review_notes")),
                )
                plans.append(plan)
                stats.by_level[level][plan.outcome] += 1
                stats.totals[plan.outcome] += 1
                continue

            core_id, how = resolve_core_id(row, areas, import_map, saz_index)
            parent_id = resolve_parent(row, areas, import_map, pcode_to_id)

            if action == "mark_reference_only" and core_id is None:
                plan = PlanRow(
                    source_key=row["source_key"],
                    level=level,
                    action=action,
                    outcome="extra/reference",
                    notes="unmatched_reference_only_no_create",
                    official=boolish(row["source_official"]),
                    name_en=row["source_name_en"],
                    name_my=row["source_name_my"],
                )
                plans.append(plan)
                stats.by_level[level][plan.outcome] += 1
                stats.totals[plan.outcome] += 1
                continue

            if action == "create_mimu_placeholder" and core_id is None:
                geom = mimu_geoms.get(clean(row.get("audit_only_source_pcode")))
                plan = try_create_placeholder(cur, row, parent_id, geom, dry_run=dry_run)
                if plan.create and plan.coremap_id and not dry_run:
                    areas[plan.coremap_id] = fetch_area_index(conn).get(plan.coremap_id) or {
                        "id": plan.coremap_id,
                        "parent_id": parent_id,
                        "geom_md5": None,
                    }
                    import_map[row["source_key"]] = plan.coremap_id
                    pcode = clean(row.get("audit_only_source_pcode"))
                    if pcode:
                        pcode_to_id[pcode] = plan.coremap_id
                elif how == "unresolved" and core_id is None:
                    plan.notes = (plan.notes + f"; resolution={how}").strip("; ")
                plans.append(plan)
                stats.by_level[level][plan.outcome] += 1
                stats.totals[plan.outcome] += 1
                continue

            if core_id is None:
                plan = PlanRow(
                    source_key=row["source_key"],
                    level=level,
                    action=action,
                    outcome="skipped_unresolved_match",
                    notes=f"action={action}; no core id",
                    name_en=row["source_name_en"],
                    name_my=row["source_name_my"],
                )
                plans.append(plan)
                stats.by_level[level][plan.outcome] += 1
                stats.totals[plan.outcome] += 1
                continue

            area = areas[core_id]
            # For create promoted to match, still apply name/parent updates
            effective = dict(row)
            if action == "create_mimu_placeholder":
                effective["action"] = "update_name_and_parent" if parent_id else "update_name"
            plan = apply_match_updates(cur, area, effective, parent_id, dry_run=dry_run)
            if action == "create_mimu_placeholder":
                plan.action = "create_mimu_placeholder"
                plan.notes = f"promoted_to_match:{how}"
                if plan.outcome == "kept":
                    plan.outcome = "kept"
            # keep_existing stays kept unless rename/reparent happened
            if action == "keep_existing" and plan.outcome == "kept":
                plan.notes = "keep_existing"
            plans.append(plan)
            stats.by_level[level][plan.outcome] += 1
            stats.totals[plan.outcome] += 1
            # refresh area cache parent after reparent
            if plan.reparent and parent_id:
                areas[core_id]["parent_id"] = parent_id
            pcode = clean(row.get("audit_only_source_pcode"))
            if pcode:
                pcode_to_id[pcode] = core_id

        if dry_run:
            conn.rollback()
        else:
            conn.commit()

    return plans, stats


def evaluate_postconditions(conn, plans: list[PlanRow], rows: list[dict[str, str]]) -> dict[str, Any]:
    official_tsp_all = [
        r
        for r in rows
        if r["hierarchy_level"] == "township"
        and boolish(r["source_official"])
        and clean(r["source_gad_status"]).lower() == "active"
    ]
    official_tsp_keys = {
        r["source_key"]
        for r in official_tsp_all
        if r["action"] not in {"manual_review", "mark_reference_only"}
    }
    manual_tsp = sum(1 for r in official_tsp_all if r["action"] == "manual_review")
    planned_tsp_ids = {
        p.coremap_id
        for p in plans
        if p.level == "township"
        and p.source_key in official_tsp_keys
        and p.coremap_id
        and p.outcome
        not in {
            "manual_review_remaining",
            "create_skipped_no_valid_geometry",
            "create_skipped_unresolved_parent",
            "create_rejected_invalid_or_non_myanmar_geometry",
            "skipped_unresolved_match",
            "extra/reference",
        }
    }

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT count(*) FROM core.core_admin_areas a
            JOIN ref.ref_admin_levels l ON l.id = a.admin_level_id
            WHERE a.deleted_at IS NULL AND a.is_active AND a.parent_id = %s
              AND l.code = 'state_region'
              AND COALESCE(a.is_public_usable, true)
              AND a.is_official_boundary
            """,
            (COUNTRY_ID,),
        )
        official_sr = int(cur.fetchone()[0])

        cur.execute("SELECT count(*) FROM core.core_admin_areas")
        total_areas = int(cur.fetchone()[0])
        cur.execute("SELECT count(DISTINCT public_id) FROM core.core_admin_areas")
        distinct_public = int(cur.fetchone()[0])
        cur.execute("SELECT count(DISTINCT slug) FROM core.core_admin_areas")
        distinct_slug = int(cur.fetchone()[0])

        cur.execute(
            """
            SELECT count(*) FROM core.core_admin_areas
            WHERE geometry_source = 'mimu_placeholder' AND deleted_at IS NULL
            """
        )
        placeholders = int(cur.fetchone()[0])

        geom_checked = 0
        geom_changed = 0
        for plan in plans:
            if not (plan.geom_md5_before and plan.coremap_id):
                continue
            geom_checked += 1
            cur.execute(
                "SELECT md5(ST_AsEWKB(geom)) FROM core.core_admin_areas WHERE id=%s",
                (plan.coremap_id,),
            )
            after = cur.fetchone()
            if after and after[0] != plan.geom_md5_before:
                geom_changed += 1

    # Duplicate approved source hierarchy paths among create actions only
    create_paths = [
        clean(r.get("source_parent_path"))
        for r in rows
        if r["action"] == "create_mimu_placeholder" and clean(r.get("source_parent_path"))
    ]
    path_counts = collections.Counter(create_paths)
    duplicate_paths = sum(1 for _, n in path_counts.items() if n > 1)

    # Official source pcodes must be unique in inventory
    official_pcodes = [
        clean(r.get("audit_only_source_pcode"))
        for r in rows
        if boolish(r["source_official"]) and clean(r.get("audit_only_source_pcode"))
    ]
    pcode_dupes = sum(1 for _, n in collections.Counter(official_pcodes).items() if n > 1)

    manual_imported = sum(
        1 for p in plans if p.action == "manual_review" and p.outcome != "manual_review_remaining"
    )
    accounted = len(plans)
    official_tsp = len(planned_tsp_ids)
    # 330 = resolved importable identities + remaining official manual_review townships
    township_accounted = official_tsp + manual_tsp
    return {
        "source_rows": len(rows),
        "plan_rows_accounted": accounted,
        "source_rows_accounted_for": accounted == len(rows),
        "official_first_level": official_sr,
        "official_first_level_ok": official_sr == 15,
        "official_township_identities": official_tsp,
        "official_township_manual_review": manual_tsp,
        "official_township_target": len(official_tsp_all),
        "official_township_accounted": township_accounted,
        "official_township_ok": township_accounted == 330 and len(official_tsp_all) == 330,
        "unique_public_id_ok": total_areas == distinct_public,
        "unique_slug_ok": total_areas == distinct_slug,
        "duplicate_approved_hierarchy_paths": duplicate_paths,
        "duplicate_hierarchy_path_ok": duplicate_paths == 0,
        "duplicate_official_source_pcodes": pcode_dupes,
        "duplicate_official_pcode_ok": pcode_dupes == 0,
        "mimu_placeholder_count": placeholders,
        "matched_geom_checked": geom_checked,
        "matched_geom_changed": geom_changed,
        "matched_geom_stable_ok": geom_changed == 0,
        "manual_review_auto_imported": manual_imported,
        "manual_review_not_imported_ok": manual_imported == 0,
        "towns_in_inventory": sum(1 for r in rows if r["hierarchy_level"] == "town"),
    }


def write_reports(out_dir: Path, plans: list[PlanRow], stats: Stats, post: dict[str, Any], mode: str) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    plan_path = out_dir / f"02-plan-{mode}.csv"
    fields = [
        "source_key", "level", "action", "outcome", "coremap_id", "target_parent_id",
        "name_en", "name_my", "official", "rename", "reparent", "reclassify", "create", "notes",
    ]
    with plan_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for p in plans:
            writer.writerow({
                "source_key": p.source_key,
                "level": p.level,
                "action": p.action,
                "outcome": p.outcome,
                "coremap_id": p.coremap_id or "",
                "target_parent_id": p.target_parent_id or "",
                "name_en": p.name_en,
                "name_my": p.name_my,
                "official": p.official,
                "rename": p.rename,
                "reparent": p.reparent,
                "reclassify": p.reclassify,
                "create": p.create,
                "notes": p.notes,
            })

    # Aggregate required categories
    category_map = {
        "kept": "kept",
        "renamed": "renamed",
        "reparented": "reparented",
        "reclassified": "reclassified",
        "newly_created_placeholder": "newly_created_placeholder",
        "extra/reference": "extra/reference",
        "disabled": "disabled",
        "manual_review_remaining": "manual_review_remaining",
    }
    summary_lines = [
        f"# Phase 2 manifest import — {mode}",
        "",
        stats.village_note,
        "",
        "## By level",
        "",
        "| Level | kept | renamed | reparented | reclassified | newly created placeholder | extra/reference | disabled | manual review remaining | other |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for level in LEVEL_ORDER + sorted({p.level for p in plans} - set(LEVEL_ORDER)):
        c = stats.by_level.get(level)
        if not c:
            continue
        other = sum(v for k, v in c.items() if k not in category_map)
        summary_lines.append(
            "| {level} | {kept} | {renamed} | {reparented} | {reclassified} | {new} | {ref} | {dis} | {man} | {other} |".format(
                level=level,
                kept=c.get("kept", 0),
                renamed=c.get("renamed", 0),
                reparented=c.get("reparented", 0),
                reclassified=c.get("reclassified", 0),
                new=c.get("newly_created_placeholder", 0),
                ref=c.get("extra/reference", 0),
                dis=c.get("disabled", 0),
                man=c.get("manual_review_remaining", 0),
                other=other,
            )
        )

    # Multi-label counts (a row can be renamed+reparented)
    summary_lines += [
        "",
        "## Outcome totals",
        "",
        "| Outcome | Count |",
        "|---|---:|",
    ]
    for key, value in sorted(stats.totals.items(), key=lambda kv: (-kv[1], kv[0])):
        summary_lines.append(f"| {key} | {value} |")

    summary_lines += [
        "",
        "## Multi-flag counts (rows may count in more than one)",
        "",
        f"- renamed_flag: {sum(1 for p in plans if p.rename)}",
        f"- reparented_flag: {sum(1 for p in plans if p.reparent)}",
        f"- reclassified_flag: {sum(1 for p in plans if p.reclassify)}",
        f"- create_flag: {sum(1 for p in plans if p.create)}",
        "",
        "## Postconditions",
        "",
        "| Check | Value | Pass |",
        "|---|---|:---:|",
    ]
    checks = [
        ("source_rows_accounted_for", f"{post['plan_rows_accounted']}/{post['source_rows']}", post["source_rows_accounted_for"]),
        ("official_first_level_15", post["official_first_level"], post["official_first_level_ok"]),
        (
            "official_township_330",
            f"{post['official_township_identities']}+{post['official_township_manual_review']} manual /{post['official_township_target']}",
            post["official_township_ok"],
        ),
        ("unique_public_id", post["unique_public_id_ok"], post["unique_public_id_ok"]),
        ("unique_slug", post["unique_slug_ok"], post["unique_slug_ok"]),
        ("duplicate_create_hierarchy_path", post["duplicate_approved_hierarchy_paths"], post["duplicate_hierarchy_path_ok"]),
        ("duplicate_official_pcode", post["duplicate_official_source_pcodes"], post["duplicate_official_pcode_ok"]),
        ("matched_geom_stable", f"changed={post['matched_geom_changed']}/{post['matched_geom_checked']}", post["matched_geom_stable_ok"]),
        ("manual_review_not_imported", post["manual_review_auto_imported"], post["manual_review_not_imported_ok"]),
        ("mimu_placeholder_rows", post["mimu_placeholder_count"], True),
        ("towns_in_approved_inventory", post["towns_in_inventory"], True),
    ]
    for name, value, ok in checks:
        summary_lines.append(f"| {name} | {value} | {'yes' if ok else 'no'} |")

    summary_lines += [
        "",
        "## Notes",
        "",
        "- `create_mimu_placeholder` rows with `spatial_evidence core_id=N` are promoted to matched updates (geometry preserved).",
        "- WVT creates have no MIMU polygon in the comparison set → `create_skipped_no_valid_geometry`.",
        "- Towns: not present in approved 01-admin-actions inventory.",
        "- Production apply is blocked until this dry-run report is approved.",
        "",
    ]
    (out_dir / f"01-summary-{mode}.md").write_text("\n".join(summary_lines) + "\n", encoding="utf-8")
    (out_dir / f"03-postconditions-{mode}.json").write_text(json.dumps(post, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("reports/admin-reconciliation-v2/01-admin-actions.csv"),
    )
    parser.add_argument("--mimu-geometries", type=Path, default=None)
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--mode", choices=["dry-run", "apply"], default="dry-run")
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("reports/admin-reconciliation-v2/phase2-import"),
    )
    parser.add_argument(
        "--allow-production-host",
        action="store_true",
        help="Dangerous escape hatch; refuse by default if URL looks like Supabase pooler.",
    )
    args = parser.parse_args()

    url = args.database_url
    if not args.allow_production_host and ("supabase.com" in url or "pooler.supabase" in url):
        print("Refusing Supabase/production-looking DATABASE_URL without --allow-production-host", file=sys.stderr)
        return 2

    rows = read_manifest(args.manifest)
    if any(r["hierarchy_level"] == "village" for r in rows):
        print("Manifest contains village rows; villages must not import into core_admin_areas", file=sys.stderr)
        return 2

    mimu_geoms = load_mimu_geoms(args.mimu_geometries)
    dry_run = args.mode == "dry-run"

    with connect(url) as conn:
        conn.autocommit = False
        plans, stats = process_manifest(conn, rows, mimu_geoms, dry_run=dry_run)
        # Postconditions always evaluated on current DB state (dry-run rolls back)
        post = evaluate_postconditions(conn, plans, rows)
        stats.postconditions = post

    write_reports(args.out, plans, stats, post, args.mode)
    print(f"Wrote reports to {args.out} ({args.mode})")
    print(f"Accounted {post['plan_rows_accounted']}/{post['source_rows']}")
    print(f"Official SR={post['official_first_level']} ok={post['official_first_level_ok']}")
    print(
        "Official TSP="
        f"{post['official_township_identities']}+{post['official_township_manual_review']}manual"
        f"/{post['official_township_target']} ok={post['official_township_ok']}"
    )
    print(
        f"Geom stable ok={post['matched_geom_stable_ok']} "
        f"placeholders={post['mimu_placeholder_count']} "
        f"create_path_dupes={post['duplicate_approved_hierarchy_paths']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
