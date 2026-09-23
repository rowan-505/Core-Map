#!/usr/bin/env python3
"""Local undecided → create_new + clip overlapping CoreMap (preview only).

For each undecided Local admin row:
  - Write create_new decision (queue stays immutable).
  - Build clip plan: CoreMap geom − MIMU geom (shapely), no DB write.
  - Write GeoJSON previews so the Phase 3 viewer can show:
      orange = MIMU (new)
      gray outline = CoreMap before
      green fill = CoreMap after clip (remaining)

Requires: tools/admin-reconciliation/.venv-geom (shapely).
"""

from __future__ import annotations

import csv
import json
import math
import re
import tempfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from shapely.geometry import mapping, shape
from shapely.ops import unary_union
from shapely.validation import make_valid

REPO = Path(__file__).resolve().parents[2]
REPORTS = REPO / "reports" / "admin-reconciliation-v2"
EXPORT = REPO / "data" / "local" / "admin-reconciliation" / "phase2-export"
PREVIEW_DIR = REPORTS / "phase3-clip-previews"

DECISION_HEADERS = [
    "review_id",
    "source_key",
    "review_decision",
    "selected_core_id",
    "losing_core_ids",
    "name_source",
    "geometry_policy",
    "review_note",
    "updated_at",
]

CLIP_HEADERS = [
    "source_key",
    "entity_type",
    "mimu_name_mm",
    "mimu_name_en",
    "core_id",
    "overlap_percent_queue",
    "distance_m_queue",
    "area_m2_core_before",
    "area_m2_mimu",
    "area_m2_intersection",
    "area_m2_core_after",
    "area_m2_removed",
    "removed_pct_of_core",
    "status",
    "preview_path",
    "review_note",
]


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def load_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def atomic_write_csv(path: Path, rows: list[dict[str, str]], headers: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    tmp = Path(tmp_name)
    try:
        with open(fd, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=headers, extrasaction="ignore")
            w.writeheader()
            for row in rows:
                w.writerow({h: row.get(h, "") for h in headers})
        tmp.replace(path)
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)


def normalize_decision(row: dict[str, str]) -> dict[str, str]:
    return {
        "review_id": row.get("review_id") or row.get("source_key") or "",
        "source_key": row.get("source_key") or row.get("review_id") or "",
        "review_decision": row.get("review_decision") or "",
        "selected_core_id": row.get("selected_core_id") or "",
        "losing_core_ids": row.get("losing_core_ids") or "",
        "name_source": row.get("name_source") or "",
        "geometry_policy": row.get("geometry_policy") or "",
        "review_note": row.get("review_note") or "",
        "updated_at": row.get("updated_at") or "",
    }


