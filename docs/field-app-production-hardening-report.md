# Field App Production Hardening Report

Audit date: 2026-09-07 (Asia/Seoul)

Scope: the current working-tree implementation of the Android field surveyor, its field/media/report API paths, the survey-session database migration, dashboard report review, release configuration, and existing tests. No production data, remote configuration, database, object-store bucket, or production API was changed or exercised.

## Classification key

| Classification | Meaning |
|---|---|
| Codex-testable | Can be inspected or tested locally/in CI with code, an emulator, and safe disposable dependencies. |
| real-field-only | Requires physical devices, real movement/GNSS, field networks, or surveyor observation. |
| blocked by missing environment | Could not be truthfully executed because a safe database/service, credentials, signing key, or other required environment was not available. |

## Overall conclusion

The implementation is a substantial pilot candidate, but it is **not production-ready yet**. Local code quality signals are strong: 180 Android JVM tests and 16 emulator instrumented tests passed, the minified release APK assembled, 82 targeted field/API tests passed, the dashboard report-review tests passed, and the API/dashboard production builds passed. Those results do not validate authenticated end-to-end synchronization, the SQL migration against a disposable Postgres/PostGIS database, real object storage, production signing, or outdoor field behavior.

Two WorkManager ordering/concurrency issues should be treated as release blockers: media work can exit successfully before the parent report has synced without being re-enqueued by the report worker, and the separately named Wi-Fi/cellular media workers can claim the same `SYNCING` media row concurrently.

## 1. Commit/version tested

| Item | Result | Classification |
|---|---|---|
| Git base commit | `44cd36f30c6433ebe93a0919e4b17991f2e9b5c3` (`v0.21.2 - refine env.example files`, committed 2026-09-03 22:15:18 +0900) | Codex-testable |
| Git describe | `before-thanlyin-import-73-g44cd36f-dirty` | Codex-testable |
| Working-tree identity | The tested implementation is **commit plus uncommitted changes**, not the commit alone. Before this report was added, the tree had 93 changed tracked files and 52 untracked paths. Many field-session, foreground-service, sync, test, migration, and dashboard files were untracked. | Codex-testable |
| Android application version | `versionName 0.7.0-pilot`, `versionCode 7`; application id `com.coremapmm.fieldsurveyor`; min/target/compile SDK 31/35/35. | Codex-testable |
| Release artifact tested | `app/build/outputs/apk/release/app-release.apk`, 34 MB, SHA-256 `c0f7f5fbc53a9e18c64e4273e93d8c4e95cdb22d329e3f39510a14fdedf54378`. It is debug-signed because no production release key was available. | Codex-testable |
| Reproducibility | The exact state cannot be recovered from Git until the implementation and migration are reviewed and committed together. | Codex-testable |

## 2. Environments available

| Environment or dependency | Availability during audit | Classification |
|---|---|---|
| Host toolchain | macOS arm64 workspace; Node `v24.16.0`, npm `12.0.0`, OpenJDK `21.0.10`, PostgreSQL client `18.3`; root/API/dashboard dependencies already installed. | Codex-testable |
| Android build inputs | Android SDK present; overview PMTiles present (13 MB); Myanmar generated glyph directory present. | Codex-testable |
| Android emulator | `sdk_gphone64_arm64`, Android 16/API 36, `arm64-v8a`, connected as `emulator-5554`. | Codex-testable |
| Emulator app runtime | Debug APK installed and `MainActivity` cold-launched successfully. No authenticated survey route/map flow was attempted. | Codex-testable |
| Field app debug endpoint | A gitignored `local.properties` with a `fieldApiBaseUrl` key exists. Its value was not disclosed or contacted; no surveyor credential was available for a safe authenticated run. | blocked by missing environment |
| API/dashboard configuration files | Local env files exist, but this audit did not assume their database, R2, admin-token, or API targets were disposable. Builds loaded only what their normal tooling loads. | blocked by missing environment |
| Disposable Postgres/PostGIS database | No explicitly safe disposable field-test database was identified. Docker access was unavailable, and no migration was applied to any configured database. | blocked by missing environment |
| R2/object-storage integration environment | R2 variable names exist in local API configuration, but no explicitly safe test bucket/credentials were authorized. No upload, HEAD, download, publish, or deletion was executed remotely. | blocked by missing environment |
| Production signing | `FIELD_RELEASE_STORE_*` variables were unavailable. Gradle deliberately fell back to the debug signing key. | blocked by missing environment |
| Crash reporting | `FIELD_SENTRY_DSN` was unavailable, so remote crash delivery was not tested. Logcat fallback exists in code. | blocked by missing environment |
| Physical Android device and field route | No physical handset, field SIM/network, real camera/microphone session, or outdoor Yangon/YBS survey route was available. | real-field-only |

## Implementation inspected

| Requested area | Current implementation observed | Classification |
|---|---|---|
| Three-tab navigation and Survey map | Bottom navigation exposes Routes, Survey, and Settings. Survey uses MapLibre with offline rewritten style, selected route/path, stops, nearby stops, GPS, captured anomalies, moved-stop map picking, route/stop fit, north reset, and sheet-aware controls. | Codex-testable |
| Startup location, Locate, and foreground tracking | `MainActivity` requests startup location only when permission is already granted. Startup uses cached-then-fresh one-shot; Locate uses a fresh one-shot while idle and restores follow during tracking. Active surveys use a high-accuracy fused request and a location foreground service with return/stop notification actions. | Codex-testable |
| Route recommendation under search | Routes screen searches the Room snapshot and offers an explicit nearby recommendation button below search. Ranking returns up to three complete D0/D1 variants within 500 m, considers stop/path distance, and penalizes recently surveyed variants. | Codex-testable |
| D0/D1 switch | The opposite-direction control is rendered beside route identity, resolves only a real counterpart from the snapshot, switches immediately while idle, and confirms while active. Active switching transactionally completes the old local session and starts the new one without moving reports. | Codex-testable |
| Survey sessions and Settings → Survey History | Room stores active/completed/abandoned sessions and links reports by client session id. Settings exposes local history, duration, sync status, report count, local evidence, and route reopening. This is local-device history; the app does not consume the server list/get history endpoints. | Codex-testable |
| Reporting, optional media, Room outbox | Reports require an active survey and usable GPS. Stop/route context and snapshot revision are retained. Up to three JPEGs and one short AAC/M4A voice clip are optional. Reports/media use idempotent UUIDs and local states, with checksum/size checks and seven-day post-sync file retention. | Codex-testable |
| WorkManager synchronization | Sessions sync before reports in one connected-network worker. Media uses a separate unmetered worker by default and an opt-in metered worker. HTTP classification, retry states, refresh-token behavior, and ownership checks exist, but orchestration is not safely ordered end to end; see risks R2 and R3. | Codex-testable |
| Field API and migration | `/field` and `/media` routes are registered behind authentication, surveyor role checks, Zod validation, OpenAPI schemas, and route-specific rate limits. Survey sessions and report links have repository/service layers. The SQL migration creates a private RLS-enabled session table, FKs, checks, indexes, and a report link; a rollback verification script exists but was not run. | Codex-testable |
| Dashboard review | Existing report review now exposes route/variant/stop/session evidence, stale snapshot state, observed/proposed/canonical locations, private media access, deep links to transport editors, and field-specific resolve/reject transitions. Admin state changes remain audited in the API; media publication is a separate explicit action. | Codex-testable |
| Release configuration | Release uses HTTPS API defaults, blocks cleartext, disables backup/device transfer for auth/database/evidence, enables R8/resource shrinking and lint-vital, and checks the release API origin. Missing signing secrets cause a successful debug-signed release rather than a hard failure. Sentry is optional. | Codex-testable |

## 3. Current test results

| Test/build | Result | Classification |
|---|---|---|
| Android JVM unit tests | **PASS: 180 tests, 0 failures, 0 errors, 0 skipped.** Forced re-execution with `--rerun-tasks`; not just an up-to-date result. | Codex-testable |
| Android instrumented tests | **PASS: 16 tests** on Android 16/API 36 emulator. Covered preferences, Room session DAO behavior, manual 4→5 and 5→6 migrations, and JPEG compression/orientation/low-storage behavior. | Codex-testable |
| Android minified release build | **PASS.** `assembleRelease`, release API-origin smoke check, R8, resource shrinking, and lint-vital completed. Artifact is debug-signed, so this is not production-signing validation. | Codex-testable |
| Android emulator launch smoke | **PASS.** Debug APK installed; `MainActivity` cold-launched in 1.672 seconds and became the top resumed activity. It reached the unauthenticated app only. | Codex-testable |
| API field suite | **PASS: 45/45.** Includes DTOs, D0/D1 identity, gzip, field report idempotency, role guards, bootstrap, sessions, ownership, and pagination using unit/fake repositories. | Codex-testable |
| API media/config suite | **PASS: 24/24.** Includes env parsing, admin authorization, media schema, mocked object-store lifecycle, ownership, private access, publication, and sanitization. | Codex-testable |
| API reports suite | **PASS: 13/13.** Includes field evidence shaping, location semantics, stale revision handling, admin auth, and field-specific status transitions. | Codex-testable |
| API default suite | **PASS: 367; SKIP: 1; total 368.** The skipped live transport smoke explicitly required `TRANSPORT_REGRESSION_BASE_URL`, which was unset. | Codex-testable |
| API TypeScript production build | **PASS.** | Codex-testable |
| Dashboard report-review suite | **PASS: 9/9.** | Codex-testable |
| Dashboard targeted lint | **PASS** for the six changed field-report review/helper files. | Codex-testable |
| Dashboard full lint | **NO RESULT.** `npm run lint` produced no diagnostics or completion for several minutes and was manually stopped with exit 130. It is neither a pass nor a failure finding. | Codex-testable |
| Dashboard production build | Initial sandboxed run failed because `next/font` could not reach Google Fonts. A permitted network retry **passed**, including TypeScript and generation of 87 static pages. Next.js warned that multiple lockfiles made workspace-root inference ambiguous. | Codex-testable |
| Database migration/verification | **NOT RUN.** No safe disposable database was identified; production/local configured data was not touched. | blocked by missing environment |
| Authenticated Android → API → database sync | **NOT RUN.** No safe API stack plus surveyor credentials and seeded snapshot were available. | blocked by missing environment |
| Real R2 media upload/complete/attach/admin-view | **NOT RUN.** Unit tests used an object-store double; no safe test bucket was authorized. | blocked by missing environment |
| Production-signed install/upgrade | **NOT RUN.** Production keystore was unavailable. | blocked by missing environment |
| Outdoor/physical field run | **NOT RUN.** Emulator tests do not establish GNSS, background survivability, camera/audio, battery, thermals, cellular behavior, or survey usability. | real-field-only |

## 4. Exact test commands

Commands are shown with their working directory. The repeated macOS shell warning about locating a Java runtime came from shell startup; Android commands were made deterministic with an explicit `JAVA_HOME` and Gradle JVM path.

| Working directory | Exact command | Outcome | Classification |
|---|---|---|---|
| `apps/mobile/field-surveyor-android` | `./gradlew :app:testDebugUnitTest :app:assembleRelease` | Failed before tests because the sandbox could not use the user Gradle cache; the escalated first attempt then found a stale cached JDK-image transform whose `jlink` path no longer existed. | Codex-testable |
| `apps/mobile/field-surveyor-android` | `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ./gradlew --no-daemon -Dorg.gradle.java.home=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home -Pandroid.disableJdkImageTransform=true :app:testDebugUnitTest :app:assembleRelease` | Passed; unit-test task was up-to-date in this combined run, release build executed. | Codex-testable |
| `apps/mobile/field-surveyor-android` | `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ./gradlew --no-daemon -Dorg.gradle.java.home=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home -Pandroid.disableJdkImageTransform=true :app:testDebugUnitTest --rerun-tasks` | Passed; 180 tests actually executed. | Codex-testable |
| `apps/mobile/field-surveyor-android` | `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ./gradlew --no-daemon -Dorg.gradle.java.home=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home -Pandroid.disableJdkImageTransform=true :app:connectedDebugAndroidTest` | Passed; 16 emulator tests executed. | Codex-testable |
| repository root | `adb devices -l` | Found `emulator-5554`. | Codex-testable |
| repository root | `adb install -r apps/mobile/field-surveyor-android/app/build/outputs/apk/debug/app-debug.apk` | Passed. | Codex-testable |
| repository root | `adb shell am start -W -n com.coremapmm.fieldsurveyor/.MainActivity` | Passed; cold launch completed. | Codex-testable |
| `apps/api` | `npm run test:field` | Passed 45/45. | Codex-testable |
| `apps/api` | `npm run test:media` | Passed 24/24. | Codex-testable |
| `apps/api` | `npm run test:reports` | Passed 13/13. | Codex-testable |
| `apps/api` | `npm test` | Passed 367, skipped 1 live-environment smoke. | Codex-testable |
| `apps/api` | `npm run build` | Passed. | Codex-testable |
| `apps/dashboard` | `npm run test:reports` | Passed 9/9. | Codex-testable |
| `apps/dashboard` | `npm run lint` | No result; stopped after several minutes with exit 130. | Codex-testable |
| `apps/dashboard` | `npx eslint src/features/report-management/ReportDetailPage.tsx src/features/report-management/ReportLocationCompareMap.tsx src/features/report-management/api.ts src/features/report-management/types.ts src/features/report-management/fieldEvidenceView.ts src/features/report-management/fieldEvidenceView.test.ts` | Passed with no diagnostics. | Codex-testable |
| `apps/dashboard` | `npm run build` | First run failed on sandboxed Google Fonts fetch; permitted retry passed. | Codex-testable |

