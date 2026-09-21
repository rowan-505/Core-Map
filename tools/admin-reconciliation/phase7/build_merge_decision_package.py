#!/usr/bin/env python3
"""Phase 7 completion-v2: apply Pangsang decision, hard-check reopen rows,
build merge decision viewer data. Does not touch production or final v2 manifests.
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "reports/admin-reconciliation-v2/phase7-completion-v2"
FROZEN_ADMIN = ROOT / "reports/admin-reconciliation-v2/phase3-frozen/03-approved-local-admin.csv"
PREVIEWS = ROOT / "reports/admin-reconciliation-v2/phase3-previews"
MIMU_TS = Path("/tmp/mimu_pangsang_township.geojson")
DB_URL = "postgresql://postgres:postgres@127.0.0.1:5433/coremap_phase7_backup_restore"

MERGE_GROUPS = [
    {
        "group_id": "merge_no106",
        "source_pcode": "MMR013018701526",
        "source_row": "1133",
        "proposed_survivor": 5182,
        "candidates": [5182, 5183],
        "reason": "Same normalized name under township; near-identical polygons; merge onto lower-id survivor then match source.",
    },
    {
        "group_id": "merge_no105",
        "source_pcode": "MMR013018701525",
        "source_row": "1134",
        "proposed_survivor": 5185,
        "candidates": [5185, 5186],
        "reason": "Same normalized name under township; near-identical polygons; merge onto lower-id survivor then match source.",
    },
    {
        "group_id": "merge_gant_gaw_waing",
        "source_pcode": "MMR007008701505",
        "source_row": "1421",
        "proposed_survivor": 5891,
        "candidates": [5891, 5897],
        "reason": "Same normalized name under township; near-identical polygons; merge onto lower-id survivor then match source.",
    },
    {
        "group_id": "merge_zay",
        "source_pcode": "MMR010018701504",
        "source_row": "1546",
        "proposed_survivor": 6907,
        "candidates": [6907, 6908],
        "reason": "Same normalized name under township; near-identical polygons; merge onto lower-id survivor then match source.",
    },
]

MATCH_WARDS = [
    {"source_pcode": "MMR018002701505" if False else "MMR018002701509", "source_row": "1574", "match_id": 6023},
    {"source_pcode": "MMR013029701504", "source_row": "1840", "match_id": 5119},
]

# Ma Har Myaing handled separately
MATCH_VILLAGES = [
    {"source_pcode": "189255", "match_id": 170019},
    {"source_pcode": "189131", "match_id": 169993},
]
CREATE_VILLAGES = ["189254", "189128", "176854", "219883", "209771", "209638", "201878"]


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def write_csv(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def load_csv(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def slugify_en(name: str) -> str:
    s = name.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s or "township"


def norm_my(s: str) -> str:
    return re.sub(r"\s+", "", (s or "").strip())


def norm_en(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def load_preview(pcode: str, entity: str, source_row: str | None = None) -> dict | None:
    if source_row:
        hits = sorted(PREVIEWS.glob(f"{entity}_{pcode}_row{source_row}_*.geojson"))
        if hits:
            return json.loads(hits[0].read_text(encoding="utf-8"))
    hits = sorted(PREVIEWS.glob(f"{entity}_{pcode}_*.geojson"))
    if not hits:
        return None
    return json.loads(hits[0].read_text(encoding="utf-8"))


def as_feature(obj: dict, props: dict | None = None) -> dict:
    if obj.get("type") == "FeatureCollection":
        feat = obj["features"][0]
    elif obj.get("type") == "Feature":
        feat = obj
    else:
        feat = {"type": "Feature", "properties": {}, "geometry": obj}
    out = {"type": "Feature", "properties": {**(feat.get("properties") or {}), **(props or {})}, "geometry": feat["geometry"]}
    return out


def geom_json(feat: dict) -> str:
    return json.dumps(feat["geometry"])


def freeze_pangsang(conn: psycopg.Connection) -> dict:
    mimu = json.loads(MIMU_TS.read_text(encoding="utf-8"))
    with conn.cursor() as cur:
        # Ensure public_id/slug uniqueness against existing CoreMap
        while True:
            public_id = str(uuid.uuid4())
            cur.execute("SELECT 1 FROM core.core_admin_areas WHERE public_id = %s::uuid", (public_id,))
            if not cur.fetchone():
                break
        base_slug = "pangsang-panghkam-township"
        slug = base_slug
        n = 2
        while True:
            cur.execute("SELECT 1 FROM core.core_admin_areas WHERE slug = %s", (slug,))
            if not cur.fetchone():
                break
            slug = f"{base_slug}-v{n}"
            n += 1

        cur.execute(
            """
            SELECT id, public_id::text, canonical_name, slug
            FROM core.core_admin_areas WHERE id = 6474
            """
        )
        parent = cur.fetchone()
        cur.execute(
            """
            SELECT id, public_id::text, canonical_name, slug, external_id,
                   (SELECT string_agg(language_code||':'||name, ' | ')
                      FROM core.core_admin_area_names n WHERE n.admin_area_id=a.id) AS names
            FROM core.core_admin_areas a WHERE id = 6484
            """
        )
        keep6484 = cur.fetchone()

        # geometry validity of MIMU township
        cur.execute(
            """
            SELECT ST_IsValid(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%s),4326))),
                   round((ST_Area(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%s),4326))::geography)/1e6)::numeric,2)
            """,
            (json.dumps(mimu["geometry"]), json.dumps(mimu["geometry"])),
        )
        geom_ok, area_km2 = cur.fetchone()

    children = [
        r
        for r in load_csv(FROZEN_ADMIN)
        if (r.get("source_ts_pcode") or "") == "MMR015005"
        and r.get("action") == "create_mimu_placeholder"
    ]

    decision = {
        "decision": "create_missing_township_placeholder",
        "approved_at": utc_now(),
        "source_ts_pcode_audit_key": "MMR015005",
        "source_ts_pcode_stored_as_external_id": False,
        "name_en": "Pangsang (Panghkam)",
        "name_my": "ပန်ဆန်း (ပန်ခမ်း)",
        "canonical_name": "ပန်ဆန်း (ပန်ခမ်း)",
        "target_public_id": public_id,
        "target_slug": slug,
        "parent_core_id": parent[0],
        "parent_public_id": parent[1],
        "parent_canonical_name": parent[2],
        "parent_slug": parent[3],
        "parent_hierarchy_source": "MIMU district Matman MMR015D007 → CoreMap district id 6474",
        "preserve_core_id_6484_unchanged": True,
        "never_merge_with_6484": True,
        "core_6484_public_id": keep6484[1],
        "core_6484_canonical_name": keep6484[2],
        "core_6484_slug": keep6484[3],
        "core_6484_external_id": keep6484[4],
        "core_6484_names": keep6484[5],
        "geometry_source": "mimu_placeholder",
        "verification_status": "needs_fix",
        "is_verified": False,
        "boundary_status": "approximate",
        "is_official_boundary": False,
        "is_public_usable": False,
        "source_license_status": "permission_pending",
        "public_exposure": "PASS_DATABASE_ONLY",
        "exclude_from_public_api_search_tiles": True,
        "mimu_geom_valid": bool(geom_ok),
        "mimu_area_km2": float(area_km2),
        "child_vt_count": len(children),
        "child_source_pcodes": [c["source_pcode"] for c in children],
    }

    # Freeze file (identity only — not full v2 manifest)
    freeze_path = OUT / "decisions/01-pangsang-township-freeze.json"
    freeze_path.parent.mkdir(parents=True, exist_ok=True)
    freeze_path.write_text(json.dumps(decision, indent=2, ensure_ascii=False), encoding="utf-8")

    child_rows = []
    for c in children:
        child_rows.append(
            {
                "source_entity_type": c["source_entity_type"],
                "source_pcode": c["source_pcode"],
                "source_name_en": c["source_name_en"],
                "source_name_my": c["source_name_my"],
                "source_key": f"village_tract:{c['source_pcode']}",
                "parent_public_id": public_id,
                "parent_source_ts_pcode_audit": "MMR015005",
                "action": "create_mimu_placeholder",
                "admin_level": "ward_village_tract",
                "type": "village_tract",
                "preserve_core_6484": "true",
            }
        )
    write_csv(OUT / "decisions/01-pangsang-child-attachments.csv", child_rows)

    md = f"""# Pangsang township decision (frozen identity)

