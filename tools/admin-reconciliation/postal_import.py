#!/usr/bin/env python3
"""Import Myanmar Post postal codes into ref.ref_postal_codes.

Consumes the approved Phase 1 postal actions CSV (already joined EN/MY,
consolidated, and matched). Re-reads the source ZIP only to quarantine
malformed codes (e.g. 114560) into a rejected-row report.

Does not:
  - invent admin polygons from postal localities
  - store malformed codes in production
  - overwrite core.core_addresses.postal_code
  - import action=manual_review admin rows (postal matching is independent)

Usage:
  uv run --with 'psycopg[binary]' python tools/admin-reconciliation/postal_import.py \\
    --postal-actions reports/admin-reconciliation-v2/01-postal-actions.csv \\
    --postal-zip '/Users/.../Complete Data.zip' \\
    --database-url postgresql://... \\
    --mode dry-run|apply \\
    --out reports/admin-reconciliation-v2/postal-import
"""

from __future__ import annotations

import argparse
import collections
import csv
import hashlib
import io
import json
import re
import sys
import zipfile
from pathlib import Path
from typing import Any

csv.field_size_limit(min(2**31 - 1, 100_000_000))

SEVEN_DIGIT = re.compile(r"^[0-9]{7}$")
SOURCE_NAME = "Myanmar Post"
SOURCE_VERSION = "V1.0 (September 2021)"

ACTION_TO_STATUS = {
    "link_local_admin": "linked_local_area",
    "link_township": "linked_township_only",
    "ambiguous_manual_review": "ambiguous",
    "township_source_match_core_unresolved": "unmatched",
    "unmatched_postal_locality": "unmatched",
}


def clean(value: Any) -> str:
    return "" if value is None else str(value).strip()


def as_int(value: Any) -> int | None:
    text = clean(value)
    return int(text) if text else None


def connect(database_url: str):
    try:
        import psycopg
    except ImportError as exc:  # pragma: no cover
        raise SystemExit(
            "psycopg required. Use: uv run --with 'psycopg[binary]' python ..."
        ) from exc
    return psycopg.connect(database_url)


