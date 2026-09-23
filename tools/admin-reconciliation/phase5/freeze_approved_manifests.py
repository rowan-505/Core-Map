#!/usr/bin/env python3
"""Freeze full Phase 3 approved manifests from action CSVs + decision CSVs.

Writes (no database):
  reports/admin-reconciliation-v2/phase3-frozen/03-approved-local-admin.csv
  reports/admin-reconciliation-v2/phase3-frozen/03-approved-villages.csv
  reports/admin-reconciliation-v2/phase3-frozen/03-approved-manifest.checksums.json

Does not require review_decision columns inside the immutable queue CSVs —
decisions are read from 03-*-decisions.csv.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

csv.field_size_limit(min(2**31 - 1, 100_000_000))

REPO = Path(__file__).resolve().parents[3]
REPORTS = REPO / "reports" / "admin-reconciliation-v2"

UNCERTAIN = {"manual_review", "merge_duplicate_candidate", "reject_source_error"}


def clean(v: Any) -> str:
    return "" if v is None else str(v).strip()


def load_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_csv(path: Path, rows: list[dict[str, str]], fields: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for row in rows:
            w.writerow({h: row.get(h, "") for h in fields})


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def source_key_from_action(row: dict[str, str]) -> str:
    entity = clean(row.get("source_entity_type"))
    pcode = clean(row.get("source_pcode")) or "nopcode"
    srow = clean(row.get("source_row"))
    safe_file = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(clean(row.get("source_file"))).name)[:80]
    return f"{entity}:{pcode}:row{srow}:{safe_file}"


def map_decision(decision: str, selected: str) -> tuple[str, str]:
    d = clean(decision)
    sid = clean(selected)
    if d in {"match_existing", "selective_merge", "selective_merge_union"}:
        return ("keep_existing" if sid else ""), sid
    if d in {"create_new", "keep_both"}:
        return "create_mimu_placeholder", ""
    if d == "merge_confirmed_duplicate":
        return "merge_duplicate_candidate", sid
    if d == "reject_source_error":
        return "reject_source_error", ""
    if d == "defer":
        return "defer", ""
    return "", ""


def apply_queue(
    actions: list[dict[str, str]],
    decisions: dict[str, dict[str, str]],
    label: str,
) -> tuple[list[dict[str, str]], list[str]]:
    errors: list[str] = []
    out: list[dict[str, str]] = []
    for row in actions:
        action = clean(row.get("action"))
        key = source_key_from_action(row)
        item = dict(row)
        if action in UNCERTAIN:
            d = decisions.get(key)
            if not d or not clean(d.get("review_decision")):
                errors.append(f"{label}: missing decision for {key}")
                out.append(item)
                continue
            mapped, sid = map_decision(d.get("review_decision", ""), d.get("selected_core_id", ""))
            if not mapped:
                errors.append(f"{label}: cannot map decision for {key}")
            item["action"] = mapped
            item["matched_coremap_id"] = sid
            item["review_decision"] = clean(d.get("review_decision"))
            item["review_note"] = clean(d.get("review_note"))
            item["losing_core_ids"] = clean(d.get("losing_core_ids"))
            item["name_source"] = clean(d.get("name_source"))
            item["geometry_policy"] = clean(d.get("geometry_policy"))
            item["preserve_existing_geom"] = "true"
        out.append(item)
    return out, errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reports", type=Path, default=REPORTS)
    parser.add_argument("--allow-errors", action="store_true")
    args = parser.parse_args()

    local_dec = {
        clean(r.get("review_id") or r.get("source_key")): r
        for r in load_csv(args.reports / "03-local-admin-decisions.csv")
    }
    village_dec = {
        clean(r.get("review_id") or r.get("source_key")): r
        for r in load_csv(args.reports / "03-village-decisions.csv")
    }
    merge_dec = load_csv(args.reports / "03-merge-decisions.csv")

    local_actions = load_csv(args.reports / "02-local-admin-actions.csv")
    village_actions = load_csv(args.reports / "02-village-actions.csv")

    final_local, err_l = apply_queue(local_actions, local_dec, "local")
    final_village, err_v = apply_queue(village_actions, village_dec, "village")
    errors = err_l + err_v

    # Attach merge loser map for consumers
    for d in merge_dec:
        if clean(d.get("review_decision")) != "merge_confirmed_duplicate":
            continue
        # annotate matching local rows by survivor id when present
        surv = clean(d.get("selected_core_id"))
        losers = clean(d.get("losing_core_ids"))
        for row in final_local:
            if clean(row.get("matched_coremap_id")) == surv and surv:
                row["merge_losing_core_ids"] = losers
                row["merge_source_key"] = clean(d.get("source_key") or d.get("review_id"))

    if errors and not args.allow_errors:
        print(f"FREEZE FAILED: {len(errors)} errors")
        for e in errors[:30]:
            print(" ", e)
        return 1

    frozen = args.reports / "phase3-frozen"
    frozen.mkdir(parents=True, exist_ok=True)

    local_fields = list(final_local[0].keys()) if final_local else ["action"]
    for col in (
        "review_decision",
        "review_note",
        "losing_core_ids",
        "name_source",
        "geometry_policy",
        "merge_losing_core_ids",
        "merge_source_key",
    ):
        if col not in local_fields:
            local_fields.append(col)
    village_fields = list(final_village[0].keys()) if final_village else ["action"]
    for col in ("review_decision", "review_note", "losing_core_ids"):
        if col not in village_fields:
            village_fields.append(col)

    local_path = frozen / "03-approved-local-admin.csv"
    village_path = frozen / "03-approved-villages.csv"
    write_csv(local_path, final_local, local_fields)
    write_csv(village_path, final_village, village_fields)

    # Also copy Phase 4 postal actions into phase5 frozen pointer
    postal_src = args.reports / "04-postal-actions.csv"
    postal_dst = frozen / "04-postal-actions.frozen.csv"
    if postal_src.exists():
        postal_dst.write_bytes(postal_src.read_bytes())

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    checksums = {
        "generated_at": ts,
        "production_writes": False,
        "validation": "passed_with_decision_csvs" if not errors else "passed_with_errors_allowed",
        "error_count": len(errors),
        "files": {
            str(local_path.relative_to(args.reports)): {
                "sha256": sha256_file(local_path),
                "rows": len(final_local),
            },
            str(village_path.relative_to(args.reports)): {
                "sha256": sha256_file(village_path),
                "rows": len(final_village),
            },
        },
        "counts": {
            "local_by_action": dict(Counter(r.get("action") for r in final_local)),
            "village_by_action": dict(Counter(r.get("action") for r in final_village)),
            "wards": sum(1 for r in final_local if r.get("source_entity_type") == "ward"),
            "village_tracts": sum(
                1 for r in final_local if r.get("source_entity_type") == "village_tract"
            ),
            "villages": len(final_village),
            "merge_decisions": len(merge_dec),
        },
    }
    if postal_dst.exists():
        checksums["files"][str(postal_dst.relative_to(args.reports))] = {
            "sha256": sha256_file(postal_dst),
            "rows": sum(1 for _ in postal_dst.open(encoding="utf-8")) - 1,
        }

    (frozen / "03-approved-manifest.checksums.json").write_text(
        json.dumps(checksums, indent=2) + "\n", encoding="utf-8"
    )
    report = [
        "# Phase 3 full freeze (for Phase 5)",
        "",
        f"**Generated:** {ts}",
        "**Production writes:** none",
        "",
        f"- Local rows: {len(final_local)}",
        f"- Village rows: {len(final_village)}",
        f"- Errors: {len(errors)}",
        "",
        "## Local actions",
        "",
    ]
    for a, n in sorted(checksums["counts"]["local_by_action"].items()):
        report.append(f"- `{a}`: **{n}**")
    report += ["", "## Village actions", ""]
    for a, n in sorted(checksums["counts"]["village_by_action"].items()):
        report.append(f"- `{a}`: **{n}**")
    report.append("")
    (frozen / "03-validation-report.md").write_text("\n".join(report) + "\n", encoding="utf-8")
    print(f"Froze {local_path}")
    print(f"Froze {village_path}")
    print(json.dumps(checksums["counts"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
