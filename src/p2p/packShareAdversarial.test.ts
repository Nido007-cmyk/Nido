/**
 * Tests adversariales para Pack Sharing.
 *
 * Verifica que el sistema resiste:
 * - Peer no autorizado / sender ID spoofeado
 * - Metadata manipulada (tamaño, hash, chunkCount)
 * - Chunks duplicados
 * - Chunks fuera de orden (deben reensamblarse correctamente)
 * - Chunks faltantes
 * - Contenido truncado
 * - Session ID inválido
 * - Acciones desconocidas
 * - Mensajes de tipo incorrecto
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  digestStringAsync: async (algorithm: string, data: string) => {
    return createHash("sha256").update(data, "utf8").digest("hex");
  },
}));

import { packShareService } from "./packShareService";
import { reassembleChunks, addChunk, createReceiveSession } from "./packSharing";
import type { P2PEnvelope } from "./protocol";
import type { PackAdvertisement, PackChunk } from "./packSharing";

vi.mock("./replayProtection", () => ({
  globalRevocationRegistry: {
    isPeerRevoked: vi.fn(() => false),
  },
  globalReplayProtection: {
    checkAndRecord: vi.fn(() => true),
  },
}));

const SENDER_PK = "a".repeat(64);
const ATTACKER_PK = "f".repeat(64);
const RECEIVER_PK = "b".repeat(64);

function makeEnvelope(
  from: string,
  action: string,
  sessionId: string,
  data: Record<string, unknown>
): P2PEnvelope {
  return {
    v: 2,
    type: "pack_share",
    id: `env-${Math.random()}`,
    from,
    to: RECEIVER_PK,
    ts: Date.now(),
    payload: { action, sessionId, data },
  } as P2PEnvelope;
}

function makeAdv(overrides: Partial<PackAdvertisement> = {}): PackAdvertisement {
  const data = Buffer.from("legit content").toString("base64");
  const hash = createHash("sha256").update(data, "utf8").digest("hex");
  return {
    id: "pack1",
    name: "Legit Pack",
    description: "Legit",
    sizeBytes: 100,
    hash,
    chunkCount: 1,
    senderId: SENDER_PK,
    ...overrides,
  };
}

describe("Pack Sharing adversarial", () => {
  beforeEach(() => {
    packShareService._reset();
    packShareService.setLocalIdentity(RECEIVER_PK);
    packShareService.setSendFunction(async () => {});
  });

  it("atacante no puede spoofear senderId", async () => {
    const events: any[] = [];
    packShareService.subscribe((e) => events.push(e));

    // El atacante envía un OFFER diciendo que es del sender legítimo
    const adv = makeAdv({ senderId: SENDER_PK });
    await packShareService.handleEnvelope(
      makeEnvelope(ATTACKER_PK, "OFFER", "sess-spoof", { advertisement: adv })
    );

    // Debe ser ignorado porque adv.senderId != env.from
    expect(events.length).toBe(0);
    expect(packShareService._getReceiveSession("sess-spoof")).toBeUndefined();
  });

  it("metadata con tamaño manipulado → rechazado", async () => {
    const events: any[] = [];
    packShareService.subscribe((e) => events.push(e));

    // chunkCount no coincide con sizeBytes
    const adv = makeAdv({ sizeBytes: 100, chunkCount: 999 });
    await packShareService.handleEnvelope(
      makeEnvelope(SENDER_PK, "OFFER", "sess-meta", { advertisement: adv })
    );

    expect(events.length).toBe(0);
  });

  it("chunks duplicados no corrompen la sesión", async () => {
    const adv = makeAdv();
    const session = createReceiveSession(adv, RECEIVER_PK);

    const chunk: PackChunk = {
      packId: "pack1",
      index: 0,
      total: 1,
      data: "abc",
      hash: "",
    };

    const first = await addChunk(session, chunk);
    expect(first).toBe(true); // Completo (1 chunk)

    // Duplicado debe ser rechazado
    const second = await addChunk(session, chunk);
    expect(second).toBe(false); // No se acepta duplicado
    expect(session.received.size).toBe(1);
  });

  it("chunks fuera de orden se reensamblan correctamente", () => {
    const chunks: PackChunk[] = [
      { packId: "p1", index: 2, total: 3, data: "ccc", hash: "h2" },
      { packId: "p1", index: 0, total: 3, data: "aaa", hash: "h0" },
      { packId: "p1", index: 1, total: 3, data: "bbb", hash: "h1" },
    ];
    expect(reassembleChunks(chunks)).toBe("aaabbbccc");
  });

  it("chunks faltantes → reensamblado retorna null", () => {
    const chunks: PackChunk[] = [
      { packId: "p1", index: 0, total: 3, data: "aaa", hash: "h0" },
      // Falta index 1
      { packId: "p1", index: 2, total: 3, data: "ccc", hash: "h2" },
    ];
    expect(reassembleChunks(chunks)).toBeNull();
  });

  it("acción desconocida → ignorada", async () => {
    const events: any[] = [];
    packShareService.subscribe((e) => events.push(e));

    await packShareService.handleEnvelope(
      makeEnvelope(SENDER_PK, "HACK", "sess-unknown", { evil: "payload" })
    );

    expect(events.length).toBe(0);
  });

  it("CHUNK para sesión inexistente → ignorado", async () => {
    const sentMessages: any[] = [];
    packShareService.setSendFunction(async (peer, action, sessionId, data) => {
      sentMessages.push({ action });
    });

    await packShareService.handleEnvelope(
      makeEnvelope(SENDER_PK, "CHUNK", "sess-nonexistent", {
        chunk: { packId: "p1", index: 0, total: 1, data: "x", hash: "" },
      })
    );

    // No debe enviar ACK para sesión inexistente
    expect(sentMessages).toHaveLength(0);
  });

  it("ACCEPT para sesión inexistente → ignorado", async () => {
    // No debe lanzar excepción
    await packShareService.handleEnvelope(
      makeEnvelope(SENDER_PK, "ACCEPT", "sess-ghost", {})
    );
    // Si llegamos aquí sin excepción, el test pasa
    expect(true).toBe(true);
  });

  it("payload malformado → ignorado sin crash", async () => {
    const events: any[] = [];
    packShareService.subscribe((e) => events.push(e));

    // Sin sessionId
    await packShareService.handleEnvelope({
      v: 2,
      type: "pack_share",
      id: "x",
      from: SENDER_PK,
      to: RECEIVER_PK,
      ts: Date.now(),
      payload: { action: "OFFER" }, // Falta sessionId y data
    } as P2PEnvelope);

    // Con data null
    await packShareService.handleEnvelope({
      v: 2,
      type: "pack_share",
      id: "y",
      from: SENDER_PK,
      to: RECEIVER_PK,
      ts: Date.now(),
      payload: { action: "OFFER", sessionId: "s", data: null },
    } as unknown as P2PEnvelope);

    expect(events.length).toBe(0);
  });

  it("tipo de envelope incorrecto → ignorado", async () => {
    const events: any[] = [];
    packShareService.subscribe((e) => events.push(e));

    await packShareService.handleEnvelope({
      v: 2,
      type: "chat", // Tipo incorrecto
      id: "z",
      from: SENDER_PK,
      to: RECEIVER_PK,
      ts: Date.now(),
      payload: { action: "OFFER", sessionId: "s", data: {} },
    } as P2PEnvelope);

    expect(events.length).toBe(0);
  });
});
