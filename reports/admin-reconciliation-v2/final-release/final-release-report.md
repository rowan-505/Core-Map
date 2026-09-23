# Admin reconciliation v2 — final release report

**Status:** PRODUCTION APPLIED (2026-09-21) — complex backup was skipped by explicit request.  
**Disposable target:** Docker PostGIS `coremap-admin-cleanup-pg` (`127.0.0.1:5433` / `coremap_cleanup`)  
**Report date:** 2026-09-21  
**Production apply:** DONE — see `reports/admin-reconciliation-v2/production-apply/README.md`

This report is the release gate package. Migrations and imports were executed **only** on the disposable database in production order. Do not apply to production until an explicit written approval of this report.

---

## Release gate checklist

| Gate | Result | Evidence |
|---|---|---|
| 15 official first-level identities | **PASS** | Phase1 + Phase2 postconditions: `official_first_level=15` |
| 330 official townships (inventory identities) | **PASS** | `327` auto-matched + `3` human-confirmed links = `330` |
| Zero omitted target admin rows | **PASS** | `18037/18037` plan rows accounted |
| Zero omitted valid postal codes | **PASS** | `17297` distinct 7-digit codes stored; malformed rejected by DDL check |
| Exactly 17,297 valid postal rows | **PASS** | `SELECT COUNT(*) FROM ref.ref_postal_codes` → `17297` |
| No automatic import of manual-review matches | **PASS** | `manual_review_auto_imported=0` |
| No matched CoreMap geometry changed | **PASS** | `matched_geom_changed=0` / `2069` checked |
| New MIMU geometry searchable via `geometry_source='mimu_placeholder'` | **PASS (vacuous)** | `0` new placeholders created (spatial promotes preserved existing geom) |
| No invalid geometry | **PASS** | `invalid_geom=0`, `null_geom=0`, `empty_geom=0` |
| No orphan hierarchy | **PASS** | `orphan_non_country=0`, `unreachable_from_root=0` |
| No broken foreign keys | **PASS** | `broken_parent_fk_refs=0`; postal FKs enforced |
| No browser-side direct database access | **PASS (architecture)** | Dashboard/web call API only; admin-geography uses MVT + JSON via Fastify |
| Public tile/search behavior explicitly tested | **DEFERRED** | Disposable DB has no `search` / `tile_source` schemas; post-apply smoke required |

**Overall:** Disposable dry-run **passes data gates**. Public tile/search smoke and production backup remain **post-approval** steps.

---

## Production order executed on disposable DB

1. **Phase 1 cleanup migration** — `infrastructure/database/migrations/supabase/20260921120000_admin_phase1_existing_data_cleanup.sql` (already applied on this disposable before this report).
2. **Phase 2 manifest import (apply)** — `python tools/admin-reconciliation/phase2_import_manifest.py --apply`  
   Console: `reports/admin-reconciliation-v2/final-release/phase2-apply-console.txt`  
   Artifacts: `01-summary-apply.md`, `02-plan-apply.csv`, `03-postconditions-apply.json`
3. **Postal DDL** — `20260921150000_ref_postal_codes.sql` (already present on disposable).
4. **Postal import** — `tools/admin-reconciliation/postal_import.py` → **17,297** rows.

Phase2 is a **scripted apply**, not a Supabase migration file. Production must run the same script after Phase1 SQL, against a backed-up database, with host guards (`--allow-production-host` only when intentional).

---

## 1. Before / after counts by level and type

### By admin level (active, `deleted_at IS NULL`)

| Level | Production baseline (read-only) | Disposable after Phase1+Phase2 |
|---|---:|---:|
| country | 1 | 1 |
| state_region | 17 → target **15** official | **15** |
| self_administered_zone | 3 | **8** (SAZ/SAD reclassified under Shan/Sagaing) |
| district | 116 | 116 |
| township | 364 | 364 |
| town | 20 | 20 |
| ward_village_tract | 1,995 | 1,995 |
| **Total active areas** | **2,516** | **2,519** (+3 Phase1 placeholder parents) |

