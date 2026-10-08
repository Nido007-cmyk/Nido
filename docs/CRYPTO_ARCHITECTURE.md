> **Language:** English · [Español](es/CRYPTO_ARCHITECTURE.md)
# CRYPTO_ARCHITECTURE.md — NIDO

**Date:** October 8, 2026 (updated; original September 28, 2026).
**Current protocol: handshake v3 + CONFIRM v1, session KDF HKDF-SHA512.**
**Status:** IMPLEMENTED + AUTOMATED TESTED (1985 tests). **Not** PHYSICALLY TESTED
(two-device), **not** EXTERNALLY AUDITED.

This document precisely describes the protocol as implemented today,
its guarantees, its limits, and the migration path. No quantum resistance
or external audit is claimed: neither exists. §4 below is kept as the v2
reference; §4bis describes the current R4 handshake (KDF, QR, and framing
are unchanged).

## 1. Protocol version and domain separation

| Context | Domain / version | Use |
|---|---|---|
| HELLO on the wire | `{t:"nido-hello", v:3}` (R4; §4bis) | `parseHello` rejects `v != 3` before mutating any state (hard cut, no v1/v2 compat). |
| HELLO signature | `"nido-hello-v3"` (transcript prefix) | Ed25519 over the exact transcript of §4bis. |
| CONFIRM on the wire | `{t:"nido-confirm", v:1}` (R4; §4bis) | Route/session are established ONLY after a valid CONFIRM. |
| Session KDF | `"nido-session-v2"` (salt), `"nido-session-key-v1"` (info) | HKDF-SHA512 (RFC 5869), 32 B output. Replaced raw SHA-512 truncation in October 2026 (see §12). |
| Pairing QR | `"NIDO1:"` + `{v:2, app:"nido"}` | Physical root of trust. |
| Session framing | `PROTOCOL_VERSION = 1` | `[u32 BE len][24 B nonce][secretbox(JSON)]`, max 256 KiB. |

**No other signature or KDF context exists in the system.** A valid
signature from one context cannot be reused in another: domains are
disjoint and versioned. Every future protocol version requires an
explicit `v` bump + negative tests (see §9, anti-downgrade policy).

## 2. Identity

- **Pairing identity key:** X25519 (32 B `pk`). It is the contact's
  stable identifier (primary key in `p2p_contacts`).
- **Identity signing key:** Ed25519 (32 B `spk`, 32 B seed).
  **Key separation:** the same key is never used for signing and DH.
  Ed25519 only signs HELLOs; X25519 only identifies (the session DH
  uses **ephemerals**, never the identity).
