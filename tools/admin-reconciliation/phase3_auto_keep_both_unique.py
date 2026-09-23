#!/usr/bin/env python3
"""Auto keep_both for clear unique Phase 3 review rows (local + village).

Matches the human pattern observed in 03-local-admin-decisions.csv:
  - 1 CoreMap candidate
  - recommended_action = manual_review
  - name evidence = no_exact_name
  - weak spatial link (local: overlap < 5%; village: distance > 200 m)

Does NOT touch merge plans, exact-name rows, or multi-candidate merge cases.
Writes only into decision CSVs (queues stay immutable).
"""

from __future__ import annotations

import csv
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
REPORTS = REPO / "reports" / "admin-reconciliation-v2"

HEADERS = [
    "review_id",
    "source_key",
    "review_decision",
    "selected_core_id",
    "losing_core_ids",
    "name_source",
    "geometry_policy",
    "review_note",
    "updated_at",
]

NOTE = "auto: unique weak-link (no_exact_name + 1 cand + weak spatial) → keep_both"


def load_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def atomic_write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    tmp = Path(tmp_name)
    try:
        with open(fd, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=HEADERS, extrasaction="ignore")
            w.writeheader()
            for row in rows:
                w.writerow({h: row.get(h, "") for h in HEADERS})
        tmp.replace(path)
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)


def normalize_decision(row: dict[str, str]) -> dict[str, str]:
    return {
        "review_id": row.get("review_id") or row.get("source_key") or "",
        "source_key": row.get("source_key") or row.get("review_id") or "",
        "review_decision": row.get("review_decision") or "",
        "selected_core_id": row.get("selected_core_id") or "",
        "losing_core_ids": row.get("losing_core_ids") or "",
        "name_source": row.get("name_source") or "",
        "geometry_policy": row.get("geometry_policy") or "",
        "review_note": row.get("review_note") or "",
        "updated_at": row.get("updated_at") or "",
    }


def parse_floats(raw: str) -> list[float]:
    out: list[float] = []
    for part in (raw or "").split(";"):
        part = part.strip()
        if not part:
            continue
        try:
            out.append(float(part))
        except ValueError:
            pass
    return out


def candidate_ids(row: dict[str, str]) -> list[str]:
    return [x.strip() for x in (row.get("candidate_core_ids") or "").split(";") if x.strip()]


def is_unique_keep_both(row: dict[str, str], kind: str) -> bool:
    ids = candidate_ids(row)
    if len(ids) != 1:
        return False
    if (row.get("recommended_action") or "").strip() != "manual_review":
        return False
    ev = (row.get("name_evidence") or "").strip().lower()
    if "no_exact_name" not in ev:
        return False
    # Exact-name signals elsewhere → not unique
    if "exact" in ev and "no_exact" not in ev.split(",")[0]:
        # e.g. exact_my+en without no_exact
        if not ev.startswith("no_exact"):
            return False

    overlaps = parse_floats(row.get("overlap_percent") or "")
    dists = parse_floats(row.get("distance_m") or "")
    max_ov = max(overlaps) if overlaps else 0.0
    min_dist = min(dists) if dists else None

    if kind == "local":
        # Polygons: require very weak overlap (matches reviewer keep_both median 0%)
        return max_ov < 5.0
    # Villages: points — require far candidate
    if min_dist is None:
        return False
    return min_dist > 200.0


def is_create_new_no_candidate(row: dict[str, str]) -> bool:
    if candidate_ids(row):
        return False
    return (row.get("recommended_action") or "").strip() == "manual_review"