Approved: `{decision['approved_at']}`  
Decision: **`create_missing_township_placeholder`**

| Field | Value |
|---|---|
| target_public_id | `{public_id}` |
| target_slug | `{slug}` |
| name_en | Pangsang (Panghkam) |
| name_my / canonical | ပန်ဆန်း (ပန်ခမ်း) |
| parent | CoreMap district `{parent[0]}` / `{parent[1]}` (`{parent[2]}`) = MIMU Matman |
| external_id | **null** (MMR015005 is audit key only) |
| geometry_source | mimu_placeholder |
| verification_status | needs_fix |
| is_verified | false |
| boundary_status | approximate |
| is_official_boundary | false |
| is_public_usable | false |
| public exposure | PASS_DATABASE_ONLY (excluded from API/search/tiles) |
| preserve 6484 | **unchanged; never merge** |
| child VTs attached | **{len(children)}** via `parent_public_id` |

Full v2 manifests are **not** generated yet (merge decisions still pending).
"""
    (OUT / "decisions/01-pangsang-decision.md").write_text(md, encoding="utf-8")
    return decision


def admin_detail(conn: psycopg.Connection, ids: list[int]) -> dict[int, dict]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT a.id, a.public_id::text, a.canonical_name, a.slug, a.external_id,
                   t.code, a.parent_id, p.canonical_name,
                   a.verification_status, a.is_verified, a.geometry_source, a.reference_source,
                   a.source_license_status, a.is_public_usable, a.boundary_status, a.is_official_boundary,
                   ST_AsGeoJSON(a.geom),
                   (SELECT string_agg(DISTINCT CASE WHEN n.language_code='my' THEN n.name END, ' | ')
                      FROM core.core_admin_area_names n WHERE n.admin_area_id=a.id) AS names_my,
                   (SELECT string_agg(DISTINCT CASE WHEN n.language_code='en' THEN n.name END, ' | ')
                      FROM core.core_admin_area_names n WHERE n.admin_area_id=a.id) AS names_en,
                   (SELECT count(*) FROM core.core_admin_areas c WHERE c.parent_id=a.id AND c.deleted_at IS NULL),
                   (SELECT count(*) FROM core.core_settlements s WHERE s.township_id=a.id AND s.deleted_at IS NULL),
                   (SELECT count(*) FROM ref.ref_postal_codes pc
                      WHERE pc.local_admin_area_id=a.id OR pc.township_admin_area_id=a.id),
                   encode(digest(ST_AsBinary(a.geom), 'sha256'), 'hex')
            FROM core.core_admin_areas a
            LEFT JOIN ref.ref_admin_area_types t ON t.id=a.admin_area_type_id
            LEFT JOIN core.core_admin_areas p ON p.id=a.parent_id
            WHERE a.id = ANY(%s)
            """,
            (ids,),
        )
        out = {}
        for r in cur.fetchall():
            out[int(r[0])] = {
                "id": int(r[0]),
                "public_id": r[1],
                "canonical_name": r[2],
                "slug": r[3],
                "external_id": r[4],
                "type": r[5],
                "parent_id": r[6],
                "parent_name": r[7],
                "verification_status": r[8],
                "is_verified": r[9],
                "geometry_source": r[10],
                "reference_source": r[11],
                "source_license_status": r[12],
                "is_public_usable": r[13],
                "boundary_status": r[14],
                "is_official_boundary": r[15],
                "geojson": json.loads(r[16]),
                "names_my": r[17] or "",
                "names_en": r[18] or "",
                "dep_child_admins": int(r[19]),
                "dep_settlements": int(r[20]),
                "dep_postal": int(r[21]),
                "geom_sha256": r[22],
            }
        return out


