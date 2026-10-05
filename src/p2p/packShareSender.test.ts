/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Tests para el sender de Pack Sharing (v2.1).
 *
 * Cubre:
 * - chunkPackData: división correcta en chunks
 * - hashPackData: SHA-256 del contenido
 * - isValidAdvertisement: validación fail-closed
 * - createSendSession: creación con validación
 * - nextChunkToSend / markChunkAcked: control de flujo
 * - sendProgress / isSendSessionTimedOut
 */

import { describe, it, expect, vi } from "vitest";
import { createHash } from "crypto";

// Mock expo-crypto (igual que en packSharing.test.ts)
vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  digestStringAsync: async (algorithm: string, data: string) => {
    return createHash("sha256").update(data, "utf8").digest("hex");
  },
}));

import {
  chunkPackData,
  hashPackData,
  isValidAdvertisement,
  createSendSession,
  nextChunkToSend,
  markChunkAcked,
  sendProgress,
  isSendSessionTimedOut,
  PACK_CHUNK_SIZE,
  MAX_PACK_SIZE_BYTES,
  chunkCountFor,
  type PackAdvertisement,
} from "./packSharing";

describe("chunkPackData", () => {
  it("divide datos pequeños en un chunk", () => {
    const chunks = chunkPackData("p1", "a".repeat(100));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].total).toBe(1);
    expect(chunks[0].packId).toBe("p1");
  });

  it("divide datos grandes en múltiples chunks", () => {
    const data = "x".repeat(PACK_CHUNK_SIZE * 2 + 100);
    const chunks = chunkPackData("p1", data);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].index).toBe(0);
    expect(chunks[1].index).toBe(1);
    expect(chunks[2].index).toBe(2);
    expect(chunks.every((c) => c.total === 3)).toBe(true);
    // Reensamblar debe dar los datos originales
    expect(chunks.map((c) => c.data).join("")).toBe(data);
  });

  it("chunk exacto al límite", () => {
    const data = "y".repeat(PACK_CHUNK_SIZE);
    const chunks = chunkPackData("p1", data);
    expect(chunks).toHaveLength(1);
  });
});

