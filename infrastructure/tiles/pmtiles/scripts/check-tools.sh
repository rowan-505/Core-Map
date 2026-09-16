#!/usr/bin/env bash
# Verify PMTiles build-machine tools against pinned versions in config/tool-versions.json.
# Does not install or upgrade anything.
#
# Usage:
#   bash infrastructure/tiles/pmtiles/scripts/check-tools.sh
#   npm run tiles:check-tools
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/../config/tool-versions.json"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "error: missing tool version config: ${CONFIG_FILE}" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 is required to read ${CONFIG_FILE}" >&2
  exit 1
fi

python3 - "$CONFIG_FILE" <<'PY'
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

config_path = Path(sys.argv[1])
config = json.loads(config_path.read_text(encoding="utf-8"))
tools = config.get("tools")
if not isinstance(tools, dict) or not tools:
    print(f"error: {config_path}: missing tools object", file=sys.stderr)
    sys.exit(1)


def run_text(cmd: list[str]) -> str:
    try:
        return subprocess.check_output(cmd, text=True, stderr=subprocess.STDOUT).strip()
    except (OSError, subprocess.CalledProcessError) as exc:
        out = ""
        if isinstance(exc, subprocess.CalledProcessError) and exc.output:
            out = str(exc.output).strip()
        return out or f"(failed: {exc})"


def first_semver(text: str) -> str | None:
    match = re.search(r"\b(\d+\.\d+(?:\.\d+)?)\b", text)
    return match.group(1) if match else None


def normalize_triple(version: str) -> tuple[int, ...]:
    parts = [int(p) for p in version.split(".") if p.isdigit()]
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts[:3])


def versions_compatible(detected: str, expected: str) -> bool:
    """Accept exact match, or detected major.minor.patch where expected is a prefix."""
    detected = detected.strip()
    expected = expected.strip()
    if detected == expected:
        return True
    # Allow 17.11 vs 17.11.0 style equivalence on compared segments.
    d = normalize_triple(detected)
    e = normalize_triple(expected)
    expected_parts = [int(p) for p in expected.split(".") if p.isdigit()]
    return d[: len(expected_parts)] == tuple(expected_parts)


def detect_ubuntu() -> tuple[str | None, str]:
    os_release = Path("/etc/os-release")
    if not os_release.is_file():
        return None, "(no /etc/os-release)"
    data: dict[str, str] = {}
    for line in os_release.read_text(encoding="utf-8").splitlines():
        if "=" not in line:
            continue
        key, val = line.split("=", 1)
        data[key] = val.strip().strip('"')
    version_id = data.get("VERSION_ID")
    pretty = data.get("PRETTY_NAME", version_id or "(unknown)")
    return version_id, pretty


def detect_postgresql() -> tuple[str | None, str]:
    raw = run_text(["psql", "--version"])
    # psql (PostgreSQL) 17.11 (Ubuntu ...)
    match = re.search(r"PostgreSQL\)\s+(\d+\.\d+(?:\.\d+)?)", raw)
    return (match.group(1) if match else first_semver(raw)), raw


def detect_postgis() -> tuple[str | None, str]:
    control = Path("/usr/share/postgresql/17/extension/postgis.control")
    if control.is_file():
        text = control.read_text(encoding="utf-8")
        match = re.search(r"default_version\s*=\s*'([^']+)'", text)
        if match:
            return match.group(1), f"postgis.control default_version={match.group(1)}"
    try:
        pkg = subprocess.check_output(
            ["dpkg-query", "-W", "-f=${Version}", "postgresql-17-postgis-3"],
            text=True,
            stderr=subprocess.STDOUT,
        ).strip()
        ver = first_semver(pkg)
        return ver, f"dpkg postgresql-17-postgis-3={pkg}"
    except (OSError, subprocess.CalledProcessError) as exc:
        return None, f"(postgis not detected: {exc})"


def detect_gdal() -> tuple[str | None, str]:
    raw = run_text(["ogr2ogr", "--version"])
    match = re.search(r"GDAL\s+(\d+\.\d+\.\d+)", raw)
    return (match.group(1) if match else first_semver(raw)), raw


def detect_python() -> tuple[str | None, str]:
    raw = run_text(["python3", "--version"])
    match = re.search(r"Python\s+(\d+\.\d+\.\d+)", raw)
    return (match.group(1) if match else first_semver(raw)), raw


def detect_tippecanoe_family(command: str) -> tuple[str | None, str]:
    # tile-join has no --version; tippecanoe reports the shared package version.
    version_cmd = "tippecanoe" if command == "tile-join" else command
    raw = run_text([version_cmd, "--version"])
    # tippecanoe v2.49.0 / tippecanoe 2.49.0
    match = re.search(r"v?(\d+\.\d+\.\d+)", raw)
    detail = raw or f"({version_cmd} --version produced no output)"
    if command == "tile-join" and match:
        detail = f"tile-join present; package version from tippecanoe --version => {raw}"
    return (match.group(1) if match else first_semver(raw)), detail


