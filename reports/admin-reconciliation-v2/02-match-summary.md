# Admin reconciliation v2 — Phase 2 local match (read-only)

**Generated:** 2026-09-21T07:34:10Z
**Database writes:** none

CoreMap/OSM always wins for IDs and geometries. MIMU PCodes are audit keys only.
Child matching ran only after each source township mapped to one CoreMap township or was sent to manual review.

## Township map

| Status | Count |
|---|---:|
| mapped | 331 |
| manual_review | 23 |
| **total source townships** | 354 |

## Local admin actions (ward + village_tract)

| Action | Count |
|---|---:|
| create_mimu_placeholder | 14045 |
| keep_existing | 1838 |
| manual_review | 239 |
| merge_duplicate_candidate | 14 |
| update_names | 36 |
| update_type | 4 |

**Total source local rows:** 16176

### By entity type

| Entity | Action | Count |
|---|---|---:|
| village_tract | create_mimu_placeholder | 13948 |
| village_tract | manual_review | 223 |
| village_tract | update_type | 4 |
| ward | create_mimu_placeholder | 97 |
| ward | keep_existing | 1838 |
| ward | manual_review | 16 |
| ward | merge_duplicate_candidate | 14 |
| ward | update_names | 36 |

## Village actions

| Action | Count |
|---|---:|
| create_mimu_placeholder | 2457 |
| keep_existing | 48679 |
| manual_review | 1154 |
| merge_duplicate_candidate | 1473 |
| update_names | 825 |
| update_type | 14 |

**Total source village rows:** 54602

## Extra CoreMap rows (no MIMU match under approved townships)

| Set | Count |
|---|---:|
| Extra ward_village_tract | 55 |
| Extra village/local_area settlements | 6887 |

## Foreign-key dependency inventory (export)

| Target | Source | Constraint | On delete |
|---|---|---|---|
| core.core_admin_areas | app.user_saved_places | user_saved_places_admin_area_id_fkey | set_null |
| core.core_admin_areas | app_auth.auth_users | auth_users_primary_region_id_fkey | set_null |
| core.core_admin_areas | core.core_addresses | core_addresses_admin_area_id_fkey | no_action |
| core.core_admin_areas | core.core_admin_area_names | core_admin_area_names_admin_area_id_fkey | no_action |
| core.core_admin_areas | core.core_admin_areas | core_admin_areas_parent_id_fkey | no_action |
| core.core_admin_areas | core.core_buildings | core_buildings_admin_area_id_fkey | no_action |
| core.core_admin_areas | core.core_land_areas | core_land_areas_admin_area_id_fkey | no_action |
| core.core_admin_areas | core.core_places | core_places_admin_area_id_fkey | no_action |
| core.core_admin_areas | core.core_protected_areas | core_protected_areas_admin_area_id_fkey | no_action |
| core.core_admin_areas | core.core_settlements | core_settlements_township_id_fkey | no_action |
| core.core_admin_areas | core.core_streets | core_streets_admin_area_id_fkey | no_action |
| core.core_admin_areas | feedback.user_reports | user_reports_admin_area_id_fkey | set_null |
| core.core_admin_areas | ref.ref_postal_codes | ref_postal_codes_local_admin_area_id_fkey | set_null |
| core.core_admin_areas | ref.ref_postal_codes | ref_postal_codes_township_admin_area_id_fkey | set_null |
| core.core_admin_areas | search.address_index | address_index_admin_area_id_fkey | set_null |
| core.core_admin_areas | tourism.activities | activities_admin_area_id_fkey | restrict |
| core.core_admin_areas | tourism.advisories | advisories_admin_area_id_fkey | restrict |
| core.core_admin_areas | tourism.events | events_admin_area_id_fkey | restrict |
| core.core_admin_areas | tourism.foods | foods_admin_area_id_fkey | restrict |
| core.core_admin_areas | tourism.local_guides | local_guides_admin_area_id_fkey | restrict |
| core.core_admin_areas | tourism.research_candidates | research_candidates_admin_area_id_fkey | restrict |
| core.core_admin_areas | transport.infrastructure_lines | infrastructure_lines_admin_area_id_fkey | no_action |
| core.core_admin_areas | transport.routes | routes_destination_admin_area_id_fkey | no_action |
| core.core_admin_areas | transport.routes | routes_origin_admin_area_id_fkey | no_action |
| core.core_admin_areas | transport.stops | stops_admin_area_id_fkey | no_action |
| core.core_admin_areas | transport.terminals | terminals_admin_area_id_fkey | no_action |

## Rules enforced

- Every source row has exactly one action.
- No geometry replacement on matched CoreMap rows (`preserve_existing_geom=true`).
- No match by name alone across townships; township map is required first.
- No spatial-only auto-match for townships, WVT, or villages.
- `create_mimu_placeholder` does not assign MIMU PCode as CoreMap `external_id`.

## Stop line

Phase 2 matching finished. No database writes were performed.
