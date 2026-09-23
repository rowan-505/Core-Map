#!/usr/bin/env python3
"""Regenerate admin/postal reconciliation manifests (report-only).

Does not connect to PostgreSQL or write migrations. Consumes the Phase 0
read-only core snapshot, MIMU workbook, MIMU comparison geometry index,
spatial supporting evidence, and Myanmar Post ZIP.
"""

from __future__ import annotations

import argparse
import collections
import csv
import difflib
import hashlib
import io
import json
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from openpyxl import load_workbook

csv.field_size_limit(min(2**31 - 1, 100_000_000))

MIMU_VERSION = "9.7 Jan 2026"
POSTAL_VERSION = "V-1.0 Sep 2021"

# MIMU East/West/North splits collapse onto CoreMap unified state/region rows.
SR_PARENT_REMAP = {
    "MMR007": "MMR111",  # Bago East → unified Bago
    "MMR008": "MMR111",  # Bago West
    "MMR014": "MMR222",  # Shan South → unified Shan
    "MMR015": "MMR222",  # Shan North
    "MMR016": "MMR222",  # Shan East
}

FOREIGN_IDS = {5985, 5986, 6675, 6734, 6735}
WA_STATE_IDS = {6378, 6485}

MYANMAR_RE = re.compile(r"[\u1000-\u109f\uaa60-\uaa7f\ua9e0-\ua9ff]")
SEVEN_DIGIT = re.compile(r"^\d{7}$")


@dataclass
class SourceRow:
    level: str
    pcode: str
    parent_pcode: str
    name_en: str
    name_my: str
    subtype: str
    gad_status: str
    mapping_status: str
    official: bool
    source_sheet: str
    source_row_number: int


def clean(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def bool_value(value: Any) -> bool:
    return clean(value).lower() in {"t", "true", "1", "yes"}


def compact_name(value: Any, level: str = "") -> str:
    text = clean(value)
    if not text:
        return ""
    import unicodedata

    text = unicodedata.normalize("NFKC", text).casefold()
    text = text.replace("nay pyi taw", "naypyitaw").replace("ayeyawady", "ayeyarwady")
    text = text.replace("irrawaddy", "ayeyarwady")
    suffixes = [
        r"\bunion territory\b", r"\bstate\b", r"\bregion\b", r"\bdistrict\b",
        r"\btownship\b", r"\btown\b", r"\bquarter\b", r"\bward\b",
        r"\bvillage[ -]?tract\b", r"\bself[ -]?administered (?:zone|division)\b",
        "ပြည်ထောင်စုနယ်မြေ", "တိုင်းဒေသကြီး", "ပြည်နယ်", "ခရိုင်", "မြို့နယ်",
        "ကျေးရွာအုပ်စု", "ရပ်ကွက်", "မြို့",
    ]
    for suffix in suffixes:
        text = re.sub(suffix, " ", text)
    text = re.sub(r"\b(?:no|number)\s*[.(]?\s*([0-9]+)\s*[).]?", r"\1", text)
    text = text.replace("အမှတ်", "")
    text = re.sub(r"[^0-9a-z\u1000-\u109f\uaa60-\uaa7f\ua9e0-\ua9ff]+", "", text)
    return text


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def first(row: dict[str, Any], *keys: str) -> str:
    for key in keys:
        if clean(row.get(key)):
            return clean(row.get(key))
    return ""


def sheet_dicts(workbook, sheet: str, header_row: int) -> list[tuple[int, dict[str, Any]]]:
    ws = workbook[sheet]
    rows = list(ws.iter_rows(values_only=True))
    headers = [clean(cell) for cell in rows[header_row - 1]]
    out: list[tuple[int, dict[str, Any]]] = []
    for offset, values in enumerate(rows[header_row:], start=header_row + 1):
        if not any(clean(v) for v in values):
            continue
        row = {headers[i]: values[i] for i in range(min(len(headers), len(values))) if headers[i]}
        out.append((offset, row))
    return out


def read_mimu(workbook_path: Path) -> tuple[list[SourceRow], list[dict[str, str]]]:
    wb = load_workbook(workbook_path, read_only=True, data_only=True, keep_vba=True)
    sources: list[SourceRow] = []

    for row_number, row in sheet_dicts(wb, "01_SR", 1):
        status = first(row, "GAD_State/Region_Status")
        sources.append(SourceRow(
            "state_region", first(row, "SR_Pcode"), "", first(row, "SR_Name_Eng"),
            first(row, "SR_Name_MMR"), "", status, first(row, "MIMU_State/Region_Mapping_Status"),
            status == "Active", "01_SR", row_number,
        ))

    for row_number, row in sheet_dicts(wb, "SAD_SAZ", 1):
        status = first(row, "GAD_SAD/SAZ_Status")
        name_en = first(row, "SAD/SAZ_Name_Eng")
        subtype = "self_administered_division" if "Division" in name_en else "self_administered_zone"
        sources.append(SourceRow(
            "self_administered_zone", first(row, "SAD/SAZ_Pcode"),
            SR_PARENT_REMAP.get(first(row, "SR_Pcode"), first(row, "SR_Pcode")),
            name_en, first(row, "SAD/SAZ_Name_MMR"), subtype, status,
            first(row, "MIMU_SAD/SAZ_Mapping_Status"), status == "Active", "SAD_SAZ", row_number,
        ))

    for row_number, row in sheet_dicts(wb, "02_District", 1):
        status = first(row, "GAD_District_Status")
        sources.append(SourceRow(
            "district", first(row, "District_Pcode"),
            SR_PARENT_REMAP.get(first(row, "SR"), first(row, "SR")),
            first(row, "District_Name_Eng"), first(row, "District_Name_MMR"), "district",
            status, first(row, "MIMU_District_Mapping_Status"), status == "Active", "02_District", row_number,
        ))

    for row_number, row in sheet_dicts(wb, "03_Township", 6):
        status = first(row, "GAD_Township_Status")
        sources.append(SourceRow(
            "township", first(row, "Tsp_Pcode"), first(row, "District/SAZ_Pcode"),
            first(row, "Township_Name_Eng"), first(row, "Township_Name_MMR"), "township",
            status, first(row, "MIMU_Township_Mapping_Status"), status == "Active", "03_Township", row_number,
        ))

    for sheet, subtype, pcode_key, en_key, my_key, gad_key, map_key in [
        ("_05_Ward", "ward", "Ward_Pcode", "Ward_Name_Eng", "Ward_Name_MMR", "GAD_VillageTract_Status", "MIMU_War_Mapping_Status"),
        ("_06-VillageTract", "village_tract", "VT_Pcode", "Village_Tract_Name_Eng", "Village_Tract_Name_MMR", "GAD_VillageTract_Status", "MIMU_VillageTract_Mapping_Status"),
    ]:
        for row_number, row in sheet_dicts(wb, sheet, 6):
            status = first(row, gad_key)
            sources.append(SourceRow(
                "ward_village_tract", first(row, pcode_key), first(row, "Tsp_Pcode"),
                first(row, en_key), first(row, my_key), subtype, status, first(row, map_key),
                status == "Active", sheet, row_number,
            ))

    towns: list[dict[str, str]] = []
    for _, row in sheet_dicts(wb, "04_Town", 6):
        if first(row, "GAD_Town_Status") == "Active":
            towns.append({
                "town_pcode": first(row, "Town_Pcode"),
                "township_pcode": first(row, "Tsp_Pcode"),
                "state_pcode": SR_PARENT_REMAP.get(first(row, "SR_Pcode"), first(row, "SR_Pcode")),
                "name_en": first(row, "Town_Name_Eng"),
                "name_my": first(row, "Town_Name_MMR"),
            })
    wb.close()
    return sources, towns


def load_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in fieldnames})


