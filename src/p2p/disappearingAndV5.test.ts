/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.46 — mensajes temporales (SQLite real) y v5 de punta a punta a través
 * del messenger.
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
import { P2PSession, makeEnvelope, type P2PEnvelope } from "./protocol";
import {
  generateEphemeral,
  generateIdentity,
  generateSigningKeypair,
  randomNonce,
  toHex,
  HANDSHAKE_NONCE_BYTES,
} from "./crypto";
import { encodePairingPayload } from "./pairing";
import {
  deleteExpiredMessages,
  getContactDisappear,
  getConversation,
  shouldAdoptDisappear,
  isValidDisappearSec,
} from "./store";
import { resetFeatureFlagsForTests, setFeatureEnabled } from "../config/featureFlags";
import { V5_HE_MARKER } from "./ratchet";

beforeEach(() => {
  resetSqliteBridge();
  useSqliteDevice("a");
  setTestSecureBackend(createMemorySecureBackend());
  resetFeatureFlagsForTests();
});

/** Un messenger con un contacto y sesión viva contra un peer simulado. */
async function setup(opts: { v5?: boolean; peerV5?: boolean; iAm?: "low" | "high" } = {}) {
  // 0.1.49: v5 viene activado de fábrica; cada prueba fija el valor que quiere.
  await setFeatureEnabled("p2p.ratchetV5", opts.v5 === true);
  const tA = new LoopbackTransport();
  const tB = new LoopbackTransport();
  const m = new NidoMessenger(tA);
  const { pkHex: myPk } = await m.ensureIdentity();
  let peerId = generateIdentity();
  // Rol fijo cuando el test lo pide (L = pk menor, H = pk mayor).
  while (
    (opts.iAm === "low" && !(myPk < toHex(peerId.publicKey))) ||
    (opts.iAm === "high" && !(myPk > toHex(peerId.publicKey)))
  ) {
    peerId = generateIdentity();
  }
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
  // El peer crea su sesión ANTES (los dos lados terminan el handshake a la vez).
  const peer = P2PSession.fromHandshakeV2(peerEph.secretKey, myEph.publicKey, myPk, peerNonce, myNonce);
  peer.expectRecipient(peerPk);
  peer.enableV5(opts.peerV5 === true);
  await m.completeHandshake(peerPk, myEph.secretKey, peerEph.publicKey, myNonce, peerNonce);
  await new Promise((r) => setTimeout(r, 20));
  let n = 0;
  const fromPeer = (type: "chat" | "session_confirm", payload: Record<string, unknown>) =>
    makeEnvelope(type, `peer-${n++}`, peerId.publicKey, myPk, payload);
  return { m, myPk, peerPk, peer, wire, fromPeer };
}

const tick = () => new Promise((r) => setTimeout(r, 20));

