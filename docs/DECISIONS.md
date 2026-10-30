> **Language:** English · [Español](es/DECISIONS.md)

# Decisions

Product decisions that shape NIDO for years, with the reason and what would
make us revisit them. A decision changes only through a PR that updates this
file (and the [constitution](NIDO_CONSTITUTION.md) when it touches a firm
rule).

## 2026-10-29

### D1. NIDO has a constitution, and CI enforces its firm rules

- **Decision:** adopt [NIDO's constitution](NIDO_CONSTITUTION.md), version 1.
  Each firm rule is tied to tests and evaluation cases
  (`docs/constitution-rules.json`, checked by `scripts/check-constitution.mjs`).
- **Why:** a small on-device model makes more mistakes than a large cloud one;
  the behaviours where a mistake can hurt someone need fixed rules with
  tests, and everything else needs a written order of priorities.
- **Revisit when:** a real failure shows a rule is missing or wrong.

### D2. First aid guides are never rewritten by a model, not even to shorten them

- **Decision:** when someone asks to summarize a NIDO Essentials guide, NIDO
  shows the start of the guide as written, up to its first numbered steps,
  and says the full guide is the reference (0.1.60).
- **Why:** in 0.1.58 the model dropped a "not" in the aspirin rule. A
  "summary" is the same risk.
- **Revisit when:** never for first aid. Other packs can be summarized by the
  model with sources, as today.

### D3. The daily summary is opt-in

- **Decision:** the 8:00 summary is off unless the person turns it on (0.1.60).
- **Why:** NIDO's notifications are the ones the person asks for
  (constitution §9). Before, it was scheduled as soon as notifications were
  allowed.
- **Revisit when:** never by default; it can be offered once during setup.

### D4. Messages travel only between paired contacts

- **Decision:** NIDO messaging, and any future relaying of messages through
  other phones (mesh), works only between contacts paired with their code.
  Never for any nearby phone. Any relaying, if it is ever built, only goes
  through contacts whose fingerprint was verified (see D12).
- **Why:** meshes open to strangers expose who talks to whom. bitchat's own
  whitepaper calls metadata its weakest point (a sender ID that never
  rotates, announcements in clear). Bridgefy was broken twice, the second time
  after adopting libsignal: impersonation, man-in-the-middle, reading private
  messages ([USENIX Security 2022](https://www.usenix.org/conference/usenixsecurity22/presentation/albrecht)).
- **Revisit when:** an open mesh design with rotating identifiers has passed an
  external audit.

### D5. No relay server

- **Decision:** NIDO does not use an intermediate server for messages. A
  relay could only come later as an optional, replaceable component that sees
  only encrypted data and meets the layers in
  [METADATA_PRIVACY.md](METADATA_PRIVACY.md) first, decided by changing the
  constitution on purpose.
- **Why:** "no servers" is NIDO's central promise; a relay also needs someone
  to run and pay for it, and it sees timing and sizes.
- **Revisit when:** the mesh (D4) is not enough for real users and the
  metadata layers exist.

### D6. Register as a verified Android developer before 2027

- **Decision:** register NIDO (`team.nido.app`, NIDO's own signing key) in the
  Android Developer Console with a full distribution account, before Google's
  global rollout in 2027.
- **Why:** since September 30, 2026, certified phones in Brazil, Indonesia,
  Singapore and Thailand only install apps from verified developers through
  the participating stores; direct downloads such as NIDO's GitHub APK
  aren't covered yet, but Google plans a global rollout in 2027 and
  recommends registering apps distributed outside Google Play
  ([FAQ](https://developer.android.com/developer-verification/guides/faq),
  [registration for apps on open-source platforms](https://developer.android.com/developer-verification/guides/open-source-app-registration)).
  Without it, people would need a one-time 24-hour "advanced flow" or `adb`
  to install NIDO, which nobody does in an emergency. A free "limited
  distribution" account only covers 20 devices.
- **Cost:** a one-time $25 fee and identity verification by the owner.
- **Revisit when:** Google changes the rules.

### D7. Ask for a free external security audit after the two-phone tests

- **Decision:** apply to the
  [Open Technology Fund Security Lab](https://www.opentech.fund/labs/security-lab/),
  which funds security audits for internet freedom tools, once private hello
  and the new key per message have been tested on two physical phones.
- **Why:** an external audit is what lets NIDO say more than "end-to-end
  encrypted, no servers". Auditing code that changes the next week is worth
  less.
- **Revisit when:** the application is answered.

### D8. Distribution order: GitHub now, F-Droid next, Google Play after

- **Decision:** keep the signed APK on GitHub; prepare F-Droid (it asks for
  free software built from source with no proprietary libraries; NIDO is
  MIT-licensed and its builds are checked as reproducible in CI, and its
  dependencies still have to be checked against that rule); Google Play once there
  are at least 12 testers for the closed test new personal accounts need.
- **Why:** F-Droid matches NIDO's audience and principles; Play reaches more
  people but asks for a 14-day closed test with 12 testers first.
- **Revisit when:** F-Droid's review raises a blocker (for example, how it
  treats downloading models and packs).

### D9. The hardware vault stays an offer, not the default

- **Decision:** keep the hardware vault (the database key wrapped by a
  Keystore key that needs the fingerprint or PIN) off by default, offered on
  the main screen since 0.1.51 (asked by the owner's security audit of
  2026-10-29).
- **Why:** the vault needs a screen lock, and Android deletes its key if the
  screen lock is removed: from then on the data only come back from a
  backup. Turning it on silently would put people's data one settings change
  away from loss, without them having chosen it. Many phones and tablets
  used in families have no screen lock at all, and there the vault can't be
  turned on. Without the vault the database is still encrypted with a random
  256-bit key kept in the Android Keystore.
- **Revisit when:** turning the vault on can first make sure there is a
  recent backup whose key the person has saved. Then it can be on by
  default for phones with a screen lock.

### D10. "Private hello only" stays off by default

- **Decision:** keep the strict initiator mode (Settings → Security →
  "Private hello only") off by default.
- **Why:** private hello is already on by default since 0.1.49, and the
  phone remembers which contacts support it. The public key still goes in
  clear only with a contact on a NIDO older than 0.1.49, or one paired before
  0.1.49 that has not connected since 0.1.45. The strict mode only adds
  refusing those contacts. Turning it on for everyone would cut those
  people off with no warning, and NIDO is meant to work when it matters.
- **Revisit when:** the two-phone tests of private hello have passed (see
  D7). After that, turning it on by default can be tied to a warning that
  names which contacts would be cut off.

### D11. Known limits from the 2026-10-29 audit, kept and stated

- **Short pastes count as typed.** Android doesn't tell an app that text was
  pasted. NIDO treats a block of 24 or more characters with spaces as pasted
  (and fences it from the router), so pasting a few words at a time looks
  like typing. Every action with effects outside the app still asks for
  confirmation (firm rule R4), so the edge can't act on its own. Lowering
  the threshold would fence real typing from gesture keyboards.
- ~~Voice dictation~~ and ~~the key rotation file~~: closed the same day
  (see D12).
- **Revisit when:** Android or React Native expose a paste event.

### D12. Lessons from Signal's and Briar's audits

The owner's research on every public audit of Signal and Briar (October 29,
2026) matched their findings with NIDO's. Decided and done:

- **A contact is verified only when the two people compared fingerprints.**
  NIDO's pairing code is text and can arrive over any channel, but until
  0.1.62 every contact was saved and shown as "verified". Briar left this
  open for remote contacts (OTF-005, 2024 retest), and in a 2016 study 75 %
  of Signal users believed they had verified when they hadn't. Now a contact
  is "not verified" until someone taps Verify after comparing the
  fingerprint shown in the other phone's "My code", and existing contacts
  start as "not verified". Pairing doesn't change; only what the app claims.
- **Voice dictation only uses an on-device recognizer by default.** Briar's
  only High finding (Cure53, 2017) was one channel leaving the perimeter
  (RSS DNS outside Tor). "Prefer offline" is now "on-device or nothing",
  unless the person turns that off in Settings › Voice.
- **The key rotation file is encrypted** with a key kept in the Android
  Keystore (through SecureStore). Signal Desktop kept its database key in a
  plain `config.json` for six years (2018–2024).
- **Pack offers have a quota:** at most 3 unaccepted offers per contact and
  10 in total, forgotten after 30 minutes (Briar's denial of service by a
  malicious contact, ETH 2023).
- **Checked, nothing to fix today:** screen capture is blocked (FLAG_SECURE)
  and touches under another app's overlay are ignored
  (`filterTouchesWhenObscured`, plus hidden overlays on Android 12+), the
  only exported component is the quick-settings tile (protected by a system
  permission), and nothing opened from outside NIDO can wipe or send
  anything.
- **Still open, stated:** the PDF text is extracted by a native library
  before NIDO can measure it, so a hostile PDF can still use a lot of memory
  inside that library; the size of a backup shows roughly how much data it
  holds; and NIDO's session handling (not only its ratchet) should be checked
  against "clone" attacks like the one found in Signal's Sesame (2023). That
  is for the external audit (D7).
- **Revisit when:** remote contact introductions are ever considered: they
  need a real path to full verification first, and nothing that trusts the
  introducer (Briar's CVE-2023-33983).
