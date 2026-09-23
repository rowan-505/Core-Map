# Admin-area reconciliation v2 — current state (read-only)

**Inspection date:** 2026-09-21  
**Production project:** Supabase `locghyuranqaqsnbxflc` (Map Project)  
**Scope:** Read-only inspection only. No migrations applied, no production writes, no tile rebuilds, no index changes.

Architecture constraints confirmed from `AGENTS.md` and repo rules:

- PostgreSQL/PostGIS is the source of truth.
- `apps/api` is the only application layer that may access the database.
- Dashboard and web use the API only.
- Eventual DB changes must be versioned SQL migrations.
- Preserve existing CoreMap IDs and geometries when a source area matches an existing row.
- Do not use or persist MIMU PCodes as CoreMap identifiers.
- Villages belong in `core.core_settlements`, not `core.core_admin_areas`.
- Avoid new identifier/source/workflow tables for a one-time reconciliation.

---

## 1. Verified production baseline counts

Queried live production. Active = `is_active AND deleted_at IS NULL`.

| Observation to verify | Verified value | Match? |
|---|---:|---|
| 17 active `state_region` | **17** | yes |
| 116 districts | **116** | yes |
| 3 `self_administered_zone` | **3** | yes |
| 364 townships | **364** active (**366** total incl. soft-deleted) | yes |
| 20 towns | **20** | yes |
| 1,995 `ward_village_tract` | **1,995** | yes |
| 57,590 settlements | **57,590** | yes |
| no `ref.ref_postal_codes` | `to_regclass(...)` = **NULL** | yes |
| no `geometry_source='mimu_placeholder'` | **0** rows | yes |

### Counts by admin level

| Level | Active | Total |
|---|---:|---:|
| country | 1 | 1 |
| state_region | 17 | 17 |
| district | 116 | 116 |
| self_administered_zone | 3 | 3 |
| township | 364 | 366 |
| town | 20 | 20 |
| ward_village_tract | 1995 | 1995 |

Inactive/soft-deleted townships (explains 366 total):

| ID | Name | `is_active` | `deleted_at` | `parent_id` |
|---:|---|---|---|---:|
| 6014 | ဒီးမော့ဆို | false | 2026-07-24 | 5974 |
| 6763 | ကန့်ဘလူမြို့နယ် | false | 2026-07-24 | 6785 |

### Counts by type (active / total)

| Type | Active | Total |
|---|---:|---:|
| ward | 1956 | 1956 |
| township | 364 | 366 |
| district | 116 | 116 |
| special_area | 33 | 33 |
| town | 18 | 18 |
| state | 9 | 9 |
| region | 7 | 7 |
| island | 6 | 6 |
| village_tract | 2 | 2 |
| self_administered_zone | 3 | 3 |
| country | 1 | 1 |
| union_territory | 1 | 1 |

Note: level=`town` has 20 active rows; type=`town` has 18. Two town-level rows use other types (including `special_area` id **7523** ပုဇွန်တောင်မြို့နယ်).

### Counts by verification / boundary / address_usage / geometry_source

| Dimension | Key | Active | Total |
|---|---|---:|---:|
| verification_status | unverified | 2083 | 2083 |
| verification_status | verified | 419 | 421 |
| verification_status | needs_fix | 14 | 14 |
| boundary_status | official | 2502 | 2504 |
| boundary_status | surveyed | 14 | 14 |
| address_usage | official | 2516 | 2518 |
| geometry_source | (null) | 2502 | 2504 |
| geometry_source | coremap_manual | 14 | 14 |

---

## 2. Counts by state/region

Active areas whose nearest `state_region` ancestor is the listed row (includes the state_region row itself).

