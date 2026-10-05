> **Language:** English · [Español](es/METADATA_PRIVACY.md)

# NIDO Metadata Privacy — Research and Design (draft v0.1)

**Status:** research and design. NOT implemented yet.

**Official position:** no solution is adopted just because it maximizes
anonymity. NIDO prioritizes **practical, verifiable privacy**: guarantees
a user can understand, an auditor can verify, and a phone can pay for in battery.

**Inviolable principles** (non-negotiable in any proposal in this
document):

- `TRANSPORT ≠ TRUST`.
- The relay **never** obtains: private keys (identity, device or
  session), plaintext of any envelope, private capabilities,
  permissions/policies, or authority of any kind.
- Fail-closed: if a metadata protection cannot be applied, the
  message doesn't silently go out over a weaker route.
- No silent security downgrade.

This document deepens the relay's open question
(`AGENT_PROTOCOL.md` §14.7, `TRANSPORT_ARCHITECTURE.md` §6) and the red-team's
RT-8 finding.

---

## 1. Metadata threat model

Content is protected: every envelope travels inside the session's AEAD channel
and signed at envelope level (`AGENT_PROTOCOL.md` §4). The
metadata adversary doesn't read content; they **observe the envelope**.

### 1.1 What an honest-but-curious relay learns today

For each message it routes, the relay inevitably sees:

- **When:** arrival/departure timestamp.
- **How much:** ciphertext size (≈ plaintext size + fixed
  AEAD overhead; size leaks structure: a `TASK_PROGRESS` doesn't measure
  the same as a `file.send`).
- **Where to:** destination identifier. Today: stable hash of the recipient's
  identity public key (RT-8).
- **Where from:** the source transport endpoint (socket/IP in the
  Internet case; local link in Bluetooth/LAN).
- **Pattern over time:** frequency, schedules, bursts, silences.

With that it can infer, without reading anything: an approximate contact
graph ("X talks to Y"), activity rhythms ("X and Y coordinate every morning"),
and behavior changes (a sudden silence is also information).
**Never**: plaintext, keys, capabilities, policies, or authority.

### 1.2 What a malicious relay can do (on top of the above)

- Drop, delay, duplicate or reorder (covered by idempotency and
  duplicates, `AGENT_PROTOCOL.md` §9; it degrades availability at most).
- Selective censorship by destination.
- Fine-grained temporal correlation between source and destination.
- Attempt to suppress revocations → **neutralized**: revocation also
  travels via direct contact and certificates expire (RT-9).

