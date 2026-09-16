# Local tile source data (gitignored)

This directory is **intentionally ignored by Git**. It holds large, reproducible GIS downloads and build intermediates for offline PMTiles pipelines.

**Do not commit** anything here except this file and `.gitkeep`.

---

## Why this folder exists

Tile builds need local copies of:

- Natural Earth 1:10m shapefiles (overview world/neighbor/hydrography context)
- Core admin GeoJSONSeq exported from local `tile_source.admin_areas`
- Clipped / converted GeoJSONSeq used by tippecanoe
- Temporary extraction and cache files

These files are too large for the repo and can be re-downloaded or regenerated from documented scripts.

---

## Expected local layout

```text
infrastructure/tiles/data/
  .gitkeep
  README.md                 ← only committed files in this tree

  natural-earth/            ← Natural Earth downloads
    zip/                    ← source archives (gitignored)
    unzipped/               ← extracted shapefiles

  processed/                ← tippecanoe-ready GeoJSONSeq
    natural-earth/clipped/  ← output of clip-natural-earth-overview.sh
    overview/               ← Core export: myanmar_country, myanmar_state_region, myanmar_state_labels

  tmp/                      ← optional scratch (safe to delete)
```

**Myanmar admin** is not stored as a third-party download here. Export it from the local tile DB:

```bash
npm run tiles:sync
npm run tiles:export:overview-admin
```

Do **not** create or use a third-party Myanmar admin folder under `processed/` — the active overview pipeline rejects that path.

PMTiles outputs live under **`infrastructure/tiles/pmtiles/`** (also gitignored when `*.pmtiles`).

---

## What Git tracks

| Path | Committed? |
|------|------------|
| `infrastructure/tiles/data/.gitkeep` | Yes |
| `infrastructure/tiles/data/README.md` | Yes |
| Everything else under `data/` | **No** |
| `*.pmtiles`, shapefiles, ZIPs, GeoJSONSeq | **No** |

---

## Related docs

- Overview build workflow: [`../pmtiles/overview/README.md`](../pmtiles/overview/README.md)
- Regional PostGIS PMTiles: [`../pmtiles/README.md`](../pmtiles/README.md)
- Tiles index: [`../README.md`](../README.md)