| State/region ID | Name | Areas | Districts | Townships | Towns | WVT | SAZ |
|---:|---|---:|---:|---:|---:|---:|---:|
| 6667 | ကချင်ပြည်နယ် | 91 | 6 | 20 | 1 | 62 | 1 |
| 6007 | ကယားပြည်နယ် | 31 | 3 | 8 | 0 | 19 | 0 |
| 5879 | ကရင်ပြည်နယ် | 29 | 6 | 7 | 0 | 15 | 0 |
| 6744 | ချင်းပြည်နယ် | 37 | 6 | 11 | 0 | 19 | 0 |
| 6703 | စစ်ကိုင်းတိုင်းဒေသကြီး | 141 | 9 | 36 | 0 | 95 | 0 |
| 7449 | တနင်္သာရီတိုင်း | 71 | 4 | 10 | 0 | 56 | 0 |
| 6031 | နေပြည်တော် ပြည်ထောင်စုနယ်မြေ | 60 | 4 | 9 | 0 | 45 | 1 |
| 7169 | ပဲခူးတိုင်းဒေသကြီး | 133 | 3 | 25 | 0 | 104 | 0 |
| 7027 | မကွေးတိုင်းဒေသကြီး | 118 | 5 | 26 | 0 | 86 | 0 |
| 6832 | မန္တလေးတိုင်း | 203 | 11 | 29 | 1 | 160 | 1 |
| 5089 | မွန်ပြည်နယ် | 94 | 4 | 10 | 0 | 79 | 0 |
| 6722 | ရခိုင်ပြည်နယ် | 110 | 7 | 17 | 0 | 85 | 0 |
| 13 | ရန်ကုန်တိုင်းဒေသကြီး | 770 | 13 | 45 | 2 | 709 | 0 |
| 6329 | ရှမ်းပြည်နယ် | 318 | 21 | 55 | 11 | 230 | 0 |
| 6378 | ဝပြည်နယ် တောင်ပိုင်း | 13 | 1 | 3 | 2 | 6 | 0 |
| 6485 | ဝပြည်နယ် မြောက်ပိုင်း | 45 | 5 | 25 | 2 | 12 | 0 |
| 7279 | ဧ​ရာဝတီတိုင်း | 245 | 8 | 28 | 1 | 207 | 0 |

Township sum across rows = 364. District sum = 116.

---

## 3. Parent-level matrix (active)

| Child level | Parent level | Count |
|---|---|---:|
| country | (null) | 1 |
| state_region | country | 17 |
| district | state_region | 116 |
| self_administered_zone | district | 3 |
| township | district | 359 |
| township | state_region | **5** |
| town | township | 9 |
| town | district | 7 |
| town | state_region | 3 |
| town | town | 1 |
| ward_village_tract | township | 1915 |
| ward_village_tract | district | 33 |
| ward_village_tract | town | 22 |
| ward_village_tract | state_region | 19 |
| ward_village_tract | country | 6 |

The five townships parented under `state_region` are listed in §8 (Yangon Rank/level errors). Separately, all three SAZ rows are parented under districts (wrong hierarchy depth vs MIMU, which expects state_region parents).

---

## 4. Name completeness and multiple-primary names

| Level | Areas | Missing primary EN | Missing primary MY | Multi primary EN | Multi primary MY | No name rows |
|---|---:|---:|---:|---:|---:|---:|
| country | 1 | 1 | 0 | 0 | 0 | 0 |
| state_region | 17 | 5 | 0 | 0 | 12 | 0 |
| district | 116 | 19 | 0 | 0 | 97 | 0 |
| self_administered_zone | 3 | 1 | 0 | 0 | 2 | 0 |
| township | 364 | **67** | **6** | 2 | **294** | 0 |
| town | 20 | 7 | 0 | 0 | 12 | 0 |
| ward_village_tract | 1995 | **1995** | 31 | 0 | 0 | 0 |

Matches prior audit township name gaps (67 EN / 6 MY). WVT has essentially no primary English names.

---

## 5. Exact duplicate candidate groups

Same active level + same parent + same primary EN + same primary MY:

| Level | Duplicate groups | Rows in groups | Extra rows |
|---|---:|---:|---:|
| township | 1 | 2 | 1 |
| ward_village_tract | 20 | 51 | 31 |

Prior Phase 1 `admin-duplicates.csv` (name-row and merge candidates, not the same metric):

- `exact_duplicate_name_rows`: 415
- `admin_area_merge_candidate`: 33 (mostly WVT pairs under shared parents)

