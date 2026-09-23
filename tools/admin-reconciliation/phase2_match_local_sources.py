#!/usr/bin/env python3
"""Phase 2 read-only local-admin / village matching.

Requires Phase 1 normalized outputs and a Phase 2 CoreMap export snapshot.
Does not connect to PostgreSQL and never writes to the database.

Township map is approved first. Child matching runs only for source townships
that resolve to exactly one CoreMap township.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from osgeo import ogr, osr

ogr.UseExceptions()
osr.UseExceptions()
csv.field_size_limit(min(2**31 - 1, 100_000_000))

MYANMAR_RE = re.compile(r"[\u1000-\u109f\uaa60-\uaa7f\ua9e0-\ua9ff]")

# Max point-on-surface / point distance (metres) for spatial support.
POS_DISTANCE_M = 2500.0
POINT_DISTANCE_M = 1500.0
# Minimum intersection-over-union / overlap fraction for polygon support.
MIN_OVERLAP = 0.05

ACTIONS = {
    "keep_existing",
    "update_names",
    "update_type",
    "update_parent",
    "update_names_and_type",
    "merge_duplicate_candidate",
    "create_mimu_placeholder",
    "manual_review",
    "reject_source_error",
}


def clean(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def boolish(value: Any) -> bool:
    return clean(value).lower() in {"1", "true", "t", "yes", "y"}


def compact_name(value: Any, level: str = "") -> str:
    text = clean(value)
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text).casefold()
    text = (
        text.replace("nay pyi taw", "naypyitaw")
        .replace("ayeyawady", "ayeyarwady")
        .replace("irrawaddy", "ayeyarwady")
    )
    suffixes = [
        r"\bunion territory\b",
        r"\bstate\b",
        r"\bregion\b",
        r"\bdistrict\b",
        r"\btownship\b",
        r"\btown\b",
        r"\bquarter\b",
        r"\bward\b",
        r"\bvillage[ -]?tract\b",
        r"\bself[ -]?administered (?:zone|division)\b",
        "ပြည်ထောင်စုနယ်မြေ",
        "တိုင်းဒေသကြီး",
        "ပြည်နယ်",
        "ခရိုင်",
        "မြို့နယ်",
        "ကျေးရွာအုပ်စု",
        "ရပ်ကွက်",
        "မြို့",
    ]
    for suffix in suffixes:
        text = re.sub(suffix, " ", text)
    text = re.sub(r"\b(?:no|number)\s*[.(]?\s*([0-9]+)\s*[).]?", r"\1", text)
    text = text.replace("အမှတ်", "")
    # Drop East/West/North/South qualifiers for state tokens only.
    if level == "state_region":
        text = re.sub(r"\b(east|west|north|south)\b", " ", text)
    text = re.sub(r"[^0-9a-z\u1000-\u109f\uaa60-\uaa7f\ua9e0-\ua9ff]+", "", text)
    return text


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


def wgs84() -> osr.SpatialReference:
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(4326)
    srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    return srs


def geom_from_geojson(text: str) -> ogr.Geometry | None:
    text = clean(text)
    if not text:
        return None
    try:
        geom = ogr.CreateGeometryFromJson(text)
    except Exception:
        return None
    if geom is None or geom.IsEmpty():
        return None
    geom.AssignSpatialReference(wgs84())
    return geom


def geom_from_ewkt(text: str) -> ogr.Geometry | None:
    text = clean(text)
    if not text:
        return None
    # Strip SRID=4326; prefix if present.
    if text.upper().startswith("SRID="):
        text = text.split(";", 1)[-1]
    try:
        geom = ogr.CreateGeometryFromWkt(text)
    except Exception:
        return None
    if geom is None or geom.IsEmpty():
        return None
    geom.AssignSpatialReference(wgs84())
    return geom


def haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def overlap_fraction(a: ogr.Geometry, b: ogr.Geometry) -> float:
    try:
        if not a.Intersects(b):
            return 0.0
        inter = a.Intersection(b)
        if inter is None or inter.IsEmpty():
            return 0.0
        area_a = a.GetArea()
        area_b = b.GetArea()
        area_i = inter.GetArea()
        if area_a <= 0 or area_b <= 0:
            return 0.0
        return float(area_i / min(area_a, area_b))
    except Exception:
        return 0.0


def parse_float(value: Any) -> float | None:
    text = clean(value)
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


@dataclass
class NameBag:
    by_id: dict[int, list[dict[str, str]]] = field(default_factory=lambda: defaultdict(list))
    primary_en: dict[int, str] = field(default_factory=dict)
    primary_my: dict[int, str] = field(default_factory=dict)
    all_en_norm: dict[int, set[str]] = field(default_factory=lambda: defaultdict(set))
    all_my_norm: dict[int, set[str]] = field(default_factory=lambda: defaultdict(set))


def build_name_bag(rows: list[dict[str, str]], level: str) -> NameBag:
    bag = NameBag()
    for row in rows:
        aid = int(row["admin_area_id"])
        bag.by_id[aid].append(row)
        name = clean(row.get("name"))
        lang = clean(row.get("language_code")).lower()
        ntype = clean(row.get("name_type")).lower()
        is_primary = boolish(row.get("is_primary"))
        norm = compact_name(name, level)
        if not norm:
            continue
        if lang in {"my", "mya", "bur", "burmese"} or MYANMAR_RE.search(name):
            bag.all_my_norm[aid].add(norm)
            if is_primary or ntype in {"official", "primary", ""}:
                if aid not in bag.primary_my or is_primary:
                    bag.primary_my[aid] = name
        else:
            bag.all_en_norm[aid].add(norm)
            if is_primary or lang in {"en", "eng", "english", ""}:
                if aid not in bag.primary_en or is_primary:
                    bag.primary_en[aid] = name
        if ntype in {"alias", "former", "alternate", "alt"}:
            # aliases already in all_* sets
            pass
    return bag


@dataclass
class CoreTownship:
    id: int
    public_id: str
    parent_id: int | None
    canonical_name: str
    admin_area_type: str
    pos_lon: float | None
    pos_lat: float | None
    geom: ogr.Geometry | None


@dataclass
class CoreWvt:
    id: int
    public_id: str
    parent_id: int | None
    township_id: int | None
    canonical_name: str
    admin_area_type: str
    pos_lon: float | None
    pos_lat: float | None
    geom: ogr.Geometry | None


@dataclass
class CoreSettlement:
    id: int
    public_id: str
    township_id: int | None
    settlement_type: str
    canonical_name: str
    name_en: str
    name_mm: str
    lon: float | None
    lat: float | None


def resolve_township_id(
    area_id: int,
    parents: dict[int, dict[str, str]],
) -> int | None:
    seen: set[int] = set()
    cur: int | None = area_id
    while cur is not None and cur not in seen:
        seen.add(cur)
        row = parents.get(cur)
        if not row:
            return None
        if clean(row.get("admin_level")) == "township":
            return cur
        parent = clean(row.get("parent_id"))
        cur = int(parent) if parent else None
    return None


def load_core(export_dir: Path) -> dict[str, Any]:
    parents_rows = load_csv(export_dir / "admin_parents.csv")
    parents = {int(r["id"]): r for r in parents_rows}

    township_names = build_name_bag(load_csv(export_dir / "township_names.csv"), "township")
    wvt_names = build_name_bag(load_csv(export_dir / "wvt_names.csv"), "ward_village_tract")

    townships: dict[int, CoreTownship] = {}
    for row in load_csv(export_dir / "townships.csv"):
        tid = int(row["id"])
        townships[tid] = CoreTownship(
            id=tid,
            public_id=clean(row.get("public_id")),
            parent_id=int(row["parent_id"]) if clean(row.get("parent_id")) else None,
            canonical_name=clean(row.get("canonical_name")),
            admin_area_type=clean(row.get("admin_area_type")) or "township",
            pos_lon=parse_float(row.get("pos_lon")),
            pos_lat=parse_float(row.get("pos_lat")),
            geom=geom_from_ewkt(row.get("geom_ewkt", "")),
        )

    wvts: dict[int, CoreWvt] = {}
    wvts_by_township: dict[int, list[int]] = defaultdict(list)
    for row in load_csv(export_dir / "ward_village_tracts.csv"):
        wid = int(row["id"])
        parent_id = int(row["parent_id"]) if clean(row.get("parent_id")) else None
        tsp_id = resolve_township_id(wid, parents)
        if tsp_id is None and parent_id is not None:
            tsp_id = resolve_township_id(parent_id, parents)
        wvts[wid] = CoreWvt(
            id=wid,
            public_id=clean(row.get("public_id")),
            parent_id=parent_id,
            township_id=tsp_id,
            canonical_name=clean(row.get("canonical_name")),
            admin_area_type=clean(row.get("admin_area_type")),
            pos_lon=parse_float(row.get("pos_lon")),
            pos_lat=parse_float(row.get("pos_lat")),
            geom=geom_from_geojson(row.get("geom_geojson", "")),
        )
        if tsp_id is not None:
            wvts_by_township[tsp_id].append(wid)

    settlements: dict[int, CoreSettlement] = {}
    settlements_by_township: dict[int, list[int]] = defaultdict(list)
    for row in load_csv(export_dir / "settlements.csv"):
        sid = int(row["id"])
        tsp = int(row["township_id"]) if clean(row.get("township_id")) else None
        settlements[sid] = CoreSettlement(
            id=sid,
            public_id=clean(row.get("public_id")),
            township_id=tsp,
            settlement_type=clean(row.get("settlement_type")),
            canonical_name=clean(row.get("canonical_name")),
            name_en=clean(row.get("name_en")),
            name_mm=clean(row.get("name_mm")),
            lon=parse_float(row.get("lon")),
            lat=parse_float(row.get("lat")),
        )
        if tsp is not None:
            settlements_by_township[tsp].append(sid)

    fk_counts = load_csv(export_dir / "fk_counts.csv")
    return {
        "parents": parents,
        "township_names": township_names,
        "wvt_names": wvt_names,
        "townships": townships,
        "wvts": wvts,
        "wvts_by_township": wvts_by_township,
        "settlements": settlements,
        "settlements_by_township": settlements_by_township,
        "fk_counts": fk_counts,
    }


def iter_source_boundaries(wards_path: Path, vt_path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path, expected_type in ((wards_path, "ward"), (vt_path, "village_tract")):
        ds = ogr.Open(str(path))
        if ds is None:
            raise RuntimeError(f"Cannot open {path}")
        layer = ds.GetLayer(0)
        for idx, feature in enumerate(layer, start=1):
            geom = feature.GetGeometryRef()
            geom_clone = geom.Clone() if geom is not None else None
            rows.append({
                "entity_type": clean(feature.GetField("entity_type")) or expected_type,
                "source_pcode": clean(feature.GetField("source_pcode")),
                "name_en": clean(feature.GetField("name_en")),
                "name_my": clean(feature.GetField("name_my")),
                "region": clean(feature.GetField("region")),
                "st_pcode": clean(feature.GetField("st_pcode")),
                "st_name": clean(feature.GetField("st_name")),
                "dt_pcode": clean(feature.GetField("dt_pcode")),
                "dt_name": clean(feature.GetField("dt_name")),
                "ts_pcode": clean(feature.GetField("ts_pcode")),
                "ts_name": clean(feature.GetField("ts_name")),
                "town_pcode": clean(feature.GetField("town_pcode")) if expected_type == "ward" else "",
                "town_name": clean(feature.GetField("town_name")) if expected_type == "ward" else "",
                "parent_path": clean(feature.GetField("parent_path")),
                "pos_lon": parse_float(feature.GetField("pos_lon")),
                "pos_lat": parse_float(feature.GetField("pos_lat")),
                "geom": geom_clone,
                "source_file": clean(feature.GetField("source_file")),
                "source_row": idx,
                "flags": clean(feature.GetField("flags")) if feature.GetFieldIndex("flags") >= 0 else "",
            })
        ds = None
    return rows


def iter_source_villages(path: Path) -> list[dict[str, Any]]:
    rows = []
    for idx, row in enumerate(load_csv(path), start=1):
        rows.append({
            "entity_type": "village",
            "source_pcode": clean(row.get("source_pcode")),
            "name_en": clean(row.get("name_en")),
            "name_my": clean(row.get("name_my")),
            "alt_en": clean(row.get("alt_en")),
            "alt_my": clean(row.get("alt_my")),
            "region": clean(row.get("region")),
            "st_pcode": clean(row.get("st_pcode")),
            "st_name": clean(row.get("st_name")),
            "dt_pcode": clean(row.get("dt_pcode")),
            "dt_name": clean(row.get("dt_name")),
            "ts_pcode": clean(row.get("ts_pcode")),
            "ts_name": clean(row.get("ts_name")),
            "vt_pcode": clean(row.get("vt_pcode")),
            "vt_name": clean(row.get("vt_name")),
            "parent_path": clean(row.get("parent_path")),
            "lon": parse_float(row.get("lon")),
            "lat": parse_float(row.get("lat")),
            "source_file": clean(row.get("source_file")),
            "source_row": clean(row.get("source_row")) or str(idx),
            "flags": clean(row.get("flags")),
        })
    return rows


def collect_source_townships(
    boundaries: list[dict[str, Any]],
    villages: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    buckets: dict[str, dict[str, Any]] = {}
    for row in boundaries + villages:
        pcode = clean(row.get("ts_pcode"))
        if not pcode:
            continue
        slot = buckets.setdefault(
            pcode,
            {
                "source_ts_pcode": pcode,
                "source_ts_name": clean(row.get("ts_name")),
                "source_st_pcode": clean(row.get("st_pcode")),
                "source_st_name": clean(row.get("st_name")),
                "source_dt_pcode": clean(row.get("dt_pcode")),
                "source_dt_name": clean(row.get("dt_name")),
                "boundary_count": 0,
                "village_count": 0,
                "pos_samples": [],
            },
        )
        if clean(row.get("entity_type")) in {"ward", "village_tract"}:
            slot["boundary_count"] += 1
            lon, lat = row.get("pos_lon"), row.get("pos_lat")
        else:
            slot["village_count"] += 1
            lon, lat = row.get("lon"), row.get("lat")
        if isinstance(lon, float) and isinstance(lat, float):
            if len(slot["pos_samples"]) < 50:
                slot["pos_samples"].append((lon, lat))
        if not slot["source_ts_name"] and clean(row.get("ts_name")):
            slot["source_ts_name"] = clean(row.get("ts_name"))
    return list(buckets.values())


def match_township(
    source: dict[str, Any],
    townships: dict[int, CoreTownship],
    names: NameBag,
) -> dict[str, Any]:
    # Spatial township attrs usually carry English names; Myanmar when present.
    raw_name = clean(source["source_ts_name"])
    en_norm = compact_name(raw_name, "township")
    my_from_name = compact_name(raw_name, "township") if MYANMAR_RE.search(raw_name) else ""

    my_hits: set[int] = set()
    en_hits: set[int] = set()
    for tid, norms in names.all_my_norm.items():
        if my_from_name and my_from_name in norms:
            my_hits.add(tid)
        if en_norm and en_norm in norms:
            # rare: English stored as my bucket mis-detect — ignore
            pass
    for tid, norms in names.all_en_norm.items():
        if en_norm and en_norm in norms:
            en_hits.add(tid)
    # Also match primary canonical
    for tid, tsp in townships.items():
        c_en = compact_name(names.primary_en.get(tid, ""), "township")
        c_my = compact_name(names.primary_my.get(tid, ""), "township")
        c_can = compact_name(tsp.canonical_name, "township")
        if en_norm and en_norm in {c_en, c_can}:
            en_hits.add(tid)
        if my_from_name and my_from_name in {c_my, c_can}:
            my_hits.add(tid)

    name_hits = sorted(my_hits | en_hits)
    evidence = []
    if my_hits:
        evidence.append(f"exact_normalized_my={sorted(my_hits)}")
    if en_hits:
        evidence.append(f"exact_normalized_en={sorted(en_hits)}")

    # Spatial support using sample POS vs township geom / POS.
    spatial_scores: dict[int, float] = defaultdict(float)
    samples = source.get("pos_samples") or []
    if samples:
        for tid, tsp in townships.items():
            hits = 0
            for lon, lat in samples:
                if tsp.geom is not None:
                    pt = ogr.Geometry(ogr.wkbPoint)
                    pt.AddPoint(lon, lat)
                    try:
                        if tsp.geom.Contains(pt) or tsp.geom.Intersects(pt):
                            hits += 1
                            continue
                    except Exception:
                        pass
                if tsp.pos_lon is not None and tsp.pos_lat is not None:
                    dist = haversine_m(lon, lat, tsp.pos_lon, tsp.pos_lat)
                    if dist <= 25000:  # within ~25km of township POS
                        hits += 0.25
            if hits:
                spatial_scores[tid] = hits / len(samples)
        if spatial_scores:
            best_spatial = sorted(spatial_scores.items(), key=lambda x: -x[1])[:5]
            evidence.append("spatial_support=" + ";".join(f"{i}:{s:.2f}" for i, s in best_spatial))

    candidates = name_hits
    method = "name"
    if len(candidates) > 1 and spatial_scores:
        ranked = sorted(candidates, key=lambda i: (-spatial_scores.get(i, 0.0), i))
        if spatial_scores.get(ranked[0], 0) > 0 and (
            len(ranked) == 1 or spatial_scores.get(ranked[0], 0) > spatial_scores.get(ranked[1], 0)
        ):
            candidates = [ranked[0]]
            method = "name+spatial_tiebreak"
    if not candidates and spatial_scores:
        # Do not approve spatial-only township maps — force manual review.
        top = sorted(spatial_scores.items(), key=lambda x: -x[1])
        if top and top[0][1] >= 0.6:
            evidence.append(f"spatial_only_candidate={top[0][0]}")
            return {
                "status": "manual_review",
                "core_township_id": "",
                "core_public_id": "",
                "core_canonical_name": "",
                "match_method": "spatial_only_blocked",
                "candidate_coremap_ids": ";".join(str(i) for i, _ in top[:5]),
                "evidence": "|".join(evidence),
                "review_reason": "Spatial-only township candidate; name match missing — do not auto-approve",
            }

    if len(candidates) == 1:
        tid = candidates[0]
        tsp = townships[tid]
        return {
            "status": "mapped",
            "core_township_id": str(tid),
            "core_public_id": tsp.public_id,
            "core_canonical_name": tsp.canonical_name,
            "match_method": method,
            "candidate_coremap_ids": str(tid),
            "evidence": "|".join(evidence),
            "review_reason": "",
        }
    if len(candidates) > 1:
        return {
            "status": "manual_review",
            "core_township_id": "",
            "core_public_id": "",
            "core_canonical_name": "",
            "match_method": "ambiguous_name",
            "candidate_coremap_ids": ";".join(str(i) for i in candidates),
            "evidence": "|".join(evidence),
            "review_reason": "Multiple CoreMap townships share normalized name",
        }
    return {
        "status": "manual_review",
        "core_township_id": "",
        "core_public_id": "",
        "core_canonical_name": "",
        "match_method": "unmatched",
        "candidate_coremap_ids": "",
        "evidence": "|".join(evidence) or "no_name_hit",
        "review_reason": "No unique CoreMap township for source township name",
    }


def decide_local_action(
    source_type: str,
    core: CoreWvt,
    names: NameBag,
    source_name_en: str,
    source_name_my: str,
    approved_township_id: int,
) -> tuple[str, str]:
    type_ok = core.admin_area_type == source_type
    parent_ok = core.township_id == approved_township_id
    # Immediate parent may be town; township ancestor is what we compare.
    primary_en = names.primary_en.get(core.id, "")
    primary_my = names.primary_my.get(core.id, "")
    en_norm = compact_name(source_name_en, "ward_village_tract")
    my_norm = compact_name(source_name_my, "ward_village_tract")
    core_en = compact_name(primary_en, "ward_village_tract") or compact_name(core.canonical_name, "ward_village_tract")
    core_my = compact_name(primary_my, "ward_village_tract") or (
        compact_name(core.canonical_name, "ward_village_tract") if MYANMAR_RE.search(core.canonical_name) else ""
    )

    missing_en = bool(en_norm and en_norm not in names.all_en_norm.get(core.id, set()) and en_norm != core_en)
    missing_my = bool(my_norm and my_norm not in names.all_my_norm.get(core.id, set()) and my_norm != core_my)
    # update_names when source has a name CoreMap lacks as primary/alias, or primary differs.
    names_differ = missing_en or missing_my or (
        (en_norm and core_en and en_norm != core_en and en_norm not in names.all_en_norm.get(core.id, set()))
        or (my_norm and core_my and my_norm != core_my and my_norm not in names.all_my_norm.get(core.id, set()))
    )
    # If source names already present as alias/primary, no name update.
    if en_norm and en_norm in names.all_en_norm.get(core.id, set()):
        missing_en = False
    if my_norm and my_norm in names.all_my_norm.get(core.id, set()):
        missing_my = False
    names_differ = missing_en or missing_my

    if not parent_ok and names_differ:
        return "manual_review", "Matched row needs parent and name changes; review before edit"
    if not parent_ok and not type_ok:
        return "manual_review", "Matched row needs parent and type changes; review before edit"
    if not parent_ok:
        return "update_parent", "Township ancestor differs from approved source township map"
    if names_differ and not type_ok:
        return "update_names_and_type", "Add/align missing names and correct admin type; preserve geometry"
    if names_differ:
        return "update_names", "Add approved missing bilingual names/aliases; preserve geometry"
    if not type_ok:
        return "update_type", f"Type differs (core={core.admin_area_type}, source={source_type})"
    return "keep_existing", "Same township, type and names already align; preserve CoreMap geometry"


def match_boundary_row(
    row: dict[str, Any],
    tsp_map: dict[str, dict[str, Any]],
    core: dict[str, Any],
) -> dict[str, Any]:
    base = {
        "source_entity_type": row["entity_type"],
        "source_pcode": row["source_pcode"],
        "source_name_en": row["name_en"],
        "source_name_my": row["name_my"],
        "source_region": row["region"],
        "source_ts_pcode": row["ts_pcode"],
        "source_ts_name": row["ts_name"],
        "source_st_name": row["st_name"],
        "source_parent_path": row["parent_path"],
        "source_file": row["source_file"],
        "source_row": row["source_row"],
        "preserve_existing_geom": "true",
        "matched_coremap_id": "",
        "matched_public_id": "",
        "matched_canonical_name": "",
        "matched_type": "",
        "matched_parent_id": "",
        "approved_township_id": "",
        "action": "",
        "confidence": "",
        "name_evidence": "",
        "spatial_evidence": "",
        "candidate_coremap_ids": "",
        "manual_review_reason": "",
        "review_notes": "",
    }

    if not row["ts_pcode"] or not row["entity_type"]:
        base.update(action="reject_source_error", confidence="100", manual_review_reason="Missing township or type on source row")
        return base
    if row["entity_type"] not in {"ward", "village_tract"}:
        base.update(action="reject_source_error", confidence="100", manual_review_reason="Unsupported source entity type")
        return base

    tsp = tsp_map.get(row["ts_pcode"])
    if not tsp or tsp.get("status") != "mapped":
        base.update(
            action="manual_review",
            confidence="40",
            manual_review_reason="Source township not uniquely mapped to CoreMap; child matching blocked",
            review_notes=clean(tsp.get("review_reason") if tsp else "township missing from map"),
        )
        return base

    approved_tsp = int(tsp["core_township_id"])
    base["approved_township_id"] = str(approved_tsp)

    wvts: dict[int, CoreWvt] = core["wvts"]
    names: NameBag = core["wvt_names"]
    pool_ids = core["wvts_by_township"].get(approved_tsp, [])

    en_norm = compact_name(row["name_en"], "ward_village_tract")
    my_norm = compact_name(row["name_my"], "ward_village_tract")

    type_pool = [
        wid for wid in pool_ids
        if wvts[wid].admin_area_type == row["entity_type"]
        or not wvts[wid].admin_area_type
    ]
    # Keep unknown types in a secondary pool.
    if not type_pool:
        type_pool = list(pool_ids)

    my_hits = [
        wid for wid in type_pool
        if my_norm and my_norm in names.all_my_norm.get(wid, set())
    ]
    en_hits = [
        wid for wid in type_pool
        if en_norm and (
            en_norm in names.all_en_norm.get(wid, set())
            or en_norm == compact_name(wvts[wid].canonical_name, "ward_village_tract")
        )
    ]

    # Exact name candidates: prefer intersection of MY+EN when both exist.
    if my_hits and en_hits:
        candidates = sorted(set(my_hits) & set(en_hits)) or sorted(set(my_hits) | set(en_hits))
        name_evidence = "exact_my+en" if set(my_hits) & set(en_hits) else "exact_my_or_en"
    elif my_hits:
        candidates = sorted(set(my_hits))
        name_evidence = "exact_normalized_my"
    elif en_hits:
        candidates = sorted(set(en_hits))
        name_evidence = "exact_normalized_en_or_alias"
    else:
        candidates = []
        name_evidence = "no_exact_name"

    spatial_notes = []
    spatial_ranked: list[tuple[float, float, int]] = []  # (-overlap, dist, id)
    src_geom = row.get("geom")
    for wid in (candidates or type_pool):
        core_row = wvts[wid]
        overlap = 0.0
        dist = None
        if src_geom is not None and core_row.geom is not None:
            overlap = overlap_fraction(src_geom, core_row.geom)
        if row.get("pos_lon") is not None and row.get("pos_lat") is not None and core_row.pos_lon is not None and core_row.pos_lat is not None:
            dist = haversine_m(row["pos_lon"], row["pos_lat"], core_row.pos_lon, core_row.pos_lat)
        if overlap >= MIN_OVERLAP or (dist is not None and dist <= POS_DISTANCE_M):
            spatial_ranked.append((-overlap, dist if dist is not None else 1e12, wid))
            spatial_notes.append(f"{wid}:overlap={overlap:.3f};dist_m={'' if dist is None else round(dist,1)}")

    spatial_ranked.sort()
    spatial_ids = [wid for _, _, wid in spatial_ranked]

    # Matching waterfall.
    selected_id = None
    method = name_evidence
    if len(candidates) == 1:
        selected_id = candidates[0]
        method = name_evidence + "+unique"
    elif len(candidates) > 1:
        spatial_in = [wid for wid in spatial_ids if wid in candidates]
        if len(spatial_in) == 1:
            selected_id = spatial_in[0]
            method = name_evidence + "+spatial_unique"
        else:
            base.update(
                action="manual_review" if len(spatial_in) != 1 else "manual_review",
                confidence="55",
                name_evidence=name_evidence,
                spatial_evidence="|".join(spatial_notes[:8]),
                candidate_coremap_ids=";".join(str(i) for i in candidates),
                manual_review_reason="Multiple name candidates under approved township; spatial did not yield unique row",
            )
            # merge_duplicate_candidate when multiple strong name hits
            if len(candidates) > 1 and name_evidence.startswith("exact"):
                base["action"] = "merge_duplicate_candidate"
                base["manual_review_reason"] = "Multiple CoreMap WVT rows share exact normalized name under township"
            return base
    else:
        # No exact name — do not match by spatial alone.
        if len(spatial_ids) == 1:
            base.update(
                action="manual_review",
                confidence="45",
                name_evidence=name_evidence,
                spatial_evidence="|".join(spatial_notes[:8]),
                candidate_coremap_ids=str(spatial_ids[0]),
                manual_review_reason="Spatial-only candidate blocked (do not merge by geometry alone)",
            )
            return base
        base.update(
            action="create_mimu_placeholder",
            confidence="70",
            name_evidence=name_evidence,
            spatial_evidence="|".join(spatial_notes[:5]),
            manual_review_reason="",
            review_notes="No unique CoreMap WVT name match under approved township; placeholder only (no MIMU external_id)",
        )
        return base

    core_row = wvts[selected_id]
    action, note = decide_local_action(
        row["entity_type"], core_row, names, row["name_en"], row["name_my"], approved_tsp
    )
    base.update(
        action=action,
        confidence="95" if action != "manual_review" else "60",
        matched_coremap_id=str(core_row.id),
        matched_public_id=core_row.public_id,
        matched_canonical_name=core_row.canonical_name,
        matched_type=core_row.admin_area_type,
        matched_parent_id="" if core_row.parent_id is None else str(core_row.parent_id),
        name_evidence=method,
        spatial_evidence="|".join(spatial_notes[:8]),
        candidate_coremap_ids=str(selected_id),
        review_notes=note,
        manual_review_reason=note if action == "manual_review" else "",
    )
    return base


def decide_village_action(
    source: dict[str, Any],
    core_row: CoreSettlement,
) -> tuple[str, str]:
    # Settlements: no admin type ward/vt; compare settlement_type loosely.
    type_ok = core_row.settlement_type in {"village", "local_area"}
    en_norm = compact_name(source["name_en"], "village")
    my_norm = compact_name(source["name_my"], "village")
    core_en = compact_name(core_row.name_en or core_row.canonical_name, "village")
    core_my = compact_name(core_row.name_mm, "village")
    alt_en = compact_name(source.get("alt_en", ""), "village")
    alt_my = compact_name(source.get("alt_my", ""), "village")

    en_present = en_norm and en_norm == core_en
    my_present = my_norm and my_norm == core_my
    # Treat alt match as already having alias-equivalent name.
    if alt_en and alt_en == core_en:
        en_present = True
    if alt_my and alt_my == core_my:
        my_present = True

    missing_en = bool(en_norm and not en_present and en_norm != core_en)
    missing_my = bool(my_norm and not my_present and my_norm != core_my)
    # If core missing EN/MY entirely, suggest update_names.
    if en_norm and not core_row.name_en:
        missing_en = True
    if my_norm and not core_row.name_mm:
        missing_my = True

    names_differ = missing_en or missing_my
    parent_ok = core_row.township_id == int(source["approved_township_id"])

    if not parent_ok and names_differ:
        return "manual_review", "Settlement needs township and name changes; review before edit"
    if not parent_ok:
        return "update_parent", "Settlement township_id differs from approved source township"
    if names_differ and not type_ok:
        return "update_names_and_type", "Align missing names; review settlement type"
    if names_differ:
        return "update_names", "Add approved missing Myanmar/English names; preserve point"
    if core_row.settlement_type == "local_area":
        # Source villages matched to local_area may need type review.
        return "update_type", "Matched CoreMap local_area against source village; confirm type"
    return "keep_existing", "Township and names align; preserve CoreMap point"


def match_village_row(
    row: dict[str, Any],
    tsp_map: dict[str, dict[str, Any]],
    core: dict[str, Any],
    vt_name_to_ids: dict[tuple[int, str], list[int]],
) -> dict[str, Any]:
    base = {
        "source_entity_type": "village",
        "source_pcode": row["source_pcode"],
        "source_name_en": row["name_en"],
        "source_name_my": row["name_my"],
        "source_alt_en": row.get("alt_en", ""),
        "source_alt_my": row.get("alt_my", ""),
        "source_region": row["region"],
        "source_ts_pcode": row["ts_pcode"],
        "source_ts_name": row["ts_name"],
        "source_vt_pcode": row.get("vt_pcode", ""),
        "source_vt_name": row.get("vt_name", ""),
        "source_parent_path": row["parent_path"],
        "source_lon": "" if row.get("lon") is None else f"{row['lon']:.8f}",
        "source_lat": "" if row.get("lat") is None else f"{row['lat']:.8f}",
        "source_file": row["source_file"],
        "source_row": row["source_row"],
        "preserve_existing_geom": "true",
        "matched_coremap_id": "",
        "matched_public_id": "",
        "matched_canonical_name": "",
        "matched_type": "",
        "matched_township_id": "",
        "approved_township_id": "",
        "action": "",
        "confidence": "",
        "name_evidence": "",
        "spatial_evidence": "",
        "vt_context_evidence": "",
        "candidate_coremap_ids": "",
        "manual_review_reason": "",
        "review_notes": "",
    }

    if not row["ts_pcode"] or (not row["name_en"] and not row["name_my"]):
        base.update(action="reject_source_error", confidence="100", manual_review_reason="Missing township or name")
        return base

    tsp = tsp_map.get(row["ts_pcode"])
    if not tsp or tsp.get("status") != "mapped":
        base.update(
            action="manual_review",
            confidence="40",
            manual_review_reason="Source township not uniquely mapped; village matching blocked",
        )
        return base

    approved_tsp = int(tsp["core_township_id"])
    base["approved_township_id"] = str(approved_tsp)
    row = {**row, "approved_township_id": str(approved_tsp)}

    settlements: dict[int, CoreSettlement] = core["settlements"]
    pool_ids = core["settlements_by_township"].get(approved_tsp, [])
    # Prefer village type, allow local_area.
    pool = [sid for sid in pool_ids if settlements[sid].settlement_type in {"village", "local_area"}]

    en_norm = compact_name(row["name_en"], "village")
    my_norm = compact_name(row["name_my"], "village")
    alt_en = compact_name(row.get("alt_en", ""), "village")
    alt_my = compact_name(row.get("alt_my", ""), "village")

    def name_match(s: CoreSettlement) -> str | None:
        core_en = compact_name(s.name_en or s.canonical_name, "village")
        core_my = compact_name(s.name_mm, "village")
        if my_norm and my_norm == core_my:
            return "exact_normalized_my"
        if en_norm and en_norm == core_en:
            return "exact_normalized_en"
        if alt_en and alt_en == core_en:
            return "exact_normalized_en_alias"
        if alt_my and alt_my == core_my:
            return "exact_normalized_my_alias"
        if en_norm and en_norm == compact_name(s.canonical_name, "village"):
            return "exact_normalized_canonical"
        return None

    named: list[tuple[int, str]] = []
    for sid in pool:
        method = name_match(settlements[sid])
        if method:
            named.append((sid, method))

    # Optional VT context narrows candidates when VT name matches a Core WVT under township.
    vt_norm = compact_name(row.get("vt_name", ""), "ward_village_tract")
    vt_core_ids = vt_name_to_ids.get((approved_tsp, vt_norm), []) if vt_norm else []
    vt_evidence = ""
    if vt_norm:
        vt_evidence = f"vt_norm={vt_norm};wvt_hits={vt_core_ids[:5]}"

    candidates = [sid for sid, _ in named]
    methods = {sid: method for sid, method in named}

    if len(candidates) > 1 and vt_core_ids:
        # Cannot join settlement→WVT directly; keep all name hits but note context.
        vt_evidence += ";vt_context_available_not_fk_linked"

    spatial_notes = []
    if row.get("lon") is not None and row.get("lat") is not None:
        scored = []
        for sid in (candidates or pool):
            s = settlements[sid]
            if s.lon is None or s.lat is None:
                continue
            dist = haversine_m(row["lon"], row["lat"], s.lon, s.lat)
            if dist <= POINT_DISTANCE_M or sid in candidates:
                scored.append((dist, sid))
                spatial_notes.append(f"{sid}:{round(dist,1)}m")
        scored.sort()
        spatial_ids = [sid for _, sid in scored if _ <= POINT_DISTANCE_M]
    else:
        spatial_ids = []

    if len(candidates) == 1:
        selected = candidates[0]
        method = methods[selected]
        if selected in spatial_ids or not spatial_ids:
            method += "+unique"
        else:
            # Name unique but far — still keep name match (CoreMap wins); note distance.
            method += "+unique_far"
    elif len(candidates) > 1:
        spatial_in = [sid for sid in spatial_ids if sid in candidates]
        if len(spatial_in) == 1:
            selected = spatial_in[0]
            method = methods[selected] + "+spatial_unique"
        else:
            base.update(
                action="merge_duplicate_candidate",
                confidence="55",
                name_evidence=",".join(sorted(set(methods.values()))),
                spatial_evidence="|".join(spatial_notes[:8]),
                vt_context_evidence=vt_evidence,
                candidate_coremap_ids=";".join(str(i) for i in candidates),
                manual_review_reason="Multiple CoreMap settlements share exact normalized name under township",
            )
            return base
    else:
        if len(spatial_ids) == 1:
            base.update(
                action="manual_review",
                confidence="45",
                name_evidence="no_exact_name",
                spatial_evidence="|".join(spatial_notes[:8]),
                vt_context_evidence=vt_evidence,
                candidate_coremap_ids=str(spatial_ids[0]),
                manual_review_reason="Spatial-only settlement candidate blocked (do not merge by distance alone)",
            )
            return base
        base.update(
            action="create_mimu_placeholder",
            confidence="70",
            name_evidence="no_exact_name",
            spatial_evidence="|".join(spatial_notes[:5]),
            vt_context_evidence=vt_evidence,
            review_notes="No unique CoreMap village/local_area name match; placeholder only (no MIMU external_id)",
        )
        return base

    core_row = settlements[selected]
    action, note = decide_village_action(row, core_row)
    base.update(
        action=action,
        confidence="95" if action != "manual_review" else "60",
        matched_coremap_id=str(core_row.id),
        matched_public_id=core_row.public_id,
        matched_canonical_name=core_row.canonical_name,
        matched_type=core_row.settlement_type,
        matched_township_id="" if core_row.township_id is None else str(core_row.township_id),
        name_evidence=method,
        spatial_evidence="|".join(spatial_notes[:8]),
        vt_context_evidence=vt_evidence,
        candidate_coremap_ids=str(selected),
        review_notes=note,
        manual_review_reason=note if action == "manual_review" else "",
    )
    return base


def build_vt_name_index(core: dict[str, Any]) -> dict[tuple[int, str], list[int]]:
    out: dict[tuple[int, str], list[int]] = defaultdict(list)
    names: NameBag = core["wvt_names"]
    for wid, wvt in core["wvts"].items():
        if wvt.township_id is None:
            continue
        norms = set(names.all_en_norm.get(wid, set())) | set(names.all_my_norm.get(wid, set()))
        c = compact_name(wvt.canonical_name, "ward_village_tract")
        if c:
            norms.add(c)
        for norm in norms:
            if norm:
                out[(wvt.township_id, norm)].append(wid)
    return out


def extra_core_wvt(
    core: dict[str, Any],
    matched_ids: set[int],
    approved_township_ids: set[int],
) -> list[dict[str, Any]]:
    rows = []
    names: NameBag = core["wvt_names"]
    for wid, wvt in core["wvts"].items():
        if wvt.township_id not in approved_township_ids:
            continue
        if wid in matched_ids:
            continue
        rows.append({
            "coremap_id": wid,
            "public_id": wvt.public_id,
            "canonical_name": wvt.canonical_name,
            "admin_area_type": wvt.admin_area_type,
            "township_id": wvt.township_id,
            "parent_id": wvt.parent_id,
            "primary_en": names.primary_en.get(wid, ""),
            "primary_my": names.primary_my.get(wid, ""),
            "reason": "No MIMU ward/VT source matched this CoreMap row under an approved township",
        })
    return rows


def extra_core_settlements(
    core: dict[str, Any],
    matched_ids: set[int],
    approved_township_ids: set[int],
) -> list[dict[str, Any]]:
    rows = []
    for sid, s in core["settlements"].items():
        if s.township_id not in approved_township_ids:
            continue
        if sid in matched_ids:
            continue
        if s.settlement_type not in {"village", "local_area"}:
            continue
        rows.append({
            "coremap_id": sid,
            "public_id": s.public_id,
            "canonical_name": s.canonical_name,
            "settlement_type": s.settlement_type,
            "township_id": s.township_id,
            "name_en": s.name_en,
            "name_mm": s.name_mm,
            "lon": "" if s.lon is None else f"{s.lon:.8f}",
            "lat": "" if s.lat is None else f"{s.lat:.8f}",
            "reason": "No MIMU village source matched this CoreMap settlement under an approved township",
        })
    return rows


def write_summary(
    path: Path,
    tsp_rows: list[dict[str, Any]],
    local_rows: list[dict[str, Any]],
    village_rows: list[dict[str, Any]],
    extra_local: list[dict[str, Any]],
    extra_village: list[dict[str, Any]],
    fk_counts: list[dict[str, str]],
) -> None:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    tsp_status = Counter(r["status"] for r in tsp_rows)
    local_actions = Counter(r["action"] for r in local_rows)
    village_actions = Counter(r["action"] for r in village_rows)
    local_by_type = Counter((r["source_entity_type"], r["action"]) for r in local_rows)

    lines = [
        "# Admin reconciliation v2 — Phase 2 local match (read-only)",
        "",
        f"**Generated:** {now}",
        "**Database writes:** none",
        "",
        "CoreMap/OSM always wins for IDs and geometries. MIMU PCodes are audit keys only.",
        "Child matching ran only after each source township mapped to one CoreMap township or was sent to manual review.",
        "",
        "## Township map",
        "",
        f"| Status | Count |",
        f"|---|---:|",
        f"| mapped | {tsp_status.get('mapped', 0)} |",
        f"| manual_review | {tsp_status.get('manual_review', 0)} |",
        f"| **total source townships** | {len(tsp_rows)} |",
        "",
        "## Local admin actions (ward + village_tract)",
        "",
        "| Action | Count |",
        "|---|---:|",
    ]
    for action, count in sorted(local_actions.items()):
        lines.append(f"| {action} | {count} |")
    lines += ["", f"**Total source local rows:** {len(local_rows)}", ""]
    lines += ["### By entity type", "", "| Entity | Action | Count |", "|---|---|---:|"]
    for (entity, action), count in sorted(local_by_type.items()):
        lines.append(f"| {entity} | {action} | {count} |")

    lines += [
        "",
        "## Village actions",
        "",
        "| Action | Count |",
        "|---|---:|",
    ]
    for action, count in sorted(village_actions.items()):
        lines.append(f"| {action} | {count} |")
    lines += ["", f"**Total source village rows:** {len(village_rows)}", ""]

    lines += [
        "## Extra CoreMap rows (no MIMU match under approved townships)",
        "",
        f"| Set | Count |",
        f"|---|---:|",
        f"| Extra ward_village_tract | {len(extra_local)} |",
        f"| Extra village/local_area settlements | {len(extra_village)} |",
        "",
        "## Foreign-key dependency inventory (export)",
        "",
        "| Target | Source | Constraint | On delete |",
        "|---|---|---|---|",
    ]
    for row in fk_counts:
        lines.append(
            f"| {row.get('target_schema')}.{row.get('target_table')} | "
            f"{row.get('source_schema')}.{row.get('source_table')} | "
            f"{row.get('constraint_name')} | {row.get('delete_action')} |"
        )

    lines += [
        "",
        "## Rules enforced",
        "",
        "- Every source row has exactly one action.",
        "- No geometry replacement on matched CoreMap rows (`preserve_existing_geom=true`).",
        "- No match by name alone across townships; township map is required first.",
        "- No spatial-only auto-match for townships, WVT, or villages.",
        "- `create_mimu_placeholder` does not assign MIMU PCode as CoreMap `external_id`.",
        "",
        "## Stop line",
        "",
        "Phase 2 matching finished. No database writes were performed.",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    repo = Path(__file__).resolve().parents[2]
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--export-dir", type=Path, default=repo / "data/local/admin-reconciliation/phase2-export")
    p.add_argument("--wards", type=Path, default=repo / "reports/admin-reconciliation-v2/01-wards-normalized.geojson")
    p.add_argument("--village-tracts", type=Path, default=repo / "reports/admin-reconciliation-v2/01-village-tracts-normalized.geojson")
    p.add_argument("--villages", type=Path, default=repo / "reports/admin-reconciliation-v2/01-villages-normalized.csv")
    p.add_argument("--out-dir", type=Path, default=repo / "reports/admin-reconciliation-v2")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    print("loading core export...", flush=True)
    core = load_core(args.export_dir)
    print(
        f"  townships={len(core['townships'])} wvt={len(core['wvts'])} "
        f"settlements={len(core['settlements'])}",
        flush=True,
    )

    print("loading source boundaries...", flush=True)
    boundaries = iter_source_boundaries(args.wards, args.village_tracts)
    print(f"  boundaries={len(boundaries)}", flush=True)
    print("loading source villages...", flush=True)
    villages = iter_source_villages(args.villages)
    print(f"  villages={len(villages)}", flush=True)

    print("building township map...", flush=True)
    source_tsp = collect_source_townships(boundaries, villages)
    tsp_rows = []
    tsp_map: dict[str, dict[str, Any]] = {}
    for src in sorted(source_tsp, key=lambda r: r["source_ts_pcode"]):
        matched = match_township(src, core["townships"], core["township_names"])
        row = {
            "source_ts_pcode": src["source_ts_pcode"],
            "source_ts_name": src["source_ts_name"],
            "source_st_pcode": src["source_st_pcode"],
            "source_st_name": src["source_st_name"],
            "source_dt_pcode": src["source_dt_pcode"],
            "source_dt_name": src["source_dt_name"],
            "boundary_count": src["boundary_count"],
            "village_count": src["village_count"],
            **matched,
        }
        tsp_rows.append(row)
        tsp_map[src["source_ts_pcode"]] = row
    mapped_n = sum(1 for r in tsp_rows if r["status"] == "mapped")
    print(f"  source_townships={len(tsp_rows)} mapped={mapped_n}", flush=True)

    print("matching local admin...", flush=True)
    local_rows = [match_boundary_row(row, tsp_map, core) for row in boundaries]
    assert all(r["action"] in ACTIONS for r in local_rows)
    assert len(local_rows) == len(boundaries)

    print("matching villages...", flush=True)
    vt_index = build_vt_name_index(core)
    village_rows = [match_village_row(row, tsp_map, core, vt_index) for row in villages]
    assert all(r["action"] in ACTIONS for r in village_rows)
    assert len(village_rows) == len(villages)

    matched_wvt_ids = {int(r["matched_coremap_id"]) for r in local_rows if clean(r["matched_coremap_id"])}
    matched_settlement_ids = {int(r["matched_coremap_id"]) for r in village_rows if clean(r["matched_coremap_id"])}
    approved_tsp_ids = {int(r["core_township_id"]) for r in tsp_rows if r["status"] == "mapped"}

    extra_local = extra_core_wvt(core, matched_wvt_ids, approved_tsp_ids)
    extra_village = extra_core_settlements(core, matched_settlement_ids, approved_tsp_ids)

    out = args.out_dir
    write_csv(
        out / "02-township-map.csv",
        tsp_rows,
        [
            "source_ts_pcode", "source_ts_name", "source_st_pcode", "source_st_name",
            "source_dt_pcode", "source_dt_name", "boundary_count", "village_count",
            "status", "core_township_id", "core_public_id", "core_canonical_name",
            "match_method", "candidate_coremap_ids", "evidence", "review_reason",
        ],
    )

    local_fields = [
        "source_entity_type", "source_pcode", "source_name_en", "source_name_my", "source_region",
        "source_ts_pcode", "source_ts_name", "source_st_name", "source_parent_path",
        "source_file", "source_row", "approved_township_id",
        "matched_coremap_id", "matched_public_id", "matched_canonical_name", "matched_type",
        "matched_parent_id", "action", "confidence", "preserve_existing_geom",
        "name_evidence", "spatial_evidence", "candidate_coremap_ids",
        "manual_review_reason", "review_notes",
    ]
    write_csv(out / "02-local-admin-actions.csv", local_rows, local_fields)
    write_csv(
        out / "02-local-admin-review.csv",
        [r for r in local_rows if r["action"] in {"manual_review", "merge_duplicate_candidate", "reject_source_error"}],
        local_fields,
    )
    write_csv(
        out / "02-local-admin-extra-core.csv",
        extra_local,
        [
            "coremap_id", "public_id", "canonical_name", "admin_area_type", "township_id",
            "parent_id", "primary_en", "primary_my", "reason",
        ],
    )

    village_fields = [
        "source_entity_type", "source_pcode", "source_name_en", "source_name_my",
        "source_alt_en", "source_alt_my", "source_region",
        "source_ts_pcode", "source_ts_name", "source_vt_pcode", "source_vt_name",
        "source_parent_path", "source_lon", "source_lat", "source_file", "source_row",
        "approved_township_id", "matched_coremap_id", "matched_public_id",
        "matched_canonical_name", "matched_type", "matched_township_id",
        "action", "confidence", "preserve_existing_geom",
        "name_evidence", "spatial_evidence", "vt_context_evidence", "candidate_coremap_ids",
        "manual_review_reason", "review_notes",
    ]
    write_csv(out / "02-village-actions.csv", village_rows, village_fields)
    write_csv(
        out / "02-village-review.csv",
        [r for r in village_rows if r["action"] in {"manual_review", "merge_duplicate_candidate", "reject_source_error"}],
        village_fields,
    )
    write_csv(
        out / "02-village-extra-core.csv",
        extra_village,
        [
            "coremap_id", "public_id", "canonical_name", "settlement_type", "township_id",
            "name_en", "name_mm", "lon", "lat", "reason",
        ],
    )

    # Copy fk inventory into reports for traceability.
    write_csv(
        out / "02-fk-dependency-counts.csv",
        core["fk_counts"],
        list(core["fk_counts"][0].keys()) if core["fk_counts"] else [],
    )
    write_summary(
        out / "02-match-summary.md",
        tsp_rows,
        local_rows,
        village_rows,
        extra_local,
        extra_village,
        core["fk_counts"],
    )

    print(
        f"done local_actions={Counter(r['action'] for r in local_rows)} "
        f"village_actions={Counter(r['action'] for r in village_rows)}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
