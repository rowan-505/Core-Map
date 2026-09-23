# Phase 3 — CSV review workflow (no app, no DB tables)

**Generated:** 2026-09-21T07:42:14Z
**Production writes:** none

## What to fill

1. `03-local-admin-review-queue.csv`
2. `03-village-review-queue.csv`
3. Optional: confirm/adjust `03-merge-repoint-plans.csv` for merge cases

Leave geometry preview paths as-is. Fill:

- `review_decision` — one of: `match_existing`, `selective_merge`, `create_new`, `keep_both`,
  `merge_confirmed_duplicate`, `reject_source_error`, `defer`
- `selected_core_id` — required for `match_existing`, `selective_merge`, and `merge_confirmed_duplicate`
- `name_source` — for `selective_merge` only: `coremap` or `mimu`
- `geometry_policy` — for `selective_merge` only: `coremap`, `mimu`, or `union`
- `review_note` — optional for all decisions

`selective_merge`: same place as selected CoreMap; reviewer chooses **which name** and
**which geometry** (including union). Recorded as decision intent only
(viewer does not write production geometry yet).

## Decision rules

- `defer` blocks production completion.
- `keep_both` is allowed (extra CoreMap data is OK).
- Merge only when identity is proven (`merge_confirmed_duplicate`).
- Never hard-delete duplicates; use the repoint plan + soft-retire.
- Survivor keeps CoreMap geometry/point.

Uncertain local-admin rows: **253**  
Uncertain village rows: **2627**  
Merge repoint plans: **1487**

## Already frozen (certain actions only)

See `phase3-frozen/03-approved-*.certain.csv` and `03-approved-manifest.checksums.json`.

- Local certain rows: 15923
- Village certain rows: 51975
- Pending local review: 253
- Pending village review: 2627

## Visual review viewer (local only)

Start the local viewer (does not touch production or the database):

```bash
cd tools/admin-reconciliation/phase3-viewer
npm install
npm run dev
```

Open: [http://localhost:5188](http://localhost:5188)

### How to review

1. Use tabs **Local admin**, **Villages**, **Merge plans**.
2. Search/filter the left queue (Myanmar/English name, township, source key, undecided only).
3. Compare geometries on the centre map (orange = MIMU source, blue = candidates, green = selected).
4. Pick a candidate card, choose a decision, add a note when required, then **Save decision**.
5. Progress restores from decision CSVs on restart. Queue CSVs stay immutable.

### Decision files (written by the viewer)

- `03-local-admin-decisions.csv`
- `03-village-decisions.csv`
- `03-merge-decisions.csv`

### Validate from the viewer

Click **Validate decisions** (or call `POST /api/validate`). Writes:

- `03-decision-validation.md`

Approved import manifests are **not** produced by the viewer. After validation has zero blocking errors, run:

```bash
python3 tools/admin-reconciliation/phase3_validate_and_freeze.py
```

(only after decision columns / decision CSVs are complete)

Keyboard: `1–9` select candidate · `E/U/N/K/M/R/D` decisions · `←/→` prev/next undecided.
