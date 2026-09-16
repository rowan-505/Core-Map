# Regional PMTiles (basemap)

Static vector basemap archives and per-region `current.json` pointers. Paths mirror CDN layout: `regions/<region>/…`.

---

## Hybrid architecture (final)

```text
Supabase Core (managed features)
        │
        │  tiles:sync (transactional snapshot)
        ▼
Windows PostgreSQL  coremap_tiles
  tile_source.*_base      permanent bulk baseline
  tile_source.*_archive   demoted previously-managed features
  tile_source.*_core      refreshable Core caches
  tile_source.*_suppressed  DELETE tombstones (buildings/land only)
  tile_source.*_v         Suppression > Core > Archive > Base
        │
        │  tiles:export / tiles:rebuild (local DB only)
        ▼
PMTiles  = rendering artifacts only (never source of truth)
        │
        │  tiles:upload  (explicit; never from promote/demote/delete)
        ▼
Cloudflare R2 + current.json / manifest
```

### Source ownership

| Location | Role |
|----------|------|
| **Supabase Core** | Important actively managed CoreMap features |
| `tile_source.buildings_base` / `land_areas_base` | Permanent bulk baseline (never deleted by promote/demote) |
| `tile_source.buildings_archive` / `land_areas_archive` | Demoted previously-managed copies |
| `tile_source.buildings_core` / `land_areas_core` | Refreshable Supabase caches |
| `buildings_v` / `land_areas_v` | Resolved render identity: **Suppression → Core → Archive → Base** |
| Other static layers (streets, water, admin, …) | Supabase → Windows snapshot → PMTiles |
| **PMTiles** | Generated rendering artifacts only |

Promote / Demote / Delete change **source state only**. They never rebuild PMTiles, never upload to R2, and never modify the published `current` release.

---

## Building / land lifecycle

**Meanings**

| Action | Effect |
|--------|--------|
| **Promote** | Local Base or Archive → Supabase Core (prefer Archive over Base); then refresh local `*_core` cache |
| **Demote** | Preflight → write Archive locally → remove Core → sync cache. Not a DELETE. |
| **Delete** | Write render suppression + remove Core. Base/Archive stay on disk but do not resolve in `*_v`. Requires `--confirm-delete`. |

**Commands** (buildings and land only — no streets lifecycle)

```bash
npm run tiles:promote-building -- osm:way:<id>
npm run tiles:demote-building -- osm:way:<id>
npm run tiles:delete-building -- --confirm-delete osm:way:<id>

npm run tiles:promote-land -- osm:way:<id>
npm run tiles:demote-land -- osm:way:<id>
npm run tiles:delete-land -- --confirm-delete osm:way:<id>
```

Optional local admin UI (DEV only): dashboard `/dashboard/local-basemap` when `ENABLE_LOCAL_BASEMAP_ADMIN` + `NEXT_PUBLIC_ENABLE_LOCAL_BASEMAP_ADMIN` are set. Browser never talks to PostgreSQL.

### Invariants (verified)

1. Base rows are not deleted by promote/demote.  
2. Promote prefers Archive over Base.  
3. Promote is idempotent by canonical OSM identity (`osm:way|relation:<id>`).  
4. Demote archives before Core removal.  
5. Unsafe dependencies block Demote (HTTP 409).  
6. Demote never writes a suppression tombstone.  
7. Delete suppresses Base and Archive in `*_v`.  
8. Failed `tiles:sync` keeps the previous good local snapshot (staging replace).  
9. Local PMTiles builds read only Windows `LOCAL_TILE_DATABASE_URL` after sync.  
10. Production package defs stay version-controlled (`config/packages.yaml`).  
11. Region splits follow package config / corrected PMTiles size practice, not ad-hoc geography.  
12. Local visual QA (`tiles:qa:web`) is DEV-only.  
13. Generated PMTiles, MBTiles, GeoJSON exports, dumps, and QA artifacts are Git-ignored.  
14–15. Env/sync/promote paths log **host:port only**, not full connection strings or tokens (`load-root-env.sh` / sync `log_host`).

### Partial-safe recovery