def detect_pmtiles() -> tuple[str | None, str]:
    # go-pmtiles v1.x often has no --version flag; try several probes.
    for args in (["pmtiles", "version"], ["pmtiles", "--version"]):
        raw = run_text(args)
        if raw.startswith("(failed:") or "unknown flag" in raw or "unrecognized" in raw:
            continue
        match = re.search(r"v?(\d+\.\d+\.\d+)", raw)
        if match:
            return match.group(1), raw
        if raw:
            ver = first_semver(raw)
            if ver:
                return ver, raw
    # Fallback: embedded version string in the binary (go-pmtiles releases).
    path = shutil.which("pmtiles")
    if path:
        try:
            data = Path(path).read_bytes()
            # Prefer exact pinned form if present.
            for candidate in (b"1.31.2", b"v1.31.2"):
                if candidate in data:
                    return "1.31.2", f"pmtiles binary embeds {candidate.decode()}"
            text = data.decode("latin-1", errors="ignore")
            match = re.search(r"\b(\d+\.\d+\.\d+)\b", text)
            if match:
                return match.group(1), f"pmtiles binary embeds {match.group(1)}"
            return None, f"pmtiles present at {path} (version string not found)"
        except OSError as exc:
            return None, f"(could not read pmtiles binary: {exc})"
    return None, "(pmtiles not on PATH)"


detectors = {
    "ubuntu": detect_ubuntu,
    "postgresql": detect_postgresql,
    "postgis": detect_postgis,
    "gdal": detect_gdal,
    "python": detect_python,
    "tippecanoe": lambda: detect_tippecanoe_family("tippecanoe"),
    "tile-join": lambda: detect_tippecanoe_family("tile-join"),
    "pmtiles": detect_pmtiles,
}

print(f"PMTiles tool check")
print(f"  config: {config_path}")
print(f"  pinned_at: {config.get('pinned_at', '(none)')}")
print("")

failures: list[str] = []
warnings: list[str] = []

order = [
    "ubuntu",
    "postgresql",
    "postgis",
    "gdal",
    "python",
    "tippecanoe",
    "tile-join",
    "pmtiles",
]

for name in order:
    spec = tools.get(name)
    if not isinstance(spec, dict):
        failures.append(f"{name}: missing from config")
        continue

    expected = str(spec.get("version", "")).strip()
    essential = bool(spec.get("essential", True))
    command = spec.get("command")
    also_require = spec.get("also_require") or []

    missing_cmds: list[str] = []
    if isinstance(command, str) and command:
        if shutil.which(command) is None:
            missing_cmds.append(command)
    if isinstance(also_require, list):
        for extra in also_require:
            if isinstance(extra, str) and extra and shutil.which(extra) is None:
                missing_cmds.append(extra)

    if missing_cmds:
        hint = spec.get("install_hint")
        msg = f"{name}: MISSING command(s): {', '.join(missing_cmds)} (expected {expected})"
        if hint:
            msg += f" — {hint}"
        print(f"FAIL  {name:12s}  expected={expected:10s}  detected=(missing)")
        if hint:
            print(f"      install_hint: {hint}")
        failures.append(msg)
        continue

    detector = detectors.get(name)
    if detector is None:
        print(f"WARN  {name:12s}  no detector implemented")
        warnings.append(f"{name}: no detector")
        continue

    detected, detail = detector()
    detail_one_line = " ".join(detail.split())
    if len(detail_one_line) > 120:
        detail_one_line = detail_one_line[:117] + "..."

    if not detected:
        status = "FAIL" if essential else "WARN"
        line = f"{status}  {name:12s}  expected={expected:10s}  detected=(unparsed)  raw={detail_one_line}"
        print(line)
        msg = f"{name}: could not parse version (expected {expected}); raw={detail_one_line}"
        if essential:
            failures.append(msg)
        else:
            warnings.append(msg)
        continue

    ok = versions_compatible(detected, expected)
    if ok:
        print(f"OK    {name:12s}  expected={expected:10s}  detected={detected}")
    else:
        status = "FAIL" if essential else "WARN"
        print(f"{status}  {name:12s}  expected={expected:10s}  detected={detected}  raw={detail_one_line}")
        msg = f"{name}: version mismatch expected={expected} detected={detected}"
        if essential:
            failures.append(msg)
        else:
            warnings.append(msg)

print("")
if warnings:
    print(f"warnings: {len(warnings)}")
    for item in warnings:
        print(f"  - {item}")

if failures:
    print(f"FAILED: {len(failures)} essential tool problem(s)")
    for item in failures:
        print(f"  - {item}")
    print("")
    print("This script does not install or upgrade tools.")
    sys.exit(1)

print("SUCCESS: all essential PMTiles tools match the pinned baseline.")
sys.exit(0)
PY
