# Phase 1 source and licence provenance

Audit date: 2026-09-21. This file records the sources used for the read-only reconciliation audit. It does not approve a Phase 2 migration or any production publication.

## Decision summary

| Data class | Audit use | Production reuse decision |
|---|---|---|
| MIMU v9.7 names, PCodes, hierarchy, and status fields | Canonical comparison source | Permitted with acknowledgement of MIMU as source, based on the workbook metadata reproduced below. Preserve attribution and source version. |
| MIMU v9.4 boundary geometry | Spatial comparison/QA only | **Not approved** for CoreMap production geometry, PMTiles, public download, or redistribution. The located materials do not grant a clear open redistribution/public-tile licence, and MIMU publishes additional web/commercial-use restrictions. Written permission or a separately documented compatible licence is required. |
| OpenStreetMap geometry | Exact-PCode candidate discovery and geometry-source proposal | Eligible subject to the ODbL, attribution, and produced-work/database obligations. Phase 1 copied no geometry into production. |
| Myanmar Post postal-code rows | Read-only matching and report generation | Source repository declares GPL-3.0 and Myanmar Post copyright. Preserve notices and provenance. Obtain legal review before redistributing the compiled dataset through a public API or download because code/data copyleft scope is not clarified separately. |

## MIMU administrative source

- Dataset: `Myanmar PCodes Release_9.7_Jan_2026_(StRgn_Dist_Tsp_Town_Ward_VT)`.
- Local audit copy: `infrastructure/tiles/data/mimu/pcodes/Myanmar_PCodes_Release_9.7_Jan2026_StRgn_Dist_Tsp_Town_Ward_VT.xlsm`.
- SHA-256: `11fff1b1eca8b1ff3cad3b0a90e757a187ae0b9cdc396bac708136da36ccdda2`.
- Originator in workbook metadata: Myanmar Information Management Unit (MIMU).
- Publication date in workbook metadata: January 2026.
- Access constraints in workbook metadata: `None`.
- Use constraints in workbook metadata: `Acknowledgement of MIMU as source`.
- Official source catalogue: [MIMU Place Codes](https://themimu.info/place-codes).
- Official release announcement: [Mapping Myanmar: Updated Place Codes v9.7 + PCoder Tool](https://themimu.info/news/mapping-myanmar-updated-place-codes-v97-pcoder-tool).
- Release corroboration: [MIMU v9.7 major changes, January 2026](https://themimu.info/sites/themimu.info/files/documents/MIMU_PCodesMajorChangesbetweenVersion9.6and9.7_22Jan2026_0.pdf).

The audit therefore treats the v9.7 workbook's bilingual names, PCodes, hierarchy, and active/inactive status as usable reconciliation facts with MIMU attribution. The raw workbook should not be republished as a CoreMap-owned dataset, and attribution must remain attached to derived records.

### Geometry located for comparison

The repository contains MIMU WFS boundary archives under `infrastructure/tiles/data/mimu/admin-boundaries/`. Their embedded `wfsrequest.txt` files point to MIMU GeoNode/GeoServer WFS endpoints. The layers identify themselves as PCode version 9.4, not the canonical v9.7 workbook version.

| Archive | Level | PCode version | SHA-256 |
|---|---|---|---|
| `mmr_polbnda_adm0_250k_mimu_1.zip` | country | 9.4 | `b352680520c1f9437af1e13b1358fde00089454c4947f400dfdce689cbd544f4` |
| `mmr_polbnda_adm1_250k_mimu_1.zip` | state/region | 9.4 | `a7568b80584f8620a7d12d3e7c61f5432b10f540ca71a7fb23258f5dea155bb7` |
| `mmr_polbnda_adm2_250k_mimu.zip` | district | 9.4 | `beea8c3fcf2590fddf743daa9b7a043ee3d0279615625e1b4409ff783e2b2285` |
| `mmr_polbnda_adm3_250k_mimu_1.zip` | township | 9.4 | `084a8dc122c3f0ff4084674cc3d31f4cd5d160694721f65741f35ce767e86d48` |

MIMU's [Mapping and Spatial Data catalogue](https://themimu.info/mimu-catalogue/mapping-and-spatial-data) and its published [map-product use terms](https://documents.themimu.info/browse/villagemaps/fileagreement.php?path=documents/Sector_Map/Population/Myanmar_Population_2020_Calculation) describe restrictions that are not equivalent to an open redistribution licence. Because no explicit permission for CoreMap's public/commercial web-map redistribution was found, these geometries were used only as read-only QA evidence. They must not be copied into PostGIS, rendered into public tiles, or redistributed without written permission or a compatible licence tied to the exact release.

## OpenStreetMap geometry source

- Local extract: `tools/data-pipeline/local-osm/data/osm/myanmar-260823.osm.pbf`.
- Extract filename date: 2026-08-23.
- SHA-256: `e64c3e2f2a67ca4d7b8b61aa0883e6414db27539b435b3ea895bcde9e18c1dfb`.
- Licence: [Open Data Commons Open Database License (ODbL) 1.0](https://www.openstreetmap.org/copyright).
- Attribution: `© OpenStreetMap contributors` with a link to the copyright page in public map/product attribution.

The audit extracted administrative multipolygons read-only and used exact PCode tags only to identify legally usable geometry candidates. A `create_missing` proposal means an exact-PCode OSM polygon exists; it is not permission to insert it automatically. Phase 2 must retain OSM provenance, validate topology and hierarchy, and meet ODbL attribution/produced-work obligations.

## Myanmar Post postal-code source

- Upstream repository: [MyanmarPost/MyanmarPostalCode](https://github.com/MyanmarPost/MyanmarPostalCode).
- Release/source directory: `Myanmar Postal Code V-1.0`, September 2021.
- Download URL recorded by the local file: [Complete Data.zip](https://raw.githubusercontent.com/MyanmarPost/MyanmarPostalCode/main/Myanmar%20Postal%20Code%20V-1.0/Complete%20Data.zip).
- Local audit copy: `/Users/nyihtet/Downloads/Complete Data.zip`.
- ZIP SHA-256: `782daf6918f7355d9445ab417a9b20015bb49d6fb732a760571adc55635496ca`.
- English CSV SHA-256: `a77b85f6bf3be7b4ed6fe54bcc4a962b9454cd7f9e49f677c9884b2f5842a5ae`.
- Myanmar CSV SHA-256: `2964b0097e3f586f8f3b7c1a5318b4ce17e242f656cf6fde1d3fd3bd6d8c9b54`.
- Declared repository licence: [GNU GPL v3](https://github.com/MyanmarPost/MyanmarPostalCode/blob/main/LICENSE).
- Copyright/source attribution: Myanmar Post.

The reports preserve all unique bilingual variants and duplicate-source counts per seven-digit code. They do not silently discard duplicate rows or repair the malformed `114560` value. The raw ZIP/CSVs are not copied into the report directory.

## Publication guardrails

1. Do not publish or tile MIMU geometry on the basis of this audit.
2. Keep MIMU attribution and v9.7 source references on any approved names/PCode/hierarchy updates.
3. Keep OSM attribution and per-feature provenance on any later geometry import.
4. Keep Myanmar Post copyright/licence notices on postal-code derivatives; seek legal review before public bulk redistribution.
5. Do not treat a source's presence in the repository as proof of production reuse rights.
6. Re-run licence verification if a newer source release is substituted in Phase 2.
