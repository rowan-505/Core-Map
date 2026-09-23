# Local create_new + CoreMap clip (preview)

**Generated:** 2026-09-21T11:36:50.978Z

## Policy

- Undecided Local rows → `create_new` (MIMU becomes new CoreMap later).
- Existing CoreMap id is **kept** (not deleted).
- Preview only: `core_after = core_before − MIMU` (no database write).

## Counts

- Decisions written: **17**
- Clip preview ok: **17**
- Warn: **0**
- Error: **0**

## How to view

1. Open Phase 3 viewer → **Local** tab.
2. Uncheck **undecided only** (these are now `create_new`).
3. Filter / search the place name.
4. Turn on **Clip preview** on the map (MIMU orange, CoreMap before gray, after green).

Previews folder: `reports/admin-reconciliation-v2/phase3-clip-previews`
Plan CSV: `reports/admin-reconciliation-v2/03-local-create-new-clip-plan.csv`