Those CSV merge candidates remain useful as review queues, but production same-parent bilingual exact entity duplicates should be re-derived (counts differ by definition).

---

## 6. Foreign areas and dependent-record counts

Confirmed foreign polygons (point **outside** Myanmar country geom id=11):

| ID | Canonical name | Parent ID | Parent name | Lon | Lat | In Myanmar country |
|---:|---|---:|---|---:|---:|---|
| 5985 | อำเภอเวียงแหง (Thai amphoe) | 6384 | မိုင်းတုံခရိုင် | 98.63897 | 19.59058 | **false** |
| 5986 | อำเภอปางมะผ้า (Thai amphoe) | 6384 | မိုင်းတုံခရိုင် | 98.22408 | 19.59155 | **false** |
| 6675 | Vijoynagar EAC | 6665 | တနိုင်းခရိုင် | 96.95339 | 27.26940 | **false** |
| 6734 | S' Bungtlang | 6942 | ပလက်ဝခရိုင် | 92.68559 | 22.28894 | **false** |
| 6735 | Tipa | 6921 | မတူပီခရိုင် | 92.94419 | 22.16982 | **false** |

Dependent rows (must be reassigned before disable):

| Admin ID | Source | Column | Rows |
|---:|---|---|---:|
| 5985 | core.core_buildings | admin_area_id | 6 |
| 5985 | core.core_places | admin_area_id | 17 |
| 5985 | core.core_settlements | township_id | 3 |
| 5985 | core.core_streets | admin_area_id | 316 |
| 5985 | transport.stops | admin_area_id | 1 |
| 5985 | transport.terminals | admin_area_id | 1 |
| 5986 | core.core_places | admin_area_id | 4 |
| 5986 | core.core_settlements | township_id | 1 |
| 5986 | core.core_streets | admin_area_id | 35 |
| 5986 | transport.stops | admin_area_id | 2 |
| 6675 | core.core_settlements | township_id | 2 |
| 6675 | core.core_streets | admin_area_id | 102 |
| 6675 | transport.stops | admin_area_id | 2 |
| 6675 | transport.terminals | admin_area_id | 1 |
| 6734 | core.core_streets | admin_area_id | 12 |
| 6735 | core.core_places | admin_area_id | 1 |
| 6735 | core.core_settlements | township_id | 7 |
| 6735 | core.core_streets | admin_area_id | 49 |

**FK inventory:** **33** foreign-key constraints reference `core.core_admin_areas` (matches prior audit). Full list includes core entities, import_review candidates, transport, tourism, search, app auth/saved places, and feedback reports.

---

## 7. Seven known wrong township ancestors

These seven townships are the Phase 1 `update_parent` examples with exact CoreMap identity + MIMU PCode hierarchy mismatch. Production parents are **unchanged** since that audit.

| Core ID | Name | Current parent ID / name | MIMU target parent ID / name | Point in assigned parent? | Point in MIMU target parent? |
|---:|---|---|---|---|---|
| 6666 | တနိုင်းမြို့နယ် (Tanai, MMR001004) | **6665** တနိုင်းခရိုင် | **6622** မြစ်ကြီးနားခရိုင် | true | **false** |
| 6690 | ချီဖွေမြို့နယ် (Chipwi, MMR001005) | **6689** ချီဖွေခရိုင် | **6622** မြစ်ကြီးနားခရိုင် | true | **false** |
| 6688 | ဆော့လော်မြို့နယ် (Tsawlaw, MMR001006) | **6689** ချီဖွေခရိုင် | **6622** မြစ်ကြီးနားခရိုင် | true | **false** |
| 6015 | ဒီးမော့ဆိုမြို့နယ် (Demoso, MMR002002) | **5974** ဘော်လခဲခရိုင် | **5999** လွိုင်ကော်ခရိုင် | **false** | **false** |
| 6013 | ဖရူဆိုမြို့နယ် (Hpruso, MMR002003) | **5974** ဘော်လခဲခရိုင် | **5999** လွိုင်ကော်ခရိုင် | **false** | **false** |
| 5962 | မယ်စဲ့မြို့နယ် (Mese, MMR002007) | **5960** မယ်စဲ့ခရိုင် | **5974** ဘော်လခဲခရိုင် | true | **false** |
| 6018 | သံတောင်ကြီးမြို့နယ် (Thandaunggyi, MMR003004) | **6017** သံတောင်ကြီးခရိုင် | **5878** ဘားအံခရိုင် | true | **false** |