## 5. Missing test coverage

| ID | Missing coverage | Why it matters | Classification |
|---|---|---|---|
| C1 | Compose/navigation tests for login → setup → three tabs, back-stack restoration, Survey sheet controls, D0/D1 confirmation, Settings history, rotation/configuration changes, and accessibility semantics. | Current layout/policy tests do not render or interact with the UI. | Codex-testable |
| C2 | MapLibre emulator screenshot/integration tests with the embedded overview and downloaded Yangon PMTiles, including style-load failure visibility, marker hit-testing, padding, map lifecycle, and route/stop/GPS layers. | The map currently catches style exceptions without a user-visible error; compilation does not prove usable rendering. | Codex-testable |
| C3 | Actual fused-location and foreground-service integration under permission grant/revoke, GPS disabled/re-enabled, process death, activity recreation, notification stop/return, and boot/restart scenarios. | Unit tests cover policies, not Android service/location behavior. | Codex-testable |
| C4 | WorkManager integration with a fake HTTP server and controlled scheduling: session → report → media ordering, retry/backoff, app restart, reboot, network transitions, and duplicate worker execution. | Runner unit tests do not validate orchestration; current code has concrete races R2/R3. | Codex-testable |
| C5 | Full Room schema export and `MigrationTestHelper` coverage from every supported version (1→6, 2→6, 3→6, 4→6, 5→6), FK enforcement, downgrade behavior, and crash/interruption recovery. | `exportSchema=false` and two manual migration tests are insufficient for production upgrades. | Codex-testable |
| C6 | Atomic report-plus-media persistence with injected failures at each photo/voice/Room step, orphan cleanup, disk-full behavior, and simultaneous capture/sync. | Media rows have no Room FK to reports and persistence spans files plus multiple DAO calls. | Codex-testable |
| C7 | Disposable Postgres/PostGIS migration apply and rollback verification, followed by real repository/route integration tests for ownership, idempotency, indexes, RLS/grants, report linking, audit entries, and deploy ordering. | Existing API tests mostly use fakes and the SQL verifier was not executed. | blocked by missing environment |
| C8 | Safe test-bucket integration for presigned PUT, content-length/type metadata, completion, retry after URL expiry, orphan object cleanup, signed admin GET, and explicit publication. | Mocked object storage cannot establish provider-specific behavior or cleanup. | blocked by missing environment |
| C9 | Authenticated Android end-to-end run against a safe seeded API: login/refresh/logout, bootstrap gzip/revision, session creation/finalization, report idempotency, media upload, dashboard review, and 401 recovery. | This is the core data-delivery path and was not executed. | blocked by missing environment |
| C10 | Browser E2E for dashboard report lists/details, map comparison, private photo/audio access expiry, authorization failures, field resolve/reject, audit visibility, and transport-editor deep links. | Helper tests and static build do not prove reviewer workflow. | blocked by missing environment |
| C11 | CI jobs for Android JVM/instrumented tests, release lint/build, API field/media/reports tests, migration verification, dashboard tests/build/lint, and artifact signing checks. | No field-surveyor/test command wiring was found in repository CI configuration. | Codex-testable |
| C12 | Production signing/upgrade verification: certificate identity, debug-key rejection, reproducible artifact metadata, version upgrade preserving Room/outbox, and rollback install procedure. | The audited APK is debug-signed. | blocked by missing environment |
| C13 | Outdoor GNSS accuracy and recenter/follow behavior on actual YBS corridors, including urban canyon, stale fixes, coarse permission, tunnels, and mock/erratic fixes. | Emulator policy tests cannot reproduce field GNSS. | real-field-only |
| C14 | Multi-hour foreground tracking across intended handset/OEM fleet: screen off, Doze, battery saver, low battery, thermal pressure, calls, app switching, and OS process pressure. | Foreground survivability and battery cost are device/OEM dependent. | real-field-only |
| C15 | Real camera and microphone capture across portrait/landscape EXIF, permission denial, interruption, Bluetooth/headset routing, noisy environments, storage pressure, and representative low-memory devices. | Generated JPEG tests do not validate hardware/media UX. | real-field-only |
| C16 | Real Wi-Fi/cellular/offline switching and the full Yangon PMTiles download/resume/checksum flow, including captive portals, slow links, metered policy, and insufficient storage. | Network and storage behavior must be measured under field conditions. | real-field-only |
| C17 | Surveyor usability trial for route recommendation relevance, stop selection, D0/D1 mental model, moved-stop placement, duplicate warnings, report speed, Myanmar/English text, and accidental stop/survey actions. | Correctness includes safe, fast operation by actual surveyors. | real-field-only |

## 6. Production risks

| ID | Severity | Risk and evidence | Required disposition | Classification |
|---|---|---|---|---|
| R1 | Blocker | The implementation is not a reproducible version: core runtime, migration, and test files are uncommitted/untracked. A release cannot be traced to the reported base commit. | Review, commit, tag, and build from a clean tree; attach checksums and test evidence. | Codex-testable |
| R2 | Blocker | Media synchronization is not ordered after report synchronization. `FieldWork.enqueue()` starts report/session and media unique work independently. If media runs first, no media is eligible, it returns success, and the report worker does not enqueue media after the report becomes `SYNCED`. Evidence may remain local until a later app event happens to enqueue work. | Chain dependent work or have report completion deterministically enqueue media; add an orchestration test. | Codex-testable |
| R3 | Blocker | Wi-Fi and cellular media work use different unique names and can overlap. `nextEligible` and `markSyncing` both include `SYNCING`, so two workers can claim the same row, allocate separate remote assets, and leave duplicates/orphans even though final attach calls are individually retry-aware. | Use one serialized unique chain and a real lease/claim transition that another worker cannot reclaim until expiry. | Codex-testable |
| R4 | Blocker | The new API assumes `feedback.survey_sessions` and `user_reports.survey_session_id`, but the migration is untracked and was not applied/verified in a disposable database. Deploying API before schema would fail field requests; applying unverified SQL to production is unsafe. | Establish migration order, dry-run on a production-like clone, run the verifier, inspect plans/locks, then stage rollout. | blocked by missing environment |
| R5 | Blocker | `assembleRelease` silently succeeds with a debug key when production signing variables are absent. A debug-signed artifact can be mistaken for a pilot/production release and cannot safely participate in the intended upgrade lineage. | Make CI/release tasks fail closed without the expected certificate; allow an explicitly named local smoke variant instead. | Codex-testable |
| R6 | High | No authenticated end-to-end session/report/media round trip was proven. Green tests use repository/object-store doubles and cannot establish API/database/R2 compatibility, deploy ordering, permissions, or recovery from partially completed uploads. | Add disposable-stack integration and a seeded staging smoke test with no production data. | blocked by missing environment |
| R7 | High | Foreground tracking, process restoration, notification actions, permission loss, GPS-off handling, and camera-follow behavior are policy-tested but not Android-lifecycle tested. | Add emulator service/location tests, then run physical OEM/device field trials. | Codex-testable |
| R8 | High | Room schema history is not exported and only 4→5/5→6 are manually tested. A real user upgrading from versions 1–3, an interrupted migration, or a schema mismatch could lose access to the offline outbox. | Enable schema export, preserve schema JSON, and test every supported upgrade path with Room's migration tooling. | Codex-testable |
| R9 | High | Server sessions can remain `active` indefinitely if a device is lost, app data is cleared, or the app is uninstalled before finalization. No stale-session reconciliation/expiry policy was observed. | Define server reconciliation and administrative visibility without inventing GPS trails; make closure idempotent and audited. | Codex-testable |
| R10 | High | Sensitive report locations, notes, Room data, photos, and voice are excluded from backup but remain plaintext in app-private storage. Device compromise, unlocked-device loss, or forensic extraction remains a privacy risk. | Complete a field-data threat model; decide on database/file encryption, screen/preview policy, retention, remote deletion, and incident response. | Codex-testable |
| R11 | High | No repository CI wiring was found for the new Android/API/dashboard field suites. The current passing state can regress without a required gate. | Add deterministic CI gates and retain JUnit/build artifacts. | Codex-testable |
| R12 | High | Real route recommendation and GNSS behavior are unvalidated in Yangon. A 500 m radius and recent-survey penalties are deterministic, but route geometry quality, stale snapshot behavior, and urban GPS can produce unsafe recommendations. | Conduct a route-stratified field trial and tune only from recorded, privacy-safe results. | real-field-only |
| R13 | Medium | Survey History is device-local even though server list/get endpoints exist. Reinstall/device loss removes the operator's visible history, while server records may persist. The product contract is not explicit about cross-device recovery. | Decide and document local-only versus server-backed history; test the chosen retention/access model. | Codex-testable |
| R14 | Medium | Report/media persistence spans filesystem operations and separate Room writes. Compensating cleanup exists, but there is no database FK from media to report and no crash-consistent transaction across files and Room. | Add failure-injection tests, orphan reconciliation, and an explicit integrity invariant. | Codex-testable |
| R15 | Medium | Remote crash reporting is disabled without a DSN, and no release telemetry delivery or redaction test ran. Production faults in background sync/location could be invisible or leak sensitive context if configured poorly. | Configure a non-production DSN first; verify redaction, sampling, offline buffering, and release/environment tags. | blocked by missing environment |
| R16 | Medium | R8 rules keep the entire app plus several dependency namespaces. This reduces optimization/obfuscation value and contributes to a 34 MB APK. | Replace blanket keeps with evidence-based rules and rerun release/instrumented tests. | Codex-testable |
| R17 | Medium | Dashboard production build depends on fetching Google Fonts; the first restricted build failed. This makes builds network-dependent and less reproducible. Multiple lockfiles also cause ambiguous Next.js workspace-root inference. | Self-host/pin fonts and define one intended workspace root/lockfile strategy. | Codex-testable |
| R18 | Medium | A local dashboard configuration declares a `NEXT_PUBLIC_IMPORT_REVIEW_ADMIN_TOKEN` key. Any value exposed through a `NEXT_PUBLIC_*` variable is client-visible and must not be an administrative secret, even though this is broader than the field review change. | Remove client-shipped admin tokens and rely on authenticated API authorization; confirm no deployed bundle contains a secret. | Codex-testable |
| R19 | Medium | The app requires API 31+, uses one ABI (`arm64-v8a`), and embeds/uses sizable offline assets. Compatibility, storage, memory, performance, and battery have not been validated across the intended surveyor fleet. | Define the supported-device matrix and test representative low/mid-range physical devices. | real-field-only |

## 7. Phases required next

The order below is a release gate sequence, not a feature roadmap.

| Phase | Exit criteria | Classification |
|---|---|---|
| Phase 0 — Freeze a reproducible baseline | Review all current changes; commit migration/API/dashboard/Android/tests together; create a clean-tree build; record app version, commit, dependency locks, artifact hashes, and generated test reports. | Codex-testable |
| Phase 1 — Fix deterministic local blockers | Serialize media work, enforce report→media ordering, make release signing fail closed, define stale-session reconciliation, export Room schemas, add all-version migrations, add orphan recovery, and remove client-visible admin secrets. | Codex-testable |
| Phase 2 — Add automated app integration | Add Compose navigation/UI tests, MapLibre/PMTiles render smoke tests, foreground-service/process-death tests, and WorkManager fake-server scheduling/concurrency/reboot tests on at least API 31 and current API. | Codex-testable |
| Phase 3 — Validate the backend on disposable infrastructure | Apply and verify the SQL migration on a production-like disposable Postgres/PostGIS clone; run real Prisma repository/HTTP auth tests; inspect locks/indexes; validate rollback/deploy ordering. | blocked by missing environment |
| Phase 4 — Validate object storage and staging E2E | Use a dedicated test bucket, seeded surveyor/admin accounts, non-production API/database, and dashboard deployment to prove login → bootstrap → session → report → media → review → audit, including retries and expired URLs. | blocked by missing environment |
| Phase 5 — Release security and operability | Produce a correctly signed candidate, verify certificate/upgrade lineage, configure redacted crash telemetry, define privacy/retention/incident procedures, create monitoring/runbooks, and verify rollback. | blocked by missing environment |
| Phase 6 — Controlled device-lab qualification | Test the signed candidate on the supported physical fleet for OEM background behavior, permission changes, storage/memory, camera/audio, long-running battery/thermal behavior, and Wi-Fi/cellular transitions. | real-field-only |
| Phase 7 — Yangon field pilot | Run supervised surveys across representative D0/D1 routes and GNSS conditions; measure recommendation relevance, capture completion time, data accuracy, sync delay/failure, battery use, and surveyor errors. No automatic canonical writes. | real-field-only |
| Phase 8 — Staged production rollout | After all blocker/high risks have owners and exit evidence, roll out to a small cohort, monitor outbox age/failures and session closure, verify dashboard review/audit, then expand with a tested rollback path. | real-field-only |

