> **Language:** English · [Español](../es/release/FDROID.md)

# F-Droid: preparation (working draft)

Status: **prepared, not submitted.** Joining F-Droid is the owner's decision
D8, and the owner decides when. Nothing in this document has been sent to
gitlab.com/fdroid/fdroiddata. Written by package NIDO-MANT-2026-11-13
(task 5) on 2026-11-13, from the v0.1.95-alpha tree.

The recipe draft is
[`docs/release/fdroid/team.nido.app.yml`](fdroid/team.nido.app.yml).

## 1. What F-Droid requires and where NIDO stands

| Requirement | State in 0.1.95 | What's missing |
|---|---|---|
| No tracking or Google libraries (Firebase, Play Services) | **Fails.** The APK doesn't start them, but they are compiled in | §2 and §3 |
| Everything built from source with free tools | **Fails.** Several dependencies arrive prebuilt | §3.2 |
| Free licence | Passes: MIT | — |
| Metadata | Nearly: fastlane/metadata/android in en-US, es-ES and pt-BR | The fdroiddata recipe (draft done) |
| NIDO's signature (reproducible build) | Possible: reproducible.yml already compares two builds | The release APK must be the same build F-Droid will make (§3.4) |

The INTERNET permission is not an F-Droid requirement and is out of scope
here: it is a separate product decision.

## 2. Inventory: what is Google's and where it comes from

Source: `android-runtime-dependencies.txt` from the v0.1.95-alpha release
(the `releaseRuntimeClasspath` tree the CI publishes) and the published
APK's `.dex` files. Everything non-free hangs from **two** direct
dependencies:

| Direct dependency | What it brings | What it's for | Does NIDO use it? |
|---|---|---|---|
| `expo-notifications` 57.0.24 | `com.google.firebase:firebase-messaging:25.0.1`, and with it firebase-common, -components, -installations, -iid-interop, -datatransport, -encoders, -measurement-connector; `play-services-base`, `-basement`, `-cloud-messaging`, `-stats` and `-tasks`; `com.google.android.datatransport` (transport-api, -runtime, -backend-cct); `kotlinx-coroutines-play-services` | Push notifications (FCM): push token and topics | **No.** NIDO only uses local notifications: scheduling, cancelling, channels, permission and listeners (`src/notify/notifications.ts`, `src/services/appReset.ts`). It never asks for a push token |
| `expo-application` 57.0.3, pulled in by expo-notifications | `com.android.installreferrer:installreferrer:2.2`, Google Play's Install Referrer (`com/google/android/finsky` in the dex) | `getExpoPushTokenAsync` reads the applicationId | **Not directly.** But its JS calls `requireNativeModule` on import, so dropping it from autolinking would break start-up |

NIDO's own modules (`modules/*`) declare nothing from Google. The rest under
`com/google/` in the dex is free: Material Components, Gson, errorprone and
Guava, all Apache-2.0.

