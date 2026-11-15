/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * t12Messenger.test.ts — Tanda T-12 (red y relay I) · 0.1.99.
 *
 * Sondas escritas ANTES de las curas y regresiones permanentes de:
 * - M-24 (capas 2 y 3): el receptor no tenía ningún tope sobre lo que un
 *   par autenticado le puede hacer PERSISTIR: texto de chat sin el tope
 *   que el propio envío aplica (4.000) y volumen guardado sin cuota.
 * - M-26: el QR no anunciaba v5; la capacidad se aprendía en la primera
 *   conexión, justo la que un atacante puede degradar. La cap «r5» en el
 *   QR la fija al nacer el contacto (cobertura: QR 0.1.99 escaneado por
 *   un 0.1.99).
 * - m-44: el token de delegación va atado a la sesión viva (curado por P7);
 *   aquí se prueba el eslabón que NidoScreen cablea: Messenger.getSessionTag
 *   devuelve el tag de la sesión viva con ese par, y solo de esa.
 * - m-47: el temporizador lo elegía el payload del emisor: con la
 *   conversación a 300 s, un mensaje entrante con ttl 0 se guardaba SIN
 *   caducidad y uno con ttl mayor alargaba su vida; la adopción desde el
 *   payload de chat podía además alargar el de la conversación. El canal
 *   deliberado de cambio es el frame `settings`, que no se toca.
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

import { resetSqliteBridge, useSqliteDevice, sqliteRaw } from "./sqliteTestBridge";
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
import { encodePairingPayload, PAIRING_CAPS } from "./pairing";
import { getContactDisappear, isContactV5Capable } from "./store";
import { resetFeatureFlagsForTests, setFeatureEnabled } from "../config/featureFlags";

beforeEach(() => {
  resetSqliteBridge();
  useSqliteDevice("a");
  setTestSecureBackend(createMemorySecureBackend());
  resetFeatureFlagsForTests();
});

const tick = () => new Promise((r) => setTimeout(r, 20));

/** Un messenger con un contacto y sesión viva contra un peer simulado. */
async function setup() {
  await setFeatureEnabled("p2p.ratchetV5", false);
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
  await m.completeHandshake(peerPk, myEph.secretKey, peerEph.publicKey, myNonce, peerNonce);
  await tick();
  let n = 0;
  const fromPeer = (type: "chat" | "session_confirm" | "settings", payload: Record<string, unknown>) =>
    makeEnvelope(type, `peer-${n++}`, peerId.publicKey, myPk, payload);
  return { m, myPk, peerPk, peer, wire, fromPeer };
}

function rowOf(id: string): { ttl_sec: number | null } | undefined {
  return sqliteRaw().prepare("SELECT ttl_sec FROM p2p_messages WHERE id = ?").get(id) as
    | { ttl_sec: number | null }
    | undefined;
}
function countRows(): number {
  return (sqliteRaw().prepare("SELECT count(*) AS n FROM p2p_messages").get() as { n: number }).n;
}

describe("T-12 · M-26: la capacidad v5 nace con el QR", () => {
  function qrWithCaps(name: string, pk: Uint8Array, spk: Uint8Array, caps: string[]): string {
    return (
      "NIDO1:" +
      JSON.stringify({ v: 2, app: "nido", name, pk: toHex(pk), spk: toHex(spk), caps })
    );
  }

  it("PAIRING_CAPS anuncia r5 (el canal que el atacante no puede quitar)", () => {
    expect(PAIRING_CAPS).toContain("r5");
  });

  it("un QR 0.1.99 con r5 deja el contacto v5_capable al nacer, sin conexión previa", async () => {
    await setFeatureEnabled("p2p.ratchetV5", false);
    const m = new NidoMessenger(new LoopbackTransport());
    await m.ensureIdentity();
    const peerId = generateIdentity();
    const peerSign = generateSigningKeypair();
    await m.pairWith(qrWithCaps("Beto", peerId.publicKey, peerSign.publicKey, ["c4", "cf2", "r5"]));
    const contact = (await m.contacts())[0];
    expect(await isContactV5Capable(contact.pkHex)).toBe(true);
  });

  it("un QR sin r5 (versión anterior) NO marca v5_capable", async () => {
    await setFeatureEnabled("p2p.ratchetV5", false);
    const m = new NidoMessenger(new LoopbackTransport());
    await m.ensureIdentity();
    const peerId = generateIdentity();
    const peerSign = generateSigningKeypair();
    await m.pairWith(qrWithCaps("Beto", peerId.publicKey, peerSign.publicKey, ["c4", "cf2"]));
    const contact = (await m.contacts())[0];
    expect(await isContactV5Capable(contact.pkHex)).toBe(false);
  });
});

