# CI Disk Analysis — Android APK build (diagnostic only)

**Date:** 2026-09-27
**Repo HEAD:** `e80de5c` (`ci: deep-clean runner disk after tool setup + cancel-in-progress`)
**Scope:** diagnostic only. No workflow, build config, dependency, or app-code changes were made or are proposed here as applied changes. All options below are CI-environment-only.

> **Language:** English · [Español](DISK_ANALYSIS.es.md) *(Spanish mirror pending)*

---

## 1. Evidence summary

GitHub-hosted `ubuntu-24.04` runner, root filesystem **72G total**.

| Run | Commit | Build scope | Result | Duration | First causal error |
|-----|--------|-------------|--------|----------|--------------------|
| `36318698273` | `8f60a89e` (single-ABI fix) actually ran 4-ABI? No — see note | 4 ABIs (`armeabi-v7a,arm64-v8a,x86,x86_64`) | **FAILED** | 1h 41m 22s | `:app:mergeDebugNativeLibs` → `:llama.rn:copyDebugJniLibsProjectAndLocalJars`: `java.io.IOException: No space left on device` (runner disk warning at 7 MB free) |
| `36324833967` | `8f60a89e` | single ABI (`arm64-v8a`) | **FAILED** | 1h 24m 44s | `:llama.rn:bundleDebugAar`: `Could not add file '…/library_and_local_jars_jni/debug/copyDebugJniLibsProjectAndLocalJars/jni/arm64-v8a/librnllama…'` → `Caused by: java.io.IOException: No space left on device` (while zipping the AAR) |
| `36330270921` | `e80de5c` (deep clean) | single ABI | **in progress** (started ~15:36 UTC) | — | — |

