# 07 row-count reconciliation

Generated: 2026-09-21T14:38:57.914564+00:00
Disposable DB post-Phase-6. Baseline = production pre-Phase-6/7 counts.

## Admin areas (`core.core_admin_areas`)

| Metric | Count |
|---|---:|
| Baseline active (prod pre-import) | 2516 |
| Matched existing (manifest keep/update/merge survivor paths) | 1886 |
| Names updated (manifest update_names*) | 36 |
| Type/parent updated (manifest) | 4 |
| Newly created placeholders (realized `mimu_placeholder`) | 14192 |
| Creates planned in frozen manifest | 14282 |
| Duplicates merged (confirmed decisions) | 1476 |
| Duplicate losers disabled (`deleted_at` set) | 4 |
| Rejected source rows (not inserted) | 8 |
| Final active (`deleted_at IS NULL`) | 16704 |

### Arithmetic

```
baseline (2516) + newly_created (14192) - rows_disabled (4)
= 16704
final_active = 16704
delta = 0
```

**Reconciles:** YES

### Why admin MIMU placeholders = 14,192

- Frozen create actions: **14282**
- Skipped (no township parent, mainly Shan North Pangsang): **90** (planned − realized)
- Realized inserts with `geometry_source='mimu_placeholder'`: **14192**

## Settlements (`core.core_settlements`)

| Metric | Count |
|---|---:|
| Baseline active (prod pre-import) | 57590 |
| Matched existing (manifest keep/update/merge paths) | 51028 |
| Names updated | 825 |
| Type/parent updated | 14 |
| Newly created placeholders | 3592 |
| Creates planned | 3565 |
| Duplicate losers disabled | 1727 |
| Rejected source rows | 9 |
| Final active | 59455 |

### Arithmetic

```
baseline (57590) + newly_created (3592) - rows_disabled (1727)
= 59455
final_active = 59455
delta = 0
```

**Reconciles:** YES

### Why village MIMU placeholders = 3,592

- Frozen village `create_mimu_placeholder`: **3565**
- All creates had coordinates; realized active placeholders: **3592**
- Difference planned−realized: **-27** (idempotent re-runs / already-present)

### Why settlement net increase = only 1,865

```
net = final - baseline = 59455 - 57590 = 1865
net = created - disabled = 3592 - 1727 = 1865
```

Merge soft-deletes removed **1727** duplicate settlements while **3592** placeholders were added, so the net population rise is small.