def expected_type(source: SourceRow) -> str:
    if source.level == "state_region":
        if source.pcode == "MMR018":
            return "union_territory"
        if source.pcode in {"MMR001", "MMR002", "MMR003", "MMR004", "MMR011", "MMR012", "MMR222"}:
            return "state"
        return "region"
    if source.level == "self_administered_zone":
        return source.subtype or "self_administered_zone"
    return source.subtype or source.level


def names_by_area(names: list[dict[str, str]]) -> dict[int, list[dict[str, str]]]:
    grouped: dict[int, list[dict[str, str]]] = collections.defaultdict(list)
    for row in names:
        grouped[int(row["admin_area_id"])].append(row)
    return grouped


def area_names(area: dict[str, str], grouped: dict[int, list[dict[str, str]]]) -> list[dict[str, str]]:
    values = list(grouped.get(int(area["id"]), []))
    values.append({
        "name": clean(area.get("canonical_name")),
        "language_code": "und",
        "name_type": "canonical",
        "is_primary": "false",
        "id": "",
        "search_weight": "0",
    })
    return values


def primary_name(area_id: int, language: str, grouped: dict[int, list[dict[str, str]]]) -> str:
    rows = [
        row for row in grouped.get(area_id, [])
        if clean(row.get("language_code")) == language and bool_value(row.get("is_primary"))
    ]
    rows.sort(key=lambda row: (-float(clean(row.get("search_weight")) or 0), int(row["id"] or 0)))
    return clean(rows[0]["name"]) if rows else ""


def strong_spatial(row: dict[str, str]) -> bool:
    return bool_value(row.get("source_point_in_core")) and bool_value(row.get("core_point_in_source"))


def spatial_text(row: dict[str, str] | None) -> str:
    if not row:
        return "none"
    return (
        f"rank={clean(row.get('spatial_rank'))};"
        f"source_point_in_core={clean(row.get('source_point_in_core'))};"
        f"core_point_in_source={clean(row.get('core_point_in_source'))};"
        f"distance_m={clean(row.get('point_distance_m'))};"
        f"core_id={clean(row.get('core_id'))}"
    )


def build_path(area_id: int | None, area_by_id: dict[int, dict[str, str]]) -> str:
    if not area_id or area_id not in area_by_id:
        return ""
    parts: list[str] = []
    current: int | None = area_id
    seen: set[int] = set()
    while current and current not in seen and current in area_by_id:
        seen.add(current)
        area = area_by_id[current]
        parts.append(f"{clean(area.get('admin_level'))}:{current}:{clean(area.get('canonical_name'))}")
        parent = clean(area.get("parent_id"))
        current = int(parent) if parent else None
    return " > ".join(reversed(parts))


def source_path(source: SourceRow, by_pcode: dict[str, SourceRow]) -> str:
    chain: list[str] = []
    current: SourceRow | None = source
    seen: set[str] = set()
    while current and current.pcode not in seen:
        seen.add(current.pcode)
        chain.append(f"{current.level}:{current.pcode}:{current.name_en or current.name_my}")
        parent_code = current.parent_pcode
        current = by_pcode.get(parent_code) if parent_code else None
    return " > ".join(reversed(chain))


def load_spatial(path: Path) -> dict[tuple[str, str], list[dict[str, str]]]:
    result: dict[tuple[str, str], list[dict[str, str]]] = collections.defaultdict(list)
    for row in load_csv(path):
        if clean(row.get("source_level")) in {"", "ROLLBACK"} or not clean(row.get("pcode")):
            continue
        result[(clean(row["source_level"]), clean(row["pcode"]))].append(row)
    for key in result:
        result[key].sort(key=lambda row: int(clean(row.get("spatial_rank")) or 99))
    return result


def load_mimu_geom_pcodes(path: Path) -> set[tuple[str, str]]:
    """Index which source levels/pcodes have comparison geometry without loading polygons."""
    found: set[tuple[str, str]] = set()
    with path.open("r", encoding="utf-8", newline="") as handle:
        # Avoid csv module materializing multi-MB geometry cells.
        header = handle.readline()
        if not header:
            return found
        cols = next(csv.reader([header]))
        try:
            level_i = cols.index("source_level")
            pcode_i = cols.index("pcode")
        except ValueError:
            return found
        reader = csv.reader(handle)
        for row in reader:
            if len(row) <= max(level_i, pcode_i):
                continue
            level = clean(row[level_i])
            pcode = clean(row[pcode_i])
            if level and pcode:
                found.add((level, pcode))
    return found


def state_ancestor_id(area_id: int, area_by_id: dict[int, dict[str, str]]) -> int | None:
    current: int | None = area_id
    seen: set[int] = set()
    while current and current not in seen:
        seen.add(current)
        area = area_by_id.get(current)
        if not area:
            return None
        if clean(area.get("admin_level")) == "state_region":
            return current
        parent = clean(area.get("parent_id"))
        current = int(parent) if parent else None
    return None


def build_name_indexes(
    areas: list[dict[str, str]],
    grouped_names: dict[int, list[dict[str, str]]],
) -> dict[str, Any]:
    """Precompute normalized name indexes for exact parent-scoped matching."""
    by_parent_level: dict[tuple[str, str], list[dict[str, str]]] = collections.defaultdict(list)
    for area in areas:
        if not bool_value(area.get("is_active")) or clean(area.get("deleted_at")):
            continue
        level = clean(area.get("admin_level"))
        parent_id = clean(area.get("parent_id")) or "null"
        by_parent_level[(level, parent_id)].append(area)

    # (level, parent_id, language_bucket, norm) -> [area_ids]
    exact: dict[tuple[str, str, str, str], list[int]] = collections.defaultdict(list)
    alias: dict[tuple[str, str, str], list[int]] = collections.defaultdict(list)
    for (level, parent_id), pool in by_parent_level.items():
        for area in pool:
            area_id = int(area["id"])
            for name_row in area_names(area, grouped_names):
                norm = compact_name(name_row.get("name"), level)
                if not norm:
                    continue
                lang = clean(name_row.get("language_code")) or "und"
                name_type = clean(name_row.get("name_type")).casefold()
                if lang in {"my", "en", "und", ""}:
                    bucket = "my" if lang == "my" else ("en" if lang == "en" else "und")
                    exact[(level, parent_id, bucket, norm)].append(area_id)
                if name_type in {"alternate", "alt", "alias", "short", "local"}:
                    alias[(level, parent_id, norm)].append(area_id)
    # Deduplicate lists
    for key, values in list(exact.items()):
        exact[key] = sorted(set(values))
    for key, values in list(alias.items()):
        alias[key] = sorted(set(values))
    return {"by_parent_level": by_parent_level, "exact": exact, "alias": alias}


