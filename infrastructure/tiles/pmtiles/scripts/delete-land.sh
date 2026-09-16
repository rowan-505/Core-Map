#!/usr/bin/env bash
# DELETE a land area from public rendering. Stronger than promote/demote.
#
# Usage:
#   npm run tiles:delete-land -- --confirm-delete osm:way:123
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/load-root-env.sh"

REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
cd "${REPO_ROOT}"

exec npx tsx infrastructure/tiles/pmtiles/scripts/delete-land.ts "$@"
