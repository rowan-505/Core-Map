#!/usr/bin/env python3
"""Phase 7 completion-v2 review packages (disposable DB only).

Generates:
  01-pangsang-township-review.csv / map-preview / summary
  02-rejected-admin-review.csv / village-review / previews / summary

Does not touch production. Does not modify frozen manifests.
"""

from __future__ import annotations

import csv
import json
import shutil
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "reports/admin-reconciliation-v2/phase7-completion-v2"
FROZEN_ADMIN = ROOT / "reports/admin-reconciliation-v2/phase3-frozen/03-approved-local-admin.csv"
FROZEN_VILL = ROOT / "reports/admin-reconciliation-v2/phase3-frozen/03-approved-villages.csv"
TS_MAP = ROOT / "reports/admin-reconciliation-v2/02-township-map.csv"
PREVIEWS = ROOT / "reports/admin-reconciliation-v2/phase3-previews"
MIMU_TS_GJ = Path("/tmp/mimu_pangsang_township.geojson")

DB_URL = "postgresql://postgres:postgres@127.0.0.1:5433/coremap_phase7_backup_restore"


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def write_csv(path: Path, rows: list[dict], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)


def load_csv(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def find_preview(prefix: str, pcode: str) -> Path | None:
    matches = sorted(PREVIEWS.glob(f"{prefix}_{pcode}_*.geojson"))
    return matches[0] if matches else None


def copy_preview(src: Path | None, dest: Path) -> str:
    if not src or not src.exists():
        return ""
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    return str(dest.relative_to(OUT))


def dependency_counts(conn: psycopg.Connection, admin_ids: list[int]) -> dict[int, dict]:
    if not admin_ids:
        return {}
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT a.id,
              (SELECT count(*) FROM core.core_admin_areas c
                 WHERE c.parent_id = a.id AND c.deleted_at IS NULL) AS child_admins,
              (SELECT count(*) FROM core.core_settlements s
                 WHERE s.township_id = a.id AND s.deleted_at IS NULL) AS settlements,
              (SELECT count(*) FROM ref.ref_postal_codes p
                 WHERE p.local_admin_area_id = a.id OR p.township_admin_area_id = a.id) AS postal
            FROM core.core_admin_areas a
            WHERE a.id = ANY(%s)
            """,
            (admin_ids,),
        )
        return {
            int(r[0]): {
                "child_admins": int(r[1]),
                "settlements": int(r[2]),
                "postal": int(r[3]),
            }
            for r in cur.fetchall()
        }


def settlement_deps(conn: psycopg.Connection, ids: list[int]) -> dict[int, dict]:
    if not ids:
        return {}
    with conn.cursor() as cur:
        # soft dependency probe: saved places / reports may not exist on disposable
        cur.execute(
            """
            SELECT s.id, s.public_id::text, s.canonical_name, s.name_en, s.name_mm,
                   s.township_id, ST_AsText(s.point_geom),
                   ST_X(s.point_geom), ST_Y(s.point_geom),
                   t.canonical_name
            FROM core.core_settlements s
            LEFT JOIN core.core_admin_areas t ON t.id = s.township_id
            WHERE s.id = ANY(%s)
            """,
            (ids,),
        )
        out = {}
        for r in cur.fetchall():
            out[int(r[0])] = {
                "public_id": r[1],
                "canonical_name": r[2],
                "name_en": r[3],
                "name_mm": r[4],
                "township_id": r[5],
                "wkt": r[6],
                "lon": r[7],
                "lat": r[8],
                "township_name": r[9],
            }
        return out


def admin_rows(conn: psycopg.Connection, ids: list[int]) -> dict[int, dict]:
    if not ids:
        return {}
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT a.id, a.public_id::text, a.canonical_name, a.slug, a.external_id,
                   t.code AS type_code, l.code AS level_code,
                   a.parent_id, p.canonical_name AS parent_name,
                   gp.id AS gparent_id, gp.canonical_name AS gparent_name,
                   ST_AsGeoJSON(a.geom),
                   (SELECT string_agg(n.language_code || ':' || n.name, ' | '
                            ORDER BY n.language_code, n.name)
                      FROM core.core_admin_area_names n WHERE n.admin_area_id = a.id) AS aliases
            FROM core.core_admin_areas a
            LEFT JOIN ref.ref_admin_area_types t ON t.id = a.admin_area_type_id
            LEFT JOIN ref.ref_admin_levels l ON l.id = a.admin_level_id
            LEFT JOIN core.core_admin_areas p ON p.id = a.parent_id
            LEFT JOIN core.core_admin_areas gp ON gp.id = p.parent_id
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
                "type_code": r[5],
                "level_code": r[6],
                "parent_id": r[7],
                "parent_name": r[8],
                "gparent_id": r[9],
                "gparent_name": r[10],
                "geojson": json.loads(r[11]) if r[11] else None,
                "aliases": r[12] or "",
            }
        return out


def overlap_pair(conn: psycopg.Connection, source_geojson: dict, core_id: int) -> dict:
    with conn.cursor() as cur:
        cur.execute(
            """
            WITH s AS (
              SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)) AS geom
            )
            SELECT
              round((ST_Area(ST_Intersection(ST_MakeValid(a.geom), s.geom)::geography)
                     / NULLIF(ST_Area(s.geom::geography),0))::numeric, 4),
              round((ST_Area(ST_Intersection(ST_MakeValid(a.geom), s.geom)::geography)
                     / NULLIF(ST_Area(ST_MakeValid(a.geom)::geography),0))::numeric, 4),
              round(ST_Distance(ST_Centroid(a.geom)::geography, ST_Centroid(s.geom)::geography)::numeric, 1)
            FROM core.core_admin_areas a, s
            WHERE a.id = %s
            """,
            (json.dumps(source_geojson), core_id),
        )
        row = cur.fetchone()
        if not row:
            return {"overlap_of_source": None, "overlap_of_core": None, "centroid_dist_m": None}
        return {
            "overlap_of_source": float(row[0]) if row[0] is not None else None,
            "overlap_of_core": float(row[1]) if row[1] is not None else None,
            "centroid_dist_m": float(row[2]) if row[2] is not None else None,
        }


def point_distance(conn: psycopg.Connection, lon: float, lat: float, settlement_id: int) -> float | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT round(ST_Distance(
              ST_SetSRID(ST_MakePoint(%s,%s),4326)::geography,
              point_geom::geography
            )::numeric, 1)
            FROM core.core_settlements WHERE id = %s
            """,
            (lon, lat, settlement_id),
        )
        row = cur.fetchone()
        return float(row[0]) if row and row[0] is not None else None


