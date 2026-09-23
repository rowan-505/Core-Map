# Admin reconciliation v2 — Phase 1 source normalization

**Generated:** 2026-09-21T07:13:53Z
**Source root:** `/Users/nyihtet/Documents/Projects/Core-Map/data/local/admin-reconciliation/mimu/v9.7`
**Database writes:** none

MIMU PCodes are retained only as `source_pcode` / `mimu_audit_pcode` audit keys.
They are not prepared as CoreMap `external_id` values.

## Inputs

| Population | Frozen inputs | Source version on disk |
|---|---|---|
| Ward boundaries | `ward/ward_boundary_countrywide_v94.zip` | 9.4 |
| Village-tract boundaries | `village_tract/*_v94.zip` (15 regions) | 9.4 |
| Village points | `village_points/*_v96.zip` (15 regions) | 9.6 layer / attrs may say 9.7 |

## Output totals

| Output | Count |
|---|---:|
| Accepted wards → `01-wards-normalized.geojson` | 2001 |
| Accepted village tracts → `01-village-tracts-normalized.geojson` | 14175 |
| Accepted villages → `01-villages-normalized.csv` | 54602 |
| Invalid / excluded / outside-Myanmar rows → `01-source-invalid.csv` | 1013 |
| Duplicate report rows → `01-source-duplicates.csv` | 41 |

## Status by entity type

| Entity | ok | invalid | excluded | input rows |
|---|---:|---:|---:|---:|
| ward | 2001 | 0 | 0 | 2001 |
| village_tract | 14175 | 0 | 0 | 14175 |
| village | 54602 | 0 | 2 | 54604 |

## Spatial flags

| Flag | ward | village_tract | village |
|---|---:|---:|---:|
| outside_source_township | 0 | 237 | 24 |
| township_geom_missing | 0 | 0 | 750 |
| outside_myanmar | 0 | 0 | 0 |

Township containment:

- No independent township boundary layer was present in the Phase 0 freeze.
- Per-township envelope is built from accepted ward + village-tract bboxes sharing `TS_PCODE`.
- Village points outside that envelope (pad ~0.001°) are flagged `outside_source_township`.
- Boundary POS outside the envelope, or far from sibling POS cluster, is flagged the same way.

Geometry rules:

- Working CRS: EPSG:4326.
- Boundaries: Polygon/MultiPolygon only.
- Villages: Point only.
- `MakeValid` kept only when area change ≤ 1%; otherwise row is invalid.
- Synthetic / ward-label village rows are excluded (e.g. `----Ward`, names containing Ward/ရပ်ကွက်).

## Counts by region and entity type

| Region | Entity | Status | Count |
|---|---|---|---:|
| Ayeyarwady | village | excluded | 1 |
| Ayeyarwady | village | ok | 10781 |
| Ayeyarwady | village_tract | ok | 1984 |
| Ayeyarwady | ward | ok | 202 |
| Bago (East) | village | ok | 2378 |
| Bago (East) | village_tract | ok | 755 |
| Bago (East) | ward | ok | 81 |
| Bago (West) | village | ok | 3454 |
| Bago (West) | village_tract | ok | 731 |
| Bago (West) | ward | ok | 35 |
| Chin | village | ok | 1373 |
| Chin | village_tract | ok | 482 |
| Chin | ward | ok | 19 |
| Kachin | village | ok | 1560 |
| Kachin | village_tract | ok | 612 |
| Kachin | ward | ok | 54 |
| Kayah | village | excluded | 1 |
| Kayah | village | ok | 469 |
| Kayah | village_tract | ok | 85 |
| Kayah | ward | ok | 13 |
| Kayin | village | ok | 1491 |
| Kayin | village_tract | ok | 397 |
| Kayin | ward | ok | 15 |
| Magway | village | ok | 4712 |
| Magway | village_tract | ok | 1599 |
| Magway | ward | ok | 97 |
| Mandalay | village | ok | 4707 |
| Mandalay | village_tract | ok | 1463 |
| Mandalay | ward | ok | 159 |
| Mon | village | ok | 1040 |
| Mon | village_tract | ok | 390 |
| Mon | ward | ok | 83 |
| Nay Pyi Taw | village | ok | 796 |
| Nay Pyi Taw | village_tract | ok | 204 |
| Nay Pyi Taw | ward | ok | 39 |
| Rakhine | village | ok | 3502 |
| Rakhine | village_tract | ok | 1069 |
| Rakhine | ward | ok | 81 |
| Sagaing | village | ok | 5725 |
| Sagaing | village_tract | ok | 1825 |
| Sagaing | ward | ok | 95 |
| Shan (East) | village | ok | 2298 |
| Shan (East) | village_tract | ok | 204 |
| Shan (East) | ward | ok | 30 |
| Shan (North) | village | ok | 3488 |
| Shan (North) | village_tract | ok | 965 |
| Shan (North) | ward | ok | 85 |
| Shan (South) | village | ok | 3616 |
| Shan (South) | village_tract | ok | 456 |
| Shan (South) | ward | ok | 137 |
| Tanintharyi | village | ok | 1306 |
| Tanintharyi | village_tract | ok | 293 |
| Tanintharyi | ward | ok | 67 |
| Yangon | village | ok | 1906 |
| Yangon | village_tract | ok | 661 |
| Yangon | ward | ok | 709 |

## Duplicate kinds

| Kind | Rows |
|---|---:|
| duplicate_coordinates | 12 |
| duplicate_identity | 4 |
| repeated_source_pcode | 25 |

## Stop line

Phase 1 normalization finished. No database writes were performed.
