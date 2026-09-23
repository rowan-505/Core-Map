#!/usr/bin/env python3
"""Phase 3: validate filled review decisions and freeze full approved manifests.

Run after humans fill:
  - reports/admin-reconciliation-v2/03-local-admin-review-queue.csv
  - reports/admin-reconciliation-v2/03-village-review-queue.csv

Does not write to PostgreSQL.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

csv.field_size_limit(min(2**31 - 1, 100_000_000))

REVIEW_DECISIONS = {
    "match_existing",
    "create_new",
    "keep_both",
    "merge_confirmed_duplicate",
    "reject_source_error",
    "defer",
}

CERTAIN_ACTIONS = {
    "keep_existing",
    "update_names",
    "update_type",
    "update_parent",
    "update_names_and_type",
    "create_mimu_placeholder",
}

UNCERTAIN_ACTIONS = {"manual_review", "merge_duplicate_candidate", "reject_source_error"}


def clean(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def load_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in fieldnames})


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def compact_identity(name_en: str, name_my: str, parent: str, entity_type: str) -> str:
    def norm(text: str) -> str:
        t = unicodedata.normalize("NFKC", clean(text)).casefold()
        t = re.sub(r"[^0-9a-z\u1000-\u109f\uaa60-\uaa7f\ua9e0-\ua9ff]+", "", t)
        return t
    return f"{entity_type}|{norm(parent)}|{norm(name_my)}|{norm(name_en)}"


def map_decision_to_action(decision: str, selected_core_id: str) -> tuple[str, str]:
    """Return (final_action, matched_coremap_id)."""
    d = clean(decision)
    sid = clean(selected_core_id)
    if d == "match_existing":
        return "keep_existing" if sid else "", sid
    if d == "create_new":
        return "create_mimu_placeholder", ""
    if d == "keep_both":
        # Extra CoreMap allowed: create source placeholder and leave Core candidates untouched.
        return "create_mimu_placeholder", ""
    if d == "merge_confirmed_duplicate":
        return "merge_duplicate_candidate", sid
    if d == "reject_source_error":
        return "reject_source_error", ""
    if d == "defer":
        return "defer", ""
    return "", ""


def source_key_from_action(row: dict[str, str]) -> str:
    entity = clean(row.get("source_entity_type"))
    pcode = clean(row.get("source_pcode")) or "nopcode"
    srow = clean(row.get("source_row"))
    safe_file = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(clean(row.get("source_file"))).name)[:80]
    return f"{entity}:{pcode}:row{srow}:{safe_file}"


def validate_and_freeze(out_dir: Path) -> int:
    local_actions = load_csv(out_dir / "02-local-admin-actions.csv")
    village_actions = load_csv(out_dir / "02-village-actions.csv")
    local_queue = load_csv(out_dir / "03-local-admin-review-queue.csv")
    village_queue = load_csv(out_dir / "03-village-review-queue.csv")
    merge_plans = load_csv(out_dir / "03-merge-repoint-plans.csv") if (out_dir / "03-merge-repoint-plans.csv").exists() else []

    errors: list[str] = []

    def check_queue(queue: list[dict[str, str]], label: str) -> dict[str, dict[str, str]]:
        by_key: dict[str, dict[str, str]] = {}
        for row in queue:
            key = clean(row.get("source_key"))
            if not key:
                errors.append(f"{label}: missing source_key")
                continue
            if key in by_key:
                errors.append(f"{label}: duplicate source_key {key}")
            decision = clean(row.get("review_decision"))
            if not decision:
                errors.append(f"{label}: empty review_decision for {key}")
                continue
            if decision not in REVIEW_DECISIONS:
                errors.append(f"{label}: invalid review_decision={decision!r} for {key}")
            if decision == "defer":
                errors.append(f"{label}: unresolved defer for {key} (blocks production completion)")
            if decision in {"match_existing", "merge_confirmed_duplicate"} and not clean(row.get("selected_core_id")):
                errors.append(f"{label}: {decision} requires selected_core_id for {key}")
            if decision == "merge_confirmed_duplicate":
                cands = {x for x in clean(row.get("candidate_core_ids")).split(";") if x}
                if clean(row.get("selected_core_id")) not in cands:
                    errors.append(f"{label}: selected_core_id not in candidates for {key}")
            by_key[key] = row
        return by_key

    local_by_key = check_queue(local_queue, "local-admin-queue")
    village_by_key = check_queue(village_queue, "village-queue")

    # Apply decisions onto full action lists.
    final_local: list[dict[str, str]] = []
    final_village: list[dict[str, str]] = []

    for row in local_actions:
        action = clean(row.get("action"))
        key = source_key_from_action(row)
        out = dict(row)
        if action in UNCERTAIN_ACTIONS:
            q = local_by_key.get(key)
            if not q:
                errors.append(f"local action missing review queue row: {key}")
                final_local.append(out)
                continue
            final_action, matched_id = map_decision_to_action(q.get("review_decision", ""), q.get("selected_core_id", ""))
            if not final_action:
                errors.append(f"local cannot map decision for {key}")
            out["action"] = final_action
            out["matched_coremap_id"] = matched_id
            out["review_decision"] = clean(q.get("review_decision"))
            out["review_note"] = clean(q.get("review_note"))
            out["preserve_existing_geom"] = "true"
        final_local.append(out)

    for row in village_actions:
        action = clean(row.get("action"))
        key = source_key_from_action(row)
        out = dict(row)
        if action in UNCERTAIN_ACTIONS:
            q = village_by_key.get(key)
            if not q:
                errors.append(f"village action missing review queue row: {key}")
                final_village.append(out)
                continue
            final_action, matched_id = map_decision_to_action(q.get("review_decision", ""), q.get("selected_core_id", ""))
            if not final_action:
                errors.append(f"village cannot map decision for {key}")
            out["action"] = final_action
            out["matched_coremap_id"] = matched_id
            out["review_decision"] = clean(q.get("review_decision"))
            out["review_note"] = clean(q.get("review_note"))
            out["preserve_existing_geom"] = "true"
        final_village.append(out)

    # Every source ward / VT / village has exactly one final action.
    wards = [r for r in final_local if r.get("source_entity_type") == "ward"]
    vts = [r for r in final_local if r.get("source_entity_type") == "village_tract"]
    villages = list(final_village)

    def assert_one_action(rows: list[dict[str, str]], label: str) -> None:
        if len(local_actions if label != "village" else village_actions) != len(rows) and label == "village":
            pass
        missing = [r for r in rows if not clean(r.get("action")) or clean(r.get("action")) == "defer"]
        for r in missing:
            errors.append(f"{label}: missing/defer final action for {source_key_from_action(r)}")
        # uniqueness of source_key
        keys = [source_key_from_action(r) for r in rows]
        dup = [k for k, n in Counter(keys).items() if n > 1]
        for k in dup:
            errors.append(f"{label}: source_key appears more than once: {k}")

    assert_one_action(wards, "ward")
    assert_one_action(vts, "village_tract")
    assert_one_action(villages, "village")

    if len(wards) + len(vts) != len(final_local):
        errors.append("local final row count mismatch vs wards+village_tracts")
    if len(villages) != len(village_actions):
        errors.append("village final row count mismatch")

    # No source maps to multiple CoreMap rows.
    def check_single_core_map(rows: list[dict[str, str]], label: str) -> None:
        for r in rows:
            matched = clean(r.get("matched_coremap_id"))
            if ";" in matched or "," in matched:
                errors.append(f"{label}: source maps to multiple cores: {source_key_from_action(r)} -> {matched}")

    check_single_core_map(final_local, "local")
    check_single_core_map(final_village, "village")

    # Also: same CoreMap id should not be claimed by two match_existing/merge sources? 
    # keep_both allows extras; multiple sources matching same core can happen for true dups — flag merges only.
    core_owners: dict[str, list[str]] = defaultdict(list)
    for r in final_local + final_village:
        if clean(r.get("action")) in {"keep_existing", "update_names", "update_type", "update_parent", "update_names_and_type", "merge_duplicate_candidate"}:
            mid = clean(r.get("matched_coremap_id"))
            if mid:
                core_owners[mid].append(source_key_from_action(r))
    # Informational only unless identical source keys — multiple sources to one core is review territory.
    # Hard fail if one source somehow listed multiple matched IDs (already checked).

    # No two create actions represent the same identity.
    create_identities: dict[str, list[str]] = defaultdict(list)
    for r in final_local + final_village:
        if clean(r.get("action")) != "create_mimu_placeholder":
            continue
        ident = compact_identity(
            clean(r.get("source_name_en")),
            clean(r.get("source_name_my")),
            clean(r.get("source_parent_path") or r.get("source_ts_pcode")),
            clean(r.get("source_entity_type")),
        )
        create_identities[ident].append(source_key_from_action(r))
    for ident, keys in create_identities.items():
        parts = ident.split("|")
        # parts: entity|parent|my|en
        if len(keys) > 1 and len(parts) >= 4 and (parts[2] or parts[3]):
            errors.append(f"duplicate create identity {ident}: {keys[:5]}")

    # Merge plans: if merge_confirmed_duplicate used, require hard_delete=false preserved.
    for plan in merge_plans:
        if clean(plan.get("review_decision")) == "merge_confirmed_duplicate" or True:
            if clean(plan.get("hard_delete")).lower() == "true":
                errors.append(f"merge plan hard_delete=true forbidden for {plan.get('source_key')}")

    frozen_dir = out_dir / "phase3-frozen"
    frozen_dir.mkdir(parents=True, exist_ok=True)
    report_path = frozen_dir / "03-validation-report.md"

    if errors:
        report = [
            "# Phase 3 validation FAILED",
            "",
            f"**Generated:** {datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}",
            "",
            f"Errors: **{len(errors)}**",
            "",
        ]
        for err in errors[:200]:
            report.append(f"- {err}")
        if len(errors) > 200:
            report.append(f"- ... and {len(errors) - 200} more")
        report_path.write_text("\n".join(report) + "\n", encoding="utf-8")
        print(f"VALIDATION FAILED: {len(errors)} errors — see {report_path}")
        for err in errors[:20]:
            print(" ", err)
        return 1

    # Success: freeze full manifests.
    local_fields = list(final_local[0].keys()) if final_local else ["action"]
    village_fields = list(final_village[0].keys()) if final_village else ["action"]
    # Ensure review columns exist
    for col in ("review_decision", "review_note"):
        if col not in local_fields:
            local_fields.append(col)
        if col not in village_fields:
            village_fields.append(col)

    local_path = frozen_dir / "03-approved-local-admin.csv"
    village_path = frozen_dir / "03-approved-villages.csv"
    write_csv(local_path, final_local, local_fields)
    write_csv(village_path, final_village, village_fields)

    checksums = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "production_writes": False,
        "validation": "passed",
        "files": {
            str(local_path.relative_to(out_dir)): {
                "sha256": sha256_file(local_path),
                "rows": len(final_local),
            },
            str(village_path.relative_to(out_dir)): {
                "sha256": sha256_file(village_path),
                "rows": len(final_village),
            },
        },
        "counts": {
            "wards": len(wards),
            "village_tracts": len(vts),
            "villages": len(villages),
            "local_by_action": dict(Counter(r["action"] for r in final_local)),
            "village_by_action": dict(Counter(r["action"] for r in final_village)),
        },
        "rules": {
            "defer_blocks_completion": True,
            "hard_delete_forbidden": True,
            "preserve_survivor_geometry": True,
            "keep_both_allowed": True,
        },
    }
    checksum_path = frozen_dir / "03-approved-manifest.checksums.json"
    # Keep certain-only checksums timestamped backup if present.
    certain_checksum = frozen_dir / "03-approved-manifest.checksums.certain.json"
    existing = frozen_dir / "03-approved-manifest.checksums.json"
    if existing.exists() and "certain" in existing.read_text():
        certain_checksum.write_text(existing.read_text(), encoding="utf-8")
    checksum_path.write_text(json.dumps(checksums, indent=2) + "\n", encoding="utf-8")

    report = [
        "# Phase 3 validation PASSED",
        "",
        f"**Generated:** {checksums['generated_at']}",
        "**Production writes:** none",
        "",
        "## Final counts",
        "",
        f"- Wards: {len(wards)}",
        f"- Village tracts: {len(vts)}",
        f"- Villages: {len(villages)}",
        "",
        "## Local actions",
        "",
    ]
    for action, n in sorted(checksums["counts"]["local_by_action"].items()):
        report.append(f"- {action}: {n}")
    report += ["", "## Village actions", ""]
    for action, n in sorted(checksums["counts"]["village_by_action"].items()):
        report.append(f"- {action}: {n}")
    report += [
        "",
        "## Frozen files",
        "",
        f"- `{local_path.relative_to(out_dir)}` sha256={checksums['files'][str(local_path.relative_to(out_dir))]['sha256']}",
        f"- `{village_path.relative_to(out_dir)}` sha256={checksums['files'][str(village_path.relative_to(out_dir))]['sha256']}",
        "",
        "No unresolved defer. No production writes.",
        "",
    ]
    report_path.write_text("\n".join(report), encoding="utf-8")
    print(f"VALIDATION PASSED — frozen manifests in {frozen_dir}")
    return 0


def parse_args() -> argparse.Namespace:
    repo = Path(__file__).resolve().parents[2]
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--out-dir", type=Path, default=repo / "reports/admin-reconciliation-v2")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    return validate_and_freeze(args.out_dir)


if __name__ == "__main__":
    raise SystemExit(main())