| State | What happened | Recovery |
|-------|---------------|----------|
| Archive OK, Core removal failed | Demote exit ≠ 0; message includes **Core still wins**; Archive kept | Fix blocker; re-run `tiles:demote-*` (Archive may update again) |
| Core write OK, local sync failed | Promote/delete exit `3`; Core (or suppression) is valid in Supabase | Re-run `npm run tiles:sync -- buildings_core` (or `land_areas_core` / `*_suppressed`) |
| Delete blocked by dependencies | No suppression written | Clear links/reports; retry with `--confirm-delete` |
| Promote blocked by suppression | No Core write | Clear suppression (API/CLI clear) then promote |

---

## Normal PMTiles release flow

Promotion/demotion/delete do **not** trigger this. Run only when you intentionally ship tiles:

```bash
# 1. Update code
git pull   # or your usual update

# 2–4. Tools + local snapshot + validate
npm run tiles:check-tools
npm run tiles:sync
npm run tiles:validate-source

# 5. Build required packages (local Windows DB only)
npm run tiles:rebuild -- yangon v2          # or tiles:export then tiles:build
# npm run tiles:validate-packages

# 6. Structural check
pmtiles show infrastructure/tiles/pmtiles/regions/yangon/yangon-v2.pmtiles

# 7. Local production-style visual QA (DEV only)
npm run tiles:serve          # terminal 1
npm run tiles:qa:web         # terminal 2

# 8–9. Explicit R2 upload + verify (never automatic from lifecycle)
npm run tiles:upload -- yangon v2
bash infrastructure/tiles/pmtiles/scripts/check-pmtiles-url.sh \
  "https://<public-r2>/basemaps/yangon/v2/basemap.pmtiles" \
  "http://localhost:5173"
# Confirm Range / CORS / current.json or app env pointers as needed
```

Do **not** overwrite a live R2 object key in place; publish a new version path, then cut over `current.json` / env URLs.

---

## Build vs rebuild — which command to use

The pipeline has two phases. **Do not confuse them:**

```text
Supabase → tiles:sync → Windows coremap_tiles → export → Tippecanoe → PMTiles

export   local tile_source.* (LOCAL_TILE_DATABASE_URL)  →  exports/<region>/*.geojson
build    exports/<region>/*.geojson  →  regions/<region>/<region>-<version>.pmtiles
```

| Command | Phases | Needs `LOCAL_TILE_DATABASE_URL`? |
|---------|--------|----------------------------------|
| `npm run tiles:export -- <region> <version>` | export only | Yes (local coremap_tiles only) |
| `npm run tiles:build -- <region> <version>` | build only | No |
| `npm run tiles:rebuild -- <region> <version>` | export + build | Yes |
| `npm run tiles:sync -- …` | Supabase → local snapshots | Yes + `SUPABASE_DATABASE_URL` |
| `npm run tiles:upload -- <region> <version>` | upload built `.pmtiles` to R2 | No (needs Wrangler; not part of export) |

### Decision rule

```text
Are exports/<region>/*.geojson present AND up to date with the database?
  YES → tiles:build   (faster; no DB/network)
  NO  → tiles:rebuild   OR   tiles:export then tiles:build
```

**`tiles:build` is not safe in every situation.** It never reads the database. If GeoJSON on disk is missing or stale, build will fail or produce wrong tiles.

### When to use `tiles:build`

- Export already finished for this region/version
- Re-running tippecanoe after a **build-only** failure (export succeeded, build crashed)
- Tuning build flags: `--roads-only`, `--skip-buildings`, `--light-only`
- Iterating on tippecanoe options without DB changes

```bash
npm run tiles:build -- yangon v2
```

### When to use `tiles:rebuild`

- **New region** — no `exports/<region>/` yet (`build` will fail with missing GeoJSON)
- **Database changed** — tile view columns, migrations, backfills, OSM import
- You need a guaranteed fresh snapshot from PostGIS

```bash
npm run tiles:rebuild -- yangon v2
```

Equivalent two-step form (same result):

```bash
npm run tiles:export -- yangon v2
npm run tiles:build -- yangon v2
```

### Scenario cheat sheet

| Situation | Command | Why |
|-----------|---------|-----|
| First time for a new region (e.g. `mandalay v1`) | `tiles:rebuild` | No exports exist yet |
| Changed `tiles.*_v` view columns or DB data | `tiles:rebuild` | On-disk GeoJSON is stale |
| Export done; build failed or not started | `tiles:build` | Re-export would be wasted time |
| Same exports; retry after tippecanoe error | `tiles:build` | DB unchanged |
| Debug road/label pass only | `tiles:build -- --roads-only` | Skips heavy non-road layers |
| Production archive after confirmed export | `tiles:build` | Fastest full build |

