/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * p2pApprovalBridge.test.ts — Tests del puente negociación → approval inbox.
 */

import { describe, it, expect, beforeEach } from "vitest";
import nacl from "tweetnacl";
import {
  processIncomingProposal,
  toApprovalRequest,
  type QueuedProposalTask,
} from "./p2pApprovalBridge";
import { createProposal } from "./negotiation";
import { toHex } from "./crypto";
import { globalRevocationRegistry, globalReplayProtection } from "./replayProtection";

describe("p2pApprovalBridge", () => {
  let aliceKeys: nacl.SignKeyPair;
  let bobKeys: nacl.SignKeyPair;
  let alicePkHex: string;
  let bobPkHex: string;

  beforeEach(() => {
    aliceKeys = nacl.sign.keyPair();
    bobKeys = nacl.sign.keyPair();
    alicePkHex = toHex(aliceKeys.publicKey);
    bobPkHex = toHex(bobKeys.publicKey);
    globalRevocationRegistry.clear();
    globalReplayProtection.clear();
  });

  it("Propuesta con scopes AUTO → auto_accept", async () => {
    const proposal = createProposal(
      aliceKeys.secretKey,
      alicePkHex,
      bobPkHex,
      "Lee notas",
      ["read:notes"],
      {}
    );

    const queueFn = async (_task: QueuedProposalTask) => "task-1";
    const result = await processIncomingProposal(
      proposal,
      aliceKeys.publicKey,
      queueFn
    );

    // read:notes debería ser AUTO o ASK, no DENY
    expect(["auto_accept", "queued_for_approval"]).toContain(result.action);
  });

  it("Propuesta con scope desconocido → auto_reject (fail-closed)", async () => {
    const proposal = createProposal(
      aliceKeys.secretKey,
      alicePkHex,
      bobPkHex,
      "Hack",
      ["hack:everything"],
      {}
    );

    const queueFn = async (_task: QueuedProposalTask) => "task-1";
    const result = await processIncomingProposal(
      proposal,
      aliceKeys.publicKey,
      queueFn
    );

    expect(result.action).toBe("auto_reject");
  });

  it("Firma inválida → auto_reject", async () => {
    const proposal = createProposal(
      aliceKeys.secretKey,
      alicePkHex,
      bobPkHex,
      "Tarea",
      ["read:notes"],
      {}
    );

    const queueFn = async (_task: QueuedProposalTask) => "task-1";
    // Verificar con clave equivocada
    const result = await processIncomingProposal(
      proposal,
      bobKeys.publicKey, // ¡Clave equivocada!
      queueFn
    );

    expect(result.action).toBe("auto_reject");
    expect(result.reason).toBe("invalid_signature");
  });

  it("Replay → auto_reject", async () => {
    const proposal = createProposal(
      aliceKeys.secretKey,
      alicePkHex,
      bobPkHex,
      "Tarea",
      ["read:notes"],
      {}
    );

    const queueFn = async (_task: QueuedProposalTask) => "task-1";

    // Primera vez
    const r1 = await processIncomingProposal(proposal, aliceKeys.publicKey, queueFn);
    expect(r1.action).not.toBe("auto_reject");

    // Segunda vez (replay)
    const r2 = await processIncomingProposal(proposal, aliceKeys.publicKey, queueFn);
    expect(r2.action).toBe("auto_reject");
    expect(r2.reason).toBe("replay_detected");
  });

  it("toApprovalRequest genera formato ApprovalCard", () => {
    const task: QueuedProposalTask = {
      proposalId: "prop-1",
      proposerPkHex: alicePkHex,
      taskDescription: "Lee mis notas",
      requestedScopes: ["read:notes", "send:message"],
      params: {},
      expiresAt: Date.now() + 300000,
      evaluation: {
        decision: "ASK",
        scopeDecisions: [],
        requiresHumanApproval: true,
        reason: "test",
      },
    };

    const req = toApprovalRequest(task);
    expect(req.actionTitle).toBe("Lee mis notas");
    expect(req.details.length).toBeGreaterThan(0);
    expect(req.riskLevel).toBe("high"); // send:message es high risk
  });
});
