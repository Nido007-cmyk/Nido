# Spike — On-device voice via whisper.cpp (advance work, not yet implemented)

**Status:** RESEARCH ONLY (2026-09-27). No code changes. Decision needed before any
implementation: model size vs accuracy vs download weight.
**Why:** BOAR's voice path uses the system `SpeechRecognizer`, which may send audio
to the network when the offline pack is missing. NIDO requires voice that is
provably on-device. This is also the "Voice" row of the Offline Center spec.

## 1. Recommendation: `whisper.rn`

[`whisper.rn`](https://github.com/mybigday/whisper.rn) (mybigday) is the mature
React Native binding of whisper.cpp:

- JSI native module (efficient, works with the New Architecture / Fabric).
- **Android:** prebuilt `librnwhisper*.so` per CPU-feature variant (arm64-v8a incl.
  fp16 variant; experimental Hexagon NPU variant). CPU/NEON inference — no
  first-class NNAPI path, so speed must be measured on real hardware.
- **iOS:** Metal GPU + CoreML encoder acceleration (not our target, but free).
- Built-in `RealtimeTranscriber` with Silero VAD + partial-result callbacks.
- Install is `npm install whisper.rn` (+ `npx pod-install` on iOS; Android needs a
  proguard keep rule). **No official Expo config plugin** — requires `expo prebuild`,
  which NIDO already uses for the standalone build, so this fits the existing flow.

Alternatives considered and rejected:
- `deviceai-labs/deviceai-runtime-sdks` react-native/speech: **status: planned**,
  not implemented. Revisit in 6–12 months.
- Cloud STT (Deepgram/AssemblyAI/OpenAI): violates the offline principle outright.

## 2. Model choice (open decision)

| Model | Size | Notes |
|---|---|---|
| `tiny.en` | ~75 MB | Fastest; English-only; weakest accuracy |
| `base.en` | ~142 MB | Balanced default candidate |
| `small.en` | ~466 MB | Better accuracy; heavy download |

Recommendation: start with `base.en`, measure WER + latency on the Tab A9+
(Snapdragon 695) in airplane mode, then decide. Multilingual `tiny`/`base`
(non-.en) only if ES/PT voice becomes a requirement.

## 3. Integration plan (for later)

1. Add `whisper.rn` to `package.json`; verify Expo SDK / RN version compat at that time.
2. **Download via the existing audited path:** add the ggml model to the model
   manifest (`src/models/manifest.ts`) so it flows through ModelManager —
   user-initiated download, SHA-256 verification (T-005 fix), and automatic
   appearance in the Network Audit log. No new network code.
3. Replace the transcription backend in the voice-input module: keep the existing
   UI/UX, swap `SpeechRecognizer` for `whisperContext.transcribe()` /
   `RealtimeTranscriber`.
4. Microphone permission rationale copy (English-first, i18n key).
5. Flip the Offline Center "Voice" row to "On-device voice ready".
6. Delete the system-recognizer path (do not keep both — two paths means two
   audit surfaces).

## 4. Verification (device, airplane mode)

- Transcribe a 30s sample with **no network** (airplane mode): must work.
- Network Audit screen shows zero events during a voice session.
- Measure: transcription latency for 10s of audio on the target device; if
  `base.en` is too slow, fall back to `tiny.en` and record the tradeoff.
- Regression: existing voice-input UI tests still pass; add tests for the
  model-present / model-missing states.

## 5. Risks

- **Binary size / download weight:** +75–466 MB model on top of the LLM. Mitigate:
  optional download (like knowledge packs), clearly labeled.
- **Android CPU-only inference:** may be slow on low-end devices. Mitigate: measure
  first (this spike's step 4), tier by device.
- **No Expo config plugin:** prebuild-time manual steps must be documented in
  `docs/ANDROID_BUILD.md` when implemented.
- **Maintenance:** whisper.rn tracks whisper.cpp releases; pin the version and
  record the SHA-256 of the prebuilt artifacts it downloads at install time.
