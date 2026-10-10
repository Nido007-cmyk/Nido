# NIDO Alpha — Release Notes (Draft)

## What is this?

NIDO is a private, offline-first personal AI assistant for Android. This is an **early alpha** for testing and feedback — not a finished product.

## What's working

- Offline AI chat (Qwen 2.5 0.5B, runs 100% on-device)
- P2P device-to-device messaging over Bluetooth (no internet, no servers)
- Reminders with local notifications
- Encrypted on-device storage
- Backup / restore

## Known limitations

- The 0.5B model is small and will sometimes give wrong or made-up answers. We are working on honest "I don't know" behavior and better source grounding.
- P2P Bluetooth behavior varies by phone manufacturer. See the in-app troubleshooting guide if you have connection issues.
- UI is functional but not final.

## Security disclaimer

**This alpha has NOT undergone a professional security audit.** The app uses:

- Ed25519 signatures and X25519 key exchange for P2P
- SQLCipher for on-device encrypted storage
- PBKDF2 for key derivation
- Encrypted backups

These implementations have not been independently reviewed. **Do not rely on NIDO for high-stakes secrets yet.** We are building in the open so the design can be scrutinized.

## How to report issues

Please use the issue templates:

- **Bug report:** phone model, Android version, steps to reproduce, what you expected vs what happened
- **P2P / Bluetooth issue:** both device models, Android versions, whether system-level Bluetooth pairing was done, WiFi on/off during pairing
- **Feature request:** what you'd like to see and why

## License

MIT — see LICENSE file. Forked from BOAR, heavily extended. Attribution in ATTRIBUTION.md.
