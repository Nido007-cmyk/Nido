/**
 * negotiation.e2e.test.ts — End-to-end protocol tests NIDO-to-NIDO.
 *
 * Flujos completos:
 * - PROPOSE → ACCEPT → grant → uso → expiración
 * - PROPOSE → COUNTER → ACCEPT → grant modificado
 * - Disconnect/reconnect safety
 * - Duplicate delivery protection
 */

import { describe, it, expect, beforeEach } from "vitest";
import nacl from "tweetnacl";
import {
  createProposal,
  verifyProposal,
  createCounter,
  issueGrant,
  verifyGrant,
  isExpired,
} from "./negotiation";
import { toHex } from "./crypto";
import { SessionManager } from "./sessionManager";
import { ReplayProtection, RevocationRegistry } from "./replayProtection";
import {
  evaluateProposalScopes,
  validateGrantForExecution,
} from "./p2pAuthorization";
import { globalRevocationRegistry } from "./replayProtection";

describe("E2E: PROPOSE → ACCEPT → EXECUTE", () => {
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

  it("Flujo completo: propuesta → evaluación → grant → ejecución", () => {
    // 1. Alice propone
    const proposal = createProposal(
      aliceKeys.secretKey,
      alicePkHex,
      bobPkHex,
      "Lee mis notas",
      ["read:notes"],
      {}
    );
    expect(verifyProposal(proposal, aliceKeys.publicKey)).toBe(true);

    // 2. Bob evalúa contra su política local
    const evaluation = evaluateProposalScopes(proposal.requestedScopes, alicePkHex);
    // read:notes debería ser AUTO o ASK, no DENY
    expect(evaluation.decision).not.toBe("DENY");

    // 3. Bob acepta y emite grant
    const grant = issueGrant(
      bobKeys.secretKey,
      bobPkHex,
      alicePkHex,
      proposal.requestedScopes,
      proposal.proposalId,
      300000,
      5
    );

    // 4. Alice usa el grant
    const validation = validateGrantForExecution(
      grant,
      bobPkHex,
      "read:notes"
    );
    expect(validation.valid).toBe(true);
  });

  it("Flujo con COUNTER: scopes reducidos", () => {
    // Alice pide demasiado
    const original = createProposal(
      aliceKeys.secretKey,
      alicePkHex,
      bobPkHex,
      "Acceso total",
      ["read:notes", "write:notes", "send:message"],
      {}
    );

    // Bob contrapropone con menos scopes
    const counter = createCounter(
      bobKeys.secretKey,
      bobPkHex,
      original,
      ["read:notes"]
    );

    expect(counter.requestedScopes).toEqual(["read:notes"]);
    expect(counter.counterRound).toBe(1);

    // El grant solo incluye lo contrapropuesto
    const grant = issueGrant(
      bobKeys.secretKey,
      bobPkHex,
      alicePkHex,
      counter.requestedScopes,
      counter.proposalId,
      300000,
      5
    );
    expect(grant.scopes).toEqual(["read:notes"]);
  });
});

describe("E2E: disconnect/reconnect safety", () => {
  it("Sesión suspendida no permite operaciones", () => {
    const sm = new SessionManager({
      heartbeatTimeoutMs: 100,
    });

    const session = sm.createSession("peer123");
    sm.activateSession(session.sessionId);

    // Simular timeout de heartbeat
    sm.checkHealth(Date.now() + 1000);
    const retrieved = sm.getActiveSession(session.sessionId, Date.now() + 1000);
    expect(retrieved).toBeNull(); // No activa
  });

  it("Reconnect requiere re-validación", () => {
    const sm = new SessionManager();
    const session = sm.createSession("peer123");
    sm.activateSession(session.sessionId);

    // Heartbeat mantiene activa
    expect(sm.heartbeat(session.sessionId)).toBe(true);

    // Revocar → heartbeat falla
    sm.revokeSession(session.sessionId);
    expect(sm.heartbeat(session.sessionId)).toBe(false);
  });
});

describe("E2E: duplicate delivery protection", () => {
  it("Mismo nonce dos veces → segundo rechazado", () => {
    const rp = new ReplayProtection();
    const aliceKeys = nacl.sign.keyPair();
    const alicePkHex = toHex(aliceKeys.publicKey);
    const bobKeys = nacl.sign.keyPair();
    const bobPkHex = toHex(bobKeys.publicKey);

    const proposal = createProposal(
      aliceKeys.secretKey,
      alicePkHex,
      bobPkHex,
      "Tarea",
      ["read:notes"],
      {}
    );

    // Primera entrega: OK
    expect(rp.checkAndRecord(proposal.nonce)).toBe(true);
    // Segunda entrega (duplicado): RECHAZADO
    expect(rp.checkAndRecord(proposal.nonce)).toBe(false);
  });
});

describe("E2E: policy enforcement", () => {
  it("Scope desconocido → DENY (fail-closed)", () => {
    const aliceKeys = nacl.sign.keyPair();
    const alicePkHex = toHex(aliceKeys.publicKey);

    const evaluation = evaluateProposalScopes(
      ["read:notes", "hack:everything"],
      alicePkHex
    );

    expect(evaluation.decision).toBe("DENY");
  });

  it("Peer revocado → DENY total", () => {
    const aliceKeys = nacl.sign.keyPair();
    const alicePkHex = toHex(aliceKeys.publicKey);

    globalRevocationRegistry.revokePeer(alicePkHex, "test");
    const evaluation = evaluateProposalScopes(["read:notes"], alicePkHex);
    expect(evaluation.decision).toBe("DENY");
    globalRevocationRegistry.clear();
  });
});
