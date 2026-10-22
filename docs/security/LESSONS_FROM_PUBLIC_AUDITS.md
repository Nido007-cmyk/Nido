# Lessons from public audits of other messengers

Security flaws repeat from one messenger to the next. This page takes the
published findings against Threema, Signal (PQXDH), Briar and Matrix, and
checks each one against NIDO's code. Every "NIDO" cell can be checked in the
repository.

Status: ✅ not applicable or already handled · 🔧 fixed in NIDO because of
this review (0.1.51) · ⚠️ known limit (also listed in
[`AUDIT_SCOPE.md`](AUDIT_SCOPE.md)).

## Threema — "Three Lessons from Threema" (ETH Zürich, USENIX Security 2023)

Source: <https://breakingthe3ma.app/>

| Attack | Root cause | NIDO |
|---|---|---|
| Ephemeral key compromise impersonation | Ephemeral keys reused across sessions | ✅ Every connection uses fresh X25519 ephemerals and nonces (`nativeTransport.ts`). The v5 ratchet keys are fresh per turn. Nothing is reused across sessions. |
| Vouch box forgery | Cross-protocol use of the same key (no key separation) | ✅ The identity X25519 key is used only for the sealed-hello pair key (`sealedHandshake.ts`, HKDF label `nido-v4-pair`). Ed25519 signing is a separate key. Handshake signatures are domain-separated strings (`nido-hello-v3\|…`, `nido-confirm-v1\|…`, `nido-confirm-v2\|…`). The other Ed25519 uses (negotiation, capabilities, delegation tokens) sign canonical JSON objects, which always start with `{`, so their formats are disjoint. |
| Message reordering and deletion | Timestamps not integrity-protected; no delivery or order check | ✅ `ts`, `id`, `from` and `to` are inside the authenticated encryption. Duplicates and replays are refused (`seenIds` plus a watermark). Delivery is confirmed by authenticated ACKs bound to the session (N6), so a dropped message stays "not delivered" and is retried. |
| Replay and reflection after reinstall | Replay database lost on reinstall | ✅ Session keys are fresh per connection, so old frames do not decrypt in a new session. The HELLO nonce cache is persistent (SQLCipher). Reflection is refused: a CONFIRM must name the peer's identity, and `to` must be me. |
| Kompromat (cross-protocol key reuse) | Same key used in registration and messaging | ✅ NIDO has no server and no registration protocol. Signature formats are disjoint (see above). |
| Cloning via ID export | Private key exported with only a password | ⚠️ A NIDO backup plus its key does carry the identity. Showing the backup key requires the owner's fingerprint or PIN (`unlockForSecret`). Someone who already controls the unlocked phone *and* its PIN can clone it, as with any messenger. |
| Compression side channel | Compress-then-encrypt of backups | ✅ Nothing is compressed before encryption: backups are a copy of the SQLCipher database, and messages are padded JSON. |

## Signal — PQXDH formal analysis (Bhargavan, Jacomme, Kiefer, Schmidt; USENIX Security 2024)

Source: <https://cryspen.com/post/pqxdh/>

| Issue | NIDO |
|---|---|
| DH and KEM public keys could be confused if encodings collide | ✅ They are different fields of the offer (`dh`: 32 B, `ek`: 1184 B) with strict size checks (`parseOffer`). |
| KEM re-encapsulation: IND-CCA alone does not bind the KEM public key | ✅ The v5 root binds `H(ek ‖ ct)` and both identities in the HKDF info (`deriveV5Root`). This is the fix the analysis recommends. |
| Weak PQ forward secrecy with last-resort keys | ✅ Not applicable: NIDO has no prekeys. Each connection uses a fresh ML-KEM key pair, discarded after use. |
| Same key used for X25519 and XEdDSA | ✅ NIDO uses separate X25519 (identity/DH) and Ed25519 (signature) keys. |
| Unstated assumptions about the KEM and AEAD | ✅ They are stated in `formal/README.md` and `docs/HANDSHAKE_THREAT_MODEL.md` (IND-CCA KEM, ideal AEAD). ML-KEM is FIPS 203 from mlkem-native. |

## Briar — Cure53 pentest

Source: <https://cure53.de/pentest-report_briar.pdf>

| Finding | NIDO |
|---|---|
| BRP-01-001 No screenshot protection | ✅ FLAG_SECURE on the main window and on secure dialogs (`plugins/withFlagSecure.js`, `nido-secure-dialog`). |
| BRP-01-004 Tapjacking of the panic and delete screens | ✅ Android 12+: other apps' overlays are hidden (`setHideOverlayWindows`). 🔧 Android 11 and older: since 0.1.51 the window ignores touches while another app covers it (`filterTouchesWhenObscured`, `plugins/withHideOverlays.js`). Erasing data also asks for a fingerprint or PIN. |
| BRP-01-005 / -008 Exported activities usable by any app | ✅ Exported components: the launcher activity, the quick-settings tile (protected by `BIND_QUICK_SETTINGS_TILE`) and ProfileInstallReceiver (protected by `DUMP`), as shown by the CI manifest summary. Text shared into NIDO is only placed in the input field, never sent automatically (`NidoLaunchModule.kt`). Other intents only accept `new_chat` and `p2p`. |
| BRP-01-009 Implicit PendingIntent | ✅ Both PendingIntents are explicit (the app's launch intent) and `FLAG_IMMUTABLE`. |
| BRP-01-002 Information in logcat | 🔧 Since 0.1.51 the native logs no longer contain Bluetooth MAC or IP addresses. No keys or message content are logged. |
| BRP-01-003 Debuggable release build | ✅ The release build is not debuggable; it is built and signed by CI. |
| BRP-01-010 Missing bounds check on padding length | ✅ NIDO's padding is trailing spaces that `JSON.parse` ignores, so there is no length field to abuse. Frame lengths are bounds-checked natively and in TS, and fuzzed weekly. |
| BRP-01-006 DNS leak | ✅ Not applicable: P2P never uses the internet or DNS. The local Wi-Fi route accepts only private and link-local addresses. |

## Matrix — "Practically-exploitable Cryptographic Vulnerabilities in Matrix" (IEEE S&P 2023)

Source: <https://eprint.iacr.org/2023/485>

The paper sorts its attacks into four root-cause classes. NIDO's position on
each class:

| Class | NIDO |
|---|---|
| Insecure by design (trusting a server) | ✅ There is no server. Every peer is authenticated with keys exchanged in person by QR code. |
| Protocol confusion | ✅ Envelope types are validated, and `session_confirm`, chat, ACK and settings are handled by type. Cross-version downgrades are blocked: CONFIRM v2 is enforced per contact and through `cf2`, v5 header encryption cannot be stripped, and once v5 is in use, classical frames are refused. Formal models cover the handshake. |
| Lack of domain separation | ✅ Every HKDF and signature has its own label (`nido-v4-*`, `nido-v5-*`, `nido-session-*`, `nido-hello-v3`, `nido-confirm-v1/v2`). |
| Implementation bugs | ⚠️ Mitigated by about 4,200 tests, weekly fuzzing, formal models and a byte-for-byte cross-check of native ML-KEM, but not ruled out. That is what a professional audit is for. |
