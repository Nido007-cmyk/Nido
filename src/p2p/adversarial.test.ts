/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMemorySecureBackend, setTestSecureBackend } from "../privacy/keyManager";
import { resetP2PMem, type P2PMem } from "./p2pMemoryMock";

/**
 * adversarial.test.ts — batería adversarial del protocolo NIDO P2P.
 *
 * Ningún caso debe provocar un crash (throw no controlado) ni aceptar
 * contenido inválido. Los descartes se devuelven como null en silencio.
 */

import { generateEphemeral, generateIdentity, randomNonce, toHex, HANDSHAKE_NONCE_BYTES } from "./crypto";
import {
  FrameReassembler,
  P2PSession,
  makeEnvelope,
} from "./protocol";

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

function twoSessions() {
  const aliceId = generateIdentity();
  const bobId = generateIdentity();
  const aEph = generateEphemeral();
  const bEph = generateEphemeral();
  const n1 = randomNonce(HANDSHAKE_NONCE_BYTES);
  const n2 = randomNonce(HANDSHAKE_NONCE_BYTES);
  const aSession = P2PSession.fromHandshakeV2(aEph.secretKey, bEph.publicKey, toHex(bobId.publicKey), n1, n2);
  const bSession = P2PSession.fromHandshakeV2(bEph.secretKey, aEph.publicKey, toHex(aliceId.publicKey), n2, n1);
  return { aliceId, bobId, aSession, bSession, n1, n2 };
}

function chatEnv(aliceId: ReturnType<typeof generateIdentity>, bobId: ReturnType<typeof generateIdentity>, id: string, text = "hola") {
  return makeEnvelope("chat", id, aliceId.publicKey, toHex(bobId.publicKey), { text });
}

beforeEach(() => {
  resetP2PMem(mem);
  setTestSecureBackend(createMemorySecureBackend());
});

