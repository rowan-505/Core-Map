#!/usr/bin/env bash
# Verify a versioned overview PMTiles object on public R2 / CDN.
#
# Checks:
#   - HTTP HEAD → 200
#   - Range request → 206 + Content-Range
#   - CORS (Access-Control-Allow-Origin) for a browser Origin
#   - pmtiles metadata readable (derived outline + state layers; no MIMU / raw country)
#
# Does NOT upload. Does NOT switch production pointer/manifest.
# Does NOT delete or modify v1.
#
# Usage:
#   npm run tiles:verify:r2:overview -- v2
#   bash infrastructure/tiles/pmtiles/scripts/verify-overview-r2.sh v2
#
# Env:
#   R2_PUBLIC_BASE_URL   default https://tiles.coremapmm.com
#   VERIFY_ORIGIN        default http://localhost:5173
set -euo pipefail

VERSION="${1:-}"
R2_PUBLIC_BASE_URL="${R2_PUBLIC_BASE_URL:-https://tiles.coremapmm.com}"
VERIFY_ORIGIN="${VERIFY_ORIGIN:-http://localhost:5173}"

usage() {
  echo "usage: npm run tiles:verify:r2:overview -- <version>" >&2
  echo "example: npm run tiles:verify:r2:overview -- v2" >&2
}

if [[ -z "$VERSION" ]]; then
  usage
  exit 1
fi

if [[ ! "$VERSION" =~ ^v[0-9]+$ ]]; then
  echo "error: version must look like v1, v2, v3" >&2
  usage
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "error: curl required" >&2
  exit 1
fi

if ! command -v pmtiles >/dev/null 2>&1; then
  echo "error: pmtiles CLI required (brew install pmtiles)" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 required" >&2
  exit 1
fi

OBJECT_KEY="basemaps/overview/${VERSION}/myanmar-overview-${VERSION}.pmtiles"
URL="${R2_PUBLIC_BASE_URL%/}/${OBJECT_KEY}"
V1_URL="${R2_PUBLIC_BASE_URL%/}/basemaps/overview/v1/myanmar-overview-v1.pmtiles"
export OVERVIEW_VERIFY_VERSION="$VERSION"

normalize() { tr -d '\r'; }
http_status() {
  printf '%s\n' "$1" | grep -E '^HTTP/' | tail -1 | awk '{print $2}' || true
}
header_value() {
  local block="$1" name="$2"
  printf '%s\n' "$block" | grep -i "^${name}:" | tail -1 | cut -d: -f2- | sed 's/^ //' || true
}

FAIL=0
pass() { echo "[pass] $*" >&2; }
fail() { echo "[fail] $*" >&2; FAIL=1; }

echo "[tiles:verify:r2:overview] version=${VERSION}" >&2
echo "[tiles:verify:r2:overview] url=${URL}" >&2
echo "[tiles:verify:r2:overview] origin=${VERIFY_ORIGIN}" >&2
echo "" >&2

# 1) HEAD → 200
set +e
HEAD_RAW="$(curl -sS -I -L --max-time 60 "$URL" 2>&1 | normalize)"
HEAD_EC=$?
set -e
HEAD_STATUS="$(http_status "$HEAD_RAW")"
if [[ "$HEAD_EC" -eq 0 && "$HEAD_STATUS" == "200" ]]; then
  pass "HEAD HTTP ${HEAD_STATUS}"
else
  fail "HEAD want 200, got ${HEAD_STATUS:-<none>} (curl_ec=${HEAD_EC})"
fi

# 2) Range → 206
set +e
RANGE_RAW="$(curl -sS -I -L --max-time 60 \
  -H "Range: bytes=0-16383" \
  -H "Origin: ${VERIFY_ORIGIN}" \
  "$URL" 2>&1 | normalize)"
RANGE_EC=$?
set -e
RANGE_STATUS="$(http_status "$RANGE_RAW")"
CONTENT_RANGE="$(header_value "$RANGE_RAW" "content-range")"
ACAO="$(header_value "$RANGE_RAW" "access-control-allow-origin")"

if [[ "$RANGE_EC" -eq 0 && "$RANGE_STATUS" == "206" ]]; then
  pass "Range HTTP ${RANGE_STATUS}"
else
  fail "Range want 206, got ${RANGE_STATUS:-<none>} (curl_ec=${RANGE_EC})"
fi

if [[ -n "$CONTENT_RANGE" ]]; then
  pass "Content-Range: ${CONTENT_RANGE}"
