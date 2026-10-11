# NIDO v0.1.9-alpha — Release Notes

## What is this?

NIDO is a private, offline-first personal AI assistant for Android. This is an **early alpha** for testing and feedback — not a finished product.

## What's working

- Offline AI chat, 100% on-device, with a catalog of models from 0.4 GB to 5 GB (Qwen 2.5 0.5B / 1.5B / 7B, Phi-3.5 mini, LFM 2.5, Gemma) — pick what your phone can run
- P2P device-to-device messaging over Bluetooth (no internet, no servers)
- Reminders with local notifications
- Encrypted on-device storage
- Backup / restore

## What changed in 0.1.9-alpha

> **Pre-release.** Built and checked by automated tests. Please report anything that fails in Issues.

- **Hardware protection is now easy to find: Settings → Security** (first section). Before, it was halfway down About, and on some devices the card didn't show at all.
- The card always shows now and explains why if it can't be used — for example, if the tablet has no PIN, pattern or password.
- Agent replies for NIDO messages, your pairing code and files are now in English and Portuguese too, not only Spanish.

## What changed in 0.1.8-alpha

> **Pre-release.** Built and checked by automated tests; real-device testing is ongoing. Please report anything that fails in Issues.

**The agent understands more, without depending on the small model** (Spanish, English and Portuguese)
- **Notes:** "take a note: buy milk", "my notes", "read the note about the trip" (by title, no more internal ids).
- **Time and date:** "what time is it?", "what day is it?".
- **Conversions:** "10 km to miles", "100 degrees celsius to fahrenheit".
- **Calendar:** "what do I have tomorrow?", "schedule dentist on Friday at 10". You confirm before anything is created.
- **NIDO messages:** "send a nido message to Ana saying hi", "read my messages", "my pairing code".
- **Links and files:** "open https://…", "analyze a csv".
- Fixed: "create a note…" and "create an event…" were saved as reminders.
- If a tool is turned off in About, NIDO tells you so instead of trying anyway.

**Knowledge base**
- **No more "Preparing your knowledge…" every time you open NIDO.** The check was fragile: a knowledge pack removed with the trash icon left its index behind and forced a full re-check on every start. Now NIDO only processes what's actually missing and cleans up removed packs.
- Settings shows **"Downloaded · indexing x / y"** until a pack is really ready, instead of "In your knowledge base" as soon as it's downloaded.

**Stability and conversation**
- Dates are formatted without Android's Intl bridge in every agent tool (the same cause as the reminder crash fixed in 0.1.5).
- Short replies that bounce the question back ("good, and you?", even with typos) get a natural answer.

## What changed in 0.1.7-alpha

> **Pre-release.** Built and checked by automated tests; real-device testing is ongoing. Please report anything that fails in Issues. Pairing and fingerprints are unchanged from 0.1.6.

**New: Hardware protection (optional, Android 11+)** — About → Hardware protection
- Ties the key of your NIDO data to the tablet's security chip (StrongBox/TEE). With it on, NIDO only opens with your PIN, pattern or fingerprint, and the key can't be copied out of the device.
- **Maximum security mode** (optional): if NIDO stays in the background for 30 s, 1 min or 5 min, it closes completely and wipes the key from memory.
- ⚠️ **Make a backup first.** If you remove the tablet's screen lock, Android destroys the protected key; the backup is how you get your data back.
- New and not yet tested on many devices: please report anything odd in Issues.

**Agent tools (from a full audit of the 9 tools)**
- **Contact search works on Android.** It never did: the code used an iOS-only function. Search also ignores accents now ("Ruben" finds "Rubén").
- **Contacts, calls and SMS work in Spanish, English and Portuguese**, without depending on the small model: "find contact Ana", "call Ana", "llama a Ana", "liga para a Ana", "text Ana that I'm late". "Call Ana" looks her up and asks which one if there are several.
- **No more lock screen after a permission prompt.** Asking for a contact, the calendar or a file sent you to "NIDO locked" every time. NIDO now checks the permission first and only asks when it's missing.
- **Clear confirmations:** call and SMS dialogs show the number and the full text, in your language.
- Turning a tool off in About now also turns off its shortcut (the calculator ignored it).

