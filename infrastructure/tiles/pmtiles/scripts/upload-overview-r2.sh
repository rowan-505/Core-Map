#!/usr/bin/env bash
# Explicit upload of a local overview PMTiles archive to Cloudflare R2.
#
# Object key (versioned; never overwrites the live pointer):
#   basemaps/overview/<version>/myanmar-overview-<version>.pmtiles
#
# Does NOT switch production manifests/pointers.
#
# Usage:
#   npm run tiles:upload:overview -- v2
#   bash infrastructure/tiles/pmtiles/scripts/upload-overview-r2.sh v2
#
# Prerequisites:
#   1. local build exists
#   2. local verify passed (npm run tiles:verify:overview -- <version>)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
VERSION="${1:-}"

usage() {
  echo "usage: npm run tiles:upload:overview -- <version>" >&2
  echo "example: npm run tiles:upload:overview -- v2" >&2
  echo "" >&2
  echo "uploads to: basemaps/overview/<version>/myanmar-overview-<version>.pmtiles" >&2
  echo "does not switch production overview pointer/manifest" >&2
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

LOCAL_FILE="$(cd "${SCRIPT_DIR}/.." && pwd)/overview/regions/myanmar-overview-${VERSION}.pmtiles"
if [[ ! -f "$LOCAL_FILE" ]]; then
  echo "error: local overview archive missing: ${LOCAL_FILE}" >&2
  echo "hint: npm run tiles:rebuild:overview -- ${VERSION}" >&2
  exit 1
fi

echo "[tiles:upload:overview] explicit upload only — pointer switch is separate" >&2
echo "[tiles:upload:overview] recommended prior step: npm run tiles:verify:overview -- ${VERSION}" >&2
echo "" >&2

exec bash "${SCRIPT_DIR}/upload-package-r2.sh" overview "$VERSION"