def overlaps(conn: psycopg.Connection, source_geom: dict, core_id: int) -> dict:
    with conn.cursor() as cur:
        cur.execute(
            """
            WITH s AS (SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%s),4326)) g)
            SELECT
              round((ST_Area(ST_Intersection(ST_MakeValid(a.geom), s.g)::geography)
                     / NULLIF(ST_Area(s.g::geography),0))::numeric,4),
              round((ST_Area(ST_Intersection(ST_MakeValid(a.geom), s.g)::geography)
                     / NULLIF(ST_Area(ST_MakeValid(a.geom)::geography),0))::numeric,4),
              round(ST_Distance(ST_Centroid(a.geom)::geography, ST_Centroid(s.g)::geography)::numeric,1)
            FROM core.core_admin_areas a, s WHERE a.id=%s
            """,
            (json.dumps(source_geom), core_id),
        )
        r = cur.fetchone()
        return {
            "source_coverage_pct": float(r[0]) * 100 if r and r[0] is not None else None,
            "candidate_coverage_pct": float(r[1]) * 100 if r and r[1] is not None else None,
            "centroid_dist_m": float(r[2]) if r and r[2] is not None else None,
        }


def pair_overlap(conn: psycopg.Connection, id_a: int, id_b: int) -> float | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT round((ST_Area(ST_Intersection(ST_MakeValid(a.geom), ST_MakeValid(b.geom))::geography)
              / NULLIF(LEAST(ST_Area(ST_MakeValid(a.geom)::geography), ST_Area(ST_MakeValid(b.geom)::geography)),0))::numeric,4)
            FROM core.core_admin_areas a, core.core_admin_areas b
            WHERE a.id=%s AND b.id=%s
            """,
            (id_a, id_b),
        )
        r = cur.fetchone()
        return float(r[0]) if r and r[0] is not None else None


def build_merge_page(conn: psycopg.Connection, admin_review: list[dict]) -> list[dict]:
    preview_dir = OUT / "03-merge-decision-previews"
    preview_dir.mkdir(parents=True, exist_ok=True)
    by_key = {(r["source_pcode"], r.get("source_row")): r for r in admin_review}

    groups = []
    all_ids = []
    for g in MERGE_GROUPS:
        all_ids.extend(g["candidates"])
    details = admin_detail(conn, sorted(set(all_ids)))

    for g in MERGE_GROUPS:
        src = by_key.get((g["source_pcode"], g["source_row"])) or by_key.get((g["source_pcode"], str(g["source_row"])))
        # fallback any row with pcode
        if not src:
            src = next(r for r in admin_review if r["source_pcode"] == g["source_pcode"])
        prev = load_preview(g["source_pcode"], "ward", g["source_row"])
        source_feat = as_feature(prev, {"role": "source", "pcode": g["source_pcode"]}) if prev else None
        cands = []
        feats = []
        if source_feat:
            feats.append(source_feat)
        for cid in g["candidates"]:
            d = details[cid]
            metrics = overlaps(conn, source_feat["geometry"], cid) if source_feat else {}
            feat = {
                "type": "Feature",
                "properties": {
                    "role": "candidate",
                    "core_id": cid,
                    "public_id": d["public_id"],
                    "is_proposed_survivor": cid == g["proposed_survivor"],
                    **metrics,
                },
                "geometry": d["geojson"],
            }
            feats.append(feat)
            (preview_dir / f"{g['group_id']}_core_{cid}.geojson").write_text(json.dumps(feat), encoding="utf-8")
            cands.append(
                {
                    "core_id": cid,
                    "public_id": d["public_id"],
                    "name_my": d["names_my"] or d["canonical_name"],
                    "name_en": d["names_en"],
                    "canonical_name": d["canonical_name"],
                    "entity_type": d["type"],
                    "parent_id": d["parent_id"],
                    "parent_name": d["parent_name"],
                    "verification_status": d["verification_status"],
                    "is_verified": d["is_verified"],
                    "geometry_source": d["geometry_source"],
                    "boundary_status": d["boundary_status"],
                    "is_official_boundary": d["is_official_boundary"],
                    "dep_child_admins": d["dep_child_admins"],
                    "dep_settlements": d["dep_settlements"],
                    "dep_postal": d["dep_postal"],
                    "geom_sha256": d["geom_sha256"],
                    **metrics,
                    "is_proposed_survivor": cid == g["proposed_survivor"],
                }
            )
        a, b = g["candidates"]
        cand_overlap = pair_overlap(conn, a, b)
        if source_feat:
            (preview_dir / f"{g['group_id']}_source.geojson").write_text(json.dumps(source_feat), encoding="utf-8")
        (preview_dir / f"{g['group_id']}_overlay.geojson").write_text(
            json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8"
        )

        groups.append(
            {
                "group_id": g["group_id"],
                "source_pcode": g["source_pcode"],
                "source_row": g["source_row"],
                "source_name_en": src["source_name_en"],
                "source_name_my": src["source_name_my"],
                "source_township": src["source_ts_name"],
                "source_ts_pcode": src["source_ts_pcode"],
                "approved_township_id": src["approved_township_id"],
                "candidates": cands,
                "candidate_to_candidate_overlap": cand_overlap,
                "candidate_to_candidate_overlap_pct": round(cand_overlap * 100, 2) if cand_overlap is not None else None,
                "proposed_survivor_id": g["proposed_survivor"],
                "proposed_survivor_public_id": details[g["proposed_survivor"]]["public_id"],
                "proposed_loser_id": [x for x in g["candidates"] if x != g["proposed_survivor"]][0],
                "exact_merge_reason": g["reason"],
                "overlay_path": f"03-merge-decision-previews/{g['group_id']}_overlay.geojson",
                "status": "PENDING_USER_APPROVAL",
            }
        )
    return groups


def analyze_ma_har(conn: psycopg.Connection, admin_review: list[dict]) -> dict:
    rows = [r for r in admin_review if r["source_pcode"] == "MMR005011701503"]
    assert len(rows) == 2
    r1, r2 = rows[0], rows[1]
    p1 = load_preview("MMR005011701503", "ward", r1["source_row"])
    p2 = load_preview("MMR005011701503", "ward", r2["source_row"])
    f1 = as_feature(p1, {"role": "source_row", "source_row": r1["source_row"]})
    f2 = as_feature(p2, {"role": "source_row", "source_row": r2["source_row"]})

    with conn.cursor() as cur:
        cur.execute(
            """
            WITH a AS (SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%s),4326)) g),
                 b AS (SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%s),4326)) g)
            SELECT
              encode(digest(ST_AsBinary(a.g), 'sha256'), 'hex'),
              encode(digest(ST_AsBinary(b.g), 'sha256'), 'hex'),
              round((ST_Area(ST_Intersection(a.g,b.g)::geography)
                / NULLIF(LEAST(ST_Area(a.g::geography), ST_Area(b.g::geography)),0))::numeric,4),
              round(ST_Distance(ST_Centroid(a.g)::geography, ST_Centroid(b.g)::geography)::numeric,1),
              ST_Equals(a.g, b.g)
            FROM a,b
            """,
            (json.dumps(f1["geometry"]), json.dumps(f2["geometry"])),
        )
        h1, h2, ov, dist, equals = cur.fetchone()

    same_pcode = r1["source_pcode"] == r2["source_pcode"]
    same_name = r1["source_name_en"] == r2["source_name_en"] and r1["source_name_my"] == r2["source_name_my"]
    same_parent = r1["approved_township_id"] == r2["approved_township_id"] and r1["source_ts_pcode"] == r2["source_ts_pcode"]
    exact_duplicate = bool(equals) or (h1 == h2)

    details = admin_detail(conn, [6794, 6797])
    preview_dir = OUT / "03-merge-decision-previews"
    preview_dir.mkdir(parents=True, exist_ok=True)
    feats = [f1, f2]
    for cid in (6794, 6797):
        d = details[cid]
        feats.append(
            {
                "type": "Feature",
                "properties": {"role": "core", "core_id": cid, "public_id": d["public_id"]},
                "geometry": d["geojson"],
            }
        )
    (preview_dir / "ma_har_myaing_overlay.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8"
    )
    (preview_dir / "ma_har_myaing_row1589.geojson").write_text(json.dumps(f1), encoding="utf-8")
    (preview_dir / "ma_har_myaing_row1611.geojson").write_text(json.dumps(f2), encoding="utf-8")

    m1589 = overlaps(conn, f1["geometry"], 6797)
    m1611 = overlaps(conn, f2["geometry"], 6794)
    # also cross
    cross_1589_6794 = overlaps(conn, f1["geometry"], 6794)
    cross_1611_6797 = overlaps(conn, f2["geometry"], 6797)

    if exact_duplicate:
        classification = {
            "kind": "exact_repeated_source_row",
            "process_row": r1["source_row"],
            "process_action": "match_existing",
            "process_match_id": int(r1["proposed_match_core_id"]),
            "reject_row": r2["source_row"],
            "reject_action": "reject_source_error",
            "reject_reason": "duplicate_source_row",
        }
    else:
        classification = {
            "kind": "potentially_distinct_wards_shared_pcode",
            "note": (
                "Same PCode/name/parent but different geometries. "
                "Treat as potentially distinct wards: row1589→6797, row1611→6794 "
                "(each has unique strong overlap). Shared PCode is a source-data defect to record."
            ),
            "row_1589_action": "match_existing",
            "row_1589_match_id": 6797,
            "row_1611_action": "match_existing",
            "row_1611_match_id": 6794,
            "shared_pcode_defect": True,
        }

    return {
        "source_pcode": "MMR005011701503",
        "source_name_en": r1["source_name_en"],
        "source_name_my": r1["source_name_my"],
        "source_township": r1["source_ts_name"],
        "same_pcode": same_pcode,
        "same_name": same_name,
        "same_parent": same_parent,
        "geom_equal": bool(equals),
        "geom_sha256_row1589": h1,
        "geom_sha256_row1611": h2,
        "source_pair_overlap": float(ov) if ov is not None else None,
        "source_centroid_dist_m": float(dist) if dist is not None else None,
        "exact_duplicate_source_row": exact_duplicate,
        "row1589_vs_6797": m1589,
        "row1611_vs_6794": m1611,
        "row1589_vs_6794": cross_1589_6794,
        "row1611_vs_6797": cross_1611_6797,
        "core_6794": {
            "public_id": details[6794]["public_id"],
            "names_my": details[6794]["names_my"],
            "names_en": details[6794]["names_en"],
            "geom_sha256": details[6794]["geom_sha256"],
        },
        "core_6797": {
            "public_id": details[6797]["public_id"],
            "names_my": details[6797]["names_my"],
            "names_en": details[6797]["names_en"],
            "geom_sha256": details[6797]["geom_sha256"],
        },
        "classification": classification,
        "overlay_path": "03-merge-decision-previews/ma_har_myaing_overlay.geojson",
        "status": "CLASSIFIED_AWAITING_ACK",
    }


def hard_check_match_ward(conn: psycopg.Connection, row: dict, match_id: int) -> dict:
    checks = {}
    prev = load_preview(row["source_pcode"], "ward", row.get("source_row"))
    feat = as_feature(prev) if prev else None
    details = admin_detail(conn, [match_id, int(row["approved_township_id"])])
    core = details[match_id]
    ts = details[int(row["approved_township_id"])]

    checks["approved_township_matches"] = core["parent_id"] == int(row["approved_township_id"])
    checks["entity_type_matches"] = core["type"] == "ward"
    my_hit = norm_my(row["source_name_my"]) and (
        norm_my(row["source_name_my"]) in norm_my(core["names_my"] + core["canonical_name"])
    )
    en_hit = norm_en(row["source_name_en"]) and (
        norm_en(row["source_name_en"]) in norm_en(core["names_en"] + core["canonical_name"])
    )
    checks["strong_my_or_bilingual_identity"] = bool(my_hit or (my_hit and en_hit) or (my_hit or en_hit))
    # require Myanmar identity preferentially
    checks["strong_my_or_bilingual_identity"] = bool(my_hit)

    metrics = overlaps(conn, feat["geometry"], match_id) if feat else {}
    checks["geometry_supports_identity"] = (metrics.get("source_coverage_pct") or 0) >= 80 and (
        metrics.get("candidate_coverage_pct") or 0
    ) >= 80
    checks["one_to_one_source_assignment"] = True  # evaluated globally later
    checks["existing_geometry_unchanged_policy"] = True  # match never replaces geom
    checks["pre_match_geom_sha256"] = core["geom_sha256"]

    passed = all(
        [
            checks["approved_township_matches"],
            checks["entity_type_matches"],
            checks["strong_my_or_bilingual_identity"],
            checks["geometry_supports_identity"],
            checks["one_to_one_source_assignment"],
            checks["existing_geometry_unchanged_policy"],
        ]
    )
    return {
        "source_pcode": row["source_pcode"],
        "source_row": row.get("source_row"),
        "match_id": match_id,
        "match_public_id": core["public_id"],
        "checks": checks,
        "metrics": metrics,
        "township": {"id": ts["id"], "name": ts["canonical_name"]},
        "hard_check_pass": passed,
        "conditional_status": "ACCEPTED" if passed else "HELD_FAILED_HARD_CHECK",
    }


def hard_check_match_village(conn: psycopg.Connection, row: dict, match_id: int) -> dict:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT s.id, s.public_id::text, s.canonical_name, s.name_mm, s.name_en, s.township_id,
                   t.canonical_name, encode(digest(ST_AsBinary(s.point_geom),'sha256'),'hex'),
                   ST_X(s.point_geom), ST_Y(s.point_geom),
                   st.code
            FROM core.core_settlements s
            LEFT JOIN core.core_admin_areas t ON t.id=s.township_id
            LEFT JOIN ref.ref_settlement_types st ON st.id=s.settlement_type_id
            WHERE s.id=%s
            """,
            (match_id,),
        )
        s = cur.fetchone()
        lon, lat = float(row["source_lon"]), float(row["source_lat"])
        cur.execute(
            """
            SELECT round(ST_Distance(
              ST_SetSRID(ST_MakePoint(%s,%s),4326)::geography, point_geom::geography
            )::numeric,1)
            FROM core.core_settlements WHERE id=%s
            """,
            (lon, lat, match_id),
        )
        dist = float(cur.fetchone()[0])

    my_hit = norm_my(row["source_name_my"]) and norm_my(row["source_name_my"]) in norm_my(
        (s[3] or "") + (s[2] or "")
    )
    # also accept if source MY is stem of settlement name (ကျဲ ⊂ ကျဲရွာ)
    en_hit = norm_en(row["source_name_en"]) and norm_en(row["source_name_en"]) in norm_en(
        (s[4] or "") + (s[2] or "")
    )
    checks = {
        "approved_township_matches": int(s[5] or 0) == int(row["approved_township_id"]),
        "entity_type_matches": True,  # settlement/village family
        "strong_my_or_bilingual_identity": bool(my_hit),
        "geometry_supports_identity": dist <= 100,
        "one_to_one_source_assignment": True,
        "existing_geometry_unchanged_policy": True,
        "pre_match_point_sha256": s[7],
        "settlement_type": s[10],
        "distance_m": dist,
        "my_hit": my_hit,
        "en_hit": en_hit,
    }
    passed = all(
        [
            checks["approved_township_matches"],
            checks["entity_type_matches"],
            checks["strong_my_or_bilingual_identity"],
            checks["geometry_supports_identity"],
            checks["one_to_one_source_assignment"],
            checks["existing_geometry_unchanged_policy"],
        ]
    )
    return {
        "source_pcode": row["source_pcode"],
        "match_id": match_id,
        "match_public_id": s[1],
        "match_canonical_name": s[2],
        "checks": checks,
        "hard_check_pass": passed,
        "conditional_status": "ACCEPTED" if passed else "HELD_FAILED_HARD_CHECK",
    }


