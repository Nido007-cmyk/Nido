/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * T-16 · m-01 — packShareService: id de sesión con entropía de verdad y
 * DECLINE/CANCEL ligados al remitente.
 *
 * Pata A: el id de sesión era `ps-${Date.now()}-${Math.random()…}`: unos
 * 31 bits de un PRNG no criptográfico, con la marca de tiempo a la vista.
 * Ahora la parte impredecible sale del CSPRNG de la casa
 * (`randomNonce`/`toHex` de ./crypto, 128 bits).
 *
 * Pata B: el despachador pasaba el remitente a ACCEPT, CHUNK y COMPLETE,
 * pero DECLINE y CANCEL se aplicaban sin mirar quién los mandaba: un
 * contacto emparejado que aprendiera un id ajeno podía declinar o
 * cancelar transferencias de otros (DoS acotado, sin exposición de
 * datos). Ahora ambos exigen la misma ligadura que ACCEPT: en una
 * sesión de envío manda el destinatario de la oferta; en una de
 * recepción, el emisor de la oferta (una de las dos partes de la
 * sesión, que es quien puede cancelar según el propio protocolo).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  digestStringAsync: async (algorithm: string, data: string) => {
    return createHash("sha256").update(data, "utf8").digest("hex");
  },
}));

vi.mock("./replayProtection", () => ({
  globalRevocationRegistry: {
    isPeerRevoked: vi.fn(() => false),
  },
  globalReplayProtection: {
    checkAndRecord: vi.fn(() => true),
  },
}));

import { packShareService } from "./packShareService";
import type { P2PEnvelope } from "./protocol";
import type { PackAdvertisement } from "./packSharing";

const ME = "b".repeat(64);
const PEER = "a".repeat(64);
const THIRD = "c".repeat(64);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function makeEnvelope(
  from: string,
  action: string,
  sessionId: string,
  data: Record<string, unknown>
): P2PEnvelope {
  return {
    v: 2,
    type: "pack_share",
    id: `env-${from.slice(0, 4)}-${action}-${sessionId}`,
    from,
    to: ME,
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
    senderId: PEER,
  };
}

/** Deja el servicio listo para enviar y crea una sesión de envío a PEER. */
async function startSendSession(events: unknown[] = []): Promise<string> {
  packShareService._reset();
  packShareService.setLocalIdentity(ME);
  packShareService.setSendFunction(async () => {});
  packShareService.setDataProvider(async () => ({
    base64Data: Buffer.from("contenido del pack").toString("base64"),
    name: "Pack",
    description: "",
  }));
  packShareService.subscribe((e) => events.push(e));
  const id = await packShareService.offerPack("pack1", PEER);
  expect(id).not.toBeNull();
  return id as string;
}

/** Deja el servicio listo y registra una sesión de recepción de PEER. */
async function startReceiveSession(sessionId: string): Promise<void> {
  packShareService._reset();
  packShareService.setLocalIdentity(ME);
  packShareService.setSendFunction(async () => {});
  await packShareService.handleEnvelope(
    makeEnvelope(PEER, "OFFER", sessionId, { advertisement: makeValidAdvertisement() })
  );
  expect(packShareService._getReceiveSession(sessionId)).toBeDefined();
}

describe("T-16 · m-01 pata A: el id de sesión nace del CSPRNG", () => {
  beforeEach(() => {
    packShareService._reset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dos sesiones creadas en el mismo milisegundo tienen ids distintos y con 128 bits impredecibles", async () => {
    // Con el reloj y Math.random congelados, el id viejo salía idéntico
    // para las dos sesiones: toda su «entropía» era eso. El CSPRNG no
    // depende de ninguno de los dos.
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    packShareService.setLocalIdentity(ME);
    packShareService.setSendFunction(async () => {});
    packShareService.setDataProvider(async () => ({
      base64Data: Buffer.from("contenido del pack").toString("base64"),
      name: "Pack",
      description: "",
    }));
    const id1 = await packShareService.offerPack("pack1", PEER);
    const id2 = await packShareService.offerPack("pack1", PEER);
    expect(id1).not.toBeNull();
    expect(id2).not.toBeNull();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^ps-1700000000000-[0-9a-f]{32}$/);
    expect(id2).toMatch(/^ps-1700000000000-[0-9a-f]{32}$/);
  });

  it("packShareService.ts ya no contiene Math.random", () => {
    const src = readFileSync(join(ROOT, "src/p2p/packShareService.ts"), "utf8");
    expect(src).not.toContain("Math.random");
  });
});

describe("T-16 · m-01 pata B: DECLINE ligado al destinatario de la oferta", () => {
  it("un DECLINE de un tercer contacto no declina mi sesión de envío", async () => {
    const events: any[] = [];
    const id = await startSendSession(events);
    await packShareService.handleEnvelope(makeEnvelope(THIRD, "DECLINE", id, {}));
    expect(packShareService._getSendSession(id)?.state).toBe("OFFERED");
    expect(
      events.some(
        (e) => e.type === "transfer_updated" && e.info.sessionId === id && e.info.state === "declined"
      )
    ).toBe(false);
  });

  it("CONTROL · el DECLINE del destinatario sí declina la sesión", async () => {
    const id = await startSendSession();
    await packShareService.handleEnvelope(makeEnvelope(PEER, "DECLINE", id, {}));
    expect(packShareService._getSendSession(id)?.state).toBe("DECLINED");
  });
});

describe("T-16 · m-01 pata B: CANCEL ligado a una parte de la sesión", () => {
  it("un CANCEL de un tercer contacto no cancela mi sesión de envío", async () => {
    const id = await startSendSession();
    await packShareService.handleEnvelope(makeEnvelope(THIRD, "CANCEL", id, {}));
    expect(packShareService._getSendSession(id)?.state).toBe("OFFERED");
  });

  it("CONTROL · el CANCEL del destinatario sí cancela mi sesión de envío", async () => {
    const id = await startSendSession();
    await packShareService.handleEnvelope(makeEnvelope(PEER, "CANCEL", id, {}));
    expect(packShareService._getSendSession(id)?.state).toBe("CANCELLED");
  });

  it("un CANCEL de un tercer contacto no borra mi sesión de recepción", async () => {
    await startReceiveSession("sess-cancel-third");
    await packShareService.handleEnvelope(makeEnvelope(THIRD, "CANCEL", "sess-cancel-third", {}));
    expect(packShareService._getReceiveSession("sess-cancel-third")).toBeDefined();
  });

  it("CONTROL · el CANCEL del emisor de la oferta sí cancela la recepción", async () => {
    await startReceiveSession("sess-cancel-peer");
    await packShareService.handleEnvelope(makeEnvelope(PEER, "CANCEL", "sess-cancel-peer", {}));
    expect(packShareService._getReceiveSession("sess-cancel-peer")).toBeUndefined();
  });
});
