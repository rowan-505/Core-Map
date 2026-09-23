# Phase 7 production approval addendum

**Generated:** 2026-09-21T15:00:00Z (approx)  
**Production apply:** NOT executed  
**Disposable evidence:** `coremap_phase6`, `coremap_phase7_rbtest`, `coremap_phase7_backup_restore`  
**Git commit this addendum authorizes against (workspace HEAD):** `8862bf16fbacd6a4c084b20e1fd1022e4850243e`  
**Frozen local-admin manifest SHA-256:** `6a0f8fc2841f5a446b5066296837c0b108a907fe67a52aa4b93512cfd5a369a8`  
**Frozen villages SHA-256:** `adf6498a2b7e3f776d806ad5ace36723ecd56ca9fc609acab65a8452b548f9e2`  
**Frozen postal actions SHA-256:** `5f40c130e7eacdb5a9ab1418b74030447cf5285d73f233ee8b80ad8a1bc8224d`  

Checksum file: `checksums/07-frozen-manifest.checksums.json`

---

## A. Production database import readiness

**Decision: PASS**

| Gate | Result | Evidence |
|---|---|---|
| Row-count arithmetic reconciles | PASS | `validation/07-row-count-reconciliation.md` |
| Matched geometry preservation | PASS (0/0/0/0) | `validation/07-geometry-preservation.md` |
| Placeholder provenance | PASS (0 unexpected) | `validation/07-placeholder-provenance.md` |
| Real rollback mismatch count | **0** PASS | `validation/07-rollback-restore-result.json` |
| Backup readable + complete | PASS (2516/57590/17297) | `validation/07-backup-restore-result.json` |
| Backup strict zero `pg_restore` error lines | FAIL (1 GUC `transaction_timeout` on local PG16) | same; **non-blocking for data** |
| Manual-review unresolved imports | 0 | frozen manifests |
| Complete exact postal linking goal | **FAIL** (see §1) | `validation/07-postal-coverage-addendum.md` |

Database import of the **frozen Phase 6/7 plan** is technically ready on disposable evidence.  
It does **not** achieve the product goal of 17,297 exact local postal links.

---

## B. Public search / API exposure readiness

**Decision: FAIL**

Evidence: `validation/07-licence-exposure-gate.md`

- `search.v_search_admin_areas_source` does not exclude `geometry_source='mimu_placeholder'` (`116_search_source_views.sql`).
- Planned search rebuild would index active placeholders as public search documents (`is_public=true` in view).
- Dashboard/API geography already surfaces placeholder counts and `geometry_source`.
- Licence gate: **PASS_DATABASE_ONLY** — not full public API/search publication.

---

## C. Public tile / map publication readiness

**Decision: FAIL**

Evidence: `validation/07-licence-exposure-gate.md`, `07-licence-decision.md`

- MIMU geometry not approved for official PMTiles/CDN/public-map publication.
- Placeholders are `is_official_boundary=false` but runbook still plans tile rebuild/invalidate without a proven official-only filter in this package.
- Licence gate: **PASS_DATABASE_ONLY** (not `PASS_FULL_PUBLICATION`).

---

## 1) Postal coverage (17,297 exclusive)

| Category | Count |
|---|---:|
| linked_exact_local_area | 1851 |
| linked_after_review | 13 |
| non_admin_postal_locality | 0 |
| missing_local_admin_identity | 14784 |
| ambiguous_local_area | 3 |
| missing_township | 646 |
| rejected_source_error | 0 |
| **TOTAL** | **17297** |

- Township link present: **16651** · township null: **646**
- `local_admin_area_id` null: **15446**
- Each of 15446 non-exact codes has category+reason in `validation/07-postal-coverage-addendum.csv`
- By region/township: `07-postal-coverage-by-region.csv`, `07-postal-coverage-by-township.csv`

**Complete exact local-area postal linking: FAIL** (1851/17297 = 10.70%).

Dominant evidence-based causes (not vague exceptions):
1. **13522** `exact_pending_create` → `missing_local_admin_identity` (name matched approved create; no CoreMap id at Phase-4 freeze; no post-create re-link).
2. **1262** true no-exact-name under township.
3. **646** missing township resolution.

---

## 2) Row-count reconciliation (summary)

Admin: `2516 + 14192 - 4 = 16704` PASS  
Settlements: `57590 + 3592 - 1727 = 59455` PASS  
Net settlement +1865 = created 3592 − disabled merges 1727  
Placeholders: admin **14192**, village **3592**  

Full write-up: `validation/07-row-count-reconciliation.md`

---

## 3–5) Geometry / provenance / rollback

All PASS on disposable as tabulated in §A.

---

## 6) Licence gate

**PASS_DATABASE_ONLY**

---

## Approval implication

| Ask | Addendum answer |
|---|---|
| Approve production **DB import only** (no search rebuild, no public tiles, no public map publish of placeholders) | Supported by §A PASS + licence PASS_DATABASE_ONLY |
| Approve production **with** runbook steps 6–8 as written | **Not supported** — §B FAIL, §C FAIL |
| Approve claiming complete postal exact linking | **Not supported** — postal FAIL |

**Do not run `07-production-runbook.md` until you explicitly approve a scoped decision that matches the above.**