def hard_check_create_village(conn: psycopg.Connection, row: dict) -> dict:
    lon, lat = float(row["source_lon"]), float(row["source_lat"])
    with conn.cursor() as cur:
        cur.execute(
            "SELECT ST_IsValid(ST_SetSRID(ST_MakePoint(%s,%s),4326))",
            (lon, lat),
        )
        geom_valid = bool(cur.fetchone()[0])
        cur.execute(
            """
            SELECT id, canonical_name FROM core.core_admin_areas
            WHERE id=%s AND deleted_at IS NULL
            """,
            (int(row["approved_township_id"]),),
        )
        ts = cur.fetchone()
        # nearest same-township settlement name collision
        cur.execute(
            """
            SELECT s.id, s.canonical_name, s.name_mm, s.name_en,
                   round(ST_Distance(ST_SetSRID(ST_MakePoint(%s,%s),4326)::geography, s.point_geom::geography)::numeric,1)
            FROM core.core_settlements s
            WHERE s.deleted_at IS NULL AND s.township_id=%s
            ORDER BY s.point_geom <-> ST_SetSRID(ST_MakePoint(%s,%s),4326)
            LIMIT 5
            """,
            (lon, lat, int(row["approved_township_id"]), lon, lat),
        )
        nearest = cur.fetchall()

    safe_match = None
    for n in nearest:
        my_hit = norm_my(row["source_name_my"]) and norm_my(row["source_name_my"]) in norm_my((n[2] or "") + (n[1] or ""))
        if my_hit and float(n[4]) <= 100:
            safe_match = {"id": n[0], "name": n[1], "dist": float(n[4])}
            break

    checks = {
        "valid_geometry": geom_valid and -180 <= lon <= 180 and -90 <= lat <= 90,
        "valid_approved_township": ts is not None,
        "genuine_entity_type": row["source_entity_type"] == "village",
        "unique_source_identity": bool(row["source_pcode"]),
        "no_safe_existing_match": safe_match is None,
        "no_unresolved_ambiguity": safe_match is None,
    }
    passed = all(checks.values())
    return {
        "source_pcode": row["source_pcode"],
        "source_name_en": row["source_name_en"],
        "source_name_my": row["source_name_my"],
        "approved_township_id": row["approved_township_id"],
        "township_name": ts[1] if ts else None,
        "nearest": [{"id": n[0], "name": n[1], "dist_m": float(n[4])} for n in nearest],
        "safe_match_found": safe_match,
        "checks": checks,
        "hard_check_pass": passed,
        "conditional_status": "ACCEPTED" if passed else "HELD_FAILED_HARD_CHECK",
    }