def load_rejected_from_zip(zip_path: Path) -> list[dict[str, str]]:
    rejected: list[dict[str, str]] = []
    with zipfile.ZipFile(zip_path) as archive:
        names = {Path(name).name: name for name in archive.namelist()}
        for language, filename in [
            ("en", "Myanmar_Locations_Postal_Code_EN.csv"),
            ("my", "Myanmar_Locations_Postal_Code_MM.csv"),
        ]:
            raw = archive.read(names[filename])
            text = raw.decode("utf-8-sig")
            for row in csv.DictReader(io.StringIO(text)):
                code = clean(row.get("Postal Code"))
                if code and not SEVEN_DIGIT.fullmatch(code):
                    rejected.append({
                        "postal_code": code,
                        "language": language,
                        "region": clean(row.get("Region")),
                        "township": clean(row.get("Town / Township")),
                        "locality": clean(row.get("Quarter / Village Tract")),
                        "match_status": "malformed_rejected",
                        "reason": "postal_code must be exactly seven ASCII digits",
                    })
    # Deduplicate by code+language
    seen: set[tuple[str, str]] = set()
    unique: list[dict[str, str]] = []
    for row in rejected:
        key = (row["postal_code"], row["language"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(row)
    return unique


def map_row(row: dict[str, str]) -> dict[str, Any]:
    action = clean(row["action"])
    status = ACTION_TO_STATUS.get(action)
    if status is None:
        raise ValueError(f"unknown postal action: {action} for {row.get('postal_code')}")
    if "ambiguous" in clean(row.get("review_reason")).casefold():
        status = "ambiguous"

    code = clean(row["postal_code"])
    if not SEVEN_DIGIT.fullmatch(code):
        raise ValueError(f"actions CSV contains invalid code {code}")

    locality_type = clean(row.get("inferred_locality_type")) or None
    if locality_type not in {None, "ward", "village_tract"}:
        locality_type = None

    return {
        "postal_code": code,
        "region_name_en": clean(row.get("region_name_en")) or None,
        "region_name_my": clean(row.get("region_name_my")) or None,
        "township_name_en": clean(row.get("township_name_en")) or None,
        "township_name_my": clean(row.get("township_name_my")) or None,
        "locality_name_en": clean(row.get("locality_name_en")) or None,
        "locality_name_my": clean(row.get("locality_name_my")) or None,
        "locality_type": locality_type,
        "township_admin_area_id": as_int(row.get("matched_township_coremap_id")),
        "local_admin_area_id": as_int(row.get("matched_local_coremap_id")),
        "match_status": status,
        "match_method": clean(row.get("match_method")) or None,
        "source_name": SOURCE_NAME,
        "source_version": SOURCE_VERSION,
        "review_reason": clean(row.get("review_reason")),
        "source_action": action,
    }


def validate_and_adjust_fks(conn, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Null invalid FKs; ensure local reaches same township; never drop the postal row."""
    tsp_ids = {r["township_admin_area_id"] for r in rows if r["township_admin_area_id"]}
    loc_ids = {r["local_admin_area_id"] for r in rows if r["local_admin_area_id"]}
    all_ids = sorted(tsp_ids | loc_ids)
    active: dict[int, dict[str, Any]] = {}
    if all_ids:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT a.id, a.parent_id, a.is_active, a.deleted_at, l.code AS level_code
                FROM core.core_admin_areas a
                JOIN ref.ref_admin_levels l ON l.id = a.admin_level_id
                WHERE a.id = ANY(%s)
                """,
                (all_ids,),
            )
            for area_id, parent_id, is_active, deleted_at, level_code in cur.fetchall():
                active[int(area_id)] = {
                    "parent_id": int(parent_id) if parent_id is not None else None,
                    "ok": bool(is_active) and deleted_at is None,
                    "level_code": level_code,
                }

    # Walk parent chain for local -> township
    def ancestor_ids(start_id: int) -> set[int]:
        seen: set[int] = set()
        current: int | None = start_id
        while current is not None and current not in seen:
            seen.add(current)
            meta = active.get(current)
            if not meta:
                break
            current = meta["parent_id"]
        return seen

    adjusted: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        tsp = item["township_admin_area_id"]
        loc = item["local_admin_area_id"]

        if tsp is not None:
            meta = active.get(tsp)
            if not meta or not meta["ok"] or meta["level_code"] != "township":
                item["township_admin_area_id"] = None
                item["local_admin_area_id"] = None
                if item["match_status"] in {"linked_local_area", "linked_township_only"}:
                    item["match_status"] = "unmatched"
                    item["match_method"] = (item.get("match_method") or "") + "|fk_township_invalid"
                    item["review_reason"] = "Township FK missing/inactive/wrong level; kept as unmatched"

        tsp = item["township_admin_area_id"]
        loc = item["local_admin_area_id"]
        if loc is not None:
            meta = active.get(loc)
            if not meta or not meta["ok"]:
                item["local_admin_area_id"] = None
                if item["match_status"] == "linked_local_area":
                    item["match_status"] = "linked_township_only" if tsp else "unmatched"
                    item["match_method"] = (item.get("match_method") or "") + "|fk_local_invalid"
            elif tsp is not None and tsp not in ancestor_ids(loc) and loc != tsp:
                # local must sit under the linked township
                item["local_admin_area_id"] = None
                item["match_status"] = "linked_township_only"
                item["match_method"] = (item.get("match_method") or "") + "|local_township_mismatch"
                item["review_reason"] = "Local area does not reach township_admin_area_id; demoted to township-only"

        # Consistency: linked_local requires both FKs
        if item["match_status"] == "linked_local_area" and (
            not item["township_admin_area_id"] or not item["local_admin_area_id"]
        ):
            if item["township_admin_area_id"]:
                item["match_status"] = "linked_township_only"
            else:
                item["match_status"] = "unmatched"

        if item["match_status"] == "linked_township_only" and not item["township_admin_area_id"]:
            item["match_status"] = "unmatched"

        adjusted.append(item)
    return adjusted


def upsert_rows(conn, rows: list[dict[str, Any]], *, dry_run: bool) -> None:
    if dry_run:
        return
    with conn.cursor() as cur:
        cur.execute("DELETE FROM ref.ref_postal_codes")
        cur.executemany(
            """
            INSERT INTO ref.ref_postal_codes (
              postal_code, region_name_en, region_name_my,
              township_name_en, township_name_my,
              locality_name_en, locality_name_my, locality_type,
              township_admin_area_id, local_admin_area_id,
              match_status, match_method, source_name, source_version
            ) VALUES (
              %(postal_code)s, %(region_name_en)s, %(region_name_my)s,
              %(township_name_en)s, %(township_name_my)s,
              %(locality_name_en)s, %(locality_name_my)s, %(locality_type)s,
              %(township_admin_area_id)s, %(local_admin_area_id)s,
              %(match_status)s, %(match_method)s, %(source_name)s, %(source_version)s
            )
            """,
            [
                {
                    "postal_code": r["postal_code"],
                    "region_name_en": r["region_name_en"],
                    "region_name_my": r["region_name_my"],
                    "township_name_en": r["township_name_en"],
                    "township_name_my": r["township_name_my"],
                    "locality_name_en": r["locality_name_en"],
                    "locality_name_my": r["locality_name_my"],
                    "locality_type": r["locality_type"],
                    "township_admin_area_id": r["township_admin_area_id"],
                    "local_admin_area_id": r["local_admin_area_id"],
                    "match_status": r["match_status"],
                    "match_method": r["match_method"],
                    "source_name": r["source_name"],
                    "source_version": r["source_version"],
                }
                for r in rows
            ],
        )
    conn.commit()


def evaluate_postconditions(conn, rows: list[dict[str, Any]]) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass('ref.ref_postal_codes') IS NOT NULL")
        table_exists = bool(cur.fetchone()[0])
        db_count = 0
        db_dupes = 0
        db_invalid = 0
        db_null_status = 0
        local_mismatch = 0
        dead_fk = 0
        if table_exists:
            cur.execute("SELECT count(*) FROM ref.ref_postal_codes")
            db_count = int(cur.fetchone()[0])
            cur.execute(
                """
                SELECT count(*) FROM (
                  SELECT postal_code FROM ref.ref_postal_codes GROUP BY postal_code HAVING count(*) > 1
                ) s
                """
            )
            db_dupes = int(cur.fetchone()[0])
            cur.execute("SELECT count(*) FROM ref.ref_postal_codes WHERE postal_code !~ '^[0-9]{7}$'")
            db_invalid = int(cur.fetchone()[0])
            cur.execute("SELECT count(*) FROM ref.ref_postal_codes WHERE match_status IS NULL OR btrim(match_status) = ''")
            db_null_status = int(cur.fetchone()[0])
            cur.execute(
                """
                SELECT count(*)
                FROM ref.ref_postal_codes p
                WHERE p.local_admin_area_id IS NOT NULL
                  AND p.township_admin_area_id IS NOT NULL
                  AND NOT EXISTS (
                    SELECT 1
                    FROM (
                      WITH RECURSIVE chain AS (
                        SELECT id, parent_id, 0 AS depth
                        FROM core.core_admin_areas
                        WHERE id = p.local_admin_area_id
                        UNION ALL
                        SELECT a.id, a.parent_id, chain.depth + 1
                        FROM core.core_admin_areas a
                        JOIN chain ON a.id = chain.parent_id
                        WHERE chain.depth < 20
                      )
                      SELECT id FROM chain WHERE id = p.township_admin_area_id
                    ) hit
                  )
                """
            )
            local_mismatch = int(cur.fetchone()[0])
            cur.execute(
                """
                SELECT count(*) FROM ref.ref_postal_codes p
                WHERE (p.township_admin_area_id IS NOT NULL AND NOT EXISTS (
                        SELECT 1 FROM core.core_admin_areas a
                        WHERE a.id = p.township_admin_area_id AND a.deleted_at IS NULL AND a.is_active
                      ))
                   OR (p.local_admin_area_id IS NOT NULL AND NOT EXISTS (
                        SELECT 1 FROM core.core_admin_areas a
                        WHERE a.id = p.local_admin_area_id AND a.deleted_at IS NULL AND a.is_active
                      ))
                """
            )
            dead_fk = int(cur.fetchone()[0])

    planned = len(rows)
    status_counts = collections.Counter(r["match_status"] for r in rows)
    return {
        "planned_rows": planned,
        "planned_unique": len({r["postal_code"] for r in rows}),
        "db_rows": db_count,
        "exact_17297_planned": planned == 17297,
        "exact_17297_db": db_count == 17297 if table_exists else None,
        "zero_duplicate_planned": planned == len({r["postal_code"] for r in rows}),
        "zero_duplicate_db": db_dupes == 0 if table_exists else None,
        "zero_invalid_db": db_invalid == 0 if table_exists else None,
        "every_row_has_status": all(r.get("match_status") for r in rows) and db_null_status == 0,
        "local_reaches_township": local_mismatch == 0,
        "active_fks": dead_fk == 0,
        "status_counts": dict(status_counts),
        "table_exists": table_exists,
    }


def write_reports(
    out_dir: Path,
    rows: list[dict[str, Any]],
    rejected: list[dict[str, str]],
    post: dict[str, Any],
    mode: str,
) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    def write_csv(name: str, subset: list[dict[str, Any]], fields: list[str]) -> None:
        path = out_dir / name
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
            writer.writeheader()
            for row in subset:
                writer.writerow(row)

    base_fields = [
        "postal_code", "region_name_en", "region_name_my",
        "township_name_en", "township_name_my",
        "locality_name_en", "locality_name_my", "locality_type",
        "township_admin_area_id", "local_admin_area_id",
        "match_status", "match_method", "review_reason",
    ]
    linked = [r for r in rows if r["match_status"] == "linked_local_area"]
    township_only = [r for r in rows if r["match_status"] == "linked_township_only"]
    review = [r for r in rows if r["match_status"] in {"ambiguous", "unmatched"}]

    write_csv("postal-linked.csv", linked, base_fields)
    write_csv("postal-township-only.csv", township_only, base_fields)
    write_csv("postal-manual-review.csv", review, base_fields)
    write_csv(
        "postal-rejected.csv",
        rejected,
        ["postal_code", "language", "region", "township", "locality", "match_status", "reason"],
    )

    lines = [
        f"# Postal import summary ({mode})",
        "",
        f"- Source: {SOURCE_NAME} {SOURCE_VERSION}",
        f"- Production rows planned: **{len(rows)}**",
        f"- Rejected malformed source rows: **{len(rejected)}** (codes: {sorted({r['postal_code'] for r in rejected})})",
        "- `core.core_addresses.postal_code` was **not** overwritten.",
        "",
        "## Match status counts",
        "",
        "| Status | Count |",
        "|---|---:|",
    ]
    for status, count in sorted(post["status_counts"].items(), key=lambda kv: (-kv[1], kv[0])):
        lines.append(f"| {status} | {count} |")

    lines += [
        "",
        "## Report files",
        "",
        f"- `postal-linked.csv` — {len(linked)} linked_local_area",
        f"- `postal-township-only.csv` — {len(township_only)} linked_township_only",
        f"- `postal-manual-review.csv` — {len(review)} ambiguous/unmatched",
        f"- `postal-rejected.csv` — {len(rejected)} malformed_rejected (not in production table)",
        "",
        "## Postconditions",
        "",
        "| Check | Value | Pass |",
        "|---|---|:---:|",
        f"| exactly 17297 planned | {post['planned_rows']} | {'yes' if post['exact_17297_planned'] else 'no'} |",
        f"| exactly 17297 in DB | {post['db_rows']} | {'yes' if post['exact_17297_db'] else ('n/a' if post['exact_17297_db'] is None else 'no')} |",
        f"| zero duplicate planned | {post['zero_duplicate_planned']} | {'yes' if post['zero_duplicate_planned'] else 'no'} |",
        f"| zero duplicate DB | {post['zero_duplicate_db']} | {'yes' if post['zero_duplicate_db'] else ('n/a' if post['zero_duplicate_db'] is None else 'no')} |",
        f"| zero invalid DB codes | {post['zero_invalid_db']} | {'yes' if post['zero_invalid_db'] else ('n/a' if post['zero_invalid_db'] is None else 'no')} |",
        f"| every row has match_status | {post['every_row_has_status']} | {'yes' if post['every_row_has_status'] else 'no'} |",
        f"| linked local reaches township | {post['local_reaches_township']} | {'yes' if post['local_reaches_township'] else 'no'} |",
        f"| FKs active | {post['active_fks']} | {'yes' if post['active_fks'] else 'no'} |",
        "",
        "## Access",
        "",
        "- Table is RLS-enabled with `REVOKE` from `anon`/`authenticated`.",
        "- Access only through the Fastify API (`GET /postal-codes/:postalCode`).",
        "",
    ]
    (out_dir / "postal-import-summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (out_dir / f"postconditions-{mode}.json").write_text(json.dumps(post, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--postal-actions",
        type=Path,
        default=Path("reports/admin-reconciliation-v2/01-postal-actions.csv"),
    )
    parser.add_argument("--postal-zip", type=Path, required=True)
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--mode", choices=["dry-run", "apply"], default="dry-run")
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("reports/admin-reconciliation-v2/postal-import"),
    )
    parser.add_argument("--allow-production-host", action="store_true")
    args = parser.parse_args()

    if not args.allow_production_host and (
        "supabase.com" in args.database_url or "pooler.supabase" in args.database_url
    ):
        print("Refusing Supabase/production URL without --allow-production-host", file=sys.stderr)
        return 2

    with args.postal_actions.open(encoding="utf-8", newline="") as handle:
        raw_rows = list(csv.DictReader(handle))
    if len(raw_rows) != 17297:
        print(f"Expected 17297 postal actions, got {len(raw_rows)}", file=sys.stderr)
        return 2

    rows = [map_row(r) for r in raw_rows]
    if len({r["postal_code"] for r in rows}) != 17297:
        print("Duplicate postal codes in actions CSV", file=sys.stderr)
        return 2

    rejected = load_rejected_from_zip(args.postal_zip)
    if "114560" not in {r["postal_code"] for r in rejected}:
        print("Expected malformed code 114560 in rejected report", file=sys.stderr)
        return 2

    dry_run = args.mode == "dry-run"
    with connect(args.database_url) as conn:
        conn.autocommit = False
        rows = validate_and_adjust_fks(conn, rows)
        if args.mode == "apply":
            with conn.cursor() as cur:
                cur.execute("SELECT to_regclass('ref.ref_postal_codes')")
                if cur.fetchone()[0] is None:
                    print("ref.ref_postal_codes missing; apply DDL migration first", file=sys.stderr)
                    return 2
            upsert_rows(conn, rows, dry_run=False)
        else:
            conn.rollback()
        post = evaluate_postconditions(conn, rows)

    write_reports(args.out, rows, rejected, post, args.mode)
    print(f"Wrote {args.out} ({args.mode})")
    print(f"Planned {post['planned_rows']} status={post['status_counts']}")
    print(f"DB rows={post['db_rows']} rejected={len(rejected)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
