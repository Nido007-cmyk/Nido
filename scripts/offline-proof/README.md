# Offline Proof Protocol

Methodology adapted from BOAR's offline proof (MIT).

NIDO's core claim is 100% offline / zero-network. This protocol provides
a reproducible, third-party-verifiable proof for that claim.

## Components

1. **audit-apk.py** (TODO: port from the upstream project) — Statically audits an APK's network surface:
   - Manifest permissions/flags/exported components via `aapt2 dump xmltree`
   - Tracker/GMS/Firebase class prefixes in `classes*.dex`
   - Native socket imports in `.so` ELF symbols
   - Embedded hosts from DEX strings + Hermes bundle + assets
   - Signer cert SHA-256 from APK Signing Block
   - Verdicts: NO-NETWORK-BY-CONSTRUCTION / NO-INTERNET-PERMISSION / NETWORK-CAPABLE

2. **netstats-uid.sh** (TODO: port from the upstream project) — Reads kernel per-UID counters
   via `dumpsys netstats detail` to show the app sends nothing (rx=0/tx=0)
   after real use, in both airplane mode and Wi-Fi on.

## Usage

Per release:
1. Build release APK
2. Run audit-apk.py → generate report
3. Install on device, use app, run netstats-uid.sh → verify 0 bytes
4. Never cache verdicts — fresh report per release

## Status

Methodology adopted. Scripts to be ported from the upstream project's implementation.
See: https://github.com/rferrari/boar-app (scripts/audit-apk.py)
