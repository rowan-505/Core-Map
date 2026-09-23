# Phase 7 final-report.md

**Status:** DRY-RUN COMPLETE — **awaiting explicit production approval**  
**Date:** 2026-09-21 (UTC+9 / UTC)  
**Disposable evidence:** `coremap_phase6` on Docker `coremap-admin-cleanup-pg:5433`  
**Production:** backup only — **no apply**

This report is the Phase 7 release gate package. Numbers below are from the disposable Phase 6 apply (same scripts/order as production) plus frozen manifests. Production must not be changed until this dry-run is approved in writing.

---

## 1. Final counts (disposable post-apply)

| Entity | Final active count | Notes |
|---|---:|---|
| **Ward** | **2,064** | type=`ward`, active, not deleted |
| **Village tract** | **14,084** | type=`village_tract`, active, not deleted |
| **Village (settlements)** | **59,455** | `core_settlements` where `deleted_at IS NULL` (includes non-village settlement types if present) |
| Admin MIMU placeholders | 14,192 | `geometry_source='mimu_placeholder'` |
| Village point placeholders | 3,592 | `source_refs.geometry_status='mimu_placeholder'` |

Evidence: `validation/07-validation-disposable.txt`

---

## 2. Exact MIMU coverage by entity (frozen manifests)

| Entity | Source rows | keep / update (existing match path) | create_mimu_placeholder | reject | merge candidate |
|---|---:|---:|---:|---:|---:|
| Ward | 2,001 | 1,886 | 114 | 8 | (via merge decisions) |
| Village tract | 14,175 | 7 | 14,168 planned | 0 | — |
| Village | 54,602 | 48,555 keep/update-type/names | 3,565 | 9 | 1,473 |

Phase 6 disposable outcomes (executed):

| Entity | matched | updated | merged losers | created_placeholder | rejected | unaccounted |
|---|---:|---:|---:|---:|---:|---:|
| Ward | 1,879 | 398 | 3 | 114 | 8 | 0 |
| Village tract | 7 | 7 | 0 | 14,078 | 0 | 90 |
| Village | 51,028 | 2,235 | 2,124 | 3,565 | 9 | 2 |
| Postal | — | — | — | 17,297 upserted | 2 malformed | ~15,430 missing_local |

Region breakdown CSV: `validation/07-coverage-by-region.csv`

---

## 3. Existing matches

- Wards kept/updated against existing CoreMap IDs: **~1,886** manifest rows (geometry preserved).
- Village tracts with existing CoreMatch keep/update: **7** (almost all VTs were creates).
- Villages keep/update: **~48,555** (+ merge survivors counted under merge).
- Matched geometry hash guard (Phase 6): **0** admin geom changes, **0** settlement point changes.

---

## 4. Name / type / parent updates

From Phase 6 totals:

- Ward updates: **398**
- Village-tract updates: **7**
- Village name/type/parent updates: **2,235**

Optional `name_reference=mimu` recorded when names changed (admin via `source_refs`; villages via merged `source_refs`). Existing geometry **not** retagged as MIMU.

---

## 5. Merged duplicates

- Confirmed merge decisions: **1,476** (`merge_confirmed_duplicate`)
- Phase 6 soft-retired losers: ward **3**, village **2,124** (loser rows; survivors preserved)
- Dependencies repointed where FK targets exist on disposable; losers soft-disabled (never hard-deleted)

---

## 6. New MIMU placeholders

| Kind | Count (disposable) | Tags |
|---|---:|---|
| Admin polygon placeholders | **14,192** | `geometry_source=mimu_placeholder`, `reference_source=mimu`, `source_license_status=permission_pending`, `verification_status=needs_fix`, `is_verified=false`, `boundary_status=approximate`, `is_official_boundary=false` |
| Village point placeholders | **3,592** | `source_type=partner`, `source_refs` includes `source=mimu`, `source_version=9.7`, `geometry_status=mimu_placeholder`, `needs_geometry_replacement=true` |

Note: DB enum uses **`needs_fix`** (not the string `needs_review`). Product meaning is the same.

---

## 7. Extra CoreMap rows

Preserved; not deleted by Phase 6/7:

| Extra set | Rows |
|---|---:|
| Local-admin extra CoreMap (`02-local-admin-extra-core.csv`) | **55** |
| Village extra CoreMap (`02-village-extra-core.csv`) | **6887** |

