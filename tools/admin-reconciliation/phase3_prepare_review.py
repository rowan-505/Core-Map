#!/usr/bin/env python3
"""Phase 3: build CSV review queues + freeze certain Phase 2 actions.

Does not write to PostgreSQL. Does not create a review app or permanent tables.

Uncertain rows (manual_review, merge_duplicate_candidate, reject_source_error)
go into review CSVs with empty decision columns for human fill-in.

Certain Phase 2 actions are frozen immediately into approved manifests with
SHA-256 checksums. After review decisions are filled, run:

  python3 tools/admin-reconciliation/phase3_validate_and_freeze.py
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from osgeo import ogr

ogr.UseExceptions()
csv.field_size_limit(min(2**31 - 1, 100_000_000))

UNCERTAIN_ACTIONS = {"manual_review", "merge_duplicate_candidate", "reject_source_error"}
CERTAIN_ACTIONS = {
    "keep_existing",
    "update_names",
    "update_type",
    "update_parent",
    "update_names_and_type",
    "create_mimu_placeholder",
}

REVIEW_DECISIONS = {
    "match_existing",
    "create_new",
    "keep_both",
    "merge_confirmed_duplicate",
    "reject_source_error",
    "defer",
}

REVIEW_FIELDS = [
    "source_key",
    "entity_type",
    "source_name_mm",
    "source_name_en",
    "source_parent",
    "source_geometry_preview_path",
    "candidate_core_ids",
    "candidate_names",
    "candidate_parents",
    "candidate_types",
    "name_evidence",
    "overlap_percent",
    "distance_m",
    "dependency_counts",
    "recommended_action",
    "review_decision",
    "selected_core_id",
    "review_note",
]


def clean(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def load_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in fieldnames})


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_key(entity_type: str, source_pcode: str, source_row: str, source_file: str) -> str:
    # Stable audit key (not a CoreMap external_id).
    safe_file = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(clean(source_file)).name)[:80]
    return f"{entity_type}:{clean(source_pcode) or 'nopcode'}:row{clean(source_row)}:{safe_file}"


def parse_spatial(spatial_evidence: str) -> tuple[str, str]:
    """Return (overlap_percent_list, distance_m_list) from Phase 2 spatial_evidence."""
    overlaps: list[str] = []
    distances: list[str] = []
    for part in clean(spatial_evidence).split("|"):
        part = part.strip()
        if not part:
            continue
        # forms: id:overlap=0.123;dist_m=12.3   OR   id:239.3m
        m_over = re.search(r"overlap=([0-9.]+)", part)
        m_dist = re.search(r"dist_m=([0-9.]+)", part)
        m_dist2 = re.search(r":([0-9.]+)m\b", part)
        if m_over:
            overlaps.append(f"{float(m_over.group(1)) * 100:.1f}")
        if m_dist:
            distances.append(m_dist.group(1))
        elif m_dist2:
            distances.append(m_dist2.group(1))
    return ";".join(overlaps), ";".join(distances)


def load_admin_deps(path: Path) -> dict[int, dict[str, str]]:
    if not path.exists():
        return {}
    return {int(r["id"]): r for r in load_csv(path)}


def load_settlement_meta(path: Path) -> dict[int, dict[str, str]]:
    if not path.exists():
        return {}
    return {int(r["id"]): r for r in load_csv(path)}


def load_parents(path: Path) -> dict[int, dict[str, str]]:
    return {int(r["id"]): r for r in load_csv(path)}


def load_wvt(path: Path) -> dict[int, dict[str, str]]:
    return {int(r["id"]): r for r in load_csv(path)}


def load_settlements(path: Path) -> dict[int, dict[str, str]]:
    return {int(r["id"]): r for r in load_csv(path)}


def dependency_summary_admin(dep: dict[str, str] | None) -> str:
    if not dep:
        return "unknown"
    parts = [
        f"names={dep.get('names_count', '0')}",
        f"children={dep.get('child_admin_count', '0')}",
        f"places={dep.get('places_count', '0')}",
        f"addresses={dep.get('addresses_count', '0')}",
        f"streets={dep.get('streets_count', '0')}",
        f"buildings={dep.get('buildings_count', '0')}",
        f"postal_local={dep.get('postal_local_count', '0')}",
        f"saved_places={dep.get('saved_places_count', '0')}",
        f"geom_npoints={dep.get('geom_npoints', '0')}",
        f"area_m2={dep.get('area_m2', '0')}",
        f"verification={dep.get('verification_status', '')}",
    ]
    return "|".join(parts)


def dependency_summary_settlement(meta: dict[str, str] | None) -> str:
    if not meta:
        return "unknown"
    return "|".join([
        f"has_point={meta.get('has_point', '0')}",
        f"verification={meta.get('verification_status', '')}",
        f"is_verified={meta.get('is_verified', '')}",
        f"type={meta.get('settlement_type', '')}",
        "fk_inbound=0",  # no inbound FKs discovered on core_settlements
    ])


def total_deps_admin(dep: dict[str, str] | None) -> int:
    if not dep:
        return 0
    keys = [
        "names_count", "child_admin_count", "places_count", "addresses_count",
        "streets_count", "buildings_count", "postal_local_count", "saved_places_count",
    ]
    total = 0
    for key in keys:
        try:
            total += int(float(dep.get(key) or 0))
        except ValueError:
            pass
    return total


def recommend_survivor_admin(candidate_ids: list[int], deps: dict[int, dict[str, str]]) -> tuple[str, str]:
    if not candidate_ids:
        return "", "no_candidates"
    scored: list[tuple[tuple[Any, ...], int]] = []
    for cid in candidate_ids:
        d = deps.get(cid, {})
        verified = 1 if clean(d.get("verification_status")).lower() == "verified" else 0
        official = 1 if clean(d.get("is_official_boundary")).lower() in {"t", "true", "1"} else 0
        try:
            npoints = int(float(d.get("geom_npoints") or 0))
        except ValueError:
            npoints = 0
        try:
            area = int(float(d.get("area_m2") or 0))
        except ValueError:
            area = 0
        score = (
            verified,
            official,
            total_deps_admin(d),
            npoints,
            area,
            -cid,  # stable tie-break: lower id slightly preferred via sort reverse on last?
        )
        # Prefer higher verified/official/deps/geometry; then lower id.
        scored.append((score, cid))
    scored.sort(key=lambda x: (x[0][0], x[0][1], x[0][2], x[0][3], x[0][4], -x[1]), reverse=True)
    best = scored[0][1]
    reason = (
        f"prefer id={best} by verification/official/deps/geometry "
        f"(deps={total_deps_admin(deps.get(best))}, npoints={deps.get(best, {}).get('geom_npoints', '')})"
    )
    return str(best), reason


def recommend_survivor_settlement(
    candidate_ids: list[int],
    meta: dict[int, dict[str, str]],
    distances: list[float],
) -> tuple[str, str]:
    if not candidate_ids:
        return "", "no_candidates"
    dist_map = {}
    # spatial_evidence order may match candidate order loosely; use meta only primarily
    scored = []
    for cid in candidate_ids:
        m = meta.get(cid, {})
        verified = 1 if clean(m.get("is_verified")).lower() in {"t", "true", "1"} else 0
        if clean(m.get("verification_status")).lower() == "verified":
            verified = 1
        has_point = 1 if clean(m.get("has_point")) == "1" else 0
        name_strength = int(bool(clean(m.get("name_en")))) + int(bool(clean(m.get("name_mm"))))
        scored.append(((verified, has_point, name_strength, -cid), cid))
    scored.sort(reverse=True)
    best = scored[0][1]
    return str(best), f"prefer id={best} by verification/point/names (preserve survivor point)"


def index_boundary_features(path: Path) -> dict[str, list[ogr.Feature]]:
    """Map source_pcode -> features (cloned geometries stored as GeoJSON text)."""
    index: dict[str, list[dict[str, Any]]] = defaultdict(list)
    ds = ogr.Open(str(path))
    if ds is None:
        return {}
    layer = ds.GetLayer(0)
    row_i = 0
    for feat in layer:
        row_i += 1
        pcode = clean(feat.GetField("source_pcode"))
        geom = feat.GetGeometryRef()
        try:
            simple = geom.SimplifyPreserveTopology(0.0002) if geom is not None else None
        except Exception:
            simple = geom.Clone() if geom is not None else None
        index[pcode].append({
            "source_row": row_i,
            "name_en": clean(feat.GetField("name_en")),
            "name_my": clean(feat.GetField("name_my")),
            "geometry": json.loads(simple.ExportToJson()) if simple is not None else None,
        })
    ds = None
    return index


def write_preview_from_index(
    preview_dir: Path,
    key: str,
    entity_type: str,
    index: dict[str, list[dict[str, Any]]],
    source_pcode: str,
    source_row: str,
) -> str:
    preview_dir.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", key)[:120]
    out_path = preview_dir / f"{safe}.geojson"
    hits = index.get(clean(source_pcode), [])
    chosen = None
    if clean(source_row).isdigit():
        target = int(source_row)
        for hit in hits:
            if hit["source_row"] == target:
                chosen = hit
                break
    if chosen is None and hits:
        chosen = hits[0]
    props = {
        "source_pcode": clean(source_pcode),
        "entity_type": entity_type,
        "name_en": clean(chosen["name_en"]) if chosen else "",
        "name_my": clean(chosen["name_my"]) if chosen else "",
    }
    fc = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": props,
            "geometry": chosen["geometry"] if chosen else None,
        }],
    }
    out_path.write_text(json.dumps(fc, ensure_ascii=False), encoding="utf-8")
    return str(out_path)


def write_preview_point(preview_dir: Path, key: str, lon: str, lat: str, props: dict[str, str]) -> str:
    preview_dir.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", key)[:120]
    out_path = preview_dir / f"{safe}.geojson"
    try:
        lon_f = float(lon)
        lat_f = float(lat)
        geom = {"type": "Point", "coordinates": [lon_f, lat_f]}
    except ValueError:
        geom = None
    fc = {"type": "FeatureCollection", "features": [{
        "type": "Feature",
        "properties": props,
        "geometry": geom,
    }]}
    out_path.write_text(json.dumps(fc, ensure_ascii=False), encoding="utf-8")
    return str(out_path)


def build_local_review_rows(
    uncertain: list[dict[str, str]],
    deps: dict[int, dict[str, str]],
    wvts: dict[int, dict[str, str]],
    parents: dict[int, dict[str, str]],
    preview_dir: Path,
    ward_index: dict[str, list[dict[str, Any]]],
    vt_index: dict[str, list[dict[str, Any]]],
) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    rows: list[dict[str, str]] = []
    merge_plans: list[dict[str, str]] = []

    for r in uncertain:
        entity = clean(r["source_entity_type"])
        key = source_key(entity, r.get("source_pcode", ""), r.get("source_row", ""), r.get("source_file", ""))
        cand_ids = [int(x) for x in clean(r.get("candidate_coremap_ids")).split(";") if x.strip().isdigit()]
        names = []
        parent_labels = []
        types = []
        dep_parts = []
        for cid in cand_ids:
            w = wvts.get(cid, {})
            d = deps.get(cid, {})
            names.append(clean(d.get("canonical_name") or w.get("canonical_name")) or f"id:{cid}")
            parent_id = clean(d.get("parent_id") or w.get("parent_id"))
            parent = parents.get(int(parent_id), {}) if parent_id.isdigit() else {}
            parent_labels.append(clean(parent.get("canonical_name")) or parent_id or "")
            types.append(clean(d.get("admin_area_type") or w.get("admin_area_type")))
            dep_parts.append(f"{cid}:{{{dependency_summary_admin(d)}}}")

        overlap, distance = parse_spatial(r.get("spatial_evidence", ""))
        index = ward_index if entity == "ward" else vt_index
        preview_abs = write_preview_from_index(
            preview_dir, key, entity, index,
            clean(r.get("source_pcode")), clean(r.get("source_row")),
        )
        try:
            preview_rel = str(Path(preview_abs).resolve().relative_to(Path.cwd().resolve()))
        except Exception:
            preview_rel = preview_abs

        recommended = clean(r.get("action"))
        selected_hint = ""
        note = clean(r.get("manual_review_reason") or r.get("review_notes"))
        if recommended == "merge_duplicate_candidate":
            selected_hint, survivor_reason = recommend_survivor_admin(cand_ids, deps)
            note = (note + " | " if note else "") + survivor_reason
            losers = [str(i) for i in cand_ids if str(i) != selected_hint]
            merge_plans.append({
                "source_key": key,
                "entity_type": entity,
                "survivor_core_id": selected_hint,
                "duplicate_core_ids": ";".join(losers),
                "preserve_survivor_geometry": "true",
                "hard_delete": "false",
                "dependency_counts_survivor": dependency_summary_admin(deps.get(int(selected_hint))) if selected_hint else "",
                "dependency_counts_duplicates": "|".join(
                    f"{i}:{{{dependency_summary_admin(deps.get(int(i)))}}}" for i in losers
                ),
                "repoint_plan": (
                    "UPDATE referencing tables SET admin_area_id/local_admin_area_id/"
                    "parent_id FROM duplicate ids TO survivor; then soft-retire duplicates "
                    "(is_active=false / deleted_at) — never hard DELETE. Preserve survivor geom."
                ),
                "recommended_decision": "merge_confirmed_duplicate",
                "review_decision": "",
                "review_note": "",
            })

        rows.append({
            "source_key": key,
            "entity_type": entity,
            "source_name_mm": clean(r.get("source_name_my")),
            "source_name_en": clean(r.get("source_name_en")),
            "source_parent": clean(r.get("source_parent_path")),
            "source_geometry_preview_path": preview_rel,
            "candidate_core_ids": ";".join(str(i) for i in cand_ids),
            "candidate_names": " | ".join(names),
            "candidate_parents": " | ".join(parent_labels),
            "candidate_types": " | ".join(types),
            "name_evidence": clean(r.get("name_evidence")),
            "overlap_percent": overlap,
            "distance_m": distance,
            "dependency_counts": " || ".join(dep_parts),
            "recommended_action": recommended,
            "review_decision": "",
            "selected_core_id": selected_hint if recommended == "merge_duplicate_candidate" else "",
            "review_note": note,
        })
    return rows, merge_plans


def build_village_review_rows(
    uncertain: list[dict[str, str]],
    meta: dict[int, dict[str, str]],
    settlements: dict[int, dict[str, str]],
    parents: dict[int, dict[str, str]],
    preview_dir: Path,
) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    rows: list[dict[str, str]] = []
    merge_plans: list[dict[str, str]] = []
    for r in uncertain:
        key = source_key("village", r.get("source_pcode", ""), r.get("source_row", ""), r.get("source_file", ""))
        cand_ids = [int(x) for x in clean(r.get("candidate_coremap_ids")).split(";") if x.strip().isdigit()]
        names = []
        parent_labels = []
        types = []
        dep_parts = []
        for cid in cand_ids:
            s = settlements.get(cid, {})
            m = meta.get(cid, {})
            label = clean(m.get("canonical_name") or s.get("canonical_name")) or f"id:{cid}"
            en = clean(m.get("name_en") or s.get("name_en"))
            mm = clean(m.get("name_mm") or s.get("name_mm"))
            if en or mm:
                label = f"{label} [{en} / {mm}]"
            names.append(label)
            tsp_id = clean(m.get("township_id") or s.get("township_id"))
            parent = parents.get(int(tsp_id), {}) if tsp_id.isdigit() else {}
            parent_labels.append(clean(parent.get("canonical_name")) or tsp_id)
            types.append(clean(m.get("settlement_type") or s.get("settlement_type")))
            dep_parts.append(f"{cid}:{{{dependency_summary_settlement(m)}}}")

        overlap, distance = parse_spatial(r.get("spatial_evidence", ""))
        preview_abs = write_preview_point(
            preview_dir,
            key,
            clean(r.get("source_lon")),
            clean(r.get("source_lat")),
            {
                "source_pcode": clean(r.get("source_pcode")),
                "name_en": clean(r.get("source_name_en")),
                "name_my": clean(r.get("source_name_my")),
                "vt_name": clean(r.get("source_vt_name")),
            },
        )
        try:
            preview_rel = str(Path(preview_abs).resolve().relative_to(Path.cwd().resolve()))
        except Exception:
            preview_rel = preview_abs

        recommended = clean(r.get("action"))
        selected_hint = ""
        note = clean(r.get("manual_review_reason") or r.get("review_notes"))
        if recommended == "merge_duplicate_candidate":
            selected_hint, survivor_reason = recommend_survivor_settlement(cand_ids, meta, [])
            note = (note + " | " if note else "") + survivor_reason
            losers = [str(i) for i in cand_ids if str(i) != selected_hint]
            merge_plans.append({
                "source_key": key,
                "entity_type": "village",
                "survivor_core_id": selected_hint,
                "duplicate_core_ids": ";".join(losers),
                "preserve_survivor_geometry": "true",
                "hard_delete": "false",
                "dependency_counts_survivor": dependency_summary_settlement(meta.get(int(selected_hint))) if selected_hint else "",
                "dependency_counts_duplicates": "|".join(
                    f"{i}:{{{dependency_summary_settlement(meta.get(int(i)))}}}" for i in losers
                ),
                "repoint_plan": (
                    "No inbound FKs on core_settlements discovered. Soft-retire duplicate "
                    "settlements (deleted_at) after confirming identity; never hard DELETE. "
                    "Preserve survivor point_geom."
                ),
                "recommended_decision": "merge_confirmed_duplicate",
                "review_decision": "",
                "review_note": "",
            })

        rows.append({
            "source_key": key,
            "entity_type": "village",
            "source_name_mm": clean(r.get("source_name_my")),
            "source_name_en": clean(r.get("source_name_en")),
            "source_parent": clean(r.get("source_parent_path")),
            "source_geometry_preview_path": preview_rel,
            "candidate_core_ids": ";".join(str(i) for i in cand_ids),
            "candidate_names": " | ".join(names),
            "candidate_parents": " | ".join(parent_labels),
            "candidate_types": " | ".join(types),
            "name_evidence": clean(r.get("name_evidence")),
            "overlap_percent": overlap,
            "distance_m": distance,
            "dependency_counts": " || ".join(dep_parts),
            "recommended_action": recommended,
            "review_decision": "",
            "selected_core_id": selected_hint if recommended == "merge_duplicate_candidate" else "",
            "review_note": note,
        })
    return rows, merge_plans


def freeze_certain_manifests(
    local_actions: list[dict[str, str]],
    village_actions: list[dict[str, str]],
    out_dir: Path,
) -> dict[str, Any]:
    certain_local = [r for r in local_actions if clean(r.get("action")) in CERTAIN_ACTIONS]
    certain_villages = [r for r in village_actions if clean(r.get("action")) in CERTAIN_ACTIONS]
    uncertain_local = [r for r in local_actions if clean(r.get("action")) in UNCERTAIN_ACTIONS]
    uncertain_villages = [r for r in village_actions if clean(r.get("action")) in UNCERTAIN_ACTIONS]

    frozen_dir = out_dir / "phase3-frozen"
    frozen_dir.mkdir(parents=True, exist_ok=True)

    local_path = frozen_dir / "03-approved-local-admin.certain.csv"
    village_path = frozen_dir / "03-approved-villages.certain.csv"
    write_csv(local_path, certain_local, list(certain_local[0].keys()) if certain_local else ["action"])
    write_csv(village_path, certain_villages, list(certain_villages[0].keys()) if certain_villages else ["action"])

    checksums = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "production_writes": False,
        "note": (
            "Certain Phase 2 actions only. Uncertain rows remain in review queues until "
            "decisions are filled and phase3_validate_and_freeze.py succeeds."
        ),
        "files": {
            str(local_path.relative_to(out_dir)): {
                "sha256": sha256_file(local_path),
                "rows": len(certain_local),
            },
            str(village_path.relative_to(out_dir)): {
                "sha256": sha256_file(village_path),
                "rows": len(certain_villages),
            },
        },
        "counts": {
            "local_certain": len(certain_local),
            "local_uncertain_pending_review": len(uncertain_local),
            "village_certain": len(certain_villages),
            "village_uncertain_pending_review": len(uncertain_villages),
            "local_by_action": dict(Counter(r["action"] for r in certain_local)),
            "village_by_action": dict(Counter(r["action"] for r in certain_villages)),
            "wards_certain": sum(1 for r in certain_local if r.get("source_entity_type") == "ward"),
            "village_tracts_certain": sum(1 for r in certain_local if r.get("source_entity_type") == "village_tract"),
        },
    }
    checksum_path = frozen_dir / "03-approved-manifest.checksums.json"
    checksum_path.write_text(json.dumps(checksums, indent=2) + "\n", encoding="utf-8")
    return checksums


def write_workflow_doc(
    path: Path,
    local_n: int,
    village_n: int,
    merge_n: int,
    checksums: dict[str, Any],
) -> None:
    lines = [
        "# Phase 3 — CSV review workflow (no app, no DB tables)",
        "",
        f"**Generated:** {checksums.get('generated_at')}",
        "**Production writes:** none",
        "",
        "## What to fill",
        "",
        "1. `03-local-admin-review-queue.csv`",
        "2. `03-village-review-queue.csv`",
        "3. Optional: confirm/adjust `03-merge-repoint-plans.csv` for merge cases",
        "",
        "Leave geometry preview paths as-is. Fill:",
        "",
        "- `review_decision` — one of: `match_existing`, `create_new`, `keep_both`,",
        "  `merge_confirmed_duplicate`, `reject_source_error`, `defer`",
        "- `selected_core_id` — required for `match_existing` and `merge_confirmed_duplicate`",
        "- `review_note` — short reason",
        "",
        "## Decision rules",
        "",
        "- `defer` blocks production completion.",
        "- `keep_both` is allowed (extra CoreMap data is OK).",
        "- Merge only when identity is proven (`merge_confirmed_duplicate`).",
        "- Never hard-delete duplicates; use the repoint plan + soft-retire.",
        "- Survivor keeps CoreMap geometry/point.",
        "",
        f"Uncertain local-admin rows: **{local_n}**  ",
        f"Uncertain village rows: **{village_n}**  ",
        f"Merge repoint plans: **{merge_n}**",
        "",
        "## Already frozen (certain actions only)",
        "",
        "See `phase3-frozen/03-approved-*.certain.csv` and `03-approved-manifest.checksums.json`.",
        "",
        f"- Local certain rows: {checksums['counts']['local_certain']}",
        f"- Village certain rows: {checksums['counts']['village_certain']}",
        f"- Pending local review: {checksums['counts']['local_uncertain_pending_review']}",
        f"- Pending village review: {checksums['counts']['village_uncertain_pending_review']}",
        "",
        "## After decisions are filled",
        "",
        "```bash",
        "python3 tools/admin-reconciliation/phase3_validate_and_freeze.py",
        "```",
        "",
        "Validation checks:",
        "",
        "- every source ward / village_tract / village has one final action",
        "- no source maps to multiple CoreMap rows",
        "- no two create actions share the same identity",
        "- no unresolved `defer` remains",
        "",
        "On success, writes full frozen manifests + checksums under `phase3-frozen/`.",
        "",
        "## Stop line",
        "",
        "Phase 3 review CSVs prepared. No production writes.",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    repo = Path(__file__).resolve().parents[2]
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--out-dir", type=Path, default=repo / "reports/admin-reconciliation-v2")
    p.add_argument("--export-dir", type=Path, default=repo / "data/local/admin-reconciliation/phase2-export")
    p.add_argument("--phase3-export", type=Path, default=repo / "data/local/admin-reconciliation/phase3-export")
    p.add_argument("--preview-dir", type=Path, default=repo / "reports/admin-reconciliation-v2/phase3-previews")
    p.add_argument("--wards", type=Path, default=repo / "reports/admin-reconciliation-v2/01-wards-normalized.geojson")
    p.add_argument("--village-tracts", type=Path, default=repo / "reports/admin-reconciliation-v2/01-village-tracts-normalized.geojson")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    out = args.out_dir

    print("loading phase2 actions...", flush=True)
    local_actions = load_csv(out / "02-local-admin-actions.csv")
    village_actions = load_csv(out / "02-village-actions.csv")
    local_uncertain = [r for r in local_actions if clean(r.get("action")) in UNCERTAIN_ACTIONS]
    village_uncertain = [r for r in village_actions if clean(r.get("action")) in UNCERTAIN_ACTIONS]
    print(f"  uncertain local={len(local_uncertain)} village={len(village_uncertain)}", flush=True)

    print("loading dependency metadata...", flush=True)
    deps = load_admin_deps(args.phase3_export / "admin_candidate_deps.csv")
    sett_meta = load_settlement_meta(args.phase3_export / "settlement_candidate_meta.csv")
    parents = load_parents(args.export_dir / "admin_parents.csv")
    wvts = load_wvt(args.export_dir / "ward_village_tracts.csv")
    settlements = load_settlements(args.export_dir / "settlements.csv")

    print("indexing boundary sources for previews...", flush=True)
    ward_index = index_boundary_features(args.wards)
    vt_index = index_boundary_features(args.village_tracts)
    print(f"  ward_pcodes={len(ward_index)} vt_pcodes={len(vt_index)}", flush=True)

    print("building local review queue + previews...", flush=True)
    local_rows, local_merges = build_local_review_rows(
        local_uncertain, deps, wvts, parents, args.preview_dir, ward_index, vt_index,
    )
    print("building village review queue + previews...", flush=True)
    village_rows, village_merges = build_village_review_rows(
        village_uncertain, sett_meta, settlements, parents, args.preview_dir,
    )

    write_csv(out / "03-local-admin-review-queue.csv", local_rows, REVIEW_FIELDS)
    write_csv(out / "03-village-review-queue.csv", village_rows, REVIEW_FIELDS)
    merge_fields = [
        "source_key", "entity_type", "survivor_core_id", "duplicate_core_ids",
        "preserve_survivor_geometry", "hard_delete",
        "dependency_counts_survivor", "dependency_counts_duplicates",
        "repoint_plan", "recommended_decision", "review_decision", "review_note",
    ]
    write_csv(out / "03-merge-repoint-plans.csv", local_merges + village_merges, merge_fields)

    print("freezing certain manifests...", flush=True)
    checksums = freeze_certain_manifests(local_actions, village_actions, out)
    write_workflow_doc(
        out / "03-review-workflow.md",
        len(local_rows),
        len(village_rows),
        len(local_merges) + len(village_merges),
        checksums,
    )

    # Ensure previews are gitignored (large).
    gitignore = Path(".gitignore")
    marker = "reports/admin-reconciliation-v2/phase3-previews/"
    if gitignore.exists() and marker not in gitignore.read_text():
        with gitignore.open("a", encoding="utf-8") as handle:
            handle.write("\n# Phase 3 geometry previews (regenerate via tools script)\n")
            handle.write(f"{marker}\n")

    print(
        f"done review_local={len(local_rows)} review_village={len(village_rows)} "
        f"merges={len(local_merges)+len(village_merges)} "
        f"certain_local={checksums['counts']['local_certain']} "
        f"certain_village={checksums['counts']['village_certain']}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
