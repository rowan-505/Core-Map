#!/usr/bin/env bash
# Download the production overview PMTiles archive into the local serve tree.
# Local QA then reads localhost only (npm run tiles:serve) — no runtime R2.
#
# Does not upload. Does not change production.
#
# Usage:
#   npm run tiles:fetch:overview
#   bash infrastructure/tiles/pmtiles/scripts/fetch-overview-local.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PMTILES_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
OUT_DIR="${PMTILES_ROOT}/overview/regions"
OUT_FILE="${OUT_DIR}/myanmar-overview-v1.pmtiles"
CURRENT_JSON="${PMTILES_ROOT}/overview/current.json"

# Same object production web uses via tiles.coremapmm.com (public CDN).
DEFAULT_URL="https://tiles.coremapmm.com/basemaps/overview/v1/myanmar-overview-v1.pmtiles"
SOURCE_URL="${OVERVIEW_FETCH_URL:-$DEFAULT_URL}"

mkdir -p "$OUT_DIR"

if [[ -f "$OUT_FILE" ]]; then
  size="$(wc -c < "$OUT_FILE" | tr -d ' ')"
  magic="$(head -c 7 "$OUT_FILE" || true)"
  if [[ "$magic" == "PMTiles" && "$size" -gt 1000 ]]; then
    echo "[fetch-overview] already present: ${OUT_FILE} (${size} bytes)"
    echo "[fetch-overview] serve URL: http://localhost:8080/overview/regions/myanmar-overview-v1.pmtiles"
    exit 0
  fi
  echo "[fetch-overview] replacing invalid/incomplete file at ${OUT_FILE}"
fi

TMP="${OUT_FILE}.partial.$$"
echo "[fetch-overview] downloading ${SOURCE_URL}"
echo "[fetch-overview] → ${OUT_FILE}"

if command -v curl >/dev/null 2>&1; then
  # Some CDNs return 403 for curl's default User-Agent on GET.
  curl -fL --retry 3 --retry-delay 2 \
    -A 'Mozilla/5.0 (compatible; CoreMapLocalQA/1.0)' \
    -H 'Accept: */*' \
    -o "$TMP" "$SOURCE_URL"
elif command -v wget >/dev/null 2>&1; then
  wget --user-agent='Mozilla/5.0 (compatible; CoreMapLocalQA/1.0)' -O "$TMP" "$SOURCE_URL"
else
  echo "error: need curl or wget to fetch overview PMTiles" >&2
  exit 1
fi

magic="$(head -c 7 "$TMP" || true)"
if [[ "$magic" != "PMTiles" ]]; then
  rm -f "$TMP"
  echo "error: downloaded file is not a PMTiles archive (header=${magic})" >&2
  exit 1
fi

mv -f "$TMP" "$OUT_FILE"
size="$(wc -c < "$OUT_FILE" | tr -d ' ')"
echo "[fetch-overview] OK (${size} bytes)"

if [[ -f "$CURRENT_JSON" ]]; then
  echo "[fetch-overview] current.json: ${CURRENT_JSON}"
fi
echo "[fetch-overview] next: npm run tiles:serve"
echo "[fetch-overview] URL:  http://localhost:8080/overview/regions/myanmar-overview-v1.pmtiles"