Spatial evidence:

- Phase 1 match method for all seven was `strong_spatial` against MIMU/OSM identity geometry (source↔core overlap), not “township point covered by MIMU target district”.
- Live CoreMap containment shows **none** of the seven township points fall inside the MIMU target district polygons.
- Therefore parent fixes cannot be approved from names or PCode tables alone; district polygon correctness must be reviewed with IDs and coverage tests first.

### Related: five Yangon townships with wrong ancestor *level*

Not the “seven”, but production-confirmed township→`state_region` parents:

| ID | Name | Parent | Lon | Lat |
|---:|---|---|---:|---:|
| 5388 | သာကေတ | **13** ရန်ကုန်တိုင်းဒေသကြီး | 96.21740 | 16.79457 |
| 5395 | ဒေါပုံ | **13** | 96.18901 | 16.78837 |
| 5425 | ပုဇွန်တောင် | **13** | 96.17550 | 16.77797 |
| 5446 | ဗိုလ်တထောင် | **13** | 96.18117 | 16.76929 |
| 5538 | မင်္ဂလာတောင်ညွန့် | **13** | 96.18448 | 16.79388 |

Related non-township under same parent: **7523** ပုဇွန်တောင်မြို့နယ် (`level=town`, `type=special_area`, parent 13). No active Yangon district polygon currently covers these downtown points (`ST_Intersects` returned no district).

---

## 8. Self-administered areas and ancestors

| ID | Name | Level/type | Parent ID | Parent name / level | Grandparent | Point in assigned parent? |
|---:|---|---|---:|---|---|---|
| 6115 | ပအိုဝ်းကိုယ်ပိုင်အုပ်ချုပ်ခွင့်ရဒေသ (Pa-O) | SAZ | **6042** | ဇေယျာသီရိခရိုင် / district | 6031 Naypyitaw | **false** |
| 6192 | ဓနုကိုယ်ပိုင်အုပ်ချုပ်ခွင့်ရဒေသ (Danu) | SAZ | **6197** | ကျောက်ဆည်ခရိုင် / district | 6832 Mandalay | **false** |
| 6693 | နာဂ ကိုယ်ပိုင်အုပ်ချုပ်ခွင့်ရဒေသ (Naga) | SAZ | **6665** | တနိုင်းခရိုင် / district | 6667 Kachin | **false** |

MIMU Active SAZ/SAD population is **6** rows; CoreMap has only these **3**. All three have points outside their assigned district parents. MIMU targets (from Phase 1) expect state_region parents under Sagaing/Shan, but CoreMap currently lacks matching SAZ polygons for the three missing zones (Danu/Pa-O/Pa Laung/Kokang/Wa SAD/Naga as MIMU geometry were blocked as missing legal geometry).

---

## 9. Wa North / Wa South descendants

Wa rows are first-level `state_region` under country (id 11), not SAZ:

| ID | Name | Level | Parent |
|---:|---|---|---|
| 6378 | ဝပြည်နယ် တောင်ပိုင်း (Wa South) | state_region | 11 country |
| 6485 | ဝပြည်နယ် မြောက်ပိုင်း (Wa North) | state_region | 11 country |

Descendants (depth > 0):

| Root | Districts | Townships | Towns | WVT |
|---|---:|---:|---:|---:|
| Wa South 6378 | 1 | 3 | 2 | 6 |
| Wa North 6485 | 5 | 25 | 2 | 12 |

Notable: foreign Thai amphoes **5985/5986** hang under Wa South district **6384** မိုင်းတုံခရိုင်. Phase 1 proposed reclassify of 6378/6485 to reference-only / leave official counts; that has **not** been applied in production.

---

## 10. Geometry validity and containment

