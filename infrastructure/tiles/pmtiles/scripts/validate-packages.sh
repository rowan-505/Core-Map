#!/usr/bin/env bash
# Validate every packages.yaml package resolves to local admin boundaries.
# Requires LOCAL_TILE_DATABASE_URL and synced tile_source.admin_areas.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/load-root-env.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/region-resolver.sh"

if [[ -z "${LOCAL_TILE_DATABASE_URL:-}" ]]; then
  echo "FAIL: LOCAL_TILE_DATABASE_URL is not set" >&2
  exit 1
fi
LOCAL_TILE_DATABASE_URL="$(local_map_clean_pg_url "$LOCAL_TILE_DATABASE_URL")"
export LOCAL_TILE_DATABASE_URL

python3 "${SCRIPT_DIR}/package-config.py" validate-schema

fail=0
for key in "${PMTILES_SUPPORTED_REGIONS[@]}"; do
  if info="$(pmtiles_resolve_region_boundary "$key")"; then
    IFS='|' read -r ids label area count <<<"$info"
    echo "OK  ${key}: members=${count} core_ids=${ids} label=${label} area_km2=${area}"
  else
    echo "FAIL ${key}"
    fail=1
  fi
done

if [[ "$fail" -ne 0 ]]; then
  echo "FAILED: one or more packages did not resolve" >&2
  exit 1
fi
echo "SUCCESS: all ${#PMTILES_SUPPORTED_REGIONS[@]} packages resolved"
