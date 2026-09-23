# 03 Final status summary (Phase7 completion-v3)

Generated: `2026-09-21T16:46:21Z`  
Production: **not touched**  
Production apply: **not generated**

## Postal arithmetic

| Status | Count |
|---|---:|
| `linked_exact` | 15452 |
| `linked_after_review` | 17 |
| `confirmed_non_admin` | 1822 |
| `rejected_source_error` | 6 |
| **Sum** | **17297** |

Required: `linked_exact + linked_after_review + confirmed_non_admin + rejected_source_error = 17297` → **PASS**

## Gates

| Gate | Value | Result |
|---|---:|---|
| missing_local_admin_identity | 0 | PASS |
| ambiguous_local_area | 0 | PASS |
| township_unresolved | 0 | PASS |
| exact_pending_create | 0 | PASS |
| blank/defer | 0 | PASS |

## Admin / village

| Manifest | Rows |
|---|---:|
| `03-admin-actions-v3.csv` | 16177 |
| `03-village-actions-v3.csv` | 54602 |
| `03-admin-alias-actions-v3.csv` | 466 |
| `03-postal-actions-v3.csv` | 17297 |

- Every admin/village row has exactly one action (no blank/defer).
- Empty-PCode Pangsang VT remains `reject_source_error` (not created from postal text).
- Creates use frozen UUID `target_public_id` only (no disposable numeric target id).
- Postal linked rows reference exactly one admin `public_id`; type ward/village_tract; township parent checked.
- Confirmed non-admin rows have null `matched_local_admin_area_id` and null `matched_local_admin_public_id`.
- Alias actions preserve primary names; duplicates suppressed.

## Checksums

See `checksums/03-v3-frozen-manifest.checksums.json`.