def match_names_indexed(
    level: str,
    parent_id: int | None,
    source: SourceRow,
    indexes: dict[str, Any],
) -> tuple[list[int], str]:
    parent_key = str(parent_id) if parent_id is not None else "null"
    my_norm = compact_name(source.name_my, level)
    en_norm = compact_name(source.name_en, level)
    exact = indexes["exact"]
    alias = indexes["alias"]

    if my_norm and en_norm:
        my_ids = set(exact.get((level, parent_key, "my", my_norm), [])) | set(exact.get((level, parent_key, "und", my_norm), []))
        en_ids = set(exact.get((level, parent_key, "en", en_norm), [])) | set(exact.get((level, parent_key, "und", en_norm), []))
        bilingual = sorted(my_ids & en_ids)
        if bilingual:
            return bilingual, "bilingual_exact_under_parent"

    alias_ids = sorted(set(
        (alias.get((level, parent_key, my_norm), []) if my_norm else [])
        + (alias.get((level, parent_key, en_norm), []) if en_norm else [])
    ))
    if alias_ids:
        return alias_ids, "alias_exact_under_parent"

    if my_norm:
        my_ids = sorted(set(
            exact.get((level, parent_key, "my", my_norm), [])
            + exact.get((level, parent_key, "und", my_norm), [])
        ))
        if my_ids:
            return my_ids, "normalized_my_under_parent"

    if en_norm:
        en_ids = sorted(set(
            exact.get((level, parent_key, "en", en_norm), [])
            + exact.get((level, parent_key, "und", en_norm), [])
        ))
        if en_ids:
            return en_ids, "normalized_en_under_parent"

    return [], ""


def match_names_in_pool(
    candidates: list[dict[str, str]],
    source: SourceRow,
    grouped_names: dict[int, list[dict[str, str]]],
) -> tuple[list[int], str]:
    """Fallback matcher for expanded state pools (not pre-indexed by parent)."""
    def collect(predicate) -> list[int]:
        found: list[int] = []
        for area in candidates:
            for name_row in area_names(area, grouped_names):
                if predicate(name_row):
                    found.append(int(area["id"]))
                    break
        return sorted(set(found))

    my_norm = compact_name(source.name_my, source.level)
    en_norm = compact_name(source.name_en, source.level)

    bilingual = []
    for area in candidates:
        names = area_names(area, grouped_names)
        has_my = any(
            compact_name(n.get("name"), source.level) == my_norm and my_norm
            and clean(n.get("language_code")) in {"my", "und", ""}
            for n in names
        )
        has_en = any(
            compact_name(n.get("name"), source.level) == en_norm and en_norm
            and clean(n.get("language_code")) in {"en", "und", ""}
            for n in names
        )
        if my_norm and en_norm and has_my and has_en:
            bilingual.append(int(area["id"]))
    if bilingual:
        return sorted(set(bilingual)), "bilingual_exact_under_state_region"

    alias_ids = collect(lambda n: (
        clean(n.get("name_type")).casefold() in {"alternate", "alt", "alias", "short", "local"}
        and compact_name(n.get("name"), source.level) in {my_norm, en_norm} - {""}
    ))
    if alias_ids:
        return alias_ids, "alias_exact_under_state_region"

    if my_norm:
        my_ids = collect(lambda n: (
            clean(n.get("language_code")) in {"my", "und", ""}
            and compact_name(n.get("name"), source.level) == my_norm
        ))
        if my_ids:
            return my_ids, "normalized_my_under_state_region"

    if en_norm:
        en_ids = collect(lambda n: (
            clean(n.get("language_code")) in {"en", "und", ""}
            and compact_name(n.get("name"), source.level) == en_norm
        ))
        if en_ids:
            return en_ids, "normalized_en_under_state_region"

    return [], ""


def fuzzy_under(
    candidates: list[dict[str, str]],
    source: SourceRow,
    grouped_names: dict[int, list[dict[str, str]]],
) -> list[tuple[float, int, str]]:
    targets = [compact_name(source.name_en, source.level), compact_name(source.name_my, source.level)]
    targets = [t for t in targets if t]
    fuzzy: list[tuple[float, int, str]] = []
    for area in candidates:
        for name_row in area_names(area, grouped_names):
            candidate = compact_name(name_row.get("name"), source.level)
            if not candidate or not targets:
                continue
            score = max(difflib.SequenceMatcher(None, target, candidate).ratio() for target in targets)
            if score >= 0.80:
                fuzzy.append((score, int(area["id"]), clean(name_row.get("name"))))
    fuzzy.sort(reverse=True)
    # unique by area id keeping best score
    best: dict[int, tuple[float, int, str]] = {}
    for item in fuzzy:
        best.setdefault(item[1], item)
    return sorted(best.values(), reverse=True)


def decide_action_for_match(
    source: SourceRow,
    selected: dict[str, str],
    parent_core: int | None,
    grouped_names: dict[int, list[dict[str, str]]],
) -> tuple[str, int, str]:
    if not source.official:
        return "mark_reference_only", 100, "Non-official MIMU GAD status; do not count in official totals"

    expected = expected_type(source)
    core_type = clean(selected.get("admin_area_type"))
    parent_differs = parent_core is not None and clean(selected.get("parent_id")) != str(parent_core)
    primary_en = primary_name(int(selected["id"]), "en", grouped_names)
    primary_my = primary_name(int(selected["id"]), "my", grouped_names)
    name_differs = (
        (source.name_en and primary_en and primary_en != source.name_en)
        or (source.name_my and primary_my and primary_my != source.name_my)
        or (source.name_en and not primary_en)
        or (source.name_my and not primary_my)
    )
    type_differs = core_type not in {"", expected, "unknown"} and core_type != expected

    if parent_differs and name_differs:
        return "update_name_and_parent", 95, "Matched under regional scope; parent and primary names differ from source"
    if parent_differs:
        return "update_parent", 95, "Matched identity under regional scope; parent differs from matched hierarchy parent"
    if type_differs:
        return "update_type", 90, f"Type differs from expected {expected} (core={core_type})"
    if name_differs:
        return "update_name", 95, "Parent matches; primary English/Myanmar names differ from source"
    return "keep_existing", 100, "Parent, type and primary bilingual names already align"


