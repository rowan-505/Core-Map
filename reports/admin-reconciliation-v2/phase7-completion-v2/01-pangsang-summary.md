# 01 Pangsang / Panghkam township review

Generated: `2026-09-21T15:13:49Z`  
Database: disposable `coremap_phase7_backup_restore` (pre-Phase-7 baseline)  
Production: **not touched**

## Verdict (stop for decision)

**Proposed decision for source township `MMR015005` / Pangsang (Panghkam): `manual_review`**

Identity is **uncertain**. Do **not** treat CoreMap `6484` as a certain match.

| Option | Allowed? | Recommendation |
|---|---|---|
| `match_existing_township` → 6484 | No (not unique / wrong OSM identity) | Reject this option |
| `create_missing_township_placeholder` | Plausible | **Recommended leaning** if you approve creating a large GAD-era township over Wa OSM subdivisions |
| `reject_invalid_source_parent` | No | MIMU parent is not a source error |
| `manual_review` | **Selected** | Wait for your decision |

## Why 6484 is not a safe match

- Canonical/official names on `6484` currently say **Pangsang (Panghkam) / ပန်ဆန်း (ပန်ခမ်း)**.
- The same row still carries **Man Man Hsai / မန်မန်ဆိုင်** aliases and OSM tags for **Manshiang** (`osm:R:14035205`, wikidata `Q65340655`).
- MIMU township area ≈ **3148 km²**. CoreMap `6484` ≈ **627 km²** and covers only ≈ **0.20** of MIMU Pangsang.
- Nearby Wa townships (`6487`, `6469`, `6472`, `6473`, …) each also cover ≈ **0.15–0.20** of MIMU Pangsang. No unique containment.
- A separate CoreMap township `6469` already exists as **Pangkham Special Township**.

## Hierarchy

| Side | Path |
|---|---|
| MIMU | Shan (North) → Matman (`MMR015D007`) → Pangsang (Panghkam) (`MMR015005`) |
| CoreMap 6484 | Shan → Matman district → canonical `ပန်ဆန်း (ပန်ခမ်း)` (OSM Manshiang) |
| CoreMap 6469 | Shan → Matman district → Pangkham Special Township |

Source parent PCode audit key: **`MMR015005`** (do not store as production `external_id`).

## Dependent children blocked today

- Frozen VT creates under this township: **88**
- Of those with empty `approved_township_id`: **88**
- These are the ~88 Shan North skips from Phase 6/7 dry-run.

## Candidate metrics (overlap with MIMU township)

| core_id | canonical | overlap_of_mimu | overlap_of_core | centroid_m | parent |
|---:|---|---:|---:|---:|---|
| 6484 | ပန်ဆန်း (ပန်ခမ်း) | 0.1988 | 0.9977 | 20827.9 | မက်မန်းခရိုင် |
| 6487 | ကလောင်ဖာမြို့နယ် | 0.157 | 0.9986 | 28013.7 | မက်မန်းခရိုင် |
| 6469 | ပန်ခမ်းအထူးမြို့နယ် | 0.17 | 0.9852 | 36527.2 | မက်မန်းခရိုင် |
| 6486 | လင်ဟော်မြို့နယ် | 0.0936 | 0.4172 | 29860.4 | မက်မန်းခရိုင် |
| 6472 | နောင်ခစ်မြို့နယ် | 0.1758 | 0.8594 | 12886.7 | မိုင်းလင်းခရိုင် |
| 6473 | နားကောင်းမြို့နယ် | 0.2034 | 0.998 | 19330.4 | မိုင်းလင်းခရိုင် |
| 6328 | မက်မန်း | 0.0002 | 0.0002 | 64437.8 | မက်မန်းခရိုင် |


## Artifacts

- `01-pangsang-township-review.csv`
- `01-pangsang-child-vt-inventory.csv`
- `01-pangsang-map-preview/mimu_MMR015005.geojson`
- `01-pangsang-map-preview/core_*.geojson`
- `01-pangsang-map-preview/overlay_candidates.geojson`
- `01-pangsang-map-preview/candidate_metrics.json`
- Child VT previews copied: **11**

## Decision needed from you

Reply with exactly one for `MMR015005`:

1. `match_existing_township` + core public_id/id (only if you override the evidence)
2. `create_missing_township_placeholder` (and confirm Matman district parent)
3. `reject_invalid_source_parent`
4. `manual_review` remains open (no v2 manifest progress for these 88 VTs)

Until that decision, Phase 7 completion-v2 **stops before revised manifests**.
