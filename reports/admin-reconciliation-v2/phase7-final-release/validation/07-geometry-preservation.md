# 07 geometry preservation

Generated: 2026-09-21T14:39:00.835494+00:00
Method: deterministic `md5(ST_AsEWKB(...))` pre (production / Phase-6 pre snapshot) vs disposable post-import.

## Gates

| Gate | Value | Required |
|---|---:|---|
| changed matched admin geometry | 0 | 0 |
| changed matched settlement point | 0 | 0 |
| changed matched public_id | 0 | 0 |
| existing rows incorrectly tagged mimu_placeholder | 0 | 0 |
| matched admin rows checked | 1864 | >0 |
| matched settlement rows checked | 50563 | >0 |

**Overall geometry preservation: PASS**

Evidence CSV: `07-geometry-preservation.csv`