describe("mensajes temporales", () => {
  it("valores permitidos y regla de adopción por versión", () => {
    expect(isValidDisappearSec(0)).toBe(true);
    expect(isValidDisappearSec(3600)).toBe(true);
    expect(isValidDisappearSec(42)).toBe(false);
    expect(isValidDisappearSec("3600")).toBe(false);
    expect(shouldAdoptDisappear({ sec: 0, v: 1 }, { sec: 3600, v: 2 })).toBe(true);
    expect(shouldAdoptDisappear({ sec: 3600, v: 2 }, { sec: 0, v: 1 })).toBe(false);
    expect(shouldAdoptDisappear({ sec: 300, v: 2 }, { sec: 3600, v: 2 })).toBe(true);
    expect(shouldAdoptDisappear({ sec: 3600, v: 2 }, { sec: 300, v: 2 })).toBe(false);
  });

  it("el mensaje enviado lleva el temporizador y se borra al vencer", async () => {
    const s = await setup();
    const confirm = s.peer.pack(s.fromPeer("session_confirm", {}));
    await s.m.handleFrame(s.peerPk, confirm);
    await s.m.setDisappearingTimer(s.peerPk, 300);
    expect(await s.m.getDisappearingTimer(s.peerPk)).toBe(300);
    const { id } = await s.m.sendChat("Beto", "esto se borra");
    await tick();
    const env = s.peer.unpack(s.wire[s.wire.length - 1]);
    expect(env?.payload).toEqual({ text: "esto se borra", message_id: id, ttl: 300, ttl_v: 1 });
    const row = sqliteRaw().prepare("SELECT ttl_sec, expires_at FROM p2p_messages WHERE id = ?").get(id) as {
      ttl_sec: number;
      expires_at: number | null;
    };
    expect(row.ttl_sec).toBe(300);
    expect(row.expires_at).not.toBeNull();
    // Antes de vencer sigue; después, desaparece.
    expect(await deleteExpiredMessages(row.expires_at! - 1)).toBe(0);
    expect(await deleteExpiredMessages(row.expires_at!)).toBe(1);
    expect((await getConversation(s.peerPk)).find((x) => x.id === id)).toBeUndefined();
  });

  it("el recibido arranca al verlo, adopta el temporizador y no resucita tras borrarse", async () => {
    const s = await setup();
    const chat = s.fromPeer("chat", { text: "temporal", message_id: "msg-1", ttl: 3600, ttl_v: 1 });
    const frame = s.peer.pack(chat);
    await s.m.handleFrame(s.peerPk, frame);
    expect(await getContactDisappear(s.peerPk)).toEqual({ sec: 3600, v: 1 });
    let row = sqliteRaw().prepare("SELECT ttl_sec, expires_at FROM p2p_messages WHERE id = 'msg-1'").get() as {
      ttl_sec: number;
      expires_at: number | null;
    };
    expect(row.ttl_sec).toBe(3600);
    expect(row.expires_at).toBeNull(); // no visto todavía
    expect(await s.m.markConversationSeen(s.peerPk)).toBe(1);
    row = sqliteRaw().prepare("SELECT ttl_sec, expires_at FROM p2p_messages WHERE id = 'msg-1'").get() as typeof row;
    expect(row.expires_at).not.toBeNull();
    expect(await deleteExpiredMessages(row.expires_at!)).toBe(1);
    // El mismo mensaje reintentado por el peer (mismo message_id) no vuelve.
    const retry = s.peer.pack(s.fromPeer("chat", { text: "temporal", message_id: "msg-1", ttl: 3600, ttl_v: 1 }));
    await s.m.handleFrame(s.peerPk, retry);
    const again = sqliteRaw().prepare("SELECT count(*) AS n FROM p2p_messages WHERE id = 'msg-1'").get() as { n: number };
    expect(again.n).toBe(0);
  });

  it("un mensaje en camino con un temporizador viejo no deshace un cambio reciente", async () => {
    const s = await setup();
    await s.m.setDisappearingTimer(s.peerPk, 86_400); // v1
    await s.m.handleFrame(
      s.peerPk,
      s.peer.pack(s.fromPeer("chat", { text: "viejo", message_id: "old-1", ttl: 0, ttl_v: 0 })),
    );
    expect(await getContactDisappear(s.peerPk)).toEqual({ sec: 86_400, v: 1 });
    // Un peer viejo (sin ttl) tampoco cambia nada.
    await s.m.handleFrame(s.peerPk, s.peer.pack(s.fromPeer("chat", { text: "legacy", message_id: "old-2" })));
    expect(await getContactDisappear(s.peerPk)).toEqual({ sec: 86_400, v: 1 });
    // Valores fuera de la lista se ignoran.
    await s.m.handleFrame(
      s.peerPk,
      s.peer.pack(s.fromPeer("chat", { text: "raro", message_id: "old-3", ttl: 7, ttl_v: 9 })),
    );
    expect(await getContactDisappear(s.peerPk)).toEqual({ sec: 86_400, v: 1 });
  });
});

