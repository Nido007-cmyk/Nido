/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMemorySecureBackend,
  setTestSecureBackend,
} from "../privacy/keyManager";
import { resetP2PMem, type P2PMem } from "./p2pMemoryMock";

const mem: P2PMem = vi.hoisted(() => ({
  identity: [],
  contacts: [],
  messages: [],
  ackLog: [],
  lateAck: [],
  nonceCache: [],
  identityArchive: [],
  repairIntents: [],
  bootRepairLog: [],
}));

vi.mock("../agent/memory/memoryStore", async () => {
  const { p2pMemoryStoreModule } = await import("./p2pMemoryMock");
  return p2pMemoryStoreModule(mem);
});

import { NidoMessenger } from "./messenger";
import { LoopbackTransport } from "./transport";
import { P2PSession, makeEnvelope } from "./protocol";
import {
  generateEphemeral,
  generateIdentity,
  generateSigningKeypair,
  randomNonce,
  toHex,
  HANDSHAKE_NONCE_BYTES,
} from "./crypto";
import { encodePairingPayload } from "./pairing";

beforeEach(() => {
  resetP2PMem(mem);
  setTestSecureBackend(createMemorySecureBackend());
});

describe("N6 original finding — 'sent' is not delivery", () => {
  it("PROOF OF BUG: message marked 'sent' while the peer never received/persisted it", async () => {
    const tA = new LoopbackTransport();
    // NOTE: the transport accepts frames and reports success, but NO peer
    // messenger ever processes them — no receive, no persist, no ACK.
    // (In production terms: frames left the local Bluetooth stack and were
    // then blackholed — exactly the R4-documented relay-then-drop residual.)
    const captured: Uint8Array[] = [];
    const blackhole = {
      available: true,
      sendFrame: async (_pk: string, frame: Uint8Array) => {
        captured.push(frame); // bytes left the stack; nothing happens with them
      },
      startDiscovery: async () => {},
      stopDiscovery: async () => {},
      connect: async () => ({ pkHex: "", alias: "", transport: "bluetooth" as const }),
    };

    const m = new NidoMessenger(blackhole as unknown as LoopbackTransport);
    const { pkHex: myPk } = await m.ensureIdentity();
    const peerId = generateIdentity();
    await m.pairWith(encodePairingPayload("Beto", peerId.publicKey, generateSigningKeypair().publicKey));
    void tA;

    const myEph = m.newHandshakeEphemeral();
    const peerEph = generateEphemeral();
    const myNonce = randomNonce(HANDSHAKE_NONCE_BYTES);
    const peerNonce = randomNonce(HANDSHAKE_NONCE_BYTES);
    await m.completeHandshake(toHex(peerId.publicKey), myEph.secretKey, peerEph.publicKey, myNonce, peerNonce);
    const peerSession = P2PSession.fromHandshakeV2(peerEph.secretKey, myEph.publicKey, myPk, peerNonce, myNonce);
    await m.handleFrame(
      toHex(peerId.publicKey),
      peerSession.pack(makeEnvelope("session_confirm", "confirm-1", peerId.publicKey, myPk, {})),
    );

    const { id, queued } = await m.sendChat("beto", "mensaje que Beto jamás recibirá");
    expect(queued).toBe(false); // handed to the transport
    expect(captured.length).toBeGreaterThan(0);

    // THE BUG: the row is "sent" — the exact state the UI renders with
    // " · ✓" (nido.sentSuffix) — while the peer provably never saw it.
    const row = mem.messages.find((x) => x.id === id);
    expect(row?.status).toBe("sent");

    // Prove no peer ever processed it: no inbox row exists anywhere, and no
    // acknowledgement of any kind was ever produced.
    expect(mem.messages.filter((x) => x.dir === "in")).toHaveLength(0);
  });
});
