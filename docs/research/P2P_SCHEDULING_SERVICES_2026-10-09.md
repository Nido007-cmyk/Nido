# Open-source patterns for NIDO: P2P/Bluetooth, scheduling, background services — 2026-10-09

**Scope:** read-only research. Open-source Android projects with patterns
relevant to NIDO's Bluetooth RFCOMM P2P, on-device reminder scheduling, and
battery-efficient foreground service. License verified per project; verdict on
whether code could be adapted (with attribution) or ideas-only.

## 1. Briar — https://briarproject.org

- **License:** GPL-3.0-or-later. **Verdict: IDEAS ONLY** (copyleft, incompatible with NIDO's MIT).
- **What it is:** the canonical offline Android P2P messenger — 10+ years in
  production, independently security-audited, works over Bluetooth, Wi-Fi, and
  Tor with no servers. The project that has actually survived Android killing
  background connections for a decade.
- **Patterns worth adopting:**
  - **Store-and-forward over persistent sessions:** messages queued in an
    encrypted local DB, synced opportunistically when a contact is in range —
    never assume a link is alive; treat every contact sync as a fresh
    negotiation.
  - **Foreground service as the lifeline:** changelogs document stewardship
    explicitly ("Keep foreground service running until DB compaction
    completes") — the long-lived process is deliberately kept, not left to
    chance.
  - **Per-Android-version Bluetooth hardening:** release history repeatedly
    carries "Fix Bluetooth connectivity on Android N" entries — budget for
    per-OS-version Bluetooth quirks as a permanent maintenance line, not a
    one-off fix.
  - **Battery-conscious sync:** sessions are bounded and batched; the radio
    is never held open continuously.
- **Next step:** study Briar's published transport-plugin and sync-scheduling
  design docs as the reference architecture for "two tablets, intermittent
  link, zero servers."

## 2. BlueLib — https://github.com/cybersafetyid/bluelib

- **License:** Apache-2.0. **Verdict: CODE ADAPTABLE with attribution**
  (caveat: very new, ~1 star — treat docs as expert guidance, not
  battle-tested code).
- **What it is:** Kotlin-first Android Bluetooth library (BLE + Classic
  RFCOMM/L2CAP) with a troubleshooting guide documenting exactly the failure
  modes NIDO is hitting (handshake timeouts, silent link loss).
- **Patterns worth adopting (concrete):**
  - **Reconnect-with-backoff driven by a state observable:** on
    `DISCONNECTED`, retry — the trigger is the *state transition*, not a timer
    or a "lost" event. Directly relevant to NIDO's bug where the peer looks
    "visible" but the link is dead: gate retry on actual link state, not
    presence.
  - **Never leak sockets:** a socket that was never `close()`d eventually
    makes *every* subsequent connect fail (GATT 133 pattern). Diagnosis rule:
    repeated 133s = leaked connection somewhere.
  - **Stop scanning before connecting:** discovery and an active BR/EDR
    connection compete for the radio; open the link *after* discovery stops.
  - **Scan-then-connect while fresh:** connecting to a long-ago-observed
    device fails often; connect only from fresh discovery results.
  - **Typed `isRetryable` error taxonomy:** every error carries a stable code
    + retryable flag + docs anchor, so retry logic is data-driven instead of
    string-matching exceptions.
  - **Bond-loss awareness (Android 16.1+/17):** handle bond-loss reasons; if
    the platform is running its own re-pairing flow, wait instead of showing
    a pairing prompt.
- **Next step:** adopt the "retry on DISCONNECTED state + isRetryable
  taxonomy + always close()" discipline in NIDO's P2P link manager; use its
  permission matrix (API 21–37) as the checklist for NIDO's Bluetooth
  permission handling.

## 3. Eccles BlueChat — https://github.com/Igwe-Starking/eccles-bluechat-e2ee

- **License:** MIT. **Verdict: CODE ADAPTABLE with attribution** — transport
  and session-management patterns only, **NOT the crypto** (author explicitly
  flags it as hand-rolled and unreviewed).
- **What it is:** Android chat over **Bluetooth Classic RFCOMM**, zero
  INTERNET permission, pairing + encrypted handshake between two phones —
  essentially NIDO's P2P transport in miniature.
- **Patterns worth adopting:**
  - **Framed wire protocol:** length-prefixed framing with CRC-checked parsing
    that *resyncs on garbage* — a corrupted frame never kills the stream.
  - **Trust-on-first-use fingerprint pinning:** peer fingerprint shown for
    out-of-band verification; any change surfaces an explicit warning —
    maps directly onto NIDO's QR-pairing trust model.
  - **AndroidKeystore-backed identity keys** outside backup/restore; decrypted
    media only in a non-backed-up cache wiped on every start.
  - **Dedicated `receivers/` for Bluetooth state**, separate from messaging.
- **Next step:** borrow its Reader/Writer framing + resync design and the
  TOFU fingerprint-change warning UX for NIDO's handshake path.

## 4. prayer-reminder — https://github.com/haichteque/prayer-reminder

- **License:** MIT. **Verdict: CODE ADAPTABLE with attribution.**
- **What it is:** React Native + Expo app doing reliable exact alarms on
  Android (five daily alarms that must fire during deep Doze). Architecturally
  the closest match to NIDO's reminder needs.
- **Patterns worth adopting:**
  - **7-day rolling horizon:** pre-schedule all upcoming alarms 7 days out —
    a missed reschedule costs hours, not the whole feature.
  - **Exact alarms via `@notifee/react-native`:** `TimestampTrigger` +
    `allowWhileIdle: true` on top of AlarmManager, with
    SCHEDULE_EXACT_ALARM/USE_EXACT_ALARM — the Expo-compatible way to survive
    deep Doze without custom native modules.
  - **Recompute & re-arm on every relevant change** (preferences, offsets)
    plus boot and package-replace reschedule receivers.
  - **Pipeline architecture:** input → calculation → merge → offsets →
    future-only filter → scheduler → AlarmManager → notification channel.
    Past timestamps are skipped, never duplicated.
  - **Expo config plugins** for native needs (raw assets, Maven repos,
    ProGuard rules) — the playbook for adding native capability without
    ejecting.
- **Next step:** prototype NIDO's reminder scheduling on
  `@notifee/react-native` timestamp triggers with a rolling horizon, wired
  through Expo config plugins, before writing custom native alarm code.

## 5. saturn — https://github.com/gosub/saturn

- **License:** GPL-3.0. **Verdict: IDEAS ONLY** (but its architecture is
  nearly a 1:1 template: an *agentic* alarm clock with LLM + on-device
  scheduling).
- **Patterns worth adopting:**
  - **One-shot exact alarm, not a repeating one:** schedule only the *next*
    alarm; recurring tasks reschedule *after each fire* with a deterministic
    fallback — a single missed alarm can't cascade.
  - **Receiver → foreground service pipeline:** BroadcastReceiver wakes a
    foreground service which runs the cycle; Done/Snooze actions handled
    **locally without the LLM** — the hot path never depends on the model.
  - **Degraded firing:** "Reminders fire even when the model is unreachable
    (raw task text, retried with backoff)" — the exact resilience rule NIDO's
    delegated tasks need.
  - **DST-safe wall-clock recurrence** across daylight-saving changes.
  - **BootReceiver** reschedules after reboot; SQLite single source of truth.
- **Next step:** adopt this component split as NIDO's reminder architecture:
  `TaskScheduler` (next one-shot exact alarm) → `TaskReceiver` →
  `TaskService` (foreground) → `TaskActionReceiver` (model-free) →
  `BootReceiver`, with deterministic fallback when the model is unreachable.

## 6. expo-geopulse — https://github.com/ramon3198/expo-geopulse

- **License:** MIT. **Verdict: CODE ADAPTABLE with attribution.**
- **What it is:** React Native + Expo (New Architecture, Kotlin-first)
  background SDK — the closest existing example of a battery-efficient
  long-lived foreground service inside an Expo app.
- **Patterns worth adopting:**
  - **Declared foreground service type + Expo config plugin:** injected by a
    one-line config plugin — no manual manifest surgery, survives
    `expo prebuild --clean`.
  - **Battery intelligence:** activity recognition + significant-motion sensor
    *stop the radio/GPS while stationary*; adaptive accuracy presets with
    **auto-degrade on low battery**. NIDO's P2P service should throttle
    discovery/advertising the same way.
  - **Headless-safe data pipeline:** buffering + persistence works *without
    the JS runtime* — the native side never assumes React Native is alive.
    Critical for NIDO's P2P link surviving JS thread stalls.
  - **Permission-level reporting with degraded mode:** reports none /
    foregroundOnly / background and degrades gracefully instead of crashing.
  - **Restart on boot** with persisted config; offline SQLite persistence +
    batched WorkManager sync with retry/backoff.
- **Next step:** model NIDO's P2P foreground service on this: declared
  `foregroundServiceType` via config plugin, activity-aware radio throttling,
  headless-safe native pipeline, honest degraded-mode states.

## 7. batre — https://github.com/nongbit/batre

- **License:** MIT. **Verdict: CODE ADAPTABLE with attribution.**
- **What it is:** real-time Android app staying alive in the background with
  extreme battery efficiency (target SDK 34 / Android 14).
- **Patterns worth adopting:**
  - **Event-driven, never polling:** registers a dynamic BroadcastReceiver
    and stays idle otherwise — wakes only for milliseconds on a system event.
    Modern Android throttles background timers anyway; NIDO's P2P monitor
    should be event-driven (ACL/link-state broadcasts, alarm triggers), not
    timer-driven.
  - **Foreground service with `specialUse` type** for Android 14+.
  - **Honest OEM guidance in-app:** tells users exactly which
    battery-optimization/autostart settings to change (Xiaomi/OPPO/vivo are
    the killers) — NIDO needs the same checklist screen for its P2P service.
- **Next step:** adopt the event-driven posture (no polling loops in the P2P
  service) and add a "battery settings" checklist screen.

## Honorable mentions

- **FlareEnough** (GPL-3.0, ideas only): scheduling logic in a **pure-Kotlin
  module testable on plain JVM** (DST-safe) + a **reminder health screen**
  showing whether notifications/exact alarms/battery settings will let
  reminders fire, with a one-minute test.
- **flipper-messenger** (GPL-3.0, ideas only): sticky BLE service with
  saved-device reconnection and the honest-state principle — "Bluetooth state
  is real; it says disconnected when the link is gone" — the antidote to
  NIDO's phantom-'visible' bug.
- **react-native-background-actions** (MIT): canonical RN library for
  long-lived background tasks via foreground service; its TurboModule fork
  documents the **Android 14 `serviceType` requirement** and
  POST_NOTIFICATIONS handling.
- **AndruavLinkService** (license unconfirmed — ideas only): `specialUse`
  link-guardian service with a **partial wake lock bounded to 12h re-armed
  hourly**, a persisted `link_service_desired` flag for STICKY recovery after
  process death, and a silent low-importance notification channel.

## Top 3 adoptions (ranked)

1. **saturn's one-shot-exact-alarm + Receiver→foreground-service pipeline**
   (ideas only) — the architecture NIDO's on-device reminders and delegated
   tasks should be built on.
2. **BlueLib's connection-reliability discipline** (Apache-2.0, adaptable) —
   retry on the DISCONNECTED state transition, always close() leaked sockets,
   stop discovery before connecting, data-driven isRetryable taxonomy.
   Directly attacks NIDO's handshake-timeout and silent-link-loss failures.
3. **expo-geopulse's Expo-native foreground-service playbook** (MIT,
   adaptable) — declared service type via config plugin, activity-aware radio
   throttling, headless-safe native pipeline, degraded-mode permission
   handling.