| Metric | Count |
|---|---:|
| Active areas with invalid geom | **0** |
| Active areas with empty geom | **0** |
| Active areas whose point-on-surface is outside immediate parent | **68** |
| Active townships with point outside parent | **42** (matches prior audit) |
| Active townships whose geom is not completely covered by parent | **135** (matches prior audit) |
| Active townships | 364 |

---

## 11. Settlements by type

`core.core_settlements` total rows: **57,590**.

| Settlement type | Count |
|---|---:|
| village | 54,768 |
| local_area | 2,211 |
| town | 544 |
| city | 67 |

No village/settlement population is stored as `core.core_admin_areas` WVT beyond the 1,995 ward/tract admin rows. Individual villages correctly live in settlements.

---

## 12. Schema columns containing postal / postcode data

No `ref.ref_postal_codes` table.

| Schema.table | Column | Type |
|---|---|---|
| core.core_addresses | postal_code | text |
| import_review.address_candidates | postal_code | text |
| import_review.address_candidates | postcode | text |
| search.address_index | postcode | text |

Migration `191_normalize_core_address_postal_code` exists in repo and is applied in production history.

---

## 13. Indexes relevant to admin browsing, name search, geometry

### `core.core_admin_areas`

- PK / uniqueness: `id`, `public_id`, `slug`; partial unique `external_id`
- Browse/filter: `admin_level_id`, `(admin_level_id, is_active)`, `parent_id`, `admin_area_type_id`, `verification_status`, `boundary_status`, `address_usage`, `is_official_boundary`, `is_verified`, `(is_verified, updated_at DESC)`, partial `active_not_deleted` on `updated_at`
- Geometry: GiST `geom`, GiST `centroid`
- JSON: GIN `source_refs`, GIN `normalized_data`
- **Not present:** partial active-geom GiST named in migration `099_core_admin_areas_active_geom_partial_gix.sql` (`to_regclass` = NULL)

### `core.core_admin_area_names`

- PK + btree `(admin_area_id)`
- **No** `pg_trgm` / FTS index on `name` (API options search uses `ILIKE` on canonical/name/slug)

### `core.core_settlements`

- GiST `point_geom`, partial GiST `footprint_geom`
- btree `township_id` (partial), `settlement_type_id`, `external_id` (partial)

API admin search path: `apps/api/src/modules/admin-areas/` (`GET /admin-areas`, `/admin-areas/options`, `/admin-areas/road-township-options`) with dashboard comboboxes under `apps/dashboard/src/components/admin-areas/`.

---

## 14. Migrations related to admin areas or postal codes

### Repo files (selected)

| File | Topic |
|---|---|
| `037_core_admin_areas_boundary_metadata.sql` | boundary metadata columns |
| `038_ref_admin_area_boundary_metadata.sql` | ref boundary metadata |
| `099_core_admin_areas_active_geom_partial_gix.sql` | partial active geom index (file present; index not live) |
| `145_township_admin_assignment_inference.sql` | township assign helpers |
| `146_township_operational_lookup_uniqueness.sql` | operational township lookup |
| `184_index_core_admin_area_type_fk.sql` | type FK index |
| `190_remove_historical_admin_qa_artifacts.sql` | remove QA artifacts |
| `191_normalize_core_address_postal_code.sql` | address postal normalize |
| `192_core_settlements.sql` | settlements table |
| `195_settlements_tiles_and_search.sql` | settlements tiles/search |
| `196_retire_legacy_settlement_taxonomy.sql` | taxonomy cleanup |

### Applied on production (subset matching admin/postal/settlement names)

`145`, `147`, `184`, `190`, `191`, settlements tile/search migrations, `196`. No applied migration named `admin_postal_reconciliation` / Phase 2.

---

## 15. Source-file locations, row counts, hierarchy levels

### MIMU comparison files (located, not assumed)

| Asset | Path |
|---|---|
| PCode workbook v9.7 | `infrastructure/tiles/data/mimu/pcodes/Myanmar_PCodes_Release_9.7_Jan2026_StRgn_Dist_Tsp_Town_Ward_VT.xlsm` |
| SHA-256 | `11fff1b1eca8b1ff3cad3b0a90e757a187ae0b9cdc396bac708136da36ccdda2` |
| Boundary zips | `infrastructure/tiles/data/mimu/admin-boundaries/*.zip` |
| Unzipped shapefiles | `infrastructure/tiles/data/mimu/unzipped/` |