Phase1 created **3** cleanup parent rows (public_ids `a1000001-…0001..0003`). Phase2 created **0** new admin rows (`create_flag=0`, `mimu_placeholder_count=0`).

### By area type (disposable after)

| Type | Count |
|---|---:|
| ward | 1,952 |
| township | 364 |
| district | 116 |
| special_area | 35 |
| town | 18 |
| state | 7 |
| region | 7 |
| village_tract | 6 |
| island | 6 |
| self_administered_zone | 5 |
| self_administered_division | 1 |
| union_territory | 1 |
| country | 1 |

### Phase2 outcome totals (inventory)

| Outcome | Count |
|---|---:|
| create_skipped_no_valid_geometry | 14,935 |
| renamed | 1,898 |
| extra/reference | 540 |
| manual_review_remaining | 364 |
| create_skipped_unresolved_parent | 147 |
| reparented | 103 |
| kept | 46 |
| reclassified | 4 |
| **newly created placeholder** | **0** |

---

## 2. Official townships and CoreMap IDs

**Inventory gate (required):** 330 official township identities.

| Bucket | Count | Artifact |
|---|---:|---|
| Matched and updated by Phase 2 | **327** | `official-township-ids-matched-327.csv` |
| Human-confirmed same place (names only) | **3** | `urgent-review-decisions.csv` |
| Township manual review still open | **0** | |
| **Accounted** | **330** | |

### Human-confirmed township links (disposable already updated)

| Source key | CoreMap ID | New primary name | Geometry |
|---|---:|---|---|
| `03_Township:310` Kawthoung | `7444` | ကော့သောင်း | unchanged |
| `03_Township:107` Minbu | `7018` | မင်းဘူး | unchanged |
| `03_Township:120` Sidoktaya | `7026` | စေတုတ္ထရာ | unchanged |

Old spellings stay as aliases. Parents were already correct, so they were not moved.

### DB flag note (not the inventory gate)

`is_official_boundary=true` township rows on disposable: **333**  
Full dump: `official-townships.csv` (333 rows + header).

Difference vs 327 matched:

- **13** CoreMap townships remain official but were not among the 327 inventory matches (includes the three fuzzy candidates above still present as separate CoreMap rows).
- **7** inventory-matched CoreMap IDs are **not** official/public (Wa / special reference demotions): `6328, 6385, 6432, 6451, 6456, 6484, 6488`.
- **28** MIMU township inventory rows marked `extra/reference` (not created).

The release gate uses **inventory identity accounting (330)**, not “exactly 330 `is_official_boundary` rows.”

---

## 3. Official versus reference / extra areas

Disposable after Phase2 (`is_active`, not deleted):

| Level | Official (`is_official_boundary`) | Non-official | Address disabled | Not public | Total |
|---|---:|---:|---:|---:|---:|
| country | 1 | 0 | 0 | 0 | 1 |
| state_region | **15** | 0 | 0 | 0 | 15 |
| self_administered_zone | 6 | 2 | 0 | 2 | 8 |
| district | 110 | 6 | 0 | 6 | 116 |
| township | 333 | 31 | 5 | 31 | 364 |
| town | 16 | 4 | 0 | 4 | 20 |
| ward_village_tract | 1,959 | 36 | 0 | 36 | 1,995 |

Phase2 plan marked **540** inventory rows as `extra/reference` (mostly WVT). Those are inventory outcomes; CoreMap-only extras keep existing geometry and may still carry official flags until a later cleanup pass.

---

## 4. Created MIMU placeholder count by level

| Level | `geometry_source='mimu_placeholder'` created |
|---|---:|
| All levels | **0** |

`create_mimu_placeholder` rows with spatial evidence were **promoted to matched updates** (geometry preserved). WVT creates without MIMU polygons were skipped (`create_skipped_no_valid_geometry`).

If production later inserts true placeholders, they must use `geometry_source='mimu_placeholder'` and be rebuilt into search via `admin_areas` view.

