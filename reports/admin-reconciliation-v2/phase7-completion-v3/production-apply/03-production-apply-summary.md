# Phase 7 v3 — production database import result

Generated: `2026-09-21T18:08:40Z`  
Scope: **database import only** (`PASS_DATABASE_ONLY`)  
Search rebuild: **not run**  
Tiles/CDN: **not run**

## Preflight
- Backup SHA verified: `73e505abd3efe529ad0ac25093f2663a98298b7038dec475efb387e8c4cd8b0a`
- Frozen v3 checksums verified
- Host: `aws-1-ap-northeast-1.pooler.supabase.com`

## Snapshot
| Metric | Pre | Post |
|---|---:|---:|
| Admin active | 2520 | 16790 |
| Admin mimu_placeholder | 6 | 14280 |
| Settlements active | 57590 | 59435 |
| Pangsang township | 1 | 1 |
| Pangsang VT children | - | 87 |
| Postal rows | - | 17297 |

## Geometry preservation
- keep_existing geom changed: **0** (PASS)

## Postal status breakdown
- `linked_exact_local_area`: 15452
- `confirmed_non_admin`: 1822
- `linked_after_review`: 17
- `rejected_source_error`: 6

## Notes
- Empty-PCode Pangsang VT remained rejected (not created).
- Placeholders are `is_public_usable=false`, `geometry_source=mimu_placeholder`, `verification_status=needs_fix`.