**What the app loses without Firebase:** nothing it does today. Reminders are
local notifications (Android's AlarmManager and NotificationManager) and
don't go through Firebase. Firebase can't start in NIDO (the APK has no
`google_app_id`), and its manifest entry was removed in 0.1.95. The only
thing that goes is remote push, which NIDO doesn't use and can't use without
a server.

## 3. The Google-free build: two routes

### 3.1 Why the regular APK and not a separate flavour

F-Droid can ship the APK signed by NIDO only if its build matches the
release byte for byte (`Binaries` and `AllowedAPKSigningKeys` in the
recipe). If the Google-free APK were a different flavour from the GitHub
one, F-Droid would sign it with its own key. Anyone switching between them
would then have to uninstall, and uninstalling deletes the downloaded models
(up to about 5 GB). Since NIDO uses none of what gets removed, the proposal
is that **the release APK is the Google-free one**, with no flavours. If the
owner prefers a separate `foss` flavour, the changes below still apply, to
that flavour only, and the recipe would drop `Binaries` and
`AllowedAPKSigningKeys`.

### 3.2 Building from source: configuration changes

These change the release APK. They need a test Android build before they are
merged:

1. **Expo modules from source.** Every `expo-*` ships a prebuilt AAR in
   `local-maven-repo/`, and autolinking uses it by default. In
   `package.json`:

   ```json
   "expo": {
     "autolinking": {
       "android": { "buildFromSource": [".*"] }
     }
   }
   ```

   The key comes from `expo-modules-autolinking`
   (`ExpoAutolinkingConfig.buildFromSource`, `SettingsManager.configurePublication`).

2. **llama.rn from source.** Its install script downloads prebuilt `.so`
   files from its GitHub release. That means `npm ci --ignore-scripts`;
   llama.rn is the only production dependency with an install script (the
   other two, fsevents and node-llama-cpp, are dev-only). It also needs
   `rnllamaBuildFromSource=true` in `android/gradle.properties`, written by a
   config plugin (for example inside `withLlamaTrim`, through
   `withGradleProperties`) so the CI and F-Droid build the same way. With
   that set, `jniLibs.srcDirs = []` and CMake compiles llama.cpp. The HTP
   libraries and `libOpenCL.so` in `bin/` are already dropped by
   `withLlamaTrim` (`ggml-hexagon/**`).
   *Not measured:* how long a from-source llama.cpp build takes and how much
   disk it needs. The CI is already tight on disk with arm64-v8a.

3. **The same in both workflows.** `android-apk.yml` and `reproducible.yml`
   must build exactly this way (`--ignore-scripts`, the property, NDK
   27.0.12077973), or the release and F-Droid won't match.

### 3.3 Removing Firebase and the Install Referrer

expo-notifications **compiles** Kotlin and Java code that imports
`com.google.firebase.messaging.RemoteMessage` (8 files), `FirebaseMessaging`
(2) and `FirebaseMessagingService` (1). expo-application imports
`InstallReferrerClient` and `InstallReferrerStateListener`. Simply excluding
the dependencies in Gradle leaves those references dangling: R8 reports them
as missing classes, and silencing that with `-dontwarn` moves the failure to
run time. There are two routes:

**Route A (recommended): NIDO's own local notifications.** A NIDO native
module (next to `modules/exact-alarm`, which already schedules exact alarms)
replaces expo-notifications. It covers what NIDO uses today:

- `scheduleNotificationAsync` and `cancelScheduledNotificationAsync`, plus
  `cancelAll…` and `getAllScheduled…`;
- `setNotificationChannelAsync`, `requestPermissionsAsync` and
  `setNotificationHandler`;
- `getPresentedNotificationsAsync`, `dismiss…` and
  `addNotificationReceivedListener`.

When expo-notifications goes, expo-application goes too, and with them
everything in the §2 table. It is the cleanest for F-Droid: no Google code is
left, not even in `node_modules` for the scanner to delete. Its cost:

- new native code;
- migrating those calls;
- rerunning DEVICE_CHECKLIST section 5 on the device (a reminder with the
  phone locked), plus a phone restart with reminders pending.

**Route B (shorter, less clean): free substitutes.**

- An own Android module (MIT) with API-only stubs for the three Firebase
  classes and the two Install Referrer ones. Methods return null or throw
  `UnsupportedOperationException`; `RemoteMessage.Notification` needs about
  25 getters.
- `resolutionStrategy.dependencySubstitution` in every project, written from
  a config plugin, swapping `com.google.firebase:firebase-messaging` and
  `com.android.installreferrer:installreferrer` for that module.

Risks:

- the original lines stay in the `build.gradle` files under `node_modules`,
  and the recipe would have to rewrite them in `prebuild`;
- F-Droid may object to stubs in Google namespaces;
- the dead push code stays in the APK.

**Where an Android build becomes necessary** (it can't run from this lane):

- after either route, `./gradlew assembleRelease` with R8, and checking that
  nothing from `com/google/firebase`, `com/google/android/gms`,
  `com/google/android/datatransport` or `com/google/android/finsky` is left
  in the `.dex` files (the same scan run on 0.1.95);
- and the from-source builds in §3.2.

The diffs for A or B are not applied, because they change the APK and can't
be tested here.

### 3.4 Reproducible with NIDO's signature

`reproducible.yml` already builds twice and compares with
`scripts/compare-apk.py`. Once the APK is Google-free and built from source,
the test is to run it with that version's `release_tag`. If it matches, the
recipe can carry `Binaries` and `AllowedAPKSigningKeys`. NIDO's certificate
fingerprint, checked against the v0.1.95-alpha APK (v2 signature, one
certificate), is:

`4bd73b2f31ce7e66ff3e2c03cd2ff44eabb38dc9e6eef178d8ad7795b50160cf`

## 4. What F-Droid might still flag once all of the above is done

- **NonFreeAdd** (promotes non-free add-ons). The catalog offers
  `lfm2.5-8b-a1b-q4km` under the "LFM Open License v1.0", which is not a
  recognised free licence. The other models are MIT or Apache-2.0, and the
  packs CC BY 4.0 or CC BY-SA 4.0. It is a label, not a rejection; removing
  it would mean dropping that model from the F-Droid build's catalog, which
  is the owner's call.
- **NonFreeNet** doesn't apply: NIDO depends on no non-free network service
  to work. Downloads are signed files from GitHub releases.

## 5. Steps for the day of the decision

1. **New configuration (§3.2 and §3.3):** separate branch, test Android
   build, Google-free dex scan, and `reproducible.yml` green with the new
   configuration.
2. **Google-free release:** released as usual, by PR, with green CI and the
   triple match.
3. **Device pass:** the full DEVICE_CHECKLIST, with special attention to
   section 5 (notifications) and a restart with reminders pending.
4. **Local test with fdroidserver:** clone fdroiddata, copy the draft to
   `metadata/team.nido.app.yml` and set versionName, versionCode and commit.
   Then:
   - `fdroid readmeta` and `fdroid lint team.nido.app`;
   - `fdroid build -v -l team.nido.app`, on the buildserver or in an
     `fdroidserver` container;
   - close the draft's "VERIFICAR" items: Node 24, subdir with a generated
     `android/`, and the output APK name;
   - `fdroid scanner` with no findings.
5. **Merge request to fdroiddata:** only with the owner's go-ahead, which is
   decision D8, and with the recipe that passed step 4.

## 6. Uncertainties

- The current fdroiddata category list wasn't checked from here.
- Which Node version F-Droid's buildserver has is unknown.
- How long the from-source llama.cpp build takes and how much disk it needs.
- Whether `withLlamaTrim`'s assembly-time checks (the ones that delete
  `ggml-hexagon/`) tolerate a missing `bin/`. Given how
  `syncRNLlamaHtpAssets` is written (`onlyIf` the directory exists) they
  should, but it isn't tested.
- Whether F-Droid would accept route B's stubs.
