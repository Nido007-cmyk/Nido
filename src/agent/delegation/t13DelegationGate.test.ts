/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * t13DelegationGate.test.ts — Tanda T-13 (red y relay II) · 0.1.99.
 *
 * Sonda de M-23 (puerta de delegación de la fricción aprobada):
 * `requestTask` a un contacto con `verified = false` debe negarse con
 * `contact_not_verified` y no enviar nada, aunque la negociación esté
 * ACCEPTED. Con el contacto verificado, el flujo dorado no cambia.
 * El arnés replica el de delegationService.test.ts (mismos mocks).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import nacl from "tweetnacl";

const aKeys = nacl.sign.keyPair();
const bKeys = nacl.sign.keyPair();
const aSigHex = Buffer.from(aKeys.publicKey).toString("hex");
const bSigHex = Buffer.from(bKeys.publicKey).toString("hex");
const PEER_PK = "aa".repeat(32);
const NEGOTIATION_ID = "neg-1";

const gate = vi.hoisted(() => ({ verified: false }));

vi.mock("../../p2p/negotiationService", () => ({
  negotiationService: {
    listSessions: () => [{ negotiationId: NEGOTIATION_ID, state: "ACCEPTED", peerPkHex: "bb".repeat(32) }],
  },
}));

vi.mock("../../p2p/store", () => ({
  findContactByPk: async (pkHex: string) => {
    if (pkHex.toLowerCase() === PEER_PK) return { sigPkHex: bSigHex, name: "PeerB", verified: gate.verified };
    return { sigPkHex: aSigHex, name: "PeerA", verified: true };
  },
  getSigningKeypair: async () => (globalThis as any).__delegationLocalKeys ?? bKeys,
  logTaskAudit: async () => {},
}));

import { DelegationService } from "./delegationService";
import { resetFeatureFlagsForTests, setFeatureEnabled } from "../../config/featureFlags";
import type { TaskMessageBody, TaskMessageType } from "../../p2p/taskProtocol";

describe("T-13 · M-23 requestTask exige el cotejo de huella", () => {
  beforeEach(async () => {
    DelegationService.resetForTests();
    resetFeatureFlagsForTests();
    await setFeatureEnabled("delegation.enabled", true);
    (globalThis as any).__delegationLocalKeys = aKeys;
  });

  it("contacto sin verificar: contact_not_verified y nada enviado", async () => {
    gate.verified = false;
    const svc = DelegationService.getInstance();
    await setFeatureEnabled("delegation.enabled", true);
    const sent: unknown[] = [];
    svc.setSendFunction(async () => {
      sent.push(1);
      return true;
    });
    const r = await svc.requestTask({
      peerPkHex: PEER_PK,
      negotiationId: NEGOTIATION_ID,
      description: "What is 2+2?",
      scope: "task:answer",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("contact_not_verified");
    expect(sent).toHaveLength(0);
  });

  it("contacto verificado: el flujo dorado no cambia (control)", async () => {
    gate.verified = true;
    const svc = DelegationService.getInstance();
    await setFeatureEnabled("delegation.enabled", true);
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
  });
});
