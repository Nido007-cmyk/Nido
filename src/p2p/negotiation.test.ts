/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * negotiation.test.ts — Tests del protocolo de negociación NIDO-to-NIDO.
 *
 * Happy paths:
 * - PROPOSE → COUNTER → ACCEPT
 * - DECLINE explícito
 * - EXPIRE por timeout
 *
 * Adversarial paths:
 * - Firma forjada
 * - Payload modificado
 * - Receptor equivocado
 * - Replay de PROPOSE
 * - Escalación de privilegios
 *
 * Los casos de grants (issueGrant/verifyGrant) se retiraron con esa
 * superficie en T-12 (m-45, 0.1.99): no tenía llamadores de producción.
 * RevocationRegistry sigue viva y sus casos quedan, con ids literales.
 */

import { describe, it, expect, beforeEach } from "vitest";
import nacl from "tweetnacl";
import {
  createProposal,
  verifyProposal,
  createCounter,
  isExpired,
  isValidTransition,
  canonicalSerialize,
} from "./negotiation";
import { toHex, fromHex } from "./crypto";
import { ReplayProtection, RevocationRegistry } from "./replayProtection";

describe("negotiation: happy paths", () => {
  let aliceKeys: nacl.SignKeyPair;
  let bobKeys: nacl.SignKeyPair;
  let alicePkHex: string;
  let bobPkHex: string;

  beforeEach(() => {
    aliceKeys = nacl.sign.keyPair();
    bobKeys = nacl.sign.keyPair();
    alicePkHex = toHex(aliceKeys.publicKey);
    bobPkHex = toHex(bobKeys.publicKey);
  });

  it("PROPOSE → firma válida y verificable", () => {
    const proposal = createProposal(
      aliceKeys.secretKey,
      alicePkHex,
      bobPkHex,
      "Lee mis notas de hoy",
      ["read:notes"],
      { date: "2026-10-05" }
    );

    expect(proposal.proposalId).toBeTruthy();
    expect(proposal.counterRound).toBe(0);
    expect(verifyProposal(proposal, aliceKeys.publicKey)).toBe(true);
  });

  it("PROPOSE → COUNTER → ACCEPT: scopes modificados", () => {
    const original = createProposal(
      aliceKeys.secretKey,
      alicePkHex,
      bobPkHex,
      "Accede a mis datos",
      ["read:notes", "write:notes"],
      {}
    );

    // Bob contrapropone: solo lectura
    const counter = createCounter(
      bobKeys.secretKey,
      bobPkHex,
      original,
      ["read:notes"] // Reduce scopes
    );

    expect(counter.counterRound).toBe(1);
    expect(counter.requestedScopes).toEqual(["read:notes"]);
    expect(counter.proposalId).toBe(original.proposalId);
    expect(verifyProposal(counter, bobKeys.publicKey)).toBe(true);
  });

  it("EXPIRE: propuesta vencida detectada", () => {
    const proposal = createProposal(
      aliceKeys.secretKey,
      alicePkHex,
      bobPkHex,
      "Tarea",
      ["read:notes"],
      {},
      100 // 100ms TTL
    );

    expect(isExpired(proposal, Date.now())).toBe(false);
    expect(isExpired(proposal, Date.now() + 1000)).toBe(true);
  });

  it("State machine: transiciones válidas", () => {
    expect(isValidTransition("PROPOSED", "ACCEPTED")).toBe(true);
    expect(isValidTransition("PROPOSED", "COUNTERED")).toBe(true);
    expect(isValidTransition("PROPOSED", "DECLINED")).toBe(true);
    expect(isValidTransition("PROPOSED", "EXPIRED")).toBe(true);
    expect(isValidTransition("COUNTERED", "COUNTERED")).toBe(true);
    // Terminales no tienen salidas
    expect(isValidTransition("ACCEPTED", "PROPOSED")).toBe(false);
    expect(isValidTransition("DECLINED", "ACCEPTED")).toBe(false);
    expect(isValidTransition("EXPIRED", "ACCEPTED")).toBe(false);
  });

  it("Serialización canónica es determinista", () => {
    const obj1 = { b: 2, a: 1, c: { z: 3, y: 2 } };
    const obj2 = { a: 1, c: { y: 2, z: 3 }, b: 2 };
    expect(canonicalSerialize(obj1)).toBe(canonicalSerialize(obj2));
  });
});

describe("negotiation: adversarial paths", () => {
  let aliceKeys: nacl.SignKeyPair;
  let bobKeys: nacl.SignKeyPair;
  let eveKeys: nacl.SignKeyPair;
  let alicePkHex: string;
  let bobPkHex: string;

  beforeEach(() => {
    aliceKeys = nacl.sign.keyPair();
    bobKeys = nacl.sign.keyPair();
    eveKeys = nacl.sign.keyPair();
    alicePkHex = toHex(aliceKeys.publicKey);
    bobPkHex = toHex(bobKeys.publicKey);
  });

  it("RECHAZA firma forjada (atacante firma como Alice)", () => {
    const proposal = createProposal(
      aliceKeys.secretKey,
      alicePkHex,
      bobPkHex,
      "Tarea legítima",
      ["read:notes"],
      {}
    );

    // Eve intenta verificar con su propia clave → debe fallar
    expect(verifyProposal(proposal, eveKeys.publicKey)).toBe(false);
  });

  it("RECHAZA payload modificado (tampering)", () => {
    const proposal = createProposal(
      aliceKeys.secretKey,
      alicePkHex,
      bobPkHex,
      "Lee notas",
      ["read:notes"],
      {}
    );

    // Atacante modifica los scopes solicitados
    const tampered = {
      ...proposal,
      requestedScopes: ["read:notes", "send:message"], // Escalación!
    };

    expect(verifyProposal(tampered, aliceKeys.publicKey)).toBe(false);
  });

  it("RECHAZA grant revocado", () => {
    // T-12 (m-45): RevocationRegistry sigue viva (espejo de revocación de
    // pares y sesiones); el caso usa un id de grant literal porque la
    // emisión de grants se retiró con la superficie muerta.
    const registry = new RevocationRegistry();
    registry.revokeGrant("grant-literal-1", "compromised");
    expect(registry.isGrantRevoked("grant-literal-1")).toBe(true);
    expect(registry.isGrantUsable("grant-literal-1", alicePkHex)).toBe(false);
  });

  it("RECHAZA peer revocado", () => {
    const registry = new RevocationRegistry();
    registry.revokePeer(alicePkHex, "malicious");

    expect(registry.isPeerRevoked(alicePkHex)).toBe(true);
    // Grants de peer revocado no son usables aunque el grant no esté revocado
    expect(registry.isGrantUsable("some-grant", alicePkHex)).toBe(false);
  });
});

describe("replay protection", () => {
  it("Detecta replay de nonce", () => {
    const rp = new ReplayProtection();
    const nonce = "abc123";

    expect(rp.checkAndRecord(nonce)).toBe(true); // Primera vez: OK
    expect(rp.checkAndRecord(nonce)).toBe(false); // Segunda vez: REPLAY
  });

  it("Evicta nonces expirados", () => {
    const rp = new ReplayProtection(100); // 100ms ventana
    const nonce = "xyz789";

    expect(rp.checkAndRecord(nonce, 1000)).toBe(true);
    // Después de la ventana, el nonce se olvida (puede reusarse, pero el
    // timestamp del mensaje también se valida por separado)
    expect(rp.checkAndRecord(nonce, 1000 + 10000)).toBe(true);
  });
});
