# Phase 7 completion-v3 — production DB import runbook

**Approved scope:** production database import only (`PASS_DATABASE_ONLY`).  
**Not in scope:** search rebuild, public tiles, CDN invalidation, public map publish of placeholders.

## Preconditions (verified by runner)

- Written approval: `--i-approve-production-database-import-only`
- Backup SHA: `73e505abd3efe529ad0ac25093f2663a98298b7038dec475efb387e8c4cd8b0a`
- Frozen manifests: `phase7-completion-v3/03-*-v3.csv` + checksums

## Command

```bash
# Load DATABASE_URL from apps/api/.env (session mode preferred; runner rewrites pooler 6543→5432)
uv run --with 'psycopg[binary]' python tools/admin-reconciliation/phase7/apply_v3_production.py \
  --database-url "$DATABASE_URL" \
  --i-approve-production-database-import-only
```

## Evidence

- `reports/admin-reconciliation-v2/phase7-completion-v3/production-apply/03-production-apply-result.json`
- `reports/admin-reconciliation-v2/phase7-completion-v3/production-apply/03-production-apply-summary.md`
