#!/usr/bin/env python3
"""Auto-decide Phase 3 merge plans (CoreMap duplicates).

Policy (per undecided merge plan):
  1. Survivor = CoreMap candidate nearest to MIMU (linked queue distance_m /
     overlap, with geometry centroid fallback).
  2. Losers = all other CoreMap ids in the plan → merge_confirmed_duplicate.
  3. Linked Local/Village row (same source_key), only if still undecided:
       - If MIMU naming is clearly more complete → selective_merge
         (name_source=mimu, geometry_policy=coremap).
       - Else → match_existing (keep CoreMap name + geometry).
     Already-decided linked rows are left unchanged.

Writes only decision CSVs. Queue CSVs stay immutable. No database writes.
"""

from __future__ import annotations

import csv
import json
import math
import re
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
REPORTS = REPO / "reports" / "admin-reconciliation-v2"
EXPORT = REPO / "data" / "local" / "admin-reconciliation" / "phase2-export"

HEADERS = [
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


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def load_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def atomic_write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    tmp = Path(tmp_name)
    try:
        with open(fd, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=HEADERS, extrasaction="ignore")
            w.writeheader()
            for row in rows:
                w.writerow({h: row.get(h, "") for h in HEADERS})
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


def split_semi(raw: str) -> list[str]:
    return [x.strip() for x in (raw or "").split(";") if x.strip()]


def split_pipe(raw: str) -> list[str]:
    return [x.strip() for x in (raw or "").split("|") if x.strip() or True]


def parse_floats(raw: str, n: int) -> list[float | None]:
    parts = (raw or "").split(";")
    out: list[float | None] = []
    for i in range(n):
        try:
            out.append(float(parts[i].strip()))
        except (IndexError, ValueError):
            out.append(None)
    return out


def parse_cand_name(chunk: str) -> tuple[str, str]:
    chunk = (chunk or "").strip()
    m = re.match(r"^(.*?)\s*\[(.*?)\s*/\s*(.*)\]\s*$", chunk)
    if m:
        return m.group(3).strip(), m.group(2).strip()  # mm, en
    return chunk, ""


def name_score(mm: str, en: str) -> float:
    mm = (mm or "").strip()
    en = (en or "").strip()
    s = 0.0
    if mm:
        s += 3.0
    if en:
        s += 3.0
    if en and re.search(r"[A-Za-z]", en):
        s += 1.0
    if mm and re.search(r"[\u1000-\u109F]", mm):
        s += 1.0
    s += min(len(mm), 50) / 50.0
    s += min(len(en), 50) / 50.0
    low = f"{mm} {en}".lower()
    for bad in ("unnamed", "unknown", "null", "n/a", "no name"):
        if bad in low:
            s -= 3.0
    return s


def haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def centroid_of_coords(coords) -> tuple[float, float] | None:
    """Average lon/lat of the first ring / point list (good enough for ranking)."""
    if not coords:
        return None
    # Point
    if isinstance(coords[0], (int, float)):
        return float(coords[0]), float(coords[1])
    # Ring or Multi
    flat: list[tuple[float, float]] = []

    def walk(c):
        if not c:
            return
        if isinstance(c[0], (int, float)) and len(c) >= 2:
            flat.append((float(c[0]), float(c[1])))
            return
        for x in c:
            walk(x)

    walk(coords)
    if not flat:
        return None
    lon = sum(p[0] for p in flat) / len(flat)
    lat = sum(p[1] for p in flat) / len(flat)
    return lon, lat


def geom_centroid(geom: dict) -> tuple[float, float] | None:
    if not geom:
        return None
    t = geom.get("type")
    c = geom.get("coordinates")
    if t == "GeometryCollection":
        for g in geom.get("geometries") or []:
            pt = geom_centroid(g)
            if pt:
                return pt
        return None
    return centroid_of_coords(c)


def load_preview_centroid(preview_path: str) -> tuple[float, float] | None:
    if not preview_path:
        return None
    path = REPO / preview_path
    if not path.exists():
        alt = Path(str(path) + ".geojson")
        path = alt if alt.exists() else path
    if not path.exists():
        # basename search in phase3-previews
        base = Path(preview_path).name
        preview_dir = REPORTS / "phase3-previews"
        cand = preview_dir / base
        if not cand.exists():
            cand = preview_dir / f"{base}.geojson"
        path = cand
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if data.get("type") == "FeatureCollection":
        for feat in data.get("features") or []:
            pt = geom_centroid(feat.get("geometry") or {})
            if pt:
                return pt
    if data.get("type") == "Feature":
        return geom_centroid(data.get("geometry") or {})
    return geom_centroid(data)


def load_core_centroids() -> dict[str, tuple[float, float]]:
    out: dict[str, tuple[float, float]] = {}
    wvt = EXPORT / "ward_village_tracts.csv"
    if wvt.exists():
        for row in load_csv(wvt):
            cid = row.get("id") or ""
            if not cid:
                continue
            try:
                lon = float(row["pos_lon"])
                lat = float(row["pos_lat"])
                out[cid] = (lon, lat)
                continue
            except (KeyError, ValueError, TypeError):
                pass
            raw = row.get("geom_geojson") or ""
            if not raw:
                continue
            try:
                pt = geom_centroid(json.loads(raw))
                if pt:
                    out[cid] = pt
            except json.JSONDecodeError:
                continue
    settlements = EXPORT / "settlements.csv"
    if settlements.exists():
        for row in load_csv(settlements):
            cid = row.get("id") or ""
            if not cid or cid in out:
                continue
            try:
                out[cid] = (float(row["lon"]), float(row["lat"]))
            except (KeyError, ValueError, TypeError):
                continue
    return out


def pick_survivor(
    plan_ids: list[str],
    link: dict[str, str] | None,
    core_centroids: dict[str, tuple[float, float]],
) -> tuple[str, list[str], str]:
    """Return (survivor_id, loser_ids, method_note)."""
    if not plan_ids:
        return "", [], "empty"
    if len(plan_ids) == 1:
        return plan_ids[0], [], "single"

    dist_by_id: dict[str, float] = {}
    method = "plan_order"

    if link:
        link_ids = split_semi(link.get("candidate_core_ids") or "")
        dists = parse_floats(link.get("distance_m") or "", len(link_ids))
        overlaps = parse_floats(link.get("overlap_percent") or "", len(link_ids))
        for i, cid in enumerate(link_ids):
            if cid not in plan_ids:
                continue
            d = dists[i]
            o = overlaps[i]
            if d is not None:
                dist_by_id[cid] = d
            elif o is not None:
                # higher overlap = nearer; invert for min-distance ranking
                dist_by_id[cid] = 100.0 - o
        if dist_by_id:
            method = "linked_distance_or_overlap"

    # If missing ids or all equal distances, use centroid distance to MIMU preview.
    values = list(dist_by_id.values())
    need_geom = len(dist_by_id) < len(plan_ids) or (
        values and max(values) - min(values) < 1e-6
    )
    if need_geom and link:
        mimu_pt = load_preview_centroid(link.get("source_geometry_preview_path") or "")
        if mimu_pt:
            for cid in plan_ids:
                cpt = core_centroids.get(cid)
                if not cpt:
                    continue
                dist_by_id[cid] = haversine_m(mimu_pt[0], mimu_pt[1], cpt[0], cpt[1])
            if any(cid in dist_by_id for cid in plan_ids):
                method = "centroid_to_mimu"

    if not any(cid in dist_by_id for cid in plan_ids):
        # Fall back to recommended survivor in plan (first id).
        survivor = plan_ids[0]
        losers = [x for x in plan_ids if x != survivor]
        return survivor, losers, "fallback_plan_survivor"

    survivor = min(plan_ids, key=lambda cid: (dist_by_id.get(cid, 1e18), plan_ids.index(cid)))
    losers = [x for x in plan_ids if x != survivor]
    return survivor, losers, method


def choose_linked_decision(
    link: dict[str, str],
    survivor: str,
) -> tuple[str, str, str, str]:
    """Return decision, name_source, geometry_policy, note_suffix."""
    ids = split_semi(link.get("candidate_core_ids") or "")
    names = [x.strip() for x in (link.get("candidate_names") or "").split("|")]
    mm_c, en_c = "", ""
    if survivor in ids:
        i = ids.index(survivor)
        if i < len(names):
            mm_c, en_c = parse_cand_name(names[i])
    sm = name_score(link.get("source_name_mm") or "", link.get("source_name_en") or "")
    sc = name_score(mm_c, en_c)
    if sm > sc + 0.25:
        return (
            "selective_merge",
            "mimu",
            "coremap",
            f"mimu_name_better({sm:.2f}>{sc:.2f})",
        )
    return "match_existing", "", "", f"keep_coremap_name({sc:.2f}>={sm:.2f})"


def main() -> int:
    merge_plans = load_csv(REPORTS / "03-merge-repoint-plans.csv")
    local_q = {r["source_key"]: r for r in load_csv(REPORTS / "03-local-admin-review-queue.csv")}
    village_q = {r["source_key"]: r for r in load_csv(REPORTS / "03-village-review-queue.csv")}

    merge_dec_path = REPORTS / "03-merge-decisions.csv"
    local_dec_path = REPORTS / "03-local-admin-decisions.csv"
    village_dec_path = REPORTS / "03-village-decisions.csv"

    merge_dec = {normalize_decision(r)["review_id"]: normalize_decision(r) for r in load_csv(merge_dec_path)}
    local_dec = {normalize_decision(r)["review_id"]: normalize_decision(r) for r in load_csv(local_dec_path)}
    village_dec = {
        normalize_decision(r)["review_id"]: normalize_decision(r) for r in load_csv(village_dec_path)
    }

    print("Loading CoreMap centroids…")
    core_centroids = load_core_centroids()
    print(f"  centroids: {len(core_centroids)}")

    stats: Counter[str] = Counter()
    ts = now_iso()
    examples: list[str] = []

    for plan in merge_plans:
        key = plan.get("source_key") or ""
        if not key:
            stats["skip_no_key"] += 1
            continue
        if merge_dec.get(key, {}).get("review_decision"):
            stats["skip_already_decided"] += 1
            continue

        plan_ids = [plan.get("survivor_core_id") or ""] + split_semi(plan.get("duplicate_core_ids") or "")
        plan_ids = [x for x in plan_ids if x]
        # unique preserve order
        seen: set[str] = set()
        ordered: list[str] = []
        for cid in plan_ids:
            if cid not in seen:
                seen.add(cid)
                ordered.append(cid)
        plan_ids = ordered

        if len(plan_ids) < 2:
            stats["skip_lt2"] += 1
            continue

        link = local_q.get(key) or village_q.get(key)
        link_queue = "local" if key in local_q else ("village" if key in village_q else "")

        survivor, losers, method = pick_survivor(plan_ids, link, core_centroids)
        if not survivor or not losers:
            stats["skip_pick_failed"] += 1
            continue

        merge_note = (
            f"auto: nearest_to_mimu survivor={survivor} losers={';'.join(losers)} "
            f"method={method}"
        )
        merge_dec[key] = {
            "review_id": key,
            "source_key": key,
            "review_decision": "merge_confirmed_duplicate",
            "selected_core_id": survivor,
            "losing_core_ids": ";".join(losers),
            "name_source": "",
            "geometry_policy": "",
            "review_note": merge_note,
            "updated_at": ts,
        }
        stats["merge_written"] += 1
        stats[f"method_{method}"] += 1

        # Linked MIMU row
        if not link or not link_queue:
            stats["linked_missing"] += 1
        else:
            linked_map = local_dec if link_queue == "local" else village_dec
            existing = linked_map.get(key, {})
            if existing.get("review_decision"):
                stats["linked_kept_existing"] += 1
            else:
                decision, name_src, geom_pol, suffix = choose_linked_decision(link, survivor)
                linked_map[key] = {
                    "review_id": key,
                    "source_key": key,
                    "review_decision": decision,
                    "selected_core_id": survivor,
                    "losing_core_ids": "",
                    "name_source": name_src,
                    "geometry_policy": geom_pol,
                    "review_note": f"auto: after_merge_nearest {suffix} survivor={survivor}",
                    "updated_at": ts,
                }
                stats[f"linked_{decision}"] += 1

        if len(examples) < 12:
            examples.append(
                f"- `{key[:60]}…` survivor={survivor} losers={','.join(losers)} via {method}"
            )

    atomic_write_csv(merge_dec_path, list(merge_dec.values()))
    atomic_write_csv(local_dec_path, list(local_dec.values()))
    atomic_write_csv(village_dec_path, list(village_dec.values()))

    lines = [
        "# Phase 3 — auto merge nearest to MIMU",
        "",
        f"**Generated:** {ts}",
        "",
        "## Policy",
        "",
        "1. Survivor = CoreMap nearest to MIMU.",
        "2. Other CoreMaps in the plan = losers (`merge_confirmed_duplicate`).",
        "3. Linked Local/Village if undecided:",
        "   - MIMU naming more complete → `selective_merge` (name=mimu, geom=coremap)",
        "   - else → `match_existing` (keep CoreMap data)",
        "4. Already-decided linked rows are not changed.",
        "",
        "## Counts",
        "",
    ]
    for k, v in sorted(stats.items()):
        lines.append(f"- `{k}`: **{v}**")
    lines.extend(["", "## Examples", ""])
    lines.extend(examples or ["- (none)"])
    lines.append("")
    out = REPORTS / "03-auto-merge-nearest.md"
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(f"{k}: {v}" for k, v in sorted(stats.items())))
    print(f"Wrote {merge_dec_path}")
    print(f"Wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
