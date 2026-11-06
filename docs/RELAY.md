# Messages from friend to friend (relay)

> Status: **phase 1 done** (cryptography, storage rules, network
> simulation, all tested). **Phase 2 pending**: wiring it into the
> messenger and the screens, and a test with at least three phones.
> Nothing of this is in a release yet. Code: `src/p2p/relay/`.

## The idea

Today a NIDO message arrives only when the two phones meet. With this,
Ana can give a sealed envelope for Caro to Beto, a contact of both, and
Beto hands it to Caro when they cross paths, with no internet and no
server. Beto can't read it, change it, or pretend to be Ana.

It works **friend to friend**: envelopes only pass between phones that
are already paired contacts with a verified session. A stranger's phone
never receives, carries or sends anything. This is the same trust model
as the rest of NIDO's phone-to-phone messaging, and it is what keeps the
feature safe against spam and tracking by strangers.

## How it works

### Mailbox key (carry prekey)

Each phone makes an X25519 + ML-KEM-768 key pair that lasts 14 days, signs
it with its Ed25519 identity key (the one in the QR) and gives it to its
contacts over the usual encrypted session. A new one is made halfway
through the old one's life, so contacts get it before the old one
expires. A contact accepts a mailbox key only if the signature verifies
against the QR key of that contact, it is not expired, and it lasts no
more than 14 days (`verifyCarryPrekey`).

### Envelope

- **Inside:** sender, recipient, message id, time, signed expiry, kind
  (chat or receipt) and text. All of it is signed by the sender's Ed25519
  key under its own domain (`nido-carry-msg-v1`), then padded to 1, 2, 4
  or 8 KB so the length doesn't show.
- **Encryption:** a fresh X25519 ephemeral against the mailbox key, **and**
  an ML-KEM-768 encapsulation to it. Both secrets go through
  HKDF-SHA512 (salt `nido-carry-v1`, info bound to the mailbox key id, the
  ephemeral and the KEM ciphertext). Breaking the envelope needs both.
  XSalsa20-Poly1305 (secretbox), like the rest of NIDO today.
- **Outside, what a carrier sees:** a random envelope id, a tag, the
  expiry, the hops left, the ephemeral key, the KEM ciphertext and the
  ciphertext. **No sender, no recipient, no text.**
- **The tag** is derived from the mailbox key id. Only people who hold
  that mailbox key (the recipient's contacts) recognize it. That is how a
  carrier knows "this one is for Caro" when Caro is also its contact.

New signing and KDF domains, disjoint from all others: `nido-carry-prekey-v1`,
`nido-carry-msg-v1`, `nido-carry-v1`, `nido-carry-key-v1`, `nido-carry-tag-v1`.

### Opening

Caro opens an envelope only if: it is well formed; the tag matches one of
her mailbox keys; it decrypts; it is addressed to her identity with that
key; the signed expiry has not passed (a carrier can change the outer
one but not this); the sender is **one of her contacts** and the
signature verifies with that contact's QR key (`openCarry`). Anything
else is dropped silently. It never throws.

### Who carries what (`CarryStore`)

- An envelope is accepted only from a contact, only if well formed,
  unexpired, with hops left, and not seen before (delivered or dropped
  envelopes are remembered until they expire).
- Limits per phone: 200 envelopes, 2 MB, 30 from each contact.
- **Limited copies (spray and wait):** the writer gives the envelope to
  up to 8 contacts; each carrier passes it to up to 3 more; at most 3 hops
  in all. Never back to whoever brought it, never twice to the same
  person.
- The recipient always gets it as soon as they meet a carrier, and the
  carrier deletes it then.
- Carrying is **opt-in** per person. Receiving and sending are not
  affected by that setting.
- Envelopes last at most 72 hours (and never past the mailbox key).

## Does it help? (simulation)

`carrySimulation.ts` runs the real `CarryStore` over a model of 60 phones
in 6 neighbourhoods. Each person has 4 contacts in their neighbourhood
and 2 elsewhere, and only talks to contacts. Each hour, a pair of
contacts in the same neighbourhood meets with probability 0.15; across
neighbourhoods, 0.01. There are 120 messages to contacts in another
neighbourhood, over 72 hours, averaged over 5 seeds.

| | delivered by 6 h | by 24 h | by 72 h | copies per message | most envelopes on one phone |
|---|---|---|---|---|---|
| Direct only (today) | 8.6 | 27.2 | 58.6 | 0 | 0 |
| Friend to friend, everyone carries | 11.8 | **45.0** | **80.8** | 9.9 | 27.8 |
| Friend to friend, half carry | 9.2 | 33.8 | 67.2 | 4.5 | 28.6 |

So, in this model, about 65 % more messages arrive within a day, and 38 %
more within three days, at the cost of about ten envelopes of a few KB
per message across the whole network. `carrySimulation.test.ts` keeps
these properties as tests. It is a model, not a measurement: real
movement, radio range and battery will change the numbers.

## Threat model

| Who | Can | Can't |
|---|---|---|
| A carrier (a contact) | See that it carries envelopes, their size bucket, expiry and tag; know who handed them over (a contact of theirs). | Read the text; know the sender or recipient unless it is a contact of the recipient (then the tag tells it "for Caro"); change the message or forge a sender (signature inside); make it last longer for the recipient (signed expiry). |
| A contact of the recipient | Recognize envelopes for the recipient by the tag while the mailbox key lasts (up to 14 days), and so link them. | Read them. |
| A stranger nearby | Nothing new: the radio link is the same encrypted, contacts-only session as today. | Receive, inject or carry envelopes. |
| Someone who floods | Fill at most 30 envelopes per contact and 200 in total on a phone that accepted to carry. | Fill the phone: hard limits, expiry, no strangers. |
| A future quantum computer recording traffic | Attack X25519. | Attack ML-KEM-768 too, which it also needs (hybrid). |

Known limits, to be decided in phase 2:

- **Tag linkability:** contacts of the recipient can link envelopes to
  them for up to 14 days. Rotating mailbox keys more often reduces it.
- **No forward secrecy per message:** envelopes for the same mailbox key
  share that key until it rotates. Stealing a phone (and unlocking its
  encrypted store) could open envelopes still addressed to keys that
  have not expired. Old secret keys must be deleted as soon as they
  expire.
- **Delivery receipts** travel the same way (kind "receipt") and let
  carriers drop copies early. They are designed but not wired.

## Phase 2 (pending)

1. New session message types: `carry_prekey` (give my mailbox key),
   `carry_put` (envelopes for you to deliver or carry).
2. SQLCipher tables for mailbox keys (mine, secret; contacts', public) and
   for held envelopes, with the same limits; secure deletion of expired
   secrets.
3. Messenger: when a message can't go directly and the recipient has a
   valid mailbox key, also seal it as an envelope. On every contact
   session: hand over what `CarryStore.handoff` says; open what is for me
   and show it as a normal message marked "via friends".
4. Settings: "Carry messages for my contacts" (off by default), with the
   storage it uses.
5. Tests with three phones (A and C never meet, B meets both), airplane
   mode, and the adversarial cases above on the real transport.
6. An external review of the new cryptography before calling it stable.
