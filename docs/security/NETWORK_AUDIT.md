# NIDO Network Audit — Offline Network Audit lane

> **Tree audited:** commit `1390157` + uncommitted UsageStats wiring
> (`M src/ui/ChatScreen.tsx`, `D src/ui/SystemMonitor.tsx` — UI only, no network code).
> **Date:** 2026-09-27 · **Method:** source grep over `src/`, `modules/`, `package.json`;
> correlation with static APK findings (`docs/ci-evidence/apk-static-analysis/STATIC_ANALYSIS_REPORT.md` §F5).
> **Freeze respected:** audit + tests + docs only; no production changes.

## Summary

Exactly **one** code path in the app initiates IP network traffic:
`ModelManager.downloadCatalogModel()` (`src/models/ModelManager.ts`) via
expo-file-system `DownloadResumable`. There is no `fetch(`, no `XMLHttpRequest`,
no `WebSocket`, no background-fetch registration, no analytics/crashlytics SDK,
and no `expo-updates` in the dependency tree. Every other "network-capable"
surface is either local radio (Bluetooth P2P), on-device OS services, or
debug-build-only tooling.

## Per-path register

### N1 — Model & corpus downloads (the only runtime network call site)

| Field | Value |
|---|---|
| File/component | `src/models/ModelManager.ts` → `downloadCatalogModel()` → `FileSystem.createDownloadResumable` |
| Trigger | Setup wizard (mandatory first run); Settings → Model Catalog (user taps download); auto-resume on app-foreground (`SetupWizardScreen` AppState listener) continuing a user-initiated download |
| Destinations | `huggingface.co` (LLM/embedding weights, revision-pinned via `pinnedSourceUrl()`); `raw.githubusercontent.com/rferrari/boar-app/main/...` (corpus JSON — **not** revision-pinned, see SF-2); `github.com/.../releases/download/...` (knowledge-pack SQLite, `manifest.ts`) |
| User-initiated | Yes (initial tap / wizard). Foreground auto-resume continues the user's own pending download; no new asset is ever fetched without user action |
| Required | Once: `requiredModelsPresent()` gates first-run; after that, never required again |
| No-network behavior | Inactivity timeout (`DOWNLOAD_INACTIVITY_TIMEOUT_MS` with zero progress callbacks) → `pauseAsync()`, partial file + resume token kept; Retry resumes from byte offset. Genuine failures delete the partial and throw a descriptive error |
| Automatic/background | Pauses when backgrounded (expo-file-system stops progress callbacks); `download-wake-lock` native module holds a wakelock during active download to avoid mid-download sleep |
| Data transmitted | Receives bytes only. Sends: TLS handshake + HTTP GET. Privacy note: the URL path reveals *which* model is fetched to the host/CDN |
| Controls | sha256 per asset in `MODEL_CATALOG`; HF URLs revision-pinned; post-download size check (always) + automatic sha256 verify for assets ≤ 256 MB (`CHECKSUM_VERIFY_MAX_BYTES`); on-demand "Verify integrity" for large weights; storage-budget pre-check refuses before any request; every request logged to `networkAudit` with query strings stripped (`sanitizeEndpoint`) |

### N2 — P2P transport (no IP network)

| Field | Value |
|---|---|
| File/component | `modules/nido-p2p` (`NidoP2PManager.kt`: `BluetoothSocket`/`BluetoothServerSocket`, RFCOMM) + `src/p2p/` protocol (pure TS) |
| Trigger | User opens NIDO screen, scans/pairs; message send |
| Destinations | Paired phone's Bluetooth MAC only — no IP, no internet |
| Data | End-to-end encrypted frames (secretbox, session keys); handshake signed (v2) |
| Controls | `parseHello` strictly validates (15 new malformed-input tests); legacy unsigned v1 handshake rejected with upgrade hint |

### N3 — Voice input (OS service; network use is device-dependent)

| Field | Value |
|---|---|
| File/component | `modules/voice-input` → Android `SpeechRecognizer` with `EXTRA_PREFER_OFFLINE` |
| Trigger | User taps the voice button |
| Caveat | Whether recognition stays offline depends on the device's recognition service and its offline packs. Documented honestly in the module KDoc (unavailable on de-Googled builds → surfaces "unavailable", never silently degrades). **The "100% offline" claim needs this caveat for voice** (see SF-3) |

### N4 — Notifications (local only)

| Field | Value |
|---|---|
| File/component | `src/notify/notifications.ts` (expo-notifications), `src/routines/startup.ts` |
| Network | None: no `getExpoPushTokenAsync`/`getDevicePushTokenAsync` anywhere in `src/`. FCM receiver components exist in the APK (expo-notifications transitive) but are inert without a token request or google-services config |
| Trigger | Local reminders/briefings; all scheduling on-device |

### N5 — Telemetry (local only, user-mediated export)

| Field | Value |
|---|---|
| File/component | `src/services/executionTelemetry.ts` → SQLite; export via `Sharing.shareAsync` |
| Network | None. Export writes a temp file and opens the OS share sheet — the *user* picks the transport; the app transmits nothing itself. Prompt/response text deliberately never stored |

### N6 — Agent tool `open_app` (external handoff, not app traffic)

