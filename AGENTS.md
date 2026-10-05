> **Language:** English · [Español](AGENTS.es.md)

# AGENTS.md — compiling & installing NIDO from source

This file is for an AI coding agent (or anyone scripting a build) that needs
to go from a clean checkout to a running app on a real Android device — the
exact commands, and the non-obvious constraints that make the naive path
fail. For what the app *is* and how it's designed, read `README.md` and
`ARCHITECTURE.md` first; this file only covers build/install mechanics.

## The one fact that changes everything: this is NOT an Expo Go app

`app.json`'s plugins do **not** include `expo-dev-client` (removed 2026-09-27;
see `.github/workflows/android-apk.yml`), and this repo has five
**custom native modules** (`modules/bundled-assets`, `modules/download-wake-lock`,
`modules/nido-p2p`, `modules/ram-monitor`, `modules/voice-input`) plus `llama.rn`
(native LLM inference). None of that runs inside the generic Expo Go app from the
Play Store. Every build must go through `expo prebuild` to generate a real native
Android project, then a real native build (`expo run:android` or an EAS cloud build) — there is no
`expo start` + "scan QR code with Expo Go" path for this app. If you're
tempted to just run `npx expo start` and expect it to work standalone: it
won't — it only starts the Metro bundler, which a development build (built
via one of the two paths below) then connects to.

## Prerequisites

- Node.js (any recent LTS; developed against Node 24) and npm.
- One of:
  - **A local Android SDK + NDK + JDK** (Android Studio installs all three) —
    needed for `expo run:android` (builds and installs directly on a
    connected device/emulator over USB).
  - **No local Android SDK at all** — use the EAS cloud build path instead
    (`eas.json` is already configured; needs an Expo account,
    `npx eas-cli login`, no local toolchain).
- A physical Android device with USB debugging enabled and `adb` able to see
  it (`adb devices` lists it), if installing locally rather than via EAS. The
  bounty/project this app targets explicitly requires a real device, not
  just an emulator, for final verification — but an emulator works fine for
  iterating during development.

## Compile from source and install (local Android SDK path)

```bash
git clone <repo-url>
cd nido-app
npm install
npx expo prebuild -p android --clean   # generates ./android from app.json + plugins — gitignored, regenerate any time
npx expo run:android --device          # builds the native app AND installs it on the connected device
```

Or via the `Makefile` (`make help` lists everything):

```bash
make install        # npm install (+ tells you whether you have the Android SDK)
make run-android    # prebuild + run:android
```

**`--clean` on prebuild is not optional after touching `app.json` or its
plugins** (icon, name, any native config). Without it, `expo prebuild` can
leave a stale `android/` project with old values baked in, and a plain
`npm install` will never fix that — it never touches `android/` at all.
When in doubt, `--clean`.

`make setup` is the interactive wizard for humans (`scripts/setup.mjs`); an agent
should use the explicit commands above instead. It reads answers from stdin, so it
can be scripted if needed (e.g. `printf '2\n1\n' | node scripts/setup.mjs`).

## Release APK (no Metro needed)

```bash
npx expo prebuild -p android --clean
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
# -> android/app/build/outputs/apk/release/app-release.apk
```

`plugins/withReleaseSigning.js` signs it with the key named by
`NIDO_UPLOAD_STORE_FILE`, `NIDO_UPLOAD_KEY_ALIAS`, `NIDO_UPLOAD_STORE_PASSWORD`
and `NIDO_UPLOAD_KEY_PASSWORD` in `~/.gradle/gradle.properties` (never in the
repo; in CI they come from the NIDO_UPLOAD_* GitHub Secrets — see
docs/SIGNING.md). Without them the release build is debug-signed, which is fine for your own
phone. An APK signed with a different key can't install over an existing NIDO:
Android requires uninstalling first, which deletes the app's downloaded models.
A first release build takes about 40 minutes.

## No local Android SDK: build via EAS instead

```bash
npm install
npx eas-cli login                                      # one-time, needs an Expo account
npx eas-cli build --platform android --profile preview # builds an installable .apk in the cloud
```

or `make build-eas`. This produces a downloadable `.apk` (see `eas.json`'s
`preview` profile) — download it and `adb install <file>.apk`, or transfer it
to the device directly.

## After install: the app is not immediately usable — one more step

First launch shows a **mandatory, one-time setup screen** that downloads the
default model (Qwen2.5-1.5B + an embedding model, about 1 GB total) — this is the app's only required network access, and the app is
gated behind it (`ModelManager.requiredModelsPresent()` in
`src/models/ModelManager.ts` decides whether the chat screen or the setup
wizard shows). If you're scripting an unattended install-and-verify flow,
this download has to complete (or you pre-seed the files — see next
section) before the app is otherwise usable. After that first setup, the
app works fully offline.

