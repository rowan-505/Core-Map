# 07 postal coverage addendum

Generated: 2026-09-21T14:38:56.900242+00:00
Source: frozen `04-postal-actions.frozen.csv` (Phase 4 inventory; Phase 6 did not re-reconcile).

## Mutually exclusive totals (must equal 17,297)

| Category | Count |
|---|---:|
| `linked_exact_local_area` | 1851 |
| `linked_after_review` | 13 |
| `non_admin_postal_locality` | 0 |
| `missing_local_admin_identity` | 14784 |
| `ambiguous_local_area` | 3 |
| `missing_township` | 646 |
| `rejected_source_error` | 0 |
| **TOTAL** | **17297** |

- Township link present: **16651**
- Township null: **646**
- `local_admin_area_id` null: **15446**
- Codes without exact local link: **15446** (each has category+reason in CSV)

## Goal: complete exact local-area postal linking

**Result: FAIL**

Exact links = 1851 / 17297 (10.70%).

### Dominant root causes (not vague ‘accepted exceptions’)

1. `missing_local_admin_identity` via `exact_pending_create`: **13522** — name matched approved create, but no CoreMap id at Phase-4 freeze; no post-create re-link.
2. `missing_local_admin_identity` via `missing_local`: **1262** — township OK, no exact ward/VT name under township.
3. `missing_township`: **646** — postal township text unresolved.
4. `linked_after_review`: **13**; `ambiguous_local_area`: **3**.

## Counts by state/region

| Region | exact | after_review | missing_local_id | missing_township | ambiguous | other | total |
|---|---:|---:|---:|---:|---:|---:|---:|
| Ayeyarwady Region | 165 | 1 | 2004 | 58 | 2 | 0 | 2230 |
| Bago Region (East) | 79 | 0 | 813 | 51 | 0 | 0 | 943 |
| Bago Region (West) | 34 | 0 | 758 | 31 | 0 | 0 | 823 |
| Chin State | 19 | 0 | 491 | 33 | 0 | 0 | 543 |
| Kachin State | 56 | 1 | 672 | 55 | 0 | 0 | 784 |
| Kayah state | 13 | 0 | 102 | 9 | 0 | 0 | 124 |
| Kayin State | 16 | 0 | 403 | 44 | 0 | 0 | 463 |
| Magway Region | 82 | 5 | 1622 | 37 | 0 | 0 | 1746 |
| Mandalay Region | 155 | 0 | 1529 | 19 | 0 | 0 | 1703 |
| Mon State | 80 | 1 | 392 | 21 | 0 | 0 | 494 |
| Naypyitaw Union Territory | 27 | 1 | 219 | 0 | 1 | 0 | 248 |
| Rakhine State | 76 | 2 | 1113 | 54 | 0 | 0 | 1245 |
| Sagaing Region | 95 | 0 | 1889 | 54 | 0 | 0 | 2038 |
| Shan State (East) | 30 | 0 | 236 | 23 | 0 | 0 | 289 |
| Shan State (North) | 75 | 0 | 1106 | 39 | 0 | 0 | 1220 |
| Shan State (South) | 128 | 0 | 467 | 79 | 0 | 0 | 674 |
| Tanintharyi Region | 57 | 0 | 278 | 23 | 0 | 0 | 358 |
| Yangon Region | 664 | 2 | 690 | 16 | 0 | 0 | 1372 |