def apply_queue(
    kind: str,
    queue_path: Path,
    decision_path: Path,
) -> tuple[int, int, int, list[dict[str, str]]]:
    queue = load_csv(queue_path)
    existing = [normalize_decision(r) for r in load_csv(decision_path)]
    by_id = {r["review_id"]: r for r in existing if r["review_id"]}
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    added_keep = 0
    added_create = 0
    for row in queue:
        key = row.get("source_key") or ""
        if not key:
            continue
        prev = by_id.get(key)
        if prev and prev.get("review_decision"):
            continue
        if is_create_new_no_candidate(row):
            by_id[key] = {
                "review_id": key,
                "source_key": key,
                "review_decision": "create_new",
                "selected_core_id": "",
                "losing_core_ids": "",
                "name_source": "",
                "geometry_policy": "",
                "review_note": "auto: no CoreMap candidate → create_new",
                "updated_at": now,
            }
            added_create += 1
            continue
        if is_unique_keep_both(row, kind):
            ids = candidate_ids(row)
            by_id[key] = {
                "review_id": key,
                "source_key": key,
                "review_decision": "keep_both",
                "selected_core_id": ids[0] if ids else "",
                "losing_core_ids": "",
                "name_source": "",
                "geometry_policy": "",
                "review_note": NOTE,
                "updated_at": now,
            }
            added_keep += 1

    undecided_remaining = [
        r
        for r in queue
        if r.get("source_key")
        and not (by_id.get(r["source_key"]) or {}).get("review_decision")
    ]

    atomic_write_csv(decision_path, list(by_id.values()))
    return added_keep, added_create, len(undecided_remaining), undecided_remaining


def summarize_remaining(kind: str, rows: list[dict[str, str]]) -> str:
    lines = [f"## Remaining {kind} needing judgment: **{len(rows)}**", ""]
    for r in rows[:40]:
        ids = candidate_ids(r)
        ovs = parse_floats(r.get("overlap_percent") or "")
        dists = parse_floats(r.get("distance_m") or "")
        lines.append(
            "- "
            f"{r.get('entity_type','')} · {r.get('source_name_en') or r.get('source_name_mm') or r.get('source_key','')[:48]} · "
            f"cand={len(ids)} · action={r.get('recommended_action','')} · "
            f"evidence={r.get('name_evidence','')[:48]} · "
            f"overlap={max(ovs) if ovs else '—'} · dist={min(dists) if dists else '—'} m"
        )
    if len(rows) > 40:
        lines.append(f"- … and {len(rows) - 40} more")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    local_keep, local_create, local_left, local_rem = apply_queue(
        "local",
        REPORTS / "03-local-admin-review-queue.csv",
        REPORTS / "03-local-admin-decisions.csv",
    )
    village_keep, village_create, village_left, village_rem = apply_queue(
        "village",
        REPORTS / "03-village-review-queue.csv",
        REPORTS / "03-village-decisions.csv",
    )

    md = "\n".join(
        [
            "# Phase 3 auto-decisions for unique / no-candidate rows",
            "",
            f"**Generated:** {datetime.now(timezone.utc).isoformat()}",
            "**Production writes:** none",
            "",
            "## Applied",
            "",
            f"- Local `keep_both` (unique weak-link): **{local_keep}**",
            f"- Local `create_new` (no candidate): **{local_create}**",
            f"- Village `keep_both` (unique weak-link): **{village_keep}**",
            f"- Village `create_new` (no candidate): **{village_create}**",
            f"- Merge plans: **not touched**",
            "",
            "## Still need human review",
            "",
            f"- Local remaining undecided: **{local_left}**",
            f"- Village remaining undecided: **{village_left}**",
            f"- Merge plans: leave for judgment",
            "",
            "Rules:",
            "- `keep_both`: 1 candidate + `manual_review` + `no_exact_name` + weak spatial",
            "  (local overlap < 5%, village distance > 200 m)",
            "- `create_new`: 0 candidates + `manual_review`",
            "",
            summarize_remaining("local", local_rem),
            summarize_remaining("village", village_rem),
        ]
    )
    out = REPORTS / "03-auto-keep-both-unique.md"
    out.write_text(md, encoding="utf-8")
    print(md)
    print(f"Wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