### Skipping the in-app download (pre-seeding models)

If you already have the GGUF weight files on the machine running the build,
you can bake them into the APK itself instead of downloading them at
first-run — see `docs/MODELS.md`'s "Pre-seeding models you already have
locally" section for the exact filenames/checksums and the
`scripts/setup-models.sh` + `assets/models/` + `withBundledModels.js` flow.
This is a genuinely different build path (bundles ~3.2GB into the APK, no
runtime network needed at all), not the default — only use it if avoiding
the in-app download matters for your scenario.

## Verifying the build without a device (what an agent without device access can actually check)

```bash
npm run typecheck   # tsc --noEmit — must be clean
npm test            # vitest run — the full unit suite, native-module-dependent
                     # code (expo-sqlite/llama.rn/expo-file-system) is deliberately
                     # untested here; see src/rag/pure.ts and its siblings for
                     # what IS unit-tested and why
```

Neither of these proves the native build/install actually works — they only
prove the JS/TS layer is internally consistent. There is no way to verify a
real device install without a real device; don't claim success from
typecheck/tests alone if the task was specifically about building/installing.

## Benchmarking models on a connected phone

With a phone on USB, an agent can run the evaluation end to end without anyone
tapping the screen. Full guide: [docs/DEVICE_EVALUATION.md](docs/DEVICE_EVALUATION.md).

```bash
adb devices                                  # exactly one device, state "device"
curl -s http://localhost:8081/status         # "packager-status:running" (Metro)
npm run eval:device -- --dry-run             # see every adb command first
npm run eval:device -- --models <name>       # run; results in eval-results/<date>/
npm run eval:summary -- --report <jsonl>     # report from a saved run
```

Before and during a run:

- **Check the phone isn't busy.** `eval:device` reloads the app. Don't run it,
  reinstall, force-stop or reload while a model download is in progress
  (`adb shell dumpsys power | grep NIDO:ModelDownload`, or a growing file in
  `adb exec-out run-as team.nido.app ls -l files/models`); downloads can't
  resume after a restart. The phone's owner may be using it: ask first.
- **Don't edit app source files while a run is going.** Metro hot-reloads them
  into the running app, which can interrupt the evaluation. Docs and scripts are
  fine.
- **Keep the screen on.** Locking the phone backgrounds the app. If the phone
  won't accept `settings put global stay_on_while_plugged_in`, send
  `adb shell input keyevent KEYCODE_WAKEUP` every 30 seconds for the length of
  the run, then stop.
- **Use `--queries greeting-1` for a quick probe** of a new model (does it load,
  what prompt format does it get) before a full 17-question run.
- **Report only what the phone measured.** The JSONL is the source of truth;
  a model that fails to load is recorded as failures, not skipped.

To check a Hugging Face GGUF before anyone downloads it, read its header (the
first few MB) for `general.architecture` and `tokenizer.chat_template`: the
architecture must be supported by the llama.rn build in `node_modules`.

## Building a knowledge pack

Full guide: [docs/KNOWLEDGE_PACKS.md](docs/KNOWLEDGE_PACKS.md).

```bash
npm run pack:build -- --limit 200 --id test-pack   # quick check that the pipeline works
npm run pack:build                                 # the full Vital Articles level 5 pack
npm run pack:push -- build/knowledge-pack/<id>.sqlite  # copy onto a USB-connected dev build
```

- A full level 5 build takes hours (downloading ~50k introductions, then
  embedding); run it in the background and let it resume if interrupted, since
  every step is cached under `build/knowledge-pack/<id>/`.
- Packs must be embedded with the app's model (`assets/models/embedding.gguf`,
  checked by SHA-256); the app ignores packs built with another one.
- Don't commit `.sqlite` packs to git; they go to a release asset (see the guide).

## Common pitfalls

- **Blank/white screen, or "Failed to connect to `<LAN IP>`" after starting
  Metro**: almost always Wi-Fi client/AP isolation (common on phone hotspots
  and many routers) blocking the phone and dev machine from reaching each
  other, even on the same network. USB debugging isn't affected. Fix: force
  Metro onto the USB `adb reverse` tunnel instead of Wi-Fi —
  `npx expo start --localhost` (or `make start`, which already does this).
- **`ClassNotFoundException: expo.modules.splashscreen.SplashScreenManager`
  in logs**: a red herring — a caught, harmless, expected exception from a
  soft-dependency check, not a real build problem. Don't spend time chasing it.
- **A stale `android/` directory causing weird build errors after editing
  `app.json`**: see the `--clean` note above.
- **Don't run destructive git/native-reset commands to "fix" a build
  problem** (`rm -rf android`, force-pushes, etc.) without checking
  `git status` first and understanding why the build actually failed —
  most build failures here are the two points above, not something that
  needs nuking the repo state.
