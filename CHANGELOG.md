# Changelog

All notable changes to NIDO are recorded here. Versions follow
[Semantic Versioning](https://semver.org/); alpha releases are tagged
`vX.Y.Z-alpha`.

## 0.1.21-alpha — 2026-10-12

A new model in the catalog, and a full audit of how NIDO treats every
model it ships. Each catalog entry was checked against its maker's
official specs, and the mismatches were fixed: memory estimates that
were far too optimistic, chat templates not being used on every route,
and manufacturer sampling recipes that never reached the engine.

### Added
- Qwen3-0.6B (Q4_K_M) in the model catalog as an optional download:
  the newest generation of the light model, stronger at following
  instructions than Qwen2.5-0.5B at the same ~0.4GB size. It runs with
  its thinking mode switched off, so it answers directly like the
  other models.
- Manufacturer sampling recipes are now applied per model, under the
  app's per-task settings: Qwen models get their published
  top_p 0.8 / top_k 20, Gemma 4 its top_p 0.95 / top_k 64, and
  LFM2.5 its full official recipe (temperature 0.2, top_k 80,
  repetition penalty 1.05).

### Fixed
- Memory (RAM) estimates before loading a model were far too
  optimistic for the heavy models, because three catalog entries did
  not declare their real architecture. Phi-3.5-mini's context cache
  is about 13x larger than the old estimate (~1.5GB at 4k context),
  Qwen2.5-7B's about 2x. All entries now declare their real profile,
  so the pre-flight check can refuse a load the device cannot hold
  instead of dying mid-conversation.
- Phi-3.5-mini and Qwen2.5-7B now use their own chat templates on the
  adaptive route too, not just in direct chat — the same model no
  longer behaves differently depending on the route.
- LFM2.5-8B-A1B is a reasoning-only model and was treated like a
  plain chat model: with the normal answer budget its replies could
  spend every token thinking and never produce an answer. It now
  gets a 2048-token floor on answer paths, its official sampling
  recipe, and its chain of thought is kept out of the saved answer
  text (the model still reasons; you just read the answer).
- Release notes are now composed from this changelog for the exact
  version being published. Earlier alphas shipped with the previous
  version's notes because the workflow read a static file; the job
  now refuses to publish if the version has no changelog section.

## 0.1.20-alpha — 2026-10-12

Memory that actually saves and answers back, the audit's remaining
routing gaps (P3), and a timer. Every fix came from real phrases —
several from the tablet — and ships with its exact phrase as a
regression test.

### Added
- Timer: "pon un temporizador de 10 minutos" (EN/PT too). A timer is a
  reminder whose time is now + duration, so it rings with the same
  notification and lives in the same list.
- Delete by chat: "borra la nota de la receta", "cancela el
  recordatorio de mañana", "borra todos mis recordatorios". Every
  delete confirms first, naming the item; bulk deletes go one by one
  and stop at the first "no".
- Search inside notes: "busca en mis notas la receta" searches titles
  and bodies.
- Memory queries answered from what you saved: "¿cómo se llama mi
  mamá?", "¿cómo me llamo?", "¿cuándo es mi cumpleaños?", "¿qué coche
  tengo?" — and an honest "you haven't told me that yet" when the data
  isn't there, instead of a made-up answer with a fake source.

### Fixed
- People now save the way people actually type: "Mi mama se llama
  Marta" (no accent), lowercase names, Portuguese forms, more
  relationships (cuñado, suegra, nieto, mejor amigo), and two people
  at once ("mis hijos se llaman Leo y Max"). Introducing yourself
  ("Yo me llamo Ruben", "my name is Ruben") saves your name too.
- Facts without the word "recuerda" now save when they're clearly
  about you ("mi cumpleaños es el 3 de mayo", "vivo en Tucson", "mi
  coche es un Toyota") — birthdays still create their reminder.
  Sensitive numbers are never auto-saved implicitly.
- Numeric dates ("05/11", "11/05/2027") now produce birthday
  reminders, not just spelled-out months.
- Calculator named forms in English and Portuguese: "half of 80",
  "square root of 144", "a metade de 80". Before, they fell to the
  model and came back with an absurd sources panel.
- "Avísame a las 3 de estudiar" and "despiértame a las 7" now create
  reminders (a wake-up at 7 means 7 AM, not 7 PM).
- "Manda un mensaje a Juan" works without saying "por NIDO".
- "Hazme un plan semanal" generates the weekly plan, like
  "planifica mi semana" already did.
- Currency questions ("¿cuántos dólares son 100 pesos?") get the
  honest offline answer instead of an invented exchange rate.
- A note whose body repeats its title is no longer shown twice
  (existing notes are fixed on read; nothing to migrate).
- Source numbers (1, 2, 3…) were clipped inside their circle; the
  badge is now sized for the glyph.

## 0.1.19-alpha — 2026-10-12

Routing audit: normal phrases that never reached the right tool and fell
to the small model instead.

### Fixed
- Reminder lists with a day: "what reminders do I have today / tomorrow"
  (and the Spanish and Portuguese forms) now list that day's reminders.
  Before, the phrase fell to the model and answered from the knowledge
  base — the exact failure seen on the tablet.
- Calculator without a trigger phrase: "15% of 200", "245*38", "9 por 7",
  "45 más 67", "suma 45 y 67", "la mitad de 80", "el doble de 35",
  "raíz cuadrada de 144", "2 elevado a 10", "cuánto es 1,5 por 4",
  "cuánto son 3 docenas", "cuánto sería la propina del 15% de 230".
  A date typed on its own ("12/10/2026") is not treated as a division.
- Conversions asked as questions: "cuántos pies son 2 metros", "cuánto
  es 70 kg en libras", "how many feet are in 2 meters", "quantos pés são
  2 metros". The imperative forms already worked; the question forms
  depended on the model.
- Reminders with the time first ("mañana recuérdame comprar pan", "en
  media hora recuérdame la junta") were saved with no time and would
  never have rung. The time is now read from the whole phrase.
- "Recuerda que mañana tengo dentista" was stored as a memory fact and
  no reminder existed; with a future date and a first-person event it is
  now a reminder. And "recuérdame cómo se llama la capital de Francia"
  is a question again: it no longer creates a junk reminder (or a junk
  memory fact).
- Repeating reminders ("cada día recuérdame tomar la pastilla") were
  silently saved as one-time. Repeats are not supported yet, and the
  confirmation now says so instead of letting you believe it repeats.
- "Ponme un recordatorio para el viernes" no longer saves a reminder
  titled "para".

## 0.1.18-alpha — 2026-10-12

Offensive audit: trying to break the app.

### Fixed
- Reminders at the wrong time: "at 7 in the morning" (es/pt: "de la
  mañana", "da manhã") rang TOMORROW at 19:00; "9 at night" rang at 9:00,
  "2 in the early morning" at 14:00. "In half an hour", "at noon" and "at
  midnight" now work. 29 February no longer becomes 1 March; a date with a
  past year is not moved to next year.
- Calculator: "-2^2" is -4 (was 4); "3!" is no longer answered as 3; huge
  integers are shown as approximate instead of with invented last digits.
  Now understands "15% of 200", "7 x 8", "12 ÷ 4" and decimal commas.
- Settings: two changes close together could erase each other (a tool just
  switched off could come back on), and a write interrupted by the app being
  killed reset every setting. Changes are now queued and written atomically.
- Backup key: copying it now marks it as sensitive (hidden from keyboard
  clipboard history on Android 13+) and clears it after a minute; the key
  shown after creating a backup is in a screenshot-protected dialog.
- Importing documents: files over 25 MB (text) / 100 MB (PDF) are refused
  instead of risking a crash; a PDF without text says so instead of creating
  an empty collection; a failed import no longer leaves hidden data behind.
  Import errors are in the app language.
- Text fields have limits (P2P proposals longer than the other NIDO accepts
  were silently dropped).

## 0.1.17-alpha — 2026-10-12

### Fixed
- NIDO messages (P2P): connection, pairing and QR errors are explained in
  plain words and in the app language ("Bluetooth is off", "bring the
  devices closer…") instead of the transport's technical message.
- Rotating the encryption key: the fingerprint prompt and the errors are in
  the app language (they were always in Spanish).
- Knowledge base: leftover debug instrumentation no longer adds
  "[seed-stage:…]" to errors shown on screen (it only goes to the log now).

## 0.1.16-alpha — 2026-10-12

### Fixed
- Dates and numbers on a dozen screens (network log, agent permissions,
  scheduled tasks, remote tasks, telemetry, negotiations, message times,
  indexing counters) no longer go through Android's Intl. On some devices
  that path can close the app (same crash class fixed for reminders in
  0.1.10). Same format on every phone, in the app language.
- "Remember that…" and saving a person answered in Spanish whatever the app
  language; now in English / Portuguese too. "I'll create a reminder" now
  says "I created" (it was already created).
- Backup errors (wrong key, invalid file, cancelled unlock…) are shown in the
  app language instead of always in Spanish.
- Untranslated labels: "Contacto:" / "Propuesta:" in Negotiations and
  "Backup" in Settings.

## 0.1.15-alpha — 2026-10-12

### Added
- NIDO messages: when you use P2P and Android is still battery-optimizing
  NIDO, the NIDO screen offers to let it run in the background (system
  dialog). Android's battery saver froze NIDO after a while with the app
  closed and the link dropped until it was opened again.

## 0.1.14-alpha — 2026-10-12

### Added
- User guide "Learn to use NIDO" (Settings → Help, and the menu): short
  lessons in six modules with examples you tap to try. Examples are typed
  into the chat, never sent on their own. Lessons say when a tool is
  switched off. A test sends every example of every language through the
  real routers, so the guide can't promise something that doesn't work.
- First-run onboarding (three screens, skippable) on new installs.
- "What reminders do I have" lists pending reminders (es/en/pt).
- Calculator, reminders and memory now also understand English and
  Portuguese phrasing ("what is 245 * 38", "remind me to…", "me lembra
  de…", "lembre que…").

### Fixed
- Reminder confirmations were always in Spanish; now in the app language.

## 0.1.13-alpha — 2026-10-12

Includes 0.1.12, which was not published as a separate release.

### Fixed
- Settings → usage: the knowledge base size now includes the vector index
  built next to a knowledge pack for multilingual search (~45 MB for
  Wikipedia Vital), which wasn't counted.

## 0.1.12-alpha — 2026-10-12

### Fixed
- New installs in Spanish or Portuguese went back to the setup wizard on
  every launch: the start-up check only looked for the English search
  model, which those installs don't download.
- Turning Spanish & Portuguese search on and off quickly could lose the
  second request; requests now run in order and the last one wins.
- A download that failed and was retrying automatically showed an error
  while it was still working; the search setting now waits for the retries.
- Choosing the search model that is already active no longer rebuilds the
  search index.
- Packs declaring a different vector size are searched by keywords only.

## 0.1.11-alpha — 2026-10-12

### Added
- Search in Spanish and Portuguese (Settings → Knowledge base): a
  multilingual search model (multilingual-e5-small, 126 MB, optional) finds
  the right article even when it's written in English. On by default for
  new installs in Spanish or Portuguese; existing installs choose. Search
  index rebuilt in the background; keyword search keeps working meanwhile.
- Wikipedia Vital pack for multilingual search (CC BY-SA 4.0, compiled by
  NIDO), searched in full with a native vector index.

### Fixed
- Dates like "tomorrow" in agent tool requests now use the request's
  reference time (a test failed depending on the day CI ran).

## 0.1.10-alpha — 2026-10-11

### Added
- Share text from any app to NIDO (Android share menu): it opens a new chat
  with the text ready to send; nothing is sent automatically.
- Long-press the NIDO icon: "New chat" and "NIDO messages" shortcuts.
- Quick Settings tile "Ask NIDO" (asks to unlock first if the device is locked).

## 0.1.9-alpha — 2026-10-11

### Changed
- Hardware protection moved to Settings → Security.

### Fixed
- The hardware protection card could disappear without explanation; it
  now always shows and says why it can't be used.
- Agent replies for NIDO messages, pairing code and files are translated
  to English and Portuguese.

## 0.1.8-alpha — 2026-10-11

### Fixed
- The agent handles notes, time and date, unit conversions, the calendar,
  NIDO messages, links and files by code, in Spanish, English and
  Portuguese, without depending on the small model. Notes are read by
  title.
- "Create a note…" and "create an event…" were saved as reminders.
- The knowledge base no longer re-checks every topic on every start.
  Removing a pack also removes its index.
- Settings says "indexing" until a pack is really ready.
- Agent tools no longer format dates through Intl (possible crash on
  Android).

## 0.1.7-alpha — 2026-10-11

### Added
- Optional hardware protection (Android 11+): NIDO's data key is sealed by
  the device's security chip and only opens with PIN, pattern or
  fingerprint. Optional maximum security mode closes NIDO after 30 s, 1 min
  or 5 min in the background. Make a backup before turning it on.

### Fixed
- Contacts: searching contacts never worked on Android (the code used an
  iOS-only API). Search now ignores accents ("Ruben" finds "Rubén").
- Contacts, calls and SMS work in Spanish, English and Portuguese without
  depending on the small model: "find contact Ana", "call Ana",
  "text Ana that I'm late". "Call Ana" looks her up and asks you to confirm
  the number.
- Asking for a contact, the calendar or a file no longer sends you to the
  lock screen. NIDO checks the permission first and only asks when it is
  missing.
- Call and SMS confirmations now show the number and the full text, in
  your language.
- Small talk ("good, and you?", "thanks", "ok") gets a direct answer, with
  no source search and no "no sources" note.
- Answers with offline sources stick to the sources. Sentences the sources
  don't support are removed, and if nothing is left NIDO says it doesn't
  know and shows what the source does say.
- Factual questions with no sources get an honest "I don't know" instead
  of an invented answer.
- NIDO never answers with an empty bubble or a fake "Done.".

## 0.1.4-alpha — 2026-10-10

### Added
- The agent action history is kept (encrypted) between sessions, and you can
  delete it.
- Undo for notes and reminders the agent created, from the history.
- `docs/security/MASVS_CHECKLIST.md`: self-assessment against OWASP MASVS,
  with the open gaps listed.

## 0.1.3-alpha — 2026-10-10

### Added
- Scheduled tasks now work. Create one in About → Scheduled tasks: a name,
  what the agent should do, a time and the days. The agent runs it on its
  own and the result is shown in the card and in a notification.
- Schedules accept specific weekdays (for example Monday to Friday).

### Notes
- Tasks run while NIDO is open. If the app is closed at the scheduled time
  the phone shows a notice and the task runs once when the app is opened.
- A scheduled task can read notes, calendar and inbox and save notes. It can
  never send messages, call, pair, open other apps or approve anything.

## 0.1.2-alpha — 2026-10-10

### Added
- Backup screen is reachable from About: create an encrypted backup, view
  and copy your encryption key, rotate the key.
- Security check card in About: verifies on the phone that the database is
  encrypted and that key storage and biometric lock work.
- Agent skills list in About.
- "What the agent did" history in About: every tool the agent used or tried
  to use in the session, with the outcome. Content is never stored.
- Agent permissions in About: turn any tool off. A disabled tool is never
  run, and confirmations cannot be relaxed.
- Restore a backup made with a different key (another phone, an earlier
  install, or before rotating): Settings → Restore with the backup's key.
- "Know its limits" notice and a privacy summary in About.
- Privacy policy (`PRIVACY.md`) and terms of use (`TERMS.md`).
- Test that keeps the three languages in sync and forbids untranslated
  dialog text.

### Changed
- Every button declares its role for screen readers; icon-only buttons
  (delete chat, delete collection, voice input) have spoken labels.
- Backup dialogs are translated to English, Spanish and Portuguese, and the
  encryption key is shown in a dialog you can copy from.
- All screens share one look with the chat: warm page background, light
  rounded cards, pill buttons, sentence-case section titles.
- Tone, memory and voice settings follow the light and dark themes (they
  were fixed dark cards before), as does the whole Settings screen.
- Button text on the lock and key-recovery screens has proper contrast.
- The network log shows the newest connections first.
- Screens take their colors from the theme instead of fixed values.
- Dependabot groups minor and patch updates into one weekly pull request.

### Removed
- Unused usage-stats screen.
- Remaining non-legal mentions of the upstream project in comments and
  documents. Licence and attribution are unchanged.

## 0.1.1-alpha — 2026-10-10

### Added
- Remote tasks sent by a paired contact are visible in the NIDO screen, with
  approve and reject buttons.
- Delete a paired contact from the Contacts tab.
- The network log is shown in the About screen.
- Tappable suggestions on the first chat screen.
- Each release ships an `app-release.apk.sha256` file generated by CI.

### Changed
- New look for the chat: theme background, solid bubble for your messages,
  the mascot as NIDO's avatar, rounded composer.
- The header shows "Offline · private" instead of the model's technical name.
- NIDO screen tabs are a segmented control.
- The agent recognizes many more everyday requests in Spanish, English and
  Portuguese.
- Saving a note or creating a reminder right after reading outside content
  asks for confirmation.
- Releases are published once per version; a published APK is never replaced.
- The knowledge-pack sharing tab is hidden until sending and receiving are
  wired.

### Fixed
- Outside content can no longer break out of the block that marks it as
  data for the agent.
- Pairing codes reject names with invisible, control or mixed-alphabet
  look-alike characters, and all-zero keys.
- The handshake rejects a null shared secret.
- Delegation tokens no longer accept unsigned extra content.
- Backups include the knowledge database; an unverifiable file is no longer
  accepted for restore.
- Error and pairing dialogs that showed raw text keys show real text.
- The quick calculator no longer reads "1.000 + 1" as 2.
- "Today at 8" said in the afternoon is scheduled for today, not tomorrow.
- The mascot image has a transparent background (it showed as a white box on
  the dark theme).

### Known limitations
See [docs/ALPHA_RELEASE_NOTES.md](docs/ALPHA_RELEASE_NOTES.md#known-limitations).

## 0.1.0-alpha — 2026-10-10

First public alpha: offline chat, encrypted memory, reminders, document
search, NIDO-to-NIDO messaging over Bluetooth, backup and restore.
