# Phase 5 — migrations and one-time import scripts (generate only)

**Production writes: none from this folder until you explicitly run `--mode apply`.**

This package prepares DDL + idempotent import plans from frozen Phase 3 / Phase 4 manifests. It does not apply production changes by default.

## Hard invariants

- `core.core_admin_areas.geom` remains required (NOT NULL). Creates skip when no valid polygon.
- Wards / village tracts use admin level `ward_village_tract`; type is `ward` or `village_tract`.
- Villages stay in `core.core_settlements` with required `point_geom`.
- No permanent source / identifier / staging / matching tables.
- Reference IDs resolved by stable codes (`partner`, `ward_village_tract`, `ward`, `village_tract`, …) — never hardcoded numerics.
- Existing matched rows: preserve geometry and IDs; do not set `geometry_source='mimu_placeholder'`.

## Outputs

| Artifact | Path |
|---|---|
| Schema migration (postal only) | `infrastructure/database/migrations/supabase/20260921180000_phase5_ref_postal_codes.sql` |
| Migration rollback | `…/20260921180000_phase5_ref_postal_codes.rollback.sql` |
| Migration verify | `infrastructure/database/verification/verify_20260921180000_phase5_postal.sql` |
| Freeze script | `tools/admin-reconciliation/phase5/freeze_approved_manifests.py` |
| Admin import | `tools/admin-reconciliation/phase5/import_admin.py` |
| Village import | `tools/admin-reconciliation/phase5/import_villages.py` |
| Postal import | `tools/admin-reconciliation/phase5/import_postal.py` |
| Shared helpers | `tools/admin-reconciliation/phase5/_common.py` |
| Pre-import snapshot SQL | `reports/admin-reconciliation-v2/phase5/05-pre-import-snapshot.sql` |
| Validation SQL | `reports/admin-reconciliation-v2/phase5/05-validation.sql` |
| Data rollback SQL | `reports/admin-reconciliation-v2/phase5/05-rollback.sql` |
| Frozen manifests | `reports/admin-reconciliation-v2/phase3-frozen/` |

## `ref.ref_postal_codes` columns (minimal)

`id`, `postal_code`, `township_admin_area_id`, `local_admin_area_id`, `region_name_mm`, `region_name_en`, `township_name_mm`, `township_name_en`, `locality_name_mm`, `locality_name_en`, `locality_type`, `match_status`, `match_method`, `source_version`, `created_at`, `updated_at`

Constraints: unique `postal_code`; exactly seven ASCII digits; township/local FKs with `ON DELETE SET NULL`; FK indexes.

Migration creates the table **only if missing**, and aligns legacy `*_my` column names to `*_mm` when present.

## Admin placeholder metadata (new creates only)

```text
geometry_source='mimu_placeholder'
reference_source='mimu'
source_license_status='permission_pending'
verification_status='needs_fix'
is_verified=false
boundary_status='approximate'
is_official_boundary=false
```

## Village placeholder metadata (no schema change)

- `source_type_id` via code `partner`
- `source_refs` merge (existing keys win): `source=mimu`, `source_version=9.7`, `geometry_status=mimu_placeholder`, `needs_geometry_replacement=true`
- `verification_status='needs_fix'`, `is_verified=false`

## Stop-before-apply workflow

```bash
# 1) Freeze approved manifests (no DB)
python3 tools/admin-reconciliation/phase5/freeze_approved_manifests.py

# 2) Optional: review snapshot SQL (read-only) — do not apply yet
#    reports/admin-reconciliation-v2/phase5/05-pre-import-snapshot.sql

# 3) Dry-run imports (rollback transaction; writes plans under reports/.../phase5/)
uv run --with 'psycopg[binary]' python tools/admin-reconciliation/phase5/import_admin.py \
  --database-url "$DATABASE_URL" --mode dry-run
uv run --with 'psycopg[binary]' python tools/admin-reconciliation/phase5/import_villages.py \
  --database-url "$DATABASE_URL" --mode dry-run
uv run --with 'psycopg[binary]' python tools/admin-reconciliation/phase5/import_postal.py \
  --database-url "$DATABASE_URL" --mode dry-run

# 4) Apply only after explicit human approval:
#    - migration SQL for ref_postal_codes
#    - then import_*.py --mode apply
#    - then 05-validation.sql
```

## Intentionally not done here

- No production `APPLY`
- No migration run against Supabase/production
- No Martin / PMTiles / API business-logic changes
