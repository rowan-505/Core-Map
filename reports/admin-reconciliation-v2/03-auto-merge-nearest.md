# Phase 3 — auto merge nearest to MIMU

**Generated:** 2026-09-21T11:26:53.444Z

## Policy

1. Survivor = CoreMap nearest to MIMU.
2. Other CoreMaps in the plan = losers (`merge_confirmed_duplicate`).
3. Linked Local/Village if undecided:
   - MIMU naming more complete → `selective_merge` (name=mimu, geom=coremap)
   - else → `match_existing` (keep CoreMap data)
4. Already-decided linked rows are not changed.

## Counts

- `linked_kept_existing`: **1473**
- `merge_written`: **1473**
- `method_centroid_to_mimu`: **69**
- `method_linked_distance_or_overlap`: **1404**
- `skip_already_decided`: **14**

## Examples

- `village:150596:row26:village_point_Ayeyarwady_v96.zip_mmr_ad…` survivor=119449 losers=119242,119523 via linked_distance_or_overlap
- `village:151060:row53:village_point_Ayeyarwady_v96.zip_mmr_ad…` survivor=119485 losers=119318 via linked_distance_or_overlap
- `village:151142:row71:village_point_Ayeyarwady_v96.zip_mmr_ad…` survivor=119108 losers=119183 via linked_distance_or_overlap
- `village:216725:row80:village_point_Ayeyarwady_v96.zip_mmr_ad…` survivor=119398 losers=119102 via linked_distance_or_overlap
- `village:151903:row95:village_point_Ayeyarwady_v96.zip_mmr_ad…` survivor=119301 losers=119298,119375 via linked_distance_or_overlap
- `village:151914:row112:village_point_Ayeyarwady_v96.zip_mmr_a…` survivor=119478 losers=119162 via linked_distance_or_overlap
- `village:152419:row137:village_point_Ayeyarwady_v96.zip_mmr_a…` survivor=119055 losers=119113,119230 via linked_distance_or_overlap
- `village:153277:row175:village_point_Ayeyarwady_v96.zip_mmr_a…` survivor=119373 losers=119326 via linked_distance_or_overlap
- `village:153967:row184:village_point_Ayeyarwady_v96.zip_mmr_a…` survivor=119206 losers=119365 via linked_distance_or_overlap
- `village:153973:row185:village_point_Ayeyarwady_v96.zip_mmr_a…` survivor=119363 losers=119217 via linked_distance_or_overlap
- `village:153974:row189:village_point_Ayeyarwady_v96.zip_mmr_a…` survivor=119152 losers=119235,119299 via linked_distance_or_overlap
- `village:154611:row197:village_point_Ayeyarwady_v96.zip_mmr_a…` survivor=119152 losers=119235,119299 via linked_distance_or_overlap

