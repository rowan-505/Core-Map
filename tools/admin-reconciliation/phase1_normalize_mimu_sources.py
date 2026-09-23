#!/usr/bin/env python3
"""Phase 1: normalize frozen MIMU ward / village-tract / village sources.

Read-only against PostgreSQL. Uses only local frozen files under
data/local/admin-reconciliation/mimu/v9.7/.

MIMU PCodes are local audit keys only — never prepared as CoreMap external_id.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from osgeo import gdal, ogr, osr

gdal.UseExceptions()
ogr.UseExceptions()
osr.UseExceptions()

csv.field_size_limit(100_000_000)

# Myanmar mainland + islands approx (WGS84). Slightly padded.
MYANMAR_BBOX = (92.1, 9.4, 101.3, 28.7)
# Reject MakeValid when absolute area change exceeds this fraction.
AREA_REPAIR_TOLERANCE = 0.01
# Sibling township buffer in degrees (~110 m).
SIBLING_BUFFER_DEG = 0.001

SYNTHETIC_WARD_RE = re.compile(
    r"(^|\s)-{2,}.*\bward\b|\b----\s*ward\b|^\s*-{3,}\s*$",
    re.IGNORECASE,
)
WARD_LABEL_RE = re.compile(r"\bward\b|ရပ်ကွက်", re.IGNORECASE)


@dataclass
class BoundaryRecord:
    entity_type: str  # ward | village_tract
    region: str
    source_file: str
    source_version: str
    source_pcode: str
    name_en: str
    name_my: str
    st_pcode: str
    st_name: str
    dt_pcode: str
    dt_name: str
    ts_pcode: str
    ts_name: str
    town_pcode: str
    town_name: str
    parent_path: str
    geom_wkb: bytes | None = None
    geom_type: str = ""
    srid: int | None = None
    area_m2: float | None = None
    bbox: tuple[float, float, float, float] | None = None
    pos_lon: float | None = None
    pos_lat: float | None = None
    status: str = "ok"  # ok | invalid | excluded
    invalid_reasons: list[str] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)
    source_row: int = 0


@dataclass
class VillageRecord:
    region: str
    source_file: str
    source_version: str
    source_pcode: str
    name_en: str
    name_my: str
    alt_en: str
    alt_my: str
    st_pcode: str
    st_name: str
    dt_pcode: str
    dt_name: str
    ts_pcode: str
    ts_name: str
    vt_pcode: str
    vt_name: str
    parent_path: str
    lon: float | None = None
    lat: float | None = None
    status: str = "ok"
    invalid_reasons: list[str] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)
    source_row: int = 0


def clean(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and math.isnan(value):
        return ""
    text = str(value).strip()
    if text.lower() in {"none", "null", "nan"}:
        return ""
    return text


def fmt_pcode(value: Any) -> str:
    """Format source PCode for audit keys only (not CoreMap external_id)."""
    if value is None:
        return ""
    if isinstance(value, float):
        if math.isnan(value):
            return ""
        if value.is_integer():
            return str(int(value))
        return clean(value)
    text = clean(value)
    if re.fullmatch(r"\d+\.0+", text):
        return text.split(".", 1)[0]
    return text


def open_zip_layer(zip_path: Path) -> tuple[ogr.DataSource, ogr.Layer, str]:
    with zipfile.ZipFile(zip_path) as zf:
        shps = [n for n in zf.namelist() if n.lower().endswith(".shp")]
    if not shps:
        raise FileNotFoundError(f"No .shp inside {zip_path}")
    shp = shps[0]
    ds = ogr.Open(f"/vsizip/{zip_path}/{shp}")
    if ds is None:
        raise RuntimeError(f"OGR failed to open {zip_path}")
    layer = ds.GetLayer(0)
    return ds, layer, shp


def wgs84_srs() -> osr.SpatialReference:
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(4326)
    srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    return srs


def equal_area_srs() -> osr.SpatialReference:
    # EPSG:6933 World Cylindrical Equal Area — stable area measure.
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(6933)
    srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    return srs


def ensure_wgs84(geom: ogr.Geometry, layer_srs: osr.SpatialReference | None) -> ogr.Geometry:
    out = geom.Clone()
    src = layer_srs
    if src is None:
        src = out.GetSpatialReference()
    dst = wgs84_srs()
    if src is None:
        out.AssignSpatialReference(dst)
        return out
    src_clone = src.Clone()
    src_clone.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    if src_clone.IsSame(dst):
        out.AssignSpatialReference(dst)
        return out
    out.Transform(osr.CoordinateTransformation(src_clone, dst))
    out.AssignSpatialReference(dst)
    return out


def area_m2(geom: ogr.Geometry) -> float | None:
    if geom is None or geom.IsEmpty():
        return None
    try:
        g = geom.Clone()
        src = g.GetSpatialReference() or wgs84_srs()
        src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        g.Transform(osr.CoordinateTransformation(src, equal_area_srs()))
        return float(g.GetArea())
    except Exception:
        return None


def geom_bbox(geom: ogr.Geometry) -> tuple[float, float, float, float]:
    minx, maxx, miny, maxy = geom.GetEnvelope()
    return (float(minx), float(miny), float(maxx), float(maxy))


def point_on_surface(geom: ogr.Geometry) -> tuple[float, float] | None:
    try:
        pos = geom.PointOnSurface()
        if pos is None or pos.IsEmpty():
            pos = geom.Centroid()
        if pos is None or pos.IsEmpty():
            return None
        return (float(pos.GetX()), float(pos.GetY()))
    except Exception:
        return None


def in_myanmar(lon: float, lat: float) -> bool:
    minx, miny, maxx, maxy = MYANMAR_BBOX
    return minx <= lon <= maxx and miny <= lat <= maxy


def polygonize(geom: ogr.Geometry) -> ogr.Geometry | None:
    """Accept Polygon/MultiPolygon only. Extract from collections when needed."""
    if geom is None:
        return None
    name = geom.GetGeometryName().upper()
    if name in {"POLYGON", "MULTIPOLYGON"}:
        return geom.Clone()
    if name in {"GEOMETRYCOLLECTION", "MULTIGEOMETRY"}:
        extracted = geom.CollectionExtract(ogr.wkbPolygon)
        if extracted is None or extracted.IsEmpty():
            return None
        # Prefer MultiPolygon container
        if extracted.GetGeometryName().upper() == "POLYGON":
            multi = ogr.Geometry(ogr.wkbMultiPolygon)
            multi.AddGeometry(extracted)
            return multi
        return extracted
    return None


def try_validate_polygon(geom: ogr.Geometry) -> tuple[ogr.Geometry | None, list[str]]:
    """Return accepted polygon and reasons if rejected.

    Does not silently keep a MakeValid result when area changes materially.
    """
    reasons: list[str] = []
    if geom is None:
        return None, ["null_geometry"]
    if geom.IsEmpty():
        return None, ["empty_geometry"]

    poly = polygonize(geom)
    if poly is None:
        return None, [f"unsupported_geometry:{geom.GetGeometryName()}"]

    if poly.IsValid():
        return poly, []

    reasons.append("invalid_geometry")
    before = area_m2(poly)
    try:
        repaired = poly.MakeValid()
    except Exception as exc:
        reasons.append(f"make_valid_failed:{exc}")
        return None, reasons

    repaired_poly = polygonize(repaired) if repaired is not None else None
    if repaired_poly is None or repaired_poly.IsEmpty():
        reasons.append("make_valid_empty_or_non_polygon")
        return None, reasons

    after = area_m2(repaired_poly)
    if before is None or after is None or before <= 0:
        reasons.append("make_valid_area_unreliable")
        return None, reasons

    delta = abs(after - before) / before
    if delta > AREA_REPAIR_TOLERANCE:
        reasons.append(f"make_valid_area_change:{delta:.4f}")
        return None, reasons

    if not repaired_poly.IsValid():
        reasons.append("make_valid_still_invalid")
        return None, reasons

    # Immaterial repair accepted.
    return repaired_poly, []


def is_synthetic_ward_name(name_en: str, name_my: str) -> bool:
    for value in (name_en, name_my):
        if not value:
            continue
        if SYNTHETIC_WARD_RE.search(value):
            return True
        if value.replace("-", "").strip() == "":
            return True
    return False


def looks_like_ward_label(name_en: str, name_my: str) -> bool:
    """True when the row is labeled as a ward, not a village settlement."""
    en = name_en.strip()
    my = name_my.strip()
    if is_synthetic_ward_name(en, my):
        return True
    if re.search(r"\bward\b", en, re.IGNORECASE):
        return True
    if "ရပ်ကွက်" in my:
        return True
    return False


def parent_path(*parts: str) -> str:
    return " > ".join(p for p in parts if p)


def iter_boundary_zips(root: Path) -> list[tuple[str, str, Path]]:
    """Return (entity_type, region, zip_path)."""
    out: list[tuple[str, str, Path]] = []
    ward = root / "ward" / "ward_boundary_countrywide_v94.zip"
    if ward.exists():
        out.append(("ward", "countrywide", ward))
    for path in sorted((root / "village_tract").glob("village_tract_boundary_*_v94.zip")):
        region = path.stem.replace("village_tract_boundary_", "").replace("_v94", "").replace("_", " ")
        out.append(("village_tract", region, path))
    return out


def iter_village_zips(root: Path) -> list[tuple[str, Path]]:
    out: list[tuple[str, Path]] = []
    for path in sorted((root / "village_points").glob("village_point_*_v96.zip")):
        region = path.stem.replace("village_point_", "").replace("_v96", "").replace("_", " ")
        out.append((region, path))
    return out


def load_boundaries(root: Path) -> list[BoundaryRecord]:
    records: list[BoundaryRecord] = []
    for entity_type, region, zip_path in iter_boundary_zips(root):
        ds, layer, shp_name = open_zip_layer(zip_path)
        layer_srs = layer.GetSpatialRef()
        for idx, feature in enumerate(layer, start=1):
            props = {layer.GetLayerDefn().GetFieldDefn(i).GetName(): feature.GetField(i)
                     for i in range(layer.GetLayerDefn().GetFieldCount())}

            if entity_type == "ward":
                source_pcode = fmt_pcode(props.get("WARD_PCODE"))
                name_en = clean(props.get("WARD"))
                name_my = clean(props.get("WARD_MMR"))
                town_pcode = fmt_pcode(props.get("TOWN_PCODE"))
                town_name = clean(props.get("TOWN"))
                version = clean(props.get("PCode_V")) or "9.4"
            else:
                source_pcode = fmt_pcode(props.get("VT_PCODE"))
                name_en = clean(props.get("VT"))
                name_my = clean(props.get("VT_MMR"))
                town_pcode = ""
                town_name = ""
                version = clean(props.get("Pcode_V") or props.get("PCODE_V")) or "9.4"

            st_pcode = fmt_pcode(props.get("ST_PCODE"))
            st_name = clean(props.get("ST"))
            dt_pcode = fmt_pcode(props.get("DT_PCODE"))
            dt_name = clean(props.get("DT"))
            ts_pcode = fmt_pcode(props.get("TS_PCODE"))
            ts_name = clean(props.get("TS"))

            # Prefer attribute region for countrywide ward layer.
            feature_region = st_name or region

            rec = BoundaryRecord(
                entity_type=entity_type,
                region=feature_region,
                source_file=f"{zip_path.name}:{shp_name}",
                source_version=version,
                source_pcode=source_pcode,
                name_en=name_en,
                name_my=name_my,
                st_pcode=st_pcode,
                st_name=st_name,
                dt_pcode=dt_pcode,
                dt_name=dt_name,
                ts_pcode=ts_pcode,
                ts_name=ts_name,
                town_pcode=town_pcode,
                town_name=town_name,
                parent_path=parent_path(st_name, dt_name, ts_name, town_name),
                source_row=idx,
            )

            raw = feature.GetGeometryRef()
            if raw is None:
                rec.status = "invalid"
                rec.invalid_reasons.append("null_geometry")
                records.append(rec)
                continue

            try:
                wgs = ensure_wgs84(raw, layer_srs)
            except Exception as exc:
                rec.status = "invalid"
                rec.invalid_reasons.append(f"reproject_failed:{exc}")
                records.append(rec)
                continue

            accepted, reasons = try_validate_polygon(wgs)
            if accepted is None:
                rec.status = "invalid"
                rec.invalid_reasons.extend(reasons)
                rec.geom_type = wgs.GetGeometryName()
                records.append(rec)
                continue

            rec.geom_wkb = accepted.ExportToWkb()
            rec.geom_type = accepted.GetGeometryName()
            rec.srid = 4326
            rec.area_m2 = area_m2(accepted)
            rec.bbox = geom_bbox(accepted)
            pos = point_on_surface(accepted)
            if pos:
                rec.pos_lon, rec.pos_lat = pos
                if not in_myanmar(pos[0], pos[1]):
                    rec.flags.append("outside_myanmar")
            else:
                rec.flags.append("missing_point_on_surface")

            if not source_pcode:
                rec.flags.append("missing_source_pcode")
            if not ts_pcode:
                rec.flags.append("missing_township_pcode")
            if not name_en and not name_my:
                rec.flags.append("missing_name")

            records.append(rec)
        ds = None  # noqa: F841 — close datasource
    return records


def load_villages(root: Path) -> list[VillageRecord]:
    records: list[VillageRecord] = []
    for region, zip_path in iter_village_zips(root):
        ds, layer, shp_name = open_zip_layer(zip_path)
        layer_srs = layer.GetSpatialRef()
        for idx, feature in enumerate(layer, start=1):
            props = {layer.GetLayerDefn().GetFieldDefn(i).GetName(): feature.GetField(i)
                     for i in range(layer.GetLayerDefn().GetFieldCount())}

            name_en = clean(props.get("VILLAGE"))
            name_my = clean(props.get("VLG_MMR"))
            alt_en = clean(props.get("ALTVLG_ENG"))
            alt_my = clean(props.get("ALTVLG_MMR"))
            source_pcode = fmt_pcode(props.get("VLG_PCODE"))
            st_pcode = fmt_pcode(props.get("ST_PCODE"))
            st_name = clean(props.get("ST"))
            dt_pcode = fmt_pcode(props.get("DT_PCODE"))
            dt_name = clean(props.get("DT"))
            ts_pcode = fmt_pcode(props.get("TS_PCODE"))
            ts_name = clean(props.get("TS"))
            vt_pcode = fmt_pcode(props.get("VT_PCODE"))
            vt_name = clean(props.get("VT"))
            version = clean(props.get("PCODE_V")) or "9.6"

            rec = VillageRecord(
                region=st_name or region,
                source_file=f"{zip_path.name}:{shp_name}",
                source_version=version,
                source_pcode=source_pcode,
                name_en=name_en,
                name_my=name_my,
                alt_en=alt_en,
                alt_my=alt_my,
                st_pcode=st_pcode,
                st_name=st_name,
                dt_pcode=dt_pcode,
                dt_name=dt_name,
                ts_pcode=ts_pcode,
                ts_name=ts_name,
                vt_pcode=vt_pcode,
                vt_name=vt_name,
                parent_path=parent_path(st_name, dt_name, ts_name, vt_name),
                source_row=idx,
            )

            if is_synthetic_ward_name(name_en, name_my):
                rec.status = "excluded"
                rec.invalid_reasons.append("synthetic_ward_row")
                records.append(rec)
                continue

            if looks_like_ward_label(name_en, name_my):
                rec.status = "excluded"
                rec.invalid_reasons.append("ward_label_not_village")
                records.append(rec)
                continue

            if not name_en and not name_my:
                rec.status = "invalid"
                rec.invalid_reasons.append("missing_name")

            raw = feature.GetGeometryRef()
            if raw is None:
                # Fall back to Lon/Lat columns when present.
                lon = props.get("Longitude")
                lat = props.get("Latitude")
                try:
                    if lon is not None and lat is not None:
                        raw = ogr.Geometry(ogr.wkbPoint)
                        raw.AddPoint(float(lon), float(lat))
                except Exception:
                    raw = None

            if raw is None:
                rec.status = "invalid"
                rec.invalid_reasons.append("null_geometry")
                records.append(rec)
                continue

            gname = raw.GetGeometryName().upper()
            if gname != "POINT":
                # Accept single-point MultiPoint by exploding.
                if gname == "MULTIPOINT" and raw.GetGeometryCount() == 1:
                    raw = raw.GetGeometryRef(0).Clone()
                else:
                    rec.status = "invalid"
                    rec.invalid_reasons.append(f"unsupported_geometry:{gname}")
                    records.append(rec)
                    continue

            try:
                wgs = ensure_wgs84(raw, layer_srs)
            except Exception as exc:
                rec.status = "invalid"
                rec.invalid_reasons.append(f"reproject_failed:{exc}")
                records.append(rec)
                continue

            if wgs.IsEmpty():
                rec.status = "invalid"
                rec.invalid_reasons.append("empty_geometry")
                records.append(rec)
                continue

            lon, lat = float(wgs.GetX()), float(wgs.GetY())
            rec.lon, rec.lat = lon, lat
            if not in_myanmar(lon, lat):
                rec.flags.append("outside_myanmar")
            if not source_pcode:
                rec.flags.append("missing_source_pcode")
            if not ts_pcode:
                rec.flags.append("missing_township_pcode")
            if not vt_pcode:
                rec.flags.append("missing_village_tract_pcode")

            if rec.status != "invalid":
                rec.status = "ok"
            records.append(rec)
        ds = None  # noqa: F841
    return records


def build_township_refs(boundaries: list[BoundaryRecord]) -> dict[str, dict[str, Any]]:
    """Build per-township envelope + multipoint refs from accepted boundary POS/bbox.

    Full polygon dissolve is expensive at national scale. Phase 1 uses:
    - bbox envelope of all accepted ward/VT polygons in the township
    - POS multipoint for sibling outlier checks
    Villages are tested against the township envelope (buffered).
    """
    refs: dict[str, dict[str, Any]] = {}
    for rec in boundaries:
        if rec.status != "ok" or not rec.ts_pcode or not rec.bbox:
            continue
        slot = refs.setdefault(
            rec.ts_pcode,
            {"minx": None, "miny": None, "maxx": None, "maxy": None, "positions": []},
        )
        minx, miny, maxx, maxy = rec.bbox
        slot["minx"] = minx if slot["minx"] is None else min(slot["minx"], minx)
        slot["miny"] = miny if slot["miny"] is None else min(slot["miny"], miny)
        slot["maxx"] = maxx if slot["maxx"] is None else max(slot["maxx"], maxx)
        slot["maxy"] = maxy if slot["maxy"] is None else max(slot["maxy"], maxy)
        if rec.pos_lon is not None and rec.pos_lat is not None:
            slot["positions"].append((rec.pos_lon, rec.pos_lat))
    return refs


def _envelope_contains(ref: dict[str, Any], lon: float, lat: float, pad: float) -> bool:
    return (
        ref["minx"] - pad <= lon <= ref["maxx"] + pad
        and ref["miny"] - pad <= lat <= ref["maxy"] + pad
    )


def _sibling_pos_outlier(positions: list[tuple[float, float]], lon: float, lat: float) -> bool:
    """True when this POS is far from every other township POS."""
    others = list(positions)
    for i, (x, y) in enumerate(others):
        if abs(x - lon) < 1e-12 and abs(y - lat) < 1e-12:
            others.pop(i)
            break
    if not others:
        return False
    nearest = min(math.hypot(lon - x, lat - y) for x, y in others)
    # Adaptive threshold: 3x median nearest-neighbor among siblings, floor 0.05°.
    sibling_nn: list[float] = []
    for i, (x0, y0) in enumerate(others):
        rest = [math.hypot(x0 - x1, y0 - y1) for j, (x1, y1) in enumerate(others) if i != j]
        if rest:
            sibling_nn.append(min(rest))
    if sibling_nn:
        sibling_nn_sorted = sorted(sibling_nn)
        median_nn = sibling_nn_sorted[len(sibling_nn_sorted) // 2]
        threshold = max(0.05, 3.0 * median_nn)
    else:
        threshold = 0.05
    return nearest > threshold


def flag_outside_township(
    boundaries: list[BoundaryRecord],
    villages: list[VillageRecord],
) -> None:
    township_refs = build_township_refs(boundaries)

    for rec in boundaries:
        if rec.status != "ok":
            continue
        if not rec.ts_pcode:
            rec.flags.append("township_unresolved")
            continue
        ref = township_refs.get(rec.ts_pcode)
        if ref is None:
            rec.flags.append("township_geom_missing")
            continue
        if rec.pos_lon is None or rec.pos_lat is None:
            continue
        if not _envelope_contains(ref, rec.pos_lon, rec.pos_lat, SIBLING_BUFFER_DEG):
            rec.flags.append("outside_source_township")
            continue
        if _sibling_pos_outlier(ref["positions"], rec.pos_lon, rec.pos_lat):
            rec.flags.append("outside_source_township")

    for rec in villages:
        if rec.status != "ok":
            continue
        if not rec.ts_pcode:
            rec.flags.append("township_unresolved")
            continue
        ref = township_refs.get(rec.ts_pcode)
        if ref is None:
            rec.flags.append("township_geom_missing")
            continue
        if rec.lon is None or rec.lat is None:
            continue
        if not _envelope_contains(ref, rec.lon, rec.lat, SIBLING_BUFFER_DEG):
            rec.flags.append("outside_source_township")


def detect_boundary_duplicates(records: list[BoundaryRecord]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    by_pcode: dict[tuple[str, str], list[BoundaryRecord]] = defaultdict(list)
    by_wkb: dict[tuple[str, str], list[BoundaryRecord]] = defaultdict(list)

    for rec in records:
        if rec.status not in {"ok", "invalid"}:
            continue
        if rec.source_pcode:
            by_pcode[(rec.entity_type, rec.source_pcode)].append(rec)
        if rec.geom_wkb:
            digest = hashlib.sha256(rec.geom_wkb).hexdigest()
            by_wkb[(rec.entity_type, digest)].append(rec)

    for (entity_type, pcode), group in by_pcode.items():
        if len(group) < 2:
            continue
        for rec in group:
            rows.append({
                "entity_type": entity_type,
                "duplicate_kind": "repeated_source_pcode",
                "source_pcode": pcode,
                "region": rec.region,
                "name_en": rec.name_en,
                "name_my": rec.name_my,
                "ts_pcode": rec.ts_pcode,
                "source_file": rec.source_file,
                "source_row": str(rec.source_row),
                "count_in_group": str(len(group)),
                "note": "Same MIMU audit PCode appears more than once",
            })

    for (entity_type, digest), group in by_wkb.items():
        if len(group) < 2:
            continue
        # Skip if already same pcode group of identical size (same records)
        pcodes = {r.source_pcode for r in group}
        kind = "duplicate_geometry_same_pcode" if len(pcodes) == 1 else "duplicate_geometry_different_pcode"
        for rec in group:
            rows.append({
                "entity_type": entity_type,
                "duplicate_kind": kind,
                "source_pcode": rec.source_pcode,
                "region": rec.region,
                "name_en": rec.name_en,
                "name_my": rec.name_my,
                "ts_pcode": rec.ts_pcode,
                "source_file": rec.source_file,
                "source_row": str(rec.source_row),
                "count_in_group": str(len(group)),
                "note": f"Identical WKB sha256={digest[:12]}",
            })
    return rows


def detect_village_duplicates(records: list[VillageRecord]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    by_pcode: dict[str, list[VillageRecord]] = defaultdict(list)
    by_xy: dict[tuple[str, str, str], list[VillageRecord]] = defaultdict(list)
    by_identity: dict[tuple[str, str, str, str], list[VillageRecord]] = defaultdict(list)

    for rec in records:
        if rec.status == "excluded":
            continue
        if rec.source_pcode:
            by_pcode[rec.source_pcode].append(rec)
        if rec.lon is not None and rec.lat is not None:
            key = (f"{rec.lon:.7f}", f"{rec.lat:.7f}", rec.ts_pcode)
            by_xy[key].append(rec)
        identity = (
            rec.name_en.casefold(),
            rec.name_my,
            rec.ts_pcode,
            rec.vt_pcode,
        )
        if rec.name_en or rec.name_my:
            by_identity[identity].append(rec)

    for pcode, group in by_pcode.items():
        if len(group) < 2:
            continue
        for rec in group:
            rows.append({
                "entity_type": "village",
                "duplicate_kind": "repeated_source_pcode",
                "source_pcode": pcode,
                "region": rec.region,
                "name_en": rec.name_en,
                "name_my": rec.name_my,
                "ts_pcode": rec.ts_pcode,
                "source_file": rec.source_file,
                "source_row": str(rec.source_row),
                "count_in_group": str(len(group)),
                "note": "Same MIMU village audit PCode appears more than once",
            })

    for key, group in by_xy.items():
        if len(group) < 2:
            continue
        for rec in group:
            rows.append({
                "entity_type": "village",
                "duplicate_kind": "duplicate_coordinates",
                "source_pcode": rec.source_pcode,
                "region": rec.region,
                "name_en": rec.name_en,
                "name_my": rec.name_my,
                "ts_pcode": rec.ts_pcode,
                "source_file": rec.source_file,
                "source_row": str(rec.source_row),
                "count_in_group": str(len(group)),
                "note": f"Same lon/lat under township {key[2]}",
            })

    for key, group in by_identity.items():
        if len(group) < 2:
            continue
        # If same pcode already counted, still record identity dup when coords differ
        pcodes = {r.source_pcode for r in group}
        if len(pcodes) == 1 and len(group) == len(by_pcode.get(next(iter(pcodes)), [])):
            continue
        for rec in group:
            rows.append({
                "entity_type": "village",
                "duplicate_kind": "duplicate_identity",
                "source_pcode": rec.source_pcode,
                "region": rec.region,
                "name_en": rec.name_en,
                "name_my": rec.name_my,
                "ts_pcode": rec.ts_pcode,
                "source_file": rec.source_file,
                "source_row": str(rec.source_row),
                "count_in_group": str(len(group)),
                "note": "Same name + township + village-tract context",
            })
    return rows


def write_invalid_csv(
    path: Path,
    boundaries: list[BoundaryRecord],
    villages: list[VillageRecord],
) -> int:
    fields = [
        "entity_type", "status", "region", "source_pcode", "name_en", "name_my",
        "ts_pcode", "vt_pcode", "source_file", "source_row", "reasons", "flags",
        "lon", "lat",
    ]
    rows: list[dict[str, str]] = []
    for rec in boundaries:
        notable = [f for f in rec.flags if f in {
            "outside_myanmar", "outside_source_township", "township_geom_missing", "township_unresolved",
        }]
        if rec.status == "ok" and not rec.invalid_reasons and not notable:
            continue
        if rec.status in {"invalid", "excluded"} or rec.invalid_reasons or notable:
            rows.append({
                "entity_type": rec.entity_type,
                "status": rec.status if rec.status != "ok" else "flagged",
                "region": rec.region,
                "source_pcode": rec.source_pcode,
                "name_en": rec.name_en,
                "name_my": rec.name_my,
                "ts_pcode": rec.ts_pcode,
                "vt_pcode": "",
                "source_file": rec.source_file,
                "source_row": str(rec.source_row),
                "reasons": "|".join(rec.invalid_reasons) or "|".join(notable),
                "flags": "|".join(rec.flags),
                "lon": "" if rec.pos_lon is None else f"{rec.pos_lon:.8f}",
                "lat": "" if rec.pos_lat is None else f"{rec.pos_lat:.8f}",
            })

    for rec in villages:
        report = rec.status in {"invalid", "excluded"} or bool(rec.invalid_reasons)
        notable_flags = [f for f in rec.flags if f in {
            "outside_myanmar", "outside_source_township", "township_geom_missing", "township_unresolved",
        }]
        if notable_flags:
            report = True
        if not report:
            continue
        rows.append({
            "entity_type": "village",
            "status": rec.status if rec.status != "ok" else "flagged",
            "region": rec.region,
            "source_pcode": rec.source_pcode,
            "name_en": rec.name_en,
            "name_my": rec.name_my,
            "ts_pcode": rec.ts_pcode,
            "vt_pcode": rec.vt_pcode,
            "source_file": rec.source_file,
            "source_row": str(rec.source_row),
            "reasons": "|".join(rec.invalid_reasons) or "|".join(notable_flags),
            "flags": "|".join(rec.flags),
            "lon": "" if rec.lon is None else f"{rec.lon:.8f}",
            "lat": "" if rec.lat is None else f"{rec.lat:.8f}",
        })

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    return len(rows)


def write_duplicates_csv(path: Path, rows: list[dict[str, str]]) -> None:
    fields = [
        "entity_type", "duplicate_kind", "source_pcode", "region", "name_en", "name_my",
        "ts_pcode", "source_file", "source_row", "count_in_group", "note",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def write_wards_geojson(path: Path, records: Iterable[BoundaryRecord]) -> int:
    features = []
    count = 0
    for rec in records:
        if rec.entity_type != "ward" or rec.status != "ok" or not rec.geom_wkb:
            continue
        geom = ogr.CreateGeometryFromWkb(rec.geom_wkb)
        features.append({
            "type": "Feature",
            "geometry": json.loads(geom.ExportToJson()),
            "properties": {
                "entity_type": "ward",
                "source_pcode": rec.source_pcode,
                "name_en": rec.name_en,
                "name_my": rec.name_my,
                "region": rec.region,
                "st_pcode": rec.st_pcode,
                "st_name": rec.st_name,
                "dt_pcode": rec.dt_pcode,
                "dt_name": rec.dt_name,
                "ts_pcode": rec.ts_pcode,
                "ts_name": rec.ts_name,
                "town_pcode": rec.town_pcode,
                "town_name": rec.town_name,
                "parent_path": rec.parent_path,
                "source_version": rec.source_version,
                "source_file": rec.source_file,
                "srid": 4326,
                "area_m2": None if rec.area_m2 is None else round(rec.area_m2, 2),
                "bbox": list(rec.bbox) if rec.bbox else None,
                "pos_lon": rec.pos_lon,
                "pos_lat": rec.pos_lat,
                "flags": rec.flags,
                # Explicit: audit key only — not a CoreMap external_id.
                "mimu_audit_pcode": rec.source_pcode,
            },
        })
        count += 1
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False), encoding="utf-8")
    return count


def write_vt_geojson(path: Path, records: Iterable[BoundaryRecord]) -> int:
    features = []
    count = 0
    for rec in records:
        if rec.entity_type != "village_tract" or rec.status != "ok" or not rec.geom_wkb:
            continue
        geom = ogr.CreateGeometryFromWkb(rec.geom_wkb)
        features.append({
            "type": "Feature",
            "geometry": json.loads(geom.ExportToJson()),
            "properties": {
                "entity_type": "village_tract",
                "source_pcode": rec.source_pcode,
                "name_en": rec.name_en,
                "name_my": rec.name_my,
                "region": rec.region,
                "st_pcode": rec.st_pcode,
                "st_name": rec.st_name,
                "dt_pcode": rec.dt_pcode,
                "dt_name": rec.dt_name,
                "ts_pcode": rec.ts_pcode,
                "ts_name": rec.ts_name,
                "parent_path": rec.parent_path,
                "source_version": rec.source_version,
                "source_file": rec.source_file,
                "srid": 4326,
                "area_m2": None if rec.area_m2 is None else round(rec.area_m2, 2),
                "bbox": list(rec.bbox) if rec.bbox else None,
                "pos_lon": rec.pos_lon,
                "pos_lat": rec.pos_lat,
                "flags": rec.flags,
                "mimu_audit_pcode": rec.source_pcode,
            },
        })
        count += 1
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False), encoding="utf-8")
    return count


def write_villages_csv(path: Path, records: Iterable[VillageRecord]) -> int:
    fields = [
        "entity_type", "status", "region", "source_pcode", "mimu_audit_pcode",
        "name_en", "name_my", "alt_en", "alt_my",
        "st_pcode", "st_name", "dt_pcode", "dt_name",
        "ts_pcode", "ts_name", "vt_pcode", "vt_name", "parent_path",
        "lon", "lat", "srid", "source_version", "source_file", "source_row", "flags",
    ]
    rows = []
    for rec in records:
        if rec.status != "ok":
            continue
        rows.append({
            "entity_type": "village",
            "status": rec.status,
            "region": rec.region,
            "source_pcode": rec.source_pcode,
            "mimu_audit_pcode": rec.source_pcode,
            "name_en": rec.name_en,
            "name_my": rec.name_my,
            "alt_en": rec.alt_en,
            "alt_my": rec.alt_my,
            "st_pcode": rec.st_pcode,
            "st_name": rec.st_name,
            "dt_pcode": rec.dt_pcode,
            "dt_name": rec.dt_name,
            "ts_pcode": rec.ts_pcode,
            "ts_name": rec.ts_name,
            "vt_pcode": rec.vt_pcode,
            "vt_name": rec.vt_name,
            "parent_path": rec.parent_path,
            "lon": "" if rec.lon is None else f"{rec.lon:.8f}",
            "lat": "" if rec.lat is None else f"{rec.lat:.8f}",
            "srid": "4326",
            "source_version": rec.source_version,
            "source_file": rec.source_file,
            "source_row": str(rec.source_row),
            "flags": "|".join(rec.flags),
        })
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    return len(rows)


def grouped_counts(
    boundaries: list[BoundaryRecord],
    villages: list[VillageRecord],
) -> list[tuple[str, str, str, int]]:
    """Return rows of (region, entity_type, status, count)."""
    counter: Counter[tuple[str, str, str]] = Counter()
    for rec in boundaries:
        counter[(rec.region or "(blank)", rec.entity_type, rec.status)] += 1
    for rec in villages:
        counter[(rec.region or "(blank)", "village", rec.status)] += 1
    return sorted((r, e, s, c) for (r, e, s), c in counter.items())


def write_summary(
    path: Path,
    source_root: Path,
    boundaries: list[BoundaryRecord],
    villages: list[VillageRecord],
    dup_rows: list[dict[str, str]],
    invalid_count: int,
    ward_out: int,
    vt_out: int,
    village_out: int,
) -> None:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    wards = [r for r in boundaries if r.entity_type == "ward"]
    vts = [r for r in boundaries if r.entity_type == "village_tract"]

    def status_counts(rows: list[Any]) -> Counter[str]:
        return Counter(r.status for r in rows)

    flag_counter: Counter[str] = Counter()
    for rec in boundaries + villages:  # type: ignore[operator]
        for flag in rec.flags:
            flag_counter[f"{getattr(rec, 'entity_type', 'village')}:{flag}"] += 1

    outside_ts = {
        "ward": sum(1 for r in wards if "outside_source_township" in r.flags),
        "village_tract": sum(1 for r in vts if "outside_source_township" in r.flags),
        "village": sum(1 for r in villages if "outside_source_township" in r.flags),
    }
    outside_mm = {
        "ward": sum(1 for r in wards if "outside_myanmar" in r.flags),
        "village_tract": sum(1 for r in vts if "outside_myanmar" in r.flags),
        "village": sum(1 for r in villages if "outside_myanmar" in r.flags),
    }
    missing_ts = {
        "ward": sum(1 for r in wards if "township_geom_missing" in r.flags),
        "village_tract": sum(1 for r in vts if "township_geom_missing" in r.flags),
        "village": sum(1 for r in villages if "township_geom_missing" in r.flags),
    }

    lines: list[str] = []
    lines.append("# Admin reconciliation v2 — Phase 1 source normalization")
    lines.append("")
    lines.append(f"**Generated:** {now}")
    lines.append(f"**Source root:** `{source_root}`")
    lines.append("**Database writes:** none")
    lines.append("")
    lines.append("MIMU PCodes are retained only as `source_pcode` / `mimu_audit_pcode` audit keys.")
    lines.append("They are not prepared as CoreMap `external_id` values.")
    lines.append("")
    lines.append("## Inputs")
    lines.append("")
    lines.append("| Population | Frozen inputs | Source version on disk |")
    lines.append("|---|---|---|")
    lines.append("| Ward boundaries | `ward/ward_boundary_countrywide_v94.zip` | 9.4 |")
    lines.append("| Village-tract boundaries | `village_tract/*_v94.zip` (15 regions) | 9.4 |")
    lines.append("| Village points | `village_points/*_v96.zip` (15 regions) | 9.6 layer / attrs may say 9.7 |")
    lines.append("")
    lines.append("## Output totals")
    lines.append("")
    lines.append("| Output | Count |")
    lines.append("|---|---:|")
    lines.append(f"| Accepted wards → `01-wards-normalized.geojson` | {ward_out} |")
    lines.append(f"| Accepted village tracts → `01-village-tracts-normalized.geojson` | {vt_out} |")
    lines.append(f"| Accepted villages → `01-villages-normalized.csv` | {village_out} |")
    lines.append(f"| Invalid / excluded / outside-Myanmar rows → `01-source-invalid.csv` | {invalid_count} |")
    lines.append(f"| Duplicate report rows → `01-source-duplicates.csv` | {len(dup_rows)} |")
    lines.append("")
    lines.append("## Status by entity type")
    lines.append("")
    lines.append("| Entity | ok | invalid | excluded | input rows |")
    lines.append("|---|---:|---:|---:|---:|")
    for label, rows in (("ward", wards), ("village_tract", vts), ("village", villages)):
        c = status_counts(rows)
        lines.append(
            f"| {label} | {c.get('ok', 0)} | {c.get('invalid', 0)} | {c.get('excluded', 0)} | {len(rows)} |"
        )
    lines.append("")
    lines.append("## Spatial flags")
    lines.append("")
    lines.append("| Flag | ward | village_tract | village |")
    lines.append("|---|---:|---:|---:|")
    lines.append(
        f"| outside_source_township | {outside_ts['ward']} | {outside_ts['village_tract']} | {outside_ts['village']} |"
    )
    lines.append(
        f"| township_geom_missing | {missing_ts['ward']} | {missing_ts['village_tract']} | {missing_ts['village']} |"
    )
    lines.append(
        f"| outside_myanmar | {outside_mm['ward']} | {outside_mm['village_tract']} | {outside_mm['village']} |"
    )
    lines.append("")
    lines.append("Township containment:")
    lines.append("")
    lines.append("- No independent township boundary layer was present in the Phase 0 freeze.")
    lines.append("- Per-township envelope is built from accepted ward + village-tract bboxes sharing `TS_PCODE`.")
    lines.append("- Village points outside that envelope (pad ~0.001°) are flagged `outside_source_township`.")
    lines.append("- Boundary POS outside the envelope, or far from sibling POS cluster, is flagged the same way.")
    lines.append("")
    lines.append("Geometry rules:")
    lines.append("")
    lines.append("- Working CRS: EPSG:4326.")
    lines.append("- Boundaries: Polygon/MultiPolygon only.")
    lines.append("- Villages: Point only.")
    lines.append(f"- `MakeValid` kept only when area change ≤ {AREA_REPAIR_TOLERANCE:.0%}; otherwise row is invalid.")
    lines.append("- Synthetic / ward-label village rows are excluded (e.g. `----Ward`, names containing Ward/ရပ်ကွက်).")
    lines.append("")
    lines.append("## Counts by region and entity type")
    lines.append("")
    lines.append("| Region | Entity | Status | Count |")
    lines.append("|---|---|---|---:|")
    for region, entity, status, count in grouped_counts(boundaries, villages):
        lines.append(f"| {region} | {entity} | {status} | {count} |")
    lines.append("")
    lines.append("## Duplicate kinds")
    lines.append("")
    kind_counts = Counter(r["duplicate_kind"] for r in dup_rows)
    if not kind_counts:
        lines.append("No duplicate groups detected.")
    else:
        lines.append("| Kind | Rows |")
        lines.append("|---|---:|")
        for kind, count in sorted(kind_counts.items()):
            lines.append(f"| {kind} | {count} |")
    lines.append("")
    lines.append("## Stop line")
    lines.append("")
    lines.append("Phase 1 normalization finished. No database writes were performed.")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    repo = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-root",
        type=Path,
        default=repo / "data/local/admin-reconciliation/mimu/v9.7",
        help="Frozen MIMU v9.7 root from Phase 0",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=repo / "reports/admin-reconciliation-v2",
        help="Directory for 01-* outputs",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source_root: Path = args.source_root
    out_dir: Path = args.out_dir
    if not source_root.exists():
        raise SystemExit(f"Source root not found: {source_root}")

    print("loading boundaries...", flush=True)
    boundaries = load_boundaries(source_root)
    print(f"  boundaries={len(boundaries)}", flush=True)
    print("loading villages...", flush=True)
    villages = load_villages(source_root)
    print(f"  villages={len(villages)}", flush=True)

    print("township containment checks...", flush=True)
    flag_outside_township(boundaries, villages)

    print("duplicate detection...", flush=True)
    dup_rows = detect_boundary_duplicates(boundaries) + detect_village_duplicates(villages)

    print("writing outputs...", flush=True)
    ward_out = write_wards_geojson(out_dir / "01-wards-normalized.geojson", boundaries)
    vt_out = write_vt_geojson(out_dir / "01-village-tracts-normalized.geojson", boundaries)
    village_out = write_villages_csv(out_dir / "01-villages-normalized.csv", villages)
    invalid_count = write_invalid_csv(out_dir / "01-source-invalid.csv", boundaries, villages)
    write_duplicates_csv(out_dir / "01-source-duplicates.csv", dup_rows)
    write_summary(
        out_dir / "01-source-summary.md",
        source_root,
        boundaries,
        villages,
        dup_rows,
        invalid_count,
        ward_out,
        vt_out,
        village_out,
    )

    print(
        f"done wards={ward_out} vt={vt_out} villages={village_out} "
        f"invalid_rows={invalid_count} duplicate_rows={len(dup_rows)}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