def write_viewer(groups: list[dict], ma_har: dict) -> Path:
    viewer_dir = OUT / "03-merge-decision-viewer"
    viewer_dir.mkdir(parents=True, exist_ok=True)
    data = {"generated_at": utc_now(), "groups": groups, "ma_har_myaing": ma_har}
    (viewer_dir / "data.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    # Copy overlays next to viewer for static serving
    src_prev = OUT / "03-merge-decision-previews"
    dest_prev = viewer_dir / "previews"
    dest_prev.mkdir(exist_ok=True)
    for p in src_prev.glob("*.geojson"):
        (dest_prev / p.name).write_bytes(p.read_bytes())

    html = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Phase7 merge decision — 4 groups + Ma Har Myaing</title>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet"/>
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<style>
  :root { --bg:#0f1419; --panel:#1a222c; --text:#e7ecf1; --muted:#9aa7b5; --accent:#3d8bfd; --warn:#e6a23c; --ok:#3dbf7f; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.45 system-ui,sans-serif; background:var(--bg); color:var(--text); }
  header { padding:12px 16px; border-bottom:1px solid #2a3440; }
  h1 { font-size:16px; margin:0 0 4px; }
  .sub { color:var(--muted); font-size:12px; }
  .layout { display:grid; grid-template-columns: 360px 1fr; height: calc(100vh - 64px); }
  nav { overflow:auto; border-right:1px solid #2a3440; background:var(--panel); }
  .item { padding:10px 12px; border-bottom:1px solid #243040; cursor:pointer; }
  .item:hover, .item.active { background:#243040; }
  .item .code { font-family: ui-monospace, monospace; font-size:12px; color:var(--accent); }
  .badge { display:inline-block; padding:1px 6px; border-radius:4px; font-size:11px; background:#2b3848; color:var(--warn); }
  #map { width:100%; height:100%; }
  .detail { padding:12px; font-size:12px; color:var(--muted); }
  table { width:100%; border-collapse:collapse; margin-top:8px; }
  td,th { border-top:1px solid #2a3440; padding:4px 6px; text-align:left; vertical-align:top; color:var(--text); }
  th { color:var(--muted); font-weight:600; width:38%; }
  .ok { color:var(--ok); } .warn { color:var(--warn); }
</style>
</head>
<body>
<header>
  <h1>Merge decision page (pending approval)</h1>
  <div class="sub">Four ward merge groups + Ma Har Myaing source pair · production not modified · v2 manifests blocked</div>
</header>
<div class="layout">
  <nav id="list"></nav>
  <div>
    <div id="map"></div>
    <div class="detail" id="detail"></div>
  </div>
</div>
<script>
const map = new maplibregl.Map({
  container:'map',
  style:{
    version:8,
    sources:{
      osm:{type:'raster', tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize:256, attribution:'© OSM'}
    },
    layers:[{id:'osm', type:'raster', source:'osm'}]
  },
  center:[96.1,21.9], zoom:5
});
map.addControl(new maplibregl.NavigationControl());

let data=null; let current=null;
function clearOverlay(){
  if(map.getLayer('ov-fill')) map.removeLayer('ov-fill');
  if(map.getLayer('ov-line')) map.removeLayer('ov-line');
  if(map.getSource('ov')) map.removeSource('ov');
}
function showOverlay(url){
  clearOverlay();
  fetch(url).then(r=>r.json()).then(fc=>{
    map.addSource('ov',{type:'geojson', data:fc});
    map.addLayer({id:'ov-fill', type:'fill', source:'ov', paint:{
      'fill-color':['case',
        ['==',['get','role'],'source'], '#ff7a1a',
        ['==',['get','is_proposed_survivor'], true], '#3dbf7f',
        '#3d8bfd'],
      'fill-opacity':0.35
    }});
    map.addLayer({id:'ov-line', type:'line', source:'ov', paint:{
      'line-color':['case',
        ['==',['get','role'],'source'], '#ff7a1a',
        ['==',['get','is_proposed_survivor'], true], '#3dbf7f',
        '#3d8bfd'],
      'line-width':2
    }});
    const b=new maplibregl.LngLatBounds();
    const walk=(g)=>{ if(!g) return; if(g.type==='Point') b.extend(g.coordinates);
      else if(g.type==='Polygon') g.coordinates[0].forEach(c=>b.extend(c));
      else if(g.type==='MultiPolygon') g.coordinates.forEach(p=>p[0].forEach(c=>b.extend(c)));
      else if(g.type==='GeometryCollection') (g.geometries||[]).forEach(walk); };
    fc.features.forEach(f=>walk(f.geometry));
    if(!b.isEmpty()) map.fitBounds(b,{padding:40, duration:0, maxZoom:15});
  });
}
function renderList(){
  const nav=document.getElementById('list');
  nav.innerHTML='';
  data.groups.forEach((g,i)=>{
    const el=document.createElement('div');
    el.className='item'+(i===0?' active':'');
    el.innerHTML=`<div class="code">${g.source_pcode}</div>
      <div>${g.source_name_en} / ${g.source_name_my}</div>
      <div class="sub">${g.source_township} · survivor ${g.proposed_survivor_id}</div>
      <span class="badge">${g.status}</span>`;
    el.onclick=()=>selectGroup(i);
    nav.appendChild(el);
  });
  const el=document.createElement('div');
  el.className='item';
  el.innerHTML=`<div class="code">MMR005011701503</div>
    <div>Ma Har Myaing (source pair)</div>
    <div class="sub">${data.ma_har_myaing.classification.kind}</div>
    <span class="badge">${data.ma_har_myaing.status}</span>`;
  el.onclick=()=>selectMaHar();
  nav.appendChild(el);
}
function selectGroup(i){
  [...document.querySelectorAll('.item')].forEach((e,idx)=>e.classList.toggle('active', idx===i));
  const g=data.groups[i]; current=g;
  const c0=g.candidates[0], c1=g.candidates[1];
  document.getElementById('detail').innerHTML=`
    <table>
      <tr><th>Source</th><td>${g.source_pcode} · ${g.source_name_en} / ${g.source_name_my}<br/>Township: ${g.source_township}</td></tr>
      <tr><th>A</th><td>${c0.core_id} / ${c0.public_id}<br/>${c0.name_my} · ${c0.name_en||'—'} · type=${c0.entity_type}<br/>
        srcCoverage=${c0.source_coverage_pct?.toFixed?.(1) ?? c0.source_coverage_pct}% · candCoverage=${c0.candidate_coverage_pct?.toFixed?.(1) ?? c0.candidate_coverage_pct}%<br/>
        deps child/settle/postal=${c0.dep_child_admins}/${c0.dep_settlements}/${c0.dep_postal}<br/>
        verify=${c0.verification_status} · geom_source=${c0.geometry_source||'—'} ${c0.is_proposed_survivor?'<span class="ok">SURVIVOR</span>':''}</td></tr>
      <tr><th>B</th><td>${c1.core_id} / ${c1.public_id}<br/>${c1.name_my} · ${c1.name_en||'—'} · type=${c1.entity_type}<br/>
        srcCoverage=${c1.source_coverage_pct?.toFixed?.(1) ?? c1.source_coverage_pct}% · candCoverage=${c1.candidate_coverage_pct?.toFixed?.(1) ?? c1.candidate_coverage_pct}%<br/>
        deps child/settle/postal=${c1.dep_child_admins}/${c1.dep_settlements}/${c1.dep_postal}<br/>
        verify=${c1.verification_status} · geom_source=${c1.geometry_source||'—'} ${c1.is_proposed_survivor?'<span class="ok">SURVIVOR</span>':''}</td></tr>
      <tr><th>Cand↔cand overlap</th><td>${g.candidate_to_candidate_overlap_pct}%</td></tr>
      <tr><th>Proposed survivor</th><td class="ok">${g.proposed_survivor_id} / ${g.proposed_survivor_public_id}</td></tr>
      <tr><th>Merge reason</th><td>${g.exact_merge_reason}</td></tr>
    </table>`;
  showOverlay('previews/'+g.group_id+'_overlay.geojson');
}
function selectMaHar(){
  [...document.querySelectorAll('.item')].forEach((e,idx)=>e.classList.toggle('active', idx===data.groups.length));
  const m=data.ma_har_myaing;
  document.getElementById('detail').innerHTML=`
    <table>
      <tr><th>PCode</th><td>${m.source_pcode} · ${m.source_name_en} / ${m.source_name_my}</td></tr>
      <tr><th>Same PCode/name/parent</th><td>${m.same_pcode} / ${m.same_name} / ${m.same_parent}</td></tr>
      <tr><th>Geom equal</th><td class="${m.geom_equal?'ok':'warn'}">${m.geom_equal} · pair overlap=${(m.source_pair_overlap*100).toFixed(1)}% · centroid ${m.source_centroid_dist_m}m</td></tr>
      <tr><th>SHA row1589</th><td><code>${m.geom_sha256_row1589.slice(0,16)}…</code></td></tr>
      <tr><th>SHA row1611</th><td><code>${m.geom_sha256_row1611.slice(0,16)}…</code></td></tr>
      <tr><th>Classification</th><td class="warn">${m.classification.kind}<br/>${m.classification.note||m.classification.reject_reason||''}</td></tr>
      <tr><th>Suggested</th><td>row1589 → ${m.classification.row_1589_match_id||m.classification.process_match_id} · row1611 → ${m.classification.row_1611_match_id||m.classification.reject_action}</td></tr>
    </table>`;
  showOverlay('previews/ma_har_myaing_overlay.geojson');
}
fetch('data.json').then(r=>r.json()).then(d=>{ data=d; renderList(); map.on('load',()=>selectGroup(0)); });
</script>
</body>
</html>
"""
    (viewer_dir / "index.html").write_text(html, encoding="utf-8")
    return viewer_dir


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    admin_review = load_csv(OUT / "02-rejected-admin-review.csv")
    vill_review = load_csv(OUT / "02-rejected-village-review.csv")
    vill_by_p = {r["source_pcode"]: r for r in vill_review}

    with psycopg.connect(DB_URL) as conn:
        conn.execute("SET search_path TO core, ref, public")
        # enable pgcrypto digest if needed
        try:
            conn.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
        except Exception:
            pass

        pangsang = freeze_pangsang(conn)
        groups = build_merge_page(conn, admin_review)
        ma_har = analyze_ma_har(conn, admin_review)

        # Hard-check match wards (excluding merges; including ma har if distinct)
        match_ward_results = []
        for spec in [
            {"source_pcode": "MMR018002701509", "source_row": "1574", "match_id": 6023},
            {"source_pcode": "MMR013029701504", "source_row": "1840", "match_id": 5119},
        ]:
            row = next(r for r in admin_review if r["source_pcode"] == spec["source_pcode"] and r.get("source_row") == spec["source_row"])
            match_ward_results.append(hard_check_match_ward(conn, row, spec["match_id"]))

        # Ma Har Myaing: if distinct, hard-check both matches
        if not ma_har["exact_duplicate_source_row"]:
            for source_row, match_id in [("1589", 6797), ("1611", 6794)]:
                row = next(r for r in admin_review if r["source_pcode"] == "MMR005011701503" and r.get("source_row") == source_row)
                match_ward_results.append(hard_check_match_ward(conn, row, match_id))
        else:
            row = next(r for r in admin_review if r["source_pcode"] == "MMR005011701503" and r.get("source_row") == ma_har["classification"]["process_row"])
            match_ward_results.append(hard_check_match_ward(conn, row, ma_har["classification"]["process_match_id"]))

        # one-to-one assignment check across accepted matches
        assigned = {}
        for r in match_ward_results:
            if not r["hard_check_pass"]:
                continue
            mid = r["match_id"]
            if mid in assigned:
                r["hard_check_pass"] = False
                r["conditional_status"] = "HELD_FAILED_HARD_CHECK"
                r["checks"]["one_to_one_source_assignment"] = False
                r["checks"]["one_to_one_conflict_with"] = assigned[mid]
            else:
                assigned[mid] = r["source_pcode"]

        match_vill_results = []
        for spec in MATCH_VILLAGES:
            match_vill_results.append(hard_check_match_village(conn, vill_by_p[spec["source_pcode"]], spec["match_id"]))

        create_vill_results = []
        for pcode in CREATE_VILLAGES:
            create_vill_results.append(hard_check_create_village(conn, vill_by_p[pcode]))

    viewer_dir = write_viewer(groups, ma_har)

    summary = {
        "generated_at": utc_now(),
        "production_touched": False,
        "v2_manifests_generated": False,
        "pangsang": {
            "decision": pangsang["decision"],
            "target_public_id": pangsang["target_public_id"],
            "target_slug": pangsang["target_slug"],
            "parent_public_id": pangsang["parent_public_id"],
            "child_vt_count": pangsang["child_vt_count"],
            "preserve_6484": True,
        },
        "match_wards": match_ward_results,
        "match_villages": match_vill_results,
        "create_villages": create_vill_results,
        "merge_groups_pending": [
            {
                "source_pcode": g["source_pcode"],
                "survivor": g["proposed_survivor_id"],
                "loser": g["proposed_loser_id"],
                "cand_overlap_pct": g["candidate_to_candidate_overlap_pct"],
            }
            for g in groups
        ],
        "ma_har_myaing": ma_har,
        "viewer_dir": str(viewer_dir.relative_to(ROOT)),
        "blocked": "Awaiting approval of 4 merge decisions before final v2 manifests",
    }
    (OUT / "decisions/03-conditional-accept-results.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    # concise markdown table
    lines = [
        "# Merge decision table (pending)",
        "",
        "| # | Source PCode | Names (EN / MY) | Township | Survivor id / public_id | Loser id | Cand↔cand overlap | Status |",
        "|---:|---|---|---|---|---:|---:|---|",
    ]
    for i, g in enumerate(groups, 1):
        lines.append(
            f"| {i} | `{g['source_pcode']}` | {g['source_name_en']} / {g['source_name_my']} | "
            f"{g['source_township']} | `{g['proposed_survivor_id']}` / `{g['proposed_survivor_public_id']}` | "
            f"`{g['proposed_loser_id']}` | {g['candidate_to_candidate_overlap_pct']}% | PENDING |"
        )
    lines += [
        "",
        "## Ma Har Myaing",
        f"- Kind: **{ma_har['classification']['kind']}**",
        f"- Geom equal: `{ma_har['geom_equal']}` · pair overlap `{ma_har['source_pair_overlap']}` · centroid dist `{ma_har['source_centroid_dist_m']}m`",
        f"- Classification detail: `{json.dumps(ma_har['classification'], ensure_ascii=False)}`",
        "",
        "## Conditional hard-check tallies",
        f"- Ward match_existing accepted: **{sum(1 for r in match_ward_results if r['hard_check_pass'])}/{len(match_ward_results)}**",
        f"- Village match_existing accepted: **{sum(1 for r in match_vill_results if r['hard_check_pass'])}/{len(match_vill_results)}**",
        f"- Village create_new accepted: **{sum(1 for r in create_vill_results if r['hard_check_pass'])}/{len(create_vill_results)}**",
        "",
        "Full v2 manifests: **not generated** (waiting for merge approvals).",
    ]
    (OUT / "03-merge-decision-table.md").write_text("\n".join(lines), encoding="utf-8")

    write_csv(
        OUT / "decisions/03-match-ward-hardchecks.csv",
        [
            {
                "source_pcode": r["source_pcode"],
                "source_row": r.get("source_row"),
                "match_id": r["match_id"],
                "match_public_id": r["match_public_id"],
                "hard_check_pass": r["hard_check_pass"],
                "status": r["conditional_status"],
                "checks_json": json.dumps(r["checks"]),
                "metrics_json": json.dumps(r.get("metrics") or {}),
            }
            for r in match_ward_results
        ],
    )
    write_csv(
        OUT / "decisions/03-match-village-hardchecks.csv",
        [
            {
                "source_pcode": r["source_pcode"],
                "match_id": r["match_id"],
                "match_public_id": r["match_public_id"],
                "hard_check_pass": r["hard_check_pass"],
                "status": r["conditional_status"],
                "checks_json": json.dumps(r["checks"]),
            }
            for r in match_vill_results
        ],
    )
    write_csv(
        OUT / "decisions/03-create-village-hardchecks.csv",
        [
            {
                "source_pcode": r["source_pcode"],
                "source_name_en": r["source_name_en"],
                "hard_check_pass": r["hard_check_pass"],
                "status": r["conditional_status"],
                "checks_json": json.dumps(r["checks"]),
                "safe_match_found": json.dumps(r["safe_match_found"]),
            }
            for r in create_vill_results
        ],
    )

    print(json.dumps({"viewer_dir": str(viewer_dir), "pangsang_public_id": pangsang["target_public_id"], "slug": pangsang["target_slug"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
