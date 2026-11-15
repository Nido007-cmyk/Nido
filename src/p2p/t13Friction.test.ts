/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * t13Friction.test.ts — Tanda T-13 (red y relay II) · 0.1.99.
 *
 * Sondas escritas ANTES de las curas (rojo por la causa exacta de cada
 * asiento) y regresiones permanentes de:
 * - M-23 (puerta de delegación): proponer una negociación a un contacto
 *   con `verified = false` salía sin más. La fricción aprobada exige el
 *   cotejo de huella antes de delegar: proposeTo devuelve
 *   `contact_not_verified` y no envía nada.
 * - m-55: cada mensaje entrante publicaba un aviso, sin límite por par:
 *   20 mensajes en segundos = 20 avisos. La cura pone cuota en
 *   signalIncoming: un aviso por par y ventana (30 s en producción).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import nacl from "tweetnacl";

// ------------------------------------------------------------ M-23 proposeTo

const gate = vi.hoisted(() => ({
  verifiedByPk: new Map<string, boolean>(),
  nullPks: new Set<string>(),
  signKp: null as unknown as nacl.SignKeyPair,
}));
gate.signKp = nacl.sign.keyPair();

vi.mock("./store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./store")>();
  return {
    ...actual,
    getSigningKeypair: async () => gate.signKp,
    findContactByPk: async (pk: string) => {
      const key = pk.toLowerCase();
      if (gate.nullPks.has(key)) return null;
      if (gate.verifiedByPk.has(key)) {
        return {
          pkHex: key,
          name: "Contacto",
          verified: gate.verifiedByPk.get(key)!,
          sigPkHex: "cd".repeat(32),
          supersededBy: null,
          supersededAt: null,
        };
      }
      // Fuera del mapa de la puerta, el store real (el arnés del messenger
      // empareja contactos de verdad y los busca por esta vía).
      return actual.findContactByPk(pk);
    },
  };
});

import { negotiationService } from "./negotiationService";
import { toHex } from "./crypto";

describe("T-13 · M-23 puerta de cotejo en proposeTo", () => {
  const mePk = toHex(gate.signKp.publicKey);
  const unverifiedPk = "aa".repeat(32);
  const verifiedPk = "bb".repeat(32);
  const unknownPk = "cc".repeat(32);
  let sent: Array<{ peer: string; kind: string }>;

  beforeEach(() => {
    gate.verifiedByPk.clear();
    gate.nullPks.clear();
    gate.verifiedByPk.set(unverifiedPk, false);
    gate.verifiedByPk.set(verifiedPk, true);
    gate.nullPks.add(unknownPk);
    sent = [];
    negotiationService.setLocalIdentity(mePk);
    negotiationService.setSendFunction(async (peer: string, kind: string) => {
      sent.push({ peer, kind });
      return true;
    });
  });

  it("contacto sin verificar: la propuesta NO sale y la causa es contact_not_verified", async () => {
    const r = await negotiationService.proposeTo(unverifiedPk, "revisar el parte");
    expect(r.sent).toBe(false);
    expect(r.reason).toBe("contact_not_verified");
    expect(sent).toHaveLength(0);
  });

  it("contacto verificado: la propuesta sale (control)", async () => {
    const r = await negotiationService.proposeTo(verifiedPk, "revisar el parte");
    expect(r.sent).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("destinatario que no es contacto: comportamiento de siempre (control)", async () => {
    const r = await negotiationService.proposeTo(unknownPk, "revisar el parte");
    expect(r.sent).toBe(true);
    expect(sent).toHaveLength(1);
  });
});

// ------------------------------------------------------------ m-55 cuota de avisos

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
import { NidoMessenger, setIncomingSignalWindowForTests } from "./messenger";
import { LoopbackTransport } from "./transport";
import { P2PSession, makeEnvelope } from "./protocol";
import {
  generateEphemeral,
  generateIdentity,
  generateSigningKeypair,
  randomNonce,
  HANDSHAKE_NONCE_BYTES,
} from "./crypto";
import { encodePairingPayload } from "./pairing";
import { getConversation } from "./store";
import { resetFeatureFlagsForTests } from "../config/featureFlags";

async function setupMessenger() {
  const tA = new LoopbackTransport();
  const tB = new LoopbackTransport();
  const m = new NidoMessenger(tA);
  const { pkHex: myPk } = await m.ensureIdentity();
  const peerId = generateIdentity();
  const peerSign = generateSigningKeypair();
  await m.pairWith(encodePairingPayload("Beto", peerId.publicKey, peerSign.publicKey));
  const peerPk = (await m.contacts())[0].pkHex;
  tA.linkTo(
    tB,
    { pkHex: myPk, alias: "yo", transport: "bluetooth" },
    { pkHex: peerPk, alias: "beto", transport: "bluetooth" },
  );
  await tB.startDiscovery({ onFrame: () => {} });
  await tA.connect("beto");
  const myEph = m.newHandshakeEphemeral();
  const peerEph = generateEphemeral();
  const myNonce = randomNonce(HANDSHAKE_NONCE_BYTES);
  const peerNonce = randomNonce(HANDSHAKE_NONCE_BYTES);
  const peer = P2PSession.fromHandshakeV2(peerEph.secretKey, myEph.publicKey, myPk, peerNonce, myNonce);
  peer.expectRecipient(peerPk);
  await m.completeHandshake(peerPk, myEph.secretKey, peerEph.publicKey, myNonce, peerNonce);
  await new Promise((r) => setTimeout(r, 20));
  let n = 0;
  const fromPeer = (payload: Record<string, unknown>) =>
    makeEnvelope("chat", `peer-${n++}`, peerId.publicKey, myPk, payload);
  return { m, peerPk, peer, fromPeer };
}

describe("T-13 · m-55 un aviso por par y ventana, no uno por mensaje", () => {
  beforeEach(() => {
    resetSqliteBridge();
    useSqliteDevice("a");
    setTestSecureBackend(createMemorySecureBackend());
    resetFeatureFlagsForTests();
    setIncomingSignalWindowForTests(800);
  });

  it("20 mensajes seguidos del mismo par publican UN aviso; pasado el plazo, el siguiente vuelve a avisar", async () => {
    const s = await setupMessenger();
    const seen: string[] = [];
    s.m.onIncomingMessage = (_pk, type) => seen.push(type);
    for (let i = 0; i < 20; i++) {
      const chat = s.fromPeer({ text: `mensaje ${i}`, message_id: `burst-${i}`, ttl: 0, ttl_v: 0 });
      await s.m.handleFrame(s.peerPk, s.peer.pack(chat));
    }
    expect(seen).toHaveLength(1);
    // Los mensajes SÍ se guardaron todos: la cuota es del aviso, no de la recepción.
    const conv = await getConversation(s.peerPk);
    expect(conv.filter((msg) => msg.dir === "in")).toHaveLength(20);
    await new Promise((r) => setTimeout(r, 900));
    const late = s.fromPeer({ text: "otro rato", message_id: "burst-late", ttl: 0, ttl_v: 0 });
    await s.m.handleFrame(s.peerPk, s.peer.pack(late));
    expect(seen).toHaveLength(2);
  });
});