**Answers you can trust more**
- **Small talk gets a real answer.** "Good, and you?", "thanks" or "ok" get a direct reply, with no source search and no "no sources" note.
- **Answers stick to the offline sources.** NIDO checks each sentence against the sources and removes the ones they don't support, and tells you it did. If nothing is left, it says it doesn't know and shows what the source does say.
- **Factual questions with no sources get an honest "I don't know"** instead of an invented answer.
- **The sources header says what was checked**: "Based on these offline sources", "unsupported sentences removed", or "sources found, but they don't answer this exactly".
- **NIDO always answers.** No empty bubbles, and no fake "Done." when nothing was done.

**Known limits**
- The source check compares words, not meaning. It catches invented details, but not a sentence that reorders the source's words to say something false.
- The built-in knowledge is in English. For questions in Spanish or Portuguese only numbers can be checked automatically, and the header says so.
- "Send a message to Ana" without saying SMS still depends on the model (it could mean SMS or a NIDO message). Creating calendar events still depends on the model writing the date.

## What changed in 0.1.6-alpha

> **Pre-release.** Built and checked by automated tests; real-device testing is ongoing. Please report anything that fails in Issues.

> ⚠️ **Update both devices before pairing.** The security fingerprint shown under the QR code changed (see below), so a v0.1.6 device and a v0.1.5 device will show different fingerprints. Already-paired contacts keep working.

**Security (from a full security audit)**
- **Pairing fingerprint now covers both keys.** The numbers you compare out loud under the QR code now include the signing key that protects every connection. Before, a tampered QR code could keep the same fingerprint.
- **A contact's key can no longer be replaced silently.** If someone shows a QR code with a known contact's identity but a different key, NIDO warns you and saves nothing.
- **Your identity is no longer revealed to strangers on Wi-Fi.** The device that receives a local Wi-Fi connection stays silent until the other side proves it is one of your contacts.
- **Wi-Fi connections that don't authenticate are closed** (before, someone on the same network could tie up all connection slots).
- **Negotiations are never accepted automatically**, and a delegated task must come from the same contact as its negotiation.

**P2P**
- **Connect works from either tablet.** The waiting side calls on its own after a few seconds if the other doesn't — without colliding when both tap Connect.
- **First Connect over Wi-Fi works** (it waits a few seconds for the other device to appear on the network).
- After a forced close, NIDO no longer tries to connect to **itself** over Wi-Fi.
- "Bluetooth off, using local Wi-Fi" is shown as a note, not as an error. The help text no longer tells you to turn Wi-Fi off.
- Messages arriving right as a connection finishes are no longer lost.

**Stability and performance**
- **The Evaluation screen no longer freezes the app** (root cause: on React Native, `setImmediate` never yields to Android; the benchmark now yields with `setTimeout`).
- **Less RAM for the AI model:** smaller compute batch and compressed context cache (q8_0), with automatic fallback to the previous settings if a device rejects them.

## What changed in 0.1.5-alpha

- **Reminder crash fixed.** Asking the agent to remind you of something at a time no longer closes the app.
- **The Evaluation screen no longer freezes the device.** The root cause was a security benchmark (PBKDF2) blocking the UI; it now runs in small steps and has a Stop button.
- **Crash diagnostics**: About → Crash diagnostics shows what happened the last time the app closed unexpectedly, so you can include it in a bug report.
- **Setup no longer starts over** on every launch if you picked the lighter AI model.
- **P2P over local Wi-Fi**: if Bluetooth fails, two NIDOs on the same Wi-Fi or hotspot can still connect.
- **Reconnects after a crash**: paired devices reconnect on their own after the app closes unexpectedly.
- **Delete negotiations** whenever you want (only on your device; use Decline to notify the other side).
- **Security hardening** from a full audit: stronger anti-replay protection, revoked contacts blocked everywhere, human approval required for sensitive delegated tasks, size limits on handshakes and strict text decoding.
- **Pack sharing** shows a clear message instead of a generic error while the feature is finished.
- Not yet tested on a physical device: Wi-Fi P2P and reconnect after a crash. Please report anything that fails.

## What changed in 0.1.4-alpha

- **The agent history is kept** between sessions (encrypted, tool names and results only) and can be deleted from About.
- **Undo**: a note or reminder the agent created can be undone from the history.
- A security self-assessment against OWASP MASVS is in `docs/security/MASVS_CHECKLIST.md`.

## What changed in 0.1.3-alpha