describe("v5 a través del messenger", () => {
  async function bootstrap(myV5: boolean, peerV5: boolean) {
    const s = await setup({ v5: myV5, peerV5 });
    // Mi session_confirm salió al terminar el handshake.
    const myConfirm = s.peer.unpack(s.wire[0]) as P2PEnvelope;
    expect(myConfirm.type).toBe("session_confirm");
    return { s, myConfirm };
  }

  it("con v5 en los dos lados, los chats van en v5", async () => {
    const { s, myConfirm } = await bootstrap(true, true);
    const iAmLow = s.myPk < s.peerPk;
    if (iAmLow) {
      expect((myConfirm.payload as { r5?: unknown }).r5).toBeDefined();
      // El peer (H) arrancó al leer mi oferta; su confirm ya va en v5.
      const peerConfirm = s.peer.pack(s.fromPeer("session_confirm", {}));
      expect(peerConfirm[4]).toBe(V5_HE_MARKER);
      await s.m.handleFrame(s.peerPk, peerConfirm);
    } else {
      expect(myConfirm.payload).toEqual({ r5cap: 1, cf2: 1 });
      // El peer (L) manda su oferta; yo arranco como H y mando el kick v5.
      const offer = s.peer.confirmPayload();
      const before = s.wire.length;
      await s.m.handleFrame(s.peerPk, s.peer.pack(s.fromPeer("session_confirm", offer)));
      await tick();
      expect(s.wire.length).toBeGreaterThan(before);
      const kick = s.wire[before];
      expect(kick[4]).toBe(V5_HE_MARKER);
      expect(s.peer.unpack(kick)?.type).toBe("session_confirm");
    }
    const { id } = await s.m.sendChat("Beto", "por v5");
    await tick();
    const last = s.wire[s.wire.length - 1];
    expect(last[4]).toBe(V5_HE_MARKER);
    const env = s.peer.unpack(last);
    expect(env?.payload).toEqual({ text: "por v5", message_id: id, ttl: 0, ttl_v: 0 });
    // Respuesta del peer en v5 (ya arrancó).
    const reply = s.peer.pack(s.fromPeer("chat", { text: "recibido", message_id: "r-1", ttl: 0, ttl_v: 0 }));
    expect(reply[4]).toBe(V5_HE_MARKER);
    const got = await s.m.handleFrame(s.peerPk, reply);
    expect(got?.payload).toEqual({ text: "recibido", message_id: "r-1", ttl: 0, ttl_v: 0 });
  });

  it("si solo un lado tiene v5, todo sigue en el modo clásico", async () => {
    for (const [mine, theirs] of [
      [true, false],
      [false, true],
    ] as const) {
      resetSqliteBridge();
      useSqliteDevice(`dev-${mine}`);
      setTestSecureBackend(createMemorySecureBackend());
      resetFeatureFlagsForTests();
      const { s } = await bootstrap(mine, theirs);
      const offer = s.peer.confirmPayload();
      await s.m.handleFrame(s.peerPk, s.peer.pack(s.fromPeer("session_confirm", offer)));
      await tick();
      const { id } = await s.m.sendChat("Beto", "clásico");
      await tick();
      const env = s.peer.unpack(s.wire[s.wire.length - 1]);
      expect(env?.payload).toEqual({ text: "clásico", message_id: id, ttl: 0, ttl_v: 0 });
      expect(s.peer.usesV5).toBe(false);
      const reply = s.peer.pack(s.fromPeer("chat", { text: "ok", message_id: `r-${mine}`, ttl: 0, ttl_v: 0 }));
      expect((await s.m.handleFrame(s.peerPk, reply))?.payload).toEqual({
        text: "ok",
        message_id: `r-${mine}`,
        ttl: 0,
        ttl_v: 0,
      });
    }
  });
});

