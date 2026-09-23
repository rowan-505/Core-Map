# Phase 7 — production runbook (STOP before apply)

**Do not run apply steps until the dry-run report is explicitly approved in writing.**

Target production project: Supabase `locghyuranqaqsnbxflc`  
Disposable evidence DB: `coremap_phase6` @ `127.0.0.1:5433`  
Runner: `tools/admin-reconciliation/phase6/apply_region.py`  
Postal DDL: `infrastructure/database/migrations/supabase/20260921180000_phase5_ref_postal_codes.sql`

## Pre-flight checklist (completed in this package)

| Gate | Status | Evidence |
|---|---|---|
| Database backup | DONE (read-only dump) | `backup/07-prod-prephase7-affected.dump` |
| Export affected rows | DONE (from disposable post-Phase6) | `exports/` |
| Frozen manifest checksums | DONE (match Phase5 freeze) | `checksums/07-frozen-manifest.checksums.json` |
| MIMU licence/public-use decision | CONDITIONAL APPROVE | `07-licence-decision.md` |
| Rollback SQL tested | DONE (BEGIN…ROLLBACK on disposable) | `rollback/07-rollback-test.log` |
| Manual-review count | **0** | `validation/07-dry-run-stats.json` |
| Explicitly accepted exceptions | listed | `final-report.md` § Exceptions |

## Production order (after approval only)

```bash
# 0) Confirm approval + re-check backup SHA
# 1) Postal schema migration
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f infrastructure/database/migrations/supabase/20260921180000_phase5_ref_postal_codes.sql

# 2–4) Region-scoped apply (admin + village + postal in one runner)
# Host guard blocks production unless you pass --allow-disposable-host
# ONLY after written approval, and only against production URL with explicit flag intent:
uv run --with 'psycopg[binary]' python tools/admin-reconciliation/phase6/apply_region.py \
  --database-url "$DATABASE_URL" \
  --mode apply \
  --allow-disposable-host

# 5) Validation
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f reports/admin-reconciliation-v2/phase5/05-validation.sql
# plus Phase6 validation block in tools/.../apply_region.py (already prints JSON)

# 6) Search rebuild (once)
# Exact function name follows existing API/search ops; example:
# SELECT search.rebuild_search_documents(ARRAY['admin_areas','settlements']);

# 7) Admin + settlement tiles rebuild/invalidate (once)
# npm run tiles:export:overview-admin   # or current tile pipeline command
# then CDN invalidate for affected packages only

# 8) Smoke-test API, dashboard search, public map

# 9) Supabase advisors (security + performance) via MCP/dashboard
```

## Hard stops

- Do **not** apply if backup SHA missing.
- Do **not** invent township parents for the ~88 skipped village tracts.
- Do **not** auto-link ambiguous postal locals.
- Do **not** publish MIMU placeholders as official boundaries.