- **Scheduled tasks work.** About → Scheduled tasks → New task: give it a name, say what the agent should do, pick a time and the days. The agent runs it on its own; the result appears in the card and in a notification.
- Tasks run while NIDO is open. If the app is closed at that time, your phone shows a notice and the task runs when you open the app.
- A scheduled task can read your notes, calendar and inbox and save notes. It can never send messages, call, pair or open other apps.
- Not yet tested on a physical device.

## What changed in 0.1.2-alpha

- **Backup is now reachable**: About → Open backup. Create an encrypted backup, view and copy your encryption key, or rotate it.
- **New look on every screen**, matching the chat, in both the light and the dark theme. Tone, memory and voice settings no longer stay dark in the light theme.
- **What the agent did**: About lists every tool the agent used or tried to use in the session and how it ended.
- **Agent permissions**: turn off any tool you do not want the agent to use.
- **Restore from another phone**: Settings → Restore with the backup's key, for backups made on another phone or before rotating your key. Not yet tested on a physical device — keep your original backup file.
- **Security check** in About: confirms on your phone that the database is encrypted and that key storage and the biometric lock work.
- About also lists what the agent can do, and includes a privacy summary and a notice about the limits of on-device AI.
- Screen readers: every button announces itself as a button, and icon-only buttons have spoken labels.
- Backup dialogs are fully translated (English, Spanish, Portuguese).
- New privacy policy and terms of use in the repository.

## What changed in 0.1.1-alpha

New look for the chat: calmer background, a solid bubble for your messages, NIDO's mascot as its avatar, a rounded composer, and tappable suggestions on the first screen. The header now says “Offline · private” instead of the model's technical name, and the NIDO screen uses segmented tabs.

Fixes from the 2026-10-10 code audit:

- The agent now recognizes many more everyday requests (messages, notes, reminders, unit conversions, arithmetic) in Spanish, English and Portuguese.
- Content received from a contact, a file or a note can no longer break out of the "data only" block the agent reads it in. Saving a note or creating a reminder right after reading such content asks for confirmation.
- Pairing codes reject names with invisible, control or look-alike mixed-alphabet characters, and all-zero keys.
- Backups now include the knowledge database, and a file that cannot be verified is no longer accepted for restore.
- Remote tasks sent by a contact are now visible in the NIDO screen, where you can approve or reject them.
- You can delete a paired contact from the Contacts tab.
- The network log is visible in the About screen.
- Error and pairing dialogs that showed raw text keys now show real text in all three languages.
- The quick calculator no longer answers "1.000 + 1" as 2.
- Releases are built only from version tags, and each APK ships with a SHA-256 file generated by CI.

## Known limitations

- The 0.5B model is small and will sometimes give wrong or made-up answers. We are working on honest "I don't know" behavior and better source grounding.
- P2P Bluetooth behavior varies by phone manufacturer. See the in-app troubleshooting guide if you have connection issues.
- **A nearby device can tell that you run NIDO.** When any Bluetooth device connects to NIDO's service, NIDO sends its public identity key before knowing who connected. A fix exists and is waiting for two-device testing.
- **A backup can only be restored on the installation that created it.** If you reinstall or change phones, earlier backups cannot be restored, even with the exported key.
- **Voice input uses Android's system speech recognizer** with the prefer-offline flag. On devices without an offline model, the system service may process audio online.
- **Sharing knowledge packs between phones is not available yet.** The tab is hidden.
- This build was verified by automated tests only. The changes in this version were not tested on a physical device before release.
- The redesign in this version covers the chat, the header and the NIDO tabs. Settings, Memory, Documents and the remaining screens keep their previous look for now.
- UI is functional but not final.

## Security disclaimer

**This alpha has NOT undergone a professional security audit.** The app uses:

- Ed25519 signatures and X25519 key exchange for P2P
- SQLCipher for on-device encrypted storage
- A random 256-bit database key held in the Android Keystore (no password-based key derivation)
- Backups that are a copy of the already-encrypted database; the key is exported separately, in plain hex, and a backup can currently be restored only on the installation that created it

These implementations have not been independently reviewed. **Do not rely on NIDO for high-stakes secrets yet.** We are building in the open so the design can be scrutinized.

## How to report issues

Please use the issue templates:

- **Bug report:** phone model, Android version, steps to reproduce, what you expected vs what happened
- **P2P / Bluetooth issue:** both device models, Android versions, whether system-level Bluetooth pairing was done, WiFi on/off during pairing
- **Feature request:** what you'd like to see and why

## License

MIT — see LICENSE file. Forked from BOAR, heavily extended. Attribution in ATTRIBUTION.md.
