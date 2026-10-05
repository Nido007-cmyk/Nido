> **Language:** English · [Español](es/BLUETOOTH.md)
# NIDO — Bluetooth Transport (`nido-p2p` module)

> Status: Kotlin code + TypeScript adapter complete and tested at logic
> level (413 tests). **Not compiled or tested on hardware**: this
> environment has no Android SDK/Java. Physical validation is mandatory
> before declaring P2P functional (checklist below).

## What each piece does

| Piece | File | Responsibility |
|---|---|---|
| RFCOMM sockets | `modules/nido-p2p/android/.../NidoP2PManager.kt` | Server/client, discovery, framing. Only moves bytes. |
| Expo bridge | `modules/nido-p2p/android/.../NidoP2PModule.kt` | Async functions + events to JS. |
| TS bindings | `modules/nido-p2p/src/index.ts` | Typed API of the module (only loaded in a real build). |
| Adapter | `src/p2p/nativeTransport.ts` | Implements `P2PTransport`: HELLO handshake, MAC↔pk routes. |
| Crypto/protocol | `src/p2p/*` (unchanged) | X25519, secretbox, anti-replay, queue, inbox. |

Golden rule: **the Kotlin interprets nothing**. It reassembles
`[u32 big-endian length][payload]` frames (max 256 KB, same as
`FrameReassembler` in `src/p2p/protocol.ts`) and delivers them in base64.
Encryption, handshake, and contact verification live in TypeScript,
where the tests are.

## Service UUID

```
8f3a1c2e-9b4d-4e5f-8a6b-7c9d0e1f2a3b   (nombre SDP: "NIDO-P2P")
```

Defined in `NidoP2PManager.SERVICE_UUID_STRING` and exposed to TS via
`getServiceUuid()`. It is fixed and public: it identifies "speaks NIDO" at
the SDP level.

## Handshake (transport level)

After the RFCOMM socket is established (in either direction), each side sends
a signed HELLO v3 frame (R4; full spec in `docs/CRYPTO_ARCHITECTURE.md`
§4bis):

```json
{"t":"nido-hello","v":3,"pk":"<64 hex>","eph":"<64 hex>","nonce":"<32 hex>","ts":1234567890,"sig":"<128 hex>"}
```

The adapter (`NidoBluetoothTransport`):

1. Sends its HELLO v3 immediately on connect/accept (idempotent per MAC).
2. On receiving HELLO: validates shape → hard cut on `v != 3` → requires
   `pk` to be a **QR-paired contact** (`findContactByPk`) → verifies the
   Ed25519 signature over `"nido-hello-v3|pk|eph|nonce|ts"` → checks the
   signed timestamp (±600 s, provisional) → atomically claims
   `(pk, nonce)` in the persistent `hello_nonce_cache` (UNIQUE conflict =
   replay → reject). Then it sends its CONFIRM — and still creates **no
   route and no session**.
3. On receiving a valid CONFIRM (`{t:"nido-confirm", v:1, pk, cn, pn,
   sig}`, signature over `"nido-confirm-v1|pk|cn|pn"` citing both nonces
   of THIS connection): only then it establishes the route and emits
   `onHandshakeComplete(pk, myEphSecret, theirEphPk, myNonce, theirNonce)`;
   the messenger derives the session and drains the outbound queue to
   that peer. No CONFIRM within 10 s → fail-closed timeout, no route.
4. From then on, `sendFrame(pkHex, …)` routes by MAC and incoming frames go
   to `onFrame(pkHex, …)`.

Central invariant (R4): a HELLO alone NEVER modifies the MAC↔pk routes.
Without a valid CONFIRM there is no session and `handleFrame` discards
everything (already the case).

## Security decisions

- **Insecure RFCOMM (no OS pairing).** NIDO's trust comes from the QR +
  its own crypto. System pairing would ask for PINs, confuse the user, and
  adds nothing once the handshake verifies the peer against the QR contact
  list.
- **The identity `pk` is announced in cleartext** to whoever connects. It
  is a pseudonym and only QR contacts get a session; a stranger is
  disconnected before any content flows.
- **Known limitation (not swept under the rug):** R4 proves the holder of
  the peer's signing key participated live in this transcript — it does
  NOT prove the socket/MAC physically belongs to the peer. An active relay
  forwarding bytes live between two real NIDOs still delivers them, and a
  relay-then-drop after CONFIRM is a blackhole (delivery semantics are
  N6's scope, separate). Messages still carry sender verification,
  recipient verification, and anti-replay IDs.

## Permissions (Android)

Declared in `app.json` (merged into the manifest):

- `BLUETOOTH`, `BLUETOOTH_ADMIN` (legacy)
- `BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN` (API 31+)
- `ACCESS_FINE_LOCATION` (discovery on API < 31)

At runtime, `requestPermissions()` requests them before discovery/server;
without them the transport throws clear errors in Spanish (it does not pretend).

## Physical validation checklist (two phones, no internet)

Requirement: Android SDK + JDK 17, `npx expo prebuild -p android --clean`,
`npx expo run:android` on each phone (see `docs/ANDROID_BUILD.md`).

1. [ ] Compiles: the module appears in autolinking (`NidoP2P` in the
       prebuild log's Expo module list).
2. [ ] On each phone: create identity, pair via QR (contacts appear on both).
3. [ ] NIDO screen (future, Priority 5): enable link → discovery lists the
       other phone; on connect, `onHandshakeComplete` on both.
4. [ ] Send message with the other NIDO **out of range** → it stays queued
       encrypted (`pendingOutbox`), nothing is lost.
5. [ ] Bring close → the message is delivered on its own; `readInbox` shows it.
6. [ ] Turn off Bluetooth mid-long-message → no ghost bytes: the next
       handshake retransmits from the queue (ID idempotency avoids visible
       duplicates).
7. [ ] A third **unpaired** phone tries to connect → it is rejected
       ("not paired"), no session or messages.
8. [ ] `adb logcat`: no stacktraces in `NidoP2PModule`/`NidoP2PManager`
       during scenarios 3–7.

## Things to verify on the first real build

- `requestPermissions`: the `appContext.permissions.askForPermissions` API
  of expo-modules-core can vary between Expo versions; if it doesn't compile,
  requesting permissions with `ActivityCompat` + `onRequestPermissionsResult`
  is plan B.
- Threads: `connect()` is blocking with OS timeout; it runs on the module's
  `io` pool, never on the main thread.
- On some manufacturers, classic discovery needs system-level location
  enabled in addition to the permission (warn in the UI if `startDiscovery`
  returns false repeatedly).
