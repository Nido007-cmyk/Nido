/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * t13PackGate.test.ts — Tanda T-13 (red y relay II) · 0.1.99.
 *
 * Sonda de M-23 (puerta de packs de la fricción aprobada): una oferta de
 * pack de un contacto sin verificar no debe crear sesión de recepción;
 * queda retenida CON SU CAUSA (evento `offer_held_unverified`) hasta que
 * se comparen las huellas. La puerta es un gancho asíncrono del servicio
 * (`setOfferGate`) porque el `offerFilter` existente es síncrono y no
 * puede leer el store; la app lo cablea con `findContactByPk`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

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

import { packShareService, type PackShareEvent } from "./packShareService";
import type { P2PEnvelope } from "./protocol";
import type { PackAdvertisement } from "./packSharing";

const SENDER_PK = "a".repeat(64);
const RECEIVER_PK = "b".repeat(64);

function makeEnvelope(from: string, action: string, sessionId: string, data: Record<string, unknown>): P2PEnvelope {
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

describe("T-13 · M-23 las ofertas de un contacto sin verificar quedan retenidas con su causa", () => {
  let events: PackShareEvent[];

  beforeEach(() => {
    packShareService._reset();
    packShareService.setLocalIdentity(RECEIVER_PK);
    events = [];
    packShareService.subscribe((e) => events.push(e));
  });

  it("puerta cerrada (sin verificar): ni sesión ni offer_received; sí offer_held_unverified", async () => {
    packShareService.setOfferGate(async () => false);
    await packShareService.handleEnvelope(
      makeEnvelope(SENDER_PK, "OFFER", "sess-held", { advertisement: makeValidAdvertisement() }),
    );
    expect(events.some((e) => e.type === "offer_received")).toBe(false);
    const held = events.find((e) => e.type === "offer_held_unverified");
    expect(held).toBeDefined();
    expect(held && held.type === "offer_held_unverified" ? held.senderPkHex : null).toBe(SENDER_PK);
    expect(packShareService._getReceiveSession("sess-held")).toBeUndefined();
  });

  it("puerta abierta (verificado): la oferta entra como siempre (control)", async () => {
    packShareService.setOfferGate(async () => true);
    await packShareService.handleEnvelope(
      makeEnvelope(SENDER_PK, "OFFER", "sess-ok", { advertisement: makeValidAdvertisement() }),
    );
    expect(events.some((e) => e.type === "offer_received")).toBe(true);
    expect(packShareService._getReceiveSession("sess-ok")).toBeDefined();
  });

  it("la puerta que falla cierra (fail-closed): oferta retenida, sin sesión", async () => {
    packShareService.setOfferGate(async () => {
      throw new Error("store caído");
    });
    await packShareService.handleEnvelope(
      makeEnvelope(SENDER_PK, "OFFER", "sess-err", { advertisement: makeValidAdvertisement() }),
    );
    expect(events.some((e) => e.type === "offer_received")).toBe(false);
    expect(events.some((e) => e.type === "offer_held_unverified")).toBe(true);
    expect(packShareService._getReceiveSession("sess-err")).toBeUndefined();
  });

  it("sin puerta cableada: comportamiento de siempre (control)", async () => {
    await packShareService.handleEnvelope(
      makeEnvelope(SENDER_PK, "OFFER", "sess-plain", { advertisement: makeValidAdvertisement() }),
    );
    expect(events.some((e) => e.type === "offer_received")).toBe(true);
  });
});
