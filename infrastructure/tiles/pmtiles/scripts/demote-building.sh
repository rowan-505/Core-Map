#!/usr/bin/env bash
# Windows/WSL: demote one Core building into local Archive, then hard-remove Core.
#
# Usage:
#   npm run tiles:demote-building -- osm:way:123
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/load-root-env.sh"

REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
cd "${REPO_ROOT}"

exec npx tsx infrastructure/tiles/pmtiles/scripts/demote-building.ts "$@"