### Time and cost

| | `tiles:build` | `tiles:rebuild` |
|--|---------------|-----------------|
| **Time** | Build only (tippecanoe is usually the longest step) | Export (~minutes) **+** build |
| **Database** | Not used | 10 clipped `ogr2ogr` queries per region |
| **Network** | Local files only | Pulls large GeoJSON from Supabase |
| **Wasteful when** | Exports missing or stale | Exports already fresh (re-exports for no reason) |

For Yangon, export alone is often ~3–4 minutes; the streets tippecanoe pass is often much longer. **Avoid `rebuild` when `build` is enough.**

### Partial pipeline failure

If `tiles:rebuild` finishes export but fails before build (for example a script error after `export complete`):

- `exports/<region>/` is valid — **do not** run full `rebuild` again
- Run **`tiles:build`** to complete the `.pmtiles` step only

### New region example

```bash
# First time — must hit the database
npm run tiles:rebuild -- mandalay v1

# Later — exports unchanged, retry build only
npm run tiles:build -- mandalay v1

# After DB/view changes
npm run tiles:rebuild -- mandalay v1
```

---

## Normal build (recommended after export)

```bash
# From repo root — uses existing exports/yangon/*.geojson
npm run tiles:build -- yangon v2
```

**Stage milestones** (source of truth — not tippecanoe inner %):

| % | Stage |
|---|-------|
| 5 | input inventory |
| 15 | validating GeoJSON |
| 22 | preparing GeoJSONSeq |
| 28 | building light layers |
| 55 | building roads (dense streets pass) |
| 75 | building road labels |
| 90 | finalizing PMTiles (tile-join + convert) |
| 100 | done |

During long commands (prepare, tippecanoe, finalize), an **estimated progress ticker** updates every 2 seconds on one line:

```text
[build] 28.43% building light layers... elapsed 1m 24s (estimated)
```

The ticker slowly moves between the current milestone and the next minus 0.01. It never reaches 100% until the command actually finishes. When a stage completes, the script prints the real next milestone line with stage/total elapsed time.

Disable the ticker:

```bash
npm run tiles:build -- yangon v2 --no-progress-ticker
```

Full build logs are also written to `infrastructure/tiles/pmtiles/logs/build-<region>-<version>-<timestamp>.log`.

---

## Debug fast builds

```bash
# Fastest — roads + labels only (Yangon clipped ~77k streets, 105 labels)
npm run tiles:build -- yangon v2 --roads-only

# Skip buildings (admin, water, roads, labels)
npm run tiles:build -- yangon v2 --skip-buildings

# Admin/water/landuse only (no streets pass)
npm run tiles:build -- yangon v2 --light-only
```

| Option | Layers built | Speed | Use for |
|--------|--------------|-------|---------|
| `--roads-only` | `streets`, `road_labels` | **Fastest** | Road line + label smoke test |
| `--light-only` | admin, water, landuse, buildings | Fast | Basemap context without streets pass |
| `--skip-buildings` | all except `buildings` | Medium | Full basemap minus buildings |
| (default) | all 9 layers | Normal | Production archive |

Pass the same flags to `tiles:rebuild` when you need a fresh export.

---

## Full rebuild from database

```bash
npm run tiles:rebuild -- yangon v2
```

Stages: **export 0–25%** → **build 25–100%**.

Requires `LOCAL_TILE_DATABASE_URL` pointing at local `coremap_tiles` (not Supabase). Run `tiles:sync` separately before export when local snapshots need refresh.

---

## Regional clipping (export)

Each regional export is **spatially filtered** to one Myanmar state/region polygon from local `tile_source.admin_areas` (`admin_level_code = state_region`), plus a buffer around the border.

| Setting | Default | Purpose |
|---------|---------|---------|
| `PMTILES_REGION_BUFFER_METERS` | `10000` (10 km) | Expands the boundary so neighboring regional tiles overlap slightly — avoids visual gaps at borders |

**Behavior:**

- Export resolves the region key (e.g. `yangon`) to exactly one `state_region` row — not township/ward polygons.
- Every export layer uses a `region_boundary` CTE (buffered polygon) and `ST_Intersects(layer.geom, region_boundary.geom)`.
- The buffered polygon is split with `ST_Subdivide` so spatial filters stay fast on large layers (still `ST_Intersects`, not bbox-only).
- Hard clipping (`ST_Intersection`) is **not** used yet (avoids broken geometry and heavy queries).
- Overview PMTiles are unchanged (whole-country).

