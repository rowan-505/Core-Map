#!/usr/bin/env bash
# Windows/WSL: promote one local land area into Supabase Core via the Fastify admin API.
#
# Usage:
#   npm run tiles:promote-land -- osm:way:123
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/load-root-env.sh"

REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
cd "${REPO_ROOT}"

exec npx tsx infrastructure/tiles/pmtiles/scripts/promote-land.ts "$@"
