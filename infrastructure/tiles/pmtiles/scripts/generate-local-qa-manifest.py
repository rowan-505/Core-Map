#!/usr/bin/env python3
"""Generate local PMTiles QA manifest from packages.yaml + regions/*/current.json.

Writes infrastructure/tiles/pmtiles/qa/local-packages.json for tiles:serve.
No database. No R2. Dev/build machine only.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import yaml
except ImportError:
    print("error: PyYAML required (python3 -c 'import yaml')", file=sys.stderr)
    sys.exit(1)

PMTILES_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PMTILES_ROOT.parents[2]
PACKAGES_YAML = PMTILES_ROOT / "config" / "packages.yaml"
REGIONS_DIR = PMTILES_ROOT / "regions"
OVERVIEW_CURRENT = PMTILES_ROOT / "overview" / "current.json"
# Production web bounds (same geography as map.coremapmm.com viewport selection).
PROD_MANIFEST = REPO_ROOT / "apps" / "web" / "public" / "basemaps" / "manifest.json"
OUT_PATH = PMTILES_ROOT / "qa" / "local-packages.json"
DEFAULT_BASE = "http://localhost:8080"


def load_prod_bounds() -> dict[str, list[float]]:
    """Region id → [minLng, minLat, maxLng, maxLat] from the committed production manifest."""
    if not PROD_MANIFEST.is_file():
        print(f"[qa-manifest] warning: missing {PROD_MANIFEST} — packages omit bounds", file=sys.stderr)
        return {}
    data = json.loads(PROD_MANIFEST.read_text(encoding="utf-8"))
    out: dict[str, list[float]] = {}
    for region in data.get("regions") or []:
        if not isinstance(region, dict):
            continue
        rid = str(region.get("id") or "").strip()
        bounds = region.get("bounds")
        if (
            rid
            and isinstance(bounds, list)
            and len(bounds) == 4
            and all(isinstance(n, (int, float)) for n in bounds)
        ):
            out[rid] = [float(n) for n in bounds]
    overview = data.get("overview") if isinstance(data.get("overview"), dict) else None
    if overview:
        bounds = overview.get("bounds")
        if (
            isinstance(bounds, list)
            and len(bounds) == 4
            and all(isinstance(n, (int, float)) for n in bounds)
        ):
            out["__overview__"] = [float(n) for n in bounds]
    return out


def load_package_keys() -> list[str]:
    data = yaml.safe_load(PACKAGES_YAML.read_text(encoding="utf-8"))
    packages = data.get("packages") if isinstance(data, dict) else None
    if not isinstance(packages, dict) or not packages:
        raise SystemExit(f"error: no packages in {PACKAGES_YAML}")
    return list(packages.keys())


def local_url(path_under_pmtiles: str) -> str:
    return f"{DEFAULT_BASE}/{path_under_pmtiles.lstrip('/')}"


def main() -> int:
    keys = load_package_keys()
    packages: list[dict] = []
    missing: list[str] = []
    prod_bounds = load_prod_bounds()

    for key in keys:
        current_path = REGIONS_DIR / key / "current.json"
        if not current_path.is_file():
            missing.append(key)
            print(f"[qa-manifest] skip {key}: missing {current_path}", file=sys.stderr)
            continue
        current = json.loads(current_path.read_text(encoding="utf-8"))
        version = str(current.get("version") or "").strip()
        filename = str(current.get("filename") or "").strip()
        if not version or not filename:
            missing.append(key)
            print(f"[qa-manifest] skip {key}: current.json missing version/filename", file=sys.stderr)
            continue
        pmtiles_path = REGIONS_DIR / key / filename
        if not pmtiles_path.is_file():
            missing.append(key)
            print(f"[qa-manifest] skip {key}: missing {pmtiles_path}", file=sys.stderr)
            continue

        min_zoom = current.get("minZoom", current.get("minzoom"))
        max_zoom = current.get("maxZoom", current.get("maxzoom"))
        entry: dict = {
            "key": key,
            "version": version,
            "filename": filename,
            "url": local_url(f"regions/{key}/{filename}"),
        }
        if isinstance(min_zoom, (int, float)):
            entry["minZoom"] = int(min_zoom)
        if isinstance(max_zoom, (int, float)):
            entry["maxZoom"] = int(max_zoom)
        bounds = prod_bounds.get(key)
        if bounds:
            entry["bounds"] = bounds
        else:
            print(f"[qa-manifest] warning: no production bounds for {key}", file=sys.stderr)
        packages.append(entry)

    overview = None
    if OVERVIEW_CURRENT.is_file():
        oc = json.loads(OVERVIEW_CURRENT.read_text(encoding="utf-8"))
        ofn = str(oc.get("filename") or "").strip()
        oversion = str(oc.get("version") or "").strip()
        if ofn:
            overview_file = PMTILES_ROOT / "overview" / "regions" / ofn
            if overview_file.is_file():
                overview = {
                    "version": oversion or "unknown",
                    "filename": ofn,
                    "url": local_url(f"overview/regions/{ofn}"),
                    "bounds": prod_bounds.get("__overview__", [90.0, 9.0, 102.0, 29.0]),
                    "minZoom": int(oc.get("minZoom", oc.get("minzoom", 0)) or 0),
                    "maxZoom": int(oc.get("maxZoom", oc.get("maxzoom", 8)) or 8),
                }
            else:
                print(
                    f"[qa-manifest] overview artifact missing: {overview_file}",
                    file=sys.stderr,
                )
                print(
                    "[qa-manifest] run: npm run tiles:fetch:overview",
                    file=sys.stderr,
                )

    versions = sorted({p["version"] for p in packages})
    label = versions[0] if len(versions) == 1 else ("mixed" if versions else "none")

    payload = {
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "baseUrl": DEFAULT_BASE,
        "label": label,
        "packageCount": len(packages),
        "overview": overview,
        "packages": packages,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"[qa-manifest] wrote {OUT_PATH} ({len(packages)} packages, label={label})")
    if missing:
        print(f"[qa-manifest] warning: skipped {len(missing)} package(s): {', '.join(missing)}", file=sys.stderr)
        return 1 if not packages else 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