## Release gate

| Decision | Status | Classification |
|---|---|---|
| Promote the audited APK to production | **NO-GO.** It is based on a dirty tree, is debug-signed, has unverified schema/storage/staging integration, and contains unresolved media-work ordering/concurrency blockers. | Codex-testable |
| Continue to controlled engineering validation | **GO**, after preserving the current work and fixing R2/R3/R5 before trusting outbox evidence delivery. | Codex-testable |

---

## Android hardening execution addendum — 2026-09-07

This addendum records the subsequent test-first Android hardening pass and supersedes the Android counts and the R2/R3 status above. The Git base remains `44cd36f30c6433ebe93a0919e4b17991f2e9b5c3`; the tested tree remains dirty and identifies itself as `before-thanlyin-import-73-g44cd36f-dirty`. Android remains `0.7.0-pilot` (`versionCode 7`). No production data, remote configuration, API, database, object store, or credential was used. **Classification: Codex-testable.**

### Final results

| Check | Final result | Classification |
|---|---|---|
| JVM unit suite | **PASS — 186 tests, 0 failed, 0 errors, 0 skipped.** The hardening tests were force-executed once; the final matrix reused the unchanged successful outputs. | Codex-testable |
| Instrumentation/UI suite | **PASS — 22 tests, 0 failed, 0 errors, 0 skipped** on Pixel 9a AVD, Android 16/API 36. | Codex-testable |
| Android lint | **PASS** with no errors; the report contains 67 warnings. The existing deprecated MapLibre `setPadding` compile warning remains. | Codex-testable |
| Debug APK | **PASS**, 91 MB. | Codex-testable |
| Minified release APK | **PASS**, 34 MB; R8, resource shrinking, lint-vital, and the release-origin smoke check completed. SHA-256: `98522ba60eb1c0ee7518e21d5aea741d7f3278c4c077701a64ed29383c6a373a`. | Codex-testable |
| Release signing | APK signature verification passed with the Android debug certificate. This is explicitly **not** a production-signing result because no production keystore was available. | blocked by missing environment |
| Physical field qualification | **NOT RUN.** No physical handset, outdoor route, real GNSS conditions, field SIM, or OEM background-power environment was available. | real-field-only |

### Requested behavior matrix

| Requested behavior | Evidence and result | Classification |
|---|---|---|
| Startup with cached, fresh, unavailable, and timed-out location | Cached→fresh ordering, fresh-only fallback, unavailable result, timeout, stale-cache rejection, and state completion pass in JVM tests. This tests the shared one-shot pipeline, not live Fused Location Provider radio behavior. | Codex-testable |
| No continuous GPS outside a survey | State tests prove startup and Locate enter `ONE_SHOT` then `IDLE`; only Start Survey enters `SURVEY_TRACKING`. | Codex-testable |
| Locate one-shot behavior | Idle Locate remains one-shot; during a survey Locate restores camera follow without changing tracking mode. | Codex-testable |
| Start Survey foreground tracking | Foreground coordinator/runtime tests pass for start, idempotence, service restore, and notification policy. Actual OEM/service longevity remains a physical-device item. | Codex-testable |
| Manual pan disables follow but not tracking | JVM test passes: mode remains `SURVEY_TRACKING`, follow becomes false. | Codex-testable |
| Locate restores follow | JVM test passes while preserving `SURVEY_TRACKING`. | Codex-testable |
| Finish Survey stops tracking | JVM lifecycle/state tests pass and require `IDLE` plus foreground stop. | Codex-testable |
| Permission denial/revocation and disabled GPS | Runtime policy tests pass for denial/revocation/disabled-provider transitions. A real Settings revocation while an OEM service is running was not performed. | Codex-testable |
| Activity recreation and process-death recovery | Persisted selection, active-session restoration policy, stale sync recovery, and Room close/reopen persistence pass. A true OS kill/restore UI scenario remains uncovered. | Codex-testable |
| Route recommendation 500 m cutoff | Exact boundary tests pass. | Codex-testable |
| No result thousands of kilometres away | Synthetic far-country coordinate tests pass. | Codex-testable |
| Recommendation opens existing Survey map | Selection callback/navigation contract and `FieldNavHost` wiring to the existing `FieldRoutes.Survey` destination pass structural/unit review; a full authenticated navigation click was not available. | Codex-testable |
| D0/D1 switch loads the real opposite variant | Tests pass using cached counterpart identity, stops, and path, and reject fake path reversal. | Codex-testable |
| D0 and D1 reports remain separate | Real in-memory Room instrumentation test passes with separate session/report counts. | Codex-testable |
| Zero-report survey appears in Settings → Survey History | Compose UI plus Room instrumentation test passes and displays `YBS-13 · D0` with `0 reports`. | Codex-testable |
| Room migrations without destructive fallback | Existing 4→5 and 5→6 migration tests pass; a future-version database fails closed and retains a sentinel table. Full 1→6/2→6/3→6 chains and exported schema validation remain missing. | Codex-testable |
| Offline session/report persistence | File-backed Room close/reopen instrumentation test passes with linked history count intact. | Codex-testable |
| Report validation and duplicate warnings | Existing JVM tests pass for required fields, location quality, duplicate proximity/time warnings, and confirmation behavior. | Codex-testable |
| Portrait/landscape media metadata | Instrumentation tests pass for JPEG orientation normalization and pixel metadata; real camera OEM EXIF behavior remains field/device-only. | Codex-testable |
| Exactly three bottom navigation tabs | Compose semantics test passes and asserts exactly Routes, Survey, Settings and the three-entry route model. | Codex-testable |
| Synthetic static, walking, and bus-speed movement | JVM tests pass for jitter/static suppression, heartbeat, walking displacement, and representative urban bus-speed fixes. | Codex-testable |

### Test-first failures observed

| Failure | Interpretation | Resolution | Classification |
|---|---|---|---|
| New tests initially did not compile because one-shot sequencing, sync-stage policy, upload-claim lease, and file-backed test database seams did not exist. | Expected red phase; it established that the intended behavior was not represented by executable seams. | Added the smallest testable seams and used them in production code. | Codex-testable |
| `restartCompletesExistingRemoteWithoutSecondPut` failed after introducing a lease. | The old test reclaimed a `SYNCING` upload after only 9 ms, which is precisely the duplicate-worker race. | The assertion now requires a fresh claim to remain exclusive and permits recovery only after the 15-minute lease. | Codex-testable |
| First Compose run failed with `InputManager.getInstance` missing on Android 16. | Test-runtime incompatibility: transitive Espresso 3.5.0 was not compatible with the API 36 image. This was not an app defect. | Pinned AndroidX Test runner/core 1.7.0, JUnit extension 1.3.0, and Espresso 3.7.0; the same UI assertions then ran. | Codex-testable |
| First history UI test used the default Myanmar composition locale while asserting English. | Test setup error, not an app defect. | Provided the English composition local explicitly; assertions were unchanged. | Codex-testable |
| One full run checked the asynchronously emitted Room history row too early. | Instrumentation race, not a product-data failure. | Waits up to five seconds for the actual row, then still requires it to be displayed with `0 reports`. | Codex-testable |

### Confirmed defects fixed

| Defect | Fix and verification | Classification |
|---|---|---|
| R2 — media could finish before its parent report and never be scheduled again. | The report worker now schedules the Wi-Fi media worker after sessions/reports drain successfully. Unit policy tests and the full suites pass. | Codex-testable |
| R3 — separately named Wi-Fi/cellular workers could upload the same media concurrently. | Both modes now use one unique media queue; the legacy cellular queue is cancelled. Room claim SQL excludes fresh `SYNCING` rows and permits crash recovery only after a 15-minute lease. Both memory-runner and real Room instrumentation tests prove second-claim rejection and stale reclaim. | Codex-testable |
| Android 16 UI tests could not execute with the resolved Espresso 3.5.0 runtime. | Pinned the compatible AndroidX Test/Espresso runtime; all 22 emulator tests now execute and pass. This changes test dependencies only. | Codex-testable |

The one-shot location extraction and `FieldDatabase.createAt`/`VERSION` additions are test seams around existing behavior, not claimed product defects. No feature or navigation destination was added.

### Files changed by this hardening pass

All entries below are **Codex-testable**. The repository already contained extensive unrelated uncommitted work; this list is limited to files touched by this pass.

| Area | Files |
|---|---|
| Build/test runtime | `apps/mobile/field-surveyor-android/app/build.gradle.kts` |
| Location | `app/src/main/java/com/coremapmm/fieldsurveyor/survey/GpsEngine.kt`; `app/src/test/java/com/coremapmm/fieldsurveyor/survey/GpsTrackingTest.kt` |
| WorkManager/outbox | `app/src/main/java/com/coremapmm/fieldsurveyor/work/FieldWork.kt`; `app/src/main/java/com/coremapmm/fieldsurveyor/data/SyncClaimPolicy.kt`; `app/src/main/java/com/coremapmm/fieldsurveyor/data/LocalReportMediaDao.kt`; `app/src/test/java/com/coremapmm/fieldsurveyor/work/FieldWorkTest.kt`; `app/src/test/java/com/coremapmm/fieldsurveyor/work/MediaSyncRunnerTest.kt`; `app/src/test/java/com/coremapmm/fieldsurveyor/media/ReportPhotoStoreTest.kt` |
| Room/session | `app/src/main/java/com/coremapmm/fieldsurveyor/data/FieldDatabase.kt`; `app/src/androidTest/java/com/coremapmm/fieldsurveyor/data/FieldDatabaseRecoveryInstrumentedTest.kt`; `app/src/androidTest/java/com/coremapmm/fieldsurveyor/data/SurveySessionDaoTest.kt` |
| Compose UI | `app/src/androidTest/java/com/coremapmm/fieldsurveyor/nav/FieldBottomBarInstrumentedTest.kt`; `app/src/androidTest/java/com/coremapmm/fieldsurveyor/ui/settings/SurveyHistoryNavigationInstrumentedTest.kt` |
| Documentation | `docs/field-app-production-hardening-report.md` |

Paths without the repository prefix in this table are under `apps/mobile/field-surveyor-android/`.

### Exact commands added in this pass

All commands ran from `apps/mobile/field-surveyor-android` and are **Codex-testable**. `JAVA_HOME` and the Gradle JVM path were explicit because the interactive macOS shell itself reports no default Java runtime.

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ./gradlew --no-daemon -Dorg.gradle.java.home=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home -Pandroid.disableJdkImageTransform=true :app:testDebugUnitTest :app:connectedDebugAndroidTest :app:lintDebug :app:assembleDebug :app:assembleRelease --rerun-tasks

JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ./gradlew --no-daemon -Dorg.gradle.java.home=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home -Pandroid.disableJdkImageTransform=true :app:testDebugUnitTest :app:compileDebugAndroidTestKotlin --rerun-tasks

JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ./gradlew --no-daemon -Dorg.gradle.java.home=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home -Pandroid.disableJdkImageTransform=true :app:testDebugUnitTest --rerun-tasks

JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ./gradlew --no-daemon -Dorg.gradle.java.home=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home -Pandroid.disableJdkImageTransform=true :app:connectedDebugAndroidTest --rerun-tasks

JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ./gradlew --no-daemon -Dorg.gradle.java.home=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home -Pandroid.disableJdkImageTransform=true :app:testDebugUnitTest :app:connectedDebugAndroidTest :app:lintDebug :app:assembleDebug :app:assembleRelease
```

The first command is the pre-change baseline and passed with 180 JVM/16 emulator tests. The compile command captured the intended red phase. Intermediate emulator/full-matrix invocations exposed and recorded the test-runtime/setup issues above. The final command passed with 186 JVM/22 emulator tests, lint, debug build, and minified release build.

### Remaining production risks and next phases

| Priority | Remaining work | Classification |
|---|---|---|
| P0 | Preserve this dirty-tree implementation as a reviewed commit and reproduce from a clean checkout. | Codex-testable |
| P0 | Make release signing fail closed and verify the signed upgrade lineage; current APK is debug-signed. | blocked by missing environment |
| P0 | Run authenticated Android → safe staging API → disposable Postgres/PostGIS → test R2 → dashboard review, including retry/idempotency and audit evidence. | blocked by missing environment |
| P1 | Add WorkManager integration tests with controlled constraints/restart/reboot and a fake HTTP server; current worker ordering is covered at policy/DAO/runner level, not scheduler level. | Codex-testable |
| P1 | Export Room schemas and test every supported migration chain (1→6 through 5→6), FK/integrity behavior, and downgrade failure. | Codex-testable |
| P1 | Add authenticated Compose navigation and MapLibre/PMTiles rendering tests, real permission toggles, ActivityScenario recreation, and OS process-kill restore. | Codex-testable |
| P1 | Clear or explicitly accept the 67 lint warnings and replace deprecated MapLibre padding usage when supported. | Codex-testable |
| P1 | Validate production R2 upload/complete/attach/private-review behavior and telemetry redaction with dedicated non-production credentials. | blocked by missing environment |
| P2 | Run physical-device static/walking/bus routes, GPS loss/recovery, permission revocation, screen-off/Doze/OEM killing, camera/microphone orientation, cellular/Wi-Fi switching, battery, thermals, and long-session testing. | real-field-only |

### Updated release gate

R2 and R3 are fixed and covered locally, so controlled engineering validation may continue. Production promotion remains **NO-GO** because the tree is not reproducible, the release is debug-signed, staging/database/object-storage integration is untested, and physical field/OEM qualification has not occurred. **Classification: Codex-testable for the decision; blocked by missing environment and real-field-only for the unresolved evidence.**

## Field API and database hardening addendum — 2026-09-07

This addendum supersedes the earlier statement that database testing was unavailable. A disposable local PostGIS database became available and was used. Production Supabase access remained transaction-level read-only; no production data, schema, storage object, or remote configuration was changed.

### Version and environments tested

| Item | Evidence | Classification |
|---|---|---|
| Repository base | Commit `44cd36f30c6433ebe93a0919e4b17991f2e9b5c3`; `git describe` was `before-thanlyin-import-73-g44cd36f-dirty`. Tests include the pre-existing dirty-tree field implementation plus the hardening changes recorded below. | Codex-testable |
| API runtime | Local Node/TypeScript Fastify application and its existing unit suites. | Codex-testable |
| Prior valid database schema | Schema-only, no-owner, no-privileges dump obtained under `default_transaction_read_only=on` from production and restored into disposable PostGIS. No production rows were copied. | Codex-testable |
| Disposable database | `postgis/postgis:16-3.4`, PostgreSQL 16/PostGIS 3.4, local database `coremap_field_test`; synthetic users/routes/sessions/reports only. | Codex-testable |
| Production Supabase | PostgreSQL 17.6, read-only catalog/duplicate/privilege checks and read-only security/performance advisors only. | Codex-testable |
| Android emulator | Pixel 9a AVD, Android 16/API 36, 22 instrumentation tests. | Codex-testable |
| Physical devices and real travel | No physical phone, OEM power manager, street walk, or bus trip was available. | real-field-only |
| Test R2/storage and production signing | No isolated R2 bucket/credentials or production signing material was available. | blocked by missing environment |

### API and database results

| Requirement | Result | Classification |
|---|---|---|
| Migration from previous valid schema | Production-derived prior DDL restored locally; candidate migration applied cleanly. The self-contained verifier passed and rolled all fixtures back. Final residue was 0 sessions, 0 reports, and 0 synthetic users. | Codex-testable |
| `survey_sessions` constraints and indexes | Verified public/client UUID uniqueness, status values, timestamp consistency, route/variant/user FKs, history index, variant index, RLS enabled, and direct privilege revocation. Invalid FK/status/timestamp fixtures were rejected. | Codex-testable |
| `user_reports.survey_session_id` | FK and lookup index verified. Route-level reports without a stop passed. Reports cannot attach to completed or abandoned sessions after the confirmed fix. | Codex-testable |
| Session/report idempotency | Duplicate client session IDs and client report IDs were rejected/idempotently returned. Concurrent load produced exactly 20 expected duplicate session outcomes and exactly 1 expected duplicate report outcome. | Codex-testable |
| State transitions | Active→completed and active→abandoned passed; invalid repeat/terminal transitions were rejected. | Codex-testable |
| Route validity | Inactive/invalid route variants were rejected. Route and variant public IDs now have database uniqueness constraints after read-only production duplicate checks returned zero duplicate groups. | Codex-testable |
| Authentication and ownership | Surveyor role required; disabled/revoked local accounts are now rejected even with a still-valid token identity. Cross-user session access was denied. | Codex-testable |
| D0/D1 separation | Five D0 and five D1 synthetic surveyors retained separate sessions and report counts. | Codex-testable |
| Zero-report history and cursor pagination | Zero-report session appeared with derived count 0; cursor pagination checks passed. | Codex-testable |
| Derived report counts | Counts were derived from report rows and passed both verification SQL and load assertions. | Codex-testable |
| Media type/size/checksum validation | Unit tests cover allowlisted media type/size and SHA-256 validation. Migration adds a nullable 64-character lowercase SHA-256 constraint for backward compatibility; new uploads require checksum. | Codex-testable |
| Private/signed media access | API unit tests verify signed PUT/header construction, ownership, and checksum completion behavior with a mock object store. A real provider round trip was not run. | blocked by missing environment |
| Structured errors and rate limits | Full Fastify injection verified request 61 returns HTTP 429 with stable `RATE_LIMITED` code after 60 requests; OpenAPI regression test protects the response schema. | Codex-testable |
| Duplicate/concurrent requests | Approximately 10 concurrent surveyors completed 102 service/repository/database operations with 0 error rate and 0 connection/database failures. This was in-process API service load, not an external network/socket benchmark. | Codex-testable |
| Rollback/recovery | Verification fixtures ran in a transaction and rolled back with zero residue. A real failed-deployment restore/point-in-time recovery drill was not available. | blocked by missing environment |
| Internal schemas | Production read-only privilege checks found no `USAGE` for `anon` or `authenticated` on `app_auth`, `core`, `feedback`, `import_review`, `media`, `system`, or `transport`; the local candidate preserved that posture. The hosted PostgREST exposed-schema setting itself was not available for direct inspection. | blocked by missing environment |

### Load and query evidence

Final warm synthetic run (10 surveyors): 102 operations, error rate 0%, session duplicate count 20/20, report duplicate count 1/1, write latency p50 17.70 ms / p95 212.49 ms / max 250.92 ms, read latency p50 6.63 ms / p95 8.07 ms / max 8.07 ms, one operation over 250 ms, and zero connection/database failures. **Classification: Codex-testable.**

`EXPLAIN (ANALYZE, BUFFERS)` used 25,000 synthetic routes, 50,000 variants, 10,000 sessions, and 20,000 reports:

| Query | Final plan/result | Classification |
|---|---|---|
| Session history | `survey_sessions_created_by_started_at_idx` plus `user_reports_survey_session_id_idx`; 3.969 ms, 209 shared-buffer hits. | Codex-testable |
| Report count | Index-only report/session lookup; 0.056 ms, 6 shared-buffer hits. | Codex-testable |
| Active variant/public route lookup | Unique index scans; measured 0.640 ms and 0.389 ms with 6 buffer hits each. Before the constraints, the planner used sequential scans. The evidence supports uniqueness and plan stability, not a claim of lower hot-cache elapsed time. | Codex-testable |
| Recommendation query | No server/database recommendation query exists: the 500 m recommendation is computed against Room data on Android and is covered by Android tests. Therefore no fabricated server EXPLAIN result is reported. | Codex-testable |

Read-only production advisors returned 87 security findings (85 informational RLS-enabled-with-no-policy findings and 2 warnings for extensions in `public`) and 550 performance findings (115 unindexed foreign keys, 1 table without a primary key, 433 unused-index notices, and 1 Auth database absolute-connection notice). These describe the existing production schema before this un-deployed candidate migration; they were not “fixed” indiscriminately because most are outside the field-app scope and unused-index evidence is workload-dependent. **Classification: Codex-testable.**

### Test-first failures and confirmed fixes

| Confirmed failure | Fix | Final evidence | Classification |
|---|---|---|---|
| A report could attach to a completed/abandoned session. | `requireOwnedForReport` now requires an active session and returns `SESSION_NOT_ACTIVE`. | Red unit test initially failed with “Missing expected rejection”; field suite now passes. | Codex-testable |
| Disabled local accounts were accepted when a JWT identity remained otherwise valid. | Field/report user lookups now require `is_active=true` and `account_status='active'`. | Disposable DB load assertion `disabledSurveyorRejected=true`. | Codex-testable |
| Route and variant public IDs used by API lookups were not database-unique. | Added unique constraints only after production read-only duplicate checks found zero conflicts and EXPLAIN showed sequential scans. | Migration verifier and index-scan EXPLAIN pass. | Codex-testable |
| Media checksum was computed locally but not enforced end-to-end. | Android sends checksum and signed metadata; API validates/persists expected SHA-256 and rejects missing/mismatched completion metadata. | Three initially failing media tests now pass; Android propagation test passes. Real R2 remains blocked. | Codex-testable |
| Rate-limit handler created a code, but the route's 429 response schema stripped it. | Corrected the 429 OpenAPI schema and added regression coverage. | Request 61 returns `{code: "RATE_LIMITED", ...}`. | Codex-testable |

### Final test results and exact commands

| Suite/build | Final result | Classification |
|---|---|---|
| API default tests | 368 total: 367 passed, 1 skipped live transport smoke, 0 failed. | Codex-testable |
| API field tests | 47 passed, 0 failed. | Codex-testable |
| API media tests | 25 passed, 0 failed. | Codex-testable |
| API reports tests | 13 passed, 0 failed. | Codex-testable |
| API typecheck/build | Both passed. | Codex-testable |
| Dashboard report tests/lint | 9/9 tests and targeted ESLint passed. | Codex-testable |
| Android JVM tests | 186 passed, 0 failed/skipped. | Codex-testable |
| Android emulator tests | 22 passed on the available Android 16 emulator. | Codex-testable |
| Android lint/debug/minified release | Passed. Release APK SHA-256 `a5f0a9034d61598e788271e0590af13e7aa1400b194e0fcf03b2d7882117f322`, 35,808,786 bytes. It is debug-signed and is not a production release artifact. | Codex-testable |

Commands were run from the indicated package directory. Secrets and production connection strings are intentionally represented by environment variables.

```bash
# apps/api
npm test
npm run test:field
npm run test:media
npm run test:reports
npm run typecheck
npm run build
DATABASE_URL="$FIELD_TEST_DATABASE_URL" NODE_ENV=test npx tsx src/scripts/field-hardening-load.ts

# disposable PostgreSQL/PostGIS shell
psql "$FIELD_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f infrastructure/database/migrations/supabase/20260904120055_survey_sessions_history.sql
psql "$FIELD_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f infrastructure/database/verification/verify_20260904120055_survey_sessions_history.sql
psql "$FIELD_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f infrastructure/database/verification/explain_field_app_queries.sql

# production read-only schema inspection (session forced read-only; no data dump)
PGOPTIONS='-c default_transaction_read_only=on' pg_dump "$PRODUCTION_DATABASE_URL" --schema-only --no-owner --no-privileges --schema=app_auth --schema=core --schema=feedback --schema=import_review --schema=media --schema=system --schema=transport

# apps/dashboard
npm run test:reports
npx eslint src/features/report-management/fieldEvidenceView.ts src/features/report-management/fieldEvidenceView.test.ts src/features/report-management/ReportDetailPage.tsx src/features/report-management/ReportLocationCompareMap.tsx

