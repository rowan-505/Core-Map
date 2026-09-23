# CoreMap Field (Android)

Gradle app module (`:app`). Package folders only. Do not copy `apps/mobile/android-kotlin`.

This app is a field surveyor client of the CoreMap Fastify API. It does not talk to Postgres, Prisma, or Supabase service-role keys.

## Screens

Login → Setup/Sync → Routes | Survey | Settings

- **Login** — `POST /auth/login`. Role must include `surveyor`.
- **Setup/Sync** — `GET /field/bootstrap` (gzip when the phone sends `Accept-Encoding: gzip`) plus an optional Yangon PMTiles download (~120 MB for v2; Wi-Fi or mobile data). Matching `revision` skips the snapshot.
- **Routes** — local Room search. Nearby GPS ranking can suggest a D0/D1 variant.
- **Survey** — local PMTiles, selected path/stops, live GPS, report types, JPEG + short voice, survey session start/complete/abandon.
- **Settings** — Profile, Outbox, survey history, Infra (Yangon map + YBS snapshot).

Not in this app: public consumer map, dashboard, routing UI, automatic points, live bus GPS.

## Offline map

Yangon streets PMTiles stay in `filesDir/basemap/yangon.pmtiles`. Default URL: `https://tiles.coremapmm.com/basemaps/yangon/v2/basemap.pmtiles`. Override with `-PfieldYangonPmtilesUrl=…`.

The app checks free space, checksum, and resume. It does not auto-download ~120 MB. Logout does not delete the map file. A local v1 file is replaced when Setup downloads v2.

## Survey sessions and reports

Each started survey writes a local session row and later `POST /field/survey-sessions`. Reports are Room `local_reports` rows, then WorkManager `POST /field/reports`. Photos and voice upload through `/media/uploads` + complete + `POST /field/reports/:id/media`. Ownership is enforced on the API (surveyor + report owner).

Outbox unique work `field-outbox-sync` needs a network. Local states: `LOCAL`, `QUEUED`, `SYNCING`, `SYNCED`, `RETRY`, `PERMANENT_ERROR`. Logout clears Keystore tokens only. Drafts stay.

## Authentication

| Method | Path | Body |
|---|---|---|
| POST | `/auth/login` | `{ email, password }` |
| POST | `/auth/refresh` | `{ refreshToken }` |
| POST | `/auth/logout` | `{ refreshToken }` |

Refresh rotates. Access tokens refresh 30 seconds early. On CoreMap API 401 the client refreshes once and retries; credentials clear only if that refresh fails. R2 media PUT 401s do not clear the session. Drafts stay.

Tokens live in `EncryptedSharedPreferences`. Do not embed JWT secrets, R2 keys, or database URLs in the APK.

## API base URL

`BuildConfig.API_BASE_URL` is a public origin only. **Release** always uses `https://api.coremapmm.com`.

**Debug (physical phone, recommended):** USB tunnel so Wi-Fi changes do not break login.

```bash
# terminal 1 — API reachable on the Mac
cd apps/api && HOST=0.0.0.0 PORT=3001 npm run dev

# terminal 2 — phone localhost → Mac :3001
./apps/mobile/field-surveyor-android/scripts/adb-reverse-api.sh
```

The debug app auto-picks `http://127.0.0.1:3001` on real phones and `http://10.0.2.2:3001` on emulators. On the login screen you can also set a temporary Debug API URL (saved on device) without editing `local.properties`.

Do **not** bake a Mac LAN IP into `local.properties` for daily use — that IP changes when Wi-Fi changes.

Optional build-time override still works: `-PfieldApiBaseUrl=…` or `FIELD_API_BASE_URL`.

Debug allows HTTP cleartext. Release forbids cleartext.

## Release signing (do not commit secrets)

Release minification and resource shrinking are on. Release signing is mandatory: `assembleRelease` and `bundleRelease` fail closed if a complete release keystore configuration is missing. A release build never falls back to the debug key.

Gitignored: `local.properties`, `keystore.properties`, `*.jks`, `*.keystore`.

Copy `keystore.properties.example` to gitignored `keystore.properties` and fill all four keys. Complete `FIELD_RELEASE_STORE_*` environment variables take precedence when all four are set. Incomplete environment variables do not mix with the file. Release never uses the debug key.

Tracked template (`keystore.properties.example`):

```text
storeFile=/absolute/path/to/coremap-internal-release.jks
storePassword=REPLACE_LOCALLY
keyAlias=coremap-release
keyPassword=REPLACE_LOCALLY
```

Optional Sentry DSN in gitignored `local.properties`:

```text
fieldSentryDsn=https://…@….ingest.sentry.io/…
```

Empty `fieldSentryDsn` skips remote crash upload. When configured, Sentry disables default PII, automatic breadcrumbs, screenshots, view hierarchy, and ANR thread dumps; its final event hook removes user/request/breadcrumb payloads and exception messages. Logcat records only the exception type.

## Build / test

Gradle needs a **full JDK 21** with `jlink` (Homebrew OpenJDK or Android Studio JBR). Do not use Cursor’s Red Hat Java extension JRE — it is missing `jlink` and fails `:app:compileDebugJavaWithJavac`.

`gradle.properties` already sets `org.gradle.java.home` to Homebrew OpenJDK 21 and `android.disableJdkImageTransform=true`. Cursor/VS Code users also get `.vscode/settings.json` for the same path.

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