def build_pangsang(conn: psycopg.Connection) -> None:
    preview_dir = OUT / "01-pangsang-map-preview"
    preview_dir.mkdir(parents=True, exist_ok=True)

    admin_rows_csv = load_csv(FROZEN_ADMIN)
    pangsang_children = [
        r
        for r in admin_rows_csv
        if (r.get("source_ts_pcode") or "") == "MMR015005"
        or "Pangsang" in (r.get("source_ts_name") or "")
        or "Panghkam" in (r.get("source_ts_name") or "")
    ]
    ts_map = {r["source_ts_pcode"]: r for r in load_csv(TS_MAP)}
    ts_row = ts_map.get("MMR015005", {})

    # Candidate CoreMap townships from prior spatial_support + name/hierarchy
    cand_ids = [6484, 6487, 6469, 6486, 6472, 6473, 6328]
    cores = admin_rows(conn, cand_ids)
    deps = dependency_counts(conn, cand_ids)

    mimu_gj = json.loads(MIMU_TS_GJ.read_text(encoding="utf-8"))
    (preview_dir / "mimu_MMR015005.geojson").write_text(json.dumps(mimu_gj), encoding="utf-8")

    candidate_metrics = []
    features = [mimu_gj]
    for cid in cand_ids:
        core = cores.get(cid)
        if not core:
            continue
        metrics = overlap_pair(conn, mimu_gj["geometry"], cid)
        feat = {
            "type": "Feature",
            "properties": {
                "core_id": cid,
                "public_id": core["public_id"],
                "canonical_name": core["canonical_name"],
                "aliases": core["aliases"],
                "parent_name": core["parent_name"],
                "gparent_name": core["gparent_name"],
                **metrics,
                **deps.get(cid, {}),
            },
            "geometry": core["geojson"],
        }
        (preview_dir / f"core_{cid}.geojson").write_text(json.dumps(feat), encoding="utf-8")
        features.append(feat)
        candidate_metrics.append(
            {
                "core_id": cid,
                "public_id": core["public_id"],
                "canonical_name": core["canonical_name"],
                "aliases": core["aliases"],
                "type": core["type_code"],
                "parent_id": core["parent_id"],
                "parent_name": core["parent_name"],
                "gparent_name": core["gparent_name"],
                "external_id": core["external_id"],
                **metrics,
                **{f"dep_{k}": v for k, v in deps.get(cid, {}).items()},
            }
        )

    (preview_dir / "overlay_candidates.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": features}),
        encoding="utf-8",
    )
    (preview_dir / "candidate_metrics.json").write_text(
        json.dumps(candidate_metrics, indent=2), encoding="utf-8"
    )

    # Copy a few VT child previews for visual context
    child_preview_copied = 0
    for r in pangsang_children[:12]:
        src = find_preview("village_tract", r["source_pcode"])
        if src:
            copy_preview(src, preview_dir / "children" / src.name)
            child_preview_copied += 1

    # Honest decision: identity is uncertain → manual_review (do not auto-match 6484)
    evidence_bits = [
        "MIMU MMR015005 area ≈ 3148 km²; CoreMap Wa township candidates ≈ 500–700 km² each.",
        "Best overlap_of_mimu among CoreMap townships is only ~0.20 (no unique containment).",
        "CoreMap 6484 OSM identity is Manshiang/Man Man Hsai (wikidata Q65340655) while canonical/official names were reparented to Pangsang (Panghkam).",
        "CoreMap 6469 is a separate Pangkham Special Township under Matman.",
        "Phase-2 township map left MMR015005 unmatched/manual_review; Phase-1 already planned create_mimu_placeholder for township 03_Township:282.",
        f"{len(pangsang_children)} frozen child VT creates currently have empty approved_township_id.",
        "Never select parent by proximity alone; name alias collision is not unique identity proof.",
    ]

    review_row = {
        "source_ts_pcode": "MMR015005",
        "source_ts_name_en": "Pangsang (Panghkam)",
        "source_ts_name_my": "ပန်ဆန်း (ပန်ခမ်း)",
        "source_st_pcode": "MMR015",
        "source_st_name": "Shan (North)",
        "source_dt_pcode": "MMR015D007",
        "source_dt_name": "Matman",
        "source_parent_path": "Shan (North) > Matman > Pangsang (Panghkam)",
        "boundary_count_from_township_map": ts_row.get("boundary_count", ""),
        "village_count_from_township_map": ts_row.get("village_count", ""),
        "prior_township_map_status": ts_row.get("status", ""),
        "prior_match_method": ts_row.get("match_method", ""),
        "prior_evidence": ts_row.get("evidence", ""),
        "prior_review_reason": ts_row.get("review_reason", ""),
        "child_vt_create_count": len(pangsang_children),
        "child_vt_with_empty_township_id": sum(
            1 for r in pangsang_children if not (r.get("approved_township_id") or "").strip()
        ),
        "candidate_core_ids": ";".join(str(c["core_id"]) for c in candidate_metrics),
        "candidate_public_ids": ";".join(c["public_id"] for c in candidate_metrics),
        "candidate_summary": " | ".join(
            f"{c['core_id']}:{c['canonical_name']}(om={c['overlap_of_source']},oc={c['overlap_of_core']},d={c['centroid_dist_m']}m)"
            for c in candidate_metrics
        ),
        "name_evidence": (
            "MIMU EN/MY = Pangsang (Panghkam)/ပန်ဆန်း (ပန်ခမ်း). "
            "CoreMap 6484 has official EN/MY aliases matching that string, but also retains "
            "Man Man Hsai/မန်မန်ဆိုင် and OSM Manshiang tags."
        ),
        "hierarchy_evidence": (
            "MIMU parent district = Matman (MMR015D007). "
            "6484/6469/6487/6486 sit under CoreMap Matman district; "
            "6472/6473 sit under Mong Lin / Wa State North hierarchy."
        ),
        "geometry_evidence": "; ".join(evidence_bits[:4]),
        "proposed_decision": "manual_review",
        "recommended_leaning_if_forced": "create_missing_township_placeholder",
        "why_not_match_existing_township": (
            "No CoreMap township uniquely equals MIMU Pangsang. Matching 6484 would attach "
            "88 VTs to a Manshiang/Man Man Hsai OSM geometry that covers only ~20% of MIMU Pangsang."
        ),
        "why_not_reject_invalid_source_parent": (
            "MIMU township record is a valid published PCode with 88 VT children and postal localities; "
            "not a malformed/duplicate source error."
        ),
        "uncertainty_flags": (
            "IDENTITY_UNCERTAIN:GAD_PANGSANG_VS_WA_SUBDIVISIONS;"
            "COREMAP_6484_NAME_POLLUTION;"
            "OVERLAP_NOT_UNIQUE"
        ),
        "requires_user_decision": "true",
        "preview_dir": "01-pangsang-map-preview",
        "child_preview_copied": child_preview_copied,
        "evidence_notes": " || ".join(evidence_bits),
        "generated_at": utc_now(),
    }

    write_csv(
        OUT / "01-pangsang-township-review.csv",
        [review_row],
        list(review_row.keys()),
    )

    # Also emit one row per child for audit completeness (same township decision)
    child_rows = []
    for r in pangsang_children:
        child_rows.append(
            {
                "source_entity_type": r.get("source_entity_type"),
                "source_pcode": r.get("source_pcode"),
                "source_name_en": r.get("source_name_en"),
                "source_name_my": r.get("source_name_my"),
                "source_ts_pcode": "MMR015005",
                "source_ts_name": r.get("source_ts_name"),
                "frozen_action": r.get("action"),
                "frozen_approved_township_id": r.get("approved_township_id"),
                "parent_decision_depends_on": "MMR015005",
                "proposed_parent_decision": "manual_review",
                "preview": copy_preview(
                    find_preview("village_tract", r["source_pcode"]),
                    preview_dir / "children" / f"{r['source_pcode']}.geojson",
                ),
            }
        )
    write_csv(
        OUT / "01-pangsang-child-vt-inventory.csv",
        child_rows,
        list(child_rows[0].keys()) if child_rows else ["source_pcode"],
    )

    md = f"""# 01 Pangsang / Panghkam township review

Generated: `{utc_now()}`  
Database: disposable `coremap_phase7_backup_restore` (pre-Phase-7 baseline)  
Production: **not touched**

## Verdict (stop for decision)

**Proposed decision for source township `MMR015005` / Pangsang (Panghkam): `manual_review`**

Identity is **uncertain**. Do **not** treat CoreMap `6484` as a certain match.

| Option | Allowed? | Recommendation |
|---|---|---|
| `match_existing_township` → 6484 | No (not unique / wrong OSM identity) | Reject this option |
| `create_missing_township_placeholder` | Plausible | **Recommended leaning** if you approve creating a large GAD-era township over Wa OSM subdivisions |
| `reject_invalid_source_parent` | No | MIMU parent is not a source error |
| `manual_review` | **Selected** | Wait for your decision |

## Why 6484 is not a safe match

- Canonical/official names on `6484` currently say **Pangsang (Panghkam) / ပန်ဆန်း (ပန်ခမ်း)**.
- The same row still carries **Man Man Hsai / မန်မန်ဆိုင်** aliases and OSM tags for **Manshiang** (`osm:R:14035205`, wikidata `Q65340655`).
- MIMU township area ≈ **3148 km²**. CoreMap `6484` ≈ **627 km²** and covers only ≈ **0.20** of MIMU Pangsang.
- Nearby Wa townships (`6487`, `6469`, `6472`, `6473`, …) each also cover ≈ **0.15–0.20** of MIMU Pangsang. No unique containment.
- A separate CoreMap township `6469` already exists as **Pangkham Special Township**.

## Hierarchy

| Side | Path |
|---|---|
| MIMU | Shan (North) → Matman (`MMR015D007`) → Pangsang (Panghkam) (`MMR015005`) |
| CoreMap 6484 | Shan → Matman district → canonical `ပန်ဆန်း (ပန်ခမ်း)` (OSM Manshiang) |
| CoreMap 6469 | Shan → Matman district → Pangkham Special Township |

Source parent PCode audit key: **`MMR015005`** (do not store as production `external_id`).

## Dependent children blocked today

- Frozen VT creates under this township: **{len(pangsang_children)}**
- Of those with empty `approved_township_id`: **{sum(1 for r in pangsang_children if not (r.get('approved_township_id') or '').strip())}**
- These are the ~88 Shan North skips from Phase 6/7 dry-run.

## Candidate metrics (overlap with MIMU township)

| core_id | canonical | overlap_of_mimu | overlap_of_core | centroid_m | parent |
|---:|---|---:|---:|---:|---|
"""
    for c in candidate_metrics:
        md += (
            f"| {c['core_id']} | {c['canonical_name']} | {c['overlap_of_source']} | "
            f"{c['overlap_of_core']} | {c['centroid_dist_m']} | {c['parent_name']} |\n"
        )

    md += f"""

## Artifacts

- `01-pangsang-township-review.csv`
- `01-pangsang-child-vt-inventory.csv`
- `01-pangsang-map-preview/mimu_MMR015005.geojson`
- `01-pangsang-map-preview/core_*.geojson`
- `01-pangsang-map-preview/overlay_candidates.geojson`
- `01-pangsang-map-preview/candidate_metrics.json`
- Child VT previews copied: **{child_preview_copied}**

## Decision needed from you

Reply with exactly one for `MMR015005`:

1. `match_existing_township` + core public_id/id (only if you override the evidence)
2. `create_missing_township_placeholder` (and confirm Matman district parent)
3. `reject_invalid_source_parent`
4. `manual_review` remains open (no v2 manifest progress for these 88 VTs)

Until that decision, Phase 7 completion-v2 **stops before revised manifests**.
"""
    (OUT / "01-pangsang-summary.md").write_text(md, encoding="utf-8")