**Supported region keys:**  
`yangon`, `bago`, `ayeyarwady`, `mandalay`, `magway`, `sagaing`, `tanintharyi`, `naypyitaw`, `kachin`, `kayah`, `kayin`, `chin`, `mon`, `rakhine`, `shan`

**Yangon rebuild (clipped export + build):**

```bash
npm run tiles:rebuild -- yangon v2
```

After clipping, `exports/yangon/streets.geojson` should be **much smaller** than a whole-country export (no ~800k nationwide streets).

**Rebuild all regions sequentially (export + build):**

```bash
npm run tiles:rebuild:regions -- v1
YANGON_VERSION=v2 npm run tiles:rebuild:regions -- v1   # Yangon v2, other regions v1
npm run tiles:rebuild:regions -- v1 mandalay            # start at Mandalay
CONTINUE_ON_ERROR=1 npm run tiles:rebuild:regions -- v1
```

Logs: `infrastructure/tiles/pmtiles/logs/rebuild-all-<timestamp>.log`. Stops on first failure unless `CONTINUE_ON_ERROR=1` or `--continue-on-error`.

**Build all regions from existing exports (no DB):**

```bash
npm run tiles:build:regions -- v1
```

Logs: `infrastructure/tiles/pmtiles/logs/build-all-<timestamp>.log`.

**Verify export counts** — each layer prints after clipping:

```text
[export] clipped streets: 45231 features, 89M
[export] clipped buildings: 12034 features, 45M
```

Compare with `build-region.sh` input inventory (feature count + file size). Inspect archive bounds:

```bash
pmtiles show infrastructure/tiles/pmtiles/regions/yangon/yangon-v2.pmtiles
```

Bounds should match the region (+ buffer), not lat 9–28 whole-country.

**Change buffer** — set before export/rebuild:

```bash
PMTILES_REGION_BUFFER_METERS=15000 npm run tiles:rebuild -- yangon v2
```

Larger buffer = more overlap at borders and slightly larger files.

---

## Input inventory (printed every build)

Before tippecanoe, the build prints size + feature count for:

- `streets.geojson` — largest layer (Yangon clipped ~77k features, ~51MB)
- `road_labels.geojson` — named labels only (no `road-*` canonical)
- `admin_areas.geojson`, `admin_boundaries.geojson`, `admin_area_label_points.geojson`
- `buildings.geojson`, `landuse.geojson`
- `water_lines.geojson`, `water_polygons.geojson`

---

## Build performance strategy

Three tippecanoe passes + `tile-join` (stable layer names unchanged):

1. **Light** — admin, water, landuse, buildings, settlements, coastlines, protected_areas
2. **Roads** — `streets` only (class-based minzoom hints + coalesce; all clipped features kept through z20)
3. **Labels** — `road_labels` only (z12+; named streets from local `tile_source.streets`)

`prepare-tippecanoe-input.py` adds per-feature `tippecanoe.minzoom` / `maxzoom` hints (no SQL changes). Street minzoom prefers DB `min_zoom`, else road-class fallback. Native detail caps around z14–z16; MapLibre camera may overzoom to z20.

### Street class zoom hints

| Road class | minzoom | Visible from |
|------------|---------|--------------|
| motorway, trunk, primary | 8 | regional overview |
| secondary, tertiary | 10 | district |
| residential, unclassified, unknown | 12 | neighbourhood |
| service, track, path, footway | 14 | local |

Yangon clipped (~77k streets): counts scale down proportionally; class-based minzoom visibility rules unchanged.

### Prepare summary (printed each build)

```text
[build] prepare summary (mode=roads-only): before/after features + tippecanoe visibility
  streets                before=   76762  after=   76762  visible@z8=    ...   z10=    ...   z12=    ...   z14=   76762
```

### Streets tippecanoe tuning

- `--coalesce-densest-as-needed` (merge under tile-size pressure; do **not** use `--coalesce-smallest-as-needed` on streets — it sparsified networks)
- `--maximum-tile-bytes` default `2000000` for streets (`PMTILES_STREETS_MAX_TILE_BYTES`)
- `--simplify-only-low-zooms` (geometry detail preserved at high zoom)
- `--no-feature-limit` (no feature-count drops at max zoom)
- Per-feature minzoom reduces tile-size fitting at z8–z13

