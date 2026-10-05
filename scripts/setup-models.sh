#!/usr/bin/env bash
# One-time, online setup step: downloads the bundled model weights declared
# in src/models/manifest.ts into ./assets/models and verifies their sha256.
# Run this BEFORE `expo prebuild` — the withBundledModels config plugin
# copies these exact files into the Android build so they ship inside the
# APK itself (see ARCHITECTURE.md "Bundled models"). The shipped app never
# runs this script or calls these URLs at runtime.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p assets/models

download_and_verify() {
  local url="$1" out="$2" expected_sha256="$3"

  if [[ -f "$out" ]]; then
    local existing
    existing=$(sha256sum "$out" | awk '{print $1}')
    if [[ "$existing" == "$expected_sha256" ]]; then
      echo "OK  $out (already present, checksum matches)"
      return 0
    fi
    echo "!!  $out exists but checksum mismatch, re-downloading"
  fi

  echo ">>  Downloading $out"
  curl -L --fail -o "$out" "$url"

  local actual
  actual=$(sha256sum "$out" | awk '{print $1}')
  if [[ "$actual" != "$expected_sha256" ]]; then
    echo "FAIL  $out checksum mismatch"
    echo "      expected: $expected_sha256"
    echo "      actual:   $actual"
    exit 1
  fi
  echo "OK  $out (verified)"
}

# Kept in sync with src/models/manifest.ts. See docs/MODELS.md for rationale.
download_and_verify \
  "https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf" \
  "assets/models/primary-llm.gguf" \
  "e4165e3a71af97f1b4820da61079826d8752a2088e313af0c7d346796c38eff5"

download_and_verify \
  "https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf" \
  "assets/models/qwen2.5-1.5b-instruct-q4km.gguf" \
  "1adf0b11065d8ad2e8123ea110d1ec956dab4ab038eab665614adba04b6c3370"

download_and_verify \
  "https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf/resolve/main/bge-small-en-v1.5-q8_0.gguf" \
  "assets/models/embedding.gguf" \
  "ec38e8da142596baa913124ae50550de284b6916bf59577ef2f0cb9660c2f514"

echo
echo "All model assets verified in assets/models/."
echo
echo "Next steps:"
echo "  npx expo prebuild -p android   # bundles these files into the APK (verify"
echo "                                  # with: sha256sum android/app/src/main/assets/models/*.gguf)"
echo "  npx expo run:android           # builds and installs on a connected device"
echo
echo "No adb push needed — the app installs its bundled models from the APK to"
echo "its document directory on first launch, purely locally, no network."