| Field | Value |
|---|---|
| File/component | `src/agent/tools/handlers.ts` → `openAppHandler` → `Linking.openURL(target)` |
| Trigger | User asks the agent to open a link/package; scheme URLs (`https:`, `tel:`, `sms:`, `mailto:`) only |
| Network | The app performs no request; the OS hands the URL to the browser/dialer. Documented here so the handoff is not mistaken for app-initiated traffic |

### N7 — Debug-build-only surfaces (absent from release)

`expo-dev-client` (`exp.host/--/api/v2`, Metro `10.0.2.2:8081`/`localhost:8081`),
`expo-dev-launcher` (ML Kit barcode-scanning `debugOnly` Gradle deps, on-device),
`SYSTEM_ALERT_WINDOW`. Correlated with static APK §F5: present in the debug APK,
not part of the release configuration.

### Absent (verified by grep)

`fetch(`, `XMLHttpRequest`, `WebSocket`, `expo-updates`, BackgroundFetch/TaskManager
registration, Crashlytics/Sentry/Mixpanel/AppsFlyer/GA, remote font/asset loading,
i18next HTTP backend, push-token registration.

## Correlation with static APK findings (§F5)

| Static finding | Source verdict |
|---|---|
| Metro URLs (`10.0.2.2:8081`) | Confirmed: `expo-dev-client` dep, debug-only (N7) |
| `exp.host` endpoints | Confirmed: dev-client, debug-only (N7) |
| `u.expo.dev/<uuid>` string | Present in dev-client strings; `expo-updates` NOT in `package.json` → no OTA check runs. Confirmed inert |
| FCM components | `expo-notifications` dep; no token API used in `src/` → inert (N4) |
| ML Kit barcode | `expo-dev-launcher` `debugOnly` Gradle dep (`node_modules/expo-dev-launcher/android/build.gradle:153-154`) → debug-only, on-device (N7) |
| okhttp3 | React Native Fresco image pipeline transitive dep; no app-initiated HTTP calls found |
| No analytics SDKs | Confirmed at source level too |

## Verdict: the offline product claim

**Claim:** after required model acquisition, normal agent operation can remain offline.

**Verdict: SUPPORTED, with two documented caveats.**

Evidence:
- The sole network call site (N1) is user-initiated, one-time-per-asset, and gated:
  `requiredModelsPresent()` is the only app-flow dependency on network ever having
  been used. Chat, RAG, agent tools, memory, routines, telemetry, P2P — all local.
- `networkAudit.isPristine()` gives the user a runtime check: zero entries means
  zero requests this session.
- Static APK analysis found no hidden endpoints beyond dev tooling.

Caveats (both pre-existing, now written down):
1. **Voice input (N3/SF-3):** offline-ness depends on the device's speech service.
2. **Corpus provenance (SF-2):** corpus bytes come from a third-party repo's moving
   branch; integrity is enforced by sha256 (auto-verified for these small files),
   so a change fails loud rather than poisoning silently — but availability depends
   on upstream.

## Security findings (queued, not fixed — freeze)

- **SF-1 — `fromExecutionRow` throws on corrupt `reason_codes`:** `src/services/executionTelemetry.pure.ts:95`
  does `JSON.parse(r.reason_codes)` unguarded. One corrupt telemetry row aborts
  `listRecentExecutions()` and breaks the Telemetry screen. Severity: low
  (local data, no exfil; availability of a diagnostics screen). Proposed fix:
  try/catch → treat corrupt cell as `undefined`; validate shape. Locked in by
  `src/services/executionTelemetry.corrupt.test.ts` ("DOCUMENTED FAILURE PATH").
- **SF-2 — Corpus URLs not revision-pinned:** `pinnedSourceUrl()` only rewrites
  `/resolve/main/` (Hugging Face). Corpus packs at `raw.githubusercontent.com/.../main/...`
  track a moving third-party branch, contradicting the manifest's "always fetches the
  exact bytes the sha256 was computed against" guarantee. Severity: low-medium
  (mitigated: auto sha256-verify ≤256 MB makes tampering fail loud, not silent).
  Proposed fix: pin corpus `sourceUrl`s to a commit hash (`/<sha>/` paths).
  Locked in by `src/models/pinnedSource.test.ts` ("DOCUMENTED GAP").
- **SF-3 — Voice-input offline caveat (docs):** the "100% offline / cero red" product
  language should name the Android SpeechRecognizer dependency. Severity: docs-only.
  Proposed fix: one-line caveat in user-facing offline claims + MODELS.md scope note.

## Private-alpha requirements (carried)

- The private-alpha APK **MUST BE STANDALONE**: contain its JS bundle and cold-launch
  with no Metro, no `adb reverse`, no dev server, no second computer.
- The run-36330270921 debug APK (`bundleInDebug=false`, Metro-dependent) is
  **COMPILED evidence + development-device baseline only** — it proves Android
  compiles, not that the app is shippable.

*New tests this lane: `pinnedSource.test.ts`, `networkAudit.limits.test.ts`,
`hello.malformed.test.ts`, `executionTelemetry.corrupt.test.ts`,
`storageBudget.edge.test.ts` — 39 tests, suite 56 files / 688 green, `tsc` clean.*