# apps/mobile/field-surveyor-android
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' ./gradlew --no-daemon -Dorg.gradle.java.home='/Applications/Android Studio.app/Contents/jbr/Contents/Home' testDebugUnitTest lintDebug assembleDebug assembleRelease
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' ./gradlew --no-daemon -Dorg.gradle.java.home='/Applications/Android Studio.app/Contents/jbr/Contents/Home' connectedDebugAndroidTest
```

### Files changed in the API/database continuation

All rows are **Codex-testable**. This list is limited to this continuation and does not claim ownership of unrelated pre-existing dirty-tree changes.

| Area | Files |
|---|---|
| Sessions/auth/idempotency | `apps/api/src/modules/field/survey-sessions.service.ts`, `survey-sessions.repo.ts`, `survey-sessions.test.ts`, `field.openapi.ts`, `field-rate-limit.openapi.test.ts`; `apps/api/src/modules/reports/reports.repo.ts` |
| Media integrity | `apps/api/src/modules/media/media.schema.ts`, `media.service.ts`, `media.service.test.ts`, `media.repo.ts`, `object-store.ts`, `r2-s3.adapter.ts`; Android `data/FieldMediaApi.kt`, `work/MediaSyncRunner.kt`, `work/FieldWork.kt`, and `MediaSyncRunnerTest.kt` |
| Database/load evidence | `infrastructure/database/migrations/supabase/20260904120055_survey_sessions_history.sql`, `infrastructure/database/verification/verify_20260904120055_survey_sessions_history.sql`, `explain_field_app_queries.sql`, `apps/api/src/scripts/field-hardening-load.ts` |
| Documentation | `docs/field-app-production-hardening-report.md` |

### Missing coverage, production risks, and required next phases

| Phase/priority | Required evidence | Classification |
|---|---|---|
| P0 — reproducibility | Review and commit the intended dirty-tree implementation, then repeat the matrix from a clean checkout/CI runner. | Codex-testable |
| P0 — safe staging integration | Run Android→staging API→disposable Postgres→dedicated private R2→dashboard review, including actual signed PUT/HEAD checksum metadata, private reads, expiry, retries, and audit trails. | blocked by missing environment |
| P0 — deployment safety | Exercise migration rollback/restore and point-in-time recovery on a production-shaped staging clone; then review advisor deltas before promotion. | blocked by missing environment |
| P0 — release identity | Configure production signing outside the repository and prove install/upgrade lineage. | blocked by missing environment |
| P1 — hosted exposure/security | Directly inspect Supabase PostgREST exposed schemas, Auth configuration, storage policies, rate-limit deployment topology, and resolve or explicitly accept relevant advisor findings. | blocked by missing environment |
| P1 — load realism | Repeat approximately 10-surveyor traffic through a listening staging HTTP endpoint and object store with network fault injection; record server, pool, Postgres, and storage telemetry. | blocked by missing environment |
| P1 — Android automation | Add WorkManager scheduler/reboot tests, all Room migration chains, ActivityScenario/process-kill coverage, real permission toggles, and MapLibre/PMTiles rendering assertions. | Codex-testable |
| P2 — field qualification | Physical-device static/walking/bus-speed sessions, tunnels/GPS-off/revocation, screen-off/Doze/OEM killing, camera/mic rotation, network switching, battery/thermal, and long-session testing. | real-field-only |

### Final gate

The confirmed local defects are fixed and all available automated suites, emulator tests, lint, builds, migration verification, EXPLAIN checks, and synthetic concurrency tests pass. Production release remains **NO-GO** until a clean reproducible commit, production signing, safe staging/R2 integration, hosted exposure review, recovery drill, and physical field qualification are complete. **Classification: Codex-testable for this assessment; blocked by missing environment and real-field-only for the outstanding evidence.**

## Full-stack Android E2E continuation — 2026-09-07

This section supersedes the earlier statements that a real object-store round trip was unavailable and that reports must be rejected after a session reaches a terminal state. The tested revision was commit `44cd36f30c6433ebe93a0919e4b17991f2e9b5c3` with the documented dirty-tree changes (`44cd36f-dirty`). Production Supabase remained read-only; the E2E flow used only disposable local services.

### Environment and end-to-end result

| Component / exact flow | Result | Classification |
|---|---|---|
| Android | Pixel 9a AVD, Android 16/API 36; synthetic location `(16.7600, 96.2000)` with 3 m accuracy. | Codex-testable |
| API/database/storage/dashboard | Fastify on localhost, PostGIS 16/3.4 disposable database, MinIO `RELEASE.2025-07-23T15-54-02Z` bound to localhost, and Next.js dashboard on localhost. | Codex-testable |
| Steps 1–9 | Surveyor login, bootstrap, nearby recommendation, D0 selection, existing Survey map, session start, correct-stop/no-report assertion, text report, portrait JPEG report, and voice report passed. | Codex-testable |
| Steps 10–14 | Emulator networking disabled; fourth report persisted offline; D0 completed; separate D1 session created and completed with zero reports. | Codex-testable |
| Steps 15–20 | App force-stopped/restarted; two sessions, four reports, and two media files survived; network restored; WorkManager enqueued repeatedly; an expired access token refreshed; a forced retry state/storage outage recovered; both media uploaded and attached once. | Codex-testable |
| Steps 21–23 | Survey History showed D0=4 and D1=0; dashboard report review showed four field reports and media counts 0/1/1/0; direct database evidence matched. | Codex-testable |
| Real R2/Supabase hosted storage | MinIO exercised the S3 signed PUT/HEAD contract, but Cloudflare R2 credentials and a dedicated hosted staging project were unavailable. | blocked by missing environment |
| Physical movement/OEM lifecycle | No physical phone, real walking/bus trip, Doze, or OEM process killer was available. | real-field-only |

The final clean four-phase repetition passed: phase 1 `OK (1 test)` in 4.105 s, offline phase 1b `OK (1 test)` in 2.290 s, restart/auth/outage phase 2 `OK (1 test)` in 0.413 s, and retry/history phase 3 `OK (1 test)` in 3.195 s.

### Direct disposable-database evidence

| Assertion | Final value | Classification |
|---|---:|---|
| Server sessions / distinct client session IDs / duplicates | 2 / 2 / 0 | Codex-testable |
| D0 status and derived report count | completed / 4 | Codex-testable |
| D1 status and derived report count | completed / 0 | Codex-testable |
| Reports / distinct client report UUIDs / duplicates | 4 / 4 / 0 | Codex-testable |
| Ready media assets / report-media links / distinct linked assets | 2 / 2 / 2 | Codex-testable |
| Attachment multiplicity | JPEG=1, audio=1 | Codex-testable |
| Local retry persistence | Failed media stayed `RETRY` with its source file intact, then became `SYNCED` after storage recovery. | Codex-testable |
| Canonical transport fingerprint before / after | `a16f816a9a7fbd004fb6160105e84262` / same | Codex-testable |

The JPEG was 3,010 bytes and the audio object was 2,048 bytes. The current upload API does not copy Android's locally retained `pixelWidth`, `pixelHeight`, or `durationMs` into `media.assets`; those server columns remained null. Orientation metadata is covered locally, but end-to-end server preservation remains missing coverage and a production risk. **Classification: Codex-testable.**

### Confirmed E2E failures and fixes

| Failure | Fix and final evidence | Classification |
|---|---|---|
| WorkManager synchronized completed sessions before queued reports, causing all four reports to be rejected. | Session association now accepts observations whose `observedAt` is inside the owned session's start/end window and rejects observations outside it. Regression test added; final DB has all four reports under D0. | Codex-testable |
| The media upload request checksum was removed by the Fastify/OpenAPI body schema and returned header serialization. | Added checksum to the request contract and regression coverage. | Codex-testable |
| Signed PUT returned MinIO HTTP 400 `AccessDenied`: checksum metadata was already in the presigned URL but Android resent it as an unsigned header. | Removed the duplicate response/client PUT header while retaining checksum metadata in the signed URL and HEAD verification. A direct signed PUT returned HTTP 200 and both E2E objects reached `ready`. | Codex-testable |
| Full-stack tests would otherwise run without their required disposable services. | Added explicit `-e fieldE2E true` opt-in; the generic instrumentation run skips the four full-stack phases cleanly. | Codex-testable |
| Initial final build used the localhost API override for release and correctly failed `releaseConfigSmoke` because release URLs must be HTTPS. | Reran release with an HTTPS placeholder; R8 minification and `assembleRelease` passed. No assertion was weakened. | Codex-testable |
| First dashboard build could not fetch declared Google Fonts in the restricted network. | Reran with network access; production build passed. | blocked by missing environment (first attempt), Codex-testable (final) |
| Full dashboard `npm run lint` produced no result for more than three minutes and was interrupted; it is not claimed as passed. | Targeted report lint from the earlier matrix passed; full dashboard lint remains unresolved. | Codex-testable |

Harness-only setup failures were retained in the log and not presented as product regressions: missing emulator permission grants after `pm clear`, an initial build using the phone LAN URL instead of the localhost override, stale Gradle JDK daemon configuration, and one mistyped non-existent test-class invocation during development.

### Final regression/build results

| Command group | Result | Classification |
|---|---|---|
| API field/media/reports | 47/47, 26/26, and 13/13 passed; typecheck and build passed. | Codex-testable |
| Dashboard report tests | 9/9 passed. | Codex-testable |
| Dashboard production build | Passed (87 routes generated). | Codex-testable |
| Dashboard full lint | Interrupted after >3 minutes with no output; no pass claim. | Codex-testable |
| Android JVM tests, lint, debug build | Passed. | Codex-testable |
| Android generic instrumentation | 26 discovered plus four opt-in E2E methods skipped; 0 failures on API 36. Gradle's device summary displayed `30/26` because skipped opt-in methods are additionally reported by the runner. | Codex-testable |
| Android minified release | `minifyReleaseWithR8`, lint vital, and `assembleRelease` passed; artifact remains debug-signed and is not publishable. | Codex-testable |

### Exact E2E commands

Environment variables below represent disposable test credentials; no service credential was put in Android.

```bash
# API and dashboard
DATABASE_URL="$FIELD_TEST_DATABASE_URL" NODE_ENV=test R2_ENDPOINT=http://127.0.0.1:59000 npm run dev
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3001 npm run dev -- --hostname 127.0.0.1 --port 3000

# Android build/install (apps/mobile/field-surveyor-android)
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' ./gradlew --no-daemon -Dorg.gradle.java.home='/Applications/Android Studio.app/Contents/jbr/Contents/Home' -PfieldApiBaseUrl=http://127.0.0.1:3001 :app:assembleDebug :app:assembleDebugAndroidTest
adb -s emulator-5554 install -r app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-5554 install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s emulator-5554 reverse tcp:3001 tcp:3001
adb -s emulator-5554 reverse tcp:59000 tcp:59000

# Each phase used this command shape; METHOD was phase1_onlineCapture,
# phase1b_offlineCaptureDirectionSwitchAndFinish,
# phase2_restartAuthRefreshAndWorkManagerFailure, then
# phase3_mediaRetryHistoryAndFinalPersistence.
adb -s emulator-5554 shell am instrument -w -e fieldE2E true -e class com.coremapmm.fieldsurveyor.e2e.FieldFullStackE2ETest#METHOD com.coremapmm.fieldsurveyor.test/androidx.test.runner.AndroidJUnitRunner

# Final regression/build matrix
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' ./gradlew --no-daemon -Dorg.gradle.java.home='/Applications/Android Studio.app/Contents/jbr/Contents/Home' -PfieldApiBaseUrl=http://127.0.0.1:3001 testDebugUnitTest connectedDebugAndroidTest lintDebug assembleDebug
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' ./gradlew --no-daemon -Dorg.gradle.java.home='/Applications/Android Studio.app/Contents/jbr/Contents/Home' -PfieldApiBaseUrl=https://api.coremap.example assembleRelease

# apps/api
npm run test:field && npm run test:media && npm run test:reports && npm run typecheck && npm run build

