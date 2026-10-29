# Changelog

All notable changes to NIDO are recorded here. Versions follow
[Semantic Versioning](https://semver.org/); alpha releases are tagged
`vX.Y.Z-alpha`.

## Unreleased

### Changed
- **The 8:00 daily summary is now optional, and off unless you turn it on.**
  Before, NIDO scheduled it on its own as soon as notifications were
  allowed. Turn it on in Settings › What I remember › Daily summary.
  NIDO's constitution says its notifications are the ones you ask for.

### Fixed
- **The daily summary was always in Spanish.** It now uses the app's
  language (English, Spanish or Portuguese).
- **Older versions of NIDO keep downloading their packs.** A new version of
  a knowledge pack now always goes to a new release instead of replacing the
  old file, and an automated check stops the catalog from pointing an
  existing address at different bytes. (Replacing NIDO Local's file for
  0.1.58 left 0.1.57 unable to download it.)
- **The README had the Wikipedia pack's size wrong.** It has about 50,000
  articles (49,832); the 116,000 it said was the number of search passages.

## 0.1.59-alpha — 2026-10-28

### Fixed
- **First aid answers now show the guide exactly as written.** When a
  NIDO Essentials guide is the clear best match for a question (CPR,
  choking, burns, bleeding…), NIDO shows that guide's own text, with its
  sources and an "Open the full guide" button, and no AI model rewrites it.
  On a real tablet the model's summary of the chest-pain guide dropped a
  "not" in the aspirin rule ("is bleeding" instead of "is not bleeding"),
  and the choking answer told you to keep the person at your side and
  watch. These answers are also instant: no model has to run.
- **Model answers can't flip a "not" from the sources.** If a sentence in a
  model answer copies a source sentence but loses or adds a negation ("no",
  "never", "without", "not"…), it is replaced by the source sentence word
  for word. A first aid step containing "no se lo ha prohibido" was also
  being read as "I don't know"; that is fixed.
- **The CPR question finds the CPR guide.** Question words like "how do I"
  ("cómo hago", "o que faço") no longer count as topic words, and long
  words also match their plural and longer forms ("adulto" finds
  "adultos", "atraganta" finds "atragantamiento").
- **A clearer message when the server has another version of a pack.** If
  the file on the server is bigger than this version of NIDO expects, the
  app no longer calls it "incomplete": it says it's a different version,
  that nothing was installed, and that updating NIDO fixes it. Seen when a
  phone on 0.1.57 tried to download the newer NIDO Local made for 0.1.58.

## 0.1.58-alpha — 2026-10-28

### Added
- **NIDO Local: the emergency numbers table grows to 32 countries.** Nine
  countries join the pack's checked facts table: Equatorial Guinea,
  Andorra, the Philippines, France, Italy, Germany, the United Kingdom,
  Canada and Australia. Every number keeps its official source, the exact
  quote and the date it was checked. The new countries have no guides yet:
  for them, NIDO answers from the verified table only. Japan stays out on
  purpose, so it remains the example of a country NIDO has not checked and
  will not guess. The rebuilt pack ships in knowledge-packs-v5 and its
  catalog entry is re-signed.

## 0.1.57-alpha — 2026-10-28

### Fixed
- **A pack is no longer deleted just because a newer version exists.** When
  an app update brought a new version of an installed pack (for example NIDO
  Local), the old one was deleted on the next check so it could be
  downloaded again — offline, that left the phone without the emergency
  numbers it had. Now the pack you have keeps working, offline too, and is
  shown as **Update available**. Answers with emergency numbers from it say
  they come from an older version of the pack, next to the date each source
  was checked. The new version replaces it only after it has finished
  downloading and been verified. A pack file that was modified is still
  deleted, as before.
- **The "which country?" answer lists every country with checked numbers.**
  When you ask for an emergency number without a country, or for a country
  NIDO has no checked number for, it still doesn't guess; the list of
  countries it does have now includes all the ones in your installed packs
  (23 with NIDO Local) instead of only the 8 built into the app.

## 0.1.56-alpha — 2026-10-28

### Added
- **Share a knowledge pack with a contact, without internet.** A NIDO can
  now pass a catalog pack (for example NIDO Essentials, about 0.7 MB) to a
  connected contact over Bluetooth or local Wi-Fi, from the Packs tab. The
  receiver installs it only if it is byte-for-byte the file in NIDO's
  signed catalog; anything else — a hand-made pack, a modified one — is not
  offered and not installed. The previous pack stays in place if anything
  fails. The transfer code existed since 0.1.4 but was never connected, and
  the Packs tab (NIDO › Packs) was hidden; it is visible again.
- **Read the whole guide behind an answer.** Under an answer's sources, a
  knowledge-pack source now has "Read the whole guide": it opens the full
  guide, offline, with the part NIDO used highlighted and the original
  source it was written from. Anyone can check where an answer comes from.
  Idea from BOAR (MIT).

### Changed
- **Every release checks its own reproducibility.** After publishing, the
  release workflow starts the reproducible-build check against the APK it
  just published (two independent builds of the same commit, compared file
  by file, signature aside). Before, it had to be started by hand.
- **Android libraries in the licenses.** Each release now carries
  `android-runtime-dependencies.txt`, the exact list of Android libraries
  (AndroidX, Kotlin, SQLCipher and what they pull in) compiled into that
  APK. THIRD_PARTY_NOTICES now also lists the native ML-KEM code vendored in
  the repository (mlkem-native 2.0.0, Apache-2.0 OR ISC OR MIT) with its
  license text. The license texts of the Android libraries are not
  reproduced yet.

### Fixed
- **Navigation in the new interface** (found auditing the 0.1.55 APK):
  "Try it" in the guide opened from the Library or Settings now shows the
  chat where the example was typed; "Share → NIDO" and the new-chat
  shortcut show the chat even if another tab was open; Android's Back
  button closes the open menu or screen and returns to Chat instead of
  leaving the app; "My documents" in the side menu opens the Library on My
  documents.
- **Release notes on GitHub** no longer repeat the whole notes file (with
  the 0.1.1–0.1.18 history before the new changes and the limitations
  twice).
- **"The emergency number that's used here"** is no longer taken as a
  question about the United States ("usa" is also a Spanish verb).
- **Pack sharing no longer reports "complete" for a pack it did not
  save** (when no installer was connected, the receiver said "complete").
- **Choose the contact** when several are connected, instead of sending to
  the first one in the list; only connected contacts are offered.
- **An answer is no longer lost when you leave the app.** While the AI
  writes an answer, NIDO now shows a quiet "NIDO is answering…"
  notification (an Android foreground service). Some phones closed NIDO a
  few seconds after you switched apps, and the answer stopped half-way. It
  starts with each visible answer and stops when it ends; no sound, no
  pop-up; it stops by itself after 15 minutes if nothing stops it. Idea
  seen in BOAR; NIDO's own implementation. Needs the check on the
  tablets (start an answer, switch apps, come back) before release.

### Security
- **Private hello: no identity in clear with contacts that support it.**
  Automatic Bluetooth reconnection called the contact without naming it and
  sent the old hello with the permanent identity in clear; it now seals like
  a manual call. If the contact's private-hello mark cannot be read, NIDO no
  longer falls back to the plain hello: it does not call and says why.
- **New setting "Private hello only"** (Settings → Security, off by
  default): this phone never states its identity in clear — it does not
  call contacts on NIDO older than 0.1.49 or devices that are not contacts,
  and it does not answer plain hellos. The contacts list now marks contacts
  whose private hello is not confirmed yet. Off by default because it cuts
  off contacts who have not updated. Tested in CI only; needs the two-phone
  check before release.
- **Local Wi-Fi server on the Wi-Fi interface only.** While searching for
  contacts, the Wi-Fi server used to listen on every network interface
  (filtered by private address and subnet). It now listens only on the
  Wi-Fi network the phone is on, or on the hotspot it is sharing, so it does
  not exist on the mobile-data interface. With unusual interface names it
  falls back to the previous behaviour. Needs the two-phone check (same
  Wi-Fi, one phone as hotspot, Wi-Fi change mid-search) before release.

### Safety
- **Fixed answers where a mistake could kill.** Two kinds of question are
  now answered by NIDO's own checked text, never by the AI model:
  - Running a generator, grill, brazier, charcoal or a running car inside a
    home, garage, basement or tent: "No", even with doors and windows open,
    20 feet / 6 m from the house, CO alarms, and what to do if the alarm
    sounds or someone feels sick (US CPSC and CDC). A small model can answer
    "yes, with ventilation". Idea from BOAR's Cohazard; text and rules are
    NIDO's.
  - "What's the emergency number in…": only countries checked against an
    official source (United States, Puerto Rico, Mexico, Dominican Republic,
    Cuba, Spain, Portugal, Brazil), each with its source. With the NIDO
    Local pack installed, its 23 checked countries answer first. Any other
    country: NIDO says it has not checked it and does not guess.
  In Spanish, English and Portuguese. Questions that merely mention these
  things (cleaning the kitchen grill, a car parked in the garage) are not
  caught.

## 0.1.55-alpha — 2026-10-28

### Added
- **New interface.** A bottom bar puts the five main sections one tap away:
  Chat, Emergency, Library, NIDO and Settings.
  - **Emergency** (new) shows your country's checked emergency numbers with
    their source and date. "Call" opens the phone's dialer with the number
    typed in. "Describe what's happening" and quick guides (CPR, bleeding,
    choking, burns, earthquake, hurricane) write the question into the chat.
  - **Library** (new) gathers the knowledge packs (download, remove,
    multilingual search), your documents, the guide and prompt ideas. The
    packs are still in Settings too.
  - **Settings** is grouped into nine sections (security, assistant, models,
    memory, appearance, backup, diagnostics, help, danger zone) and has a
    search box. The security check, network log, crash diagnostics, agent
    permissions and activity, skills and scheduled tasks moved there from
    About. Settings also opens My memory, the execution telemetry, About and
    the backup key screen.
  - **Chat:** tone and deep research are chips next to the input. Deep
    research can now be switched on from the chat too. An emergency-number
    answer comes with "Call" buttons; they open the dialer.
  - **Chat history** has a search box.
  - **Wipe button:** now a red shield labelled "Wipe" instead of "SOS", so it
    isn't mistaken for asking for help.
  - **No control was removed.** Every button is still there, in its new place.
- **NIDO Local knowledge pack: 23 countries.** Guides by country, in
  Spanish and English, with the emergency numbers checked against an
  official source: Cuba, Dominican Republic, Puerto Rico, Mexico, Guatemala,
  Honduras, El Salvador, Nicaragua, Costa Rica, Panama, Colombia, Venezuela,
  Ecuador, Peru, Bolivia, Chile, Argentina, Uruguay, Paraguay, Spain,
  Portugal, Brazil and the United States. Where we could check it, also who
  issues warnings and what each official alert means (Cuba's cyclone phases,
  the COE alerts, NWS watches and warnings, Mexico's hurricane colors and
  earthquake alert, Chile's SAE, Spain's ES-Alert, Brazil's Civil Defense
  SMS, US Wireless Emergency Alerts). Optional download; it can also be
  passed phone to phone. Built in knowledge-packs-v5; the catalog entry
  needs the maintainer's signature.
- **Emergency numbers answered from verified facts.** Ask "what number do I
  call for an ambulance in Chile?" and, with NIDO Local installed, the answer
  comes straight from the pack's facts table: the number you asked for first,
  the others after, and the official source with the date it was checked. No
  search ranking and no model in between, so it can't be made up.
- **Weekly source check.** Every number in the packs is stored with the exact
  quote from its official page; a weekly check reopens each page and flags
  any quote that is gone, so a changed number is caught before the next
  release.

## 0.1.54-alpha — 2026-10-23

### Fixed
- **NIDO Esencial knowledge pack v4 — fact-checked guides.** Five guides
  were corrected against the current official guidelines (AHA and
  American Red Cross 2024, ERC 2021, WHO), in Spanish and English:
  12 severe allergy / anaphylaxis (a second adrenaline dose after
  5–10 minutes, only if help has not arrived), 14 chest pain / heart
  attack (chewable aspirin 162–325 mg), 20 drowning (ERC 2021 added to
  the sources), 22 bites and stings (the jellyfish vinegar advice was
  removed: it depends on the species and can worsen some stings),
  and 23 nose, eyes, teeth and ears (nosebleed: 15 minutes of
  continuous pressure; knocked-out tooth: rinse under 10 seconds).
  The signed catalog now pins the knowledge-packs-v4 release (PRs #136
  and #137); the v3 files stay published and pinned for 0.1.53. As
  before: no medical body has reviewed the pack and the Red Cross
  does not endorse it.

## 0.1.53-alpha — 2026-10-22

### Added
- **NIDO Esencial knowledge pack.** 116 offline guides (58 in Spanish and the
  same 58 in English) on first aid, health at home, disasters and survival,
  written by NIDO from public guidance: the IFRC and the American, Canadian
  and Spanish Red Cross societies, the AHA 2025 CPR guidelines, WHO, UNICEF,
  CDC, FEMA, NOAA and USGS. Offered in the Standard, Full and Encyclopedia
  installs, with a multilingual-search variant. The signed download catalog
  (signed in the pull request that added the pack) points at the
  knowledge-packs-v3 release, whose files match the catalog pins byte for
  byte. Every guide states that it does not replace a course and that
  emergency services come first; no medical body has reviewed the pack and
  the Red Cross does not endorse it.

## 0.1.52-alpha — 2026-10-22

Fixes from an independent security review of the code added in 0.1.48–0.1.51,
done by a reviewer that had not seen the code being written.

### Security
- **The handshake flaw that 0.1.48 fixed is now also caught on the first
  connection with a contact paired before 0.1.49.** That flaw is the
  "unknown key share", where a malicious contact makes two phones share a
  session while each one believes it is talking to someone else.
  - In that case, a message that is genuine for the session but addressed
    to another person used to be dropped silently, which left a session
    that went nowhere.
  - Now the phone recognises it, drops the connection and from then on
    requires that contact's signed confirmation, so the trick cannot be
    repeated.
  - Messages could never be read or forged, because they always carried
    sender and recipient inside the encryption.
  - **Correction:** the 0.1.48 notes said the first connection was already
    covered; for this case it was not, until now.
- **The private hello can no longer be switched off by an attacker.**
  Whether a contact supports it was also learned from an unsigned hint in
  its hello. Someone in between could remove that hint, and this phone would
  go back to calling that contact with its identity in clear. Now that
  knowledge is only ever added, never removed.
- The key that encrypts the first headers of a connection is erased as soon
  as it is no longer needed.

### Tests
- **Two complete NIDO phones end to end:** pair by QR code, connect,
  private hello, signed confirmation, new key per message with encrypted
  headers, and chat in both directions. The test also checks that no byte
  on the wire contains either phone's identity.

## 0.1.51-alpha — 2026-10-22

### Security
- **ML-KEM-768 now runs natively, with formally verified code.** The
  quantum-resistant part of NIDO-to-NIDO connections now uses mlkem-native
  v2.0.0, the implementation used by AWS-LC and Open Quantum Safe (libOQS):
  - its C code is proven memory-safe with CBMC;
  - its assembly for arm64 phones is proven correct and constant-time with
    HOL-Light.

  Before, it used a JavaScript library without an independent audit and
  without constant-time guarantees, which now stays only as a fallback.
- **Checked twice that nothing breaks:**
  - CI compiles the exact code shipped in the APK, on x86 and on arm64, and
    checks that it gives exactly the same bytes as before in 300 tests.
  - The phone repeats that check once before using it, and keeps the
    JavaScript version if anything differs.

  Phones with older NIDO versions keep working with this one.
- **The hardware vault is offered on the main screen.** Before, it was only
  in Settings → Security. It explains what happens if you ever remove the
  screen lock, asks you to confirm and turns it on with your fingerprint or
  PIN. It is not turned on by itself, because it needs a screen lock and
  that is your choice. "Not now" hides it for a week.
- **Checked against the public audits of other messengers.** The findings
  published against Threema (ETH Zürich), Signal's PQXDH, Briar (Cure53)
  and Matrix were compared one by one with NIDO's code
  ([`docs/security/LESSONS_FROM_PUBLIC_AUDITS.md`](docs/security/LESSONS_FROM_PUBLIC_AUDITS.md)).
  Two things were changed as a result:
  - On Android 11 and older, NIDO now ignores taps while another app draws
    over it, as Briar did after its audit. Android 12 and later already hid
    those overlays. Side effect: with a screen-filter app on, NIDO does not
    respond to taps until the filter is turned off.
  - The system log no longer records the Bluetooth or Wi-Fi address of the
    phones NIDO connects to.
- **Scope for a professional security audit:**
  [`docs/security/AUDIT_SCOPE.md`](docs/security/AUDIT_SCOPE.md) lists what
  to review, what has already been checked and how, and the weaknesses we
  know of.

## 0.1.50-alpha — 2026-10-22

### Security
- **Encrypted headers in NIDO-to-NIDO messages.** Each message already had
  its own key. Its header still travelled in the clear: the per-message
  ratchet key, the message counters and, in the first messages, the ML-KEM
  ciphertext. Someone recording nearby could count messages and follow
  turns. Now the whole message, header included, goes inside a second
  encrypted box.
  - Signal does not encrypt these headers.
  - The box key comes from the session root, which also mixes in ML-KEM,
    so a future quantum computer cannot read those headers either. The
    only exception is the first messages, before the other phone has that
    root.
  - Used when both phones have 0.1.50 or later. With an older NIDO,
    messages go as in 0.1.49.
  - Once a connection uses encrypted headers, a message without the box is
    rejected, so nobody can force a fall back.

## 0.1.49-alpha — 2026-10-22

### Security
- **The strongest NIDO-to-NIDO protections are now on by default.** Before,
  you had to turn them on in Settings:
  - **Private hello:** the first messages of a connection are sealed, so
    nobody nearby can see who is calling.
  - **A new key for every message** (Double Ratchet) and **ML-KEM-768** in
    every connection, against future quantum computers.

  They are used when the other phone supports them. With an older NIDO,
  the connection uses what that phone supports, as before. They can still
  be turned off in Settings.
- **Protected from the very first connection.** The pairing QR code now says
  what your NIDO supports. A new contact uses the private hello and the
  signed confirmation from 0.1.48 from the first connection, instead of
  learning it during that connection, which was the one an attacker could
  try to downgrade. An older NIDO reads the QR code as always.

## 0.1.48-alpha — 2026-10-22

### Security
- **Closed a weakness that formal verification found in the NIDO-to-NIDO
  handshake.** The protocol is now checked with ProVerif, a research tool
  that proves security properties against an attacker who controls the
  whole network. It found an "unknown key share": the signatures in the
  handshake did not say *who they were meant for*, so a malicious contact
  could make one phone accept a connection "with B" that B believed it was
  having with someone else. It could not read or forge messages (every
  message names sender and recipient inside the encryption, and that is
  checked), but it was a real flaw in the handshake.
- The handshake confirmation now carries a second signature that also names
  the recipient. A confirmation made for someone else is rejected.
  - Once a contact has used it, it is always required. If someone strips it
    off, even on the very first connection, the phone notices inside the
    encrypted session, drops the connection and keeps requiring it.
  - Phones with an older NIDO still connect as before. The fix applies as
    soon as both phones have 0.1.48.
  - The formal model with the fix (`formal/nido_handshake_v2.pv`) proves
    that both sides agree on who they are talking to.
- Formal verification of the protocol runs in CI on every protocol change
  (`formal/`, see `formal/README.md`). It proves that messages stay secret
  and authentic, also against a malicious contact, and that what is sent
  with the post-quantum mode stays secret even if X25519 is broken later.

## 0.1.47-alpha — 2026-10-22

Fixes from a full audit of NIDO.

### Fixed
- **"Erase all data" and the panic button now really erase everything.**
  Before, these stayed on the phone: local backups made from Settings (all
  your chats, encrypted with the key you were shown), the copy NIDO keeps
  when restoring a backup, the list of revoked contacts, and the settings
  file that showed, for example, that the panic button was on. Now they are
  deleted too, and the erase fails loudly if any of them survives.
- **Disappearing messages no longer survive in backups.** A backup now
  leaves them out (as Signal does), and the copy kept after restoring a
  backup is deleted the next time NIDO opens normally.
- **You get a notice when a NIDO message arrives** with the app in the
  background. It says only "New NIDO message": not who wrote it, not what
  they wrote, and it is hidden on the lock screen. The privacy policy
  already promised message notifications; they did not exist.

### Security
- **Local Wi-Fi: at most 2 connections from the same device**, and a
  device that connects has 20 seconds to say hello. Before, one device on
  your network could fill all 8 connection slots and keep your contacts
  out.
- The NIDO chat no longer writes to the database every 4 seconds while it
  is open; it only does so when a disappearing message starts its timer.
- The old Bluetooth permissions are limited to Android 11 and earlier, as
  Android recommends.
- Every build now lists the final Android permissions and the parts of
  the app other apps can open, so they can be reviewed on each release.
  The first list showed things libraries added that NIDO never uses, now
  removed: the Firebase push-notification receiver and its permission,
  "display over other apps", Google Play's install referrer and permission
  to edit your contacts (NIDO only reads them, when you ask).
- **Reproducible builds:** found why two builds of the same code sometimes
  differed: React Native stored the IP address of the machine that built
  the app inside it (for its development server, unused in the released
  app). It is now fixed to the same value on every machine. Two independent
  builds of this release now match in all 1,554 files (signature excluded).

## 0.1.46-alpha — 2026-10-22

This release brings over the security features of Signal and Briar that
NIDO did not have yet. The new connection protocol is off by default until
it is tested on two phones.

### Added
- **New key for every message, and quantum-resistant connections
  (experimental, off by default)**: Settings → Security. When both phones
  have it on, every message is encrypted with its own key that is erased
  after use (the Double Ratchet design used by Signal): a key stolen from
  memory does not open earlier messages, and the conversation heals on its
  own after the next reply. Each connection also mixes in ML-KEM-768
  (FIPS 203) with the existing X25519 key, so traffic recorded today stays
  closed even to a future quantum computer. If one phone has it off or runs
  an older NIDO, the connection works exactly as before.
- **Disappearing messages**: in a NIDO-to-NIDO chat, tap the timer next to
  the contact's name (5 minutes to 4 weeks). New messages delete themselves
  on both phones: for the sender the time counts from sending, for the
  receiver from when they see it, like Signal. Either side can change it;
  the other phone takes the newest setting with the next message.
- **Panic button (off by default)**: Settings → Security → Panic button.
  It puts an SOS button on the main screen; holding it for 3 seconds erases
  all NIDO data at once, without asking for a fingerprint. Turning it on
  asks for your fingerprint or PIN.
- **Incognito keyboard**: every text field in NIDO asks the keyboard not
  to learn from what you type (no new words in its dictionary, no
  suggestions based on your chats), like Signal's incognito keyboard. Major
  keyboards respect this; NIDO cannot force one that ignores it.

### Security
- **Message padding**: NIDO-to-NIDO messages are padded to fixed sizes, so
  their length no longer gives away the length of what you wrote. Older
  versions of NIDO read padded messages normally.
- **Deleted messages are overwritten** inside the encrypted database
  instead of being left in free space.
- **Fuzzing**: everything that reads data from another phone or a QR code
  is now tested with mutated and random inputs on every change, and with
  100,000 cases per target every week. Writing these checks turned up
  three handshake parsers that failed with a raw error on inputs like
  `null`; they now reject them cleanly.
- **Towards reproducible builds**: a new check builds the APK twice on
  separate machines and compares them file by file (and, on request, against
  the published APK); `scripts/compare-apk.py` lets anyone do the same. The
  first run found 1,553 of 1,554 files identical; the compiled resource table
  (`resources.arsc`) still differs, so the build is **not reproducible yet**.

## 0.1.45-alpha — 2026-10-21

### Fixed
- **Over Bluetooth, the phone that receives a connection no longer
  reveals who it is to strangers.** It now stays silent until the caller
  proves to be one of your paired contacts, as it already did over local
  Wi-Fi. Before, any nearby device that connected to NIDO's Bluetooth
  service received your NIDO identity, signed. Our earlier notes said this
  was already fixed for Bluetooth; it was not, and the privacy policy in
  0.1.44 repeated that mistake. Phones on older versions still connect.

### Added
- **Private hello (experimental, off by default)**: Settings → Security →
  Private hello. When on, and the contact you call also has
  0.1.45 or later, the first messages of the connection are sealed, so
  nobody nearby can see who is calling or link two of your connections.
  Turn it on in both phones to test it; if connecting fails, turn it off.

### Security
- **Delegated tasks are bound to the live connection.** A task permission
  issued to a contact now only works in the same encrypted session it was
  sent in; a copied permission cannot be reused later. (Our docs already
  said this; the code did not do it.) Both phones need 0.1.45.
- **Bluetooth: at most 8 connections at once, and nothing large before the
  hello.** Before, nearby devices could open unlimited connections or send
  big frames before proving who they are.
- **Local Wi-Fi only accepts phones on the same network.** Some mobile
  carriers give their customers private addresses; another customer of the
  same carrier could reach NIDO's Wi-Fi route over mobile data while you
  were searching for contacts.
- **The security check in About shows whether hardware protection is on**
  and how to turn it on.

## 0.1.44-alpha — 2026-10-21

A security and privacy hardening release. Nothing about how NIDO-to-NIDO
connections work changed.

### Added
- **Protection against fake overlays (tapjacking).** On Android 12 and
  later, other apps can no longer draw on top of NIDO while it is on
  screen, so nobody can place a fake button over a confirmation.

### Changed
- **Erasing all data asks for your fingerprint or PIN**, like viewing the
  backup key or restoring already did. If you cancel, nothing is erased.
- **Your custom system prompt is stored encrypted** in the phone's secure
  storage instead of the plain settings file. An existing prompt moves
  there automatically the first time it is read.
- **The pairing code is copied as private**: on Android 13 and later it no
  longer shows in the clipboard preview or the keyboard's clipboard
  history.
- **The privacy policy now describes the local Wi-Fi route** (what is
  announced on the network and who can see it) and says plainly what is
  not hidden yet: the phone that starts a connection sends its public key
  in clear.

### Behind the scenes
- Every GitHub Action used to build NIDO is pinned to an exact commit.
- The dependency audit runs every week and on every change to `main`.
- Each release includes a list of its components (SBOM, CycloneDX).
- The security checklist (`docs/security/MASVS_CHECKLIST.md`) is up to
  date with this version.

## 0.1.43-alpha — 2026-10-16

This release watches the router itself. Every route a message can take
is now inventoried in the code, and the test suite fails if a route is
ever left unclassified. The phrase sweep grew from 5,871 to 6,550
generated phrases, with five more families measured — contacts,
calendar, managing reminders, deleting notes and the weekly plan, in
Spanish, English and Portuguese. Measuring them found three real bugs,
fixed below; after the fixes those families pass in full, and 120
phrases that almost sound like commands (but are conversation) now
correctly stay conversation. Ten routes still have no measured family;
they are listed in the code as pending, on purpose.

### Fixed
- **Sentences that mention a phone or a number are no longer treated
  as a contact search.** "The phone in my house stopped working", "I
  lost Juan's number" or «o telefone de casa não funciona mais» opened
  the contact search with the whole sentence as the name. Bare forms
  like "Ana's number" now only search when what follows really looks
  like a name; real searches ("what's Ana's number", «teléfono de mi
  mamá») work as before.
- **Portuguese text messages**: «envia uma mensagem de texto para a
  Ana» (with the feminine article) fell through to the AI model; it is
  handled directly now, like the masculine form already was.
- **Portuguese calendar events without a title**: «cria um evento
  amanhã» was discarded because the event had no title; it now gets
  the generic title («Evento») instead of being dropped. Questions
  disguised as events («agenda de hoy») still add nothing.

### Added
- **Dropped commands are counted on the device.** When NIDO prepares a
  command as a tappable chip and the chip is dropped without running —
  the text was edited, the language or mode changed, a new chat was
  started, another chat was opened, it was dismissed, or the tap came
  too late — Telemetry now shows "Dropped chips: N" with the count per
  reason. Only the reason is stored, never the text, and dropped chips
  do not count as messages in the router's numbers.

## 0.1.42-alpha — 2026-10-15

The router (the part that handles commands on the phone without the AI
model) was tested against 5,871 generated phrases: each of the usual
commands written the way people type them, with a filler word in front
("hey,", "by the way,", "please"), double spaces, a space before the
question mark, no accents, capitals, or a final period. Before this
release about a third of those still went to the AI model or were taken
for conversation; now nearly all of them are handled directly. The phrases
are generated, so these numbers are not what real use looks like; the log
of missed phrases on the device stays the real measure.

### Fixed
- **Filler words and extra spaces no longer break commands.** "Hey,
  remind me…", "by the way, my favourite colour is…", "please, what is
  2+2" or "set a timer  for 5 minutes ?" now work the same as without them,
  in Spanish, English and Portuguese.
- **More reminder and timer forms**: "can you remind me…", "add a
  reminder…", "set a timer for half an hour", "count 5 minutes", and
  Portuguese «timer».
- **"7 squared", "3 cubed"** are calculated on the phone.
- **More ways of telling NIDO something to remember**: "just so you know…",
  "for the record…", "I want you to remember…", "save in your memory
  that…" (no longer saved as a note), and facts such as "I have 2 kids" or
  "I'm married".
- **Questions about something you saved** are answered from your memory
  even when they are not in the first person ("where is the wifi
  password?" when you saved "the wifi password is on the fridge"), and
  "where did I leave the car?" works with the past tense.

### Added
- The phrase sweep is kept in the repository as a test
  (`src/eval/routerSweep.pure.test.ts`): it fails if a later change makes
  any family of commands drop below its current level, or if ordinary
  conversation ever triggers an action.

## 0.1.41-alpha — 2026-10-14

Fixes found by testing on a real tablet with the new "phrases the router
missed" log: every item below was a phrase that went wrong on the device.

### Fixed
- **Corrections to your memory are no longer lost.** If NIDO had "my
  birthday is May 5" saved and you said "my birthday is May 3", it kept the
  old date because the two sentences looked alike. Now the latest thing you
  say wins; repeating a fact with more detail still keeps the detailed one.
- **More ways of asking NIDO to remember things are understood without the
  AI model** (faster, and they no longer fail): "keep in mind that…",
  "from now on…" (saved as a preference; it used to answer with the time),
  "don't let me forget that…", and facts about your diet and allergies such
  as "I'm vegetarian" or "I'm allergic to peanuts", also with "by the way"
  in front. In Spanish and Portuguese as well.
- **Reminders asked as a question** ("on Friday at 6 can you remind me to
  call my aunt?") now create the reminder. A reminder title no longer keeps
  a stray leading "que" in Spanish.
- **"What day is December 25?"** is answered with the weekday, calculated
  on the phone, in Spanish, English and Portuguese.
- **Unit conversions with a typo** ("grades" for "grados") are no longer
  sent to the AI model, which could get the direction wrong.
- **"What do you know about me ?"** with a space before the question mark
  now lists what you told NIDO instead of going to the knowledge base.
- **Answers that cite sources no longer show the model looping** ("the
  trend of the generalization of the trend of…"): the repeated text is cut
  there too.

### Changed
- The "phrases the router missed" log (Execution Telemetry, off by default)
  now also keeps messages that look like a command but that NIDO took for
  conversation, which were invisible before. Its switch is easier to see
  and shows whether it is on.

## 0.1.40-alpha — 2026-10-14

### Added
- **About → Licenses.** NIDO now shows, inside the app, the licenses that
  apply to it: its own MIT license (with the notice of BOAR, the project it
  started from), the license of every AI model and knowledge pack you can
  download (with the conditions that matter, such as the LFM2.5 license's
  limit on commercial use), the credit and CC BY-SA 4.0 license of the
  Wikipedia text that comes inside the app, and the full license text of
  each open-source package the app is built with.

### Changed
- The license documents in the repository were reviewed and brought up to
  date: a refreshed model license audit (Qwen3-0.6B and the multilingual
  search model included), a new `THIRD_PARTY_NOTICES.md`, and corrections
  in `ATTRIBUTION.md` (the MIT license asks to keep the copyright notice; a
  visible credit is appreciated but not required).

## 0.1.39-alpha — 2026-10-14

### Added
- **NIDO now measures what its command router misses.** When a message
  that looks like a command ("remind me…", "save…", "convert…") is not
  recognized by NIDO's built-in router, it goes to the AI model instead.
  Until now a miss like that looked like a model mistake. The Execution
  Telemetry screen (menu) now shows, for the commands you
  send: how many were handled by the router, how many reached the model,
  how many times the model had to ask for a tool the router should have
  caught (and which tools), and how many needed a retry. Only counts and
  tool names are kept, never the text of your messages.
- **Optional: keep the phrases the router missed.** Off by default. If you
  turn it on in the same screen, NIDO keeps on your phone (encrypted) the
  last 50 commands that the model had to handle, so you can see which ones
  the router is missing, copy them and report them. They never leave the
  phone, and turning the option off deletes them.

### Fixed
- When the model failed to save something to memory ("I couldn't save
  that"), the measurement counted it as a model answer instead of as "not
  understood". It is now counted correctly.

## 0.1.38-alpha — 2026-10-14

### Changed
- **Pasted and shared text is never treated as a command.** Text you paste
  into the chat or share to NIDO from another app is treated as quoted
  content: if it says "remind me…" or "delete my notes", NIDO reads it but
  does not act on it. Before, sharing a text and tapping send ran it as if
  you had typed it. What you type, dictate with the chat microphone or pick
  from NIDO's own examples still works as a command.
- **One message, one action — and you tap to run it when there's more.** If
  a message has a command plus something else ("remind me to buy bread
  tomorrow and then write a poem"), NIDO no longer guesses: it shows the
  command as a button above the text box, and nothing runs until you tap
  it. The rest stays in the box as a draft to send separately. With two
  commands, only the first is prepared; the second stays in the draft. The
  button disappears if you edit the text, change the language or switch
  modes.
- A message that is just one command ("remind me to buy bread tomorrow at
  9", "set a 5 minute timer") still runs right away, as before. All of
  NIDO's examples keep working exactly the same.

## 0.1.37-alpha — 2026-10-14

An independent audit of everything added to the assistant since 0.1.19.
Nothing from outside (another NIDO, a document, a note, a knowledge pack) can
take control; these are the behaviour bugs it found, all fixed and tested.

### Fixed
- After "what should I remind you?", only your answer counts. A timer,
  another reminder, a question, "yes", "ok" or "no, thanks" are no longer
  turned into a reminder, and the question is forgotten after one message,
  when you start a new chat, switch conversations or change language. A
  repeating request ("every Monday") keeps repeating after you answer.
- "Create a story…", "ponme una canción…" and phrases that only quote "remind
  me" no longer create reminders or memories. "Let me know if it rains" is
  not a reminder (NIDO can't check conditions).
- "Every 8 hours", "every other day", "biweekly", "Monday to Friday": NIDO
  saves the reminder once and says so, instead of claiming it will repeat
  daily or weekly.
- After "Which one?" (deleting or reading a note), a later command with a
  number in it ("set a 2 minute timer") no longer picks a note. The question
  expires after 3 minutes.
- "Every month on the 31st" fires on the 31st (skipping shorter months), not
  on the 1st. Repeating reminders keep their time after a daylight-saving
  change. "Every year on February 30" is not saved with today's date.
- Names: "my sister is called Ana and her birthday is May 3" saves "Ana" (not
  "Ana And"), and that birthday repeats every year. With Reminders turned
  off, saving a birthday no longer creates a reminder.
- "I can't remember the capital of Peru" is answered, not saved as a memory.
  "Today is 14/10" is not calculated as a division.
- The loop guard no longer cuts code blocks, tables or separator lines.
- Showing the backup key now fails safe if the phone's lock status can't be
  read (before, it was treated as a phone with no lock).
- The release build runs the same checks as CI (component tests and download
  pins).

## 0.1.36-alpha — 2026-10-14

### Fixed
- Fewer unrelated sources under answers with multilingual search on. The
  best match now has to stand out from the rest of the results, not just
  pass a fixed score. Measured on the built-in corpus: wrong sources 20 % →
  10 %; with the Vital pack: 33 % → 22 %. No correct answers were lost.

## 0.1.35-alpha — 2026-10-14

### Added
- Reminders that repeat every month or every year: "remind me to pay rent
  on the 1st of every month", "recuérdame cada año el 15 de marzo…", "me
  lembra todo dia 5 de cada mês…". Birthdays saved to memory ("my mom's
  birthday is March 15th") now get a reminder that repeats every year
  (before, it fired only once). "Every 2 days" is still not supported and
  NIDO says so.

### Fixed
- "Ponme un recordatorio para el lunes" → NIDO asks what to remind → the
  answer ("pagar la luz") now creates the reminder. Before, that answer
  went to the model and nothing was saved. "No"/"cancel" drops it.
- Same request, every language (second sweep): "set an alarm for 7",
  "coloca um alarme às 7", "10 minute timer", "agrega una reunión el
  lunes…", "adiciona uma reunião…", "qué hay pendiente", "o que tem
  pendente", and "what's your name / cuál es tu nombre / qual é o seu
  nome" now get their direct answer instead of the model. An alarm with no
  time of day ("alarm for 7") is in the morning, like "wake me at 7".
- Reminder titles no longer keep the calendar date inside ("el 15 de marzo
  el cumpleaños…" → "el cumpleaños de mamá").

## 0.1.34-alpha — 2026-10-13

Fixes from the physical test on the Galaxy Tab A9+.

### Fixed
- The small model could get stuck repeating the same words ("…las
  aluminosas, las aluminosas, las aluminosas…") until it ran out of
  tokens. NIDO now detects the loop, stops generating (saves battery) and
  keeps only the first occurrence. Answers with sources and answers
  without sources now both use a mild repetition penalty (answers without
  sources had none at all).
- My Memory → Reminders showed raw UTC dates ("2026-10-15T01:00:00.000Z",
  which looks like the next day in the Americas). Now: "Wednesday,
  October 14 at 6:00 PM", in the phone's time and language.
- The keyboard autocorrects "Cuánto" to "Canton": "Canton falta para
  navidad" and "Canton es 15% de 200" now work like the real question.
  Countdowns to named days (Christmas, New Year…) accept loose phrasings
  ("falta mucho para navidad", "days till christmas", "falta pouco para o
  natal").
- "Ayúdame a planear mi semana…" uses the weekly-plan template instead of
  the model.

## 0.1.33-alpha — 2026-10-13

Measuring the router (the code that decides what to do with each message
before the model).

### Added
- Menu → Telemetry now shows "Route decision (no model)": how long NIDO
  takes to decide on each message (median, p95, max) and where messages
  end up — solved without the model, with the model, "didn't understand",
  or normal conversation. Only times and counts are stored on the phone,
  never the text. "Clear" also clears these.

### Fixed
- Pasting a very long run of digits ("what is 1111…+") made the calculator
  check take quadratic time (about 110 ms with 4,000 characters on a PC,
  likely seconds on a phone), paid several times per message, freezing
  the screen. Anything over 120 characters is no longer treated as a sum.
- A new CI check sends hostile 4,000-character messages (the chat maximum)
  through every router step with a time budget, so a slow pattern can't
  slip in again.

## 0.1.32-alpha — 2026-10-13

Pending items from the backlog, one by one, each with its own tests.

### Added
- Repeating reminders: "remind me every day at 8 to take my pill",
  "recuérdame cada lunes sacar la basura", "me lembra toda sexta de pagar
  a conta". Every day or every week, in Spanish, English and Portuguese.
  The phone fires them on its own (daily/weekly system alarm) even if NIDO
  is closed; the list shows "every Monday at 9:00". "Every month" is still
  not supported and NIDO says so instead of pretending.
- Countdowns: "how many days until Christmas", "cuánto falta para Navidad",
  "quanto falta para o Natal", or any date — counted on the phone, not
  guessed by the model.
- Settings → memory shows whether exact alarms are allowed (Android 12+)
  and a button to allow them; without it, reminders can arrive minutes
  late while the phone sleeps.

### Fixed
- "Ponme un recordatorio para el lunes" (a date but nothing to remind)
  now asks what to remind instead of going to the model. Same for "set a
  reminder for 5pm" and "me põe um lembrete para segunda".
- The restore-with-key screen is now protected from screenshots and
  screen recording, like the screen that shows the key.
- The exact-alarm module was never compiled into the app (it had no
  Android build file).
- NIDO messages accept the same phrasings in all three languages:
  "escríbele a Ana que…", "write to Ana that…", "diz/fala/escreve para a
  Ana que…", "send Ana a NIDO message saying…", "manda pelo NIDO para…".
  "Tell me that…" / "diz pra mim…" are no longer taken as a message to a
  contact called "me". The outbox note says the same in every language.
- Deleting a reminder from My Memory now also cancels its scheduled
  notification.

## 0.1.31-alpha — 2026-10-13

Audit of the assistant loop in Spanish, English and Portuguese: ~200
real phrases sent through the same chain the chat uses.

### Fixed
- "Manda por nido a Ana que llego tarde" — the exact phrasing NIDO itself
  suggests when the text is missing — went to the model and failed. Also
  "envía por nido a Ana: …" and "mándale a Ana por nido que …".
- "Cancel the timer" / "cancela el temporizador" / "cancela o temporizador"
  cancel it (before, the model could say it did without doing anything).
- "Forget my favorite color" / "olvida…" / "esqueça…" get an honest answer
  (where to delete it: menu → My Memory) instead of a possible fake "done".
- "My mom's birthday is March 15" is saved with its reminder in English
  too (Spanish and Portuguese already were).
- "Add a meeting on Monday at 9", "marca reunião segunda às 9", "minha
  agenda desta semana", "what's pending", "qué tengo pendiente", "hora",
  "time please", "2 to the power of 8" now reach their feature.
- Event titles ending in "-ão" before a weekday lost their last letter
  ("reunião segunda" → "reuniã").
- Spanish and Portuguese share verbs ("anota que…"): with the app in
  Portuguese the answer was in Spanish. The app language now decides when
  the phrase isn't clearly the other language.
- Dates and messages from notes, NIDO inbox, calendar and conversion
  errors are in the app language (they were always Spanish).
- Conversions show 4 decimals ("3.1069 mi", not "3.1068559612 mi").
- The weekly plan uses 24-hour times in Spanish and Portuguese.
- Saving a person says "I'll remember Marta (mom)" instead of "saved to my
  contacts", which sounded like the phone's contacts.

## 0.1.30-alpha — 2026-10-13

Everyday phrases that went to the small model (which can invent the time
or a result) now have a direct, exact answer.

### Fixed
- "Tell me the time" / "dime la hora" / "me diz as horas" read the clock
  instead of asking the model.
- "How many miles are 10 km" also in the feminine Spanish and Portuguese
  forms ("cuántas millas son 10 km", "quantas milhas são 10 km").
- "Open youtube.com" works without typing https:// (the confirmation still
  shows the full address). File names like "notas.pdf" are not links.
- "Set a reminder for 5pm", "pon una alarma a las 7", "don't let me
  forget to call mom", "no me dejes olvidar comprar pan" create the
  reminder directly.
- "La raíz de 16" without "cuadrada" is the square root.

## 0.1.29-alpha — 2026-10-13

Security and privacy fixes from the October 13 audit, plus the
maintenance updates (Dependabot) already on main.

### Security
- Deleting a note or reminder through the assistant now only happens if
  what you confirmed is what is stored. The confirmation showed the name
  the model sent; text hidden in a document or message could make it ask
  to delete one note while showing you another name.
- The backup key is shown in a layer of the app's own window, which is
  protected from screenshots, screen recording and the Recents preview.
  The shared key dialog from 0.1.27 used a separate window that the
  protection might not cover.
- Restoring a backup on a phone without an encryption key is refused (use
  "Restore with the backup's key"): there was no way to check the file,
  and a crafted one could be accepted. With a key, a backup is only
  accepted if it actually opens with it.
- Files extracted from a backup bundle are deleted after restoring.
- Release builds use third-party GitHub Actions pinned to exact commits:
  the job that signs the APK no longer trusts a movable tag.

### Privacy
- Notifications sent right away (scheduled task results, overdue
  reminders at startup) use the reminders channel, hidden on the lock
  screen. They used the default channel, which showed the text — and
  scheduled tasks can read your notes since 0.1.24.

### Changed
- One rule for every backup-key gate (create, view, rotate, restore, in
  Backup and in Settings): unlock with your fingerprint or PIN; if the
  phone has neither, NIDO warns you clearly and continues, instead of
  blocking in some places and not in others.
- Android version code bumped again (it had stayed at 19 since 0.1.18);
  backups record the right app version.

## 0.1.28-alpha — 2026-10-12

Everything the full audit found, fixed. Mostly words in the wrong language.

### Fixed
- NIDO-to-NIDO errors now always speak your language. A few screens
  still showed the transport's raw technical Spanish; they now use
  the same plain-language error mapping as the rest of the NIDO
  screen, in Spanish, English and Portuguese.
- The overdue-reminder notification shown at startup always had a
  Spanish title; it now uses the localized title, like every other
  notification.
- The crash report you can copy from About is written in your
  language too (its headings used to be Spanish only).
- The guide and the empty Contacts state no longer tell you to scan
  the other person's code: there is no camera in the app yet.
  Pairing is show your code, paste theirs as text — which is what
  the pairing screen already said.

### Under the hood
- The component test suites run in CI again. They had been red and
  invisible since October 10 (stale test mocks and untransformed
  Expo modules); all 5 suites pass now, and CI fails if they break.
- Corrected the security roadmap's baseline table: it still said
  "not done" for screenshot/clipboard protection, data-extraction
  rules and physical two-device tests. All three were already in.

## 0.1.27-alpha — 2026-10-12

One backup flow, the same from every entry point.

### Fixed
- Creating a backup from Settings showed the encryption key in a
  system alert whose text cannot be copied: the key could only be
  written down by hand or photographed, and that screen had no way
  to save the backup to a folder. Settings now uses the same
  copyable key dialog as the backup screen (secure copy that clears
  itself after 60 seconds, with a visible confirmation) and adds
  the "Save to Downloads" button, which stores the encrypted backup
  files in a folder you pick. The key itself is never written to
  that folder, and the unlock check before showing it is unchanged.

## 0.1.26-alpha — 2026-10-12

Security fix for devices without biometric hardware.

### Fixed
- The access gate only asked Android about biometrics. On a device
  with no fingerprint or face hardware (for example a Galaxy Tab A9+),
  setting a system PIN was invisible to the gate: the lock screen
  claimed "no biometrics or PIN set up" with the PIN in place, and
  protected actions such as creating a backup failed with
  "Authentication cancelled." The gate now also reads the enrolled
  security level, so a device credential (PIN, pattern or password)
  counts as enrollment and the system prompt accepts it — the
  fallback the gate's policy always documented.

## 0.1.25-alpha — 2026-10-12

The in-app guide learns everything the last versions added, and the
loose ends found while physically testing 0.1.24 are fixed.

### The guide
- The Memory lesson now explains how your memory is organized
  (Facts, People, Notes, Reminders) and teaches by doing: tap a
  save example, then the matching question ("My mom's name is
  Marta" → "What's my mom's name?", your favorite color, where you
  live, your birthday), in Spanish, English and Portuguese.
- The Reminders lesson includes the timer, the Notes lesson the
  quick "note: …" form, and the Privacy lesson answers "Where do
  you store my data?" — every guide example is verified by an
  automated test against the real routers in the three languages.

### Fixed
- "Which one?" now waits for your answer. When reading or deleting
  matched several notes or reminders, the reply ("cumpleaños",
  "the first one", "cancel") started a new turn and the choice was
  lost; the question now keeps its state between messages.
- Dictation fusions in memory questions: "mima" (a fused "mi
  mamá") and its family now reach the memory answer ("Tu mamá se
  llama Marta.") instead of falling through to the model.
- The create-event confirmation dialog showed the raw UTC instant
  ("2026-10-16T17:00:00.000Z"); it now shows the local date and
  time in your language.

### Documentation
- The Bluetooth identity limitation is closed: the fix (NIDO does
  not speak first on incoming connections) is verified on two
  physical devices. Backup wording matches the shipped
  restore-with-key, and the README and roadmap reflect the current
  physical validation status.

## 0.1.24-alpha — 2026-10-12

Fixes from a full reachability audit: every responder the in-app
guide teaches was probed end to end in Spanish, English and
Portuguese, and the phrases that silently fell through were fixed.

### Fixed
- "Where do you store my data?" (and its Spanish/Portuguese forms)
  now reaches the deterministic privacy answer instead of falling
  through: the natural second-person phrasing was not covered, only
  the impersonal one.
- Deleting in natural English works: "delete the birthday note" and
  "delete the dentist reminder" now reach the delete flow with
  confirmation, instead of being deflected to general knowledge.
- The guide's own example "schedule dentist on Friday at 10" now
  creates the event titled "dentist" (it was saved as "dentist on").
- Sending "a message to Juan por nido: …" no longer swallows the
  channel mark into the recipient's name, and the "vía nido" form
  is understood too.
- Notes can be found across languages: a note saved as "cumpleaños
  de Ana" is now read, searched and deleted when you ask for the
  "birthday" note, and searching for "flowers" finds "flores".
- The weekly plan answers in Portuguese when you ask in Portuguese,
  including Portuguese work hours ("trabalho das 8 às 17") and
  family time ("família").
- "Don't forget that Friday is Ana's birthday" (Spanish, English,
  Portuguese) now creates the reminder as well as saving the fact;
  before, the weekday-only date was silently dropped.
- Scheduled tasks can actually read your notes (a task asking to
  "search my notes" answered "you have no notes" even when you
  did), and they answer in your language, Portuguese included.
- Note search ignores filler openings ("busca en mis notas algo
  sobre flores" now searches for "flores").
- The English birthday answer for a relative no longer starts with
  a lowercase letter.

### Internal
- The audit's 118 probes now live in the test suite as permanent
  end-to-end composition tests (chat and scheduled tasks), so a
  responder can no longer be green piece by piece while the
  composed path is broken.

## 0.1.23-alpha — 2026-10-12

### Fixed
- Asking back about your own life now works in your own words, not
  just in a few fixed phrasings. Since 0.1.22, telling NIDO things
  saves them ("My favorite color is green" is stored), but generic
  questions like "What's my favorite color?", "Where do I live?" or
  "What car do I have?" still fell through to the offline knowledge
  base, which knows nothing about you. For first-person questions
  the chat now checks your saved memory first: when a saved fact
  clearly matches, the answer quotes it ("From what you told me:
  …") in Spanish, English and Portuguese. When nothing matches,
  the question follows the exact same path as before, so questions
  about your documents and ordinary small talk are untouched.

## 0.1.22-alpha — 2026-10-12

### Fixed
- Telling NIDO about your life in plain words now actually saves it.
  The chat only sent a message to the agent when it sounded like an
  explicit command ("remember that…"), so natural statements fell
  through to the offline knowledge base instead: "My mom's name is
  Marta" was answered with a Madrid Metro station, "What's my mom's
  name?" could not be answered from memory, and even "Set a timer for
  2 minutes" was treated as small talk. The intent gate now checks
  the same detectors the agent itself uses — people, your own name,
  implicit facts, memory questions, timers, reminders and weekly
  plans — in Spanish, English and Portuguese.

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