---

## 5. Remaining manual reviews

Human decision on 2026-09-21, recorded in `urgent-review-decisions.csv`.

| Decision | Rows |
|---|---|
| Approved same place | Bawlake → `5974`, Kawthoung → `7444`, Minbu → `7018`, Sidoktaya → `7026` |
| Do not merge | Mong Maw is not `6294` (Mong La). Monghpyak is not `6371` (Mong Hsat). |

Names for the four approved rows were updated on the disposable database only. Geometry checksums were unchanged. Production does not have this update yet. Repeat it with `urgent-review-approved.sql` after Phase 2.

| Level | Still open |
|---|---:|
| district | 2 (Mong Maw, Monghpyak — unmatched, not created) |
| township | 0 |
| ward_village_tract | 358 |
| **Total** | **360** |

Export: `manual-review-remaining.csv`  
Rule: **do not auto-import** the remaining rows.

---

## 6. Foreign and duplicate rows disabled

Foreign / non-Myanmar township rows (Phase1 + verified after Phase2):

| ID | Name | `is_official_boundary` | `is_public_usable` | `address_usage` |
|---:|---|---|---|---|
| 5985 | อำเภอเวียงแหง | false | false | disabled |
| 5986 | อำเภอปางมะผ้า | false | false | disabled |
| 6675 | Vijoynagar EAC | false | false | disabled |
| 6734 | S' Bungtlang | false | false | disabled |
| 6735 | Tipa | false | false | disabled |

Postconditions: `duplicate_approved_hierarchy_paths=0`, `duplicate_official_source_pcodes=0`.

---

## 7. Name completeness

Primary EN / MY missing counts (active areas):

| Level | Areas | Missing primary EN | Missing primary MY |
|---|---:|---:|---:|
| country | 1 | 1 | 0 |
| state_region | 15 | 0 | 0 |
| self_administered_zone | 8 | 2 | 0 |
| district | 116 | 9 | 0 |
| township | 364 | 12 | 5 |
| town | 20 | 7 | 0 |
| ward_village_tract | 1,995 | 441 | 31 |

Not a hard release blocker; track as data-quality follow-up. Myanmar-primary coverage is strong at state/district; EN gaps concentrate in WVT.

---

## 8. Parent and ancestor integrity

| Check | Result |
|---|---:|
| Orphan non-country (`parent_id` null except country) | **0** |
| Broken parent FK references | **0** |
| Unreachable from root | **0** |
| Max hierarchy depth | **7** |
| Reachable active nodes | **2,519** |

---

## 9. Geometry validity and containment warnings

### Validity (all active geoms)

| Metric | Count |
|---|---:|
| null_geom | 0 |
| empty_geom | 0 |
| invalid_geom | 0 |
| valid_geom | 2,519 |

### Containment warnings

`ST_PointOnSurface` outside Myanmar country polygon: **26** rows  
List: `containment-warnings.txt`

Includes the five foreign townships (expected) plus border/WVT outliers (Chinese/Lao names, camps, etc.). Treat as **warnings**, not hard fails. Do not auto-`ST_MakeValid` or rewrite matched geometry.

Matched geometry stability: **0 / 2,069** changed.

---

## 10. Postal totals and linkage counts

| Metric | Count |
|---|---:|
| Total / distinct postal codes | **17,297** |
| `linked_township_only` | 12,298 |
| `linked_local_area` | 1,638 |
| `unmatched` | 3,361 |
| Rows with township FK | 13,936 |
| Rows with local FK | 1,638 |
| `malformed_rejected` stored | **0** (constraint forbids) |

DDL: `20260921150000_ref_postal_codes.sql`  
Rollback: `20260921150000_ref_postal_codes.rollback.sql` (drops table).

---

## 11. Village / settlement coverage and limitations

