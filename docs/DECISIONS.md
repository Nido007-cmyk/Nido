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

### D4. Messages travel only between people who met in person

- **Decision:** NIDO messaging, and any future relaying of messages through
  other phones (mesh), works only between contacts paired with the QR code.
  Never for any nearby phone.
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
