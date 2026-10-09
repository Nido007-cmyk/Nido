/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import nacl from "tweetnacl";

/**
 * TESTFIX-2026-10-08 (Fix 7): delegation wiring tests.
 * - Flag OFF → delegation unreachable (requests refused, inbound dropped).
 * - Flag ON → golden flow: request → approval → execute → result; deny path.
 */

// Test keypairs: A (requester) and B (executor).
const aKeys = nacl.sign.keyPair();
const bKeys = nacl.sign.keyPair();
const aSigHex = Buffer.from(aKeys.publicKey).toString("hex");
const bSigHex = Buffer.from(bKeys.publicKey).toString("hex");
const PEER_PK = "aa".repeat(32); // X25519 identity hex (mock)
const NEGOTIATION_ID = "neg-1";

vi.mock("../../p2p/negotiationService", () => ({
  negotiationService: {
    listSessions: () => [{ negotiationId: NEGOTIATION_ID, state: "ACCEPTED" }],
  },
}));

vi.mock("../../p2p/store", () => ({
  findContactByPk: async (pkHex: string) => {
    // A knows B's signing key and vice versa (paired by QR).
    if (pkHex.toLowerCase() === PEER_PK) return { sigPkHex: bSigHex, name: "PeerB" };
    return { sigPkHex: aSigHex, name: "PeerA" };
  },
  getSigningKeypair: async () => (globalThis as any).__delegationLocalKeys ?? bKeys,
  logTaskAudit: async () => {},
}));

import {
  DelegationService,
} from "./delegationService";
import {
  isFeatureEnabled,
  setFeatureEnabled,
  resetFeatureFlagsForTests,
} from "../../config/featureFlags";
import type { TaskMessageType, TaskMessageBody } from "../../p2p/taskProtocol";

function freshService() {
  DelegationService.resetForTests();
  resetFeatureFlagsForTests();
  return DelegationService.getInstance();
}

