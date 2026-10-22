> **Language:** English · [Español](es/HANDSHAKE_THREAT_MODEL.md)

# NIDO — P2P handshake threat model

> Decision documented BEFORE implementing (Hardening phase, P2).
>
> **Historical note (2026-10-08):** this document records the handshake **v2**
> design rationale. The current protocol is HELLO v3 + CONFIRM v1 with
> **HKDF-SHA512** as the session KDF (not the raw SHA-512 construction shown
> below). For the implemented protocol, see `CRYPTO_ARCHITECTURE.md`; for the
> October 2026 audits, see `security/AUDITS_2026-10.md`. This file is kept as
> design history.

## Actors and assumptions

- **Alice and Bob**: two NIDOs paired in person via QR. The QR delivers
  each one's identity (public key) over an **authentic** channel (seeing
  each other's faces) but not confidential one (a QR can be photographed).
- **Attacker**: controls the Bluetooth channel (can eavesdrop, intercept,
  modify, inject and replay everything; this is the Dolev-Yao model over the
  RFCOMM link). Has NOT compromised either phone.
- **Channel**: RFCOMM with deliberately no OS-level encryption (system
  pairing would ask for PINs and confuse; NIDO provides the security).
- **Primitives**: X25519, Ed25519, XSalsa20-Poly1305, SHA-512 — all from
  `tweetnacl`, audited and standard. No primitive is invented.

## What handshake v2 protects

Handshake v2 authenticates the ephemeral exchange by binding it to the
identity verified via QR:

```
HELLO v2 = { t, v:2, pk, eph, nonce, sig }
sig = Ed25519_sign("nido-hello-v2" | pk | eph | nonce)   con la clave de firma
                                                          entregada en el QR
clave de sesión = SHA-512("nido-session-v2" | X25519(ephA,ephB)
                           | nonce_min | nonce_max)[0:32]
```

### Attacks it resolves

| Attack | How it's resolved |
|---|---|
| **MITM replacing the ephemeral** (the critical risk of HELLO v1) | The signature covers `pk‖eph‖nonce`. Without the peer's signing key (only on their phone), the attacker cannot forge a HELLO with their own `eph`. Verification fails → socket closed, no session. |
| **Identity impersonation** (attacker says "I'm Alice") | `pk` must be a contact paired via QR and the signature must verify with the `spk` stored in that pairing. |
| **Replay of an old HELLO to resurrect a session** | The session key includes the nonces of BOTH sides, ordered canonically. A repeated HELLO reproduces no past session's key (the other nonce is fresh per connection) and doesn't allow predicting the new one: the attacker doesn't know the ephemeral secret and cannot derive the key. |
| **Session confusion from a repeated HELLO within the window** | Mitigated with a per-peer handshake limit (one valid HELLO per 15 s window and per socket); a replay can only create a useless session that nobody but the real peer could use, and the rate limit prevents spam DoS. |
| **B/F1: replayed HELLO overwriting the route under a live session** (proven 2026-09-28) | Transport-level anti-replay: the receiver remembers every accepted `(peer, nonce)` pair. A repeated nonce — the exact signature of a captured-and-replayed HELLO, whose signature still verifies — is rejected fail-closed *before* any route mutation, regardless of the cooldown window. **R4 (2026-09-28) closed the remaining residual below:** the nonce cache is now persistent (SQLCipher `hello_nonce_cache`, atomic single-`INSERT` claim — a UNIQUE conflict IS the replay signal), and since R4 a HELLO alone can never modify the route table at all: the route/session is established only after a valid CONFIRM bound to both nonces of that connection (§R4 above). Original v2 residual (now closed, kept as history): a cross-context replay (HELLO captured from a different peer-pair session) carried a nonce the victim never saw; the v2 in-memory set also died on restart. |
| **Downgrade to unsigned HELLO v1** | Fail closed: the receiver requires `v:2` with a valid signature. A peer with an old app doesn't connect (clear message: "update the other NIDO"). |

## R4 (2026-09-28): HELLO v3 + CONFIRM — route hijack closed

**Status:** IMPLEMENTED + AUTOMATED TESTED. **Not** PHYSICALLY TESTED
(Tab A9+ Phase 1 / A1–A2 pending), **not** EXTERNALLY AUDITED.

R4 replaces the v2 handshake on the wire (hard cut: `v != 3` is rejected
before any state mutates). The v2 analysis above remains accurate as
history; what follows is the current protocol.

