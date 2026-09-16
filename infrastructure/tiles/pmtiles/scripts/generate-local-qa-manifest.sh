#!/usr/bin/env bash
# Generate qa/local-packages.json from packages.yaml + regions/*/current.json.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
exec python3 "${SCRIPT_DIR}/generate-local-qa-manifest.py"
