# Phase 7 — MIMU licence / public-use decision

**Status for Phase 7 production apply:** CONDITIONAL APPROVE with hard publication guards  
**Date:** 2026-09-21  
**Source of record:** `reports/admin-reconciliation/license-provenance.md`

## Decision

| Asset | Production use in Phase 7 | Allowed? |
|---|---|---|
| MIMU v9.7 names, hierarchy, reconciliation facts | Update matched CoreMap names / parent / type; attribution retained | **Yes** (acknowledge MIMU) |
| MIMU boundary / point geometry as `mimu_placeholder` | Insert into PostGIS with tags: `geometry_source=mimu_placeholder`, `reference_source=mimu`, `source_license_status=permission_pending`, `is_official_boundary=false`, `boundary_status=approximate` | **Yes, internal + searchable as approximate only** |
| MIMU geometry in **public PMTiles / CDN tiles / downloads** as official CoreMap boundaries | Rebuild/invalidate tiles only if placeholders are styled as approximate / non-official, or exclude from official boundary layers | **Not approved as official geometry** until written permission |
| Myanmar Post postal codes (17,297) | Store in `ref.ref_postal_codes` for API lookup | **Yes** with provenance; legal review before bulk public redistribution/download |
| OSM geometry | Not the Phase 7 placeholder source | N/A this phase |

## Required product behaviour after apply

1. Never present MIMU placeholders as official administrative boundaries.
2. Keep `permission_pending` / `needs_review` visible to admin tools.
3. Public map may show approximate locality search hits only if UI labels them approximate (or omit from official admin layers).
4. Do not strip MIMU attribution / source_version from `source_refs` / metadata.
5. Tile rebuild (step 7) must not market placeholder polygons as surveyed/official CoreMap boundaries.

## Gate

Phase 7 may proceed under this conditional decision.  
**Blockers for later “official boundary” promotion:** written MIMU redistribution permission (or replacement OSM/other licensed geometry) + verification pass.