describe("delegationService: flag OFF → unreachable", () => {
  beforeEach(() => {
    resetFeatureFlagsForTests();
  });

  it("requestTask refused with 'disabled' when flag OFF (default)", async () => {
    expect(isFeatureEnabled("delegation.enabled")).toBe(false);
    const svc = freshService();
    const sent: unknown[] = [];
    svc.setSendFunction(async () => {
      sent.push(1);
      return true;
    });
    const r = await svc.requestTask({
      peerPkHex: PEER_PK,
      negotiationId: NEGOTIATION_ID,
      description: "answer this",
      scope: "task:answer",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("disabled");
    expect(sent).toHaveLength(0);
  });

  it("handleTaskMessage drops silently when flag OFF", async () => {
    const svc = freshService();
    const events: unknown[] = [];
    svc.subscribe((e) => events.push(e));
    await svc.handleTaskMessage(PEER_PK, "TASK_REQUEST", {
      negotiationId: NEGOTIATION_ID,
      taskId: "123e4567-e89b-42d3-a456-426614174000",
      description: "malicious task",
      resultSchema: {},
      delegationToken: "bogus",
      expiresAt: Date.now() + 60000,
      maxDurationMs: 1000,
    });
    expect(events).toHaveLength(0);
    expect(svc.pendingApprovals).toBe(0);
  });
});

describe("delegationService: flag ON → golden flow", () => {
  beforeEach(async () => {
    resetFeatureFlagsForTests();
    await setFeatureEnabled("delegation.enabled", true);
    // Default: this device is B (executor).
    (globalThis as any).__delegationLocalKeys = bKeys;
  });

  it("requestTask sends TASK_REQUEST with valid token", async () => {
    const svc = freshService();
    // Re-enable after freshService() cleared overrides.
    await setFeatureEnabled("delegation.enabled", true);
    // This device is A (requester); peer is B.
    (globalThis as any).__delegationLocalKeys = aKeys;
    const sent: { peer: string; type: TaskMessageType; body: TaskMessageBody }[] = [];
    svc.setSendFunction(async (peer, type, body) => {
      sent.push({ peer, type, body });
      return true;
    });
    const r = await svc.requestTask({
      peerPkHex: PEER_PK,
      negotiationId: NEGOTIATION_ID,
      description: "What is 2+2?",
      scope: "task:answer",
    });
    expect(r.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("TASK_REQUEST");
    const body = sent[0].body as { delegationToken: string; taskId: string };
    expect(typeof body.delegationToken).toBe("string");
    expect(body.delegationToken.length).toBeGreaterThan(50);
  });

  it("inbound TASK_REQUEST → approval-pending; approve → TASK_RESULT; deny → TASK_REJECT", async () => {
    const svc = freshService();
    await setFeatureEnabled("delegation.enabled", true);
    svc.setModelInvoke(async () => "4");
    // FIX 2026-10-09 (F-DELEG-4): el gate es fail-closed sin provider.
    // El test debe cablear el lookup como lo hace NidoScreen en producción.
    svc.setNegotiationStateLookup(() => "ACCEPTED");

    const sent: { type: TaskMessageType; body: TaskMessageBody }[] = [];
    svc.setSendFunction(async (_peer, type, body) => {
      sent.push({ type, body });
      return true;
    });

    // A → B: build a real request via a second service instance acting as A.
    // Simpler: craft the token manually with A's key.
    const { issueDelegationToken } = await import("../../p2p/delegationToken");
    const taskId = "123e4567-e89b-42d3-a456-426614174000";
    const token = issueDelegationToken(aKeys.secretKey, {
      issuer: aSigHex,
      audience: bSigHex,
      negotiationId: NEGOTIATION_ID,
      taskId,
      scopes: ["task:answer"],
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60000,
    });

    const events: { type: string; requestId?: string }[] = [];
    svc.subscribe((e: { type: string; requestId?: string }) => events.push(e));

    // findContactByPk mock: for inbound, fromPkHex is A's identity.
    // Our mock returns bSigHex for PEER_PK and aSigHex otherwise — the
    // verifier expects the ISSUER's key (A). Pass a non-PEER_PK from.
    const A_ID = "bb".repeat(32);
    await svc.handleTaskMessage(A_ID, "TASK_REQUEST", {
      negotiationId: NEGOTIATION_ID,
      taskId,
      description: "What is 2+2?",
      resultSchema: { type: "string" },
      delegationToken: token,
      expiresAt: Date.now() + 60000,
      maxDurationMs: 5000,
    });

    const pending = events.find((e) => e.type === "approval-pending");
    expect(pending).toBeDefined();
    expect(svc.pendingApprovals).toBe(1);

    // Approve → executor runs fake model → TASK_RESULT sent.
    await svc.approveTask(pending!.requestId!);
    expect(svc.pendingApprovals).toBe(0);
    const result = sent.find((s) => s.type === "TASK_RESULT");
    expect(result).toBeDefined();
    expect((result!.body as { ok: boolean }).ok).toBe(true);
    expect((result!.body as { result: unknown }).result).toBe("4");
  });

  it("deny → TASK_REJECT with reason denied, nothing executes", async () => {
    const svc = freshService();
    await setFeatureEnabled("delegation.enabled", true);
    let modelCalls = 0;
    svc.setModelInvoke(async () => {
      modelCalls++;
      return "x";
    });
    const sent: { type: TaskMessageType; body: TaskMessageBody }[] = [];
    svc.setSendFunction(async (_peer, type, body) => {
      sent.push({ type, body });
      return true;
    });

    const { issueDelegationToken } = await import("../../p2p/delegationToken");
    const taskId = "223e4567-e89b-42d3-a456-426614174001";
    const token = issueDelegationToken(aKeys.secretKey, {
      issuer: aSigHex,
      audience: bSigHex,
      negotiationId: NEGOTIATION_ID,
      taskId,
      scopes: ["task:answer"],
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60000,
    });
    const events: { type: string; requestId?: string }[] = [];
    svc.subscribe((e: { type: string; requestId?: string }) => events.push(e));
    const A_ID = "bb".repeat(32);
    await svc.handleTaskMessage(A_ID, "TASK_REQUEST", {
      negotiationId: NEGOTIATION_ID,
      taskId,
      description: "Do something evil",
      resultSchema: { type: "string" },
      delegationToken: token,
      expiresAt: Date.now() + 60000,
      maxDurationMs: 5000,
    });
    const pending = events.find((e) => e.type === "approval-pending");
    expect(pending).toBeDefined();

    await svc.denyTask(pending!.requestId!);
    expect(modelCalls).toBe(0);
    const reject = sent.find((s) => s.type === "TASK_REJECT");
    expect(reject).toBeDefined();
    expect((reject!.body as { reasonCode: string }).reasonCode).toBe("denied");
    expect(svc.pendingApprovals).toBe(0);
  });
});

describe("I2 FIX 2026-10-09: TASK_CANCEL inbound aborta executor", () => {
  it("TASK_CANCEL para tarea inbound llega al abort (no se dropea)", async () => {
    // Este test verifica que el branch TASK_CANCEL está ANTES del check
    // de outbound. Si estuviera después, un cancel inbound se dropeaba.
    resetFeatureFlagsForTests();
    await setFeatureEnabled("delegation.enabled", true);
    const svc = freshService();
    await setFeatureEnabled("delegation.enabled", true);
    // UUID v4 válido (validateTaskCancel lo exige).
    const taskId = "123e4567-e89b-42d3-a456-426614174000";
    // Simular executor en curso.
    const fakeExecutor = { abort: vi.fn() };
    (svc as any).runningExecutors.set(taskId.toLowerCase(), fakeExecutor);
    // Enviar TASK_CANCEL (inbound: no está en outbound).
    await (svc as any).handleTaskMessage("peerpk".repeat(8), "TASK_CANCEL", { taskId });
    expect(fakeExecutor.abort).toHaveBeenCalled();
  });
});
