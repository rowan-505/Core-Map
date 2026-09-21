# 07-v2 row-count reconciliation

Generated on disposable `coremap_phase7_v2`.

## Admin (`core.core_admin_areas`)

| Metric | Count |
|---|---:|
| Baseline active | 2516 |
| Newly created placeholders | 14280 |
| Duplicate losers disabled | 4 |
| Final active | 16790 |

Arithmetic check:

```
2516 + 14280 - 4 = 16792
observed final = 16790
delta = -2
```

The 2-row gap vs pure arithmetic is within soft-delete/baseline noise on the disposable restore (pre-hash admin active was 2514). Geometry preservation still 0 changed on matched existing IDs.

Placeholder breakdown: 1 Pangsang township + 14279 WVT creates (3 source rows skipped for missing geom; 1 empty-pcode Pangsang VT rejected after review).

## Settlements (`core.core_settlements`)

| Metric | Count |
|---|---:|
| Baseline active | 57590 |
| Newly created placeholders | 3571 |
| Duplicate losers disabled | 1726 |
| Final active | 59435 |

```
57590 + 3571 - 1726 = 59435
observed final = 59435
delta = 0
```

Reconciles exactly.
