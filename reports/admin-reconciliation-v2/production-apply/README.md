# Production apply log — admin + postal reconciliation

**Applied at:** 2026-09-21 (UTC+9 afternoon)  
**Project:** Supabase `locghyuranqaqsnbxflc`  
**Backup:** Skipped by explicit user request (no complex snapshot).

## Applied

1. Phase 1 cleanup SQL → official first-level **15**, created 3 cleanup parents.
2. Phase 2 bulk set-based SQL from approved plan (`03-phase2-bulk.sql`)  
   - Row-by-row Python apply was aborted (slow ~600 ms RTT).  
   - Bulk SQL preserves geometry (guard passed).  
   - Includes four human-approved name links.  
   - Does **not** merge Mong Maw or Monghpyak.
3. Postal import → **17,297** rows (2 malformed rejected, not stored).
4. Search rebuild: `search.rebuild_search_documents(ARRAY['admin_areas'])` → 2,514 admin documents.

## Intentionally not done

- Did **not** invent polygons for ~14,935 MIMU ward/village-tract rows without valid geometry.
- Did **not** auto-import remaining WVT manual reviews (358).
- Did **not** create Mong Maw / Monghpyak districts.
- Overview admin PMTiles export / CDN invalidate — still needed once (`npm run tiles:export:overview-admin` against tile pipeline).
- Complex PITR/snapshot backup — skipped per request.

## Production validation snapshot

| Check | Value |
|---|---|
| official state_region | 15 |
| postal rows | 17297 |
| invalid geom | 0 |
| orphan parents | 0 |
| mimu_placeholder | 0 |
| settlements | 57590 |
| foreign disabled | 5 |

Postal linkage: township-only 12298, local 1638, unmatched 3361.

## Advisors

Security/performance advisors were run. Many `rls_enabled_no_policy` INFO findings on private API-only schemas (including `ref.ref_postal_codes`). Treat as a **separate** hardening task. Do **not** blindly add public RLS policies.

## Artifacts

- `01-phase1.log`
- `03-phase2-bulk.sql` / `03-phase2-bulk.log`
- `05-postal-console.txt` / `postal/`
- `06-search-rebuild.log`
- `07-validation.txt`
