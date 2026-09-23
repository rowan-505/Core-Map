# Phase 6 — disposable apply report

**Target:** Docker PostGIS DB `coremap_phase6` on `127.0.0.1:5433` (container `coremap-admin-cleanup-pg`)  
**Production:** NOT applied (`locghyuranqaqsnbxflc` unchanged)  
**Runner:** `tools/admin-reconciliation/phase6/apply_region.py`  
**Mode:** `--mode apply` (one state/region per transaction)

## Pre-run → post-run

| Metric | Pre | Post |
|---|---:|---:|
| Active admin areas | 2,514 | 16,704 |
| MIMU admin placeholders | 0 | 14,192 |
| Settlements (not deleted) | 57,590 | 59,455 |
| Village placeholders (`geometry_status=mimu_placeholder`) | 0 | 3,592 |
| Postal rows | 17,297 | 17,297 |
| Postal `linked_exact_local_area` | (legacy statuses) | **1,851** |

Pre geom-hash snapshot: `06-pre-geom-hashes.json` (matched admin + settlement hashes).

## Validation (PASS)

| Check | Result |
|---|---|
| Matched CoreMap admin geom hashes unchanged | **0** changed |
| Matched settlement point hashes unchanged | **0** changed |
| New admin polygons valid + non-null | **0** invalid |
| New village points valid + non-null | **0** invalid |
| Placeholder parents are township | **0** bad |
| Placeholder types ward / village_tract | **0** bad |
| No duplicate postal codes | **17,297** distinct |
| All valid postal rows present | **17,297** |
| Local postal links share township | **0** mismatch |
| MIMU placeholders tagged | **0** meta mismatch |
| Unresolved review rows imported | **0** (`manual_review` totals) |

Baseline (pre-existing, not Phase-6 fail gates): `local_parent_not_township=80`, `local_type_not_ward_or_vt=37`.

## Totals (all regions)

| Entity | source | matched | updated | merged | created_placeholder | rejected | manual_review | unaccounted |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ward | 2001 | 1879 | 398 | 3 | 114 | 8 | 0 | 0 |
| village_tract | 14175 | 7 | 7 | 0 | 14078 | 0 | 0 | 90 |
| village | 54602 | 50028 | 2235 | 2124 | 3565 | 9 | 0 | 2 |
| postal | 17299 | 1864 | 0 | 0 | 17297 | 2 | 3 | ~15400 missing_local |

Notes:
- Village-tract `unaccounted≈90`: mostly Shan (North) rows with unresolved `approved_township_id` (no invent).
- Postal `unaccounted` counts `missing_local_area` pending future local admin coverage — not malformed.
- Malformed postal codes rejected: **2** (not stored).

## Artifacts

- `06-summary.json` / `06-region-reports.json` / per-region CSVs
- `06-full-apply.log` / `06-kayah-apply.log`
- `06-pre-run-counts.json` / `06-pre-geom-hashes.json`
- `06-query-plans.sql` + `06-query-plans.out`
- `06-api-search-ranking.log` / `06-api-unified-search.log`

## Query plans

Index usage confirmed on disposable:
- `core_admin_areas_parent_idx` + `core_admin_areas_level_idx` for WVT-by-township
- `ref_postal_codes_postal_code_key` + township FK index
- `core_settlements_township_id_idx`

Placeholder count still seq-scans `geometry_source` (acceptable for admin reports; optional partial index later).

## API / search tests

Ran against repo unit tests (no production DB):

- `npm run test:public-search-ranking` → **33 pass**
- `npm run test:unified-search` → **32 pass**

Live search rebuild against disposable was **not** run (`search` schema absent from this dump). Production search rebuild remains a post-approval step.

## Intentionally not done

- No production apply
- No Supabase development branch (empty data; Docker disposable used instead)
- No CDN / PMTiles rebuild