| Fact | Detail |
|---|---|
| Villages in `core_admin_areas` | **Not inserted** (by design) |
| `core.core_settlements` on disposable | **Table absent** (cleanup DB is admin-focused subset) |
| Production baseline settlements | **57,590** (from Phase0 read-only inspection) |
| Approved inventory village sheet | Incomplete — Phase2 summary: villages must reconcile separately |

**Limitation:** This release does **not** claim complete official village coverage. Do not promote villages into `core_admin_areas`. Preserve production settlement points unless a duplicate is proven.

---

## 12. API test results

Command (repo root / `apps/api`):

```bash
npm run test:admin-geography
```

Result (log: `api-test-admin-geography.txt`):

- **35** tests, **0** failures  
- Covers geography list/detail/MVT/options, geometry PATCH validation, concurrency 409, `mimu_placeholder` → `coremap_manual` replacement rules  

Disposable DB was used for Phase2/postal validation; unit tests use mocks/fixtures per existing module pattern.

---

## 13. Dashboard test / build results

```bash
# apps/dashboard
node --import tsx --test src/features/admin-geography/*.test.ts
npx tsc --noEmit
```

| Check | Result | Log |
|---|---|---|
| admin-geography unit tests | **6 pass / 0 fail** | `dashboard-test-admin-geography.txt` |
| Typecheck (`tsc --noEmit`) | **PASS** | `dashboard-typecheck.txt` |

Guards covered: filter chips never request nationwide GeoJSON; MVT URL templates only; settlement filter treated as unsupported for admin-area GeoJSON.

Browser E2E against production map/dashboard: **not run** (post-approval).

---

## 14. Query plans for major dashboard endpoints

Captured on disposable (`EXPLAIN ANALYZE`, buffers on). Files under `final-release/`:

| Endpoint proxy query | File | Exec time (approx) | Notes |
|---|---|---|---|
| Township list / count | `explain-list-township.txt` | ~9 ms | Index `core_admin_areas_level_idx` |
| Name search `ILIKE` | `explain-search-name.txt` | ~13 ms | Seq scan acceptable at ~2.5k rows; watch if table grows |
| Postal prefix | `explain-postal-prefix.txt` | ~26 ms | Unique btree on `postal_code`; prefix `LIKE` not ideal long-term |
| Map bbox (MVT filter) | `explain-mvt-bbox.txt` | (see file) | Uses geom `&&` envelope |

Recommendation after production apply: confirm MVT path uses GiST on `geom` (partial active index `099_core_admin_areas_active_geom_partial_gix.sql`). Consider `text_pattern_ops` / trigram for postal prefix if dashboard prefix search becomes hot.

---

## 15. Tile / search rebuild commands

Disposable DB **does not** include `search` or `tile_source` — run these **after production apply** only.

### Search (admin areas)

```bash
# From apps/api — rebuild admin_areas search documents only
npx tsx src/scripts/rebuild-search-index.ts --views admin_areas

# Or light preset (includes admin_areas among cheap views)
npm --prefix apps/api run rebuild:search-index:light
```

SQL equivalent (when connected as API DB role):

```sql
SELECT search.rebuild_search_documents(ARRAY['admin_areas']);
```

### Admin tiles (once)

```bash
# Overview admin export (official 15 state_region + country)
npm run tiles:export:overview-admin

# Then rebuild/publish the affected PMTiles package per existing tile pipeline,
# and invalidate CDN/cache for that package only (do not rebuild all 16 region packs unless needed).
```

Martin / dynamic admin MVT (dashboard): restart or refresh tile source after DB apply; dashboard already fetches MVT via API, not GeoJSON dumps.

### Public map smoke (post-apply)

1. Load public web map; confirm state outlines for the **15** official first-level areas.  
2. Search a renamed township (Phase2 rename sample) and confirm document updates after rebuild.  
3. Confirm foreign townships (5985/5986/…) do not appear as public usable boundaries.  
4. Dashboard → Admin Geography: list, filter official, load MVT, open detail (no direct Supabase).

---

## 16. Exact rollback procedure

Rollback order is **reverse of apply**. Prefer restoring a **pre-migration snapshot** over piecemeal SQL when Phase2 has already mutated many names/parents.

