# Phase 2 manifest import — apply

Complete official village coverage cannot yet be verified: approved inventory has no complete village sheet in 01-admin-actions.csv. Villages must not be inserted into core_admin_areas; reconcile separately in core_settlements. Preserve existing village settlement points (production baseline 54,768) unless a duplicate is proven.

## By level

| Level | kept | renamed | reparented | reclassified | newly created placeholder | extra/reference | disabled | manual review remaining | other |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| state_region | 0 | 15 | 0 | 0 | 0 | 5 | 0 | 0 | 0 |
| self_administered_zone | 0 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| district | 0 | 70 | 4 | 0 | 0 | 5 | 0 | 3 | 0 |
| township | 0 | 228 | 99 | 0 | 0 | 28 | 0 | 3 | 0 |
| ward_village_tract | 46 | 1579 | 0 | 4 | 0 | 502 | 0 | 358 | 15082 |

## Outcome totals

| Outcome | Count |
|---|---:|
| create_skipped_no_valid_geometry | 14935 |
| renamed | 1898 |
| extra/reference | 540 |
| manual_review_remaining | 364 |
| create_skipped_unresolved_parent | 147 |
| reparented | 103 |
| kept | 46 |
| reclassified | 4 |

## Multi-flag counts (rows may count in more than one)

- renamed_flag: 2019
- reparented_flag: 103
- reclassified_flag: 4
- create_flag: 0

## Postconditions

| Check | Value | Pass |
|---|---|:---:|
| source_rows_accounted_for | 18037/18037 | yes |
| official_first_level_15 | 15 | yes |
| official_township_330 | 327+3 manual /330 | yes |
| unique_public_id | True | yes |
| unique_slug | True | yes |
| duplicate_create_hierarchy_path | 0 | yes |
| duplicate_official_pcode | 0 | yes |
| matched_geom_stable | changed=0/2069 | yes |
| manual_review_not_imported | 0 | yes |
| mimu_placeholder_rows | 0 | yes |
| towns_in_approved_inventory | 0 | yes |

## Notes

- `create_mimu_placeholder` rows with `spatial_evidence core_id=N` are promoted to matched updates (geometry preserved).
- WVT creates have no MIMU polygon in the comparison set → `create_skipped_no_valid_geometry`.
- Towns: not present in approved 01-admin-actions inventory.
- Production apply is blocked until this dry-run report is approved.

