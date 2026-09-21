# 07 production approval addendum v2

Generated: `2026-09-21T16:00:18Z`  
Git commit that would be authorized: `8862bf16fbacd6a4c084b20e1fd1022e4850243e`  
Frozen manifest checksums: `checksums/07-v2-frozen-manifest.checksums.json`

**Production was not modified. Production runbook was not executed.**

## Decisions

### A. Production database import readiness — **PASS** (with scoped exceptions)

Evidence:
- Disposable dry-run on `coremap_phase7_v2` applied revised v2 manifests once.
- Geometry preservation: 0 changed existing admin geom / settlement points / public_ids (`validation/07-v2-geometry-preservation.md`).
- Pangsang township created with frozen public_id `7c8315d4-ab5a-4b41-974a-fb3cbe249fc9` under Matman; CoreMap 6484 untouched.
- 87/88 Pangsang VTs created; 1 empty-pcode/empty-name VT rejected as invalid source.
- Postal unique codes 17297; exact_pending_create=0; township_unresolved method=0.
- linked exact/after_review without FK demoted to missing (13 fuzzy) — no forced false links.
- Remaining honest gaps: missing_local_admin_identity=1177, non_admin=646, ambiguous=3, linked_after_review=19.

### B. Public search/API exposure readiness — **FAIL**

Licence state remains **PASS_DATABASE_ONLY**.
Do not enable public search/API exposure for `mimu_placeholder` rows.

### C. Public tile/map publication readiness — **FAIL**

Do not rebuild public tiles containing MIMU placeholders.
Do not invalidate CDN.
Do not change the public map.

## Approval scope if A is accepted later

Authorize **database import only** of frozen v2 manifests under PASS_DATABASE_ONLY.
Do **not** authorize public search, tiles, or map publication.

## Checksums

```json
{
  "frozen-v2/03-approved-local-admin.v2.csv": {
    "sha256": "661d18e9c6b2594df39a4a88f860ee971beec873dc20da1a836193f8b939b902",
    "bytes": 10963756
  },
  "frozen-v2/03-approved-villages.v2.csv": {
    "sha256": "e1e1a1663c9f9fa2446835190c63c481d2ed4ae69edbe322acff7d878dd11677",
    "bytes": 28958329
  },
  "postal/03-postal-actions-v2.csv": {
    "sha256": "d7c4c530b53afaf9d9e108a503b3754b09ce793f6a82453c82217362aad21d77",
    "bytes": 11558005
  },
  "decisions/01-pangsang-township-freeze.json": {
    "sha256": "dcda48e7a54ea85c516a21ecaede0ede25c0120415fae2f5c9fc3eb19b3e6729",
    "bytes": 3503
  },
  "decisions/04-approvals.json": {
    "sha256": "3d0641454eeffbc7c8fc47a463b24c9c41a045a33c04b4019fdbd85b492e0f7b",
    "bytes": 1654
  },
  "git_commit_at_build": "8862bf16fbacd6a4c084b20e1fd1022e4850243e",
  "generated_at": "2026-09-21T16:00:18Z"
}
```

## Exception counts

| Item | Count |
|---|---:|
| Postal linked_exact_local_area | 15452 |
| Postal missing_local_admin_identity | 1177 |
| Postal non_admin_postal_locality | 646 |
| Postal linked_after_review | 19 |
| Postal ambiguous_local_area | 3 |
| Pangsang VT rejected invalid source | 1 |
| Admin placeholders | 14280 |
| Settlement placeholders | 3571 |
