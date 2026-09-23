# Phase 1 existing-data cleanup — run report

## Production status

**NOT applied to production.** Production still shows official first-level SR = **17**, Nanyun parent = **6665**.

## Disposable target

- Docker PostGIS `coremap-admin-cleanup-pg` on `localhost:5433`
- Restored from production admin subset dump (`core.core_admin_areas` + names + ref levels/types)
- Migration applied, validated, rollback-tested, then re-applied for inspection

## Artifacts

| File | Role |
|---|---|
| `01-action-manifest.md` | Verified IDs and target parents |
| `02-before-after-expected.csv` | Expected metric deltas |
| `03-validation.sql` | Post-apply checks |
| `04-snapshot-before.sql` | SQL snapshot tables for affected rows/names |
| `snapshot_affected_rows.csv` | Before attributes + geom md5 |
| `snapshot_names.csv` | Before names |
| `snapshot_children.csv` | Immediate children |
| `snapshot_fk_dependencies.csv` | Production FK counts |
| `geom_md5_before.csv` / `geom_md5_after.csv` | Geom integrity |
| `00-before-counts.txt` / `00-after-counts.txt` | Count dumps |
| `../../infrastructure/database/migrations/supabase/20260921120000_admin_phase1_existing_data_cleanup.sql` | Forward migration |
| `../../infrastructure/database/migrations/supabase/20260921120000_admin_phase1_existing_data_cleanup.rollback.sql` | Rollback |

## Exact before / after (disposable)

| Metric | Before | After |
|---|---:|---:|
| Official first-level `state_region` (parent=country, public+official) | **17** | **15** |
| Wa North/South under country | **2** | **0** |
| Cleanup-created rows (Pyay Dist, Pa Laung SAZ, Wa SAD) | **0** | **3** |
| Foreign rows still public/official | **5** | **0** (all 5 disabled; rows kept; `is_active` true) |
| SAZ/SAD under Shan or Sagaing | **0** | **6** |
| Seven township parents corrected | **0** | **7** |
| Existing affected geom md5 changes | **0** | **0** |
| Entity duplicate merges | **0** | **0** (none approved) |
| Validation checks passed | — | **15 / 15** |
| Rollback restores official SR | — | **17** (verified) |

## Decisions locked in migration

1. Hsihseng = **6091** (not Phase 1 false match **6410**).
2. Foreign FK dependents **not** reassigned (no proven Myanmar admin target); flags disabled only.
3. Pyay District / Pa Laung SAZ / Wa SAD created with **derived union geoms**; existing polygons untouched.
4. Kokang **6411** reclassified district → SAZ (geom preserved).

## Stop

No production write. No Supabase `apply_migration` on project `locghyuranqaqsnbxflc`.
