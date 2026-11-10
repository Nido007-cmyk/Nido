# NIDO alpha — Release Notes

> This document keeps the alpha overview and the current known
> limitations, kept up to date with the latest release.
> Per-version changes from 0.1.19 on are in the
> [changelog](https://github.com/Nido007-cmyk/Nido/blob/main/CHANGELOG.md) and in each GitHub release; the notes for
> 0.1.1 to 0.1.18 are kept below for reference.

## What is this?

NIDO is a private, offline-first personal AI assistant for Android. This is an **early alpha** for testing and feedback — not a finished product.

## What's working

- Offline AI chat, 100% on-device, with a catalog of models from 0.4 GB to about 5.2 GB (Qwen 2.5 0.5B / 1.5B / 7B, Qwen3 0.6B, Phi-3.5 mini, LFM 2.5, Gemma) — pick what your phone can run
- Reminders with local notifications: once, or every day, week, month or year; countdowns ("how many days until…"); birthdays you save get a yearly reminder
- Encrypted memory of facts, people and notes, with a "My Memory" screen to review and delete them
- Answers from your own documents and from an offline knowledge base, with an optional Wikipedia pack and optional multilingual search (Spanish, English, Portuguese)
- P2P device-to-device messaging over Bluetooth or local Wi-Fi (no internet, no servers), with messages padded to fixed sizes and optional disappearing messages
- On by default since 0.1.49 (when both phones support them): a sealed "private hello", a new key for every message (Double Ratchet) and ML-KEM-768 in every connection
- New interface (0.1.55): a bottom bar with Chat, Emergency, Library, NIDO and Settings; Settings grouped into nine sections with a search box; chat history search
- Emergency tab (0.1.55): checked emergency numbers for 69 countries (32 in 0.1.58, 69 since 0.1.65; NIDO Local pack, each with its official source and check date), one-tap dialing (the person presses call), quick guides; since 0.1.65 a crisis-lines card shows the verified lines of the NIDO Crisis pack (14 countries)
- First aid answers in the guide's own words (0.1.59): when a NIDO Essentials guide is the clear match, its text is shown exactly as written, with its sources and an "Open the full guide" button, and no model rewrites it; asking for a short version (0.1.60) shows the start of the guide as written
- Carbon monoxide warnings: running a generator, grill or brazier indoors gets a fixed warning; since 0.1.60, symptoms (headache, dizziness, nausea) with a gas heater, furnace, boiler or fireplace get the "get outside and call for help" warning
- NIDO's constitution (0.1.60): how the assistant must behave, with eight firm rules checked by automated tests on every change, and 118 evaluation questions, now permanent tests in the suite
- Optional daily summary at 8:00, off unless you turn it on (0.1.60)
- A hostile PDF can no longer fill the phone's memory: NIDO's own PDF reader refuses more than 3,000 pages and stops as soon as the text reaches what fits in the import limit (0.1.64); turning on the hardware vault now asks for a backup from the last 30 days first (0.1.64)
- Answers keep being written when you leave the app (0.1.65): generation continues in the background, and if the system kills the process mid-answer the chat keeps a note that the answer was cut, instead of silence
- Nine NIDO guide packs (0.1.65): Essentials (now also in Portuguese: 174 guides), Local (69 countries), Children and Babies, Crisis, Without Utilities, Safe Home, Disasters, Field and Animals and Road Travel; the seven new packs are each in Spanish, English and Portuguese
- Corrected editions of three guide packs (0.1.66, knowledge-packs-v7): Local (every fact backed by a reachable official source), Crisis and Road Travel (the search metadata of two guides fixed, so their own questions find them); the app no longer asks for the launcher badge permission
- The full-audit version (0.1.67): a professional audit of the whole app (code, security, storage, packs, the signed catalogue, the tests, the pipelines, the public pages and the three languages) found 124 items; 88 are fixed here and proven by the full suite (4,711 tests), the catalogue signature now covers 14 fields of every entry, backups and restores fail out loud instead of half-way, and NIDO Local has a corrected edition (knowledge-packs-v8)
- Reads photos and scans (0.1.68): importing an image or a scanned PDF runs text recognition on the phone (Tesseract; English, Spanish and Portuguese) and indexes the text with its provenance marked; answers lead with the main source's card and flag any figure that contradicts its source; an emergency typed mid-generation is answered at once by the fixed routes, the fixed safety text now carries the urgency signs, the universal steps and the dose rule traced from the Essentials guides, a history question no longer trips the emergency gate, the total delete collects every file the app can leave behind, and NIDO Local is trilingual (knowledge-packs-v9: its 23 country guides in Portuguese too, 69 countries)
- The fix-everything version (0.1.69): a question that asks for a fact is judged against sources carrying that kind of fact, figures are checked in their unit and inside their range, and dates against the real calendar, so one note's data no longer crosses with another's; imports remember their warnings, each with its own reason; the built-in encyclopedia grows from 300 to 858 articles, and Esencial's Portuguese edition now stands on its own recreated source (knowledge-packs-v10 is built from it: 174 guides in the three languages); the encrypted database is proven against the real SQLCipher engine; your stored search vectors take a quarter of the space and the packaging sheds 23,507,297 bytes that no device can use (dead processor variants and unused CJK font maps), so the app file is about 20.8 MB lighter than the previous alpha even with the larger encyclopedia inside, and every library the app loads is still there; and the surface tells the truth — About no longer claims more than the app does, small text meets its contrast bar pair by pair, and the panic box and the other small targets reach the 44 size
- The full-sweep version (0.1.70): the name you saved is the one that answers in Spanish and Portuguese too, with the possessive agreeing with the person, and reminders and memory follow your words in the three languages; two birthdays written in one note no longer cross their dates, however the note is punctuated, and asking for your own birthday no longer serves your grandmother's; a dose is judged however the question is phrased — in figures, in words or in fractions, in every unit the guides use, puffs, sprays and inhalations included — and the box that teaches omissions works from the judge's own dose list; a card number is no longer taught as a phone number the source left out, and downloads hold the screen lock per file until the last hold is released; the Essentials guides answer the way people actually ask, with twelve crowns recovered and two Portuguese windows that looked closed opened by measured doses, and the whole of Essentials stands re-verified claim by claim against its official source, its citations built per claim, in knowledge-packs-v11.
- The audit fixes (0.1.71): a wrong dose written as an instruction ("take 5 tablets" where the guide says 2, "6 puffs" where it says 2, "8 low-dose aspirins" where the chest-pain guide says 2 to 4) is no longer shown as backed by its source; "Como se chama o meu pai?" answers with the saved name; a date in Portuguese suggests a reminder when you save a fact; and the repository now holds the Essentials text that was published in v11
- The catalog release (0.1.72): the signed catalog now offers knowledge-packs-v12, the Essentials pack built from the repository text with the family search keys inside it, so the way families actually ask (a fever of 39, paracetamol for a 20 kilo child, a scorpion sting, a snake bite, a swallowed coin, a faint, a cut that keeps bleeding) reaches its guide instead of being turned away at the coverage gate; the guide text is unchanged from v11, and the Portuguese recovery frontier stays as declared in 0.1.70 (variants 12/14)
- The audit fixes (0.1.73): "¿Cuándo es mi cumpleaños?" finds your birthday when the saved note says it with a pronoun ("…y el mío es el 3 de mayo"), in Spanish, English and Portuguese; and a short answer sentence taken from a long guide sentence keeps the source's negation, so its "no" is no longer dropped on the way; the signed catalog still offers knowledge-packs-v12 with the guide text unchanged, and the Portuguese recovery frontier stays as declared in 0.1.70 (variants 12/14)
- The full-audit fixes (0.1.74): a live emergency is recognised as people write it in all three languages ("my dad isn't breathing", "no puedo respirar", "não consigo respirar", a seizure, heart attack or stroke happening now), the health gate knows heart attacks, strokes and swallowed objects, and "quiero matarme" / "quero me matar" reach the crisis route (the NIDO Crisis pack's verified line, when installed) as "I want to kill myself" did; a text PDF no longer gets a false recognition warning, and a file's kind is decided by its bytes; the signed catalog still offers knowledge-packs-v12 with the guide text unchanged
- The adversarial-testing fixes (0.1.75): reminders and calendar on the right day and time ("pasado mañana", "el 15 a las 10", "de 3 a 5", "el viernes 13", "del 3 al 5 de diciembre"), and an impossible time or date ("25:00", "31 de febrero") is no longer saved; the agenda of a weekday, of next week and of the month; timers with "y media"; wake-up and alarm titles; a negation is no longer saved as a name; memory found across Spanish, English and Portuguese, and one memory can be forgotten from the chat after a confirmation; "how many days until my birthday"; a generic "the number is…" is checked against the kind of data asked for, and a short emergency number from the source is kept; "100 menos 30%" gives 70, division by zero and "≈" for cut decimals; no temperature below absolute zero; scanned pages read with the three languages; "Report" after a thumbs-down opens a draft email the user sends; errors in the user's language
- Adding a signed pack from a file (0.1.80): Settings → Knowledge base → "Add a pack from a file" adds a knowledge pack you have as a file, for example one published by SALVORA PACKS; before anything is copied, the app verifies its Ed25519 signature against the keys built into the app (NIDO's and SALVORA PACKS' — no third-party keys), checks the file's SHA-256 hash against its signed manifest and confirms the format, and refuses any pack that fails; an added pack is labelled with who signed it ("Signed by NIDO" / "Signed by SALVORA PACKS") and can be removed from the same screen
- Reading the guides as documents (0.1.81): the guide library opens any guide of the packs installed on the device and shows it whole, from start to finish, without loading the language model and without using the network, so it works even on a phone with no model downloaded yet; a very long guide is shown shortened with a note saying so, and stays stored in full in its pack; the signed catalog now offers knowledge-packs-v16 (the v15 Essentials text with new search question forms in the three languages)
- The memory-check fix (0.1.82): before loading a model, NIDO charged every model about 0.29 GB for output scores across a whole batch, but the engine only produces those scores for the last position, so on a tablet with about 3.3 GB of RAM the charge alone was bigger than the space the check allows and no model could load, however much memory was freed; the check now charges the one row the engine really produces, and it still refuses when memory is really short, for example with other apps open; the live memory reading, the 2 GB system headroom, the context ladder and the crash guard are unchanged; the models also load one at a time now, a refused load is recorded with the numbers the check saw, the chat model loads on first use and unloads after three minutes idle, small devices start with a smaller batch (and the Qwen3 model with a smaller context), a low battery, power saving or a hot device lowers the thread count, and critical system memory pressure unloads the models (0.1.83)
- The memory check charges what the load really costs (0.1.84): switching models no longer counts the outgoing model's memory as still used on the side of the check that decides; the context cache is charged at the precision the load will use and the compute buffer at the batch size the device will run, instead of the largest device's; on devices with 4 GB of memory or less, if even the smallest normal context does not fit, the check tries one short-answer context below the usual floor before refusing, pinned to the memory-saving profile it was priced with; the Execution Telemetry screen now lists every refused load with the numbers the check saw, and the records travel in its JSON and CSV exports; the 2 GB system headroom and the crash guard are unchanged
- The memory check's emergency step uses the memory that is really free (0.1.85): on devices with 4 GB of memory or less, the short-answer context of last resort is priced against the free memory Android reports at that moment, without the low-memory watermark and the fixed margin the normal steps subtract, because on the owner's tablet those two subtractions ate more than half of the free memory and even the emergency step could not fit; an orderly unload of a live model now confirms the crash guard record instead of leaving it to be counted as a crash at the next load, and a refusal judged without the live memory reading is marked as such in the Execution Telemetry record; every normal step keeps the stricter count and the 2 GB system headroom is unchanged
- The download retry settles, models marked too heavy stop offering their button, and reading surfaces keep their last line (0.1.91): after a failed download, the retry that brings the model down and verifies it now settles as installed with that single download, because the presence check retries its file hash once when the calculation itself throws (a digest mismatch is never retried into trust) and the card states the reason when a finished download cannot be shown as installed instead of staying silent; a model whose compatibility is red no longer offers a download or retry button, since red is the load path's own verdict that no context step fits the device; and the source reader, the guide library, CPR practice and the emergency country sheet now add the system bottom inset, so the last line of a long guide is no longer cut in half by the system bar
- The model answers general questions again, and its answers stop dying on the context budget (0.1.90): a question no offline guide covers is generated by the loaded model instead of refused (the deterministic refusal now guards only health and emergency questions without evidence); the generation reserve shrinks in steps before the prompt is assembled, so a turn on a model loaded with a small context window generates instead of erroring; the default answer length cap doubles to 1024 tokens, so normal answers finish whole; and an answer that still reaches its cap closes at a full sentence and says it was cut short, with an offer to continue
- The guide that matches the sign in the question wins the tie (0.1.89): when a question says you can smell, see or hear something, a guide that states its danger cannot be smelled, seen or heard loses a coverage tie to a guide that does not say that, in Spanish, English and Portuguese, and the app checks the wider candidate list before serving a sign-denying guide on its own, so a gas smell question is served the gas leak guide word for word instead of its carbon monoxide neighbour; the guide reader's header now sits below the system status bar instead of under it, and the NIDO screen's tabs size themselves to their labels, so the long tab word stays on one line and the row scrolls on a narrow phone instead of wrapping
- Imported packs answer as written, and the model badge is the verdict of the real load (0.1.86): a guide pack that entered through the signed import door and verified (NIDO by its pinned hash, SALVORA PACKS by its signature) is now served word for word from the chat without loading the language model, under the same rule as the built-in packs, closing the road that killed the app when a question matched an imported pack's guide on a tight-memory tablet; the compatibility badge of each model is judged with the same specification the load uses and the planner's verdict on the device's canonical photo, so on the owner's tablet the 1.5B model shows red because even its cheapest emergency plan does not fit there, and the Qwen3-0.6B badge matches the load that really happens; the emergency fallback keeps its emergency terms on the memory-saving retry; importing a pack opens a second picker asking for its signed manifest instead of refusing when the first selection missed it; the guide library opens from Settings in normal use; and a suspected double counting in the crash guard was replayed in a regression and does not exist, the counter stays at one and the guard is unchanged
- The menu and errors fixes (0.1.79): the side menu scrolls as one with many chats, shows the 15 most recent with "Show all", and asks before deleting a chat; error messages are in the app's language, and "Retry" no longer repeats the question; the backup key and guide welcome buttons stay on screen with large text; an optional "Allow screenshots" setting (off by default) that keeps the backup key and the pairing code protected
- The tablet fixes (0.1.78): small packs are searched in full while their index is rebuilt after an update, so the Essentials guides keep answering; the introduction of another pack's guide and the closing "Important" section of a guide never take a guide answer; before loading a model, NIDO checks the memory that is free right now, the "works well on this device" label only shows when the model really fits, the out-of-memory message and the model and pack descriptions are in the app's language, and a cut-off answer says when Android closed NIDO for lack of memory; the CPR practice camera turns off when NIDO goes to the background
- The review fixes (0.1.77): the signed catalog offers knowledge-packs-v14 (the guide text of v12, with search keys that let a description of hypothermia symptoms find its guide); the chat's emergency check recognises CPR in progress and more ways of asking how to do it, in Spanish, English and Portuguese; CPR practice counts on the beep's own clock; friend-to-friend messages stop handing out waiting envelopes when a conversation turns on disappearing messages, count the 1,500-character limit as characters you see, keep their storage limits after a restart, and never deliver a repeated message twice
- CPR practice and friend-to-friend messages (0.1.76, both experimental): "Practise CPR" on the Emergency tab is a training tool for a cushion or a manikin (beep at 110 per minute, 30:2 with the guide read aloud, optional camera rate meter that stores no frames); a message to a contact out of range can travel through another contact you both have, sealed, padded and authenticated without a transferable signature (deniable, like Signal), with a receipt back; carrying other people's messages is off by default
- Contacts show as verified only after you compare fingerprints and tap Verify (0.1.63); voice dictation only uses an on-device recognizer unless you allow the system service in Settings › Voice (0.1.63)
- Network log kept across restarts (0.1.62): every download and local Wi-Fi connection stays in the log in the encrypted database (latest 500), not only until the app closes
- Where each sentence comes from (0.1.61): under an answer's sources, a line counts the sentences from the guide, from the sources, from fixed NIDO texts and from the model with no source
- Packs keep working when a newer version comes out (0.1.57): the pack you have stays usable offline, marked "Update available", and is replaced only once the new one has downloaded and been verified
- Optional wipe button (a red shield; it used to say "SOS") and an incognito keyboard
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
- On low-end phones the first word of a long answer can take a while (about 20 seconds measured on a Galaxy Tab A9+ running 0.1.68, when several sources are used; no later version has been measured on a device yet).
- P2P Bluetooth behavior varies by phone manufacturer. See the in-app troubleshooting guide if you have connection issues.
- **A backup restored on a new installation needs the exported key.** If you reinstall or change phones, a backup can be restored with the exported database key. Without that key a backup cannot be opened anywhere, so keep the key somewhere safe and separate from the backup file.
- **Voice input uses Android's system speech recognizer** with the prefer-offline flag. On devices without an offline model, the system service may process audio online.
- **Sharing knowledge packs between phones (0.1.56) has passed the automated tests only.** Only packs from NIDO's signed catalog can be sent and installed, and only to a contact connected right now; it still needs the check on two physical phones.
- **With an older NIDO on the other side, the protections fall back to what that phone supports.** Private hello needs 0.1.45 or later on the contact's phone; the new key per message and ML-KEM need 0.1.46 or later. Otherwise the calling phone sends its public key in clear in the first message (someone recording nearby could recognise the same phone across connections, but cannot read messages).
- **Private hello and the new key per message are on by default since 0.1.49, but have not been tested on two physical phones yet.** If two phones fail to connect, turn them off in Settings and report it.
- **Disappearing messages are deleted by each phone.** An older NIDO on the other side ignores the timer, and nothing stops someone from photographing the screen with another camera.
- **Reproducible build, checked by CI only.** Two independent builds on GitHub match in all files except the signature (1,555 files for 0.1.51, which includes the native ML-KEM library). Since 0.1.55 every published release starts this check automatically against its own APK (the run is linked from the Actions tab). Nobody outside the project has rebuilt it yet; the check (`.github/workflows/reproducible.yml`, `scripts/compare-apk.py`) is public so anyone can.
- **The hardware vault is off by default.** Turn it on in Settings → Security for the strongest protection of your data.
- Builds are checked by automated tests, and the headline flows (chat and agent tools, memory, reminders and notifications, notes, and two-device P2P messaging, including airplane mode) are also exercised on physical hardware (Galaxy Tab A9+). Not every change is device-tested before every pre-release.
- **0.1.79 has not been tested on a physical phone yet.** Its fixes passed the automated tests only (6,320 on the release tree); the Android build compiles.
- **0.1.78 has not been tested on a physical phone yet.** Its fixes come from the owner's first round with 0.1.77 on a 3.3 GB tablet and passed the automated tests only (6,292 on the release tree); the Android build compiles. Low-memory devices (around 3 GB) should use Qwen2.5-0.5B and close other apps before loading a model.
- **0.1.77 has not been tested on a physical phone yet.** Its fixes passed the automated tests only (6,260 on the release tree), and the catalog move to knowledge-packs-v14 was checked against the bytes the CI built (multilingual retrieval 202/202). The owner's round for CPR practice and friend-to-friend messages described under 0.1.76 still applies.
- **0.1.76 has not been tested on a physical phone yet.** CPR practice and friend-to-friend messages passed the automated tests only (6,204 on the release tree), including three complete simulated phones that exchange a message and its receipt through the middle one, and the camera meter on synthetic video with the phone's Kotlin code matching the reference exactly. The owner's round needs: the beep and the voice in 30:2, the camera meter on a cushion, and three phones where A and C never meet and B meets both. The new cryptography of friend-to-friend messages had an internal security review before this release (format 2, see docs/RELAY.md) but not an outside one.
- **Friend-to-friend messages show what they can't hide.** A carrier sees that it carries envelopes, their size bucket and expiry, and who handed them over; a contact of the recipient can recognise envelopes for that person for up to 14 days. Messages with a disappearing timer never travel this way. Details in docs/RELAY.md.
- **CPR practice is not for a real emergency.** It has no call button and the chat never offers it; in an emergency, call your emergency number and follow the guide.
- **0.1.75 has not been tested on a physical phone yet.** The fixes passed the automated tests only (6,047 vitest tests in 359 files and 52 component tests on the release tree; the date tests pass under UTC and America/Phoenix). The owner's round on his tablets covers 0.1.74 and this build: the emergency and PDF checks of 0.1.74, plus a reminder "pasado mañana" and "el 15 a las 10", "qué tengo el viernes", "olvida mi color favorito" (the confirmation names the memory), "Report" after a thumbs-down (the email draft opens), and a scanned page in English with the app in Spanish. Anything it finds feeds the next alpha.
- **0.1.74 has not been tested on a physical phone yet.** The fixes passed the automated tests only (5,908 vitest tests in 345 files and 52 component tests on the release tree); the recognition module change was compiled into a release APK but not run on a phone. The owner's round on his tablets runs on this build: an emergency told in each language ("my dad isn't breathing", "no puedo respirar"), a text PDF (no recognition warning) and a photo of a medicine box. Anything it finds feeds the next alpha.
- **0.1.73 has not been tested on a physical phone yet.** The two audit fixes passed the automated tests on the candidate tree (5,894 vitest tests, the component suite and the seal checks of the checkable clinical hash); the owner's round on his tablets runs on this build, now published, and anything it finds feeds the next alpha.
- **0.1.72 has not been tested on a physical phone yet.** The signed catalog's move to knowledge-packs-v12 passed the automated tests and the coverage battery run against the published pack bytes (5/5 groups on both search engines); the owner's round on his tablets runs on this build, now published, and anything it finds feeds the next alpha.
- **0.1.71 has not been tested on a physical phone yet.** The dose check, the Portuguese name question and the date suggestion passed the automated tests only (5,871 vitest tests, plus a check of every numbered sentence of the 174 Essentials guides against its own guide). The family question keys of the coverage fix are in the source but not yet in a published Essentials pack: that pack needs the maintainer's catalog signature, so on a phone some family phrasings (a fever of 39, paracetamol for a 20 kilo child) can still miss their guide.
- **0.1.70 has not been tested on a physical phone yet.** The fix batch passed the automated tests and independent verification only; the owner's round on his tablets runs on this build, now published, and anything it finds feeds the next alpha.
- **0.1.69 has not been tested on a physical phone yet.** The fix batch passed the automated tests and independent verification only; the owner's round on his tablets runs on this build, now published, and anything it finds feeds the next alpha.
- **0.1.68 has not been tested on a physical phone yet.** On-device recognition of real scans, the evidence-first answers and the widened emergency gate passed the automated tests and independent audits only; the owner's round on his tablets is still pending. (Note added 2026-11-01: that was true when 0.1.68 shipped. The owner's round ran on 31 October 2026: 0.1.68 was installed as an update on his Galaxy Tab A9+ and worked well, and on-device recognition of a test document, the Local pack in Portuguese and interrupting a long answer were exercised on the device.)
- **0.1.67 has not been tested on a physical phone yet.** The audit fixes passed the automated tests only; the owner's round on his tablets is still pending.
- **0.1.66 has not been tested on a physical phone yet.** The corrected pack editions and the badge permission fix passed the automated tests and audits only; the owner's round on his tablets is still pending.
- **0.1.65 has not been tested on a physical phone yet.** The background answers and the seven new packs passed the automated tests and independent audits only; the owner's round on his tablets is still pending.
- **0.1.64 has passed the owner's physical round on his tablet (30 October 2026).** The PDF reader answered a test document's questions citing the document itself, and the hardware vault refused to turn on without a backup from the last 30 days, then turned on once one was created, its key held in the TEE.
- **0.1.63 has not been tested on a physical phone yet.** Contact verification, on-device-only dictation, the encrypted key rotation file and the pack offer quota passed the automated tests only. On a phone without an on-device speech recognizer, dictation stays off until you turn off "On-device recognition only" in Settings › Voice; your existing contacts now show as "not verified" until you compare fingerprints.
- **0.1.62 has not been tested on a physical phone yet.** The security audit fixes (network log kept across restarts, PDF text limit, packs only after you accept, the restore warning with the backup date, the real SHA-256 of backups, the removed badge permissions) passed the automated tests only.
- **0.1.61 has not been tested on a physical phone yet.** The provenance line and the faster second question passed the automated tests, and the speed change was measured on NIDO's default model on a computer CPU, not on a phone. The provenance line is not kept when you reopen a chat (the sources aren't either).
- **The new interface (0.1.55) passed the automated tests but has not been tested on a physical phone yet.** Report anything that looks or works wrong. (Note added 2026-10-31: that was true when 0.1.55 shipped. The interface has since been used on the owner's phone and tablets in the physical rounds of later versions, including the full 0.1.64 round of 30 October 2026.)
- **Emergency numbers are checked against official sources, but sources change.** A weekly check reopens every source; several official sites can't be read from GitHub's servers and need a human check. If in doubt, your local emergency number is the one to call.
- Some screens (inside NIDO messages, the setup wizard) still have their earlier look.
- UI is functional but not final.

## Security disclaimer

**This alpha has NOT undergone a professional security audit.** The app uses:

- Ed25519 signatures and X25519 key exchange for P2P (tweetnacl, audited by Cure53 in 2017); Double Ratchet and ML-KEM-768 (mlkem-native since 0.1.51, with formally verified parts; NIDO's own protocol code has not been professionally audited)
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
