# 02 Rejected ambiguous rows — reopened review

Generated: `2026-09-21T15:13:50Z`  
Database: disposable `coremap_phase7_backup_restore`  
Production: **not touched**

## Scope

| Set | Prior reject rows | Unique review rows |
|---|---:|---:|
| Wards (`reject_source_error`) | 8 | 8 |
| Villages (`reject_source_error`) | 9 | 9 |

Prior reject reason for wards was “multiple CoreMap rows share exact normalized name”.
That is **not** proof the MIMU source row is invalid.

Prior reject reason for villages was “spatial-only settlement candidate blocked”.
Distance alone is still not enough to merge; source villages are not automatically errors.

## Proposed decision tallies (pending your approval)

### Wards

| decision | count |
|---|---:|
| `match_existing` | 4 |
| `merge_confirmed_duplicate` | 4 |

### Villages

| decision | count |
|---|---:|
| `create_new` | 7 |
| `match_existing` | 2 |


## Uncertainty gate

- Ward rows still `manual_review`: **0**
- Village rows still `manual_review`: **0**
- Pangsang township identity: **manual_review** (see `01-pangsang-summary.md`)

**STOP:** revised manifests / postal rebuild / import scripts wait until you confirm decisions for:
1. `MMR015005` Pangsang township parent
2. any row marked `requires_user_decision=true` in the CSVs below
3. optional confirmation of automated reopen proposals (`match_existing` / `create_new` / `merge_confirmed_duplicate`)

## Artifacts

- `02-rejected-admin-review.csv`
- `02-rejected-village-review.csv`
- `02-rejected-review-previews/admin/*`
- `02-rejected-review-previews/village/*`

## Allowed final decisions (per your instruction)

`match_existing` | `create_new` | `keep_both` | `merge_confirmed_duplicate` | `reject_source_error`

Keep `reject_source_error` only when the MIMU record itself is proven invalid or duplicated.
