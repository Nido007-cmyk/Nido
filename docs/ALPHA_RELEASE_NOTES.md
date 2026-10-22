# NIDO alpha — Release Notes

> This document keeps the alpha overview and the current known
> limitations, kept up to date with the latest release (0.1.43-alpha).
> Per-version changes from 0.1.19 on are in the
> [changelog](../CHANGELOG.md) and in each GitHub release; the notes for
> 0.1.1 to 0.1.18 are kept below for reference.

## What is this?

NIDO is a private, offline-first personal AI assistant for Android. This is an **early alpha** for testing and feedback — not a finished product.

## What's working

- Offline AI chat, 100% on-device, with a catalog of models from 0.4 GB to 5 GB (Qwen 2.5 0.5B / 1.5B / 7B, Qwen3 0.6B, Phi-3.5 mini, LFM 2.5, Gemma) — pick what your phone can run
- Reminders with local notifications: once, or every day, week, month or year; countdowns ("how many days until…"); birthdays you save get a yearly reminder
- Encrypted memory of facts, people and notes, with a "My Memory" screen to review and delete them
- Answers from your own documents and from an offline knowledge base, with an optional Wikipedia pack and optional multilingual search (Spanish, English, Portuguese)
- P2P device-to-device messaging over Bluetooth (no internet, no servers)
- Encrypted on-device storage
- Backup / restore
- About → Licenses: the license of NIDO, of every downloadable model and pack, of the Wikipedia text inside the app and of every open-source package it is built with
- On-device measurements (generation speed, time to first word, routing time, how many commands the router missed and sent to the model, and how many prepared commands were dropped before running, and why) that never leave the phone

## Earlier releases (0.1.1 – 0.1.18)

### What changed in 0.1.18-alpha

> **Pre-release.** Built and checked by automated tests. Please report anything that fails in Issues.

- **Reminders ring at the right time.** "At 7 in the morning" or "at 9 at night" are now understood correctly (they could ring 12 hours off), plus "in half an hour", "at noon" and "at midnight".
- **Calculator fixes.** "-2^2" is -4, percentages ("15% of 200"), "7 x 8" and decimal commas work, and huge numbers are marked as approximate.
- **Safer settings and backup key.** Settings can't erase each other or get lost if the app is closed while saving; the backup key is hidden from clipboard history and screenshots.
- **Safer document import.** Huge files are refused instead of risking a crash, and empty PDFs are reported.

### What changed in 0.1.17-alpha

> **Pre-release.** Built and checked by automated tests. Please report anything that fails in Issues.

- **Clearer NIDO-to-NIDO errors.** When pairing or connecting fails, NIDO says what happened and what to do (turn on Bluetooth, bring the devices closer, open NIDO on both) in your language.
- **Key rotation in your language.** The fingerprint prompt and its errors no longer appear in Spanish for everyone.
- **Cleaner error messages** in the knowledge base (no more internal debug tags).

### What changed in 0.1.16-alpha

> **Pre-release.** Built and checked by automated tests. Please report anything that fails in Issues.

- **Fewer crash risks.** Dates and numbers on a dozen screens no longer use the Android system path that could close the app on some devices.
- **Answers in your language.** Saving a fact ("remember that…"), a person, or a backup error now speak English or Portuguese when the app is set to them.

### What changed in 0.1.15-alpha

> **Pre-release.** Built and checked by automated tests. Please report anything that fails in Issues.

- **NIDO messages stay connected with the app closed.** Android (Samsung tablets especially) puts apps to sleep after a while to save battery, which dropped the link between tablets. The NIDO screen now offers to let NIDO run in the background: tap **Allow** and accept the system dialog. It uses very little battery.

### What changed in 0.1.14-alpha

> **Pre-release.** Built and checked by automated tests. Please report anything that fails in Issues.

- **New: "Learn to use NIDO"** — a short guide in Settings → Help (and in the menu) with examples you tap to try: they're typed into the chat and you decide when to send them. Six modules: getting started, getting organized, knowledge, connecting, your privacy, and making NIDO yours.
- **New installs** get a three-screen welcome you can skip.
- **"What reminders do I have?"** now lists your pending reminders.
- The calculator, reminders and memory understand English and Portuguese phrasing too, and reminder confirmations come in your language.

### What changed in 0.1.13-alpha

> **Pre-release.** Built and checked by automated tests. Please report anything that fails in Issues.

> **Includes 0.1.12**, which was not published separately: its build was superseded by this one. All 0.1.12 fixes (below) are in this download.

- The storage usage in Settings now counts the search index NIDO builds for the multilingual Wikipedia pack (~45 MB), so the total matches what's really on your device.

### What changed in 0.1.12-alpha

> **Pre-release.** Built and checked by automated tests. Please report anything that fails in Issues.

- **Important fix for new installs in Spanish or Portuguese:** NIDO went back to the setup screen every time it opened. Fixed.
- Turning "Spanish & Portuguese search" on and off quickly now always ends in the last choice you made.
- If the model download hiccups and retries by itself, NIDO waits for it instead of showing an error too early.

### What changed in 0.1.11-alpha

> **Pre-release.** Built and checked by automated tests. Please report anything that fails in Issues.