See `validation/07-dry-run-stats.json` → `exceptions.extra_coremap_*`.

---

## 8. Postal codes (all 17,297)

| Metric | Value |
|---|---:|
| Valid codes stored | **17,297** |
| Distinct codes | **17,297** |
| Malformed rejected (not stored) | **2** |
| `linked_exact_local_area` | **1,851** |
| `linked_after_review` | **13** |
| `ambiguous_local_area` | **3** |
| `missing_local_area` | **15,430** |
| Local link township mismatch | **0** |

Export: `exports/07-export-postal-codes.csv`

**Exact local postal links are partial (~10.7%).** All valid codes are present and usable; most are township-only / unmatched-local by design until more local admin is safely linked.

---

## 9. Exceptions and reasons (explicitly accepted)

| ID | Count | Reason | Gate decision |
|---|---:|---|---|
| EX-VT-PARENT-90 | ~88–90 | VT create skipped: unresolved `approved_township_id` | **Accepted** — follow-up; do not invent parents |
| EX-POSTAL-MISSING-LOCAL | 15,430 | No safe exact local match | **Accepted** — expected |
| EX-POSTAL-AMBIGUOUS | 3 | Ambiguous locals | **Accepted** — no auto-link |
| EX-POSTAL-MALFORMED | 2 | Invalid codes | **Accepted** — DDL reject |
| EX-REJECT-SOURCE | 17 | `reject_source_error` | **Accepted** |
| EX-EXTRA-COREMAP | per Phase2 extra files | Core-only rows preserved | **Accepted** |
| EX-BASELINE-HIERARCHY | 80 parent + 37 type | Pre-existing non-placeholder WVT anomalies | **Accepted** — separate cleanup |

**Manual-review unresolved queue rows imported: 0**

---

## 10. Geometry and hierarchy validation

| Check | Result |
|---|---|
| Matched admin geom hashes unchanged | PASS (0 changed) |
| Matched settlement point hashes unchanged | PASS (0 changed) |
| New admin polygons valid + non-null | PASS (0 invalid) |
| New village points valid + non-null | PASS (0 invalid) |
| Placeholder parents are township | PASS (0 bad) |
| Placeholder types ward/village_tract | PASS (0 bad) |
| Placeholder licence/meta tags | PASS (`needs_fix` + permission_pending + approximate) |
| Postal 7-digit + unique | PASS |
| Postal local⊆township | PASS |

---

## 11. Licence / public-use

See `07-licence-decision.md`.

- Names/hierarchy: OK with MIMU acknowledgement.
- Placeholder geometry: OK in DB as approximate / permission_pending.
- **Not approved** as official public boundary tiles/downloads without written MIMU permission.

---

## 12. Rollback instructions

1. **Preferred:** restore from `backup/07-prod-prephase7-affected.dump` (taken before production apply).
2. **Soft data rollback:** `rollback/07-rollback.sql` (soft-retire placeholders; postal restore from backup).  
   Tested on disposable with BEGIN…ROLLBACK — see `rollback/07-rollback-test.log` (14,192 admin + 3,592 village placeholders would retire; state restored after ROLLBACK).
3. **DDL:** `infrastructure/database/migrations/supabase/20260921180000_phase5_ref_postal_codes.rollback.sql` (non-destructive rename path; DROP only on fresh envs).

---

## 13. Production order (after approval)

1. Apply postal schema migration.  
2. Apply admin-area updates + placeholder creates by state/region.  
3. Apply village updates + placeholder creates by state/region.  
4. Import postal codes + exact local-area links.  
5. Run all validation queries.  
6. Rebuild affected search documents once.  
7. Rebuild/invalidate affected admin + settlement tiles once (approximate styling only).  
8. Smoke-test API, dashboard search, public map.  
9. Run Supabase security + performance advisors.

Details: `07-production-runbook.md`

---

## 14. Package index

```text
phase7-final-release/
  dry-run-report.md          ← approve this first
  final-report.md            ← this file
  07-licence-decision.md
  07-production-runbook.md
  backup/
  exports/
  checksums/
  rollback/
  validation/
  smoke/
```

---

## 15. Approval block

- [ ] Dry-run report reviewed  
- [ ] Exceptions accepted as listed  
- [ ] Licence conditional rules accepted  
- [ ] Backup SHA verified  
- [ ] **Explicit written approval to apply production**

Until the last box is checked by you, agents must **not** apply Phase 7 to production.
