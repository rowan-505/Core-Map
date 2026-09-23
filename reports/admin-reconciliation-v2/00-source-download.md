# Admin reconciliation v2 — Phase 0 source download

**Date:** 2026-09-21  
**Scope:** Download and freeze official MIMU sources only. No Supabase writes, no migrations, no imports, no tile rebuilds, no production changes.

**Frozen root (gitignored):** `data/local/admin-reconciliation/mimu/v9.7/`  
**Trackable inventory:** `reports/admin-reconciliation-v2/phase0/`

---

## 1. Discovery method

Official entry points used:

| Page | Role |
|---|---|
| https://themimu.info/states_regions/country-wide | PCode workbooks + change metadata links |
| https://data.humdata.org/dataset/place-code-datasets | HDX package for PCodes Release 9.7 (CKAN `package_show`) |
| https://geonode.themimu.info/people/profile/MIMU-GIS/ | GeoNode profile / linked layers |
| HDX CKAN search (`organization:mimu`, ward / village-tract / village) | Live resource metadata |
| GeoServer WFS `GetCapabilities` on `geonode.themimu.info` | Live `typeName` list (HDX typeNames were stale) |

Rules followed: no guessed URLs; HTTP status / content-type / size checked; HTML error pages rejected; no login/403/JS bypass.

---

## 2. Production read-only baseline (context only)

Queried Supabase project `locghyuranqaqsnbxflc` (Map Project). Read-only.

| Item | Value |
|---|---:|
| `state_region` active | 15 |
| `district` active | 116 |
| `self_administered_zone` active (level) | 8 |
| `township` active / total | 359 / 361 |
| `town` active | 20 |
| `ward_village_tract` active | 1,995 |
| `core_settlements` total | 57,590 |
| `ref.ref_postal_codes` | 17,297 |
| `geometry_source='mimu_placeholder'` | 0 |

Schema notes confirmed: `ref.ref_admin_levels`, `ref.ref_admin_area_types`, `ref.ref_postal_codes` exist; `core.core_admin_areas` uses `admin_level_id` / `admin_area_type_id` (no `level` column).

---

## 3. Manifest summary

Full CSV: [`phase0/source-manifest.csv`](phase0/source-manifest.csv)  
Audit CSV: [`phase0/dataset-audit.csv`](phase0/dataset-audit.csv)  
Manual download: [`phase0/manual-download-required.csv`](phase0/manual-download-required.csv) (header only — nothing blocked by auth)

| Status | Count | Meaning |
|---|---:|---|
| `downloaded` | 6 | Exact v9.7 PCode / metadata files |
| `wrong_version` | 31 | Official spatial layers available, but not v9.7 |
| `missing` | 15 | Per-region ward boundary packages not published |
| `manual_download_required` | 0 | No login / 403 / JS blocks |
| `invalid_file` | 0 | — |

Total frozen payload on disk: **~59.6 MB** under `data/local/admin-reconciliation/mimu/v9.7/` (gitignored).

---

## 4. Successfully downloaded (status = `downloaded`)

All from official themimu.info / HDX place-code-datasets. License on HDX: **Other (`hdx-other`)**.

| File | Version | Notes |
|---|---|---|
| `pcodes/pcodes_countrywide_countrywide_v97.xlsm` | 9.7 | Myanmar PCodes Release 9.7 Jan 2026 Countrywide |
| `pcodes/pcodes_village_only_countrywide_v97.xlsm` | 9.7 | Countrywide VillageOnly workbook |
| `pcodes/pcodes_admin_hierarchy_countrywide_v97.xlsm` | 9.7 | StRgn–Dist–Tsp–Town–Ward–VT hierarchy (no villages) |
| `metadata/metadata_countrywide_v97.xlsx` | 9.7 | PCode change history 9.6 → 9.7 |
| `metadata/pcodes_major_changes_v96_to_v97.pdf` | 9.7 | Major changes PDF (~15.6 MB) |
| `metadata/admin_structure_2008_constitution.pdf` | — | Admin structure reference PDF |

### Workbook sheet row counts (data rows, header excluded)

**Countrywide PCodes 9.7**

| Sheet | Rows |
|---|---:|
| 01_SR | 20 |
| SAD_SAZ | 6 |
| 02_District | 82 |
| 03_Township | 363 |
| 04_Town | 541 |
| _05_Ward | 3,529 |
| _06-VillageTract | 14,052 |
| _07_Village | 72,576 |

**VillageOnly 9.7:** `_07_Village` = 72,576  

**Hierarchy 9.7:** same as countrywide without `_07_Village`

**Change history XLSX:** Summary 64; NewVillages 110; Added_Coordinates 751; Modified_Coordinates 1,177

Geometry: n/a (tabular). SRID: n/a.

---

## 5. Wrong version (official, frozen, not v9.7)

No public MIMU GeoNode/HDX **v9.7** ward, village-tract, or village-point spatial packages were found. Closest official layers were downloaded and marked `wrong_version`.

### 5.1 Ward boundaries — countrywide v9.4

