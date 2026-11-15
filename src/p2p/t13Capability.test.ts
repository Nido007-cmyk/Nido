/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * t13Capability.test.ts — Tanda T-13 (red y relay II) · 0.1.99.
 *
 * Sondas de m-36: `verifyAnnouncement` solo comprobaba la firma. El
 * anuncio no ligaba al destinatario (lo firmado no incluía
 * `forPeerPkHex`), ni exigía frescura, ni impedía replayar el mismo
 * anuncio. El módulo está sin cablear en producción: es el momento
 * barato de cerrarlo. La verificación pasa a la instancia (la clase
 * guarda los nonces ya vistos, con tope) y exige destinatario correcto,
 * ventana de frescura y nonce de un solo uso.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import nacl from "tweetnacl";
import { CapabilityRegistry, type CapabilityDescriptor } from "./capabilityDiscovery";

const DESC: CapabilityDescriptor = {
  scope: "read:notes",
  description: "Leer notas",
  sensitivity: "low",
  requiresApproval: false,
};

const PEER_B = "bb".repeat(32);
const PEER_C = "cc".repeat(32);

function registryWithKeys() {
  const kp = nacl.sign.keyPair();
  const announcer = Buffer.from(kp.publicKey).toString("hex");
  const r = new CapabilityRegistry();
  r.register(DESC);
  return { r, kp, announcer };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("T-13 · m-36 el anuncio liga destinatario, frescura y un solo uso", () => {
  it("anuncio fresco para mí: verifica (control)", () => {
    const { r, kp, announcer } = registryWithKeys();
    const ann = r.createAnnouncement(kp.secretKey, announcer, PEER_B);
    expect(ann.forPeerPkHex).toBe(PEER_B);
    expect(r.verifyAnnouncement(ann, kp.publicKey, PEER_B)).toBe(true);
  });

  it("replay: el mismo anuncio no verifica dos veces", () => {
    const { r, kp, announcer } = registryWithKeys();
    const ann = r.createAnnouncement(kp.secretKey, announcer, PEER_B);
    expect(r.verifyAnnouncement(ann, kp.publicKey, PEER_B)).toBe(true);
    expect(r.verifyAnnouncement(ann, kp.publicKey, PEER_B)).toBe(false);
  });

  it("dirigido a otro par: no verifica para mí", () => {
    const { r, kp, announcer } = registryWithKeys();
    const ann = r.createAnnouncement(kp.secretKey, announcer, PEER_B);
    expect(r.verifyAnnouncement(ann, kp.publicKey, PEER_C)).toBe(false);
  });

  it("fuera de ventana: un anuncio de hace 10 minutos no verifica", () => {
    const { r, kp, announcer } = registryWithKeys();
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    const ann = r.createAnnouncement(kp.secretKey, announcer, PEER_B);
    vi.setSystemTime(1_800_000_000_000 + 10 * 60_000);
    expect(r.verifyAnnouncement(ann, kp.publicKey, PEER_B)).toBe(false);
  });

  it("el destinatario va firmado: cambiarlo invalida la firma", () => {
    const { r, kp, announcer } = registryWithKeys();
    const ann = r.createAnnouncement(kp.secretKey, announcer, PEER_B);
    const tampered = { ...ann, forPeerPkHex: PEER_C };
    expect(r.verifyAnnouncement(tampered, kp.publicKey, PEER_C)).toBe(false);
  });
});
