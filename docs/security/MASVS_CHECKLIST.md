# OWASP MASVS checklist — NIDO

Self-assessment against the [OWASP Mobile Application Security Verification Standard](https://mas.owasp.org/MASVS/) control groups. Last reviewed 2026-10-10 against version 0.1.4.

This is a code review by the project, not an external audit. Nothing here was verified on a physical device unless the row says so. Status values:

- **Met** — implemented and covered by an automated test or a build-time check.
- **Partial** — implemented in part; the gap is named.
- **Not met** — not implemented.
- **Not verified** — implemented in code but needs a device or a build to confirm.

## MASVS-STORAGE

| Control | Status | Evidence / gap |
|---|---|---|
| STORAGE-1 Sensitive data is stored securely | Partial | Chats, notes, reminders, memory, contacts and the action history live in SQLCipher databases (`src/security/databaseManager.ts`, `src/rag/db.ts`). The key is in the Android Keystore via `expo-secure-store` (`src/privacy/keyManager.ts`). **Gap:** `settings.json` (theme, language, chosen model, custom system prompt, disabled tools) is a plain file in app-private storage. |
| STORAGE-2 No sensitive data leaks outside the app | Partial | `android.allowBackup: false`; data-extraction rules plugin excludes app data from cloud and device transfer; `FLAG_SECURE` on the main window blocks screenshots and the recents thumbnail; notification channels hide content on the lock screen. **Gaps:** copied text (pairing code, encryption key) stays in the system clipboard with no sensitive flag or timed clear; text typed with a third-party keyboard is outside the app's control. |

## MASVS-CRYPTO

| Control | Status | Evidence / gap |
|---|---|---|
| CRYPTO-1 Strong, standard cryptography | Met | SQLCipher (AES-256) at rest; X25519, Ed25519 and XSalsa20-Poly1305 from `tweetnacl` for P2P; HKDF-SHA512 for session keys. No home-made primitives. Covered by `src/p2p/*.test.ts`. |
| CRYPTO-2 Key management | Partial | Database key generated from the platform CSPRNG and held in the Keystore; rotation exists (`src/security/keyRotation.ts`); all-zero public keys and null shared secrets are rejected. **Gaps:** hardware backing and StrongBox cannot be confirmed from JavaScript (the in-app security check reports this honestly as "cannot be checked"); identifiers that are not secrets (note, task and chat ids) use `Math.random`. |

## MASVS-AUTH

| Control | Status | Evidence / gap |
|---|---|---|
| AUTH-1 Secure authentication protocol | Not applicable | No accounts and no server. |
| AUTH-2 Local authentication | Partial | Biometric or device-credential gate before data is shown and before sensitive actions (view key, restore) — `src/security/biometricGate.ts`. **Gap:** on a phone with no lock enrolled the user can continue after an explicit warning; the gate is a UI gate, the database key is not bound to biometric authentication. |
| AUTH-3 Step-up for sensitive operations | Partial | Restore, key display and key rotation require a fresh unlock; agent actions with outside effects require explicit confirmation (`src/agent/tools/confirm.ts`, tested). **Gap:** "erase all data" is protected by a confirmation dialog only, not by an unlock. |

## MASVS-NETWORK

| Control | Status | Evidence / gap |
|---|---|---|
| NETWORK-1 Secure network traffic | Met | The only network use is HTTPS downloads the user starts (models, corpus). Every connection is logged and shown in About (`src/privacy/networkAudit.ts`). The download catalog is signed and verified at start-up; small assets are SHA-256 checked. |
| NETWORK-2 Identity pinning | Partial | Downloads are pinned to exact revisions and hashes rather than to certificates, so a tampered file is rejected. **Gap:** no TLS certificate pinning; multi-gigabyte model files are verified on demand, not automatically. |
| P2P transport (outside MASVS scope) | Partial | Bluetooth RFCOMM with app-level end-to-end encryption and QR pairing. Open items are tracked in the audit reports (hello before admission, replay window, delegation binding) and wait for two-phone testing. |

## MASVS-PLATFORM

| Control | Status | Evidence / gap |
|---|---|---|
| PLATFORM-1 Secure use of IPC | Partial | Links handed to the OS go through an allowlist of schemes with confirmation (`src/agent/tools/externalLink.ts`, tested). **Not verified:** the exported flags of the generated Android manifest have not been reviewed on a built APK. |
| PLATFORM-2 WebViews | Not applicable | The app has no WebView. |
| PLATFORM-3 Secure user interface | Partial | `FLAG_SECURE`; confirmation dialogs for sensitive actions run in a secure window. **Gap:** no overlay (tapjacking) protection beyond the platform default. |

## MASVS-CODE

| Control | Status | Evidence / gap |
|---|---|---|
| CODE-1 Up-to-date platform | Not verified | `compileSdk` and `targetSdk` are 36. The minimum Android version is the Expo default and is not declared explicitly. |
| CODE-2 Update mechanism | Not met | No in-app update check; updates are manual APK installs. Each release ships a SHA-256 file. |
| CODE-3 Dependencies | Partial | Exact-pinned versions checked in CI (`npm run verify:deps`), Dependabot weekly, secret scanning on every push. **Gap:** no SBOM; GitHub Actions are pinned to tags, not commit hashes. |
| CODE-4 Input validation | Partial | Pairing codes, contact names, tool arguments, link targets and untrusted content blocks are validated and tested (`src/p2p/auditFixes.test.ts`, `src/agent/policy/*.test.ts`). **Gap:** no fuzzing of the P2P frame parser; no linter in CI. |

## MASVS-RESILIENCE

| Control | Status | Evidence / gap |
|---|---|---|
| RESILIENCE-1 Platform integrity | Not met | No root or emulator detection. Deliberate for an open-source alpha; revisit before a store release. |
| RESILIENCE-2 Anti-tampering | Partial | Release APKs are signed with the project key and the build fails if signing was not applied (`plugins/withReleaseSigning.js`). No runtime integrity check. |
| RESILIENCE-3 / 4 Anti-analysis | Not met | No obfuscation. The source is public, so this adds little. |

## MASVS-PRIVACY

| Control | Status | Evidence / gap |
|---|---|---|
| PRIVACY-1 Data minimisation | Met | No accounts, analytics, advertising or crash reporting. The agent action history stores tool names and outcomes only, never content (tested). |
| PRIVACY-2 No tracking | Met | No identifiers leave the device. |
| PRIVACY-3 Transparency | Met | `PRIVACY.md`, in-app privacy summary, visible network log, in-app security check. |
| PRIVACY-4 User control | Partial | Delete any chat, memory, document, contact, task or the action history; wipe everything; turn off any agent tool; undo notes and reminders the agent created. **Gap:** voice input uses the phone's speech service, which the app can ask to stay offline but cannot guarantee. |

## Open gaps, in suggested order

1. Flag clipboard copies of the encryption key and pairing code as sensitive and clear them after a timeout.
2. Review the exported components and the 16 KB page-size support on a built APK.
3. Move the custom system prompt out of plain `settings.json` into the encrypted database.
4. Declare the minimum Android version explicitly.
5. Pin GitHub Actions to commit hashes and publish an SBOM with each release.
6. Add a linter and the component tests to CI.
7. Offline-only voice recognition.
8. Commission an external review of the P2P protocol before describing it as secure in public.
