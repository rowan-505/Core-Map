# Phase 4 — Postal ↔ approved local-admin (read-only)

**Generated:** 2026-09-21T13:21:08Z
**Postal ZIP:** `/Users/nyihtet/Downloads/Complete Data.zip`
**SHA256 zip:** `782daf6918f7355d9445ab417a9b20015bb49d6fb732a760571adc55635496ca`
**SHA256 EN:** `a77b85f6bf3be7b4ed6fe54bcc4a962b9454cd7f9e49f677c9884b2f5842a5ae`
**SHA256 MY:** `2964b0097e3f586f8f3b7c1a5318b4ce17e242f656cf6fde1d3fd3bd6d8c9b54`
**Database writes:** none

## Source checks (independent)

| Check | Value | Expected | Pass |
|---|---:|---:|---|
| Valid unique seven-digit codes | 17297 | 17297 | yes |
| Duplicate extra source rows (EN) | 33 | 33 | yes |
| Duplicate extra source rows (MY) | 33 | 33 | yes |
| Codes with duplicate rows | 33 | 33 | yes |
| Malformed codes | ['114560'] | ['114560'] | yes |

## Phase 3 inventory used

- Core identities (linkable ids): **2456**
- Pending creates (name-only, no id): **14282**
- Merge losers excluded: **1729**
- Undecided Phase-3 locals skipped: **0**

## Matching rules

1. Resolve approved CoreMap township from postal region + township names.
2. Normalize Myanmar + English ward/village-tract locality names.
3. Match **only inside that township** against Phase-3 approved inventory.
4. Require **one exact** approved local-admin identity to auto-link.
5. Fuzzy candidates → review only (`linked_after_review`); never auto-link.
6. Never create an admin area from postal text alone.
7. Never link by geographic proximity.

## Status counts (valid codes)

- `ambiguous_local_area`: **3**
- `linked_after_review`: **13**
- `linked_exact_local_area`: **1851**
- `missing_local_area`: **15430**

- Malformed rejected (unique codes, not in 17297): **1** → ['114560']
- Valid actions rows: **17297** (expect 17297)
- Exact linked: **1851**
- Unresolved / review / non-admin: **15446**

## Unresolved reasons (match_method)

- `exact_pending_create`: **13522**
- `missing_local`: **1262**
- `township_unresolved`: **646**
- `fuzzy_review_only`: **13**
- `ambiguous_exact_local`: **3**

## Outputs

- `reports/admin-reconciliation-v2/04-postal-actions.csv`
- `reports/admin-reconciliation-v2/04-postal-review.csv` (15446 rows)
- `reports/admin-reconciliation-v2/04-postal-unmatched.csv` (15433 rows)

## Target gap

- Final production target still requires human review for **13** fuzzy + **3** ambiguous + **15430** missing (including exact matches to pending Phase-3 creates without ids).
- No code was linked from proximity. No admin area was invented from postal text.