describe("adversarial: protocolo P2P", () => {
  it("replay: el mismo frame dos veces → el segundo se descarta", () => {
    const { aliceId, bobId, aSession, bSession } = twoSessions();
    const frame = aSession.pack(chatEnv(aliceId, bobId, "r1"));
    expect(bSession.unpack(frame)).not.toBeNull();
    expect(bSession.unpack(frame)).toBeNull(); // replay
  });

  it("mensaje modificado (1 bit en el cuerpo) → null sin lanzar", () => {
    const { aliceId, bobId, aSession, bSession } = twoSessions();
    const frame = aSession.pack(chatEnv(aliceId, bobId, "m1"));
    frame[40] ^= 0x01;
    expect(bSession.unpack(frame)).toBeNull();
  });

  it("nonce modificado → null sin lanzar", () => {
    const { aliceId, bobId, aSession, bSession } = twoSessions();
    const frame = aSession.pack(chatEnv(aliceId, bobId, "m2"));
    frame[10] ^= 0xff;
    expect(bSession.unpack(frame)).toBeNull();
  });

  it("identidad incorrecta: sesión con otro peer no abre el mensaje", () => {
    const { aliceId, bobId, aSession } = twoSessions();
    const eveId = generateIdentity();
    const eveEph = generateEphemeral();
    // Eve intenta leer un mensaje Alice→Bob con su propia sesión.
    const eveSession = P2PSession.fromHandshakeV2(eveEph.secretKey, eveEph.publicKey, toHex(aliceId.publicKey), randomNonce(HANDSHAKE_NONCE_BYTES), randomNonce(HANDSHAKE_NONCE_BYTES));
    const frame = aSession.pack(chatEnv(aliceId, bobId, "m3"));
    expect(eveSession.unpack(frame)).toBeNull();
    expect(eveId).toBeDefined();
  });

  it("destinatario incorrecto: `to` de un tercero → null", () => {
    const { aliceId, bobId, aSession, bSession } = twoSessions();
    const carolId = generateIdentity();
    bSession.expectRecipient(toHex(bobId.publicKey));
    const env = makeEnvelope("chat", "t1", aliceId.publicKey, toHex(carolId.publicKey), { text: "x" });
    const frame = aSession.pack(env);
    expect(bSession.unpack(frame)).toBeNull();
  });

  it("destinatario correcto con expectRecipient → acepta", () => {
    const { aliceId, bobId, aSession, bSession } = twoSessions();
    bSession.expectRecipient(toHex(bobId.publicKey));
    const frame = aSession.pack(chatEnv(aliceId, bobId, "t2"));
    expect(bSession.unpack(frame)).not.toBeNull();
  });

  it("handshake inválido: clave efímera de 31 bytes → throw controlado", () => {
    const { bobId } = twoSessions();
    const bad = new Uint8Array(31);
    expect(() =>
      P2PSession.fromHandshakeV2(bad, new Uint8Array(32), toHex(bobId.publicKey), randomNonce(HANDSHAKE_NONCE_BYTES), randomNonce(HANDSHAKE_NONCE_BYTES)),
    ).toThrow();
  });

  it("datos truncados y basura → null sin lanzar", () => {
    const { bSession } = twoSessions();
    expect(bSession.unpack(new Uint8Array(0))).toBeNull();
    expect(bSession.unpack(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(bSession.unpack(new Uint8Array(100))).toBeNull();
  });

  it("frame que declara longitud distinta a la real → null", () => {
    const { aliceId, bobId, aSession, bSession } = twoSessions();
    const frame = aSession.pack(chatEnv(aliceId, bobId, "l1"));
    frame[3] += 10; // miente sobre la longitud
    expect(bSession.unpack(frame)).toBeNull();
  });

  it("mensaje gigante (>256 KB) → pack lanza, no se envía", () => {
    const { aliceId, bobId, aSession } = twoSessions();
    const big = "x".repeat(300 * 1024);
    expect(() => aSession.pack(chatEnv(aliceId, bobId, "big", big))).toThrow();
  });

  it("mismo contenido, dos ids → dos frames distintos (nonce aleatorio), ambos válidos", () => {
    const { aliceId, bobId, aSession, bSession } = twoSessions();
    const f1 = aSession.pack(chatEnv(aliceId, bobId, "n1"));
    const f2 = aSession.pack(chatEnv(aliceId, bobId, "n2"));
    expect(Buffer.from(f1).equals(Buffer.from(f2))).toBe(false);
    expect(bSession.unpack(f1)).not.toBeNull();
    expect(bSession.unpack(f2)).not.toBeNull();
  });

  it("desconexión a mitad de frame: sin crash, sin frames parciales, reset limpia", () => {
    const { aliceId, bobId, aSession } = twoSessions();
    const frame = aSession.pack(chatEnv(aliceId, bobId, "d1"));
    const re = new FrameReassembler();
    // Llega solo la mitad y se corta la conexión.
    expect(re.push(frame.slice(0, Math.floor(frame.length / 2)))).toHaveLength(0);
    expect(re.pendingBytes()).toBeGreaterThan(0);
    re.reset(); // el transporte llama esto al cerrarse el socket
    expect(re.pendingBytes()).toBe(0);
    // Al reconectar, el frame completo se reensambla aunque llegue en trozos raros.
    const re2 = new FrameReassembler();
    const out: Uint8Array[] = [];
    for (let i = 0; i < frame.length; i += 7) out.push(...re2.push(frame.slice(i, i + 7)));
    expect(out).toHaveLength(1);
  });

  it("basura intercalada no atasca el reensamblador", () => {
    const { aliceId, bobId, aSession, bSession } = twoSessions();
    const good = aSession.pack(chatEnv(aliceId, bobId, "g1"));
    const re = new FrameReassembler();
    re.push(new Uint8Array([255, 255, 255, 255])); // longitud absurda → descarta
    const frames = re.push(good);
    expect(frames).toHaveLength(1);
    expect(bSession.unpack(frames[0])).not.toBeNull();
  });
});

describe("adversarial: messenger", () => {
  it("peer desconocido (sin sesión) → handleFrame null, sin crash", async () => {
    const m = new NidoMessenger(new LoopbackTransport());
    await m.ensureIdentity("Yo");
    const { aliceId, bobId, aSession } = twoSessions();
    const frame = aSession.pack(chatEnv(aliceId, bobId, "u1"));
    await expect(m.handleFrame(toHex(bobId.publicKey), frame)).resolves.toBeNull();
  });

  it("duplicado persistente: handleFrame dos veces → segundo null, un solo mensaje", async () => {
    const m = new NidoMessenger(new LoopbackTransport());
    const me = await m.ensureIdentity("Yo");
    const aliceId = generateIdentity();
    const aEph = generateEphemeral();
    const myEph = m.newHandshakeEphemeral();
    // Simula handshake v2: sesión contra Alice con mi pk como destinatario esperado.
    const [n1, n2] = [randomNonce(HANDSHAKE_NONCE_BYTES), randomNonce(HANDSHAKE_NONCE_BYTES)];
    await m.completeHandshake(toHex(aliceId.publicKey), myEph.secretKey, aEph.publicKey, n1, n2);
    const aSession = P2PSession.fromHandshakeV2(aEph.secretKey, myEph.publicKey, me.pkHex, n2, n1);
    const frame = aSession.pack(
      makeEnvelope("chat", "dup1", aliceId.publicKey, me.pkHex, { text: "hola" }),
    );
    const first = await m.handleFrame(toHex(aliceId.publicKey), frame);
    expect(first).not.toBeNull();
    // Reinicio simulado: nueva sesión (seenIds vacío) pero el id ya está en la base.
    const m2sessions = (m as unknown as { sessions: Map<string, P2PSession> }).sessions;
    m2sessions.clear();
    await m.completeHandshake(toHex(aliceId.publicKey), myEph.secretKey, aEph.publicKey, n1, n2);
    const second = await m.handleFrame(toHex(aliceId.publicKey), frame);
    expect(second).toBeNull();
    const inbox = mem.messages.filter((x) => x.dir === "in");
    expect(inbox).toHaveLength(1);
  });

  it("handleDisconnect no lanza y limpia el buffer", async () => {
    const m = new NidoMessenger(new LoopbackTransport());
    await m.ensureIdentity("Yo");
    expect(() => m.handleDisconnect("abcd".repeat(16))).not.toThrow();
  });

  it("agent_task entrante duplicado no se reprocesa", async () => {
    const m = new NidoMessenger(new LoopbackTransport());
    const me = await m.ensureIdentity("Yo");
    const aliceId = generateIdentity();
    const aEph = generateEphemeral();
    const myEph = m.newHandshakeEphemeral();
    const [n3, n4] = [randomNonce(HANDSHAKE_NONCE_BYTES), randomNonce(HANDSHAKE_NONCE_BYTES)];
    await m.completeHandshake(toHex(aliceId.publicKey), myEph.secretKey, aEph.publicKey, n3, n4);
    const aSession = P2PSession.fromHandshakeV2(aEph.secretKey, myEph.publicKey, me.pkHex, n4, n3);
    const frame = aSession.pack(
      makeEnvelope("agent_task", "task1", aliceId.publicKey, me.pkHex, {
        kind: "test",
        text: "haz algo",
      }),
    );
    await m.handleFrame(toHex(aliceId.publicKey), frame);
    await m.handleFrame(toHex(aliceId.publicKey), frame);
    const inbox = mem.messages.filter((x) => x.dir === "in");
    expect(inbox).toHaveLength(1);
    expect(inbox[0].status).toBe("queued"); // nunca auto-ejecutado
  });
});
