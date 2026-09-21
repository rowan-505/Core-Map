# V2 one-time import order

Generated: `2026-09-21T15:38:06Z`

Production import order (runtime resolves numeric IDs from frozen `public_id`):

1. Township parent creates/updates (incl. Pangsang `7c8315d4-ab5a-4b41-974a-fb3cbe249fc9`)
2. Ward / village-tract creates/updates
3. Approved admin duplicate merges
4. Village creates/updates
5. Approved settlement duplicate merges
6. Approved name aliases
7. Postal-row import
8. Postal FK resolution (`local_admin_area_id` / `township_admin_area_id` via public_id map)

Rules:
- Temporary transaction-local source_key → id mapping allowed
- Permanent MIMU staging/mapping table forbidden
- Do not store MIMU PCode as `external_id`
- Do not use disposable numeric IDs in manifests
- Placeholders: `geometry_source=mimu_placeholder`, `verification_status=needs_fix`, `is_verified=false`, `is_public_usable=false`, `boundary_status=approximate`, `is_official_boundary=false`
- Public exposure remains **PASS_DATABASE_ONLY**
