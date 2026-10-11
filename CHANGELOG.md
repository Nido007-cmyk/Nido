# Changelog

All notable changes to NIDO are recorded here. Versions follow
[Semantic Versioning](https://semver.org/); alpha releases are tagged
`vX.Y.Z-alpha`.

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