**Search in Spanish and Portuguese**
- New in **Settings → Knowledge base: "Spanish & Portuguese search"**. NIDO downloads a 126 MB multilingual search model once and rebuilds its search index in the background — you can keep chatting, keyword search works meanwhile.
- Questions in Spanish or Portuguese now find the right article even when it's written in English. In our tests with the built-in knowledge base: Spanish 50% → 85%, Portuguese 48% → 90% of questions answered from the right article, with fewer made-up "sources".
- New installs in Spanish or Portuguese get it from the start. English users keep the original model, unchanged.
- **Wikipedia Vital (multilingual)**: a version of the 50,000-article pack made for the new model (CC BY-SA 4.0, compiled by NIDO from Wikipedia). With multilingual search on, it's offered instead of the old one.
- Everything stays on your device, as always.

### What changed in 0.1.10-alpha

> **Pre-release.** Built and checked by automated tests. Please report anything that fails in Issues.

**Use NIDO from outside the app**
- **Share → NIDO:** select text in any app, tap Share and pick NIDO. A new chat opens with the text in the box, ready to edit or send. Nothing is sent on its own.
- **Icon shortcuts:** long-press the NIDO icon for **New chat** and **NIDO messages**.
- **Quick Settings tile "Ask NIDO":** add it from the quick settings edit screen. If the tablet is locked, it asks you to unlock first.

### What changed in 0.1.9-alpha

> **Pre-release.** Built and checked by automated tests. Please report anything that fails in Issues.

- **Hardware protection is now easy to find: Settings → Security** (first section). Before, it was halfway down About, and on some devices the card didn't show at all.
- The card always shows now and explains why if it can't be used — for example, if the tablet has no PIN, pattern or password.
- Agent replies for NIDO messages, your pairing code and files are now in English and Portuguese too, not only Spanish.

### What changed in 0.1.8-alpha

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

### What changed in 0.1.7-alpha

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

### What changed in 0.1.6-alpha

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

### What changed in 0.1.5-alpha

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

### What changed in 0.1.4-alpha

- **The agent history is kept** between sessions (encrypted, tool names and results only) and can be deleted from About.
- **Undo**: a note or reminder the agent created can be undone from the history.
- A security self-assessment against OWASP MASVS is in `docs/security/MASVS_CHECKLIST.md`.

### What changed in 0.1.3-alpha

- **Scheduled tasks work.** About → Scheduled tasks → New task: give it a name, say what the agent should do, pick a time and the days. The agent runs it on its own; the result appears in the card and in a notification.
- Tasks run while NIDO is open. If the app is closed at that time, your phone shows a notice and the task runs when you open the app.
- A scheduled task can read your notes, calendar and inbox and save notes. It can never send messages, call, pair or open other apps.
- Not yet tested on a physical device.

### What changed in 0.1.2-alpha

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

### What changed in 0.1.1-alpha

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

- The 0.5B model is small and will sometimes give wrong or made-up answers. Since 0.1.36 NIDO shows no source when nothing in its knowledge base really matches, but the model can still answer wrongly from its own knowledge.
- On low-end phones the first word of a long answer can take a while (about 20 seconds measured on a Galaxy Tab A9+ when several sources are used).
- P2P Bluetooth behavior varies by phone manufacturer. See the in-app troubleshooting guide if you have connection issues.
- **A backup restored on a new installation needs the exported key.** If you reinstall or change phones, a backup can be restored with the exported database key. Without that key a backup cannot be opened anywhere, so keep the key somewhere safe and separate from the backup file.
- **Voice input uses Android's system speech recognizer** with the prefer-offline flag. On devices without an offline model, the system service may process audio online.
- **Sharing knowledge packs between phones is not available yet.** The tab is hidden.
- **The phone that starts a NIDO-to-NIDO connection sends its public key in clear** in the first message. Someone recording Bluetooth or Wi-Fi traffic nearby could recognise the same phone across connections (they cannot read messages). Hiding it is planned.
- **The hardware vault is off by default.** Turn it on in Settings → Security for the strongest protection of your data.
- Builds are checked by automated tests, and the headline flows (chat and agent tools, memory, reminders and notifications, notes, and two-device P2P messaging, including airplane mode) are also exercised on physical hardware (Galaxy Tab A9+). Not every change is device-tested before every pre-release.
- Some screens still have their earlier look; the visual redesign is not finished everywhere.
- UI is functional but not final.

## Security disclaimer

**This alpha has NOT undergone a professional security audit.** The app uses:

- Ed25519 signatures and X25519 key exchange for P2P
- SQLCipher for on-device encrypted storage
- A random 256-bit database key held in the Android Keystore (no password-based key derivation)
- Backups that are a copy of the already-encrypted database; the key is exported separately, in plain hex, and restoring a backup on a different installation requires that exported key

These implementations have not been independently reviewed. **Do not rely on NIDO for high-stakes secrets yet.** We are building in the open so the design can be scrutinized.

## How to report issues

Please use the issue templates:

- **Bug report:** phone model, Android version, steps to reproduce, what you expected vs what happened
- **P2P / Bluetooth issue:** both device models, Android versions, whether system-level Bluetooth pairing was done, WiFi on/off during pairing
- **Feature request:** what you'd like to see and why

## License

MIT — see LICENSE file. Forked from BOAR, heavily extended. Attribution in ATTRIBUTION.md.
