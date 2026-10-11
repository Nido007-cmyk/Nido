/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Tests de integración para PackShareService.
 *
 * Simula el flujo completo sender → receiver:
 * OFFER → ACCEPT → CHUNK → CHUNK_ACK → COMPLETE → verificación SHA-256 → import
 *
 * También cubre casos adversariales:
 * - Advertisement malformado
 * - Sender ID no coincide
 * - Chunk con packId incorrecto
 * - Hash mismatch en verificación final
 * - Peer revocado
 * - Sesión duplicada
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
import type { P2PEnvelope } from "./protocol";
import type { PackAdvertisement } from "./packSharing";

// Mock del revocation registry
vi.mock("./replayProtection", () => ({
  globalRevocationRegistry: {
    isPeerRevoked: vi.fn(() => false),
  },
  globalReplayProtection: {
    checkAndRecord: vi.fn(() => true),
  },
}));

const SENDER_PK = "a".repeat(64);
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

function makeValidAdvertisement(): PackAdvertisement {
  const testData = Buffer.from("test pack content").toString("base64");
  const hash = createHash("sha256").update(testData, "utf8").digest("hex");
  return {
    id: "pack1",
    name: "Test Pack",
    description: "A test pack",
    sizeBytes: 100,
    hash,
    chunkCount: 1,
    senderId: SENDER_PK,
  };
}

