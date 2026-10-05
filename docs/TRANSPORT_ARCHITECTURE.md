> **Language:** English · [Español](es/TRANSPORT_ARCHITECTURE.md)

# NIDO Transport Architecture — Specification (draft v0.1)

**Status:** design, do NOT implement yet.

**Principle:** the protocol never depends on Bluetooth — or on any
medium. `TRANSPORT ≠ TRUST`: a packet arriving over Bluetooth isn't
trustworthy because of it; one arriving via relay isn't less cryptographically
valid because of it. Transports move ciphertext; authentication and encryption
live in the upper layers (handshake + session + signed envelope).

---

## 1. Transport interface

```typescript
interface Transport {
  /** "bluetooth-rfcomm" | "lan-tcp" | "wifi-direct" | "internet-p2p" | "relay" | … */
  readonly id: string;
  /** Propiedades declaradas (ver §2). */
  readonly properties: TransportProperties;
  /** Descubrimiento de pares (según el medio). */
  discover(cb: (peer: DiscoveredPeer) => void): Promise<void>;
  /** Conecta con un par descubierto o por dirección. */
  connect(addr: TransportAddress): Promise<Connection>;
  /** Cierra todo. */
  close(): Promise<void>;
}

interface Connection {
  /** Envía bytes opacos (ya cifrados por la capa de sesión). */
  send(bytes: Uint8Array): Promise<void>;
  /** Recibe bytes opacos. */
  onReceive(cb: (bytes: Uint8Array) => void): void;
  close(): Promise<void>;
}

interface TransportProperties {
  reliability: "reliable-stream" | "unreliable-datagram";
  ordering: "ordered" | "unordered";
  mtu_bytes: number;          // el framing del protocolo lo respeta
  latency_class: "low" | "medium" | "high";
  requires_discovery: boolean;
  works_offline: boolean;     // sin Internet
}
```

Rules:

- The transport delivers **opaque bytes**. It doesn't parse, validate or decide.
- A `TASK_REQUEST` is **identical** regardless of the medium it travels.
- The protocol requires of the session layer (not the transport):
  per-frame confidentiality + authenticity + anti-replay.
- If the transport is an unreliable datagram, the session/protocol layer
  adds retransmission; the envelope format doesn't change.

---

## 2. Transports

| Transport | Status | Properties |
|---|---|---|
| Bluetooth RFCOMM | implemented (Kotlin) | reliable stream, ~256 KiB MTU per frame, offline |
| LAN (TCP + mDNS) | future | reliable stream, offline (local network) |
| Wi-Fi Direct | future | reliable stream, offline |
| Direct Internet P2P | future | e.g. QUIC with identity-based addressing; online |
| Encrypted relay | future | optional store-and-forward; sees ciphertext only |
| Futures (dedicated hardware…) | reserved | the interface doesn't change |

**Attempt order** (future remote transport): direct first
(Bluetooth/LAN/Wi-Fi Direct/Internet P2P); relay only if there's no direct
route. The relay is a *routing hint*, not part of the identity.

---

## 3. End-to-end security and the relay

- Everything leaving the device toward another NIDO is encrypted by the
  **session** (AEAD, ephemeral keys from the authenticated handshake) and signed at
  envelope level (see `AGENT_PROTOCOL.md`).
- The future relay **sees ciphertext only**: it never holds identity private keys,
  session plaintext, agent memory, tool permissions or decryption keys.
- **The relay can disappear or change without**: changing the NIDO identity,
  changing capabilities, losing memory or re-pairing contacts.
  The relay's address is routing configuration, revocable by the user.
- A malicious relay can at most: drop, delay or duplicate
  (covered by idempotency and duplicates, `AGENT_PROTOCOL.md` §9). It cannot
  read, forge (signature) or escalate privileges.

---

## 4. Where each responsibility lives

- **Transport:** move bytes, discover peers, report availability.
- **Session (handshake):** authenticate devices, establish keys,
  encrypt frames, anti-replay.
- **Agent protocol:** envelopes, tasks, idempotency, expiry,
  retries, offline queue.
- **Policy Engine:** authorization.

The **offline queue** lives in the protocol/agent layer (encrypted persistent
outbox), not in the transport: a task survives disconnections, transport
changes and even restarts. The transport only reports `available/unavailable`.

---

## 5. Privacy-preserving peer discovery

- Bluetooth: classic discovery with a generic name (not "Arsrs's NIDO").
- LAN: mDNS with a rotating ephemeral identifier, not the stable identity.
- The first real contact (identity↔identity) happens over **QR**
  (see `AGENT_PROTOCOL.md` §2) or via introduction by a mutual contact —
  never by broadcasting the identity key.
- A medium observer learns at most: "there's a device speaking a protocol",
  not who it is or who it talks to (relay addressing uses identity hashes,
  not plaintext keys).

---

## 6. Open questions

1. Should the relay be store-and-forward (mailbox) or hot forwarding only?
   (Mailbox helps protocol §9; it increases the relay's surface even while
   remaining ciphertext-only.)
2. Internet P2P addressing without a central server: DHT, contact-based
   introduction, or both? (Undecided: don't build complex infrastructure yet.)
3. How does the discovery ephemeral identifier rotate to avoid radio tracking?
   (Interval, entropy, user synchronization.)
4. Size limits per transport and session-level fragmentation:
   minimum guaranteed common MTU?
