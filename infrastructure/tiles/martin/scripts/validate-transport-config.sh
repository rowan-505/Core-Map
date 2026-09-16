#!/usr/bin/env bash
# Validate the fixed public transport Martin function contract.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MARTIN_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${MARTIN_DIR}/../../.." && pwd)"
MIGRATION="${REPO_ROOT}/infrastructure/database/migrations/supabase/20260916100000_public_transport_martin_sources.sql"

python3 - "${MARTIN_DIR}/config.yaml" "${MIGRATION}" <<'PY'
from pathlib import Path
import re
import sys

config = Path(sys.argv[1]).read_text(encoding="utf-8")
migration_path = Path(sys.argv[2])
if not migration_path.is_file():
    raise SystemExit(f"FAIL missing migration: {migration_path}")
migration = migration_path.read_text(encoding="utf-8")

if not re.search(r"auto_publish:\s*\n\s*from_schemas:\s*\n\s*- tiles", config):
    raise SystemExit("FAIL Martin must auto-publish the curated tiles schema functions")

sources = (
    "transport_bus_stops",
    "transport_bus_route_overview",
    "transport_train_stations",
    "transport_train_routes",
    "transport_express_terminals",
    "transport_express_route_corridors",
)
for source in sources:
    if f"FUNCTION tiles.{source}(z integer, x integer, y integer)" not in migration:
        raise SystemExit(f"FAIL missing fixed MVT function: {source}")
    print(f"OK   {source}")

if "review_status IN ('reviewed', 'verified')" in migration or "review_status IN ('reviewed','verified')" in migration:
    raise SystemExit("FAIL transport functions must not hide active data by review status")

for required in ("is_active", "deleted_at IS NULL", "ST_SimplifyPreserveTopology"):
    if required not in migration:
        raise SystemExit(f"FAIL migration is missing public/zoom safety: {required}")

print("Transport Martin function contract passed.")
PY
