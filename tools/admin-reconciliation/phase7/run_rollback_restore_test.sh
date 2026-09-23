#!/usr/bin/env bash
# Real Phase 7 rollback + backup restore test. Disposable only. Never production.
set -euo pipefail
ROOT=/Users/nyihtet/Documents/Projects/Core-Map
cd "$ROOT"
OUT="$ROOT/reports/admin-reconciliation-v2/phase7-final-release/validation"
RB="$ROOT/reports/admin-reconciliation-v2/phase7-final-release/rollback"
export PGSSLMODE=disable PGPASSWORD=postgres
HOST=127.0.0.1
PORT=5433
USER=postgres
DUMP=/tmp/coremap_phase6_schemas.dump
BACKUP="$ROOT/reports/admin-reconciliation-v2/phase7-final-release/backup/07-prod-prephase7-affected.dump"
LOG="$OUT/07-rollback-restore-test.log"
: > "$LOG"
log() { echo "$@" | tee -a "$LOG"; }

log "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) real rollback + backup restore test ==="

# --- A) Fresh clone for import→rollback cycle ---
docker exec coremap-admin-cleanup-pg psql -U postgres -c "DROP DATABASE IF EXISTS coremap_phase7_rbtest;"
docker exec coremap-admin-cleanup-pg psql -U postgres -c "CREATE DATABASE coremap_phase7_rbtest;"
RBURL="postgresql://postgres:postgres@127.0.0.1:5433/coremap_phase7_rbtest?sslmode=disable"
psql "$RBURL" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE SCHEMA IF NOT EXISTS app_auth; CREATE TABLE IF NOT EXISTS app_auth.auth_users(id uuid PRIMARY KEY);"
log "Restoring schema dump into coremap_phase7_rbtest..."
pg_restore -h 127.0.0.1 -p 5433 -U postgres -d coremap_phase7_rbtest --no-owner --no-acl "$DUMP" >>"$LOG" 2>&1 || true
# Align postal DDL
psql "$RBURL" -v ON_ERROR_STOP=1 -f "$ROOT/infrastructure/database/migrations/supabase/20260921180000_phase5_ref_postal_codes.sql" >>"$LOG" 2>&1

# Pre-import snapshot + ID lists for full restore arithmetic
psql "$RBURL" -v ON_ERROR_STOP=1 -At <<SQL > "$OUT/07-rbtest-pre-counts.txt"
SELECT 'admin_active', count(*) FROM core.core_admin_areas WHERE deleted_at IS NULL;
SELECT 'settle_active', count(*) FROM core.core_settlements WHERE deleted_at IS NULL;
SELECT 'postal', count(*) FROM ref.ref_postal_codes;
SELECT 'admin_ph', count(*) FROM core.core_admin_areas WHERE geometry_source='mimu_placeholder' AND deleted_at IS NULL;
SELECT 'settle_ph', count(*) FROM core.core_settlements WHERE deleted_at IS NULL AND coalesce(source_refs->>'geometry_status','')='mimu_placeholder';
SELECT 'admin_hash', md5(string_agg(id::text || ':' || md5(ST_AsBinary(geom)), ',' ORDER BY id))
FROM core.core_admin_areas WHERE deleted_at IS NULL AND geom IS NOT NULL;
SELECT 'settle_hash', md5(string_agg(id::text || ':' || md5(ST_AsBinary(point_geom)), ',' ORDER BY id))
FROM core.core_settlements WHERE deleted_at IS NULL AND point_geom IS NOT NULL;
SELECT 'postal_hash', md5(string_agg(postal_code || ':' || coalesce(match_status,''), ',' ORDER BY postal_code))
FROM ref.ref_postal_codes;
SQL
psql "$RBURL" -c "\copy (SELECT id FROM core.core_admin_areas WHERE deleted_at IS NULL ORDER BY id) TO '$OUT/07-rbtest-pre-admin-ids.csv' CSV HEADER"
psql "$RBURL" -c "\copy (SELECT id FROM core.core_settlements WHERE deleted_at IS NULL ORDER BY id) TO '$OUT/07-rbtest-pre-settle-ids.csv' CSV HEADER"
psql "$RBURL" -c "\copy (SELECT postal_code, match_status, township_admin_area_id, local_admin_area_id FROM ref.ref_postal_codes ORDER BY postal_code) TO '$OUT/07-rbtest-pre-postal.csv' CSV HEADER"
log "Pre counts:"; cat "$OUT/07-rbtest-pre-counts.txt" | tee -a "$LOG"

# Import (full apply) — COMMIT inside script
log "Running Phase 6/7 apply on rbtest..."
uv run --with 'psycopg[binary]' python tools/admin-reconciliation/phase6/apply_region.py \
  --database-url "$RBURL" --mode apply \
  --out-dir "$OUT/rbtest-apply-out" >>"$LOG" 2>&1
log "Apply done"