### Wire

```
HELLO v3 = { t:"nido-hello", v:3, pk, eph, nonce, ts, sig }
sig      = Ed25519_sign("nido-hello-v3|pk|eph|nonce|ts")

CONFIRM  = { t:"nido-confirm", v:1, pk, cn, pn, sig }
sig      = Ed25519_sign("nido-confirm-v1|pk|cn|pn")
```

`ts` = Unix seconds, signed; accepted within ±600 s (provisional constant,
pending real-device clock testing). `cn` = the CONFIRM sender's OWN nonce
(as seen in their HELLO); `pn` = the recipient's nonce (as seen in my
HELLO).

### The central invariant

> A HELLO alone NEVER modifies the route table (`pkToMac`/`macToPk`).
> The route and session are established ONLY after verifying a valid
> CONFIRM bound to BOTH nonces of that connection.

Concretely: on a valid HELLO the receiver verifies contact + signature +
freshness, atomically claims `(pk, nonce)` in a persistent SQLCipher cache
(`hello_nonce_cache`; a single `INSERT` — a UNIQUE conflict IS the replay
signal, fail-closed), sends its CONFIRM, and changes nothing else. On a
valid CONFIRM it checks the identity matches the pending HELLO, `cn` cites
the peer's nonce, `pn` cites my fresh nonce, verifies the signature — and
only then establishes the route and derives the session. No CONFIRM within
10 s → fail-closed timeout, no route.

### What R4 closes (vs the v2 residual)

- **B/F1 route hijack by captured-HELLO replay (proven 2026-09-28):** the
  v2 residual — a cross-context replay carrying a never-seen nonce — is
  closed two ways: (1) the persistent `(pk, nonce)` cache rejects ANY
  repeated nonce even across restarts (restart was the attacker's best
  weapon: it cleared the old in-memory set); (2) even a FRESH captured
  HELLO (new nonce, valid signature) cannot move the route: without the
  peer's live CONFIRM citing my fresh nonce, no route is created. The
  attacker would need the peer's signing key to forge the CONFIRM.
- **Simultaneous dial:** if both phones dial at once, each side computes
  `K = min(nonce_local, nonce_peer) ‖ max(nonce_local, nonce_peer)` per
  socket and keeps the socket with the smaller `K` — deterministic and
  order-independent (vectors in `src/p2p/handshakeV3.test.ts`).

### Scoped claim (read carefully)

R4 proves: **the holder of the peer's signing key participated live in
THIS transcript.** It does NOT prove:

- that the socket/MAC physically belongs to the peer (an active relay
  forwarding bytes live between two real NIDOs still delivers them —
  the peer really did participate);
- delivery (a relay-then-drop after CONFIRM is a blackhole; N6 resolves
  delivery semantics separately);
- that CONFIRM is a delivery receipt.

`HELLO_TS_SKEW_S = 600` is provisional until real-device testing with
wrong clocks and restarts. P2P identity is NOT part of backup/restore:
a restored install generates a fresh identity and requires re-pairing.

### Replay handling (R4 summary — supersedes the v2 HELLO entry below)

1. **Messages**: unchanged (unique ID + `INSERT OR IGNORE` + in-memory
   filter).
2. **HELLO v3**: signed `ts` + persistent atomic `(pk, nonce)` claim +
   CONFIRM-gated route establishment. A replayed HELLO is rejected at the
   claim; a fresh-but-lonely HELLO (valid signature, new nonce, no live
   peer behind it) dies at the CONFIRM gate. Neither ever touches the
   route table.

### Identity authentication

- Each NIDO's **identity** is two keys bound to the same device:
  - `pk` (X25519): identifier + encryption. Announced in the HELLO.
  - `spk` (Ed25519): signing. Delivered **only** in the pairing QR
    and stored in `p2p_contacts.sig_pk`.
- The trust chain is: **QR (physical encounter) → spk → ephemeral
  signature → session**. Without QR there is no `spk`, without `spk` there is no session.

### Forward secrecy

- Session keys are **ephemeral–ephemeral** (X25519 between per-connection
  generated secrets erased when the socket closes).
- Compromising the identity keys (signing or box) does **not** allow decrypting
  past sessions: the ephemeral secrets no longer exist.
- Messages at rest (inbox/queue) use the encrypted database (SQLCipher, P3),
  not the session keys.

### Replay handling (summary)

