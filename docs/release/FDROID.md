> **Language:** English · [Español](../es/release/FDROID.md)

# F-Droid: status and the chosen path

**D8 resolved by the owner on 2026-11-13: NIDO's regular APK is the one
without Google. There is no separate `foss` flavour.**

The reason: if the Google-free APK were a different variant from the GitHub
one, F-Droid would sign it with its own key. Switching between installs
would then mean uninstalling, and uninstalling deletes the downloaded models
(up to about 5 GB).

Nothing in this document has been sent to gitlab.com/fdroid/fdroiddata. The
recipe draft is [`docs/release/fdroid/team.nido.app.yml`](fdroid/team.nido.app.yml).

## 1. Where NIDO stands

| F-Droid requirement | Status |
|---|---|
| No Google or tracking libraries (Firebase, Play Services) | **Done in code, pending a release.** #253 replaces expo-notifications with NIDO's own module; #254 censuses every built APK and fails the build if anything is left. No published release meets it yet: 0.1.95 carries those classes compiled in and inert |
| Everything built from source | **Fails.** Dependencies bring prebuilt native libraries (§3) |
| Free licence | Passes: MIT |
| Metadata | fastlane/metadata/android in en-US, es-ES and pt-BR; recipe drafted |
| NIDO's signature (reproducible build) | Depends on §3: today NIDO's build uses prebuilt binaries F-Droid can't use |

The INTERNET permission stays: it's needed to download the models and is
not an F-Droid blocker.

## 2. Google removed: what was done

Up to 0.1.95, everything from Google came in through **two** dependencies:

- **expo-notifications 57.0.24:** firebase-messaging and its whole tree
  (Firebase, Play Services, datatransport, kotlinx-coroutines-play-services).
- **expo-application 57.0.3**, which expo-notifications pulled in: Google
  Play's Install Referrer.

NIDO only used expo-notifications for local notifications.

**PR-1 (#253):** `modules/nido-notify`, NIDO's own module (MIT, Android
system APIs and expo-modules-core only) with exactly what NIDO used:

- scheduling, showing, cancelling and dismissing local notifications;
- channels and the permission;
- knowing when a notification was delivered.

The next-time calculation is expo's, line for line. A comparison against
expo's real code gave 0 differences in 360,000 cases. After an update, the
first launch reschedules what expo had pending and deletes its old store.
expo-notifications, expo-application, expo-constants and badgin are gone.

**PR-2 (#254):** removes the Firebase configuration left in
`plugins/withLeanManifest.js`. It adds `scripts/check-google-free.py` at the
end of every APK build, which looks for Firebase, Play Services,
datatransport and the Install Referrer in three places:

- the `classes*.dex` files;
- the binary manifest;
- the dependency tree the release publishes.

Any trace fails the build, and with it the release.

| Census (same script) | Published 0.1.95 | With #253 and #254 |
|---|---|---|
| dex `com/google/firebase` | 535 | see #254 |
| dex `com/google/android/gms` | 996 | see #254 |
| dex `com/google/android/datatransport` | 345 | see #254 |
| dex `com/google/android/finsky` | 5 | see #254 |
| dex `com/android/installreferrer` | 16 | see #254 |
| manifest: datatransport CCT / gms | 4 / 2 | see #254 |
| Google dependencies in the tree | 36 | see #254 |

The right-hand column is filled in from the CI run cited in #254 once it is
merged. What a published APK contains is checked on its release.

## 3. What's left: prebuilt native libraries

This is what still separates NIDO from fdroiddata, put plainly.

**What happens:**

- **llama.rn** downloads its native libraries already compiled from its
  GitHub release during `npm install` (`install/download-native-artifacts.js`).
  Its npm package also ships `bin/arm64-v8a/libOpenCL.so` and the Hexagon
  `libggml-htp-*.so` libraries. Those two are already dropped from the APK
  by `withLlamaTrim`, but they are in the source tree.
- **Expo modules** each ship a prebuilt AAR in `local-maven-repo/`, and
  autolinking uses it by default.

**What it means for an fdroiddata submission:**

- F-Droid builds from source. Its scanner flags the binaries it finds, and
  the recipe has to delete them and build them from code.
- llama.rn's and Expo's code is free, so in principle they can be built.
  That would take:
  - llama.rn with `npm ci --ignore-scripts` and `rnllamaBuildFromSource=true`;
  - Expo with `expo.autolinking.android.buildFromSource: [".*"]` in
    `package.json`.
- If F-Droid builds from source while NIDO publishes on GitHub an APK made
  with the prebuilt binaries, the two APKs **won't match byte for byte**.
  F-Droid then can't ship the NIDO-signed APK, signs with its own key, and
  the problem D8 meant to avoid comes back: anyone switching between GitHub
  and F-Droid would have to uninstall.

**What could be done (no promise of acceptance):**

1. **Build NIDO's own release from source too**, with the two settings
   above in `android-apk.yml` and `reproducible.yml`, and confirm with
   `reproducible.yml` that two builds match. It's the only option that
   keeps NIDO's signature possible on F-Droid. How much longer the build
   takes, and how much disk llama.cpp needs from source, isn't measured;
   the CI is already tight on disk.
2. **Accept F-Droid signing with its own key.** It works, but loses the
   benefit that motivated D8 for anyone using both sources.
3. **Leave F-Droid for later.** The Google-free APK serves GrapheneOS and
   de-Googled ROMs from GitHub all the same.

Even with option 1, F-Droid reviews every submission by hand. It may ask for
changes or label the app (§4), and llama.cpp's native build has to be
deterministic with its toolchain, which isn't proven. None of this can be
promised from here.

## 4. Labels F-Droid might apply

- **NonFreeAdd** (promotes non-free add-ons). The catalog offers
  `lfm2.5-8b-a1b-q4km` under the "LFM Open License v1.0", which is not a
  recognised free licence. The other models are MIT or Apache-2.0, and the
  packs CC BY 4.0 or CC BY-SA 4.0. It's a label, not a rejection.
- **NonFreeNet** doesn't apply: NIDO depends on no non-free network service
  to work.

## 5. Remaining steps

1. **Merge #253 and #254** with green CI. The first release that carries
   them will be the first without Google; cutting it is the house's call.
2. **Device pass** on that release: the full DEVICE_CHECKLIST, including
   section 5 (notifications) and the new check of updating from 0.1.95 with
   pending notifications.
3. **Decide §3:** build the release from source or not. If yes:
   - separate branch;
   - test build;
   - `reproducible.yml` green.
4. **Local test with fdroidserver**, using the recipe draft:
   - `fdroid readmeta`, `fdroid lint team.nido.app`,
     `fdroid build -v -l team.nido.app` and `fdroid scanner` with no
     findings;
   - close the draft's "VERIFICAR" items.
5. **Merge request to fdroiddata:** only with the owner's go-ahead and the
   recipe that passed step 4.

## 6. Uncertainties

- The current fdroiddata category list wasn't checked from here.
- Which Node version F-Droid's buildserver has is unknown (NIDO uses Node 24).
- How long a from-source llama.cpp build takes, how much disk it needs, and
  whether it's byte-for-byte reproducible.
- Whether `withLlamaTrim`'s checks tolerate a missing `bin/`. Given how
  `syncRNLlamaHtpAssets` is written they should, but it isn't tested.
