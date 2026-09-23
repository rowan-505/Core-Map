# 01 Empty-PCode Pangsang village-tract audit

Generated: `2026-09-21T16:34:01Z`  
Scope: remaining-source audit only  
Production: **not touched**  
Disposable evidence DB: `coremap_phase7_v2` / schema `phase7_v3_audit`

## Decision

**`reject_source_error`** (confidence 95/100)

Empty PCode alone does **not** cause this rejection.

## Source identity

| Field | Value |
|---|---|
| Nationwide `source_row` | `12402` |
| Shan shapefile layer row | `806` |
| `source_file` | `village_tract_boundary_Shan_v94.zip:mmr_shn_polbnda_adm4_250k_mimu_1.shp` |
| `source_pcode` / VT_PCODE | *(empty)* |
| `name_en` / VT | *(empty)* |
| `name_my` / VT_MMR | *(empty)* |
| Normalized EN / MY | *(empty)* / *(empty)* |
| Type | `village_tract` |
| Parent township | `MMR015005` Pangsang (Panghkam) / ပန်ဆန်း (ပန်ခမ်း) |
| MIMU Remark | **No VT info** |
| SELF_ADMIN | Wa |
| Local audit `source_key` | `village_tract:nopcode:row12402:village_tract_boundary_Shan_v94.zip_mmr_shn_polbnda_adm4_250k_mimu_1.shp:geom:701aa2d8c5d389ea` |

Audit key is local only. Do **not** store it as `external_id` or as a MIMU PCode.

## Validation checklist

| Check | Result |
|---|---|
| Source name identifiable | **FAIL** (EN and MY empty) |
| Source type | **PASS** (`village_tract`) |
| Parent township | **PASS** (`MMR015005` / Pangsang) |
| Geometry non-null / non-empty / valid | **PASS** (`ST_MultiPolygon`, area ≈ 448854905 m²) |
| Within / intersects Pangsang | **PASS** (intersects; overlap_of_source ≈ 1.000000) |
| Duplication vs other Pangsang VTs | **PASS / not duplicate** (exact geom hash dups = 0; real >1 m² overlaps = 0; max inter ≈ 6.879879e-05 m²) |
| Source row hash | `bc073e9e026adb9b5d492b3a2fd12aaefaacf2944321c70cc79f37d85ba22153` |
| Geometry hash | `701aa2d8c5d389ea37e9bf961fd1f541bc02a085221216f6747620d3dd659de4` |

## Spatial reading

This polygon is the **unnamed residual gap** of MIMU Pangsang after subtracting the 87 named village tracts:

- target covers gap ≈ `0.9999991796`
- gap covers target ≈ `0.9999997825`
- township coverage by this polygon ≈ `0.1428` (~14%)

Sibling intersections are floating-point boundary noise only.

## Why each option

| Option | Chosen? | Why |
|---|---|---|
| `create_new` | No | Rule requires identifiable name; both names empty. No `public_id` / slug assigned. |
| `source_duplicate` | No | Does not exactly duplicate any other Pangsang VT identity or geometry. |
| `reject_source_error` | **Yes** | Source feature itself is invalid as a VT: Remark=`No VT info`, no name, no PCode. |
| `manual_review` | No | Identity is not uncertain — MIMU states there is no VT info. |

## Outputs

- `01-empty-pcode-vt-decision.csv`
- `01-empty-pcode-vt-preview/` (`source_row12402.geojson`, `township_MMR015005.geojson`, `overlay.geojson`, `metrics.json`, `sibling_intersections.csv`)
- `01-empty-pcode-vt-summary.md`

## Stop condition

Identity is **not** uncertain. Audit complete. No production apply. No further import steps from this task.