describe("hashPackData", () => {
  it("calcula SHA-256 correcto", async () => {
    const data = "hello world";
    const hash = await hashPackData(data);
    const expected = createHash("sha256").update(data, "utf8").digest("hex");
    expect(hash).toBe(expected);
  });

  it("hash es minúsculas", async () => {
    const hash = await hashPackData("test");
    expect(hash).toBe(hash.toLowerCase());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("isValidAdvertisement", () => {
  const validAdv: PackAdvertisement = {
    id: "pack1",
    name: "Test Pack",
    description: "A test",
    sizeBytes: 1000,
    hash: "a".repeat(64),
    chunkCount: 1,
    senderId: "device1",
  };

  it("acepta advertisement válido", () => {
    expect(isValidAdvertisement(validAdv)).toBe(true);
  });

  it("rechaza advertisement nulo", () => {
    expect(isValidAdvertisement(null as any)).toBe(false);
  });

  it("rechaza sin id", () => {
    expect(isValidAdvertisement({ ...validAdv, id: "" })).toBe(false);
  });

  it("rechaza tamaño cero", () => {
    expect(isValidAdvertisement({ ...validAdv, sizeBytes: 0 })).toBe(false);
  });

  it("rechaza tamaño excesivo", () => {
    expect(
      isValidAdvertisement({ ...validAdv, sizeBytes: MAX_PACK_SIZE_BYTES + 1 })
    ).toBe(false);
  });

  it("rechaza hash inválido", () => {
    expect(isValidAdvertisement({ ...validAdv, hash: "invalid" })).toBe(false);
    expect(isValidAdvertisement({ ...validAdv, hash: "" })).toBe(false);
  });

  it("rechaza chunkCount incorrecto", () => {
    // sizeBytes=1000 → chunkCount debe ser 1
    expect(isValidAdvertisement({ ...validAdv, chunkCount: 5 })).toBe(false);
  });

  it("rechaza chunkCount cero", () => {
    expect(isValidAdvertisement({ ...validAdv, chunkCount: 0 })).toBe(false);
  });
});

describe("createSendSession", () => {
  it("crea sesión válida", async () => {
    const data = "test pack data".repeat(100);
    const session = await createSendSession(
      "sess-1",
      "pack1",
      "Test Pack",
      "A test pack",
      Buffer.from(data).toString("base64"),
      "sender1",
      "PEERPK"
    );
    expect(session).not.toBeNull();
    expect(session!.sessionId).toBe("sess-1");
    expect(session!.state).toBe("OFFERED");
    expect(session!.peerPkHex).toBe("peerpk"); // normalizado a minúsculas
    expect(session!.chunks.length).toBeGreaterThan(0);
    expect(session!.acked.size).toBe(0);
  });

  it("rechaza datos vacíos", async () => {
    const session = await createSendSession(
      "sess-1",
      "pack1",
      "Test",
      "Desc",
      "",
      "sender1",
      "peer1"
    );
    expect(session).toBeNull();
  });

  it("calcula hash correctamente en el advertisement", async () => {
    const rawData = "hello pack";
    const base64 = Buffer.from(rawData).toString("base64");
    const session = await createSendSession(
      "sess-1",
      "pack1",
      "Test",
      "Desc",
      base64,
      "sender1",
      "peer1"
    );
    const expectedHash = createHash("sha256").update(base64, "utf8").digest("hex");
    expect(session!.advertisement.hash).toBe(expectedHash);
  });
});

describe("nextChunkToSend / markChunkAcked", () => {
  it("envía chunks en orden y marca ACKs", async () => {
    const data = "x".repeat(PACK_CHUNK_SIZE + 10);
    const base64 = Buffer.from(data).toString("base64");
    const session = (await createSendSession(
      "sess-1",
      "pack1",
      "Test",
      "Desc",
      base64,
      "sender1",
      "peer1"
    ))!;

    // Simular ACCEPT
    session.state = "ACCEPTED";

    // Primer chunk
    const chunk0 = nextChunkToSend(session);
    expect(chunk0).not.toBeNull();
    expect(chunk0!.index).toBe(0);

    // ACK del chunk 0
    const allAcked1 = markChunkAcked(session, 0);
    expect(allAcked1).toBe(false);
    expect(sendProgress(session)).toBeLessThan(1);

    // Siguiente chunk
    const chunk1 = nextChunkToSend(session);
    expect(chunk1).not.toBeNull();
    expect(chunk1!.index).toBe(1);

    // ACK del chunk 1 → completo
    const allAcked2 = markChunkAcked(session, 1);
    // Puede haber más chunks dependiendo del tamaño
    if (session.chunks.length === 2) {
      expect(allAcked2).toBe(true);
      expect(nextChunkToSend(session)).toBeNull();
      expect(sendProgress(session)).toBe(1);
    }
  });

  it("no envía si no está en ACCEPTED", async () => {
    const session = (await createSendSession(
      "sess-1",
      "pack1",
      "Test",
      "Desc",
      Buffer.from("data").toString("base64"),
      "sender1",
      "peer1"
    ))!;
    // Estado OFFERED, no ACCEPTED
    expect(nextChunkToSend(session)).toBeNull();
  });

  it("rechaza índice inválido en ACK", async () => {
    const session = (await createSendSession(
      "sess-1",
      "pack1",
      "Test",
      "Desc",
      Buffer.from("data").toString("base64"),
      "sender1",
      "peer1"
    ))!;
    session.state = "ACCEPTED";
    expect(markChunkAcked(session, -1)).toBe(false);
    expect(markChunkAcked(session, 999)).toBe(false);
  });
});

describe("isSendSessionTimedOut", () => {
  it("detecta timeout después de 5 minutos", async () => {
    const session = (await createSendSession(
      "sess-1",
      "pack1",
      "Test",
      "Desc",
      Buffer.from("data").toString("base64"),
      "sender1",
      "peer1"
    ))!;
    // Recién creada: no timeout
    expect(isSendSessionTimedOut(session)).toBe(false);
    // Simular 6 minutos sin actividad
    session.lastActivityAt = Date.now() - 6 * 60 * 1000;
    expect(isSendSessionTimedOut(session)).toBe(true);
  });
});