Workbook sheets / data rows / Active GAD counts:

| Sheet | Data rows | Active | Other status |
|---|---:|---:|---|
| 01_SR | 20 | 15 | N/A 5 |
| SAD_SAZ | 6 | 6 | — |
| 02_District | 82 | 75 | Inactive 3, N/A 4 |
| 03_Township | 358 | **330** | N/A 26, Inactive 2 |
| 04_Town | 536 | 469 | Inactive 3, N/A 64 |
| _05_Ward | 3524 | 3481 | Inactive 43 |
| _06-VillageTract | 14047 | 13588 | Inactive 274, N/A 185 |

Hierarchy levels available in workbook: state/region, SAD/SAZ, district, township, town, ward, village tract (+ Metadata).

MIMU v9.4 geometry feature counts (comparison/QA only; not approved for production tiles):

| Layer | Features |
|---|---:|
| adm0 country | 1 |
| adm1 state/region | 15 |
| adm2 district | 80 |
| adm3 township | 330 |

### Postal CSV files (located)

| Asset | Path |
|---|---|
| ZIP | `/Users/nyihtet/Downloads/Complete Data.zip` |
| ZIP SHA-256 | `782daf6918f7355d9445ab417a9b20015bb49d6fb732a760571adc55635496ca` |
| EN CSV | `/Users/nyihtet/Downloads/Complete Data/Myanmar_Locations_Postal_Code_EN.csv` (also inside ZIP) |
| MY CSV | `/Users/nyihtet/Downloads/Complete Data/Myanmar_Locations_Postal_Code_MM.csv` |
| EN/MY SHA-256 | `a77b85f6…` / `2964b009…` (match prior audit) |
| Rows each | **17,331** (header + 17331 data) |
| Columns | Region, Town / Township, Quarter / Village Tract, Postal Code |

### OSM extract used by Phase 1

`tools/data-pipeline/local-osm/data/osm/myanmar-260823.osm.pbf` (present, ~280 MB).

### Ephemeral Phase 1 export dir (not in git)

`/private/tmp/coremap-admin-audit.r55Hzm/` — contains `core_areas.csv`, `core_names.csv`, `baseline.csv`, `foreign_dependencies.csv`, `admin_fks.csv`, `mimu_geometries.csv`, `spatial_candidates.csv`, `osm_admin_latest.geojsonseq`, etc. **Volatile** (tmp); regenerate before relying on it.

---

## 16. API / tiles / dashboard surface (inspection only)

| Area | Findings |
|---|---|
| API | `apps/api/src/modules/admin-areas/` — list + options + road-township options; auth + dashboard access; ILIKE name search |
| Dashboard | Comboboxes in `apps/dashboard/src/components/admin-areas/`; core-review entity configs reference admin areas via API |
| Tiles | `infrastructure/tiles/pmtiles/scripts/sync-sql/extract_admin_areas.sql` (+ labels/settlements); overview guard `check-overview-no-mimu.sh` forbids MIMU paths in active overview code |
| Settlements | Separate core table + tile extract; villages not modeled as admin areas |

---

## 17. Previous Phase 2 leftovers (local only; production unchanged)

| Item | Status |
|---|---|
| `tools/admin-reconciliation/phase2_generate_migration.py` | **Present locally** (untracked). Generates SQL that would create `ref.ref_postal_codes`, write MIMU PCodes into `source_refs`, and mutate admin rows. **Not applied** (no table, no mimu_placeholder, baseline counts unchanged). |
| Generated migration SQL under `infrastructure/database/migrations/` | **None** for admin/postal reconciliation |
| `reports/admin-reconciliation/*` | Present (untracked) — Phase 1 outputs |
| Production `ref.ref_postal_codes` | Absent |
| Conflict with v2 rules | Phase 2 generator creates a **new postal table** and stores MIMU PCodes in `source_refs` / unique index on PCode — conflicts with “avoid new identifier tables” and “do not persist MIMU PCodes as CoreMap identifiers” unless redesigned |