def propose_ward_decision(cands: list[dict]) -> tuple[str, str, str]:
    """Return (decision, chosen_id, reason)."""
    if not cands:
        return "create_new", "", "No CoreMap candidates; MIMU ward appears valid → create_new"
    # Prefer unique near-perfect overlap
    perfect = [c for c in cands if (c.get("overlap_of_source") or 0) >= 0.95]
    if len(perfect) == 1:
        c = perfect[0]
        losers = [str(x["id"]) for x in cands if x["id"] != c["id"]]
        return (
            "match_existing",
            str(c["id"]),
            f"Unique near-full polygon overlap with core {c['id']} ({c['public_id']}); "
            f"other same-name rows are likely duplicates ({','.join(losers) or 'none'}).",
        )
    if len(perfect) >= 2:
        # keep_both is wrong for one source; merge if both are duplicates of each other
        return (
            "merge_confirmed_duplicate",
            str(sorted(perfect, key=lambda x: -x.get("overlap_of_source", 0))[0]["id"]),
            "Multiple CoreMap wards share exact name and near-identical geometry; "
            "propose merge onto highest-overlap survivor, then match source.",
        )
    # partial overlaps
    ranked = sorted(cands, key=lambda x: (-(x.get("overlap_of_source") or 0), x.get("centroid_dist_m") or 1e18))
    top = ranked[0]
    if (top.get("overlap_of_source") or 0) >= 0.8 and (
        len(ranked) == 1 or (top.get("overlap_of_source") or 0) - (ranked[1].get("overlap_of_source") or 0) >= 0.3
    ):
        return (
            "match_existing",
            str(top["id"]),
            f"Clear spatial winner core {top['id']} under same township/name.",
        )
    return (
        "manual_review",
        "",
        "Ambiguous candidate set after reopening; needs human pick among same-name CoreMap wards.",
    )


