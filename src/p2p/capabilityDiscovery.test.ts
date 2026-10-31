/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * capabilityDiscovery.test.ts — auditoría completa 2026-10-31
 * (F6-06): el módulo de anuncios firmados de capacidades no tenía
 * ninguna prueba. Se ejercita su superficie completa: registro,
 * filtrado por peer (la promesa de su cabecera), firma y
 * verificación con manipulación.
 */
import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";
import { CapabilityRegistry, type CapabilityDescriptor } from "./capabilityDiscovery";
import { toHex } from "./crypto";

const NOTES: CapabilityDescriptor = {
  scope: "read:notes",
  description: "Leer notas",
  sensitivity: "medium",
  requiresApproval: true,
};
const CONTACTS: CapabilityDescriptor = {
  scope: "read:contacts",
  description: "Leer contactos",
  sensitivity: "high",
  requiresApproval: true,
};

function registry(): CapabilityRegistry {
  const r = new CapabilityRegistry();
  r.register(NOTES);
  r.register(CONTACTS);
  return r;
}

describe("CapabilityRegistry (F6-06)", () => {
  it("sin denegación, un peer ve todas las capabilities registradas", () => {
    const r = registry();
    expect(r.getVisibleForPeer("aa".repeat(32)).map((c) => c.scope)).toEqual([
      "read:notes",
      "read:contacts",
    ]);
  });

  it("hideFromPeer oculta solo a ese peer, sin importar mayúsculas", () => {
    const r = registry();
    const peer = "AB".repeat(32);
    r.hideFromPeer(peer, "read:contacts");
    expect(r.getVisibleForPeer(peer.toLowerCase()).map((c) => c.scope)).toEqual(["read:notes"]);
    expect(r.getVisibleForPeer("cd".repeat(32)).map((c) => c.scope)).toEqual([
      "read:notes",
      "read:contacts",
    ]);
  });

  it("el anuncio firmado lleva solo lo visible para ese peer y verifica", () => {
    const r = registry();
    const kp = nacl.sign.keyPair();
    const announcer = toHex(kp.publicKey);
    const peer = "ef".repeat(32);
    r.hideFromPeer(peer, "read:contacts");
    const ann = r.createAnnouncement(kp.secretKey, announcer, peer);
    expect(ann.capabilities.map((c) => c.scope)).toEqual(["read:notes"]);
    expect(ann.announcerPkHex).toBe(announcer);
    expect(CapabilityRegistry.verifyAnnouncement(ann, kp.publicKey)).toBe(true);
  });

  it("un anuncio manipulado o de otra clave no verifica", () => {
    const r = registry();
    const kp = nacl.sign.keyPair();
    const ann = r.createAnnouncement(kp.secretKey, toHex(kp.publicKey), "ef".repeat(32));
    const tampered = {
      ...ann,
      capabilities: [...ann.capabilities, { ...CONTACTS, scope: "write:everything" }],
    };
    expect(CapabilityRegistry.verifyAnnouncement(tampered, kp.publicKey)).toBe(false);
    const other = nacl.sign.keyPair();
    expect(CapabilityRegistry.verifyAnnouncement(ann, other.publicKey)).toBe(false);
  });

  it("clear vacía registro y denegaciones", () => {
    const r = registry();
    const peer = "ab".repeat(32);
    r.hideFromPeer(peer, "read:notes");
    r.clear();
    expect(r.getVisibleForPeer(peer)).toEqual([]);
  });
});
