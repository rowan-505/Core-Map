# Phase 7 dry-run report (approval gate)

**Generated:** 2026-09-21  
**Production apply:** **NOT APPROVED YET — do not apply**  
**Evidence DB:** disposable `coremap_phase6` @ `127.0.0.1:5433` (Phase 6 apply already executed here)  
**Production project:** `locghyuranqaqsnbxflc` (backup taken; **not modified**)

## Pre-production gates

| Gate | Result | Evidence |
|---|---|---|
| Database backup | **PASS** | `backup/07-prod-prephase7-affected.dump` (SHA-256 in `backup/07-backup-manifest.md`) |
| Export affected rows | **PASS** | `exports/07-export-*.csv` |
| Frozen action-manifest checksums | **PASS** (match Phase 5 freeze) | `checksums/07-frozen-manifest.checksums.json` |
| MIMU licence / public-use decision | **CONDITIONAL PASS** | `07-licence-decision.md` |
| Rollback SQL tested | **PASS** (BEGIN…ROLLBACK on disposable) | `rollback/07-rollback-test.log` |
| Manual-review actions in frozen manifests | **0** | `validation/07-dry-run-stats.json` |
| Explicitly accepted exceptions | listed below / in `final-report.md` | accepted |

## Disposable post-Phase-6 snapshot (expected production outcome)

| Metric | Value |
|---|---:|
| Active wards | **2,064** |
| Active village tracts | **14,084** |
| Active settlements (villages+) | **59,455** |
| Admin MIMU placeholders | **14,192** |
| Village MIMU point placeholders | **3,592** |
| Postal rows | **17,297** |
| Exact local postal links | **1,851** |

Validation on disposable: invalid placeholder geom **0**, invalid village points **0**, placeholder parent≠township **0**, postal distinct **17,297**, local↔township mismatch **0**, meta tags OK with `verification_status=needs_fix` (DB enum; product meaning = needs review).

## Manual review

- Frozen local/village **manual_review / defer / blank actions: 0**
- Remaining gaps are **accepted exceptions** (missing township parent, missing postal local, rejects) — not unresolved Phase 3 review queue rows.

## Recommendation

**Ready for human approval of production apply**, under conditional MIMU licence rules (placeholders must not be published as official boundaries).

After you explicitly approve, follow `07-production-runbook.md` steps 1–9.

## Not done in this dry-run package

- Production migration / apply
- Production search rebuild
- Production tile rebuild / CDN invalidate
- Production advisor run (run in step 9 after apply)
- Live dashboard / public-map smoke on production (step 8 after apply)

Unit smoke already recorded from Phase 6: `smoke/06-api-*.log` (65 tests passed).
