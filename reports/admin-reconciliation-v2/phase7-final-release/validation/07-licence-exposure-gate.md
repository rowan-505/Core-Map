# Phase 7 licence and public exposure gate

Generated: 2026-09-21  
Sources: `07-licence-decision.md`, `07-production-runbook.md`, API/dashboard/search/tile code inspection.

## Exposure matrix

| Channel | Allowed by licence decision? | Would placeholders become visible after planned rebuild? | Verdict |
|---|---|---|---|
| Internal database storage | Yes (tagged `permission_pending`) | N/A (storage) | Allowed |
| API exposure | Not as official boundaries | **Yes risk** — dashboard admin-geography returns `geometry_source` and counts `mimu_placeholder` (`admin-areas.geography.repo.ts`) | Not approved for public clients without filter |
| Search exposure | Only if labelled approximate / non-official | **Yes risk** — runbook step 6 rebuilds `admin_areas` / settlements via `search.rebuild_search_documents`; source views in `116_search_source_views.sql` do **not** exclude `geometry_source='mimu_placeholder'` | Not approved without search filter/label work |
| PMTiles / Martin | **Not approved** as official MIMU geometry | Planned step 7 rebuild/invalidate would publish geometries unless tile SQL filters `is_official_boundary` / excludes placeholders | Not approved |
| Public-map display | Only approximate labelling if shown | Web basemap consumes `admin_areas` layers; placeholders have `is_official_boundary=false` but still risk appearing if layer query is not official-only | Not approved without explicit style/query gate |

## Required attribution / labelling (from licence decision)

- Acknowledge MIMU as source; keep `source_version` / reference metadata.
- Keep `permission_pending`.
- Must not present as official surveyed CoreMap boundaries.
- Approximate / unverified labelling required if any UI shows them.

## Gate result (forced vocabulary)

**PASS_DATABASE_ONLY**

Not `PASS_FULL_PUBLICATION` (tiles/public map/unfiltered search not licensed).  
Not `FAIL_PENDING_LICENCE` for **database-only** storage under existing tags (names+placeholder geom with permission_pending already decided).

Public search/API/tile publication remain **FAIL** until filters + labelling land.