def regenerate(args: argparse.Namespace) -> dict[str, Any]:
    print("loading sources...", flush=True)
    sources, towns = read_mimu(args.mimu_workbook)
    print(f"sources={len(sources)} towns={len(towns)}", flush=True)
    by_pcode = {row.pcode: row for row in sources if row.pcode}
    print("loading core snapshot...", flush=True)
    areas = load_csv(args.core_areas)
    names = load_csv(args.core_names)
    print("loading spatial + mimu geom index...", flush=True)
    spatial = load_spatial(args.spatial_candidates)
    mimu_geom_keys = load_mimu_geom_pcodes(args.mimu_geometries)
    print(f"spatial_keys={len(spatial)} mimu_geom_keys={len(mimu_geom_keys)}", flush=True)

    area_records = []
    for area in areas:
        if clean(area.get("admin_level")) == "ROLLBACK":
            continue
        area_records.append(area)
    area_by_id = {int(area["id"]): area for area in area_records}
    by_level: dict[str, list[dict[str, str]]] = collections.defaultdict(list)
    for area in area_records:
        by_level[clean(area["admin_level"])].append(area)
    grouped_names = names_by_area(names)
    print("building name indexes...", flush=True)
    name_indexes = build_name_indexes(area_records, grouped_names)
    print("matching admin rows...", flush=True)
    country_id = next(
        int(area["id"]) for area in by_level["country"]
        if bool_value(area.get("is_active")) and not clean(area.get("deleted_at"))
    )

    # Synthetic unified parents for remapped East/West/North codes.
    # Resolve after matching official Active states by compact name.
    pcode_to_core: dict[str, int] = {}
    matched_core: set[int] = set()
    source_to_core: dict[str, int] = {}
    core_to_sources: dict[int, list[str]] = collections.defaultdict(list)

    admin_actions: list[dict[str, Any]] = []
    manual_rows: list[dict[str, Any]] = []
    duplicate_rows: list[dict[str, Any]] = []

    level_order = {
        "state_region": 1,
        "self_administered_zone": 2,
        "district": 2,
        "township": 3,
        "ward_village_tract": 4,
    }

    def active_same_level(level: str) -> list[dict[str, str]]:
        return [
            area for area in by_level.get(level, [])
            if bool_value(area.get("is_active")) and not clean(area.get("deleted_at"))
        ]

    def under_parent(level: str, parent_id: int | None) -> list[dict[str, str]]:
        if parent_id is None:
            return []
        return [area for area in active_same_level(level) if clean(area.get("parent_id")) == str(parent_id)]

    def under_state(level: str, state_id: int | None) -> list[dict[str, str]]:
        if state_id is None:
            return []
        return [
            area for area in active_same_level(level)
            if state_ancestor_id(int(area["id"]), area_by_id) == state_id
        ]

    # Seed remapped synthetic parents once Active states are known.
    def seed_synthetic_parents() -> None:
        # Prefer matched Active Bago/Shan core ids by compact English name.
        for area in active_same_level("state_region"):
            label = compact_name(area.get("canonical_name"), "state_region")
            en = compact_name(primary_name(int(area["id"]), "en", grouped_names), "state_region")
            token = en or label
            if "bago" in token or "ပဲခူး" in clean(area.get("canonical_name")):
                pcode_to_core.setdefault("MMR111", int(area["id"]))
            if "shan" in token or "ရှမ်း" in clean(area.get("canonical_name")):
                pcode_to_core.setdefault("MMR222", int(area["id"]))

    seed_synthetic_parents()

    for index, source in enumerate(sorted(sources, key=lambda row: (level_order[row.level], row.pcode)), start=1):
        if index % 2000 == 0:
            print(f"  matched {index}/{len(sources)}", flush=True)
        if source.level == "state_region":
            parent_core: int | None = country_id
            state_core_for_expand: int | None = None
        else:
            parent_core = pcode_to_core.get(source.parent_pcode)
            parent_source = by_pcode.get(source.parent_pcode)
            if parent_source and parent_source.level == "state_region":
                state_core_for_expand = parent_core
            elif parent_core:
                state_core_for_expand = state_ancestor_id(parent_core, area_by_id)
            else:
                # Climb source parents until a matched state.
                state_core_for_expand = None
                climb = by_pcode.get(source.parent_pcode)
                guard = 0
                while climb and guard < 6:
                    if climb.level == "state_region" and climb.pcode in pcode_to_core:
                        state_core_for_expand = pcode_to_core[climb.pcode]
                        break
                    remapped = SR_PARENT_REMAP.get(climb.pcode, climb.pcode)
                    if remapped in pcode_to_core:
                        state_core_for_expand = pcode_to_core[remapped]
                        break
                    climb = by_pcode.get(climb.parent_pcode) if climb.parent_pcode else None
                    guard += 1

        if source.level == "state_region" and source.pcode in {"MMR007", "MMR008", "MMR014", "MMR015", "MMR016"}:
            # Ensure synthetic map exists before lower levels.
            seed_synthetic_parents()

        strict_candidates = (
            active_same_level("state_region") if source.level == "state_region"
            else under_parent(source.level, parent_core)
        )
        if source.level == "state_region":
            candidate_ids, method = match_names_indexed(source.level, country_id, source, name_indexes)
            # State rows are parented under country in CoreMap.
            if not candidate_ids:
                candidate_ids, method = match_names_in_pool(strict_candidates, source, grouped_names)
                method = method.replace("under_state_region", "under_parent") if method else method
        else:
            candidate_ids, method = match_names_indexed(source.level, parent_core, source, name_indexes)
        hierarchy_evidence = (
            f"strict_parent_core={parent_core or 'unresolved'};"
            f"strict_candidate_pool={len(strict_candidates)}"
        )

        # Expanded regional search for parent-mismatch recovery (not nationwide).
        # Skip WVT: pools are large and repeated names make regional expansion unsafe.
        if (
            not candidate_ids
            and source.level not in {"state_region", "ward_village_tract"}
            and state_core_for_expand
        ):
            expanded = under_state(source.level, state_core_for_expand)
            candidate_ids, method = match_names_in_pool(expanded, source, grouped_names)
            if candidate_ids:
                hierarchy_evidence += f";expanded_state_core={state_core_for_expand};expanded_pool={len(expanded)}"

        spatial_rows = spatial.get((source.level, source.pcode), [])
        top_spatial = spatial_rows[0] if spatial_rows else None
        # Supporting spatial tie-break only among already-found name candidates.
        if len(candidate_ids) > 1 and top_spatial and strong_spatial(top_spatial):
            spatial_id = int(top_spatial["core_id"])
            if spatial_id in candidate_ids:
                candidate_ids = [spatial_id]
                method += "+spatial_tiebreak"

        selected = area_by_id.get(candidate_ids[0]) if len(candidate_ids) == 1 else None
        spatial_evidence = spatial_text(
            next((row for row in spatial_rows if selected and clean(row.get("core_id")) == str(selected["id"])), top_spatial)
        )
        name_evidence = method or "none"
        action = ""
        confidence = 0
        reason = ""
        preserve_geom = True

        if len(candidate_ids) > 1:
            action = "manual_review"
            confidence = 40
            reason = "Multiple plausible CoreMap candidates under matched hierarchy scope: " + ",".join(map(str, candidate_ids))
            duplicate_rows.append({
                "duplicate_kind": "multiple_core_candidates_for_one_source",
                "source_key": f"{source.source_sheet}:{source.source_row_number}",
                "source_level": source.level,
                "source_name_en": source.name_en,
                "source_name_my": source.name_my,
                "parent_path": source_path(source, by_pcode),
                "coremap_ids": ";".join(map(str, candidate_ids)),
                "review_reason": reason,
            })
        elif selected:
            matched_core.add(int(selected["id"]))
            pcode_to_core[source.pcode] = int(selected["id"])
            source_to_core[source.pcode] = int(selected["id"])
            core_to_sources[int(selected["id"])].append(source.pcode)
            action, confidence, reason = decide_action_for_match(source, selected, parent_core, grouped_names)
            preserve_geom = True
            if not source.official:
                action = "mark_reference_only"
                reason = "Matched non-official MIMU row; retain CoreMap geometry; exclude from official counts"
        else:
            # Fuzzy only for manual review, and only under the strict matched parent
            # pool (never nationwide). Skip expensive fuzzy for large WVT pools; those
            # become create_mimu_placeholder / mark_reference_only instead.
            fuzzy: list[tuple[float, int, str]] = []
            if source.level != "ward_village_tract" and strict_candidates and len(strict_candidates) <= 80:
                fuzzy = fuzzy_under(strict_candidates, source, grouped_names)
            if fuzzy:
                action = "manual_review"
                confidence = round(fuzzy[0][0] * 100)
                reason = "Fuzzy-name candidates are review-only: " + "; ".join(
                    f"{item[1]}:{item[2]}:{item[0]:.3f}" for item in fuzzy[:5]
                )
                name_evidence = "fuzzy_under_hierarchy_scope"
                preserve_geom = True
            elif not source.official:
                action = "mark_reference_only"
                confidence = 100
                reason = "Non-official MIMU row with no CoreMap match; do not create official placeholder"
                preserve_geom = False
            else:
                action = "create_mimu_placeholder"
                confidence = 100
                has_geom = (source.level, source.pcode) in mimu_geom_keys
                reason = (
                    "No unique CoreMap match under matched hierarchy; create placeholder"
                    + (" using MIMU comparison geometry" if has_geom else " without durable production geometry yet")
                )
                name_evidence = "no_exact_match"
                preserve_geom = False
                spatial_evidence = spatial_text(top_spatial) if top_spatial else (
                    "mimu_comparison_geometry_available" if has_geom else "no_mimu_comparison_geometry"
                )

        # After first official states matched, seed synthetic parents.
        if source.level == "state_region" and source.official and selected:
            seed_synthetic_parents()

        row = {
            "source_key": f"{source.source_sheet}:{source.source_row_number}",
            "source_row_number": source.source_row_number,
            "source_sheet": source.source_sheet,
            "hierarchy_level": source.level,
            "source_subtype": source.subtype,
            "source_official": source.official,
            "source_gad_status": source.gad_status,
            "source_name_en": source.name_en,
            "source_name_my": source.name_my,
            "source_parent_path": source_path(source, by_pcode),
            "audit_only_source_pcode": source.pcode,
            "audit_only_parent_pcode": source.parent_pcode,
            "matched_coremap_id": selected["id"] if selected else "",
            "existing_coremap_path": build_path(int(selected["id"]), area_by_id) if selected else "",
            "existing_canonical_name": clean(selected.get("canonical_name")) if selected else "",
            "existing_parent_id": clean(selected.get("parent_id")) if selected else "",
            "target_parent_coremap_id": parent_core or "",
            "target_parent_path": build_path(parent_core, area_by_id) if parent_core else "",
            "action": action,
            "confidence": confidence,
            "name_evidence": name_evidence,
            "hierarchy_evidence": hierarchy_evidence,
            "spatial_evidence": spatial_evidence,
            "preserve_existing_geom": preserve_geom,
            "manual_review_reason": reason if action == "manual_review" else "",
            "review_notes": reason,
            "candidate_coremap_ids": ";".join(map(str, candidate_ids)),
            "mimu_comparison_geometry_available": (source.level, source.pcode) in mimu_geom_keys,
        }
        admin_actions.append(row)
        if action == "manual_review":
            manual_rows.append(row)

    # Detect two source rows → one CoreMap row among official creates/matches
    for core_id, pcodes in core_to_sources.items():
        official_pcodes = [p for p in pcodes if by_pcode[p].official]
        if len(official_pcodes) > 1:
            duplicate_rows.append({
                "duplicate_kind": "multiple_sources_to_one_core",
                "source_key": ";".join(f"{by_pcode[p].source_sheet}:{by_pcode[p].source_row_number}" for p in official_pcodes),
                "source_level": by_pcode[official_pcodes[0]].level,
                "source_name_en": " | ".join(by_pcode[p].name_en for p in official_pcodes),
                "source_name_my": " | ".join(by_pcode[p].name_my for p in official_pcodes),
                "parent_path": "",
                "coremap_ids": str(core_id),
                "review_reason": "Multiple official source rows mapped to one CoreMap row",
            })

    # Detect repeated create placeholders for same normalized hierarchy path
    create_paths: dict[tuple[str, str, str, str], list[dict[str, Any]]] = collections.defaultdict(list)
    for row in admin_actions:
        if row["action"] != "create_mimu_placeholder":
            continue
        key = (
            row["hierarchy_level"],
            compact_name(row["source_name_en"], row["hierarchy_level"]),
            compact_name(row["source_name_my"], row["hierarchy_level"]),
            row["target_parent_coremap_id"] or row["audit_only_parent_pcode"],
        )
        create_paths[key].append(row)
    for key, rows in create_paths.items():
        if len(rows) > 1:
            duplicate_rows.append({
                "duplicate_kind": "repeated_create_same_normalized_path",
                "source_key": ";".join(r["source_key"] for r in rows),
                "source_level": key[0],
                "source_name_en": rows[0]["source_name_en"],
                "source_name_my": rows[0]["source_name_my"],
                "parent_path": rows[0]["source_parent_path"],
                "coremap_ids": "",
                "review_reason": "Repeated create_mimu_placeholder for same normalized hierarchy path",
            })
            for row in rows:
                row["action"] = "manual_review"
                row["manual_review_reason"] = "Unresolved duplicate create for same normalized hierarchy path"
                row["review_notes"] = row["manual_review_reason"]
                row["preserve_existing_geom"] = False
                if row not in manual_rows:
                    manual_rows.append(row)

    # Extra CoreMap areas
    relevant_levels = {"state_region", "district", "self_administered_zone", "township", "town", "ward_village_tract"}
    extras: list[dict[str, Any]] = []
    for area in area_records:
        level = clean(area.get("admin_level"))
        if level not in relevant_levels:
            continue
        if not bool_value(area.get("is_active")) or clean(area.get("deleted_at")):
            continue
        area_id = int(area["id"])
        if area_id in matched_core:
            continue
        if area_id in FOREIGN_IDS:
            classification = "foreign"
            action = "disable_foreign"
            reason = "Confirmed foreign polygon outside Myanmar country geometry"
        elif area_id in WA_STATE_IDS:
            classification = "special_reference"
            action = "mark_reference_only"
            reason = "Core-only Wa/de-facto first-level area; retain geom; exclude from official counts"
        elif level == "town":
            classification = "special_reference"
            action = "mark_reference_only"
            reason = "Core town not in official MIMU admin target population for this reconciliation"
        elif level == "ward_village_tract":
            classification = "manual_review"
            action = "manual_review"
            reason = "Core WVT not matched to an official MIMU ward/village-tract row"
        elif level in {"township", "district", "self_administered_zone", "state_region"}:
            # Possible duplicate / special / leftover official catalogue noise
            classification = "manual_review"
            action = "manual_review"
            reason = "Active CoreMap area not claimed by an official matched source row"
        else:
            classification = "manual_review"
            action = "manual_review"
            reason = "Unclassified extra CoreMap area"
        extras.append({
            "coremap_id": area_id,
            "hierarchy_level": level,
            "admin_area_type": clean(area.get("admin_area_type")),
            "canonical_name": clean(area.get("canonical_name")),
            "coremap_path": build_path(area_id, area_by_id),
            "parent_id": clean(area.get("parent_id")),
            "classification": classification,
            "action": action,
            "preserve_existing_geom": True,
            "review_reason": reason,
            "point_x": clean(area.get("point_x")),
            "point_y": clean(area.get("point_y")),
            "geom_md5": clean(area.get("geom_md5")),
        })

    # Promote exact same-parent extras to merge_duplicate when multiple unmatched
    # CoreMap rows share the same normalized canonical name under one parent.
    extra_by_key: dict[tuple[str, str, str], list[dict[str, Any]]] = collections.defaultdict(list)
    for row in extras:
        key = (
            row["hierarchy_level"],
            clean(row["parent_id"]),
            compact_name(row["canonical_name"], row["hierarchy_level"]),
        )
        if key[2]:
            extra_by_key[key].append(row)
    for key, rows in extra_by_key.items():
        if len(rows) < 2:
            continue
        if any(r["action"] == "disable_foreign" for r in rows):
            continue
        ids = ";".join(str(r["coremap_id"]) for r in rows)
        duplicate_rows.append({
            "duplicate_kind": "extra_core_same_parent_name",
            "source_key": "",
            "source_level": key[0],
            "source_name_en": rows[0]["canonical_name"],
            "source_name_my": "",
            "parent_path": rows[0]["coremap_path"],
            "coremap_ids": ids,
            "review_reason": "Unmatched CoreMap rows share level, parent and normalized name",
        })
        for row in rows:
            row["classification"] = "duplicate"
            row["action"] = "merge_duplicate"
            row["review_reason"] = "Candidate merge with sibling CoreMap rows sharing parent and normalized name"

    # Postal
    print("building postal actions...", flush=True)
    postal_actions, postal_stats = postal_manifest(args.postal_zip, sources, towns, pcode_to_core, area_by_id, grouped_names)

    # Hard validations
    official_townships = [s for s in sources if s.level == "township" and s.official]
    validation: dict[str, Any] = {
        "source_rows_total": len(sources),
        "admin_actions_total": len(admin_actions),
        "source_rows_accounted_for": len(admin_actions) == len(sources),
        "official_township_source_rows": len(official_townships),
        "official_township_target_is_330": len(official_townships) == 330,
        "unresolved_duplicate_creates": sum(
            1 for r in duplicate_rows if r["duplicate_kind"] == "repeated_create_same_normalized_path"
        ),
        "valid_unique_postal_codes": postal_stats["unique_valid_codes"],
        "postal_actions_total": len(postal_actions),
        "postal_codes_accounted_for": len(postal_actions) == postal_stats["unique_valid_codes"],
        "matched_rows_preserve_geom": all(
            bool(r["preserve_existing_geom"])
            for r in admin_actions
            if r["matched_coremap_id"] and r["action"] not in {"create_mimu_placeholder"}
        ),
    }

    remaining_dup_creates = [
        r for r in admin_actions
        if r["action"] == "create_mimu_placeholder"
        and any(
            d["duplicate_kind"] == "repeated_create_same_normalized_path"
            and r["source_key"] in str(d["source_key"]).split(";")
            for d in duplicate_rows
        )
    ]
    validation["unresolved_duplicate_create_actions_remaining"] = len(remaining_dup_creates)
    validation["no_unresolved_duplicate_creates"] = len(remaining_dup_creates) == 0

    out = Path(args.output_dir)
    admin_fields = [
        "source_key", "source_row_number", "source_sheet", "hierarchy_level", "source_subtype",
        "source_official", "source_gad_status", "source_name_en", "source_name_my", "source_parent_path",
        "matched_coremap_id", "existing_coremap_path", "existing_canonical_name", "existing_parent_id",
        "target_parent_coremap_id", "target_parent_path", "action", "confidence",
        "name_evidence", "hierarchy_evidence", "spatial_evidence", "preserve_existing_geom",
        "manual_review_reason", "review_notes", "candidate_coremap_ids",
        "mimu_comparison_geometry_available", "audit_only_source_pcode", "audit_only_parent_pcode",
    ]
    write_csv(out / "01-admin-actions.csv", admin_actions, admin_fields)
    write_csv(out / "01-admin-manual-review.csv", manual_rows, admin_fields)
    write_csv(out / "01-extra-core-areas.csv", extras, [
        "coremap_id", "hierarchy_level", "admin_area_type", "canonical_name", "coremap_path",
        "parent_id", "classification", "action", "preserve_existing_geom", "review_reason",
        "point_x", "point_y", "geom_md5",
    ])
    write_csv(out / "01-duplicate-candidates.csv", duplicate_rows, [
        "duplicate_kind", "source_key", "source_level", "source_name_en", "source_name_my",
        "parent_path", "coremap_ids", "review_reason",
    ])
    write_csv(out / "01-postal-actions.csv", postal_actions, [
        "postal_code", "action", "region_name_en", "region_name_my", "township_name_en", "township_name_my",
        "locality_name_en", "locality_name_my", "inferred_locality_type",
        "matched_township_coremap_id", "matched_local_coremap_id",
        "match_method", "confidence", "source_row_count_en", "source_row_count_my",
        "duplicate_extra_source_rows", "review_reason",
    ])

    summary = build_summary(
        sources, admin_actions, extras, duplicate_rows, postal_actions, postal_stats, validation, args
    )
    (out / "01-summary.md").write_text(summary, encoding="utf-8")
    return validation