Road text stays on `road_labels` only — no labels from `streets`.

### Tippecanoe sparsify warnings

If tiles still exceed byte limits, tippecanoe may coalesce or log `sparsest`. The build prints a summary WARNING per pass. Use `PMTILES_DEBUG=1` for full stderr.

---

## Inspect PMTiles layers

```bash
# Metadata + vector layer list
pmtiles show infrastructure/tiles/pmtiles/regions/yangon/yangon-v2.pmtiles

# Serve locally
npm run tiles:serve
# http://localhost:8080/regions/yangon/current.json
```

---

## Upload to Cloudflare R2

Prerequisites: `wrangler login`, built `.pmtiles` on disk.

```bash
# Regional (resolves local path + uploads)
npm run tiles:upload -- yangon v2
npm run tiles:upload -- bago v1

# Overview
npm run tiles:upload -- overview v1
```

Resolved local paths:

| Region | Local file |
|--------|------------|
| `yangon` `v2` | `infrastructure/tiles/pmtiles/regions/yangon/yangon-v2.pmtiles` |
| `overview` `v1` | `infrastructure/tiles/pmtiles/overview/regions/myanmar-overview-v1.pmtiles` |

R2 object key (all regions): `coremap-tiles-prod/basemaps/<region>/<version>/basemap.pmtiles`

Explicit upload (any file path):

```bash
npm run tiles:upload:r2 -- infrastructure/tiles/pmtiles/regions/yangon/yangon-v2.pmtiles yangon v2
```

Verify after upload:

```bash
bash infrastructure/tiles/pmtiles/scripts/check-pmtiles-url.sh \
  "https://pub-1f8b4bea1a884f51966c7916c5e618ce.r2.dev/basemaps/yangon/v2/basemap.pmtiles" \
  "http://localhost:5173"
```

Release checklist: this README (**Normal PMTiles release flow** above). Older notes: `docs/archive/old-docs/tiles/pmtiles/pmtiles-release-workflow.md`.

---

## Optional env

| Variable | Default | Purpose |
|----------|---------|---------|
| `PMTILES_MIN_ZOOM` | `8` | Global tile minzoom |
| `PMTILES_MAX_ZOOM` | `16` | Native regional tile maxzoom (MapLibre can overzoom to z20) |
| `PMTILES_REGION_BUFFER_METERS` | `10000` | Regional export boundary buffer (overlap at state borders) |
| `PMTILES_REGION_SUBDIVIDE_SEGMENTS` | `512` | `ST_Subdivide` segments for fast `ST_Intersects` during export |
| `PMTILES_DEBUG` | `0` | `1` = full tippecanoe stderr + commands (disables quiet tippecanoe during ticker) |
| `PMTILES_PROGRESS_TICKER_ENABLED` | `1` | `0` or `--no-progress-ticker` disables estimated ticker |
| `SKIP_BUILDINGS` | `0` | `1` = same as `--skip-buildings` |
| `BASE_URL` | `http://localhost:8080` | Written into `current.json` |

---

## Prerequisites

```bash
brew install gdal tippecanoe pmtiles
```

Also: Node/npm (for `npm run`), Python 3, `LOCAL_TILE_DATABASE_URL` for export (local `coremap_tiles` only).

---

## Failure cleanup

On failure or Ctrl+C, `build-region.sh` removes temp files only:

- `.tmp-prep-*`, `.tmp-build-*` mbtiles, `.pmtiles.new`

It does **not** delete `exports/` or published `regions/<region>/*.pmtiles`. `current.json` updates only after successful convert.

---

## Layer names (stable — match `base-map.json`)

`streets`, `road_labels`, `admin_areas`, `admin_boundaries`, `admin_area_label_points`, `buildings`, `landuse`, `water_lines`, `water_polygons`, `settlements`, `coastlines`, `protected_areas`

(`road_labels` and admin layer names are kept for MapLibre. `village_labels` was replaced by `settlements`.)

Road lines = `streets`. Road text = `road_labels` only. Admin text = `admin_area_label_points` only (not `admin_areas` polygons). No fake `road-*` labels in PMTiles.

---

## Rollback

Edit `regions/<region>/current.json` to point `filename` / `url` at an older `.pmtiles`. Keep old archives on CDN.

---

## Overview tiles

Separate pipeline — see `overview/README.md` and `npm run tiles:verify:overview`.