- **Generation:** `generateSigningKeypair()` with CSPRNG (`expo-crypto` / `nacl.randomBytes`).
- **Storage:** the Ed25519 seed (32 B) lives in SecureStore under the
  key `nido_p2p_sign_sk` (encrypted by the Android Keystore; never in
  plaintext on the app's disk, never in logs). The public `spk` is
  published in the QR.
- **Fingerprint:** `fingerprint(pk)` human-readable for in-person verbal
  verification.

## 3. Signing public key distribution and verification (QR v2)

1. The QR contains `NIDO1:{"v":2,"app":"nido","name","pk","spk"}` (`pk` =
   X25519 identity, `spk` = Ed25519 signature key). The encoder **always**
   generates v2.
2. The decoder accepts v1 for **reading**, but v2 requires a valid `spk`
   (64 hex chars); a tampered, truncated, or oversized QR is rejected
   without crashing.
3. `pairWith()` stores `(pk, name, verified=1, sig_pk=spk)`. Rejects
   one's own code.
4. **The QR is the root of trust:** the stored `spk` is the sole
   authority for accepting HELLOs from that `pk`. The handshake **never**
   trusts "the peer knows the UUID" or the Bluetooth MAC: identity comes
   from the signed `pk`, not the transport.

## 4. Handshake v2 (step by step)

Symmetric roles: either phone may initiate (A = initiator, B = responder;
the protocol doesn't distinguish).

1. **A → B (over the RFCOMM socket):** `HELLO = {t:"nido-hello", v:2, pk_A, eph_A, nonce_A, sig_A}`
   - `eph_A`: freshly generated **ephemeral** X25519 public key (secret
     only in RAM).
   - `nonce_A`: fresh 16 B random per handshake.
   - `sig_A = Ed25519_sign(sk_A, transcript)`, with the **exact transcript**:
     ```
     "nido-hello-v2" | hex(pk_A).toLowerCase() | hex(eph_A).toLowerCase() | hex(nonce_A).toLowerCase()
     ```
     separated by `|`, UTF-8 encoded. The signature binds the ephemeral
     and nonce to the QR-verified identity.
2. **B verifies:**
   - `parseHello`: valid JSON, correct `t`, `v == 2` (v1 → "update your
     app" error; other → "unknown version"), strict hex formats
     (64/64/32/128 chars).
   - `pk != my_own_pk` → reject (anti-reflection).
   - `findContactByPk(pk)` → must exist (unknown → reject + close).
   - `contact.sig_pk` must exist (legacy contact without spk →
     fail-closed reject with re-scan-the-QR instruction).
   - `Ed25519_verify("nido-hello-v2|pk|eph|nonce", sig, contact.sig_pk)`
     → if it fails, reject ("possible man-in-the-middle attack") +
     connection close.
   - Cooldown: if there's already a live route with that peer and the
     last handshake was <10 s ago, the duplicate HELLO is rejected
     without replacing the session.
3. **B → A:** its own signed HELLO (same procedure). Both sides verify.
4. **Session derivation (both sides), HKDF-SHA512 (RFC 5869)** —
   `deriveSessionKeyV2` (`src/p2p/crypto.ts`):
   ```
   DH   = X25519(mi_eph_secret, su_eph_public)
   IKM  = DH || nonce_min || nonce_max      (canonical order by byte comparison:
                                            both sides derive the same key
                                            regardless of who initiated)
   PRK  = HKDF-Extract(salt="nido-session-v2", IKM)
   K    = HKDF-Expand(PRK, info="nido-session-key-v1", 32)
   ```
   HMAC-SHA512 is implemented over the audited `nacl.hash` (TweetNaCl exports
   no HMAC primitive). Intermediate secrets (`DH`, IKM input) are wiped with
   `fill(0)` after deriving, and the caller's ephemeral secret is zeroed
   in-place on **all** handshake exit paths (success, timeout, bad signature,
   disconnect) — forward-secrecy hygiene in memory, verified by tests.
   (Historical note: before October 2026 this step used raw
   `SHA-512(domain || DH || nonces)[0:32]`; the KDF cut is clean — both
   peers must run the same code, and a mismatch fails closed at
   `session_confirm`, never insecurely.)
5. **Session confirmation (liveness):** each side sends `session_confirm`
   (AEAD under K). The message queue is **only** drained toward sessions
   that produced at least one valid frame (liveness). A repeated HELLO
   from an attacker creates at most a ghost session under which no valid
   frame ever arrives: no queued message is lost to it.

## 4bis. R4 handshake: HELLO v3 + CONFIRM (current; delta over §4)

R4 (2026-09-28) closes the B/F1 route-hijack residual: a HELLO alone can
never modify the route table. The KDF (`"nido-session-v2"`), QR pairing,
and framing (§5) are unchanged.

1. **A → B:** `HELLO = {t:"nido-hello", v:3, pk_A, eph_A, nonce_A, ts_A, sig_A}`
   - `ts_A`: Unix seconds, signed. Exact transcript:
     ```
     "nido-hello-v3" | hex(pk_A).toLowerCase() | hex(eph_A).toLowerCase() | hex(nonce_A).toLowerCase() | ts_A
     ```
2. **B verifies** (fail-closed, in order): valid JSON/shape; `t`/`v`
   (`v != 3` → reject before any state mutates); strict hex formats;
   `pk != my_own_pk`; `|now - ts| ≤ 600` s (`HELLO_TS_SKEW_S`,
   provisional); contact exists with `sig_pk`;
   `Ed25519_verify("nido-hello-v3|pk|eph|nonce|ts", sig, contact.sig_pk)`;
   **atomic claim** of `(pk, nonce)` in the persistent SQLCipher table
   `hello_nonce_cache` — a single `INSERT`; a UNIQUE conflict IS the
   replay signal → reject. Then B sends its CONFIRM and changes nothing
   else: **no route, no session yet.**
3. **B → A:** `CONFIRM = {t:"nido-confirm", v:1, pk_B, cn: nonce_B, pn: nonce_A, sig_B}`
   with `sig_B = Ed25519_sign("nido-confirm-v1|pk_B|cn|pn")`. (And A → B
   symmetrically: `CONFIRM_A(cn=nonce_A, pn=nonce_B)`.) `cn` is always the
   CONFIRM sender's OWN nonce; `pn` is the recipient's nonce.
4. **A verifies the CONFIRM:** identity equals the pending HELLO's `pk`
   (kills reflection); `cn` == peer's nonce from THIS connection;
   `pn` == MY fresh nonce from THIS connection (transcript binding);
   signature verifies with `contact.sig_pk`. **Only then:** establish the
   route (`pkToMac`/`macToPk`) and derive the session exactly as in §4
   step 4. No CONFIRM within 10 s (`CONFIRM_WAIT_MS`) → fail-closed
   timeout, connection closed, no route.
5. **Simultaneous dial:** if a confirmed route already exists for the peer
   on another socket, both sides compute
   `K = min(nonce_local, nonce_peer) ‖ max(nonce_local, nonce_peer)` per
   socket (lexicographic, byte-wise) and keep the smaller `K` —
   deterministic regardless of arrival order.

## 5. Session: lifetime, messages, anti-replay

- **Lifetime:** the session lives in RAM (`messenger.sessions`). Born in
  `completeHandshake`, **replaced** by the next handshake with the same
  peer, never persisted. `handleDisconnect` doesn't delete it immediately
  (the send retry fails safe and the message stays queued); the next
  handshake replaces it with a fresh key.
- **Messages:** `XSalsa20-Poly1305` (secretbox) with a random 24 B nonce
  per message. (Pending migration to XChaCha20-Poly1305 with AAD: H-2.)
- **Anti-replay:** fresh `nonce` per handshake (the key changes even if
  the HELLO repeats); unique `id` per message + in-memory `seenIds` +
  persistent DB deduplication (a restart doesn't re-deliver); frames with
  invalid AEAD, wrong recipient, or spoofed sender are silently
  discarded.
- **Sizes:** max 256 KiB frame; max 4000-char chat message; QR with
  limits.

## 6. What persists and what doesn't

| Data | Where | Encrypted today |
|---|---|---|
| Ed25519 identity seed | SecureStore (`nido_p2p_sign_sk`) | Yes (Keystore) |
| X25519 identity private key | SecureStore | Yes (Keystore) |
| Contacts `(pk, name, sig_pk)` | SQLite `p2p_contacts` | **Yes** — SQLCipher, DEK in Android Keystore (alias `nido_db_key`), fail-closed |
| Messages (inbox/outbox) | SQLite `p2p_messages` | **Yes** — SQLCipher, same DEK, fail-closed |
| Sessions (key K) | RAM | n/a (never on disk) |
| Handshake ephemerals and nonces | RAM | n/a (never on disk; zeroed on all handshake exit paths) |
| Anti-replay `seenIds` | RAM (+ DB for persistent duplicates) | Partial |

**Consequence:** the app database is encrypted at rest (C-1 milestone complete).
Without the Keystore-held DEK the database is indistinguishable from random.

## 7. Behavior on identity key change

- If the peer changes their key (legitimate reinstall) or an attacker
  tries to impersonate them, the HELLO signature **doesn't verify**
  against the stored `spk` → connection rejected, fail-closed. No silent
  acceptance.
- **Known gap (H-4):** the current error doesn't distinguish "possible
  attack" from "your contact reinstalled the app", and there's no "last
  seen spk" pin against rollback. The UX must guide in-person QR
  **re-verification**, in human language, before replacing the spk.

## 8. If SecureStore/Keystore fails

- **When signing (starting handshake):** `getSigningKeypair()` propagates
  the error → `connect()` / `onConnected` catches it →
  `onError("Could not start the handshake: …")` event and the connection
  closes when the 15 s timeout expires. **Clean failure, no crash, no
  half-handshake.**
- **When verifying:** only the contact's **public** `spk` is needed
  (SQLite). If the DB won't open, there's no handshake: fail-closed.
- **If the Keystore is invalidated** (e.g. lock change on some devices):
  seeds become unreadable → the identity can't sign → the identity must
  be regenerated and re-paired via QR. That's the correct behavior (there's
  no safe way to "recover" a hardware-protected key); the UX must explain
  it (H-7).

## 9. If an identity key is compromised *afterwards*

- **Past content:** PROTECTED (forward secrecy). Sessions used
  **ephemeral** X25519; the identity key (signing) never participated in
  deriving K. Compromising the Ed25519 afterwards does **not** decrypt
  past conversations.
- **Future:** NOT PROTECTED (no post-compromise security). With the
  signing key, the attacker can sign HELLOs and impersonate the owner to
  their contacts until they rotate/revoke (H-7). There's no automatic
  "healing": recovery is rotating the identity and re-pairing via QR in
  person.
- **A compromised Ed25519 signature doesn't affect other contexts:**
  there are no other uses of that key (key separation, §2) and the
  signature domain is unique (§1).

## 10. Anti-downgrade policy

1. **No insecure version is silently accepted.** v1 is rejected with an
   explicit update message; unknown versions are rejected.
2. Every new protocol version requires: `v` bump, entry in the §1 table,
   negative tests rejecting the previous version, and a migration note
   (or permanent rejection if the previous one was insecure).
3. The wire will be crypto-agile (version + suite) for the future hybrid
   PQ branch without breaking rule 1.

## 11. Handshake red-team (2026-09-27)

Attacks attempted against the real implementation (`src/p2p/`), with
results. Format: threat → scenario → mitigation → test.

| # | Attack | Result |
|---|---|---|
| 1 | Downgrade v2→v1 (HELLO `v:1`) | **Rejected.** `parseHello` throws "old handshake… update your app" and the connection closes. Test: `nativeTransport.test.ts` "signed roundtrip and rejections". |
| 2 | Unknown version (`v:99`, `v:"2"`) | **Rejected.** "Unknown-version HELLO". Test: `nativeTransport.test.ts` (rejection cases). |
| 3 | Reflection (replay my own HELLO) | **Rejected.** `pk == my_pk` → "It's my own device". Test: "HELLO with my own pk → rejected". |
| 4 | Sender/receiver swap | **Not applicable / safe by design.** The HELLO has no separate sender/receiver fields: identity is the signed `pk`. A valid HELLO from Alice always authenticates as Alice, whoever replays it. |
| 5 | Reusing a HELLO from another session (new connection) | **Neutralized for confidentiality; residual availability DoS (see note).** <10 s after the last handshake: the duplicate is rejected by cooldown without touching the live session (test: "captured HELLO replayed on another connection → cooldown rejects it"). >10 s: the handshake "completes" with my fresh `nonce` → derives a **different key** (test: "different nonces → different keys"); the attacker doesn't know the peer's ephemeral secret and can't produce `session_confirm` → no liveness → **the queue neither drains nor diverts**. Note: in the >10 s window the ghost session **replaces** the live one in the map (the real peer's frames fail AEAD and are discarded) → transient availability DoS that heals with the next handshake. Planned mitigation: H-8 (don't replace the live session until the new one proves liveness). Severity: LOW (requires radio proximity; a jammer achieves the same without cryptography). |
| 6 | Valid nonce with different ephemeral (MITM) | **Rejected.** The signature covers `(pk\|eph\|nonce)`; substituting `eph` invalidates the signature. Test: "MITM: ephemeral substituted after signing". |
| 7 | Valid signature used for another peer (Bob's pk, Alice's signature) | **Rejected.** The lookup is by the HELLO's `pk` and verification uses **that** contact's `spk`. Test: "forged signature with another key → rejected". |
| 8 | Old QR after identity rotation | **Rejected (fail-closed).** The contact stores the old `spk`; HELLOs signed with the new key don't verify. H-4 pending for re-verification UX. |
| 9 | Two simultaneous A↔B connections | **Converges by design** (not physically tested). Both derive the same K via canonical nonce ordering; `pkToMac` keeps the latest route; the 10 s cooldown prevents duplicate-HELLO replacement. Risk: redundant socket (radio cost, not security). **Requires physical test (P7).** |
| 10 | Restart mid-handshake | **Fail-closed.** Ephemerals and nonces are RAM-only and lost; the session doesn't exist; messages stay `queued` in the DB and send after the next complete handshake. No leak, no partial acceptance. |
| 11 | Messages from previous session after reconnect | **Discarded.** The new session has a new key (fresh nonces); old frames fail AEAD → silent `null`. Test: `adversarial.test.ts` (corrupt ciphertext / sessions). |

**Red-team conclusion:** no way was found to break the authentication,
confidentiality, or anti-replay of handshake v2 with the listed attacks.
Items 9 and 10 require physical confirmation (P7). Migration to Noise_XX
(X-2) remains future work with official vectors; the current v2 is the
"simplest secure protocol" the research recommends keeping until then.

## 12. October 2026 security hardening (protocol v3 + CONFIRM v1 era)

Two adversarial red-team rounds (October 8, 2026; full summaries in
`docs/security/AUDITS_2026-10.md`) attacked the handshake, KDF, token
chain, negotiation layer, and delegation trust boundaries. All actionable
findings were fixed; the cryptography itself was not dented in either
round. Changes since §11:

- **KDF:** raw SHA-512 truncation replaced by HKDF-SHA512 (RFC 5869)
  (§4 step 4). Cross-version KDF confusion fails closed at
  `session_confirm`.
- **Ephemeral hygiene:** the ephemeral secret is zeroed on every
  handshake exit path (success, timeout, bad signature, disconnect);
  the handshake pending slot is reserved synchronously before the
  first await (no orphaned ephemerals from concurrent frames).
- **Negotiation hardening:** PROPOSE for an existing `negotiationId`
  is rejected (fail-closed), with a **synchronous** ID reservation
  before the first await so concurrent same-ID PROPOSEs cannot race
  past the check; all negotiation signatures are pinned to the
  QR-established `contact.sigPkHex` (the handshake already pinned
  HELLOs; negotiation now matches).
- **Delegation tokens (feature flag OFF):** tokens are bound to the
  transport session (`sessionTag`, strict bidirectional matching —
  kills cross-session replay within the expiry window);
  `attenuateToken` verifies the chain before extending it.
- **ApprovalGate:** the human approval is bound to the exact bytes
  shown on the card (deep snapshot at registration, hash re-verified
  at approve, timeout = deny, single consume); `approve()` re-checks
  negotiation liveness synchronously (no TOCTOU); pending approvals
  are capped per peer with lazy expiry sweep; the approval card shows
  the document hash, size, and preview (marked untrusted) for
  `task:summarize`.
- **Memory trust boundary:** peer-origin facts are namespaced out of
  the owner's conversation context (`getOwnerFacts()` allowlist);
  `remember_fact` requires human confirmation when the tool context
  contains untrusted-sourced content (fail-closed if no confirmation
  UI is wired).
- **Pre-auth rate limiting:** max 5 inbound handshake starts per MAC
  per 60 s, checked before ephemeral generation/signing.
- **Operational:** minimum Android security patch level **2025-03-05**
  documented (below-app-layer Bluetooth SDP RCE class,
  CVE-2025-0075/22403 — no in-app fix possible).

**Honest status:** no external cryptographic audit exists; no
two-device physical test has been run; adaptive prompt-injection
testing against the on-device model has not been done. See
`docs/security/AUDITS_2026-10.md` for the full verified-holding and
not-covered lists.