describe("T-12 · M-24 capas 2 y 3: lo que un par puede hacerte persistir", () => {
  it("un chat entrante por encima del tope del propio envío (4.000) se descarta y no se guarda", async () => {
    const s = await setup();
    const big = "x".repeat(4001);
    await s.m.handleFrame(s.peerPk, s.peer.pack(s.fromPeer("chat", { text: big, message_id: "t12-big-1" })));
    expect(rowOf("t12-big-1")).toBeUndefined();
    // Control: justo en el tope sí entra.
    const ok = "x".repeat(4000);
    await s.m.handleFrame(s.peerPk, s.peer.pack(s.fromPeer("chat", { text: ok, message_id: "t12-big-2" })));
    expect(rowOf("t12-big-2")).toBeDefined();
  });

  it("la cuota de volumen persistido por par corta la inundación de mensajes guardados", async () => {
    const quota = await import("./inboundQuota").catch(() => null);
    expect(quota, "inboundQuota debe existir (M-24)").not.toBeNull();
    quota!.setInboundQuotaLimitsForTests({ maxPersistBytesPerPeer: 10_000 });
    quota!.inboundQuota.clear();
    try {
      const s = await setup();
      const text = "y".repeat(4000);
      for (let i = 0; i < 4; i++) {
        await s.m.handleFrame(
          s.peerPk,
          s.peer.pack(s.fromPeer("chat", { text, message_id: `t12-vol-${i}` })),
        );
      }
      // 2 mensajes × 4.000 B = 8.000 B guardados; el tercero ya excede la cuota.
      expect(countRows()).toBe(2);
      expect(quota!.inboundQuota.snapshot().persistDropped).toBeGreaterThanOrEqual(1);
    } finally {
      quota!.resetInboundQuotaForTests();
    }
  });
});

describe("T-12 · m-47: el temporizador de la conversación manda sobre el payload", () => {
  it("con la conversación a 300 s, un entrante con ttl 0 se guarda CON caducidad de 300 s", async () => {
    const s = await setup();
    await s.m.setDisappearingTimer(s.peerPk, 300);
    await s.m.handleFrame(
      s.peerPk,
      s.peer.pack(s.fromPeer("chat", { text: "sin ttl", message_id: "t12-ttl-0", ttl: 0, ttl_v: 1 })),
    );
    expect(rowOf("t12-ttl-0")?.ttl_sec).toBe(300);
  });

  it("con la conversación a 300 s, un entrante con ttl 3600 no alarga su vida ni la de la conversación", async () => {
    const s = await setup();
    await s.m.setDisappearingTimer(s.peerPk, 300); // v1
    await s.m.handleFrame(
      s.peerPk,
      s.peer.pack(s.fromPeer("chat", { text: "largo", message_id: "t12-ttl-big", ttl: 3600, ttl_v: 1 })),
    );
    expect(rowOf("t12-ttl-big")?.ttl_sec).toBe(300);
    expect(await getContactDisappear(s.peerPk)).toEqual({ sec: 300, v: 1 });
  });

  it("el payload SÍ puede acortar la vida del mensaje (ttl menor que el de la conversación)", async () => {
    const s = await setup();
    await s.m.setDisappearingTimer(s.peerPk, 3600);
    await s.m.handleFrame(
      s.peerPk,
      s.peer.pack(s.fromPeer("chat", { text: "corto", message_id: "t12-ttl-short", ttl: 300, ttl_v: 1 })),
    );
    expect(rowOf("t12-ttl-short")?.ttl_sec).toBe(300);
  });

  it("el canal deliberado (frame settings) sigue pudiendo cambiar el temporizador", async () => {
    const s = await setup();
    await s.m.setDisappearingTimer(s.peerPk, 300); // v1
    await s.m.handleFrame(
      s.peerPk,
      s.peer.pack(s.fromPeer("settings", { disappear: { sec: 3600, v: 2 } })),
    );
    expect(await getContactDisappear(s.peerPk)).toEqual({ sec: 3600, v: 2 });
  });
});

describe("T-12 · m-44: el eslabón que NidoScreen cablea para el token de delegación", () => {
  it("getSessionTag devuelve el tag de la sesión viva con ese par, y de ningún otro", async () => {
    const s = await setup();
    // La sesión se promociona a viva con el primer frame autenticado del par.
    await s.m.handleFrame(s.peerPk, s.peer.pack(s.fromPeer("session_confirm", {})));
    const tag = s.m.getSessionTag(s.peerPk);
    expect(typeof tag).toBe("string");
    expect(tag).toMatch(/^[0-9a-f]{128}$/);
    expect(tag).toBe(s.m.getSessionTag(s.peerPk));
    const stranger = toHex(generateIdentity().publicKey);
    expect(s.m.getSessionTag(stranger)).toBeNull();
  });
});