1. **Messages**: unique ID + `INSERT OR IGNORE` + in-memory filter (already
   existed; kept).
2. **HELLO**: signature + fresh nonce per connection + session key bound to
   both nonces + per-peer rate limit. A replay leaks no content and
   doesn't resurrect sessions.

## P2P v4 (2026-10-21): the receiver stays silent, and the hello can be sealed

**Silent receiver on both transports.** The phone that *receives* a
connection (Bluetooth or local Wi-Fi) sends nothing until the caller's HELLO
proves it is a paired contact (signature, freshness, anti-replay). Before
2026-10-21 this held only for Wi-Fi: over Bluetooth, where the RFCOMM server
listens in the background, any nearby device that connected to NIDO's
service received our signed HELLO — a stable identifier plus a signed proof
of presence. No wire change: the caller always sent its HELLO first.

**Sealed hello (experimental, off by default).** The caller's HELLO still
carries its permanent public key in clear. The sealed hello removes it:

- Each pair of contacts shares a static key nobody else has:
  `K_pair = HKDF-SHA512(salt="nido-v4-pair", X25519(my_sk, their_pk), info="nido-v4|pk_min|pk_max")`.
- Every handshake frame (the unchanged HELLO v3 and CONFIRM v1) is sealed:
  a fresh random `r`, a 16-byte tag `HKDF(salt=r, K_pair, "nido-v4-tag|kind")`,
  and the body encrypted with `secretbox` under `HKDF(salt=r, K_pair, "nido-v4-enc|kind")`.
  On the wire: `{"t":"nido-s4", r, g, n, b}` — random-looking bytes only.
- The receiver tries the tag against each contact (always all of them, no
  early exit) and only then opens the body. Inside, the v3 checks run as
  before: signature, timestamp window, nonce claim, CONFIRM bound to both nonces.
- Once a hello is sealed, every following handshake frame must be sealed
  with the same key. No fallback to v3 inside a sealed hello.
- A phone advertises support with `"c4":1` in its v3 HELLO (unsigned hint).
  A caller seals only when the "Private hello" setting is on **and** the
  contact advertised support. Receiving sealed hellos always works.