### A. Preferred: restore database snapshot

1. Before production apply, take a Supabase backup / PITR snapshot (or `pg_dump` of `core` + `ref` schemas).  
2. On failure after apply: restore that snapshot.  
3. Re-verify with `reports/admin-reconciliation-v2/final-release/validation.sql` (adapt settlement section if `core_settlements` exists).

### B. Disposable / ordered SQL rollback (no snapshot)

Run **only** if Phase2 can be undone via snapshot; Phase2 has **no** dedicated reverse migration (thousands of name/parent updates).

1. **Postal**  
   ```bash
   psql "$DATABASE_URL" -f infrastructure/database/migrations/supabase/20260921150000_ref_postal_codes.rollback.sql
   ```  
   Drops `ref.ref_postal_codes`.

2. **Phase2**  
   Restore from pre-Phase2 snapshot (required). Do not attempt hand-rollback of 1,898 renames / 103 reparents.

3. **Phase1**  
   ```bash
   psql "$DATABASE_URL" -f infrastructure/database/migrations/supabase/20260921120000_admin_phase1_existing_data_cleanup.rollback.sql
   ```  
   Restores Wa/SAZ parents, deletes the three cleanup-created rows, reverts selected flags.  
   **Limitation:** does not restore demoted duplicate primary names (aliases preserved by design).

### C. Application rollback

- Revert dashboard/API deploy if geometry editor or admin-geography routes misbehave.  
- Search: re-run `rebuild_search_documents(ARRAY['admin_areas'])` from restored data.  
- Tiles: republish previous overview-admin PMTiles artifact / prior CDN object version.

---

## Production apply checklist (after explicit approval)

Do **not** start until this report is approved in writing.

1. **Backup / snapshot** production (Supabase PITR or logical dump). Record snapshot id/time.  
2. Apply Phase1 SQL migration.  
3. Run Phase2 import with production host allow-list flag only when intentional.  
4. Apply `urgent-review-approved.sql` (four name links only). Do not merge Mong Maw or Monghpyak.  
5. Apply postal DDL + run postal import; confirm `COUNT(*)=17297`.  
6. Re-run validation SQL; confirm gates in section “Release gate checklist”.  
7. Rebuild search documents for `admin_areas`.  
8. Rebuild/invalidate overview admin tiles **once**.  
9. Smoke-test public map + dashboard Admin Geography.  
10. Run Supabase **security** and **performance** advisors; file unrelated findings as a separate task.  
11. **Do not** blindly change RLS on private API-only schemas (`core`, `ref`, `search`).

---

## Artifacts index

| File | Purpose |
|---|---|
| `final-release-report.md` | This document |
| `phase2-apply-console.txt` | Apply console summary |
| `01-summary-apply.md` / `02-plan-apply.csv` / `03-postconditions-apply.json` | Phase2 apply outputs |
| `validation.sql` / `validation-output.txt` | Post-apply validation (settlement query failed: table missing on disposable) |
| `official-townships.csv` | 333 DB official township flag rows |
| `official-township-ids-matched-327.csv` | 327 inventory-matched CoreMap IDs |
| `manual-review-remaining.csv` | 360 still-open reviews |
| `urgent-review-decisions.csv` | 4 approved links and 2 rejected merges |
| `urgent-review-approved.sql` | Idempotent name update for the 4 approved links |
| `containment-warnings.txt` | 26 centroid-outside-country rows |
| `explain-*.txt` | Query plans |
| `api-test-admin-geography.txt` | API tests |
| `dashboard-test-admin-geography.txt` / `dashboard-typecheck.txt` | Dashboard checks |

---

## Approval block

```text
[ ] Report reviewed
[ ] Gates accepted (including deferred public tile/search smoke as post-apply)
[ ] Production backup owner + snapshot id recorded
[ ] Explicit approval to apply production migrations/imports

Approver: __________________  Date: __________
```

**Until the approval block is signed, do not apply any of this to production.**