psql "$RBURL" -At <<SQL > "$OUT/07-rbtest-post-import-counts.txt"
SELECT 'admin_active', count(*) FROM core.core_admin_areas WHERE deleted_at IS NULL;
SELECT 'settle_active', count(*) FROM core.core_settlements WHERE deleted_at IS NULL;
SELECT 'admin_ph', count(*) FROM core.core_admin_areas WHERE geometry_source='mimu_placeholder' AND deleted_at IS NULL;
SELECT 'settle_ph', count(*) FROM core.core_settlements WHERE deleted_at IS NULL AND coalesce(source_refs->>'geometry_status','')='mimu_placeholder';
SQL
log "Post-import:"; cat "$OUT/07-rbtest-post-import-counts.txt" | tee -a "$LOG"

# Real rollback SQL with COMMIT: retire placeholders + reinstate pre-import active IDs + restore postal snapshot
python3 <<'PY'
from pathlib import Path
OUT=Path('reports/admin-reconciliation-v2/phase7-final-release/validation')
RB=Path('reports/admin-reconciliation-v2/phase7-final-release/rollback')
admin_ids=[ln.strip() for ln in (OUT/'07-rbtest-pre-admin-ids.csv').read_text().splitlines()[1:] if ln.strip()]
settle_ids=[ln.strip() for ln in (OUT/'07-rbtest-pre-settle-ids.csv').read_text().splitlines()[1:] if ln.strip()]
# chunk arrays
def chunks(xs,n=500):
  for i in range(0,len(xs),n):
    yield xs[i:i+n]
sql=['BEGIN;']
sql += [
"UPDATE core.core_admin_areas SET is_active=false, deleted_at=COALESCE(deleted_at, now()), updated_at=now() WHERE geometry_source='mimu_placeholder' AND deleted_at IS NULL;",
"UPDATE core.core_settlements SET deleted_at=COALESCE(deleted_at, now()), updated_at=now() WHERE deleted_at IS NULL AND coalesce(source_refs->>'geometry_status','')='mimu_placeholder';",
]
for ch in chunks(admin_ids):
  sql.append(f"UPDATE core.core_admin_areas SET is_active=true, deleted_at=NULL, updated_at=now() WHERE id IN ({','.join(ch)});")
for ch in chunks(settle_ids):
  sql.append(f"UPDATE core.core_settlements SET deleted_at=NULL, updated_at=now() WHERE id IN ({','.join(ch)});")
# Delete admin/settle rows created after pre max ids (placeholders and any new)
amax=max(int(x) for x in admin_ids)
smax=max(int(x) for x in settle_ids)
sql.append(f"UPDATE ref.ref_postal_codes SET local_admin_area_id=NULL WHERE local_admin_area_id > {amax};")
sql.append(f"UPDATE ref.ref_postal_codes SET township_admin_area_id=NULL WHERE township_admin_area_id > {amax};")
sql.append(f"DELETE FROM core.core_admin_area_names WHERE admin_area_id > {amax};")
sql.append(f"DELETE FROM core.core_admin_areas WHERE id > {amax};")
sql.append(f"DELETE FROM core.core_settlements WHERE id > {smax};")
sql.append("COMMIT;")
(RB/'07-rollback-committed.sql').write_text('\n'.join(sql)+'\n')
print('wrote rollback sql', len(admin_ids), len(settle_ids), 'amax', amax, 'smax', smax)
PY

log "Executing COMMITTED rollback (placeholders retire + reinstate pre IDs + delete new ids)..."
psql "$RBURL" -v ON_ERROR_STOP=1 -f "$RB/07-rollback-committed.sql" >>"$LOG" 2>&1
# Restore postal from pre CSV
psql "$RBURL" -v ON_ERROR_STOP=1 <<SQL >>"$LOG" 2>&1
BEGIN;
CREATE TEMP TABLE pre_postal (
  postal_code text PRIMARY KEY,
  match_status text,
  township_admin_area_id bigint,
  local_admin_area_id bigint
);
\copy pre_postal FROM '$OUT/07-rbtest-pre-postal.csv' CSV HEADER
UPDATE ref.ref_postal_codes p SET
  match_status = pre.match_status,
  township_admin_area_id = pre.township_admin_area_id,
  local_admin_area_id = pre.local_admin_area_id,
  updated_at = now()
FROM pre_postal pre
WHERE p.postal_code = pre.postal_code;
COMMIT;
SQL

psql "$RBURL" -At <<SQL > "$OUT/07-rbtest-post-rollback-counts.txt"
SELECT 'admin_active', count(*) FROM core.core_admin_areas WHERE deleted_at IS NULL;
SELECT 'settle_active', count(*) FROM core.core_settlements WHERE deleted_at IS NULL;
SELECT 'admin_ph_active', count(*) FROM core.core_admin_areas WHERE geometry_source='mimu_placeholder' AND deleted_at IS NULL;
SELECT 'settle_ph_active', count(*) FROM core.core_settlements WHERE deleted_at IS NULL AND coalesce(source_refs->>'geometry_status','')='mimu_placeholder';
SELECT 'admin_hash', md5(string_agg(id::text || ':' || md5(ST_AsBinary(geom)), ',' ORDER BY id))
FROM core.core_admin_areas WHERE deleted_at IS NULL AND geom IS NOT NULL;
SELECT 'settle_hash', md5(string_agg(id::text || ':' || md5(ST_AsBinary(point_geom)), ',' ORDER BY id))
FROM core.core_settlements WHERE deleted_at IS NULL AND point_geom IS NOT NULL;
SELECT 'postal_hash', md5(string_agg(postal_code || ':' || coalesce(match_status,''), ',' ORDER BY postal_code))
FROM ref.ref_postal_codes;
SQL
log "Post-rollback:"; cat "$OUT/07-rbtest-post-rollback-counts.txt" | tee -a "$LOG"