Note on run `36318698273`: it failed at `mergeDebugNativeLibs` with the runner at effectively 0 free (GitHub's "running out of disk space" warning). Run `36324833967` is the cleaner data point: **26G free after the first cleanup was still not enough** — the build consumed all of it and died at ~95% completion, during AAR zip creation.

Zero Kotlin errors and zero C++ compile errors in any run. This is purely a disk-space infrastructure fight.

### Disk timeline (run `36324833967`, from the logs)

- `df` before cleanup: **59G used / 14G free** (82%).
- First cleanup (`dotnet`, `ghc`, `boost`, `swift`, `CodeQL`, `docker system prune -af`, `apt-get clean`): **46G used / 26G free** (65%). Freed ≈ **13G**.
- `npm ci`: 663 packages installed (~40s).
- Gradle 9.3.1 downloaded; daemon started 14:10.
- Native builds: `:app:configureCMakeDebug[arm64-v8a]` 14:21 → `:llama.rn:buildCMakeDebug[arm64-v8a]` 14:23:24 → next llama.rn task 15:32:41. **llama.cpp native compile ≈ 1h 09m for one ABI, debug.**
- `:app:mergeDebugNativeLibs` 15:33:57 **succeeded** this time (single ABI fixed the earlier failure point).
- `:llama.rn:bundleDebugAar` 15:34:17 → **FAILED 15:34:53** writing the AAR zip.

The deep-clean step added in `e80de5c` (not present in the failed runs) prints `du -sh /opt/* /usr/local/*` before cleaning and `df -h` after — **the active run's log will contain the first exact measurement of the remaining fat.** Read that before applying anything below.

---

## 2. Disk consumer breakdown

Sizes below are **estimates** (marked as such) — the runner is ephemeral and post-mortem `du` is impossible. They are grounded in: the two `df` snapshots above, the log timestamps, and the known footprint of this stack (RN 0.86 + llama.cpp debug + NDK).

| # | Consumer | Location on runner | Est. size | Evidence / reasoning |
|---|----------|-------------------|-----------|----------------------|
| 1 | **llama.cpp debug object files** | `node_modules/llama.rn/android/.cxx/Debug/<hash>/arm64-v8a` (+ `vendor/llama.cpp`, `vendor/codec.cpp` sources) | **5–10 GB** | Single largest build artifact. Debug (`-O0`, full debug info) objects for llama.cpp + ggml + codec.cpp; native compile took 1h09m for one ABI. ggml.c alone is a multi-MB translation unit; debug `.o` files are routinely 5–20× the source size. |
| 2 | **JNI `.so` duplication across intermediates** | `node_modules/llama.rn/android/build/intermediates/{stripped_native_libs,library_and_local_jars_jni}/…`, `android/app/build/intermediates/merged_jni_libs/…`, plus the AAR/APK zips being written | **3–6 GB** | The same large debug `.so` files exist in 3–4 copies at once. The failing filename shows **CPU-feature variants** (`librnllama_v8_2_dotprod.so`) — multiple `.so` variants per ABI multiply every copy stage. `bundleDebugAar` died *while zipping*, i.e. it needed temp space for the full archive on top of all copies. |
| 3 | **Gradle caches** | `/home/runner/.gradle/caches/` (9.3.1 distribution ~130 MB, `transforms/` incl. `react-android-0.86.3` AAR transform, `modules-2`, Kotlin caches) | **2–4 GB** | Distribution download + transforms visible in log (`caches/9.3.1/transforms/…/transformed/react-android-0.86.3`). Kotlin incremental state for ~10 modules accumulates here and in `android/.gradle`. |
| 4 | **Android SDK downloads by Gradle** | `/usr/local/lib/android/sdk` (NDK, CMake 3.22.1 — installed mid-build per log, build-tools, platform) | **3–5 GB** | Log shows CMake 3.22.1 auto-installed at 14:21. NDK (version pinned in `android/build.gradle`) is ~2.5–4 GB; it is downloaded on demand if the image's copy doesn't match. |
| 5 | **node_modules** | `node_modules/` (663 pkgs; incl. `llama.rn/vendor/llama.cpp` source tree + `node-llama-cpp` postinstall prebuilt binaries) | **1.5–2.5 GB** | `npm ci` installed 663 packages in 39s. llama.rn's postinstall downloads native artifacts (`download-native-artifacts.js`). |
| 6 | **Kotlin/Java build intermediates** | `android/app/build`, `node_modules/*/android/build` (per-module `intermediates/`, `kotlin/`, `tmp/`) | **1–3 GB** | 696 Gradle tasks executed; every module (app, expo modules, llama.rn, 3 custom modules) keeps incremental state + packaged res/classes. |
| 7 | **Expo prebuild output** | `android/` (generated) | **< 0.5 GB** | Generated project; small relative to the above. |
| 8 | **Runner-image remainder (after cleanups)** | `/opt/hostedtoolcache` (Node 24, Temurin JDK 17 — both required), SDK remainder, OS | **~46 GB baseline** | `df` after first cleanup. The deep clean in `e80de5c` targets the rest of the removable fat (see §3). |

**Arithmetic of the failure:** baseline 46G + build footprint (~25–35G across rows 1–7) > 72G − ~0. The build died at the packaging stage — the last large allocation — meaning the shortfall is on the order of **a few GB**, not tens of GB. The deep clean only needs to buy ~5–10 GB of headroom to plausibly flip the result.

---

## 3. Ranked options (CI-only — none touch app code, dependencies, or llama.rn)

Ordered by expected GB saved per unit of risk. All are **workflow-file changes to be applied only if run `36330270921` fails** — the active run must not be touched.

### Option A — Second-phase targeted prune, guided by the new `du` output (DO FIRST)
- **What:** the `e80de5c` deep-clean step already prints `du -sh /opt/* /usr/local/*` before cleaning. Read those exact numbers from the failed run's log and delete the next-largest unused items: remaining hostedtoolcache versions, unused SDK `platforms`/`build-tools` versions, old `cmake`/`ndk` copies, `sources`, `docs`, `cmdline-tools` duplicates.
- **Saves (est.):** 2–8 GB, depending on what the image still carries.
- **Risk:** low — delete only versions the build never resolves (keep Node 24, Temurin 17, the NDK/CMake/build-tools/platform versions Gradle actually uses).
- **Touches app code:** no.

### Option B — Two-phase Gradle invocation with `.cxx` deletion between native build and packaging
- **What:** run `./gradlew :llama.rn:buildCMakeDebug[arm64-v8a] :app:buildCMakeDebug[arm64-v8a] …` (native compile only), then `rm -rf` all `.cxx` directories (`node_modules/llama.rn/android/.cxx`, `node_modules/expo-*/android/.cxx`, `android/app/.cxx`), then `./gradlew assembleDebug` for the remaining (Java/Kotlin/package) tasks.
- **Saves (est.):** **5–10 GB** — the single biggest reclaimable chunk (row 1 of the table). The object files are not needed once the `.so` files exist.
- **Risk:** medium — must verify the second invocation treats native tasks as up-to-date instead of rebuilding (AGP's `ExternalNativeBuild` up-to-date check). Testable in one run; failure mode is a rebuild (slow), not a wrong APK.
- **Touches app code:** no.

### Option C — Reduce llama.rn CPU-feature `.so` variants (INVESTIGATE)
- **What:** the failing path shows `librnllama_v8_2_dotprod.so` — llama.rn ships multiple ARM-feature variants per ABI (dotprod / i8mm / etc.), each a full copy of the library through every intermediates stage. Check llama.rn's build docs/gradle properties for a supported flag or env var to build a single baseline variant for the debug APK.
- **Saves (est.):** proportional to variant count — potentially **halves** rows 1–2 for llama.rn.
- **Risk:** medium — must confirm the flag is officially supported and doesn't change runtime behavior on the target phones (private alpha targets modern arm64 phones; verify against the physical device before any release use).
- **Touches app code:** no (build flag / env var in workflow only). Do **not** patch `node_modules/llama.rn` or its CMake files.

### Option D — Sparse checkout excluding non-build content
- **What:** `actions/checkout` sparse-checkout excluding `docs/`, `staging/`, `conformance/` mirrors (the bilingual docs + 3D renders are the bulkiest non-code content).
- **Saves (est.):** 0.1–0.5 GB.
- **Risk:** low. **Value:** low — do only together with other options.

### Option E — Split native build into its own job, pass `.so`/AAR as artifact
- **What:** job 1 builds only the native libraries (llama.rn AAR) and uploads the `.so`/AAR as a workflow artifact; job 2 downloads it and runs `assembleDebug` with native tasks excluded. Peak disk per job roughly halves.
- **Saves (est.):** halves peak usage (~10–15 GB headroom per job).
- **Risk:** medium-high — artifact wiring across jobs, AGP task-graph surgery, more CI minutes per run. Complexity cost is real.
- **Touches app code:** no.

### Option F — Larger GitHub runner (paid fallback)
- **What:** `runs-on:` a larger runner (more disk; e.g. the 4-core+ images ship substantially more than 72 GB).
- **Saves (est.):** removes the constraint entirely.
- **Risk:** low technically; **cost:** paid minutes on a private repo. Needs the user's explicit approval — do not enable unilaterally.
- **Touches app code:** no.

### Explicitly NOT recommended
- **`org.gradle.caching` / `--max-workers` tweaks:** affect speed, not peak disk. No meaningful savings.
- **Lowering `org.gradle.jvmargs -Xmx`:** saves RAM, not disk; risks OOM in the Kotlin daemon.
- **Deleting `~/.gradle/caches` mid-build or `node_modules` subsets:** breaks the build; the npm cache is already cleaned post-install in `e80de5c`.
- **Release-mode native flags (`-O3`, stripping) for the debug APK:** changes what is being validated; the first APK must stay a faithful debug build.
- **Touching `android/`, `package.json`, dependencies, or `llama.rn`:** off limits per standing instructions.

---

## 4. Recommended next step IF run `36330270921` fails on disk

1. **Read the new evidence first.** The `e80de5c` deep-clean step prints `du -sh /opt/* /usr/local/*` (before) and `df -h` (after). Extract the exact remaining fat from that log — do not guess.
2. **Apply Option A** (targeted prune from the measured `du` output). If it buys ≥5 GB, re-run — the shortfall in run `36324833967` was only a few GB at the final zip step.
3. **If A is insufficient, apply Option B** (two-phase Gradle + `.cxx` deletion). It reclaims the largest single chunk (5–10 GB) with no app-code impact.
4. **In parallel, investigate Option C** (llama.rn single-variant flag) — if a supported flag exists, it compounds with A/B.
5. **Option F** (larger runner) only with the user's explicit approval; **Option E** only if A+B+C together still fail.

**Do not apply any of this while run `36330270921` is active.**