else
  fail "Content-Range missing"
fi

# 3) CORS
if [[ -n "$ACAO" ]]; then
  # Accept exact origin or wildcard
  if [[ "$ACAO" == "*" || "$ACAO" == "$VERIFY_ORIGIN" ]]; then
    pass "CORS Access-Control-Allow-Origin: ${ACAO}"
  else
    fail "CORS ACAO=${ACAO} (expected * or ${VERIFY_ORIGIN})"
  fi
else
  fail "CORS Access-Control-Allow-Origin missing"
fi

# 4) Metadata readable via pmtiles CLI
echo "" >&2
echo "[tiles:verify:r2:overview] reading remote metadata..." >&2
META_TMP="$(mktemp "${TMPDIR:-/tmp}/overview-meta.XXXXXX.json")"
cleanup_meta() { rm -f "$META_TMP"; }
trap cleanup_meta EXIT

set +e
pmtiles show "$URL" --metadata >"$META_TMP" 2>/dev/null
META_EC=$?
set -e
if [[ "$META_EC" -ne 0 || ! -s "$META_TMP" ]]; then
  fail "pmtiles metadata not readable from ${URL}"
else
  pass "pmtiles metadata readable"
  if python3 - "$META_TMP" <<'PY'
import json, sys
from pathlib import Path

path = Path(sys.argv[1])
try:
    meta = json.loads(path.read_text(encoding="utf-8"))
except Exception as e:
    print(f"[fail] metadata JSON parse error: {e}", file=sys.stderr)
    sys.exit(1)

layers = [vl.get("id") for vl in (meta.get("vector_layers") or []) if isinstance(vl, dict)]
print(f"  vector_layers: {', '.join(layers)}", file=sys.stderr)
required = {
    "myanmar_country",
    "myanmar_state_region",
    "myanmar_state_labels",
}
missing = sorted(required - set(layers))
# v1 production may still be MIMU-era; only enforce Core layers when present OR when any mmr_ absent and admin_* expected for v2+
# For verify: require Core layers for versions other than legacy v1 MIMU archives.
# If admin_* missing but mmr_admin1 present, treat as legacy-ok for v1 rollback checks only when ALLOW_LEGACY_MIMU=1.
import os
version = os.environ.get("OVERVIEW_VERIFY_VERSION", "")
if missing:
    mimu = [x for x in layers if x.startswith("mmr_")]
    if version == "v1" and mimu and os.environ.get("ALLOW_LEGACY_MIMU", "1") == "1":
        print(f"[pass] legacy v1 MIMU layers present ({', '.join(mimu)}); Core layers not required for v1 rollback check", file=sys.stderr)
    else:
        print(f"[fail] missing Core layers: {', '.join(missing)}", file=sys.stderr)
        sys.exit(1)
else:
    forbidden = [x for x in layers if x.startswith("mmr_") or "mimu" in x.lower()]
    if forbidden:
        print(f"[fail] MIMU/legacy layers present: {', '.join(forbidden)}", file=sys.stderr)
        sys.exit(1)
    print("[pass] Core admin layers present; no MIMU source layers", file=sys.stderr)

mz = meta.get("minzoom", meta.get("minZoom"))
xz = meta.get("maxzoom", meta.get("maxZoom"))
print(f"  minzoom={mz} maxzoom={xz}", file=sys.stderr)
PY
  then
    :
  else
    FAIL=1
  fi
fi

# 5) Keep v1 available (informational; do not delete)
echo "" >&2
set +e
V1_HEAD="$(curl -sS -I -L --max-time 30 "$V1_URL" 2>&1 | normalize)"
V1_EC=$?
set -e
V1_STATUS="$(http_status "$V1_HEAD")"
if [[ "$V1_EC" -eq 0 && "$V1_STATUS" == "200" ]]; then
  pass "v1 still available for rollback: ${V1_URL}"
else
  echo "[warn] could not confirm v1 still online (${V1_STATUS:-<none>}) — check before switching pointer" >&2
fi

echo "" >&2
if [[ "$FAIL" -ne 0 ]]; then
  echo "[tiles:verify:r2:overview] FAILURE — do not switch production pointer" >&2
  exit 1
fi

echo "[tiles:verify:r2:overview] SUCCESS" >&2
echo "next (separate): CONFIRM=1 npm run tiles:switch:overview -- ${VERSION}" >&2
echo "rollback later:  CONFIRM=1 npm run tiles:switch:overview -- v1" >&2