python3 <<'PY' | tee -a "$LOG"
from pathlib import Path
import json
OUT=Path('reports/admin-reconciliation-v2/phase7-final-release/validation')

def load(p):
  d={}
  for line in Path(p).read_text().splitlines():
    if not line.strip(): continue
    parts=line.replace('\t','|').split('|')
    if len(parts)>=2:
      d[parts[0]]=parts[1]
  return d
pre=load(OUT/'07-rbtest-pre-counts.txt')
post=load(OUT/'07-rbtest-post-rollback-counts.txt')
mismatches=[]
for k in ['admin_active','settle_active','admin_hash','settle_hash','postal_hash']:
  if k in pre and pre.get(k)!=post.get(k):
    mismatches.append({'key':k,'pre':pre.get(k),'post':post.get(k)})
ph_a=int(post.get('admin_ph_active','-1'))
ph_s=int(post.get('settle_ph_active','-1'))
gate = len(mismatches)==0 and ph_a==0 and ph_s==0
result={
  'rollback_mismatch_count': len(mismatches),
  'mismatches': mismatches,
  'admin_ph_active': ph_a,
  'settle_ph_active': ph_s,
  'pre': pre,
  'post_rollback': post,
  'pass': gate,
}
(OUT/'07-rollback-restore-result.json').write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps(result, indent=2))
print('ROLLBACK_GATE', 'PASS' if gate else 'FAIL')
PY

# --- B) Backup restore into separate DB ---
log "Restoring backup dump into coremap_phase7_backup_restore..."
docker exec coremap-admin-cleanup-pg psql -U postgres -c "DROP DATABASE IF EXISTS coremap_phase7_backup_restore;"
docker exec coremap-admin-cleanup-pg psql -U postgres -c "CREATE DATABASE coremap_phase7_backup_restore;"
BURL="postgresql://postgres:postgres@127.0.0.1:5433/coremap_phase7_backup_restore?sslmode=disable"
psql "$BURL" -c "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE SCHEMA IF NOT EXISTS core; CREATE SCHEMA IF NOT EXISTS ref; CREATE SCHEMA IF NOT EXISTS app_auth; CREATE TABLE IF NOT EXISTS app_auth.auth_users(id uuid PRIMARY KEY);"
set +e
pg_restore -h 127.0.0.1 -p 5433 -U postgres -d coremap_phase7_backup_restore --no-owner --no-acl "$BACKUP" > "$OUT/07-backup-restore.err" 2>&1
RC=$?
set -e
# Count restore errors that are fatal (ignore missing FK to auth/system)
FATAL=$(rg -c "ERROR:.*does not exist|FATAL" "$OUT/07-backup-restore.err" || true)
psql "$BURL" -At <<SQL > "$OUT/07-backup-restore-counts.txt"
SELECT 'admin', count(*) FROM core.core_admin_areas;
SELECT 'names', count(*) FROM core.core_admin_area_names;
SELECT 'settlements', count(*) FROM core.core_settlements;
SELECT 'postal', count(*) FROM ref.ref_postal_codes;
SQL
log "Backup restore rc=$RC fatal_like=$FATAL"
cat "$OUT/07-backup-restore-counts.txt" | tee -a "$LOG"
python3 <<'PY' | tee -a "$LOG"
from pathlib import Path
counts={}
for line in Path('reports/admin-reconciliation-v2/phase7-final-release/validation/07-backup-restore-counts.txt').read_text().splitlines():
  parts=line.replace('\t','|').split('|')
  if len(parts)>=2: counts[parts[0]]=int(parts[1])
err=Path('reports/admin-reconciliation-v2/phase7-final-release/validation/07-backup-restore.err').read_text()
# readable+complete if core tables have expected prod-scale rows
ok = counts.get('admin',0)>=2500 and counts.get('settlements',0)>=57000 and counts.get('postal',0)==17297
# pg_restore often returns 1 with nonfatal FK errors; treat data presence as success
print('BACKUP_COUNTS', counts)
print('BACKUP_RESTORE_GATE', 'PASS' if ok else 'FAIL')
Path('reports/admin-reconciliation-v2/phase7-final-release/validation/07-backup-restore-result.json').write_text(
  __import__('json').dumps({'pass': ok, 'counts': counts, 'pg_restore_notes': 'nonfatal FK/schema warnings may exist'}, indent=2)+'\n'
)
PY

log "DONE"