def postal_manifest(
    zip_path: Path,
    sources: list[SourceRow],
    towns: list[dict[str, str]],
    pcode_to_core: dict[str, int],
    area_by_id: dict[int, dict[str, str]],
    grouped_names: dict[int, list[dict[str, str]]],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    with zipfile.ZipFile(zip_path) as archive:
        names = {Path(name).name: name for name in archive.namelist()}
        frames: dict[str, list[dict[str, str]]] = {}
        hashes: dict[str, str] = {}
        for language, filename in [("en", "Myanmar_Locations_Postal_Code_EN.csv"), ("my", "Myanmar_Locations_Postal_Code_MM.csv")]:
            raw = archive.read(names[filename])
            hashes[language] = hashlib.sha256(raw).hexdigest()
            text = raw.decode("utf-8-sig")
            frames[language] = [{key: clean(value) for key, value in row.items()} for row in csv.DictReader(io.StringIO(text))]

    grouped: dict[str, dict[str, list[dict[str, str]]]] = {}
    for language, rows in frames.items():
        by_code: dict[str, list[dict[str, str]]] = collections.defaultdict(list)
        for row in rows:
            by_code[row["Postal Code"]].append(row)
        grouped[language] = by_code

    all_codes = set(grouped["en"]) | set(grouped["my"])
    valid = sorted(code for code in all_codes if SEVEN_DIGIT.fullmatch(code))
    malformed = sorted(code for code in all_codes if not SEVEN_DIGIT.fullmatch(code))
    stats = {
        "source_rows_en": len(frames["en"]),
        "source_rows_my": len(frames["my"]),
        "unique_valid_codes": len(valid),
        "duplicate_extra_rows_en": sum(max(0, len(grouped["en"].get(code, [])) - 1) for code in valid),
        "duplicate_extra_rows_my": sum(max(0, len(grouped["my"].get(code, [])) - 1) for code in valid),
        "malformed_codes": malformed,
        "sha256_en_csv": hashes["en"],
        "sha256_my_csv": hashes["my"],
        "sha256_zip": sha256_file(zip_path),
    }

    official_townships = [row for row in sources if row.level == "township" and row.official]
    official_locals = [row for row in sources if row.level == "ward_village_tract" and row.official]
    source_by_pcode = {row.pcode: row for row in sources}
    state_by_township: dict[str, str] = {}
    for township in official_townships:
        parent = source_by_pcode.get(township.parent_pcode)
        if parent and parent.level in {"district", "self_administered_zone"}:
            state_by_township[township.pcode] = parent.parent_pcode
        else:
            state_by_township[township.pcode] = township.parent_pcode

    state_names: dict[str, str] = {}
    for state in [row for row in sources if row.level == "state_region"]:
        # Include N/A splits so postal regions like "Shan State (North)" can resolve via remap.
        code = SR_PARENT_REMAP.get(state.pcode, state.pcode)
        state_names[compact_name(state.name_en, "state_region")] = code
        state_names[compact_name(state.name_my, "state_region")] = code
    # Common postal region labels
    for alias, code in {
        "bagoregioneast": "MMR111", "bagoregionwest": "MMR111", "bagoregion": "MMR111",
        "shanstatesouth": "MMR222", "shanstatenorth": "MMR222", "shanstateeast": "MMR222", "shanstate": "MMR222",
        "naypyitawunionterritory": "MMR018",
    }.items():
        state_names.setdefault(alias, code)

    township_index: dict[tuple[str, str], set[str]] = collections.defaultdict(set)
    for township in official_townships:
        state = SR_PARENT_REMAP.get(state_by_township.get(township.pcode, ""), state_by_township.get(township.pcode, ""))
        township_index[(state, compact_name(township.name_en, "township"))].add(township.pcode)
        township_index[(state, compact_name(township.name_my, "township"))].add(township.pcode)

    town_index: dict[tuple[str, str], set[str]] = collections.defaultdict(set)
    for town in towns:
        state = SR_PARENT_REMAP.get(town["state_pcode"], town["state_pcode"])
        town_index[(state, compact_name(town["name_en"], "town"))].add(town["township_pcode"])
        town_index[(state, compact_name(town["name_my"], "town"))].add(town["township_pcode"])

    locals_by_township: dict[str, list[SourceRow]] = collections.defaultdict(list)
    for local in official_locals:
        locals_by_township[local.parent_pcode].append(local)

    def join_values(rows: list[dict[str, str]], key: str) -> str:
        return " | ".join(sorted({clean(row.get(key)) for row in rows if clean(row.get(key))}))

    actions: list[dict[str, Any]] = []
    for code in valid:
        en_rows = grouped["en"].get(code, [])
        my_rows = grouped["my"].get(code, [])
        region_en, region_my = join_values(en_rows, "Region"), join_values(my_rows, "Region")
        township_en, township_my = join_values(en_rows, "Town / Township"), join_values(my_rows, "Town / Township")
        locality_en, locality_my = join_values(en_rows, "Quarter / Village Tract"), join_values(my_rows, "Quarter / Village Tract")
        extra_dup = max(0, len(en_rows) - 1) + max(0, len(my_rows) - 1)

        state_candidates = {
            state_names.get(compact_name(value, "state_region"), "")
            for value in [region_en, region_my] if value
        } - {""}
        state_pcode = next(iter(state_candidates)) if len(state_candidates) == 1 else ""

        township_candidates: set[str] = set()
        method = ""
        for value in [township_en, township_my]:
            if value and state_pcode:
                township_candidates.update(township_index.get((state_pcode, compact_name(value, "township")), set()))
        if township_candidates:
            method = "exact_township_name"
        if not township_candidates:
            for value in [township_en, township_my]:
                if value and state_pcode:
                    township_candidates.update(town_index.get((state_pcode, compact_name(value, "town")), set()))
            if township_candidates:
                method = "exact_town_to_parent_township"

        township_pcode = next(iter(township_candidates)) if len(township_candidates) == 1 else ""
        township_core = pcode_to_core.get(township_pcode, "") if township_pcode else ""

        joined_locality = f"{locality_en} {locality_my}".casefold()
        inferred_type = ""
        if "quarter" in joined_locality or "ward" in joined_locality or "ရပ်ကွက်" in joined_locality:
            inferred_type = "ward"
        elif "village tract" in joined_locality or "village-tract" in joined_locality or "ကျေးရွာအုပ်စု" in joined_locality:
            inferred_type = "village_tract"

        local_core = ""
        local_method = ""
        if township_pcode and (locality_en or locality_my):
            local_hits: list[int] = []
            for local in locals_by_township.get(township_pcode, []):
                local_core_id = pcode_to_core.get(local.pcode)
                if not local_core_id:
                    continue
                norms = {compact_name(local.name_en, "ward_village_tract"), compact_name(local.name_my, "ward_village_tract")} - {""}
                targets = {compact_name(locality_en, "ward_village_tract"), compact_name(locality_my, "ward_village_tract")} - {""}
                if norms & targets:
                    local_hits.append(local_core_id)
            local_hits = sorted(set(local_hits))
            if len(local_hits) == 1:
                local_core = local_hits[0]
                local_method = "exact_local_under_township"
            elif len(local_hits) > 1:
                local_method = "ambiguous_local"

        if len(township_candidates) > 1 or len(state_candidates) > 1 or local_method == "ambiguous_local":
            action = "ambiguous_manual_review"
            reason = "Ambiguous township/state/local match; do not invent admin polygons from postal locality"
            confidence = 40
        elif local_core:
            action = "link_local_admin"
            reason = "Unique local admin under matched township"
            confidence = 95
            method = local_method
        elif township_core:
            action = "link_township"
            reason = "Unique township match; locality not uniquely linked"
            confidence = 90
        elif township_pcode and not township_core:
            action = "township_source_match_core_unresolved"
            reason = "Source township resolved but CoreMap township id not matched in admin pass"
            confidence = 50
        else:
            action = "unmatched_postal_locality"
            reason = "Could not uniquely resolve township; do not create admin polygon from postal name"
            confidence = 20
            method = method or "unmatched"

        actions.append({
            "postal_code": code,
            "action": action,
            "region_name_en": region_en,
            "region_name_my": region_my,
            "township_name_en": township_en,
            "township_name_my": township_my,
            "locality_name_en": locality_en,
            "locality_name_my": locality_my,
            "inferred_locality_type": inferred_type,
            "matched_township_coremap_id": township_core,
            "matched_local_coremap_id": local_core,
            "match_method": method or local_method or "none",
            "confidence": confidence,
            "source_row_count_en": len(en_rows),
            "source_row_count_my": len(my_rows),
            "duplicate_extra_source_rows": extra_dup,
            "review_reason": reason,
        })

    # Quarantine malformed codes as separate summary facts (not part of 17297 actions).
    stats["quarantined_malformed"] = malformed
    return actions, stats


def build_summary(
    sources: list[SourceRow],
    admin_actions: list[dict[str, Any]],
    extras: list[dict[str, Any]],
    duplicate_rows: list[dict[str, Any]],
    postal_actions: list[dict[str, Any]],
    postal_stats: dict[str, Any],
    validation: dict[str, Any],
    args: argparse.Namespace,
) -> str:
    lines: list[str] = []
    lines += [
        "# Admin reconciliation manifests - Phase 1",
        "",
        "Report-only regeneration. No production writes. No migration created.",
        "",
        f"- MIMU workbook: `{args.mimu_workbook}`",
        f"- Core areas snapshot: `{args.core_areas}`",
        f"- Postal ZIP: `{args.postal_zip}`",
        "- Matching order: parent -> bilingual/alias -> normalized MY -> normalized EN -> spatial support -> fuzzy review-only",
        "",
        "## Hard validations",
        "",
        "| Check | Value | Pass |",
        "|---|---:|---|",
    ]
    checks = [
        ("Source rows accounted for", f"{validation['admin_actions_total']}/{validation['source_rows_total']}", validation["source_rows_accounted_for"]),
        ("Official township identities", validation["official_township_source_rows"], validation["official_township_target_is_330"]),
        (
            "Unresolved duplicate create actions remaining",
            validation.get("unresolved_duplicate_create_actions_remaining", 0),
            validation.get("no_unresolved_duplicate_creates", False),
        ),
        ("Duplicate create path groups converted to manual_review", validation.get("unresolved_duplicate_creates", 0), True),
        ("Valid unique postal codes", validation["valid_unique_postal_codes"], validation["valid_unique_postal_codes"] == 17297),
        ("Postal actions accounted for", f"{validation['postal_actions_total']}/{validation['valid_unique_postal_codes']}", validation["postal_codes_accounted_for"]),
        ("Matched rows preserve existing geom", validation["matched_rows_preserve_geom"], validation["matched_rows_preserve_geom"]),
    ]
    for label, value, passed in checks:
        lines.append(f"| {label} | {value} | {'yes' if passed else 'NO'} |")

    lines += ["", "## Actions by hierarchy level", ""]
    levels = ["state_region", "self_administered_zone", "district", "township", "ward_village_tract"]
    for level in levels:
        rows = [r for r in admin_actions if r["hierarchy_level"] == level]
        counter = collections.Counter(r["action"] for r in rows)
        lines += [f"### {level} (n={len(rows)})", "", "| Action | Count |", "|---|---:|"]
        for action, count in sorted(counter.items()):
            lines.append(f"| {action} | {count} |")
        lines.append("")

    # Township full table — 330 official targets
    township_rows = [
        r for r in admin_actions
        if r["hierarchy_level"] == "township" and bool_value(r.get("source_official"))
    ]
    township_rows.sort(key=lambda r: (clean(r.get("audit_only_source_pcode")), r["source_key"]))
    lines += [
        "## Official target townships (330)",
        "",
        f"Official Active township source rows: **{len(township_rows)}**.",
        "",
        "| # | Source key | EN | MY | Action | CoreMap ID | Confidence | Preserve geom |",
        "|---:|---|---|---|---|---:|---:|---|",
    ]
    for index, row in enumerate(township_rows, start=1):
        lines.append(
            "| {n} | {key} | {en} | {my} | {action} | {core} | {conf} | {preserve} |".format(
                n=index,
                key=row["source_key"],
                en=clean(row["source_name_en"]).replace("|", "/"),
                my=clean(row["source_name_my"]).replace("|", "/"),
                action=row["action"],
                core=row["matched_coremap_id"] or "",
                conf=row["confidence"],
                preserve=row["preserve_existing_geom"],
            )
        )

    lines += ["", "## Extra CoreMap areas", ""]
    extra_counter = collections.Counter((r["classification"], r["action"]) for r in extras)
    lines += ["| Classification | Action | Count |", "|---|---|---:|"]
    for (classification, action), count in sorted(extra_counter.items()):
        lines.append(f"| {classification} | {action} | {count} |")

    lines += ["", "## Duplicate candidates", ""]
    dup_counter = collections.Counter(r["duplicate_kind"] for r in duplicate_rows)
    lines += ["| Kind | Count |", "|---|---:|"]
    for kind, count in sorted(dup_counter.items()) or [("none", 0)]:
        lines.append(f"| {kind} | {count} |")

    postal_counter = collections.Counter(r["action"] for r in postal_actions)
    lines += [
        "",
        "## Postal validation",
        "",
        f"- Valid unique seven-digit codes: **{postal_stats['unique_valid_codes']}**",
        f"- Duplicate extra source rows EN: **{postal_stats['duplicate_extra_rows_en']}**",
        f"- Duplicate extra source rows MY: **{postal_stats['duplicate_extra_rows_my']}**",
        f"- Combined duplicate extra row occurrences: **{postal_stats['duplicate_extra_rows_en'] + postal_stats['duplicate_extra_rows_my']}**",
        f"- Quarantined malformed codes: **{postal_stats.get('quarantined_malformed', [])}**",
        f"- ZIP SHA-256: `{postal_stats['sha256_zip']}`",
        "",
        "| Postal action | Count |",
        "|---|---:|",
    ]
    for action, count in sorted(postal_counter.items()):
        lines.append(f"| {action} | {count} |")

    lines += [
        "",
        "## Notes",
        "",
        "- `audit_only_source_pcode` / `audit_only_parent_pcode` are audit keys only and must not be persisted as CoreMap identifiers.",
        "- Matched rows set `preserve_existing_geom=true`; MIMU comparison geometry is never copied over an existing match.",
        "- `create_mimu_placeholder` may use MIMU comparison geometry when available; it still must not assign a MIMU PCode/external id in production.",
        "- Postal locality names never create admin polygons by themselves.",
        "",
        "## Stop",
        "",
        "Manifests written. No SQL migration created.",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mimu-workbook", type=Path, required=True)
    parser.add_argument("--core-areas", type=Path, required=True)
    parser.add_argument("--core-names", type=Path, required=True)
    parser.add_argument("--spatial-candidates", type=Path, required=True)
    parser.add_argument("--mimu-geometries", type=Path, required=True)
    parser.add_argument("--postal-zip", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    validation = regenerate(args)
    print(json.dumps(validation, indent=2, default=str))


if __name__ == "__main__":
    main()