def propose_village_decision(dist_m: float | None, cand: dict | None, source_name: str) -> tuple[str, str, str]:
    if not cand:
        return "create_new", "", "No settlement candidate; MIMU village is valid → create_new"
    # Name mismatch was why Phase3 rejected spatial-only. Reopen: do not reject source.
    # If distances are tiny but names differ, keep_both / create_new rather than force merge.
    cname = (cand.get("canonical_name") or "") + " " + (cand.get("name_en") or "") + " " + (cand.get("name_mm") or "")
    src_norm = "".join(ch for ch in source_name.lower() if ch.isalnum())
    cand_norm = "".join(ch for ch in cname.lower() if ch.isalnum())
    name_hit = bool(src_norm) and (src_norm in cand_norm or cand_norm in src_norm)
    if name_hit and dist_m is not None and dist_m <= 150:
        return (
            "match_existing",
            str(cand["id"]),
            f"Reopened: name evidence + distance {dist_m}m supports match to {cand['id']}.",
        )
    if dist_m is not None and dist_m <= 150 and not name_hit:
        return (
            "create_new",
            "",
            f"Nearby settlement {cand['id']} ({cand.get('canonical_name')}) at {dist_m}m has different name; "
            "do not merge by distance alone; create_new for valid MIMU village.",
        )
    return (
        "create_new",
        "",
        "No proven name identity with candidate; MIMU village remains valid → create_new.",
    )


