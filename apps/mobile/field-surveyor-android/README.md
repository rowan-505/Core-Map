# CoreMap Field (Android)

Gradle app module (`:app`). Package folders only. Do not copy `apps/mobile/android-kotlin`.

This app is a field surveyor client of the CoreMap Fastify API. It does not talk to Postgres, Prisma, or Supabase service-role keys.

## Screens

Login → Setup/Sync → Routes | Survey | Settings

- **Login** — `POST /auth/login`. Role must include `surveyor`.
- **Setup/Sync** — `GET /field/bootstrap` (gzip when the phone sends `Accept-Encoding: gzip`) plus an optional Yangon PMTiles download (~730 MB, Wi-Fi by default). Matching `revision` skips the snapshot.
- **Routes** — local Room search. Nearby GPS ranking can suggest a D0/D1 variant.
- **Survey** — local PMTiles, selected path/stops, live GPS, report types, JPEG + short voice, survey session start/complete/abandon.
- **Settings** — Profile, Outbox, survey history, Infra (Yangon map + YBS snapshot).

Not in this app: public consumer map, dashboard, routing UI, automatic points, live bus GPS.

## Offline map

Yangon streets PMTiles stay in `filesDir/basemap/yangon.pmtiles`. Default URL: `https://tiles.coremapmm.com/basemaps/yangon/v1/basemap.pmtiles`. Override with `-PfieldYangonPmtilesUrl=…`.

The app checks free space, checksum, and resume. It does not auto-download ~730 MB. Logout does not delete the map file.

## Survey sessions and reports

Each started survey writes a local session row and later `POST /field/survey-sessions`. Reports are Room `local_reports` rows, then WorkManager `POST /field/reports`. Photos and voice upload through `/media/uploads` + complete + `POST /field/reports/:id/media`. Ownership is enforced on the API (surveyor + report owner).

Outbox unique work `field-outbox-sync` needs a network. Local states: `LOCAL`, `QUEUED`, `SYNCING`, `SYNCED`, `RETRY`, `PERMANENT_ERROR`. Logout clears Keystore tokens only. Drafts stay.

## Authentication

| Method | Path | Body |
|---|---|---|
| POST | `/auth/login` | `{ email, password }` |
| POST | `/auth/refresh` | `{ refreshToken }` |
| POST | `/auth/logout` | `{ refreshToken }` |

Refresh rotates. Access tokens refresh 30 seconds early. A 401 on field/media routes clears local credentials and returns to Login. Drafts stay.

Tokens live in `EncryptedSharedPreferences`. Do not embed JWT secrets, R2 keys, or database URLs in the APK.

## API base URL

`BuildConfig.API_BASE_URL` is a public origin only.

- Debug default: `http://10.0.2.2:3001` (emulator). Physical phones need LAN Fastify in gitignored `local.properties`: `fieldApiBaseUrl=http://<MAC_LAN_IP>:3001`
- Release default: `https://api.coremapmm.com`
- Override any build: `-PfieldApiBaseUrl=…` or env `FIELD_API_BASE_URL`

Debug allows HTTP cleartext. Release forbids cleartext.

## Release signing (do not commit secrets)

Release minification and resource shrinking are on. Release signing is mandatory: `assembleRelease` and `bundleRelease` fail closed if a complete release keystore configuration is missing. A release build never falls back to the debug key.

Gitignored: `local.properties`, `*.jks`, `*.keystore`.

Example `local.properties` (never commit):

```text
fieldReleaseStoreFile=/absolute/path/to/field-release.jks
fieldReleaseStorePassword=…
fieldReleaseKeyAlias=…
fieldReleaseKeyPassword=…
fieldSentryDsn=https://…@….ingest.sentry.io/…
```

Empty `fieldSentryDsn` skips remote crash upload. When configured, Sentry disables default PII, automatic breadcrumbs, screenshots, view hierarchy, and ANR thread dumps; its final event hook removes user/request/breadcrumb payloads and exception messages. Logcat records only the exception type.

## Build / test

```bash
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
# With FIELD_RELEASE_STORE_* set outside the repository:
./gradlew :app:assembleRelease :app:bundleRelease
```

Physical device:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.coremapmm.fieldsurveyor/.MainActivity
```
