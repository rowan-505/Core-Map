"""Shared helpers for Phase 5 one-time import scripts (no hardcoded ref IDs)."""

from __future__ import annotations

import csv
import hashlib
import json
import re
import uuid
from pathlib import Path
from typing import Any

csv.field_size_limit(min(2**31 - 1, 100_000_000))

REPO = Path(__file__).resolve().parents[3]
REPORTS = REPO / "reports" / "admin-reconciliation-v2"
FROZEN = REPORTS / "phase3-frozen"
PHASE5 = REPORTS / "phase5"

MIMU_VERSION = "9.7"
POSTAL_SOURCE_VERSION = "V1.0 (September 2021)"
IMPORT_MARKER = "phase5_manifest_import"


def clean(value: Any) -> str:
    return "" if value is None else str(value).strip()


def as_int(value: Any) -> int | None:
    text = clean(value)
    return int(text) if text else None


def load_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_csv(path: Path, rows: list[dict[str, Any]], headers: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=headers, extrasaction="ignore")
        w.writeheader()
        for row in rows:
            w.writerow({h: row.get(h, "") for h in headers})


def connect(database_url: str):
    try:
        import psycopg
    except ImportError as exc:  # pragma: no cover
        raise SystemExit(
            "psycopg required. Use: uv run --with 'psycopg[binary]' python ..."
        ) from exc
    return psycopg.connect(database_url)


def resolve_ref_ids(cur) -> dict[str, Any]:
    """Resolve level/type/source ids by stable codes (never hardcode)."""
    cur.execute("SELECT id, code FROM ref.ref_admin_levels")
    levels = {code: int(i) for i, code in cur.fetchall()}
    cur.execute("SELECT id, code FROM ref.ref_admin_area_types")
    types = {code: int(i) for i, code in cur.fetchall()}
    cur.execute("SELECT id, code FROM ref.ref_source_types")
    sources = {code: int(i) for i, code in cur.fetchall()}
    required_levels = {"ward_village_tract", "township"}
    required_types = {"ward", "village_tract"}
    missing = []
    for code in required_levels:
        if code not in levels:
            missing.append(f"ref_admin_levels.code={code}")
    for code in required_types:
        if code not in types:
            missing.append(f"ref_admin_area_types.code={code}")
    if "partner" not in sources:
        missing.append("ref_source_types.code=partner")
    if missing:
        raise SystemExit("Missing reference codes: " + ", ".join(missing))
    return {"levels": levels, "types": types, "sources": sources}


def slugify(name_en: str, source_key: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", (name_en or "area").casefold()).strip("-") or "area"
    digest = hashlib.sha1(source_key.encode("utf-8")).hexdigest()[:10]
    return f"coremap:p5:{base[:48]}:{digest}"


def json_merge_patch(existing: Any, patch: dict[str, Any]) -> dict[str, Any]:
    """Shallow-merge patch into existing jsonb without dropping unrelated keys."""
    base: dict[str, Any]
    if isinstance(existing, dict):
        base = dict(existing)
    elif existing is None:
        base = {}
    else:
        try:
            parsed = json.loads(existing) if isinstance(existing, str) else {}
            base = dict(parsed) if isinstance(parsed, dict) else {}
        except (TypeError, json.JSONDecodeError):
            base = {}
    for k, v in patch.items():
        if k not in base or base[k] in (None, "", {}, []):
            base[k] = v
        elif isinstance(base[k], dict) and isinstance(v, dict):
            base[k] = {**v, **base[k]}  # existing wins on conflict
        # else keep existing
    return base


def require_frozen_manifests() -> tuple[Path, Path, Path]:
    local = FROZEN / "03-approved-local-admin.csv"
    village = FROZEN / "03-approved-villages.csv"
    postal = FROZEN / "04-postal-actions.frozen.csv"
    if not postal.exists():
        postal = REPORTS / "04-postal-actions.csv"
    missing = [p for p in (local, village) if not p.exists()]
    if missing:
        raise SystemExit(
            "Frozen manifests missing. Run first:\n"
            "  python3 tools/admin-reconciliation/phase5/freeze_approved_manifests.py\n"
            f"Missing: {missing}"
        )
    return local, village, postal


def new_public_id() -> str:
    return str(uuid.uuid4())
