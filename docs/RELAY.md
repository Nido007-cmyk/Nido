# Messages from friend to friend (relay)

> Status: **phase 1 done** (cryptography, storage rules, network
> simulation) and **phase 2 done in code** (wired into the messenger and
> the NIDO screen, tested with three simulated phones). **Pending:** a
> test with three real phones and an external review of the new
> cryptography. Nothing of this is in a release yet. Code:
> `src/p2p/relay/`.

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
- **The tag** is derived from the mailbox key id **and the day** (UTC).
  Only people who hold that mailbox key (the recipient's contacts)
  recognize it. That is how a carrier knows "this one is for Caro" when
  Caro is also its contact. Because it changes every day, a carrier who is
  not Caro's contact can't link Monday's envelopes for Caro to Tuesday's.
  Recipients and carriers check the tags of the last three days, today and
  tomorrow (an envelope lasts at most 72 hours).

New signing and KDF domains, disjoint from all others: `nido-carry-prekey-v1`,
`nido-carry-msg-v1`, `nido-carry-v1`, `nido-carry-key-v1`, `nido-carry-tag-v1|<day>`.

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
| A carrier (a contact) | See that it carries envelopes, their size bucket, expiry and tag; know who handed them over (a contact of theirs). If the writer hands an envelope over in person, the carrier can guess the writer (it can't tell an envelope written by that contact from one it was only carrying). | Read the text; change the message or forge a sender (signature inside); make it last longer for the recipient (signed expiry); know the recipient unless it is a contact of the recipient (then the tag tells it "for Caro"). |
| A contact of the recipient | Recognize envelopes for the recipient by the tag while the mailbox key lasts (up to 14 days), and so link them. | Read them. |
| A carrier who is not a contact of the recipient | Link envelopes with the same tag on the same day (same recipient). | Link them across days (the tag changes daily); know who the recipient is. |
| A stranger nearby | Nothing new: the radio link is the same encrypted, contacts-only session as today. | Receive, inject or carry envelopes. |
| Someone who floods | Fill at most 30 envelopes per contact and 200 in total on a phone that accepted to carry. | Fill the phone: hard limits, expiry, no strangers. |
| A future quantum computer recording traffic | Attack X25519. | Attack ML-KEM-768 too, which it also needs (hybrid). |

Known limits:

- **Tag linkability:** contacts of the recipient can link envelopes to
  them for up to 14 days (the life of the mailbox key). Others can only
  link them within one day.
- **No forward secrecy per message:** envelopes for the same mailbox key
  share that key until it rotates. Stealing a phone (and unlocking its
  encrypted store) could open envelopes still addressed to keys that
  have not expired. Expired secret keys, and keys of an earlier identity,
  are deleted the next time the phone gives out its mailbox key.
- **The writer's first carriers** can guess who wrote an envelope they
  got from the writer in person (see the table).
- **Relationships:** whoever carries for you learns that you have
  envelopes for someone; Briar documents the same kind of leak for its
  forums. Carrying is off by default for this reason.

## Phase 2: how it works in the app

- **Session message type `carry`** (payload `{prekey?, carries?, put?}`).
  When a verified session opens, a phone gives its mailbox key and says
  whether it carries envelopes, but only if that changed since it last
  told that contact, or a day has passed (in case it was lost). It also
  hands over what `CarryStore.planHandoff` says, in batches that fit in a
  frame (160 KB, at most 30). An envelope counts as given (deleted, or one
  copy spent) only after its frame went out, so a dropped connection loses
  nothing. The relay state is only looked at again for a session when
  something changed (a "generation" counter), so ordinary chat frames
  don't load it. Older NIDO versions drop the unknown type, as they
  already do with `settings`. The feature flag `p2p.relay` (on) turns all
  of this off at once.
- **Sending:** when a chat message can't go directly and the recipient
  gave a valid mailbox key, it is also sealed as an envelope and handed to
  the contacts that are connected and carry. It keeps the same message id,
  so if it later arrives directly too, the recipient recognizes it and
  only confirms it again. Messages in a conversation with disappearing
  messages on never travel this way (a copy would stay up to 72 hours on
  other phones), and neither do messages over 1,500 characters. When the
  writer meets the recipient, the writer's own envelope is not handed over:
  the message goes directly, with its normal confirmation. Cancelling a
  message stops this phone handing out its envelope; copies a contact
  already carries can still arrive.
- **Receiving:** an envelope for me is opened (`openCarry`), saved as a
  normal received message and marked "via friends" (only if it was new:
  if it had already arrived directly, it is just confirmed again). The recipient seals a
  signed **receipt** back the same way. When the writer gets it, the
  message shows as delivered, as with a direct confirmation, and the
  writer stops handing out its envelope.
- **Carrying:** only if the person turned on «Carry messages for my
  contacts» (off by default; Contacts tab, with the number of envelopes
  and KB used). Turning it off deletes the envelopes it carried for
  others.
- **Storage:** one table, `p2p_relay_kv`, in the same SQLCipher database
  as the rest (so "Delete all data" deletes it). Changing identity resets
  it.
- **Robustness:** anything malformed is dropped without throwing; nothing
  is accepted from someone who is not a contact, or from a revoked one;
  at most 30 envelopes per frame are even looked at; envelopes already
  seen are skipped before any decryption. The outer expiry and hops are
  not signed, so a carrier could inflate them: a phone never keeps an
  envelope more than 72 hours after it arrived, nor with more than 3 hops.
  If reading the stored state fails, the operation is cancelled instead
  of writing an empty state over it (which would lose the mailbox keys);
  damaged data is checked field by field (`relayService.test.ts`).

Still pending:

1. A test with three real phones (A and C never meet, B meets both).
2. An external review of the new cryptography before calling it stable.

## Who else does this (prior art, checked 2026-11)

| App | What travels through other phones | Who relays | What relays can see |
|---|---|---|---|
| [Briar](https://briarproject.org/quick-start/) | Forum posts, through contacts who share the forum. Private 1:1 messages only go directly. | Contacts only | Briar documents that syncing reveals who is a contact of whom ([issue 2123](https://code.briarproject.org/briar/briar/-/issues/2123)). Briar Mailbox is your own spare phone that buffers messages. |
| [Scuttlebutt / Manyverse](https://handbook.scuttlebutt.nz/concepts/private-message) | Everything, by gossip, up to the hops each client chooses (2–3). | Friends and friends of friends | Private messages hide the recipients, but the sender, time and size stay visible ([analysis](https://ccom.uprrp.edu/~humberto/traffic-analysis-of-ssb-private-messages.html)), and messages stay in the logs for good. |
| [Meshtastic](https://meshtastic.org/docs/overview/mesh-algo/) (LoRa radio) | All packets, by managed flooding with a hop limit. | Any node, strangers included | Direct messages are encrypted, but headers are readable. |
| [Bridgefy](https://eprint.iacr.org/2021/214) | Messages over a Bluetooth mesh. | Any phone | Researchers showed users could be tracked, messages read and users impersonated, and that one crafted message could shut the network down ([again in 2022](https://www.usenix.org/conference/usenixsecurity22/presentation/albrecht)). |
| [Berty](https://berty.tech/protocol) | Directly between nearby phones; "replication nodes" that can't read keep copies. | Your own replication devices or servers | — |
| bitchat (2025) | Bluetooth mesh. | Nearby phones | Early project with public security concerns ([The Register](https://www.theregister.com/2025/07/08/jack_dorsey_debuts_bitchat/)). |

What NIDO takes from them: contacts only, never strangers (Briar; the
lesson of Bridgefy); hard limits and hostile-input tests (Bridgefy);
padding and no outer sender (what Scuttlebutt leaves visible); a tag that
changes over time (the idea of rotating identifiers in Bluetooth tracking
networks); limited copies (Spray and Wait, Spyropoulos, Psounis and
Raghavendra, 2005). As far as we know, none of these carries **private
1:1 messages** from contact to contact with sender and recipient hidden
from carriers, padding, a signed expiry and hybrid post-quantum
encryption together. We can't check every app in the world, so NIDO does
not claim to be the first.
