# Myanmar overview PMTiles (no MIMU) — v2

National low-zoom basemap. Native tippecanoe zoom **z0–z8**. MapLibre overzooms z8 tiles so Myanmar country fill/outline stay visible through camera **z20**.

Myanmar admin comes only from CoreMap. Natural Earth supplies world context only.

## Source flow

```text
Supabase: core.core_admin_areas
    ↓
npm run tiles:sync
    ↓
tile_source.admin_areas   (local snapshot — build source of truth)
    ↓
npm run tiles:export:overview-admin
    ↓
myanmar_country
myanmar_state_region
myanmar_state_labels
    ↓
npm run tiles:rebuild:overview -- v2
    ↓
myanmar-overview-v2.pmtiles
    ↓
verify + local QA
    ↓
explicit upload later (not automatic)
```

| Layer | Owner |
|-------|--------|
| Canonical geometry | Supabase `core.core_admin_areas` |
| Local build snapshot | `tile_source.admin_areas` (via `tiles:sync`) |
| Country national shape | exactly **1** active `admin_level_code=country` row (geom as-is) |
| Internal boundaries / labels | official **15** `state_region` from `packages.yaml` (not Wa extras) |
| World / neighbors / ocean / land / hydrography / places | Natural Earth |
| MIMU | **Not used** |

Rules:

- Sync stays separate from rebuild (no auto-sync).
- Rebuild never auto-uploads or switches production.
- Build scripts never query Supabase directly.
- Export reads **current** DB geometry every run — no committed GeoJSON override.
- Failed rebuild keeps the previous good local v2 artifact (`*.new` then atomic rename).
- Keep `v1` on R2 for rollback until `v2` is confirmed live.
- While v2 is still being refined, a successful local rebuild **replaces** local `myanmar-overview-v2.pmtiles` in place. Do **not** invent v3 for geometry-only refreshes.

## Geometry notes

- Current country geometry may be visually imperfect (maritime/island extras). That is a **known temporary geometry limitation**, not a pipeline failure.
- Later: replace the country MultiPolygon in Supabase (same table, same `country` row). Then re-run the operator flow below — **no code changes required**.

## Operator flow (v2)

```bash
npm run tiles:sync
npm run tiles:validate:overview-source
npm run tiles:rebuild:overview -- v2
npm run tiles:verify:overview -- v2
npm run tiles:serve                           # terminal 1
npm run tiles:qa:web                          # terminal 2
# manual visual QA: z3–z8 native, then z10/z12/z14/z16/z18/z20 overzoom
# country fill + national outline must remain visible through z20
npm run tiles:upload:overview -- v2           # only when approved
npm run tiles:verify:r2:overview -- v2
CONFIRM=1 npm run tiles:switch:overview -- v2
```

After a QGIS-curated country geom replace in Supabase (same active country row):

```bash
npm run tiles:sync
npm run tiles:validate:overview-source
npm run tiles:rebuild:overview -- v2
npm run tiles:verify:overview
npm run tiles:serve
npm run tiles:qa:web
```

Rollback pointer (does not delete R2 objects):

```bash
CONFIRM=1 npm run tiles:switch:overview -- v1
```

## Commands cheat sheet

| Step | Command |
|------|---------|
| Sync local snapshot | `npm run tiles:sync` |
| Validate overview source | `npm run tiles:validate:overview-source` |
| Export admin GeoJSONSeq | `npm run tiles:export:overview-admin` |
| Rebuild overview | `npm run tiles:rebuild:overview -- v2` |
| Local verify | `npm run tiles:verify:overview -- v2` |
| Live-DB export assertion | `npm run tiles:check:overview-export-live-db` |
| No-MIMU regression | `npm run tiles:check:overview-no-mimu` |
| Upload (explicit) | `npm run tiles:upload:overview -- v2` |
| Verify R2 | `npm run tiles:verify:r2:overview -- v2` |
| Switch pointer | `CONFIRM=1 npm run tiles:switch:overview -- v2` |

Local artifact: `infrastructure/tiles/pmtiles/overview/regions/myanmar-overview-v2.pmtiles`  
R2 object key: `basemaps/overview/v2/myanmar-overview-v2.pmtiles`

## Overzoom

| Constant | Value |
|----------|--------|
| Overview native maxzoom | **8** |
| Public map camera maxzoom | **20** |
| `myanmar-country-fill` / `myanmar-country-outline` | remain visible via z8 overzoom through camera z20 |

## Related

- Regional PMTiles: [`../README.md`](../README.md)
- Local data layout: [`../../data/README.md`](../../data/README.md)