What it achieves: a passive observer sees no identity and cannot link two
connections of the same phone; a stranger who calls learns nothing; a sealed
HELLO meant for B cannot be replayed to another contact (it only opens with
B's pair key), which closes the HELLO-forwarding gap of v3.

What it does not: the frame type `nido-s4` and its size still reveal that
NIDO is in use; an active attacker can strip the `c4` hint so two phones
keep using v3 (today's behaviour); a contact can, by definition, recognise
the other side.

## P2P v5 (0.1.46): a new key per message, and ML-KEM in every connection

Experimental, off by default (Settings → Security). Used only when **both**
phones have it on; otherwise the session stays as described above. Code:
`src/p2p/ratchet.ts`, `src/p2p/pq.ts`, `src/p2p/protocol.ts`.

**Negotiation (no handshake change).** After the v3 handshake each side
sends its `session_confirm`, sealed under the classical session key `SK`.
Let L be the side with the lower identity key and H the higher one.
- L (if v5 is on) puts an offer in it: a fresh X25519 ratchet key `dh_L` and
  a fresh ML-KEM-768 public key `ek`.
- H (if v5 is on) puts `r5cap: 1` in its own confirm.
- All `session_confirm` frames are padded to the same 4 KB, so the one that
  carries the offer cannot be told apart and selectively dropped.
- Because the offer travels inside a frame authenticated with `SK`, an
  attacker cannot remove or alter it. Dropping it only leaves both phones
  in the classical mode; the chat screen shows when a session uses v5.

**Start (as Signal's RatchetInitAlice/Bob).** H encapsulates to `ek` →
`(ct, ss)`, derives
`RK0 = HKDF-SHA512(salt="nido-v5-root", SK ‖ ss, info="nido-v5-root|pk_L|pk_H|H(ek‖ct)")`
and starts as Alice with `dh_L` as the peer's ratchet key. Its v5 frames carry
`ct` until it hears a v5 frame from L. L decapsulates on the first v5 frame
and starts as Bob. While L waits for H's first v5 frame (at most 5 s after
seeing `r5cap`), it holds its outbox so queued messages also leave in v5.

**Double Ratchet.** Root and chain KDFs are HKDF-SHA512 with separate labels
(`nido-v5-rk`, `nido-v5-ck`, `nido-v5-mk`). Every message key is used once
and erased. A DH ratchet step happens each time the speaker changes.
Skipped keys: at most 256 per message (`MAX_SKIP`, checked against the total
of the old and new chain before computing anything) and 512 stored per
connection. Decryption works on a copy of the state and commits — and only
then erases the keys it retired — when the message authenticates; a forged
frame changes nothing.

**Frame.** `0x05 ‖ flags ‖ dh(32) ‖ pn ‖ n ‖ [ct(1088)] ‖ nonce(24) ‖ secretbox`.
The header is bound to the message by deriving the encryption key as
`HKDF(salt=mk, ikm=header, "nido-v5-msg")`: one changed bit gives another key.
After the first v5 frame from the peer, classical frames are refused, and
once both directions use v5 the classical key `SK` is erased from memory.

**What it achieves.**
- Forward secrecy per message: a state stolen later does not open earlier
  messages.
- Post-compromise security: after a stolen state, the next exchange of
  turns heals the session (fresh X25519). Every new connection also runs a
  fresh ML-KEM-768, so healing against a quantum attacker happens at the
  next connection.
- "Harvest now, decrypt later": the root mixes ML-KEM-768 (FIPS 203) with
  X25519, so recorded traffic stays closed unless both are broken.
  Authentication stays Ed25519, as in Signal's PQXDH: this is not protection
  against an active quantum attacker during the connection.

**What it does not.**
- The v5 header (ratchet key, counters) is not encrypted, as in Signal
  without header encryption: an observer can count messages and see turns.
- Padding hides lengths only to a power of two (512 B, 1 KB, 2 KB…).
- The ML-KEM library (`@noble/post-quantum` 0.7.1) is pure JavaScript, not
  constant-time and not independently audited, and NIDO's v5 itself has had
  an independent review by another AI agent, not a professional audit.
- v5 has not yet been tested on two physical phones; that is why it is off
  by default.

## What it does NOT resolve (honest limits)

- **Compromised peer**: if Bob's phone has malware, Bob is a legitimate
  endpoint and the attacker reads everything Bob receives. No protocol
  prevents this; the defense is the OS Keystore + not backing up
  keys (P6).
- **QR ceremony**: if the attacker sticks THEIR QR over Alice's
  (physical substitution) and the victim doesn't verify the fingerprint aloud,
  the pairing is with the attacker. The UI forces showing the fingerprint and
  recommends verifying it; there is no cryptographic defense against the user
  who skips the step.
- **Radio denial of service**: the attacker can jam Bluetooth at the physical
  level. Outside the protocol's scope.
- **Deniability / repudiation**: Ed25519 signatures are non-repudiable by
  design. NIDO prioritizes authentication over plausible deniability.
- **Traffic analysis**: an observer sees when two NIDOs talk and the
  approximate frame size (the content travels encrypted).

## Consequences if a device key is compromised

| Key compromised | Impact |
|---|---|
| Ed25519 signing secret | **Serious and active**: the attacker can impersonate the owner in future handshakes and establish sessions as them. Cannot read past sessions (forward secrecy) or already-delivered messages. Remedy: the owner generates a new identity and re-pairs their contacts via QR. |
| Identity box X25519 secret | **Low for confidentiality, real for privacy**: message encryption uses ephemerals, so it decrypts nothing by itself. Since v4 it also derives the pair keys of the sealed hello, so whoever holds it can recognise that phone's sealed hellos with its contacts. |
| Ephemeral secret of a connection | **Bounded to that connection**: only that session's messages. Erased on disconnect. |
| Database key (SQLCipher) | **Total local**: inbox, queue and identities at rest. Protected by Android Keystore (P3); the risk is a rooted device with the app unlocked. |

## Why not Noise (explicit decision)

Noise Protocol Framework (`Noise_XX`) would be the "textbook" choice. It's
rejected for now because:

1. There is no audited and maintained Noise binding for React Native/Expo 57;
   implementing it by hand over tweetnacl would be **more** invented surface
   than the current design.
2. The v2 design uses exactly the Noise properties we need (ephemeral
   authentication with the identity + ephemeral-ephemeral DH +
   transcript binding via nonces) with audited primitives and ~60 lines
   of reviewable code, versus hundreds for a full Noise handshake.

The `SHA-512(domain ‖ DH_secret ‖ nonces)` construction as KDF is
standard practice (cf. libsodium `crypto_kdf` / HKDF with SHA-512). It's
documented here for future external audit.