def build_rejected(conn: psycopg.Connection) -> None:
    preview_dir = OUT / "02-rejected-review-previews"
    preview_dir.mkdir(parents=True, exist_ok=True)

    admin = load_csv(FROZEN_ADMIN)
    vill = load_csv(FROZEN_VILL)
    rejected_admin = [r for r in admin if r.get("action") == "reject_source_error"]
    rejected_vill = [r for r in vill if r.get("action") == "reject_source_error"]

    # Deduplicate ward source rows by pcode+row
    seen = set()
    uniq_admin = []
    for r in rejected_admin:
        key = (r["source_pcode"], r.get("source_row"))
        if key in seen:
            continue
        seen.add(key)
        uniq_admin.append(r)

    all_cand_ids: list[int] = []
    for r in uniq_admin:
        for part in (r.get("candidate_coremap_ids") or "").split(";"):
            part = part.strip()
            if part.isdigit():
                all_cand_ids.append(int(part))
    cores = admin_rows(conn, sorted(set(all_cand_ids)))
    deps = dependency_counts(conn, sorted(set(all_cand_ids)))

    admin_out = []
    uncertain_admin = 0
    for r in uniq_admin:
        pcode = r["source_pcode"]
        src_path = find_preview("ward", pcode)
        # prefer matching source_row in filename when duplicate previews
        if r.get("source_row"):
            specific = sorted(PREVIEWS.glob(f"ward_{pcode}_row{r['source_row']}_*.geojson"))
            if specific:
                src_path = specific[0]
        rel = copy_preview(src_path, preview_dir / "admin" / f"{pcode}_row{r.get('source_row')}.geojson")
        source_geom = None
        if src_path and src_path.exists():
            source_geom = json.loads(src_path.read_text(encoding="utf-8"))
            if source_geom.get("type") == "FeatureCollection":
                source_geom = source_geom["features"][0]
            geom = source_geom.get("geometry") if source_geom.get("type") == "Feature" else source_geom

        cand_details = []
        for part in (r.get("candidate_coremap_ids") or "").split(";"):
            part = part.strip()
            if not part.isdigit():
                continue
            cid = int(part)
            core = cores.get(cid)
            if not core:
                continue
            metrics = {"overlap_of_source": None, "overlap_of_core": None, "centroid_dist_m": None}
            if source_geom:
                g = source_geom["geometry"] if source_geom.get("type") == "Feature" else source_geom
                metrics = overlap_pair(conn, g, cid)
            # write candidate preview
            feat = {
                "type": "Feature",
                "properties": {
                    "core_id": cid,
                    "public_id": core["public_id"],
                    "canonical_name": core["canonical_name"],
                    "aliases": core["aliases"],
                    "parent_name": core["parent_name"],
                    **metrics,
                    **deps.get(cid, {}),
                },
                "geometry": core["geojson"],
            }
            (preview_dir / "admin" / f"{pcode}_cand_{cid}.geojson").write_text(
                json.dumps(feat), encoding="utf-8"
            )
            cand_details.append(
                {
                    "id": cid,
                    "public_id": core["public_id"],
                    "canonical_name": core["canonical_name"],
                    "aliases": core["aliases"],
                    "type": core["type_code"],
                    "parent_id": core["parent_id"],
                    "parent_name": core["parent_name"],
                    "hierarchy": f"{core.get('gparent_name')} > {core.get('parent_name')} > {core['canonical_name']}",
                    **metrics,
                    **deps.get(cid, {}),
                }
            )

        decision, chosen, reason = propose_ward_decision(cand_details)
        if decision == "manual_review":
            uncertain_admin += 1

        # combined overlay
        feats = []
        if src_path and src_path.exists():
            sg = json.loads(src_path.read_text(encoding="utf-8"))
            if sg.get("type") == "FeatureCollection":
                feats.extend(sg["features"])
            else:
                feats.append(sg if sg.get("type") == "Feature" else {"type": "Feature", "properties": {"role": "source"}, "geometry": sg})
        for c in cand_details:
            cp = preview_dir / "admin" / f"{pcode}_cand_{c['id']}.geojson"
            feats.append(json.loads(cp.read_text(encoding="utf-8")))
        (preview_dir / "admin" / f"{pcode}_overlay.geojson").write_text(
            json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8"
        )

        admin_out.append(
            {
                "source_entity_type": r.get("source_entity_type"),
                "source_pcode": pcode,
                "source_name_en": r.get("source_name_en"),
                "source_name_my": r.get("source_name_my"),
                "source_region": r.get("source_region"),
                "source_ts_pcode": r.get("source_ts_pcode"),
                "source_ts_name": r.get("source_ts_name"),
                "source_parent_path": r.get("source_parent_path"),
                "source_row": r.get("source_row"),
                "approved_township_id": r.get("approved_township_id"),
                "prior_action": r.get("action"),
                "prior_reason": r.get("manual_review_reason"),
                "candidate_coremap_ids": r.get("candidate_coremap_ids"),
                "candidate_detail": " || ".join(
                    f"{c['id']}/{c['public_id']}:{c['canonical_name']}"
                    f"(type={c['type']};om={c['overlap_of_source']};oc={c['overlap_of_core']};"
                    f"d={c['centroid_dist_m']};deps_child={c.get('child_admins')},settle={c.get('settlements')},postal={c.get('postal')})"
                    for c in cand_details
                ),
                "proposed_decision": decision,
                "proposed_match_core_id": chosen,
                "proposed_reason": reason,
                "requires_user_decision": "true" if decision == "manual_review" else "false",
                "preview_source": rel,
                "preview_overlay": f"02-rejected-review-previews/admin/{pcode}_overlay.geojson",
                "generated_at": utc_now(),
            }
        )

    # Villages
    vill_cand_ids: list[int] = []
    for r in rejected_vill:
        for part in (r.get("candidate_coremap_ids") or "").split(";,"):
            for bit in part.replace(",", ";").split(";"):
                bit = bit.strip()
                if bit.isdigit():
                    vill_cand_ids.append(int(bit))
    settles = settlement_deps(conn, sorted(set(vill_cand_ids)))

    vill_out = []
    uncertain_vill = 0
    for r in rejected_vill:
        pcode = r["source_pcode"]
        src_path = find_preview("village", pcode)
        rel = copy_preview(src_path, preview_dir / "village" / f"{pcode}.geojson")
        lon = float(r["source_lon"]) if r.get("source_lon") else None
        lat = float(r["source_lat"]) if r.get("source_lat") else None
        cand_id = None
        for bit in (r.get("candidate_coremap_ids") or "").replace(",", ";").split(";"):
            bit = bit.strip()
            if bit.isdigit():
                cand_id = int(bit)
                break
        cand = None
        dist = None
        if cand_id and cand_id in settles:
            s = settles[cand_id]
            cand = {"id": cand_id, **s}
            if lon is not None and lat is not None:
                dist = point_distance(conn, lon, lat, cand_id)
            # write candidate point geojson
            feat = {
                "type": "Feature",
                "properties": {
                    "settlement_id": cand_id,
                    "public_id": s["public_id"],
                    "canonical_name": s["canonical_name"],
                    "name_en": s["name_en"],
                    "name_mm": s["name_mm"],
                    "township_id": s["township_id"],
                    "township_name": s["township_name"],
                    "distance_m": dist,
                },
                "geometry": {"type": "Point", "coordinates": [s["lon"], s["lat"]]},
            }
            (preview_dir / "village" / f"{pcode}_cand_{cand_id}.geojson").write_text(
                json.dumps(feat), encoding="utf-8"
            )
            feats = []
            if src_path and src_path.exists():
                sg = json.loads(src_path.read_text(encoding="utf-8"))
                if sg.get("type") == "FeatureCollection":
                    feats.extend(sg["features"])
                else:
                    feats.append(sg)
            feats.append(feat)
            (preview_dir / "village" / f"{pcode}_overlay.geojson").write_text(
                json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8"
            )

        decision, chosen, reason = propose_village_decision(dist, cand, r.get("source_name_en") or "")
        if decision == "manual_review":
            uncertain_vill += 1

        vill_out.append(
            {
                "source_entity_type": r.get("source_entity_type"),
                "source_pcode": pcode,
                "source_name_en": r.get("source_name_en"),
                "source_name_my": r.get("source_name_my"),
                "source_region": r.get("source_region"),
                "source_ts_pcode": r.get("source_ts_pcode"),
                "source_ts_name": r.get("source_ts_name"),
                "source_vt_pcode": r.get("source_vt_pcode"),
                "source_vt_name": r.get("source_vt_name"),
                "source_parent_path": r.get("source_parent_path"),
                "source_lon": r.get("source_lon"),
                "source_lat": r.get("source_lat"),
                "approved_township_id": r.get("approved_township_id"),
                "prior_action": r.get("action"),
                "prior_reason": r.get("manual_review_reason"),
                "candidate_coremap_ids": r.get("candidate_coremap_ids"),
                "candidate_public_id": cand.get("public_id") if cand else "",
                "candidate_canonical_name": cand.get("canonical_name") if cand else "",
                "candidate_township_id": cand.get("township_id") if cand else "",
                "candidate_township_name": cand.get("township_name") if cand else "",
                "point_distance_m": dist if dist is not None else "",
                "spatial_evidence_prior": r.get("spatial_evidence"),
                "proposed_decision": decision,
                "proposed_match_core_id": chosen,
                "proposed_reason": reason,
                "requires_user_decision": "true" if decision == "manual_review" else "false",
                "preview_source": rel,
                "preview_overlay": f"02-rejected-review-previews/village/{pcode}_overlay.geojson",
                "generated_at": utc_now(),
            }
        )

    write_csv(OUT / "02-rejected-admin-review.csv", admin_out, list(admin_out[0].keys()) if admin_out else ["source_pcode"])
    write_csv(OUT / "02-rejected-village-review.csv", vill_out, list(vill_out[0].keys()) if vill_out else ["source_pcode"])

    admin_dec = Counter(r["proposed_decision"] for r in admin_out)
    vill_dec = Counter(r["proposed_decision"] for r in vill_out)

    md = f"""# 02 Rejected ambiguous rows — reopened review

Generated: `{utc_now()}`  
Database: disposable `coremap_phase7_backup_restore`  
Production: **not touched**

## Scope

| Set | Prior reject rows | Unique review rows |
|---|---:|---:|
| Wards (`reject_source_error`) | {len(rejected_admin)} | {len(uniq_admin)} |
| Villages (`reject_source_error`) | {len(rejected_vill)} | {len(vill_out)} |

Prior reject reason for wards was “multiple CoreMap rows share exact normalized name”.
That is **not** proof the MIMU source row is invalid.

Prior reject reason for villages was “spatial-only settlement candidate blocked”.
Distance alone is still not enough to merge; source villages are not automatically errors.

## Proposed decision tallies (pending your approval)

### Wards

| decision | count |
|---|---:|
"""
    for k, v in sorted(admin_dec.items()):
        md += f"| `{k}` | {v} |\n"
    md += "\n### Villages\n\n| decision | count |\n|---|---:|\n"
    for k, v in sorted(vill_dec.items()):
        md += f"| `{k}` | {v} |\n"

    md += f"""

## Uncertainty gate

- Ward rows still `manual_review`: **{uncertain_admin}**
- Village rows still `manual_review`: **{uncertain_vill}**
- Pangsang township identity: **manual_review** (see `01-pangsang-summary.md`)

**STOP:** revised manifests / postal rebuild / import scripts wait until you confirm decisions for:
1. `MMR015005` Pangsang township parent
2. any row marked `requires_user_decision=true` in the CSVs below
3. optional confirmation of automated reopen proposals (`match_existing` / `create_new` / `merge_confirmed_duplicate`)

## Artifacts

- `02-rejected-admin-review.csv`
- `02-rejected-village-review.csv`
- `02-rejected-review-previews/admin/*`
- `02-rejected-review-previews/village/*`

## Allowed final decisions (per your instruction)

`match_existing` | `create_new` | `keep_both` | `merge_confirmed_duplicate` | `reject_source_error`

Keep `reject_source_error` only when the MIMU record itself is proven invalid or duplicated.
"""
    (OUT / "02-rejected-review-summary.md").write_text(md, encoding="utf-8")

    gate = {
        "generated_at": utc_now(),
        "stop_for_user_decision": True,
        "pangsang_proposed": "manual_review",
        "rejected_admin_manual_review": uncertain_admin,
        "rejected_village_manual_review": uncertain_vill,
        "rejected_admin_proposals": dict(admin_dec),
        "rejected_village_proposals": dict(vill_dec),
        "next_blocked_steps": [
            "3 Build revised target manifests",
            "4 Rebuild postal reconciliation",
            "5 Generate revised import scripts",
            "6 Final disposable dry run",
            "7 Produce approval package v2",
        ],
    }
    (OUT / "00-STOP-FOR-DECISION.json").write_text(json.dumps(gate, indent=2), encoding="utf-8")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    if not MIMU_TS_GJ.exists():
        print("missing", MIMU_TS_GJ, file=sys.stderr)
        return 2
    with psycopg.connect(DB_URL) as conn:
        conn.execute("SET search_path TO core, ref, public")
        build_pangsang(conn)
        build_rejected(conn)
    print("OK wrote", OUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