def safe_name(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", s)[:120]


def resolve_preview(raw: str) -> Path | None:
    if not raw:
        return None
    candidates = [
        REPO / raw,
        REPO / f"{raw}.geojson",
        REPORTS / "phase3-previews" / Path(raw).name,
        REPORTS / "phase3-previews" / f"{Path(raw).name}.geojson",
    ]
    for c in candidates:
        if c.exists():
            return c
    return None


def load_fc_geom(path: Path):
    data = json.loads(path.read_text(encoding="utf-8"))
    geoms = []
    if data.get("type") == "FeatureCollection":
        for f in data.get("features") or []:
            g = f.get("geometry")
            if g:
                geoms.append(make_valid(shape(g)))
    elif data.get("type") == "Feature":
        g = data.get("geometry")
        if g:
            geoms.append(make_valid(shape(g)))
    else:
        geoms.append(make_valid(shape(data)))
    geoms = [g for g in geoms if not g.is_empty]
    if not geoms:
        return None
    return unary_union(geoms) if len(geoms) > 1 else geoms[0]


def load_core_geoms() -> dict[str, object]:
    out: dict[str, object] = {}
    path = EXPORT / "ward_village_tracts.csv"
    for row in load_csv(path):
        cid = row.get("id") or ""
        raw = row.get("geom_geojson") or ""
        if not cid or not raw:
            continue
        try:
            g = make_valid(shape(json.loads(raw)))
            if not g.is_empty:
                out[cid] = g
        except (json.JSONDecodeError, ValueError, TypeError):
            continue
    return out


def area_m2(geom) -> float:
    """Approximate geodesic area via equal-area-ish local projection (WGS84 meters)."""
    if geom is None or geom.is_empty:
        return 0.0
    # Use shapely geodesic if available (2.x), else planar approx at centroid.
    try:
        from shapely import area as shapely_area  # noqa: F401

        # geographic CRS area is wrong in degrees² — use azimuthal equidistant around centroid
    except Exception:
        pass
    c = geom.centroid
    lon0, lat0 = c.x, c.y
    # meters per degree at lat0
    m_lat = 111_320.0
    m_lon = 111_320.0 * max(0.01, math.cos(math.radians(lat0)))

    def project(x, y):
        return ((x - lon0) * m_lon, (y - lat0) * m_lat)

    def project_coords(coords):
        if not coords:
            return coords
        if isinstance(coords[0], (int, float)):
            return project(coords[0], coords[1])
        return [project_coords(c) for c in coords]

    gj = mapping(geom)
    from shapely.geometry import shape as shape2

    projected = {
        "type": gj["type"],
        "coordinates": project_coords(gj["coordinates"]),
    }
    try:
        return float(shape2(projected).area)
    except Exception:
        return 0.0


def main() -> int:
    queue = load_csv(REPORTS / "03-local-admin-review-queue.csv")
    dec_path = REPORTS / "03-local-admin-decisions.csv"
    decisions = {
        normalize_decision(r)["review_id"]: normalize_decision(r) for r in load_csv(dec_path)
    }

    undecided = [
        r
        for r in queue
        if r.get("source_key")
        and not decisions.get(r["source_key"], {}).get("review_decision")
    ]
    print(f"Undecided local rows: {len(undecided)}")
    if not undecided:
        print("Nothing to do.")
        return 0

    print("Loading CoreMap WVT geometries…")
    core_geoms = load_core_geoms()
    print(f"  loaded {len(core_geoms)}")

    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    ts = now_iso()
    clip_rows: list[dict[str, str]] = []
    # Accumulate MIMU clippers per core id for a combined after-view
    mimu_by_core: dict[str, list] = defaultdict(list)

    for row in undecided:
        key = row["source_key"]
        core_id = (row.get("candidate_core_ids") or "").split(";")[0].strip()
        note = (
            f"create_new + clip CoreMap {core_id}: keep existing row, "
            f"subtract MIMU overlap from CoreMap polygon (preview only; no DB write)"
        )
        decisions[key] = {
            "review_id": key,
            "source_key": key,
            "review_decision": "create_new",
            "selected_core_id": "",
            "losing_core_ids": "",
            "name_source": "",
            "geometry_policy": "",
            "review_note": note,
            "updated_at": ts,
        }

        status = "ok"
        preview_rel = ""
        a_core = a_mimu = a_inter = a_after = a_removed = 0.0

        preview_src = resolve_preview(row.get("source_geometry_preview_path") or "")
        core_g = core_geoms.get(core_id)
        mimu_g = load_fc_geom(preview_src) if preview_src else None

        if not core_id:
            status = "error_no_core_id"
        elif core_g is None:
            status = "error_core_geom_missing"
        elif mimu_g is None:
            status = "error_mimu_preview_missing"
        else:
            try:
                inter = make_valid(core_g.intersection(mimu_g))
                after = make_valid(core_g.difference(mimu_g))
                a_core = area_m2(core_g)
                a_mimu = area_m2(mimu_g)
                a_inter = area_m2(inter)
                a_after = area_m2(after)
                a_removed = max(0.0, a_core - a_after)
                if after.is_empty:
                    status = "warn_core_empty_after_clip"
                mimu_by_core[core_id].append(mimu_g)

                fname = f"clip_{safe_name(row.get('source_name_en') or key)}_{core_id}.geojson"
                out_path = PREVIEW_DIR / fname
                fc = {
                    "type": "FeatureCollection",
                    "features": [
                        {
                            "type": "Feature",
                            "properties": {
                                "role": "mimu_new",
                                "label": "MIMU new",
                                "source_key": key,
                                "name_en": row.get("source_name_en") or "",
                                "name_mm": row.get("source_name_mm") or "",
                            },
                            "geometry": mapping(mimu_g),
                        },
                        {
                            "type": "Feature",
                            "properties": {
                                "role": "core_before",
                                "label": f"CoreMap {core_id} before",
                                "core_id": core_id,
                            },
                            "geometry": mapping(core_g),
                        },
                        {
                            "type": "Feature",
                            "properties": {
                                "role": "core_after",
                                "label": f"CoreMap {core_id} after clip",
                                "core_id": core_id,
                            },
                            "geometry": mapping(after) if not after.is_empty else None,
                        },
                        {
                            "type": "Feature",
                            "properties": {
                                "role": "intersection",
                                "label": "Overlap removed",
                                "core_id": core_id,
                            },
                            "geometry": mapping(inter) if not inter.is_empty else None,
                        },
                    ],
                }
                # drop null geometries
                fc["features"] = [f for f in fc["features"] if f.get("geometry")]
                out_path.write_text(json.dumps(fc), encoding="utf-8")
                preview_rel = str(out_path.relative_to(REPO))
            except Exception as exc:  # noqa: BLE001
                status = f"error_geom:{type(exc).__name__}"

        removed_pct = (100.0 * a_removed / a_core) if a_core > 0 else 0.0
        clip_rows.append(
            {
                "source_key": key,
                "entity_type": row.get("entity_type") or "",
                "mimu_name_mm": row.get("source_name_mm") or "",
                "mimu_name_en": row.get("source_name_en") or "",
                "core_id": core_id,
                "overlap_percent_queue": row.get("overlap_percent") or "",
                "distance_m_queue": row.get("distance_m") or "",
                "area_m2_core_before": f"{a_core:.1f}",
                "area_m2_mimu": f"{a_mimu:.1f}",
                "area_m2_intersection": f"{a_inter:.1f}",
                "area_m2_core_after": f"{a_after:.1f}",
                "area_m2_removed": f"{a_removed:.1f}",
                "removed_pct_of_core": f"{removed_pct:.2f}",
                "status": status,
                "preview_path": preview_rel,
                "review_note": note,
            }
        )
        # Attach preview path into decision note for the viewer API
        if preview_rel:
            decisions[key]["review_note"] = f"{note} | clip_preview={preview_rel}"

    # Combined after-clip per CoreMap id (all MIMUs subtracted together)
    for core_id, mimus in mimu_by_core.items():
        core_g = core_geoms.get(core_id)
        if core_g is None:
            continue
        clipper = unary_union(mimus)
        after = make_valid(core_g.difference(clipper))
        out_path = PREVIEW_DIR / f"clip_COMBINED_core_{core_id}.geojson"
        fc = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"role": "core_before", "core_id": core_id, "label": "before"},
                    "geometry": mapping(core_g),
                },
                {
                    "type": "Feature",
                    "properties": {
                        "role": "mimu_union",
                        "core_id": core_id,
                        "label": f"all new MIMU ({len(mimus)})",
                    },
                    "geometry": mapping(clipper),
                },
                {
                    "type": "Feature",
                    "properties": {
                        "role": "core_after",
                        "core_id": core_id,
                        "label": "after all clips",
                    },
                    "geometry": mapping(after) if not after.is_empty else None,
                },
            ],
        }
        fc["features"] = [f for f in fc["features"] if f.get("geometry")]
        out_path.write_text(json.dumps(fc), encoding="utf-8")

    atomic_write_csv(dec_path, list(decisions.values()), DECISION_HEADERS)
    clip_path = REPORTS / "03-local-create-new-clip-plan.csv"
    atomic_write_csv(clip_path, clip_rows, CLIP_HEADERS)

    ok = sum(1 for r in clip_rows if r["status"] == "ok")
    warn = sum(1 for r in clip_rows if r["status"].startswith("warn"))
    err = len(clip_rows) - ok - warn
    md = [
        "# Local create_new + CoreMap clip (preview)",
        "",
        f"**Generated:** {ts}",
        "",
        "## Policy",
        "",
        "- Undecided Local rows → `create_new` (MIMU becomes new CoreMap later).",
        "- Existing CoreMap id is **kept** (not deleted).",
        "- Preview only: `core_after = core_before − MIMU` (no database write).",
        "",
        "## Counts",
        "",
        f"- Decisions written: **{len(clip_rows)}**",
        f"- Clip preview ok: **{ok}**",
        f"- Warn: **{warn}**",
        f"- Error: **{err}**",
        "",
        "## How to view",
        "",
        "1. Open Phase 3 viewer → **Local** tab.",
        "2. Uncheck **undecided only** (these are now `create_new`).",
        "3. Filter / search the place name.",
        "4. Turn on **Clip preview** on the map (MIMU orange, CoreMap before gray, after green).",
        "",
        f"Previews folder: `{PREVIEW_DIR.relative_to(REPO)}`",
        f"Plan CSV: `{clip_path.relative_to(REPO)}`",
        "",
    ]
    (REPORTS / "03-local-create-new-clip.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print(f"Wrote {len(clip_rows)} create_new decisions")
    print(f"Clip plan: {clip_path}")
    print(f"ok={ok} warn={warn} err={err}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
