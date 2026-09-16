# CoreMap tiles

> **Documentation index:** [`docs/tiles.md`](../../docs/tiles.md)

Offline tile pipelines and local dev assets for map rendering.

| Area | Path | Role |
|------|------|------|
| **Overview PMTiles** | [`pmtiles/overview/README.md`](pmtiles/overview/README.md) | Core admin + Natural Earth context (z0–z8) |
| **Regional PMTiles** | [`pmtiles/README.md`](pmtiles/README.md) | OSM-derived PostGIS basemap per region (Yangon, …) |
| **Local data** | [`data/README.md`](data/README.md) | Gitignored downloads and processed inputs |
| **Martin** | [`martin/README.md`](martin/README.md) | Dynamic vector tiles from PostGIS (dashboard overlays) |

Rendering rule: **PMTiles = static basemap**. Live POIs, search, routing, and edits come from the **API**, not tiles.
