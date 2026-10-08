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
| Identity box X25519 secret | **Low**: the identity `pk` is only used as an identifier; message encryption uses ephemerals. It decrypts nothing by itself. |
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
