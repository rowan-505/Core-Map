#!/usr/bin/env python3
"""Minimal PMTiles packages.yaml loader (no DB access)."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import yaml

CONFIG_PATH = Path(__file__).resolve().parents[1] / "config" / "packages.yaml"


def load_config(path: Path = CONFIG_PATH) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit(f"error: {path}: root must be a mapping")
    packages = data.get("packages")
    if not isinstance(packages, dict) or not packages:
        raise SystemExit(f"error: {path}: packages must be a non-empty mapping")
    return data


def package_keys(data: dict[str, Any] | None = None) -> list[str]:
    cfg = data or load_config()
    return list(cfg["packages"].keys())


def get_package(key: str, data: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = data or load_config()
    packages = cfg["packages"]
    if key not in packages:
        raise SystemExit(
            f"error: unknown package '{key}'. Known: {', '.join(packages.keys())}"
        )
    pkg = packages[key]
    if not isinstance(pkg, dict):
        raise SystemExit(f"error: package '{key}' must be a mapping")
    members = pkg.get("members")
    if not isinstance(members, list) or not members:
        raise SystemExit(f"error: package '{key}' needs a non-empty members list")
    for i, member in enumerate(members):
        if not isinstance(member, dict):
            raise SystemExit(f"error: package '{key}' member[{i}] must be a mapping")
        if not str(member.get("admin_level") or "").strip():
            raise SystemExit(f"error: package '{key}' member[{i}] needs admin_level")
        if not (
            str(member.get("name_en") or "").strip()
            or str(member.get("name_mm") or "").strip()
            or member.get("core_id") is not None
        ):
            raise SystemExit(
                f"error: package '{key}' member[{i}] needs name_en, name_mm, or core_id"
            )
    return pkg


def cmd_list() -> int:
    print(" ".join(package_keys()))
    return 0


def cmd_exists(key: str) -> int:
    keys = package_keys()
    print("1" if key in keys else "0")
    return 0 if key in keys else 1


def cmd_label(key: str) -> int:
    pkg = get_package(key)
    print(str(pkg.get("label") or key))
    return 0


def cmd_members_json(key: str) -> int:
    pkg = get_package(key)
    print(json.dumps(pkg["members"], ensure_ascii=False))
    return 0


def cmd_validate_schema() -> int:
    data = load_config()
    for key in package_keys(data):
        get_package(key, data)
    print(f"OK: {len(package_keys(data))} packages in {CONFIG_PATH}")
    return 0


def main() -> int:
    if len(sys.argv) < 2:
        print(
            "usage: package-config.py list|exists <key>|label <key>|members-json <key>|validate-schema",
            file=sys.stderr,
        )
        return 2
    cmd = sys.argv[1]
    if cmd == "list":
        return cmd_list()
    if cmd == "exists" and len(sys.argv) == 3:
        return cmd_exists(sys.argv[2])
    if cmd == "label" and len(sys.argv) == 3:
        return cmd_label(sys.argv[2])
    if cmd == "members-json" and len(sys.argv) == 3:
        return cmd_members_json(sys.argv[2])
    if cmd == "validate-schema":
        return cmd_validate_schema()
    print("error: bad args", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