---

## 18. Usability of previous artifacts

| Artifact | Usable as-is? | Notes |
|---|---|---|
| `reports/admin-reconciliation/summary.md` | Partially | Baseline counts still match production. Action tables are proposals, not applied. |
| `admin-match-report.csv` | Usable for review | 18,044 rows; still aligned with current IDs for sampled foreign/seven-parent cases. Re-validate before any write. |
| `admin-manual-review.csv` | Usable queue | 15,076 rows; fuzzy-only — do not auto-apply. |
| `admin-create-missing.csv` | Conditional | 124 rows; depends on OSM exact-PCode polygons still existing. |
| `admin-duplicates.csv` | Usable queue | Name-row duplicates vs entity merges; regenerate entity-level duplicates from live DB. |
| `postal-match-report.csv` / `postal-manual-review.csv` | Usable for matching review | SHA matches current postal ZIP; **do not** implement via new `ref.ref_postal_codes` without rule change. |
| `license-provenance.md` | Usable | Source paths/SHAs still valid. |
| `phase1_audit.py` / `phase1_export_readonly.sql` | Usable | Re-run for fresh snapshots. |
| `phase2_generate_migration.py` | **Do not run against production** | Conflicts with v2 constraints; redesign required. |
| `/private/tmp/coremap-admin-audit.r55Hzm/*` | Temporary | Must be copied or regenerated; not durable. |
| Core snapshot in git | **Missing** | Blocker for regenerating Phase 2-style SQL without re-export. |

---

## 19. Disagreements with the earlier audit

| Topic | Earlier audit | This verification |
|---|---|---|
| Level counts / foreign deps / township containment 42 & 135 | Reported | **Agree** |
| Settlements 57,590 / no postal table / no mimu_placeholder | Reported | **Agree** |
| Township active 364 vs total detail 366 | Shown as 364 / 366 | **Agree**; soft-deleted 6014, 6763 |
| MIMU target parents for the seven townships | Proposed `update_parent` | Live CoreMap points are **not** inside those target district polygons — hierarchy vs geometry conflict needs explicit decision |
| Phase 2 “not run” | Stated | **Agree for production**; local generator file now exists |
| Creating `ref.ref_postal_codes` | Phase 2 design | Conflicts with current v2 “avoid new tables / don’t persist MIMU PCodes as IDs” rules |

---

## 20. Blockers for Phase 1 (v2 re-audit / planning)

1. **Durable core snapshot:** Phase 1 export lives only under `/private/tmp/coremap-admin-audit.r55Hzm/`. Re-export with `phase1_export_readonly.sql` into a project-local reports path before any further matching.
2. **MIMU geometry licence:** v9.4 boundaries remain comparison-only; cannot be copied into PostGIS/tiles without written permission (`license-provenance.md`).
3. **Parent-change spatial conflict:** Seven known township ancestor cases fail containment in MIMU target districts; cannot approve parent updates from PCode hierarchy alone.
4. **SAZ gap:** MIMU has 6 Active SAZ/SAD; CoreMap has 3 misplaced SAZ rows and no legal geometry for the missing ones.
5. **Foreign dependency plan:** 561+ dependent rows across streets/places/settlements/stops/terminals before disable of 5985/5986/6675/6734/6735.
6. **Yangon downtown coverage hole:** Five townships under state_region 13 with no covering district polygon.
7. **Phase 2 generator mismatch:** Existing local Phase 2 code targets a postal table + MIMU PCode persistence that the v2 project rules disallow — redesign before any migration drafting.
8. **WVT scale:** MIMU Active ward+VT ≈ 17,069 vs CoreMap 1,995; most creates remain blocked on legal geometry.
9. **Name-search indexes:** Admin options rely on `ILIKE` without trgm on `core_admin_area_names.name` — performance risk if reconciliation UIs query heavily (observe before adding indexes).

---

## Stop

Read-only inspection complete. No production changes were made. Next step (only after explicit approval): define Phase 1 v2 re-audit outputs under `reports/admin-reconciliation-v2/` without writing migrations.
