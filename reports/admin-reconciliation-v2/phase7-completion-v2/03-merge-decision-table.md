# Merge decision table (pending)

| # | Source PCode | Names (EN / MY) | Township | Survivor id / public_id | Loser id | Cand↔cand overlap | Status |
|---:|---|---|---|---|---:|---:|---|
| 1 | `MMR013018701526` | No (106) Ward / အမှတ် (၁၀၆) ရပ်ကွက် | Dagon Myothit (South) | `5182` / `79e13a25-4ab4-458e-acf0-a0f34ef59969` | `5183` | 100.0% | PENDING |
| 2 | `MMR013018701525` | No (105) Ward / အမှတ် (၁၀၅) ရပ်ကွက် | Dagon Myothit (South) | `5185` / `29f7a6de-8a50-42d2-bc07-6246d61027e0` | `5186` | 100.0% | PENDING |
| 3 | `MMR007008701505` | Gant Gaw Waing Ward / ဂန့်ဂေါ်ဝိုင်းရပ်ကွက် | Shwegyin | `5891` / `193dd29c-4c4e-452d-a77e-5e7d0c207042` | `5897` | 100.0% | PENDING |
| 4 | `MMR010018701504` | Zay Ward / ဈေးရပ်ကွက် | Taungtha | `6907` / `aca3cb9b-5016-49e1-84e4-fcc6a7fe1cd7` | `6908` | 100.0% | PENDING |

## Ma Har Myaing
- Kind: **potentially_distinct_wards_shared_pcode**
- Geom equal: `False` · pair overlap `0.002` · centroid dist `598.7m`
- Classification detail: `{"kind": "potentially_distinct_wards_shared_pcode", "note": "Same PCode/name/parent but different geometries. Treat as potentially distinct wards: row1589→6797, row1611→6794 (each has unique strong overlap). Shared PCode is a source-data defect to record.", "row_1589_action": "match_existing", "row_1589_match_id": 6797, "row_1611_action": "match_existing", "row_1611_match_id": 6794, "shared_pcode_defect": true}`

## Conditional hard-check tallies
- Ward match_existing accepted: **4/4**
- Village match_existing accepted: **2/2**
- Village create_new accepted: **6/7**

Full v2 manifests: **not generated** (waiting for merge approvals).