# apps/dashboard
npm run test:reports
npm run lint                 # interrupted; no pass claim
npm run build                # final network-enabled run passed
```

### Evidence and changed files

- [D0 survey started](evidence/field-e2e-2026-09-07/01-survey-d0-started.png)
- [D1 offline survey](evidence/field-e2e-2026-09-07/02-survey-d1-offline.png)
- [Survey History](evidence/field-e2e-2026-09-07/03-survey-history.png)
- [Dashboard report review](evidence/field-e2e-2026-09-07/04-dashboard-reports.png)
- [Filtered Android E2E log](evidence/field-e2e-2026-09-07/android-e2e.log)

Files changed specifically for this continuation: `apps/api/src/scripts/field-e2e-seed.ts`, `apps/api/src/modules/field/survey-sessions.service.ts`, `apps/api/src/modules/field/survey-sessions.test.ts`, `apps/api/src/modules/field/field-reports.service.ts`, `apps/api/src/modules/media/media.openapi.ts`, `apps/api/src/modules/media/media.openapi.test.ts`, `apps/api/src/modules/media/media.service.ts`, `apps/api/src/modules/media/media.service.test.ts`, Android `app/build.gradle.kts`, `data/FieldMediaApi.kt`, `work/MediaSyncRunnerTest.kt`, and `e2e/FieldFullStackE2ETest.kt`, plus this evidence directory and report. **Classification: Codex-testable.**

### Required next phases

| Priority | Required next evidence | Classification |
|---|---|---|
| P0 | Make server media dimension/duration metadata part of the tested upload contract; rerun portrait, landscape, and voice flows. | Codex-testable |
| P0 | Diagnose the full-dashboard ESLint stall and make it deterministic in CI. | Codex-testable |
| P0 | Repeat against a dedicated hosted staging Supabase project and private R2 bucket, including signed URL expiry and provider outage telemetry. | blocked by missing environment |
| P0 | Configure genuine production signing and prove upgrade lineage. | blocked by missing environment |
| P1 | Repeat on physical devices during static, walking, and bus-speed movement, including Doze/OEM process killing and real permission revocation. | real-field-only |

The disposable E2E stack passes the requested automated data path, but production remains **NO-GO** pending hosted staging/R2, production signing, server media metadata completion, deterministic dashboard lint, and physical field qualification.

## Performance, battery, and network-data audit — 2026-09-07

Tested at commit `44cd36f30c6433ebe93a0919e4b17991f2e9b5c3` with the existing dirty-tree hardening changes. Production was not mutated. Android runtime measurements used the Pixel 9a Android 16/API 36 emulator; database measurements used a disposable local PostGIS 16/3.4 container.

### Before/after finding and fix

| Finding | Before | After | Classification |
|---|---|---|---|
| Local Survey History was unbounded. | `observeHistory()` collected every session and its correlated report count into one list. This would grow indefinitely. | The screen observes 50 newest rows initially, exposes explicit 50-row “Load more” increments, and caps one screen subscription at 500. A Room test inserted 75 sessions and verified a 50-row newest-first result. | Codex-testable |

Changed files for this fix: Android `data/LocalSurveySessionDao.kt`, `data/SurveySessionRepository.kt`, `ui/settings/SurveyHistoryScreen.kt`, instrumentation `data/SurveySessionDaoTest.kt`, and the test fake in `work/SurveySessionSyncRunnerTest.kt`. No cache or framework was introduced.

### Android implementation audit

| Check | Evidence/result | Classification |
|---|---|---|
| No location subscription outside an active survey | Idle `dumpsys location` showed fused and GPS provider requests `OFF`; idle service dump was empty. Startup/Locate use cancellable one-shot requests. Continuous tracking is entered only from persisted survey start/restore and removed by `GpsEngine.stop()`. | Codex-testable |
| No leaked foreground service | Service restores only a persisted active survey, self-stops otherwise, removes the notification on stop, and the emulator idle service dump contained `(nothing)`. Lifecycle tests and the prior finish/restart E2E pass. | Codex-testable |
| Wake lock/screen awake | No `WAKE_LOCK`, `FLAG_KEEP_SCREEN_ON`, `KEEP_SCREEN_ON`, or `PowerManager.WakeLock` usage exists in app source/manifest. WorkManager may use platform-managed execution locks, not a permanent app lock. | Codex-testable |
| Tracking cadence | Fused request target is 4,000 ms, minimum 2,000 ms, minimum displacement 5 m, high accuracy, and only active during surveys. Emulator configuration is verified; actual callback cadence and GNSS duty cycle require field measurement. | Codex-testable for configuration; real-field-only for actual cadence/power |
| Recommendation recomputation | Route recommendations run only from the explicit button/permission completion and query Room. In-survey nearby-stop calculation is separately gated by 10 m movement or 10 seconds. It is not an API call. | Codex-testable |
| Movement network usage | `acceptFix` updates bounded in-memory state/Room-derived nearby stops only. No API request or GPS-point upload occurs per fix; reports are explicit user actions. | Codex-testable |
| Collector/listener/coroutine bounds | Compose state uses lifecycle-aware collection; map, camera, player, and lifecycle listeners use `DisposableEffect`; one-shot work is cancelled; GPS owns one callback; workers process at most 20 rows per run. No unbounded collector was identified. Long-duration leak confirmation remains manual/profiling coverage. | Codex-testable / real-field-only |
| WorkManager storm prevention | Reports and media use separate unique work names with `KEEP`; media cellular override uses `REPLACE` on the same serialized queue. Reports require `CONNECTED`, default media requires `UNMETERED`, backoff is exponential at 15 seconds, and row claims have leases. Ten-user load had zero connection failures; no retry storm was observed. | Codex-testable |
| Repeated navigation/map disposal | Map lifecycle/listeners are disposed and lists use stable keys/LazyColumn. Existing navigation/emulator suite passes, but a long repeated-navigation heap-retention test was not available. | Codex-testable for implementation; real-field-only for long soak |
| All-routes responsiveness | Route list is a keyed `LazyColumn`; filtering is memoized on route list/query and recommendations query bounded Room coordinates. No all-Myanmar production snapshot was available for a realistic frame benchmark. | blocked by missing environment |
| Large stop sequence | Stop UI uses lazy/bounded nearby presentation and map stop overlays update on route/selection changes rather than every accepted fix. No production maximum-size route fixture was available for Macrobenchmark jank measurement. | blocked by missing environment |

### Data-usage audit

| Check | Result | Classification |
|---|---|---|
| PMTiles over mobile data | Download is user-triggered and rejects metered networks unless the user explicitly requests the override. There is no background/automatic PMTiles WorkManager job. | Codex-testable |
| Unchanged package | Manifest version, byte size, and SHA-256 are compared; a complete matching package is not downloaded again. | Codex-testable |
| Checksum failure | Download writes to `.tmp`, deletes only the invalid temporary file, and atomically replaces the existing PMTiles only after checksum/size validation. The last valid map is preserved. | Codex-testable |
| Transport refresh | Android sends the local revision; API returns unchanged metadata when it matches; Room replacement occurs only for a validated changed dataset. Failed validation preserves the prior revision/cache. | Codex-testable |
| Recommendations | Bounding-box candidate selection, survey history, and ranking all use Room; no recommendation API exists. | Codex-testable |
| History pagination | Local screen now loads bounded 50-row increments. Server history already uses opaque cursor pagination. | Codex-testable |
| Media demand/loading | History loads media metadata, but JPEG bytes are decoded only after expanding a report via `OnDemandJpegPreview`; dashboard uses short-lived signed access on demand. | Codex-testable |
| Photo upload size | JPEG processing runs off the caller thread, corrects orientation, resizes to configured dimensions, compresses, caps attachments, and validates storage/checksum before enqueue. Instrumentation compression tests pass. | Codex-testable |
| Voice limits | Only AAC/M4A-compatible `audio/mp4` is accepted; minimum and maximum duration are enforced by capture policy and API byte/type limits. Actual microphone/container behavior across OEMs remains field-only. | Codex-testable / real-field-only |
| Reports independent of media | JSON reports use the connected queue; media remains a separate Wi-Fi-default queue. The full E2E proved all four reports synced while media was still retryable, then media completed later. | Codex-testable |

### Emulator measurements

| Metric | Result | Interpretation | Classification |
|---|---:|---|---|
| Cold debug startup | `TotalTime=2162 ms`, `WaitTime=2169 ms` | Emulator/debug/login-screen measurement only, not a release startup SLA. | Codex-testable |
| Memory after startup | total PSS 119,854 KB; total RSS 210,444 KB | Single emulator snapshot after three seconds. Map/large-route retained heap was not measurable without a production snapshot and authenticated fixture. | Codex-testable |
| Startup frames | 5 frames; 4 janky; p50 34 ms, p90 500 ms | Too few cold-start frames for a statistically useful jank rate. Recorded, not treated as a regression result. | Codex-testable |
| Idle GPS/service | fused `OFF`, GPS `OFF`, GNSS not started, no app service | Confirms idle state at capture time. Historical aggregates in `dumpsys` were excluded from the active-state conclusion. | Codex-testable |

Evidence: [startup](evidence/field-performance-2026-09-07/startup.txt), [memory](evidence/field-performance-2026-09-07/meminfo.txt), [gfxinfo](evidence/field-performance-2026-09-07/gfxinfo.txt), [idle location](evidence/field-performance-2026-09-07/location-idle.txt), [idle services](evidence/field-performance-2026-09-07/services-idle.txt), and [database EXPLAIN](evidence/field-performance-2026-09-07/explain.txt).

### API/database performance

The fresh disposable run simulated 10 concurrent surveyors and 102 service/repository/database operations: error rate 0%, expected duplicate sessions 20/20, expected duplicate reports 1/1, write latency p50 45.76 ms / p95 121.57 ms / max 133.48 ms, read latency p50 14.59 ms / p95 16.44 ms / max 16.44 ms, zero operations over 250 ms, and zero connection/database failures. This is local in-process concurrency, not Myanmar WAN latency. **Classification: Codex-testable.**

`EXPLAIN (ANALYZE, BUFFERS)` on the production-shaped synthetic dataset showed route-variant lookup 0.551 ms, route lookup 0.344 ms, paginated session history 3.574 ms, and report count 0.053 ms. Plans used the route/variant uniqueness indexes, `survey_sessions_created_by_started_at_idx`, and `user_reports_survey_session_id_idx`; no relevant sequential scan or new index need was demonstrated. **Classification: Codex-testable.**

### Final commands/results

```bash
# Android
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' ./gradlew --no-daemon -Dorg.gradle.java.home='/Applications/Android Studio.app/Contents/jbr/Contents/Home' -PfieldApiBaseUrl=http://127.0.0.1:3001 testDebugUnitTest connectedDebugAndroidTest lintDebug assembleDebug

# Emulator metrics
adb -s emulator-5554 shell am start -W -n com.coremapmm.fieldsurveyor/.MainActivity
adb -s emulator-5554 shell dumpsys meminfo com.coremapmm.fieldsurveyor
adb -s emulator-5554 shell dumpsys gfxinfo com.coremapmm.fieldsurveyor
adb -s emulator-5554 shell dumpsys location
adb -s emulator-5554 shell dumpsys activity services com.coremapmm.fieldsurveyor

# API/database (disposable local database)
DATABASE_URL="$FIELD_TEST_DATABASE_URL" NODE_ENV=test npx tsx src/scripts/field-hardening-load.ts
psql "$FIELD_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f infrastructure/database/verification/explain_field_app_queries.sql
```

Android final result: JVM tests passed; emulator discovered 27 regular tests plus four explicitly opted-out full-stack methods, with 31 reported/4 skipped/0 failed; lint and debug build passed. The newly added 75-row Room pagination regression passed. **Classification: Codex-testable.**

### Manual measurements still required

| Measurement | Why it remains manual | Classification |
|---|---|---|
| Battery drain, thermal load, and wakelock attribution during 1–4 hour surveys | Emulator power counters do not represent phone radios, SoC, display, or OEM power policy. Measure release builds on target low/mid/high devices. | real-field-only |
| Actual GNSS callback distribution, time-to-first-fix, tunnel/urban-canyon behavior, and accuracy at static/walking/bus speed | Synthetic fixes verify state logic, not Myanmar satellite/radio conditions. | real-field-only |
| Myanmar carrier bytes, latency, loss, reconnects, metering detection, and PMTiles/media cost on 3G/4G/5G | Requires local SIMs, carrier networks, and representative routes/files. | real-field-only |
| Long navigation/map/service soak and OEM background killing | Requires physical devices from target manufacturers and screen-off/Doze testing. | real-field-only |
| Release Macrobenchmark startup/map-load/jank with the complete national transport snapshot and production PMTiles | No production-sized safe fixture or release-signing/staging environment was available. | blocked by missing environment |

## Release and security hardening addendum — 2026-09-07

### Status: BLOCKED

The candidate is **not production-ready** and is not yet approved as a field-test artifact. It was tested from base commit `44cd36f30c6433ebe93a0919e4b17991f2e9b5c3` (`44cd36f-dirty`), Android `0.7.0-pilot` / version code `7`. The working tree is not reproducible, the available release key was only a disposable verification key, dependency advisories remain, hosted Supabase advisor/exposed-schema evidence is unavailable, and no real Myanmar bus test has occurred. **Classification: blocked by missing environment; real-field-only for the Myanmar bus test.**

### Release and security results

| Check | Evidence/result | Classification |
|---|---|---|
| HTTPS release API | Release UI displayed `https://api.coremapmm.com`; read-only `/health` returned HTTP 200 in 0.180 s. The release smoke task rejects cleartext, placeholders, secrets, and unexpected default origins. | Codex-testable |
| Debug/test endpoints | APK DEX scan found no `http://10.0.2.2:3001`, placeholder API, E2E password, service-role marker, private-key marker, or common live-secret marker. Generic localhost strings remain inside third-party Sentry internals and are not `BuildConfig.API_BASE_URL`. | Codex-testable |
| Secrets in source/APK | Removed the disposable E2E password literal: API seed now requires `FIELD_E2E_PASSWORD`; Android E2E requires the `fieldE2EPassword` instrumentation argument. Focused source/APK scans found no embedded service-role key, signing password, JWT, or private key. | Codex-testable |
| Signing | Release now fails closed when `FIELD_RELEASE_STORE_*` or gitignored local equivalents are incomplete; it never falls back to the debug key. APK/AAB verification used a 30-day disposable RSA-3072 key under `/private/tmp`, not production signing material. | Codex-testable for fail-closed behavior; blocked by missing environment for production lineage |
| Minification/resource shrinking | `minifyReleaseWithR8`, resource optimization, lint-vital, `assembleRelease`, and `bundleRelease` passed. | Codex-testable |
| Release launch/authentication | Disposable-signed release cold-launched on Pixel 9a Android 16/API 36 (`TotalTime=765 ms`) and authenticated with the supplied surveyor account against the real HTTPS API, reaching Setup/Sync. No production data write or remote configuration change was performed. | Codex-testable |
| Crash reporting privacy | Sentry remains opt-in by DSN; default PII, screenshots, view hierarchy, ANR dumps, and automatic breadcrumbs are disabled. `beforeSend` removes user/request/breadcrumb payloads and exception messages. No DSN was available to verify remote delivery. | Codex-testable for configuration; blocked by missing environment for delivery |
| Logging | HTTP logs contain method, host, safe path, status, and duration only. PUT media paths are replaced with `[media-redacted]`; exception messages/stacks are no longer logged, only exception type. Unit regressions pass. | Codex-testable |
| Timeouts/retries | API calls are bounded (connect 20 s, call 90 s); PMTiles is now bounded (connect 30 s, read-idle 60 s, total call 180 min). Existing PMTiles retry count and WorkManager exponential retry/unique-work constraints remain bounded. | Codex-testable |
| Authentication expiry | Refresh remains early/rotating; non-auth 401 clears encrypted credentials and returns to Login while retaining local drafts. Existing auth/401 and E2E recovery tests pass. | Codex-testable |
| Android permissions | Release manifest has Internet/network/Wi-Fi state, fine/coarse location, foreground-service location, notifications, optional camera/microphone, plus WorkManager-provided wake-lock/boot permissions. It has no background-location, contacts, storage, phone, SMS, or broad media-read permission. WorkManager wake-lock/boot permissions support bounded scheduled sync; no app-held permanent wake lock exists. | Codex-testable |
| Private media | API tests enforce owner-only pending/ready assets and short-lived signed admin access; publication is explicit and copies sanitized JPEG output. Real provider policy/advisor checks were not available in this pass. | Codex-testable for API; blocked by missing environment for provider |
| Internal schemas | Migration SQL revokes public/client roles and local database verification previously passed. This pass did not have hosted Supabase advisor/config access, so it does not claim that production exposed-schema settings were checked. | Codex-testable locally; blocked by missing environment remotely |
| PMTiles validation/storage | Manifest version, expected size, and SHA-256 are checked; unchanged valid packages are retained, invalid temporary downloads do not replace the last valid map, mobile download requires explicit override, and low-space/error tests pass. Live object reports 768,884,389 bytes. | Codex-testable |
| Documentation | Android README now states mandatory fail-closed signing, privacy-safe crash configuration, and correct release commands instead of the obsolete debug-sign fallback. | Codex-testable |