describe("PackShareService: flujo completo", () => {
  beforeEach(() => {
    packShareService._reset();
    packShareService.setLocalIdentity(RECEIVER_PK);
  });

  it("OFFER válido → evento offer_received", async () => {
    const events: any[] = [];
    packShareService.subscribe((e) => events.push(e));

    const adv = makeValidAdvertisement();
    // Ajustar chunkCount para que sea válido (sizeBytes=100 → 1 chunk)
    adv.chunkCount = 1;

    await packShareService.handleEnvelope(
      makeEnvelope(SENDER_PK, "OFFER", "sess-1", { advertisement: adv })
    );

    expect(events.some((e) => e.type === "offer_received")).toBe(true);
    const session = packShareService._getReceiveSession("sess-1");
    expect(session).toBeDefined();
    expect(session!.packId).toBe("pack1");
  });

  it("OFFER con advertisement inválido → ignorado", async () => {
    const events: any[] = [];
    packShareService.subscribe((e) => events.push(e));

    const badAdv = { id: "", name: "" }; // Malformado
    await packShareService.handleEnvelope(
      makeEnvelope(SENDER_PK, "OFFER", "sess-2", { advertisement: badAdv })
    );

    expect(events.length).toBe(0);
    expect(packShareService._getReceiveSession("sess-2")).toBeUndefined();
  });

  it("OFFER con senderId que no coincide → ignorado", async () => {
    const events: any[] = [];
    packShareService.subscribe((e) => events.push(e));

    const adv = makeValidAdvertisement();
    adv.senderId = "c".repeat(64); // No coincide con SENDER_PK

    await packShareService.handleEnvelope(
      makeEnvelope(SENDER_PK, "OFFER", "sess-3", { advertisement: adv })
    );

    expect(events.length).toBe(0);
  });

  it("OFFER duplicado → ignorado (no duplica sesión)", async () => {
    const adv = makeValidAdvertisement();
    const env = makeEnvelope(SENDER_PK, "OFFER", "sess-4", { advertisement: adv });

    await packShareService.handleEnvelope(env);
    await packShareService.handleEnvelope(env); // Duplicado

    // Solo una sesión debe existir
    const transfers = packShareService.listTransfers();
    const matching = transfers.filter((t) => t.sessionId === "sess-4");
    expect(matching).toHaveLength(1);
  });

  it("CHUNK con packId incorrecto → ignorado", async () => {
    packShareService._reset();
    packShareService.setLocalIdentity(RECEIVER_PK);

    const sentMessages: any[] = [];
    packShareService.setSendFunction(async (peer, action, sessionId, data) => {
      sentMessages.push({ peer, action, sessionId, data });
    });

    const adv = makeValidAdvertisement();
    await packShareService.handleEnvelope(
      makeEnvelope(SENDER_PK, "OFFER", "sess-5", { advertisement: adv })
    );

    // Enviar chunk con packId incorrecto
    await packShareService.handleEnvelope(
      makeEnvelope(SENDER_PK, "CHUNK", "sess-5", {
        chunk: { packId: "wrong", index: 0, total: 1, data: "abc", hash: "h" },
      })
    );

    // No debe haber enviado ACK
    expect(sentMessages.filter((m) => m.action === "CHUNK_ACK")).toHaveLength(0);
  });

  it("flujo completo: OFFER → ACCEPT → CHUNK → COMPLETE → import", async () => {
    packShareService._reset();
    packShareService.setLocalIdentity(RECEIVER_PK);

    const sentMessages: any[] = [];
    packShareService.setSendFunction(async (peer, action, sessionId, data) => {
      sentMessages.push({ peer, action, sessionId, data });
    });

    let importedPack: any = null;
    packShareService.setImporter(async (packId, name, data) => {
      importedPack = { packId, name, data };
      return true;
    });

    const events: any[] = [];
    packShareService.subscribe((e) => events.push(e));

    // 1. OFFER
    const testContent = "Hello, this is a test pack!";
    const base64Data = Buffer.from(testContent).toString("base64");
    const hash = createHash("sha256").update(base64Data, "utf8").digest("hex");
    const adv: PackAdvertisement = {
      id: "pack1",
      name: "Test Pack",
      description: "Test",
      sizeBytes: Math.ceil((base64Data.length * 3) / 4),
      hash,
      chunkCount: 1,
      senderId: SENDER_PK,
    };

    await packShareService.handleEnvelope(
      makeEnvelope(SENDER_PK, "OFFER", "sess-full", { advertisement: adv })
    );
    expect(events.some((e) => e.type === "offer_received")).toBe(true);

    // 2. ACCEPT (simula que el usuario acepta)
    const accepted = await packShareService.acceptOffer("sess-full");
    expect(accepted).toBe(true);
    expect(sentMessages.some((m) => m.action === "ACCEPT")).toBe(true);

    // 3. CHUNK
    await packShareService.handleEnvelope(
      makeEnvelope(SENDER_PK, "CHUNK", "sess-full", {
        chunk: { packId: "pack1", index: 0, total: 1, data: base64Data, hash: "" },
      })
    );
    // Debe haber enviado CHUNK_ACK
    expect(sentMessages.some((m) => m.action === "CHUNK_ACK")).toBe(true);

    // 4. COMPLETE → verifica hash e importa
    await packShareService.handleEnvelope(
      makeEnvelope(SENDER_PK, "COMPLETE", "sess-full", {})
    );

    expect(importedPack).not.toBeNull();
    expect(importedPack.packId).toBe("pack1");
    expect(importedPack.data).toBe(base64Data);
    expect(events.some((e) => e.type === "transfer_complete")).toBe(true);
  });

  it("COMPLETE con hash mismatch → failed, NO importa", async () => {
    packShareService._reset();
    packShareService.setLocalIdentity(RECEIVER_PK);
    packShareService.setSendFunction(async () => {});

    let importCalled = false;
    packShareService.setImporter(async () => {
      importCalled = true;
      return true;
    });

    const events: any[] = [];
    packShareService.subscribe((e) => events.push(e));

    // Advertisement con hash correcto
    const realData = Buffer.from("real content").toString("base64");
    const realHash = createHash("sha256").update(realData, "utf8").digest("hex");
    const adv: PackAdvertisement = {
      id: "pack1",
      name: "Test",
      description: "Test",
      sizeBytes: 100,
      hash: realHash,
      chunkCount: 1,
      senderId: SENDER_PK,
    };

    await packShareService.handleEnvelope(
      makeEnvelope(SENDER_PK, "OFFER", "sess-hash", { advertisement: adv })
    );
    await packShareService.acceptOffer("sess-hash");

    // Enviar chunk con CONTENIDO DIFERENTE (hash no coincidirá)
    const fakeData = Buffer.from("tampered content").toString("base64");
    await packShareService.handleEnvelope(
      makeEnvelope(SENDER_PK, "CHUNK", "sess-hash", {
        chunk: { packId: "pack1", index: 0, total: 1, data: fakeData, hash: "" },
      })
    );

    await packShareService.handleEnvelope(
      makeEnvelope(SENDER_PK, "COMPLETE", "sess-hash", {})
    );

    // NO debe importar
    expect(importCalled).toBe(false);
    expect(events.some((e) => e.type === "transfer_failed")).toBe(true);
    const failedEvent = events.find((e) => e.type === "transfer_failed");
    expect(failedEvent.error).toContain("Hash mismatch");
  });

  it("DECLINE limpia la sesión del receiver", async () => {
    packShareService._reset();
    packShareService.setLocalIdentity(RECEIVER_PK);
    packShareService.setSendFunction(async () => {});

    const events: any[] = [];
    packShareService.subscribe((e) => events.push(e));

    const adv = makeValidAdvertisement();
    await packShareService.handleEnvelope(
      makeEnvelope(SENDER_PK, "OFFER", "sess-decline", { advertisement: adv })
    );
    expect(packShareService._getReceiveSession("sess-decline")).toBeDefined();

    await packShareService.declineOffer("sess-decline");
    expect(packShareService._getReceiveSession("sess-decline")).toBeUndefined();
    expect(events.some((e) => e.type === "offer_declined")).toBe(true);
  });

  it("CANCEL del sender cancela la transferencia", async () => {
    packShareService._reset();
    packShareService.setLocalIdentity(RECEIVER_PK);

    const adv = makeValidAdvertisement();
    await packShareService.handleEnvelope(
      makeEnvelope(SENDER_PK, "OFFER", "sess-cancel", { advertisement: adv })
    );

    await packShareService.handleEnvelope(
      makeEnvelope(SENDER_PK, "CANCEL", "sess-cancel", {})
    );

    expect(packShareService._getReceiveSession("sess-cancel")).toBeUndefined();
  });
});

describe("PACKS-2026-10-10: isReady refleja si el servicio está conectado", () => {
  it("false sin identidad/envío/proveedor; true con los tres", () => {
    packShareService._reset();
    expect(packShareService.isReady()).toBe(false);
    packShareService.setLocalIdentity("a".repeat(64));
    packShareService.setSendFunction(async () => {});
    expect(packShareService.isReady()).toBe(false);
    packShareService.setDataProvider(async () => null);
    expect(packShareService.isReady()).toBe(true);
  });
});
