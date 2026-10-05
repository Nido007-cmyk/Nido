> **Language:** English · [Español](es/WHISPER_PLAN.md)

# NIDO — Real offline STT plan (whisper.cpp)

> Status: research completed 2026-09-27. **Not installed or tested**:
> requires a native build (no Android SDK in this environment).

## The problem it solves

The current STT (`modules/voice-input`) wraps the system
`SpeechRecognizer` with `EXTRA_PREFER_OFFLINE`. That has two serious failures for a
"100% offline and private" app:

1. **It depends on a system service** (normally Google's). On
   GrapheneOS / ROMs without Google it doesn't exist and the voice button simply
   doesn't work. The module already returns `isAvailable() = false` there instead of
   faking it, but the result for the user is "no voice".
2. **`EXTRA_PREFER_OFFLINE` is a suggestion, not a guarantee**: the OEM's
   service may still send audio to the cloud. There's no way to audit it.

Voice input must work without Google, without network, and auditably.
That's whisper.cpp running on the phone itself.

## Decision: `whisper.rn` 0.7.4

React Native binding of whisper.cpp (mybigday/whisper.rn), verified on
npm on 2026-09-27:

- Version 0.7.4, description "React Native binding of whisper.cpp".
- Android: Gradle + CMake + NDK compile `librnwhisper.so` (whisper.cpp as
  a submodule). Supports Old and New Architecture.
- Expo: requires prebuild (our flow is already `expo prebuild --clean` +
  native build; we don't use Expo Go).
- API: `initWhisper({ filePath })`, `transcribe()`, `RealtimeTranscriber`
  for live dictation; ships a mock for Jest (`whisper.rn/jest-mock`).
- Only depends on `safe-buffer` on npm. Tested in production by third parties
  with Expo + New Architecture (e.g. offline subtitle apps).
- Discarded alternative: `@synervoz/edgespeech` (commercial SDK with Expo
  plugin). It works, but introduces closed binaries and a commercial account;
  it clashes with NIDO's auditability principle.

Risk to verify on the first build: fine-grained compatibility with Expo SDK 57
/ RN 0.86. If `whisper.rn` doesn't compile, plan B is a custom Expo module
that compiles whisper.cpp directly (same pattern `llama.rn` already uses
for llama.cpp in this repo).

## Models (Spanish)

The user speaks Spanish → **multilingual** model (the `.en` ones only work
for English). Two-tier strategy, downloadable on demand with the existing
`ModelManager` (same as LLMs: the user taps download):

| Model | Approx. size | Use |
|---|---|---|
| multilingual `ggml-tiny` (+q8_0) | ~75 MB | Default: fast, acceptable Spanish for commands and short dictation |
| multilingual `ggml-base` (+q8_0) | ~145 MB | Quality option in voice settings |

They aren't bundled in the APK (they'd double its size); they're downloaded once
from HuggingFace and stay in the app's files, like the GGUFs.

## Proposed integration

1. `npx expo install whisper.rn` (+ `expo-audio` for recording; not in
   `package.json` today).
2. `RECORD_AUDIO` permission: already declared by `modules/voice-input`; request it
   at runtime before recording (the current `VoiceInputButton` flow serves
   as the base).
3. `src/voice/whisperSTT.ts`:
   - Lazy `initWhisper` with the downloaded model (tiny by default).
   - Record with `expo-audio` to 16 kHz mono WAV → `transcribe()` on button release
     (v1 simple and robust); `RealtimeTranscriber` as v2 improvement.
   - Honest fallback chain: whisper → system `VoiceInput` module
     → clear "voice unavailable" message (never fake it).
4. `VoiceInputButton` uses the new chain without changing its API.
5. `docs/ANDROID_BUILD.md`: add the STT model download step.

## Hardware validation (mandatory)

- [ ] Compiles with `whisper.rn` in the clean prebuild.
- [ ] With **airplane mode on**: dictate 10 sentences in Spanish → correct
      transcription with no network (the test the current STT can't pass).
- [ ] On a phone without Google services: the voice button works
      (whisper) even when `VoiceInput.isAvailable()` is false.
- [ ] Acceptable response time on mid-range with `tiny` (< 2 s for
      short sentences); document the real measurement.
- [ ] Battery/RAM during transcription: no anomalies in `SystemMonitor`.

## Honest costs

- APK/storage: +75–145 MB only if the user downloads the STT model.
- RAM/CPU during transcription (measure on hardware, don't estimate here).
- Build complexity: one more native binding (NDK). Same risk already
  assumed with `llama.rn`.
