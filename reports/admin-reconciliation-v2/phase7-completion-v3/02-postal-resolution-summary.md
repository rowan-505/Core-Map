# 02 Postal resolution preparation (v3)

Generated: `2026-09-21T16:42:21Z`  
Scope: disposable/local preparation only  
Production: **not touched**  
CoreMap geometry: **not changed**  
Production apply: **not generated**

Disposable inventory DB: `coremap_phase7_v2` @ `127.0.0.1:5433`

## A. Linked-after-review validation (19)

| Result | Count |
|---|---:|
| Input `linked_after_review` | 19 |
| Valid (keep as linked_after_review) | 5 |
| Invalid (re-entered resolution) | 14 |

Validation requires non-null `local_admin_area_id` **or** target `public_id`, matching township, ward/village_tract type, and documented evidence. Shared `public_id` across distinct locality norms fails validation.

Details: `02-postal-review-previews/linked_after_review_validation.json`

## B. Non-admin audit (646 → 642 unique groups)

All 646 input rows use match_method `non_admin_unresolved_township_name` and a town-labeled parent.

| audit_decision | Groups |
|---|---:|
| `confirmed_non_admin` | 637 |
| `reclassify_as_official_local_area` | 5 |

File: `02-postal-non-admin-audit.csv`

## C. Missing / ambiguous / invalid-LAR grouping

| Metric | Count |
|---|---:|
| Input missing rows | 1177 |
| Input ambiguous rows | 3 |
| Invalid LAR rows re-queued | 14 |
| Work rows total | 1194 |
| Unique locality groups | 1193 |

Group key = `township_public_id + locality_type + normalized_name_mm + normalized_name_en`.

## D. Matching results (strict)

Automatic match only for unique exact Myanmar primary/alias (no conflict) or unique exact bilingual identity. English-only / fuzzy / multi-candidate blocked.

| action | Groups |
|---|---:|
| `confirmed_non_admin` | 1180 |
| `link_existing` | 12 |
| `source_error` | 6 |

Auto link_existing groups from missing/ambiguous/invalid-LAR rematch: **7**  
Non-admin audit reclassify appended as link_existing: **5** (total link_existing actions **12**)  
Auto add_alias_and_link groups: **0**

Note: for unresolved missing groups, `confirmed_non_admin` means **no linkable CoreMap ward/village_tract identity** under the township after exact inventory checks (not necessarily a town/market locality). Geometry is unchanged; no admin rows are invented from postal text.

## E. Review queue

| review_decision | Groups |
|---|---:|
| `confirmed_non_admin` | 1180 |
| `link_existing` | 7 |
| `source_error` | 6 |

Defer/blank decisions remaining: **0**

Files:
- `02-postal-group-actions.csv`
- `02-postal-group-review.csv`
- `02-postal-review-previews/*.json`

## Gates

| Gate | Result |
|---|---|
| Production unmodified | PASS |
| Geometry unchanged | PASS |
| No production apply artifact | PASS |
| No defer/blank review_decision | PASS |