It cannot: read, forge (device signatures it doesn't possess), or convert
its position into privileges (RT-9).

### 1.3 Radio observer (Bluetooth/LAN)

Sees device presence and local connection patterns. Partially mitigated
with ephemeral discovery identifiers
(`TRANSPORT_ARCHITECTURE.md` §5); physical range limits the adversary.

### 1.4 What is fundamentally irreducible (honesty)

Without heavy infrastructure, **three leaks cannot be eliminated**:

1. **The fact of communication.** If A sends to B through a relay, someone
   observing both ends correlates by timing. Eliminating this requires
   artificial delays + cover traffic: battery and
   bandwidth a personal phone cannot pay continuously.
2. **Approximate size.** Padding to fixed sizes reduces it but doesn't
   eliminate it (and betrays the message class by frequency); aggressive
   padding wastes battery/radio.
3. **The existence of the social graph at network level.** First contact
   (QR, introduction) and routing need *some* addressable identifier.
   It can be rotated and obfuscated, but not made to disappear.

**Honest conclusion:** NIDO guarantees content confidentiality,
authenticity, and zero authority leakage against the relay. Metadata
minimization is layered and best-effort; *perfect unlinkability*
requires infrastructure (mix operators, permanent cover
traffic) that NIDO explicitly doesn't want. This document designs what
is practical.

---

## 2. Concepts investigated

### 2.1 Opaque routing identifiers

**Idea:** the relay routes by opaque identifiers instead of the stable
identity hash. Two variants:

- (a) `route_id = H(identity_pubkey || epoch_salt)` with clock-synchronized
  epochs (e.g. daily rotation).
- (b) **Per-pair rendezvous IDs**: `KDF(session_key, "rendezvous" ||
  epoch)`, agreed in the handshake. Each A↔B pair uses a distinct
  identifier, useless for correlating "who talks to whom" at the relay's
  scale.

**Evaluation:** (b) is strictly better: not even two distinct pairs
share an identifier, and it doesn't require synchronizing global epochs.
Low cost: one derivation per epoch. The relay still sees
size/timing, but loses the stable graph. Requires the recipient
to register its current rendezvous IDs with the relay (the registration itself
is an opaque ciphertext to the relay if done over the session… in
practice, registration happens in the direct handshake or via the relay with
a token — see §2.5).

### 2.2 Rotating identifiers (discovery and session)

**Idea:** no long-lived identifier in the middle:

- **Discovery (radio):** the Bluetooth name/announcement and mDNS registration
  rotate every N minutes with random values; the binding to the identity
  is only revealed in the authenticated handshake (already suggested in
  `TRANSPORT_ARCHITECTURE.md` §5).
- **Session:** after the handshake, endpoints use **ephemeral session
  aliases** toward the relay instead of any stable identifier
  (RT-8, partial fix already adopted in the protocol).

**Evaluation:** near-zero cost, real gain against passive radio tracking
and against longitudinal profiling by the relay. Doesn't protect against
active temporal correlation. This is the base layer: cheap, verifiable,
no infrastructure.

### 2.3 Sealed-sender-like concepts (sealed sender)

**Idea (inspired by Signal):** the relay delivers to the recipient without being
able to determine who sent it. In NIDO, the sender's identity already travels
*inside* the session ciphertext; what the relay sees is the **transport
source** (IP/socket). A real "sealed sender" would require the
transport source to also be unlinkable: anonymous connection, intermediate
hop, or sending through the recipient itself.

**Honest evaluation:** halfway doesn't help much — if the relay
sees the source IP, the cryptographic "sealing" is theater. The practical
version for NIDO: the sender may opt to send via a **mutual contact as an
opaque forwarder** (already foreseen: introduction via contacts),
where the forwarder only sees ciphertext and a rendezvous ID. Moderate gain,
only when the user asks; medium complexity (forwarding with its own
idempotency and expiration). Not a default: most NIDO traffic is between known
contacts where the graph is already mutual.

### 2.4 Private contact discovery

**Idea:** discover which contacts are reachable (or introduce yourself to a
new contact) without revealing the social graph to a directory.

- **PSI/PIR against a directory:** heavy cryptography (private set
  intersection, private information retrieval), requires a directory server,
  interactive rounds, high battery/computation cost.
- **Introduction via mutual contact:** A asks B (a common contact) to
  introduce them to C; B only reveals what A and C consent to. No global
  directory, no server.
- **In-person QR:** first contact leaves no trace on any network.

**Evaluation:** for the NIDO network (hand-picked contacts, QR as
root of trust), mutual-contact introduction + QR covers the
real use case without infrastructure. PSI/PIR solve a problem
NIDO doesn't have (a global directory). **Rejected** unless a future use case
explicitly requires it.

### 2.5 Blind routing tokens

**Idea (blind signatures, Chaum):** the relay (or the recipient) issues
routing tokens with blind signatures: the sender obtains a token without the
issuer being able to link *issuance* with *use*. When sending, they present the
token; the relay verifies the signature but doesn't know for whom it was
issued or when.

**Evaluation:** it unlinkes "who requested sending capacity" from "who
sent what", closing issuance-based profiling. Also, tokens
are a natural **anti-DoS mechanism**: no valid token, no routing
(complements the rate limiting of `AGENT_PROTOCOL.md` §8). Costs: the relay
must operate a blind-signature issuer (a standard audited scheme,
e.g. blind RSA — no home-grown cryptography), token expiration and
double-spend management, and one extra issuance round. Doesn't hide
size/timings. **Serious candidate for phase 2**: real gain,
minimal infrastructure (the relay itself, no third parties), moderate
complexity.

### 2.6 Mixnet / onion routing

**Idea:** delays, reordering and multiple hops with layered encryption
(Nym/Tor style) to resist global passive adversaries.

**Honest evaluation:**

- *Privacy gained:* high against a global network adversary, the best on
  this list.
- *Latency:* seconds to minutes per message — incompatible with
  interactive task negotiation.
- *Battery:* keep-alives, cover traffic and multiple hops; untenable
  as a mobile default.
- *Complexity:* enormous (mix selection, directories, reputation,
  synchronization).
- *DoS:* mixes are fragile and centralizable; who operates the nodes?
  Introduces the infrastructure dependency that NIDO rejects on
  principle ("no component assumes a server").
- *Final tradeoff:* maximizes anonymity at the cost of everything else.

**Explicitly rejected** for NIDO: the cost (latency, battery,
infrastructure, complexity) isn't justified for a personal-agents network
between known contacts, where the realistic adversary is a
curious relay or a local observer, not a global passive adversary.
Remains as research, not as direction.

---

## 3. Comparison matrix

| Concept | Privacy gained | Latency | Battery | Complexity | DoS resistance | Infrastructure |
|---|---|---|---|---|---|---|
| Per-pair rendezvous IDs (§2.1b) | High against longitudinal relay profiling | None | Negligible | Low | Neutral | None |
| Rotating identifiers (§2.2) | Medium-high (radio + longitudinal) | None | Negligible | Low | Neutral | None |
| Sealed-sender via forwarder (§2.3) | Moderate, only on demand | +1 hop | Low | Medium | Slightly worse (forwarder abuse) | None (uses contacts) |
| PSI/PIR discovery (§2.4) | High (but a foreign problem) | High | High | High | Poor | Directory server — **rejected** |
| Blind routing tokens (§2.5) | Medium-high (unlinks issuance/use) | +1 issuance round | Low | Medium | **Improves** (token = anti-spam) | Issuer in the relay itself |
| Mixnet/onion (§2.6) | Maximum | Seconds–minutes | High | Very high | Poor | Mix operators — **rejected** |

---

## 4. Phased recommendation

### Phase 1 — Design direction now (no infrastructure, ~zero cost)

1. **Per-pair rendezvous IDs** as the routing identifier toward the
   relay, derived in the handshake (`KDF(session_key, "rendezvous" ||
   epoch)`), rotated per epoch. They replace the stable identity hash
   (practically closes the RT-8 residual).
2. **Ephemeral session aliases** after the handshake + **rotating
   discovery identifiers** (radio/mDNS) every N minutes.
3. The relay remains **ciphertext-only and replaceable**; these layers
   neither give it nor take away any authority.

None of this requires changing the principles or the envelope: it lives in the
session/transport layer.

### Phase 2 — Open research (decide with a real use case)

4. **Blind routing tokens**: prototype the blind-signature issuer in the
   relay and measure the real cost of the issuance round before committing.
   Its anti-DoS value may justify it on its own.
5. **On-demand sealed-sender** via forwarder (mutual contact): only if
   a use case asks for it; never as default.

### Explicitly rejected (with justification)

6. **General-purpose mixnet/onion:** seconds-to-minutes latency,
   battery, complexity and node-operator dependency contradict
   the principles (no assumed servers, offline-first, practical
   privacy). The adversary that would justify it (global passive) isn't NIDO's
   design adversary.
7. **Global directory with PSI/PIR:** solves discovery at billions scale;
   NIDO discovers via QR and consented introductions.
   Infrastructure and cost without matching benefit.
8. **Permanent cover traffic / aggressive padding:** battery and radio
   wasted against an adversary the threat model doesn't require.
   Light opportunistic padding (e.g. size rounding by classes) is
   acceptable and cheap; the document allows it without requiring it.

---

## 5. What the relay never obtains (reaffirmation)

Even if the metadata configuration is wrong, the architecture
guarantees by construction:

- No private keys at any level (identity, device, session).
- No plaintext: session AEAD + envelope signature; the relay holds no
  keys.
- No private capabilities: the `CAPABILITY_RESPONSE` announces
  name/version/public description; the real inventory never leaves.
- No authority: the relay doesn't sign, delegate, or evaluate policies; a
  message "from the relay" is not a valid protocol message.

---

## 6. Future conformance tests (metadata)

- A test relay's log contains no byte parseable as an
  envelope (fuzz against the vector corpus).
- Two different epochs produce different `route_id`s for the same pair;
  the relay cannot link them without the `session_key`.
- Discovery identifier rotation: radio captures at t and t+N
  are not linkable.
- A used blind token is not linkable to its issuance (unlinkability
  test with test keys).

---

## 7. Open questions

1. Epoch length for rendezvous IDs: hours or days? (Tradeoff
   between unlinkability and re-registration cost against the relay.)
2. Who issues the blind tokens if there are multiple relays? Issuer federation
   or one per relay?
3. Must the forwarder (mutual contact) be explicitly consented by the
   final recipient, or is the forwarder's consent enough?
4. Size-class padding: what granularity is "cheap and useful"
   (e.g. powers of 2 up to 64 KiB)?
5. Should the user see the relay used and the current identifiers in Privacy
   Activity? (Transparency vs. UI complexity.)
6. Against an adversary that *also* controls the local network (compromised home
   router), what cheap additional layer remains? (Likely answer: no cheap one;
   document it as an accepted limit.)
