#!/usr/bin/env bash
# Switch production overview pointer in web/dashboard basemap manifests.
#
# Separate from upload. Does not touch R2 objects. Does not delete v1.
#
# Updates:
#   apps/web/public/basemaps/manifest.json
#   apps/dashboard/public/basemaps/manifest.json
#
# Usage:
#   npm run tiles:switch:overview -- v2
#   CONFIRM=1 npm run tiles:switch:overview -- v2
#
# Safety:
#   - Requires CONFIRM=1
#   - Runs R2 verify for the target version first (SKIP_VERIFY=1 to skip)
#
# Rollback:
#   CONFIRM=1 npm run tiles:switch:overview -- v1
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
VERSION="${1:-}"
R2_PUBLIC_BASE_URL="${R2_PUBLIC_BASE_URL:-https://tiles.coremapmm.com}"
CONFIRM="${CONFIRM:-0}"
SKIP_VERIFY="${SKIP_VERIFY:-0}"

WEB_MANIFEST="${REPO_ROOT}/apps/web/public/basemaps/manifest.json"
DASH_MANIFEST="${REPO_ROOT}/apps/dashboard/public/basemaps/manifest.json"

usage() {
  echo "usage: CONFIRM=1 npm run tiles:switch:overview -- <version>" >&2
  echo "example: CONFIRM=1 npm run tiles:switch:overview -- v2" >&2
  echo "rollback: CONFIRM=1 npm run tiles:switch:overview -- v1" >&2
  echo "" >&2
  echo "updates web + dashboard basemaps/manifest.json overview.url only" >&2
  echo "does not upload; does not delete R2 objects" >&2
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

if [[ "$CONFIRM" != "1" ]]; then
  echo "error: refusing to switch production overview pointer without CONFIRM=1" >&2
  echo "" >&2
  usage
  exit 1
fi

for f in "$WEB_MANIFEST" "$DASH_MANIFEST"; do
  if [[ ! -f "$f" ]]; then
    echo "error: missing manifest: ${f}" >&2
    exit 1
  fi
done

URL="${R2_PUBLIC_BASE_URL%/}/basemaps/overview/${VERSION}/myanmar-overview-${VERSION}.pmtiles"

if [[ "$SKIP_VERIFY" != "1" ]]; then
  echo "[tiles:switch:overview] verifying R2 object before pointer switch..." >&2
  bash "${SCRIPT_DIR}/verify-overview-r2.sh" "$VERSION"
  echo "" >&2
else
  echo "[tiles:switch:overview] SKIP_VERIFY=1 — not re-checking R2" >&2
fi

echo "[tiles:switch:overview] switching overview pointer → ${VERSION}" >&2
echo "[tiles:switch:overview] url=${URL}" >&2

python3 - "$WEB_MANIFEST" "$DASH_MANIFEST" "$VERSION" "$URL" <<'PY'
import json
import sys
from pathlib import Path

web_path, dash_path, version, url = sys.argv[1:5]

def patch(path: Path) -> None:
    doc = json.loads(path.read_text(encoding="utf-8"))
    overview = doc.get("overview")
    if not isinstance(overview, dict):
        raise SystemExit(f"error: {path} missing overview object")
    prev = {
        "version": overview.get("version"),
        "url": overview.get("url"),
    }
    overview["id"] = "overview"
    overview["version"] = version
    overview["url"] = url
    # Keep existing bounds/minZoom; align maxZoom with overview archive (z0–z8)
    if "maxZoom" in overview:
        overview["maxZoom"] = max(int(overview.get("maxZoom") or 0), 8)
    doc["overview"] = overview
    path.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    print(f"[tiles:switch:overview] updated {path}", file=sys.stderr)
    print(f"  previous: version={prev['version']} url={prev['url']}", file=sys.stderr)
    print(f"  now:      version={version} url={url}", file=sys.stderr)

patch(Path(web_path))
patch(Path(dash_path))
PY

echo "" >&2
echo "[tiles:switch:overview] SUCCESS" >&2
echo "deploy web/dashboard so clients pick up the new manifest." >&2
echo "rollback: CONFIRM=1 npm run tiles:switch:overview -- v1" >&2
echo "v1 R2 object is left in place (not deleted)." >&2
