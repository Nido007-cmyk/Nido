/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * H-3: al activarse el temporizador de una conversación (por la vía propia
 * o por la adoptada), los sobres propios ya sellados de esa conversación
 * dejan de viajar desde este teléfono. Al desactivarse no se retira nada,
 * y ni los mensajes ya entregados ni las conversaciones sin fila en la
 * bandeja de salida se tocan.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});
vi.mock("../agent/memory/memoryStore", async () => {
  const { sqliteMemoryStoreModule } = await import("./sqliteTestBridge");
  return sqliteMemoryStoreModule();
});
vi.mock("expo-sqlite", () => ({}));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));

import { resetSqliteBridge, useSqliteDevice } from "./sqliteTestBridge";
import { createMemorySecureBackend, setTestSecureBackend } from "../privacy/keyManager";
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
import { getIdentity, getSigningKeypair, saveMessage } from "./store";
import { resetFeatureFlagsForTests, setFeatureEnabled } from "../config/featureFlags";
import * as relay from "./relay/relayService";

let kv: relay.RelayKv;

beforeEach(async () => {
  resetSqliteBridge();
  useSqliteDevice("a");
  setTestSecureBackend(createMemorySecureBackend());
  resetFeatureFlagsForTests();
  await setFeatureEnabled("p2p.relay", true);
  kv = relay.memoryKv();
  relay.setRelayKvForTests(() => kv);
});

/** Un messenger con un contacto; el peer también tiene claves para el relevo. */
async function setup() {
  const tA = new LoopbackTransport();
  const tB = new LoopbackTransport();
  const m = new NidoMessenger(tA);
  const { pkHex: myPk } = await m.ensureIdentity();
  const peerId = generateIdentity();
  const peerSign = generateSigningKeypair();
  await m.pairWith(encodePairingPayload("Beto", peerId.publicKey, peerSign.publicKey));
  const contact = (await m.contacts())[0];
  const peerPk = contact.pkHex;
  tA.linkTo(
    tB,
    { pkHex: myPk, alias: "yo", transport: "bluetooth" },
    { pkHex: peerPk, alias: "beto", transport: "bluetooth" },
  );
  const wire: Uint8Array[] = [];
  await tB.startDiscovery({ onFrame: (_pk, frame) => wire.push(frame) });
  await tA.connect("beto");
  const myEph = m.newHandshakeEphemeral();
  const peerEph = generateEphemeral();
  const myNonce = randomNonce(HANDSHAKE_NONCE_BYTES);
  const peerNonce = randomNonce(HANDSHAKE_NONCE_BYTES);
  const peer = P2PSession.fromHandshakeV2(peerEph.secretKey, myEph.publicKey, myPk, peerNonce, myNonce);
  peer.expectRecipient(peerPk);
  peer.enableV5(false);
  await m.completeHandshake(peerPk, myEph.secretKey, peerEph.publicKey, myNonce, peerNonce);
  await new Promise((r) => setTimeout(r, 20));
  let n = 0;
  const fromPeer = (type: "chat", payload: Record<string, unknown>) =>
    makeEnvelope(type, `peer-${n++}`, peerId.publicKey, myPk, payload);

  const signing = await getSigningKeypair();
  const idn = await getIdentity();
  const me: relay.Me = { pkHex: myPk.toLowerCase(), signSecretKey: signing.secretKey, idSecretKey: idn!.secretKey };
  const peerMe: relay.Me = {
    pkHex: toHex(peerId.publicKey).toLowerCase(),
    signSecretKey: peerSign.secretKey,
    idSecretKey: peerId.secretKey,
  };
  // El saludo del peer: su clave de buzón queda en mi estado del relevo.
  const now = Date.now();
  const hp = await relay.helloPayload(peerMe, now);
  const book = (pk: string) => (pk.toLowerCase() === peerPk.toLowerCase() ? toHex(peerSign.publicKey).toLowerCase() : null);
  await relay.receive(peerPk, hp, me, book, now);
  return { m, myPk, peerPk, peer, wire, fromPeer, me, now };
}

/** Sella un mensaje mío a Beto y (salvo que se diga lo contrario) deja su fila en la bandeja. */
async function sealMine(
  s: Awaited<ReturnType<typeof setup>>,
  id: string,
  status?: string,
): Promise<void> {
  expect(await relay.sealOwn(s.me, s.peerPk, id, "chat", "hola", s.now)).toBe(true);
  if (status) {
    await saveMessage({ id, dir: "out", peerPk: s.peerPk, type: "chat", text: "hola", status, ts: s.now });
  }
}

describe("el temporizador retira lo ya sellado (H-3)", () => {
  it("vía propia: en cola y enviados sin acuse se retiran; entregados y sin fila, no", async () => {
    const s = await setup();
    await sealMine(s, "m-cola", "queued");
    await sealMine(s, "m-enviado", "sent");
    await sealMine(s, "m-entregado", "delivered");
    await sealMine(s, "m-sin-fila");
    expect((await relay.relayUsage()).envelopes).toBe(4);
    await s.m.setDisappearingTimer(s.peerPk, 300);
    expect((await relay.relayUsage()).envelopes).toBe(2);
  });

  it("al desactivarse (0) no se retira nada", async () => {
    const s = await setup();
    await sealMine(s, "m-cola", "queued");
    expect((await relay.relayUsage()).envelopes).toBe(1);
    await s.m.setDisappearingTimer(s.peerPk, 0);
    expect((await relay.relayUsage()).envelopes).toBe(1);
  });

  it("vía adoptada: el temporizador que trae un mensaje del contacto también retira", async () => {
    const s = await setup();
    await sealMine(s, "m-cola", "queued");
    await sealMine(s, "m-sin-fila");
    expect((await relay.relayUsage()).envelopes).toBe(2);
    const frame = s.peer.pack(s.fromPeer("chat", { text: "temporal", message_id: "in-1", ttl: 3600, ttl_v: 1 }));
    await s.m.handleFrame(s.peerPk, frame);
    expect(await s.m.getDisappearingTimer(s.peerPk)).toBe(3600);
    expect((await relay.relayUsage()).envelopes).toBe(1);
  });
});
