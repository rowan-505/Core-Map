#!/usr/bin/env bash
# Start CoreMap web in local PMTiles QA mode (DEV only).
#
# Terminal 1: npm run tiles:serve
# Terminal 2: npm run tiles:qa:web
#
# Uses a dedicated Vite port (default 5180) so it does not collide with a normal
# `npm run dev` on 5173.
set -euo pipefail

to_linux_path() {
  local raw="${1:-}"
  raw="${raw//\\//}"
  if [[ "$raw" =~ [Ww]sl\.localhost/[^/]+/(.*) ]]; then
    echo "/${BASH_REMATCH[1]}"
    return
  fi
  echo "$raw"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
if [[ ! -f "$ROOT/package.json" ]]; then
  ROOT="$(to_linux_path "${INIT_CWD:-}")"
fi

QA_WEB_PORT="${QA_WEB_PORT:-5180}"

echo "[tiles:qa:web] generating local QA manifest..."
bash "${SCRIPT_DIR}/generate-local-qa-manifest.sh"

MANIFEST="${ROOT}/infrastructure/tiles/pmtiles/qa/local-packages.json"
OVERVIEW_FILE="${ROOT}/infrastructure/tiles/pmtiles/overview/regions/myanmar-overview-v1.pmtiles"
if [[ ! -f "$OVERVIEW_FILE" ]]; then
  echo "[tiles:qa:web] local overview missing — fetching once for parity QA..."
  bash "${SCRIPT_DIR}/fetch-overview-local.sh" || {
    echo "[tiles:qa:web] warning: overview fetch failed. Parity mode needs overview." >&2
    echo "  Retry: npm run tiles:fetch:overview" >&2
    echo "  Or open ?qaPackage=all for stress mode without overview." >&2
  }
  bash "${SCRIPT_DIR}/generate-local-qa-manifest.sh"
fi

if [[ -f "$MANIFEST" ]]; then
  python3 - "$MANIFEST" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
print(f"[tiles:qa:web] packages={d.get('packageCount')} label={d.get('label')}")
print(f"[tiles:qa:web] manifest URL: http://localhost:8080/qa/local-packages.json")
ov = d.get("overview") or {}
if ov.get("url"):
    print(f"[tiles:qa:web] overview: {ov['url']}")
    print("[tiles:qa:web] default mode: parity (overview + viewport regions, max 4)")
    print("[tiles:qa:web] stress mode:  ?qaPackage=all")
else:
    print("[tiles:qa:web] overview: (none)")
    print("[tiles:qa:web] run: npm run tiles:fetch:overview")
PY
fi

if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -qE ":${QA_WEB_PORT}\\b"; then
  echo "[tiles:qa:web] error: port ${QA_WEB_PORT} is already in use." >&2
  echo "  Stop the other process, or set QA_WEB_PORT to a free port." >&2
  echo "  Tip: ss -ltnp | grep ${QA_WEB_PORT}" >&2
  exit 1
fi

echo ""
echo "[tiles:qa:web] Requires tiles:serve on :8080 in another terminal:"
echo "  npm run tiles:serve"
echo ""
echo "[tiles:qa:web] Starting Vite DEV with VITE_LOAD_ALL_LOCAL_REGION_PMTILES=true"
echo "  web: http://localhost:${QA_WEB_PORT}/"
echo "  parity (default): overview + viewport regions"
echo "  stress:           http://localhost:${QA_WEB_PORT}/?qaPackage=all"
echo ""

cd "${ROOT}/apps/web"
export VITE_LOAD_ALL_LOCAL_REGION_PMTILES=true
# Prefer local overview only when the archive exists (do not point at missing files).
if [[ -z "${VITE_OVERVIEW_PMTILES_URL:-}" ]]; then
  if [[ -f "$OVERVIEW_FILE" ]]; then
    export VITE_OVERVIEW_PMTILES_URL="http://localhost:8080/overview/regions/myanmar-overview-v1.pmtiles"
  else
    echo "[tiles:qa:web] note: no local overview PMTiles — parity mode will fail until fetched"
    unset VITE_OVERVIEW_PMTILES_URL || true
  fi
fi
# Avoid accidental single-region override fighting multi-package QA.
unset VITE_BASEMAP_PMTILES_URL || true

# Dedicated QA port — do not fall back to 5174/5175 (confusing vs normal web dev).
exec npx vite --port "${QA_WEB_PORT}" --strictPort