describe("revisión independiente: cola de L y aviso de temporizador", () => {
  it("L retiene lo encolado hasta el primer v5 de H y lo manda ya en v5", async () => {
    const s = await setup({ v5: true, peerV5: true, iAm: "low" });
    const myConfirm = s.peer.unpack(s.wire[0]) as P2PEnvelope; // H acepta la oferta
    expect((myConfirm.payload as { r5?: unknown }).r5).toBeDefined();
    // Mensaje escrito sin conexión viva todavía: queda en cola.
    const { id, queued } = await s.m.sendChat("Beto", "escrito antes");
    expect(queued).toBe(true);
    // Confirm de H anunciando v5 (en el cable va ya en v5 porque H aceptó;
    // simulamos el caso habitual: su confirm clásico salió antes).
    const before = s.wire.length;
    void before;
    expect(s.peer.usesV5).toBe(true);
    const kick = s.peer.pack(s.fromPeer("session_confirm", { r5cap: 1 }));
    await s.m.handleFrame(s.peerPk, kick);
    await tick();
    const out = s.wire[s.wire.length - 1];
    expect(out[4]).toBe(V5_HE_MARKER);
    expect(s.peer.unpack(out)?.payload).toEqual({ text: "escrito antes", message_id: id, ttl: 0, ttl_v: 0 });
  });

  it("con el anuncio de H pero sin su v5, L espera y luego manda igual (respaldo)", async () => {
    const s = await setup({ v5: true, peerV5: false, iAm: "low" });
    s.peer.unpack(s.wire[0]);
    // Peer clásico que (por versión rara) anuncia r5cap pero nunca arranca.
    const fake = s.peer.pack(s.fromPeer("session_confirm", { r5cap: 1 }));
    await s.m.handleFrame(s.peerPk, fake);
    const { queued } = await s.m.sendChat("Beto", "tarde");
    expect(queued).toBe(true);
    await new Promise((r) => setTimeout(r, 5300));
    const env = s.peer.unpack(s.wire[s.wire.length - 1]);
    expect((env?.payload as { text?: string })?.text).toBe("tarde");
  }, 15_000);

  it("cambiar el temporizador avisa al contacto en cuanto hay conexión", async () => {
    const s = await setup();
    await s.m.setDisappearingTimer(s.peerPk, 3600);
    await s.m.handleFrame(s.peerPk, s.peer.pack(s.fromPeer("session_confirm", {})));
    await tick();
    const notices = s.wire
      .map((f) => s.peer.unpack(f))
      .filter((e): e is P2PEnvelope => !!e && e.type === "settings");
    expect(notices).toHaveLength(1);
    expect(notices[0].payload).toEqual({ disappear: { sec: 3600, v: 1 } });
    // El aviso del otro lado se adopta (versión mayor).
    await s.m.handleFrame(s.peerPk, s.peer.pack(s.fromPeer("settings" as never, { disappear: { sec: 300, v: 2 } })));
    expect(await getContactDisappear(s.peerPk)).toEqual({ sec: 300, v: 2 });
  });
});

void toHex;

describe("0.1.47: aviso de mensaje nuevo", () => {
  it("se avisa una vez por mensaje NUEVO, nunca por duplicados ni por avisos de ajustes", async () => {
    const s = await setup();
    const seen: string[] = [];
    s.m.onIncomingMessage = (_pk, type) => seen.push(type);
    const chat = s.fromPeer("chat", { text: "hola", message_id: "n-1", ttl: 0, ttl_v: 0 });
    await s.m.handleFrame(s.peerPk, s.peer.pack(chat));
    await s.m.handleFrame(s.peerPk, s.peer.pack(s.fromPeer("chat", { text: "hola", message_id: "n-1", ttl: 0, ttl_v: 0 })));
    await s.m.handleFrame(s.peerPk, s.peer.pack(s.fromPeer("settings" as never, { disappear: { sec: 300, v: 1 } })));
    expect(seen).toEqual(["chat"]);
  });
});