### Artifact results

| Artifact | Result | Classification |
|---|---|---|
| APK | `app/build/outputs/apk/release/app-release.apk`, 34 MB, SHA-256 `a4c76336b88df49de7fc7eda60b3c81404a435bd8fc96354d02a6198d7527af1`; APK Signature v2 verified with disposable certificate `CN=CoreMap Disposable Release Test`. Not distributable. | Codex-testable |
| AAB | `app/build/outputs/bundle/release/app-release.aab`, 25 MB, SHA-256 `c6f5b53375914d01847a7b9e2691d63c644b0c50ef52908cd8bb80e34ac7a8c6`; bundle signing task passed with the same disposable key. Not distributable. | Codex-testable |
| Field-test build identity | Intended identity remains version `0.7.0-pilot` (7), base commit `44cd36f30c6433ebe93a0919e4b17991f2e9b5c3`, but no field-test build is approved because the tree is dirty and production/pilot signing lineage is unavailable. | blocked by missing environment |

### Final test results

| Suite/check | Result | Classification |
|---|---|---|
| Android JVM | 188 passed, 0 failed after one test-first red failure exposed the missing `media_url` key rule. | Codex-testable |
| Android instrumentation/UI | 31 reported, 4 opt-in full-stack methods skipped, 0 failed on API 36. Skips are not claimed as runs. | Codex-testable; blocked by missing disposable full-stack environment for skipped cases |
| Android lint/debug/release | `lintDebug`, debug APK, release lint-vital, minified APK, and AAB passed. | Codex-testable |
| API | Typecheck/build passed; field 47/47, media 26/26, reports 13/13 passed after compatible audit fixes. | Codex-testable |
| Dashboard | Report tests 9/9, targeted changed-file ESLint, and production build (87 routes) passed. Full-repository ESLint again produced no output for more than three minutes and was interrupted; it is not claimed as passed. | Codex-testable |
| Dependency audit | Compatible `npm audit fix` removed the critical JWT and several router/WebSocket findings. API still reports 4 high, 1 moderate, 1 low; dashboard still reports 3 high. Remaining fixes require forced/breaking or out-of-range upgrades and were not applied speculatively. | Codex-testable |

### Confirmed fixes and changed files

- `apps/mobile/field-surveyor-android/app/build.gradle.kts`: fail-closed release signing and smoke gate for APK/AAB.
- `apps/mobile/field-surveyor-android/app/src/main/java/com/coremapmm/fieldsurveyor/crash/FieldCrash.kt`: privacy-minimal Sentry configuration and final event scrubbing.
- `apps/mobile/field-surveyor-android/app/src/main/java/com/coremapmm/fieldsurveyor/log/FieldLog.kt`: exception and media-URL redaction.
- `apps/mobile/field-surveyor-android/app/src/main/java/com/coremapmm/fieldsurveyor/net/FieldHttp.kt`: bounded PMTiles timeouts and media-path logging policy.
- Android `FieldLogTest.kt`, `FieldHttpTest.kt`, and `FieldFullStackE2ETest.kt`: regression assertions and injected E2E credential.
- `apps/api/src/scripts/field-e2e-seed.ts`: environment-injected disposable password.
- Android README: corrected release/security documentation.
- API/dashboard lockfiles: compatible security remediation from `npm audit fix`; no forced major upgrade.

All findings above are **Codex-testable** unless their row explicitly marks a missing environment or field-only evidence.

### Unresolved blockers and rollback

| Blocker | Required resolution | Classification |
|---|---|---|
| Dirty, uncommitted candidate | Review/commit all intended field changes, build from a clean commit, and regenerate hashes/evidence. | Codex-testable |
| No genuine pilot/production key lineage | Supply secured CI signing material and verify certificate identity plus upgrade installation while preserving Room/outbox. | blocked by missing environment |
| Remaining dependency advisories | Evaluate narrow supported upgrades for `@fastify/swagger-ui`/Prisma chain and Next.js 16.3.4+, rerun all API/dashboard tests, and document applicability. | Codex-testable |
| Hosted security evidence | Run Supabase security/performance advisors, exposed-schema/grant verification, and real private-object signed-access checks against an authorized staging project; production remains read-only. | blocked by missing environment |
| Crash delivery | Configure a staging Sentry DSN and verify scrubbed events without tokens, coordinates, media URLs, email, or request bodies. | blocked by missing environment |
| Full dashboard lint | Diagnose the repository-wide ESLint stall and establish a deterministic CI timeout/result. | Codex-testable |
| Myanmar operational qualification | Execute static/walking/bus-speed tests on target phones and Myanmar networks; measure GNSS, battery, thermals, offline/reconnect, upload retry, and carrier usage. | real-field-only |

Rollback instructions: do not distribute the disposable-signed artifacts. For code rollback, revert only the release-hardening commit once created; restore the prior lockfiles together with their matching package manifests, then rerun the full matrix. For a deployed Android rollback, use a previously approved artifact signed by the **same** production certificate and with a Play-compatible higher version code; do not uninstall because that deletes Room/outbox evidence. For API/dashboard rollback, redeploy the prior immutable image; this pass added no database migration and changed no production data or remote configuration. **Classification: Codex-testable for procedure; blocked by missing environment for actual deployment rehearsal.**

### Exact commands for this pass

```bash
# Android JVM/lint/debug
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' ./gradlew -Dorg.gradle.java.home='/Applications/Android Studio.app/Contents/jbr/Contents/Home' testDebugUnitTest lintDebug assembleDebug

# Emulator instrumentation (four full-stack tests intentionally skip without opt-in environment)
./gradlew --no-daemon -Dorg.gradle.java.home='/Applications/Android Studio.app/Contents/jbr/Contents/Home' connectedDebugAndroidTest

# Release; FIELD_RELEASE_STORE_* referenced a disposable /private/tmp keystore
./gradlew --no-daemon -Dorg.gradle.java.home='/Applications/Android Studio.app/Contents/jbr/Contents/Home' assembleRelease bundleRelease
apksigner verify --verbose --print-certs app/build/outputs/apk/release/app-release.apk

# API
npm run typecheck && npm run test:field && npm run test:media && npm run test:reports && npm run build
npm audit --omit=dev --audit-level=low
npm audit fix

# Dashboard
npm run test:reports
npx eslint src/features/report-management/ReportDetailPage.tsx src/features/report-management/ReportLocationCompareMap.tsx src/features/report-management/api.ts src/features/report-management/types.ts src/features/report-management/fieldEvidenceView.ts src/features/report-management/fieldEvidenceView.test.ts
npm run build
npm audit --omit=dev --audit-level=low
npm audit fix
```

## Final non-field production verification — 2026-09-07

### Final status: BLOCKED

#### 1. Tested version

- Git base: `44cd36f30c6433ebe93a0919e4b17991f2e9b5c3`; tested identity: `44cd36f-dirty`.
- Android: `0.7.0-pilot`, version code `7`.
- Final disposable-signed APK: 34 MB, SHA-256 `f0a6e5c028b62b27195fecc9ed9f05b58e0252ec87cbecef5ee37182444d285a`.
- Final disposable-signed AAB: 25 MB, SHA-256 `319ee350203f137fac16acda778fb99685bd5280e10bad44969acc7ea9635611`.
- The disposable signing key is not a field/pilot key and was removed after verification. **Classification: Codex-testable; blocked by missing environment for genuine signing.**

#### 2. Complete rerun results

| Requested verification | Executed result | Classification |
|---|---|---|
| Android tests | `testDebugUnitTest`: 188 passed, 0 failed. `connectedDebugAndroidTest`: 31 reported, 4 explicitly skipped full-stack methods, 0 failed on Pixel 9a Android 16/API 36. The four skips are not claimed as executed. | Codex-testable; blocked by missing environment for skipped E2E methods |
| API integration/regression | Default API suite: 367 passed, 1 live HTTP smoke skipped, 0 failed. Field 47/47, media 26/26, reports 13/13; typecheck and production TypeScript build passed. These are injection/service/repository-double tests, not a new live database integration run. | Codex-testable; blocked by missing environment for live smoke |
| Database migration tests | **NOT EXECUTED.** Local PostGIS was running, but no disposable `coremap_e2e` database or valid previous field schema existed. `geo_core` lacked the required feedback/transport/media predecessor objects. The configured Supabase database is remote production-like and was not mutated or cloned. Prior evidence is retained but not treated as a rerun. | blocked by missing environment |
| Offline-to-dashboard E2E | **NOT EXECUTED.** The local test API, disposable database, and test media storage used by the earlier run were unavailable. The four Android E2E phases therefore skipped by their explicit safety guard. Existing screenshots/logs are historical evidence only. | blocked by missing environment |
| Lint | Android `lintDebug` and release lint-vital passed. Dashboard `npm run lint` emitted no result and was interrupted; it is not passed. `git diff --check` passed after removing one trailing blank line. | Codex-testable |
| Release build | R8 minification, resource shrinking, fail-closed release config, signed APK, and signed AAB passed with a disposable RSA key. Genuine upgrade/signing lineage was not tested. | Codex-testable; blocked by missing environment for signing lineage |
| Security/advisors | Focused source scan found no Android Supabase client, service-role credential, E2E password, private key, or destructive Room fallback. npm audit failed: API has 4 high + 1 moderate advisories; dashboard has 3 high advisories. Supabase CLI/MCP advisor access was unavailable, so hosted security/performance advisors were not run. Current Supabase changelog was checked; public-table auto-exposure and self-hosted PG17/Envoy changes do not justify altering this private API-only architecture. | Codex-testable; blocked by missing environment for hosted advisors |
| Critical performance | Debug cold start executed: 3,415 ms; after three seconds total PSS 149,110 KB and RSS 236,824 KB. Startup sample had 5/5 janky frames (p50 150 ms, p90 850 ms), too small for a stable benchmark but a negative signal. While installed and idle, fused/GPS provider requests were `OFF`, GNSS `mStarted=false`, and no app service was present. Ten-user database load and EXPLAIN were **not rerun** because the disposable schema was absent. | Codex-testable; blocked by missing environment for database load |
| Dashboard | Report review tests 9/9 passed; production build passed and generated 87 routes. Full ESLint did not complete. | Codex-testable |

#### 3. Final diff review and fixed defects

