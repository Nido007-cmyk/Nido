> **Language:** English · [Español](../es/release/DEVICE_CHECKLIST.md)

# Device checklist for every release

Automated tests run on every change, but they don't run on a phone. This
is the short pass on a real phone that every alpha should get before its
notes say anything about how it behaves. It takes about 20 minutes on the
reference device, a Galaxy Tab A9+ (about 4 GB of RAM, context capped at
2,048 tokens).

Write the results into the release notes, including what failed. A check
that wasn't run is written down as not run, never as passed.

## Before you start

- Install the published APK and check it against its `app-release.apk.sha256`.
- Write down the device, Android version and free storage.
- For the timing checks, wait three minutes without touching the app, or
  force-stop it, so the model is unloaded.

## 1. First launch, offline (since 0.1.95)

1. Uninstall NIDO. Turn on airplane mode. Install the candidate and open it.
2. In the setup wizard, tap **Emergency**. The country picker must show.
   Pick Mexico and the United States: each must show its numbers with a
   source and a date.
3. Close it and tap **Read the guides**. The NIDO Essentials guides must be
   listed and open as documents.
4. Record: whether it worked, and how many seconds passed from opening the
   app until Emergency showed numbers.

## 2. Answers that don't need the model (since 0.1.94)

With the model unloaded:

1. Ask a question a guide answers ("what do I do if someone is choking?").
2. Ask "thanks", "what time is it?" and "what's the emergency number?".
3. Record, for each one: seconds until the text appears, and whether the
   "Loading model…" strip showed. It must not show.

## 3. A generating answer

1. With the model unloaded, ask for a short story.
2. In Execution Telemetry, record the load time, time to first token,
   tokens per second and peak memory.
3. Compare with the previous release. The figures should match; the load
   time now has its own field.

## 4. Numbers and tables (since 0.1.94)

1. Import a document with a long table of numbers (40 rows of doses or
   times).
2. Ask something only the table answers.
3. The answer must finish, with no cut-off note and no error. Record the
   prompt tokens and whether `context_full` showed up in telemetry.

## 5. Notifications (since 0.1.95, Firebase start-up removed)

1. Set a reminder for one minute from now.
2. Lock the phone. The notification must arrive on time.

## 6. Panic erase (since 0.1.95, key destroyed first)

Only on a test install with no real data.

1. Turn on the panic button in Settings → Security.
2. Hold it for 3 seconds.
3. NIDO must restart empty, without the "interrupted erase" card. In the
   setup wizard, Emergency must still work (the packs are reinstalled from
   the APK).

## 7. Two phones

1. Pair two phones by QR code and send a message both ways over Bluetooth.
2. Repeat in airplane mode with Bluetooth on.

## 8. Answer quality, with figures

The evaluation set runs inside the real app (the same deterministic layer,
guides and model the user gets), driven from a computer:

```bash
npm run eval:device -- --models <model id>
```

See [DEVICE_EVALUATION.md](../DEVICE_EVALUATION.md). It needs a development
build and USB debugging. Keep the `.jsonl` and `.answers.md` files and put
the summary (queries ok, time to first token, tokens per second, peak
memory) in the release notes, next to the previous release's figures.

## Distribution blockers found on 2026-11-12

These came out of reading the 0.1.94 APK. They don't affect what the app
does, but F-Droid (decision D8) will raise them:

- **Firebase start-up.** The manifest declared `FirebaseInitProvider` and
  `ComponentDiscoveryService`, brought in by expo-notifications. Firebase
  can't start in NIDO (no `google_app_id` in the APK), so they were dead
  weight. Removed in 0.1.95 (`plugins/withLeanManifest.js`).
- **Firebase and Google Play Services classes are still compiled in.**
  `classes*.dex` holds `com/google/firebase` (messaging, installations,
  datatransport) and `com/google/android/gms`. Without a manifest entry they
  are inert, but F-Droid's scanner flags non-free libraries. Removing them
  means excluding `firebase-messaging` from expo-notifications in Gradle and
  checking that the R8 build still compiles. This needs a test Android
  build. Open.
- **Voice input** uses the phone's on-device recognizer when Android 12+
  offers one, and refuses offline-only mode when it doesn't. On phones
  without one (GrapheneOS, many de-Googled ROMs) there is no offline voice
  input. [WHISPER_PLAN.md](../WHISPER_PLAN.md) has the plan for a bundled
  recognizer. Open.
