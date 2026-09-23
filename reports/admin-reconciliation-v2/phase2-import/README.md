# Phase 2 manifest import (dry-run)

Idempotent importer for approved `../01-admin-actions.csv`.

## Tool

```bash
uv run --with 'psycopg[binary]' python tools/admin-reconciliation/phase2_import_manifest.py \
  --manifest reports/admin-reconciliation-v2/01-admin-actions.csv \
  --mimu-geometries /path/to/mimu_geometries.csv \
  --database-url 'postgresql://postgres:postgres@127.0.0.1:5433/coremap_cleanup' \
  --mode dry-run \
  --out reports/admin-reconciliation-v2/phase2-import
```

- Default refuses Supabase/production URLs unless `--allow-production-host`.
- `--mode apply` writes; use only on disposable/local after dry-run approval.

## Dry-run result (disposable DB after Phase 1 cleanup)

See `01-summary-dry-run.md` and `03-postconditions-dry-run.json`.

| Level | kept | renamed | reparented | reclassified | new placeholder | extra/reference | disabled | manual review | other (mostly create skips) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| state_region | 0 | 15 | 0 | 0 | 0 | 5 | 0 | 0 | 0 |
| self_administered_zone | 0 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| district | 0 | 70 | 4 | 0 | 0 | 5 | 0 | 3 | 0 |
| township | 0 | 228 | 99 | 0 | 0 | 28 | 0 | 3 | 0 |
| ward_village_tract | 0 | 1625 | 0 | 4 | 0 | 502 | 0 | 358 | 15082 |

**New placeholders in this dry-run: 0.** Every geom-backed `create_mimu_placeholder` promoted to an existing CoreMap identity (`spatial_core_id_promote` / SAZ name promote). WVT creates lack MIMU polygons → skipped.

## Villages

Complete official village coverage **cannot yet be verified** (no village sheet in the approved admin-actions inventory). Do not insert villages into `core_admin_areas`. Preserve existing settlement village points (baseline **54,768**) unless a duplicate is proven.

## Production

**Not applied.** Waiting for dry-run approval before any apply.