| Review concern | Final finding | Classification |
|---|---|---|
| Duplicated logic | No new conflicting session/report/D0-D1 implementation was found. API keeps route→schema→service→repo separation; Android policies remain small shared units. This is inspection, not a runtime test. | Codex-testable |
| Direct Android-to-Supabase | No Supabase client or Supabase REST origin exists in Android runtime source; Android calls the Fastify API. | Codex-testable |
| GPS while idle | Executed emulator snapshot showed fused/GPS `OFF`, GNSS stopped, and no foreground service. JVM/emulator lifecycle tests also passed. Physical/OEM behavior remains untested. | Codex-testable / real-field-only |
| Location/network retry loops | Continuous location owns and removes one callback; DAO claims use bounded `repeat(8)` contention attempts; WorkManager is unique/constrained with exponential backoff; PMTiles attempts/timeouts are bounded. File-read `while(true)` loops terminate on EOF and are not retry loops. | Codex-testable |
| Destructive Room migrations | No `fallbackToDestructiveMigration` or equivalent was found. Explicit Room migrations and migration instrumentation passed. | Codex-testable |
| D0/D1 reversal | Bootstrap rejects direction mismatch, opposite selection requires the same route and exactly one opposite direction, and API pairing tests passed. | Codex-testable |
| Report session reassignment | Idempotent replay checks the immutable session association and errors if a client UUID is replayed against another session; tests passed. | Codex-testable |
| Nearby result bounds | Candidate radius is capped at 500 m and ranking output is bounded; API/search limits are capped. No unbounded nearby list was found. | Codex-testable |
| Hardcoded user-facing text | English capture-fact and fallback strings remain in `SurveyReportFlow.kt`; most screen copy uses `FieldLocalization`. This is a localization completeness risk, not a release security defect, and was not changed during this no-feature pass. | Codex-testable |
| Secrets/private media | Focused scan found no credential literal in runtime/test source. Media is private by default and dashboard access uses signed on-demand URLs; live storage policy was not rerun. | Codex-testable; blocked by missing environment for storage provider |
| Automatic canonical modification | Field report/session paths contain no transport writes. `transport.stop_media` changes exist only behind the separate explicit admin publish action; tests verify field capture does not modify canonical transport. | Codex-testable |

Fixed during the final release sequence: release signing now fails closed instead of debug-signing, E2E passwords are injected rather than embedded, PMTiles timeouts are finite, media/exception logs are redacted, Sentry payload collection is minimized, compatible dependency security fixes were applied, release documentation was corrected, and the final diff whitespace defect was removed. Earlier field/data defects and their tests remain documented in preceding addenda. **Classification: Codex-testable.**

#### 4. Remaining risks

- The tree remains dirty and cannot identify a reproducible release commit. **Codex-testable.**
- API and dashboard production dependency audits still fail with high-severity advisories whose proposed fixes require breaking/out-of-range upgrades. **Codex-testable.**
- Full dashboard ESLint still does not complete. **Codex-testable.**
- Database migration, rollback, RLS/grant verification, EXPLAIN, ten-user load, and complete offline-to-dashboard flow were not rerun. **Blocked by missing environment.**
- Genuine field/pilot signing, upgrade preservation, hosted Supabase advisors, real private media storage, and crash-event delivery were unavailable. **Blocked by missing environment.**
- Debug cold-start/jank numbers are not acceptable as production qualification and need a release Macrobenchmark with a production-sized safe snapshot. **Blocked by missing environment.**
- Battery, GNSS, OEM background behavior, and Myanmar carrier conditions are unverified. **Real-field-only.**

#### 5. Exact manual checks still required

1. On secured pilot-signed builds, install as an upgrade over the previous signed version and confirm Room sessions, reports, media, and WorkManager jobs remain intact. **Blocked by missing environment.**
2. Provision a disposable production-shaped PostGIS/Supabase clone and test migration apply from the immediately previous valid schema, verifier, rollback/recovery, grants/RLS, advisors, EXPLAIN plans, and approximately ten concurrent surveyors. **Blocked by missing environment.**
3. Provision isolated test API and private media storage; rerun all four opt-in Android E2E phases and verify Android→API→database→storage→dashboard rows and signed media directly. **Blocked by missing environment.**
4. Resolve or formally assess every remaining npm advisory and make full dashboard ESLint deterministic before generating another candidate. **Codex-testable.**
5. Run release Macrobenchmark startup/map-load/navigation/jank and a long memory/service soak with the intended full transport snapshot. **Blocked by missing environment.**
6. In Myanmar, test static, walking, and real bus-speed movement on supported low/mid-range phones: permission denial/revocation, disabled GPS, tunnels/urban canyon, screen-off/Doze/OEM killing, D0↔D1, offline/reconnect, media retry, battery/thermal drain, and carrier byte/latency/loss measurements. **Real-field-only.**

#### Exact commands executed in this final pass

```bash
# Android (release credentials pointed only to a disposable /private/tmp key)
./gradlew --no-daemon testDebugUnitTest connectedDebugAndroidTest lintDebug assembleRelease bundleRelease

# API
npm test
npm run test:field && npm run test:media && npm run test:reports
npm run typecheck && npm run build

# Dashboard
npm run test:reports
npm run lint        # interrupted without a result; not passed
npm run build

# Security and local environment
npm audit --omit=dev --audit-level=low   # run in apps/api and apps/dashboard; both failed
docker ps
supabase --version                       # command unavailable
git diff --check

# Emulator performance/idle state
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am force-stop com.coremapmm.fieldsurveyor
adb shell am start -W -n com.coremapmm.fieldsurveyor/.MainActivity
adb shell dumpsys location
adb shell dumpsys activity services com.coremapmm.fieldsurveyor
adb shell dumpsys meminfo com.coremapmm.fieldsurveyor
adb shell dumpsys gfxinfo com.coremapmm.fieldsurveyor
```

No production data, remote configuration, canonical transport data, or production media was changed. Because required database/E2E/advisor reruns did not execute and current security/lint/reproducibility blockers remain, the only defensible final status is **BLOCKED**.

## Final production-hardening gate — 2026-09-07 afternoon rerun

### READY FOR FIELD TEST or BLOCKED

**BLOCKED.** Do not give this build to the surveyor phone as a field-test APK.

Reasons that remain hard gates:

1. Working tree is dirty (`44cd36f-dirty`, 166 paths). A release cannot be reproduced from Git. Uncommitted work was not discarded or committed.
2. Permanent internal signing material is absent. `assembleRelease` failed closed: “Release signing credentials are required; debug signing is forbidden.” No surveyor APK, SHA-256, or certificate fingerprint exists for this pass.
3. The required physical-phone checks (real GNSS, screen-off tracking, battery, mobile data, offline-sync, dashboard on the surveyor device) were not run.

Automated local evidence is strong enough to continue engineering, not to approve installation.

| Item | Value |
|---|---|
| Git SHA | `44cd36f30c6433ebe93a0919e4b17991f2e9b5c3` |
| Identity | `44cd36f-dirty` |
| versionName / versionCode | `0.7.0-pilot` / `7` |
| Release API default | `https://api.coremapmm.com` (HTTPS; debug `fieldApiBaseUrl` is ignored for release) |
| APK path / SHA-256 / cert fingerprint | **Not produced.** Signing env unset. |
| Production data | Unchanged. Disposable PostGIS `coremap_e2e` / `coremap_field_test` on `127.0.0.1:55432` and local MinIO only. |

### Tests passed / failed / skipped

| Check | Result |
|---|---|
| Android JVM | **188 passed**, 0 failed, 0 skipped |
| Android instrumentation (no E2E opt-in) | **0 failed**; 4 full-stack methods skipped by design; runner reported 31/27 because skipped opt-in methods are counted extra |
| Android lintDebug | **Passed**; 69 warnings, 0 errors |
| lintVitalAnalyzeRelease | **Passed** |
| assembleRelease / bundleRelease / minified APK | **Failed closed** without the permanent key (correct) |
| API field / media / reports | **47 / 27 / 13** passed (media +1 for loopback path-style) |
| API typecheck | **Passed** |
| Dashboard report tests | **9/9** passed |
| Dashboard targeted ESLint | **Passed** |
| Dashboard full `npm run lint` | **Not claimed** (historically stalls) |
| npm audit (no force upgrades) | API **4 high** (`@fastify/static` via swagger-ui, `deepmerge-ts` via Prisma CLI). Dashboard **3 high** (Next 16.2.1 / postcss / sharp). Fixes need `--force` or out-of-range upgrades; not applied. Treat swagger-ui as **dev-facing**, Next/DoS/XSS as **dashboard-facing**, not Android field APK issues. |
| Supabase advisors (read-only hosted) | Security **87** (85 INFO RLS-enabled-no-policy, 2 WARN extensions in `public`). Performance **550 INFO**. Existing production schema; not “fixed” in this pass. |
| git diff --check | **Passed** |

### Report-flow evidence (disposable stack)

Disposable API + PostGIS + MinIO + dashboard ran locally. Surveyor login, bootstrap, D0 survey, online text/photo/voice capture, airplane-mode offline extra report + D1 zero-report session, force-stop/reopen, then network restore.

PostgreSQL after the Android E2E (before the extra 30-report API soak):

| Assertion | Result |
|---|---|
| Sessions / distinct client IDs | 2 / 2 |
| D0 | completed, **4** reports |
| D1 | completed, **0** reports |
| Reports / distinct public IDs | 4 / 4 |
| Media assets ready / report_media links | 2 / 2 (JPEG + M4A objects present in the private bucket) |
| Canonical route/stop fingerprints | **Unchanged** before vs after |
| Android E2E phases 1, 1b, 2 | **Passed** |
| Android E2E phase 3 (local Room media `SYNCED` after forced retry) | **Failed** (60 s timeout). **No extra media HTTP** during that wait. Server already had the two unique ready assets from phase 1. |

API soak after E2E: 30 additional text reports in 0.28 s, all HTTP 200/201; session and first-report retries returned the same public IDs. Surveyor `GET /admin/reports` = **403**. Dashboard admin list = **200**, 34 items. This is not a two-hour GNSS soak.

### GPS lifecycle evidence

| Expected behavior | Evidence this pass |
|---|---|
| Startup / Locate one-shot; tracking only in survey | JVM `GpsTrackingTest` / `SurveyForegroundLifecycleTest` passed. Tracking request is 4 s / 2 s min / 5 m. |
| Idle app does not keep a foreground service | After force-stop: `dumpsys activity services com.coremapmm.fieldsurveyor` = `(nothing)`. |
| Idle fused/GPS requests | Location manager showed no current CoreMap fused request after force-stop. Historical `dumpsys` lines from earlier emulator sessions are not current activity. |
| Duplicate subscriptions on recreation | Covered by lifecycle unit tests, not a live ActivityScenario GPS radio test. |
| Fixes stored locally, not uploaded per point | Unchanged: no per-fix API. Sessions store lifecycle only. |
| Permission / GPS-off UI | Policy unit tests passed; not re-run as live Settings toggles. |
| Screen-off / Doze / real GNSS | **Not run** (physical phone). |

### Code change in this pass

Loopback MinIO needs S3 path-style URLs. `shouldForcePathStyle` is true only for `127.0.0.1` / `localhost` / `::1`. Production R2 stays virtual-hosted. Media tests 27/27.

Next.js `dev` tried to rewrite `apps/dashboard/tsconfig.json`; that edit was reverted.

### Remaining risks

- Dirty tree and missing permanent signing identity.
- Local media WorkManager did not mark Room `SYNCED` within 60 s after force-stop + forced `RETRY`, even though objects already existed on the server. Field risk: delayed local “pending” after crash/retry, not proven duplicate uploads (server stayed at 2 unique assets).
- 15-minute `SYNCING` lease can delay crash recovery.
- Hosted R2 signed-GET expiry was not re-proven on Cloudflare; code expiry is 5 minutes for admin GET and 10 minutes for PUT.
- Two-hour survey, battery, thermals, and cellular byte counts were not measured.
- Remaining npm advisories require breaking upgrades.

### Manual field tests that cannot be automated here

Run these on the **one known surveyor Android phone**, on a **permanently signed** APK built from a **clean commit**:

1. Cold start: only a one-shot location; idle with screen on then off; confirm no continuous GPS and no tracking notification.
2. Start D0 survey: foreground notification stays visible with screen off; walk/bus movement; Locate recenters without doubling subscriptions.
3. Finish/cancel: GPS and notification stop.
4. Deny location / disable GPS: recoverable UI, then recover.
5. Offline: text, photo, and voice reports; force-stop; reopen; Wi-Fi then cellular sync; confirm each report and media once in dashboard.
6. Repeat D1. Confirm History date, route, D0/D1, status, counts.
7. Confirm feedback never edits canonical routes/stops.
8. Measure battery and mobile-data over a real two-hour duty cycle.

Until those phone checks pass on the signed clean-tree APK, the application is **not** ready for internal field use.