| Item | Value |
|---|---|
| File | `ward/ward_boundary_countrywide_v94.zip` |
| Host | GeoNode WFS SHAPE-ZIP |
| Features | **2,001** |
| Geometry | POLYGON |
| SRID | **4326** |
| BBox | 92.345207, 9.974339, 100.366228, 27.295354 |
| Columns | ST, ST_PCODE, DT, DT_PCODE, TS, TS_PCODE, TOWN, TOWN_PCODE, WARD, WARD_PCODE, WARD_MMR, SOURCE, REMARK, PCode_V |

### 5.2 Village-tract boundaries — 15 regions, v9.4

All 15 state/region packages downloaded (Shapefile ZIP). Geometry POLYGON / MULTIPOLYGON, SRID **4326**.

| Region | Features |
|---|---:|
| Ayeyarwady | 1,984 |
| Bago | 1,486 |
| Chin | 482 |
| Kachin | 612 |
| Kayah | 85 |
| Kayin | 397 |
| Magway | 1,599 |
| Mandalay | 1,463 |
| Mon | 390 |
| Nay Pyi Taw | 204 |
| Rakhine | 1,069 |
| Sagaing | 1,825 |
| Shan | 1,625 |
| Tanintharyi | 293 |
| Yangon | 661 |
| **Total** | **14,175** |

Shared columns: ST, ST_PCODE, DT, DT_PCODE, TS, TS_PCODE, VT, VT_PCODE, VT_MMR, SELF_ADMIN, SUB_TS, Remark, Pcode_V

### 5.3 Village points — 15 regions, v9.6

Downloaded via live GeoServer `typeName` from WFS GetCapabilities (HDX resource typeNames returned ServiceException). Geometry POINT, SRID **4326**.

| Region | Features |
|---|---:|
| Ayeyarwady | 10,782 |
| Bago | 5,832 |
| Chin | 1,373 |
| Kachin | 1,560 |
| Kayah | 470 |
| Kayin | 1,491 |
| Magway | 4,712 |
| Mandalay | 4,707 |
| Mon | 1,040 |
| Nay Pyi Taw | 796 |
| Rakhine | 3,502 |
| Sagaing | 5,725 |
| Shan | 9,402 |
| Tanintharyi | 1,306 |
| Yangon | 1,906 |
| **Total** | **54,604** |

Shared columns: ST, ST_PCODE, DT, DT_PCODE, TS, TS_PCODE, VT, VT_PCODE, VILLAGE, VLG_PCODE, VLG_MMR, ALTVLG_ENG, ALTVLG_MMR, Longitude, Latitude, PCODE_V, Remark

Note: VillageOnly workbook lists **72,576** villages; regional point layers total **54,604**. Gap is expected until a true countrywide v9.7 point product exists.

---

## 6. Missing

### Per-region ward boundaries (15 regions)

HDX/GeoNode publish **one countrywide** ward boundary layer (v9.4), not 15 separate regional ward packages.

Status for each region: `missing` (`feature_type=ward_boundary_per_region`).

Regions: Ayeyarwady, Bago, Chin, Kachin, Kayah, Kayin, Magway, Mandalay, Mon, Nay Pyi Taw, Rakhine, Sagaing, Shan, Tanintharyi, Yangon.

### v9.7 spatial products

Not found on HDX or GeoNode for ward / village-tract / village points. Tabular PCodes are 9.7; spatial freeze is 9.4 (polygons) and 9.6 (points).

---

## 7. Blocked / manual download

**None.**  
`manual-download-required.csv` has headers only. No official file required login, 403, or JavaScript verification during this freeze.

---

## 8. Licence summary

| Source family | License name (as published) | License / terms URL |
|---|---|---|
| HDX place-code-datasets + linked themimu.info PCode files | Other (`hdx-other`) | https://data.humdata.org/dataset/place-code-datasets |
| themimu.info direct workbook links | Other (see themimu.info terms) | https://themimu.info/ |
| GeoNode / HDX MIMU GIS layers | Other / MIMU-GeoNode terms | https://geonode.themimu.info/ |

Raw licensed files stay under `data/local/admin-reconciliation/` and are listed in `.gitignore`. Do not commit them.

---

## 9. Layout on disk

```text
data/local/admin-reconciliation/mimu/v9.7/
  source-manifest.csv
  manual-download-required.csv
  pcodes/          # v9.7 workbooks
  metadata/        # change history + PDFs
  ward/            # countrywide v9.4
  village_tract/   # 15 × v9.4
  village_points/  # 15 × v9.6
  audit/dataset-audit.csv
```

---

## 10. Phase 0 stop line

Phase 0 download/audit is complete. Ready inputs for later phases:

- Exact **v9.7** PCode + VillageOnly + hierarchy workbooks
- Best available official spatial freeze (**ward/VT v9.4**, **village points v9.6**)
- Clear gaps: no per-region wards; no public v9.7 spatial layers

**Do not proceed** to import, migration, tile rebuild, or production apply without an explicit next-phase request.
