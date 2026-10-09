# Draft: llama.rn 16KB page-size issue

**Repo:** https://github.com/mybigday/llama.rn/issues/new
**Title:** Android 16KB page size support: native .so files need max-page-size=16384

## Body

## Problem

The prebuilt Android `.so` files shipped with llama.rn are not 16KB page-size aligned. Verified via `readelf`: the LOAD segments lack 16KB alignment and there's no `.note.gnu.property` indicating 16KB support.

**Impact:** On devices running Android 15+ with 16KB page size enabled (and Android 16 where it's the default, e.g. Pixel line), the app crashes at inference init with `UnsatisfiedLinkError` when loading the native library.

**Play Store:** Since November 1, 2025, apps targeting Android 15+ must support 16KB pages. This blocks Play publishing for any app using llama.rn on current devices.

## Expected fix

Rebuild the Android native libraries with `-Wl,-z,max-page-size=16384` (or ensure NDK r28+ where 16KB is default). This is the standard fix documented in the Android 16KB guide.

## Environment

- llama.rn: 0.13.0-rc.6
- Verified with: `readelf -l` on the shipped `.so` files

Happy to test a prebuilt with the fix on a 16KB device.

---

**Status:** Draft prepared 2026-10-09. Manual posting required (API auth unavailable in sandbox).
**Verification command:** `readelf -l node_modules/llama.rn/android/src/main/jniLibs/arm64-v8a/librnllama.so | grep -A 2 LOAD`
