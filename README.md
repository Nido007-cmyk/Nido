> **Language:** English · [Español](README.es.md)

<p align="center">
  <img src="assets/mascot-nido.png" alt="NIDO mascot" width="120">
</p>

<h1 align="center">NIDO</h1>

<p align="center"><b>Your agent, your world.</b><br>
A private AI assistant that runs entirely on your Android phone.</p>

<p align="center">
  <a href="https://github.com/Nido007-cmyk/Nido/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/Nido007-cmyk/Nido?include_prereleases&label=download"></a>
  <a href="https://github.com/Nido007-cmyk/Nido/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Nido007-cmyk/Nido/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green"></a>
  <img alt="Platform: Android" src="https://img.shields.io/badge/platform-Android-3A563F">
</p>

<p align="center">
  <img src="docs/visual/ui-chat-design.png" alt="NIDO chat: first screen, a conversation, and dark theme" width="820">
</p>
<p align="center"><sub>Design mockups of the chat in v0.1.1-alpha. The shipped screens can differ in details.</sub></p>

## What NIDO is

NIDO is a personal assistant that thinks on your phone, not on someone else's
server. The language model, your memory and your documents all stay on the
device, encrypted. There are no accounts, no cloud and no analytics.

> **Alpha software.** NIDO is an early alpha for testing and feedback. It has
> not had an independent security audit. Do not rely on it for high-stakes
> secrets yet. See [known limitations](docs/ALPHA_RELEASE_NOTES.md#known-limitations).

## What it does today

- **Chats offline** with a small language model that runs on the phone
  (llama.cpp through `llama.rn`).
- **Remembers for you**: facts, notes and reminders, stored in a database
  encrypted with SQLCipher. The key lives in the Android Keystore.
- **Acts on your requests**: reminders, notes, calendar events, unit
  conversions, arithmetic, opening links. Anything with an effect outside
  the app asks for your confirmation first.
- **Answers from your documents**: import `.txt`, `.md`, `.csv`, `.json` or
  `.pdf` files and NIDO indexes them on the phone.
- **Talks to another NIDO over Bluetooth**: encrypted messages between two
  paired phones, with no internet and no server. Pairing is done in person
  with a QR code.
- **Shows its network use**: every download the app makes is logged and
  visible in the About screen.

The interface is available in English, Spanish and Portuguese.

## Install

1. Download `app-release.apk` from the
   [latest release](https://github.com/Nido007-cmyk/Nido/releases).
2. Check it against the `app-release.apk.sha256` file published next to it.
3. Install it on an Android phone (arm64).
4. On first launch NIDO downloads its language model, between 0.5 and 1 GB
   depending on your phone's memory. This is the only time it needs the
   internet.

## Privacy and security

- Data at rest is encrypted with SQLCipher; the key is held by the Android
  Keystore and Android cloud backup is disabled.
- If the key cannot be read, NIDO stops instead of opening data unencrypted.
- Content that comes from outside (a contact's message, a file, a note) is
  treated as data, never as instructions, and actions that write or send
  something after reading it ask for confirmation.
- Bluetooth messages are end-to-end encrypted with keys exchanged by QR code
  (X25519 key agreement, Ed25519 signatures, XSalsa20-Poly1305).

[Privacy policy](PRIVACY.md) · [terms of use](TERMS.md). More detail: [privacy hardening](docs/PRIVACY.md) · [crypto architecture](docs/CRYPTO_ARCHITECTURE.md) ·
[threat model](docs/THREAT_MODEL_SUMMARY.md) · [reporting a vulnerability](SECURITY.md)

## Status

Alpha, October 2026. The project has more than 2,300 automated tests and
runs type checking and the test suite on every change. What automated tests
cannot cover is behaviour on real hardware: Bluetooth in particular varies
by phone model, and two-device validation is still in progress.

Known limitations of the current release, including what a backup can and
cannot restore, are listed in the
[release notes](docs/ALPHA_RELEASE_NOTES.md). Changes per version are in the
[changelog](CHANGELOG.md).

## Build from source

NIDO does not run in Expo Go: it uses native modules. You need the Android
SDK, NDK and a JDK, or an EAS build.

```bash
npm install
npx expo prebuild -p android --clean
npx expo run:android --device
```

Checks that do not need a device:

```bash
npm run typecheck
npm test
```

The full build guide, including release APKs and signing, is in
[AGENTS.md](AGENTS.md).

## Project layout

```
src/
  agent/      Agent: memory, tools, loop, safety policy
  p2p/        NIDO-to-NIDO messaging over Bluetooth
  privacy/    Key management and network log
  security/   Encrypted database, backup, biometric gate
  inference/  On-device language model engine
  rag/        Document indexing and retrieval
  models/     Model catalog and verified downloads
  ui/         Screens and components
  i18n/       English, Spanish and Portuguese texts
modules/      Native Android modules
docs/         Documentation (see docs/README.md)
```

## Contributing

Bug reports and feedback from testers are the most useful contribution right
now. Please use the issue templates. For code, read
[CONTRIBUTING.md](CONTRIBUTING.md) and the
[code of conduct](CODE_OF_CONDUCT.md) first.

## Credits and license

NIDO is released under the [MIT License](LICENSE).

It started as a fork of [BOAR](https://github.com/rferrari/boar-app) by the
aoair contributors, also MIT. BOAR's offline inference and retrieval
foundation is reused; the agent, the encrypted storage, the safety policy
and the Bluetooth protocol are NIDO's own work.
[ATTRIBUTION.md](ATTRIBUTION.md) lists what came from where.
