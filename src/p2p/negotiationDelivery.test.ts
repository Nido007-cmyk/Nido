/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * negotiationDelivery.test.ts — Tests del modelo fail-closed de entrega.
 *
 * Requisito del UI/UX gate: accept/decline/counter SOLO commitean el estado
 * visible cuando el transporte acepta el mensaje firmado. Si el envío falla,
 * la sesión conserva su estado anterior y guarda la respuesta firmada en
 * `pendingSend` para reintentar de forma segura (mismos bytes, mismo nonce).
 *
 * Estos tests FALLAN contra el código de e034ead, que transicionaba el estado
 * local a ACCEPTED/DECLINED/COUNTERED aunque el envío hubiera fallado.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import nacl from "tweetnacl";

// --- Mocks -----------------------------------------------------------------
// Deterministic keypair for the local device (seed fija, sin estado externo).
vi.mock("./store", () => ({
  getSigningKeypair: vi.fn(async () => {
    const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
    return { publicKey: kp.publicKey, secretKey: kp.secretKey };
  }),
}));

// El bridge siempre encola para aprobación → la sesión queda en PROPOSED.
vi.mock("./p2pApprovalBridge", () => ({
  processIncomingProposal: vi.fn(async () => ({
    action: "queued_for_approval",
    taskId: "task-test",
    reason: "test",
  })),
}));

import {
  negotiationService,
  type NegotiationEvent,
  type RespondResult,
} from "./negotiationService";
import {
  createProposal,
  signNegotiationMessage,
  verifyNegotiationMessage,
  type TaskProposal,
} from "./negotiation";
import { PROTOCOL_VERSION, type P2PMessageType } from "./protocol";
import { toHex, fromHex } from "./crypto";

const localKp = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
const localPkHex = toHex(localKp.publicKey);

describe("Negotiation delivery fail-closed", () => {
  let aliceKeys: nacl.SignKeyPair;
  let alicePkHex: string;
  let bobPkHex: string;
  let events: NegotiationEvent[];
  let idSeq = 0;

  /** sendFn controlable por test; registra los bytes firmados enviados. */
  let sentPayloads: Array<Record<string, unknown>>;
  let sendImpl: (peer: string, action: string, id: string, signed: Record<string, unknown>) => Promise<boolean>;
  let unsubscribe: (() => void) | null = null;

  beforeEach(() => {
    // El servicio es singleton: desuscribir el handler anterior para no
    // acumular pushes duplicados en `events` entre tests.
    if (unsubscribe) unsubscribe();
    aliceKeys = nacl.sign.keyPair();
    alicePkHex = toHex(aliceKeys.publicKey);
    bobPkHex = toHex(nacl.sign.keyPair().publicKey);
    events = [];
    sentPayloads = [];
    sendImpl = async () => true;

    negotiationService.setLocalIdentity(bobPkHex);
    negotiationService.setSendFunction(async (peer, action, id, signed) => {
      sentPayloads.push(signed);
      return sendImpl(peer, action, id, signed);
    });
    unsubscribe = negotiationService.subscribe((e) => events.push(e));
  });

  function makeProposal(recipient: string = bobPkHex, ttlMs = 300000): TaskProposal {
    return createProposal(
      aliceKeys.secretKey,
      alicePkHex,
      recipient,
      "Ayúdame a organizar mis notas",
      ["read:notes"],
      {},
      ttlMs
    );
  }

  async function proposeSession(tag: string, ttlMs = 300000): Promise<string> {
    const negotiationId = `deliver-${tag}-${idSeq++}`;
    const proposal = makeProposal(bobPkHex, ttlMs);
    const signed = signNegotiationMessage(
      aliceKeys.secretKey,
      alicePkHex,
      "PROPOSE",
      proposal.proposalId,
      proposal
    );
    await negotiationService.handleEnvelope({
      v: PROTOCOL_VERSION,
      type: "negotiation" as P2PMessageType,
      id: `msg-${negotiationId}-PROPOSE`,
      from: alicePkHex,
      to: bobPkHex,
      ts: Date.now(),
      payload: { action: "PROPOSE", negotiationId, signed },
    } as never);
    return negotiationId;
  }

  function getSession(id: string) {
    return negotiationService.listSessions().find((s) => s.negotiationId === id);
  }

  function eventTypes() {
    return events.map((e) => e.type);
  }

  it("ACCEPT entregado → estado ACCEPTED y mensaje firmado válido", async () => {
    const id = await proposeSession("accept-ok");
    events = [];

    const res: RespondResult = await negotiationService.acceptSession(id);

    expect(res).toEqual({ sent: true });
    expect(getSession(id)?.state).toBe("ACCEPTED");
    expect(getSession(id)?.pendingSend).toBeUndefined();
    expect(eventTypes()).toContain("accepted");

    // El mensaje firmado enviado al peer es válido y está firmado por nosotros
    expect(sentPayloads).toHaveLength(1);
    const signed = sentPayloads[0] as unknown as {
      type: string;
      signerPkHex: string;
      signatureHex: string;
    };
    expect(signed.type).toBe("ACCEPT");
    expect(signed.signerPkHex).toBe(localPkHex);
    expect(
      verifyNegotiationMessage(signed as never, fromHex(signed.signerPkHex))
    ).toBe(true);
  });

  it("DECLINE entregado → estado DECLINED con reason", async () => {
    const id = await proposeSession("decline-ok");
    events = [];

    const res = await negotiationService.declineSession(id, "No puedo ayudar");

    expect(res).toEqual({ sent: true });
    expect(getSession(id)?.state).toBe("DECLINED");
    const declined = events.find((e) => e.type === "declined");
    expect(declined).toBeDefined();
    expect(declined && declined.type === "declined" && declined.reason).toBe(
      "No puedo ayudar"
    );
    const signed = sentPayloads[0] as unknown as { type: string };
    expect(signed.type).toBe("DECLINE");
  });

  it("COUNTER entregado → estado COUNTERED y propuesta actualizada", async () => {
    const id = await proposeSession("counter-ok");
    events = [];

    const res = await negotiationService.counterSession(id, ["read:notes"]);

    expect(res).toEqual({ sent: true });
    const session = getSession(id);
    expect(session?.state).toBe("COUNTERED");
    expect(session?.proposal.requestedScopes).toEqual(["read:notes"]);
    expect(eventTypes()).toContain("counter_received");
    const signed = sentPayloads[0] as unknown as {
      type: string;
      payload: TaskProposal;
    };
    expect(signed.type).toBe("COUNTER");
    expect(signed.payload.requestedScopes).toEqual(["read:notes"]);
  });

  it("peer unreachable (sendFn → false) → SIN transición local falsa + pendingSend", async () => {
    const id = await proposeSession("unreachable");
    sendImpl = async () => false; // el transporte no puede entregar
    events = [];

    const res = await negotiationService.acceptSession(id);

    // Resultado honesto
    expect(res.sent).toBe(false);
    expect(res.reason).toBe("send_rejected");
    // La divergencia NIDO A/B queda PROHIBIDA: el estado NO cambia
    expect(getSession(id)?.state).toBe("PROPOSED");
    // No se emite "accepted": la UI jamás muestra éxito sin entrega
    expect(eventTypes()).not.toContain("accepted");
    // La respuesta firmada queda guardada para reintento seguro
    const pending = getSession(id)?.pendingSend;
    expect(pending).toBeDefined();
    expect(pending?.action).toBe("ACCEPT");
    expect(pending?.attempts).toBe(1);
    // La UI recibe el evento para mostrar "No enviado / Reintentar"
    expect(eventTypes()).toContain("send_failed");
    const failed = events.find((e) => e.type === "send_failed");
    expect(failed && failed.type === "send_failed" && failed.action).toBe("ACCEPT");
  });

  it("sendFn lanza excepción → send_threw, sin transición local", async () => {
    const id = await proposeSession("throws");
    sendImpl = async () => {
      throw new Error("transport exploded");
    };
    events = [];

    const res = await negotiationService.declineSession(id);

    expect(res).toEqual({ sent: false, reason: "send_threw" });
    expect(getSession(id)?.state).toBe("PROPOSED");
    expect(getSession(id)?.pendingSend?.action).toBe("DECLINE");
    expect(eventTypes()).not.toContain("declined");
    expect(eventTypes()).toContain("send_failed");
  });

  it("sin sendFn → no_send_function, sin transición local", async () => {
    const id = await proposeSession("nosendfn");
    // Simula wiring ausente: sin función de envío no hay entrega posible
    negotiationService.setSendFunction(null as never);
    events = [];

    const res = await negotiationService.acceptSession(id);

    expect(res).toEqual({ sent: false, reason: "no_send_function" });
    expect(getSession(id)?.state).toBe("PROPOSED");
    expect(eventTypes()).not.toContain("accepted");
    expect(eventTypes()).toContain("send_failed");
  });

  it("double tap → el segundo intento se rechaza, un solo envío", async () => {
    const id = await proposeSession("doubletap");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    sendImpl = async () => {
      calls++;
      await gate; // el primer envío queda en vuelo
      return true;
    };
    events = [];

    const p1 = negotiationService.acceptSession(id);
    const p2 = negotiationService.acceptSession(id); // doble tap
    const res2 = await p2;
    release();
    const res1 = await p1;

    expect(res2).toEqual({ sent: false, reason: "already_sending" });
    expect(res1).toEqual({ sent: true });
    expect(calls).toBe(1);
    expect(getSession(id)?.state).toBe("ACCEPTED");
  });

  it("retry → reenvía los MISMOS bytes firmados y commitea al confirmar", async () => {
    const id = await proposeSession("retry");
    sendImpl = async () => false; // primer intento falla
    events = [];

    const r1 = await negotiationService.acceptSession(id);
    expect(r1.sent).toBe(false);
    expect(getSession(id)?.state).toBe("PROPOSED");
    const firstBytes = JSON.stringify(sentPayloads[0]);

    // El transporte vuelve: el reintento usa los mismos bytes firmados
    sendImpl = async () => true;
    sentPayloads = [];
    events = [];
    const r2 = await negotiationService.retrySend(id);

    expect(r2).toEqual({ sent: true });
    expect(sentPayloads).toHaveLength(1);
    expect(JSON.stringify(sentPayloads[0])).toBe(firstBytes); // mismo nonce
    expect(getSession(id)?.state).toBe("ACCEPTED");
    expect(getSession(id)?.pendingSend).toBeUndefined();
    expect(eventTypes()).toContain("accepted");
  });

  it("retry sin pendiente → no_pending_send", async () => {
    const id = await proposeSession("retry-nopending");
    const res = await negotiationService.retrySend(id);
    expect(res).toEqual({ sent: false, reason: "no_pending_send" });
  });

  it("replay después del retry: el duplicado se descarta por nonce", async () => {
    // El peer recibe dos veces los mismos bytes firmados (duplicado de red).
    const id = await proposeSession("replay");
    const proposal = getSession(id)!.proposal;
    const signed = signNegotiationMessage(
      aliceKeys.secretKey,
      alicePkHex,
      "ACCEPT",
      proposal.proposalId,
      proposal
    );
    const envelope = {
      v: PROTOCOL_VERSION,
      type: "negotiation" as P2PMessageType,
      id: `msg-${id}-ACCEPT`,
      from: alicePkHex,
      to: bobPkHex,
      ts: Date.now(),
      payload: { action: "ACCEPT", negotiationId: id, signed },
    } as never;
    events = [];

    await negotiationService.handleEnvelope(envelope);
    await negotiationService.handleEnvelope(envelope); // duplicado

    expect(getSession(id)?.state).toBe("ACCEPTED");
    expect(eventTypes().filter((t) => t === "accepted")).toHaveLength(1);
  });

  it("expiración durante el intento → no se envía, sesión a EXPIRED", async () => {
    const id = await proposeSession("expiry", 120); // expira en 120ms
    await new Promise((r) => setTimeout(r, 250)); // deja que expire
    let calls = 0;
    sendImpl = async () => {
      calls++;
      return true;
    };
    events = [];

    const res = await negotiationService.acceptSession(id);

    expect(res).toEqual({ sent: false, reason: "expired" });
    expect(calls).toBe(0); // jamás se intenta enviar una respuesta expirada
    expect(getSession(id)?.state).toBe("EXPIRED");
    expect(eventTypes()).toContain("expired");
    expect(eventTypes()).not.toContain("accepted");
  });

  it("segundo accept tras ACCEPTED → invalid_transition", async () => {
    const id = await proposeSession("terminal");
    await negotiationService.acceptSession(id);
    events = [];

    const res = await negotiationService.acceptSession(id);

    expect(res).toEqual({ sent: false, reason: "invalid_transition" });
    expect(getSession(id)?.state).toBe("ACCEPTED");
    expect(sentPayloads).toHaveLength(1); // no se firmó ni envió de más
  });

  it("retry no resucita una sesión que el peer ya cerró", async () => {    const id = await proposeSession("peer-closed");
    sendImpl = async () => false;
    await negotiationService.acceptSession(id); // queda pendiente
    expect(getSession(id)?.pendingSend).toBeDefined();

    // El peer declina mientras tanto (su mensaje sí llega)
    const session = getSession(id)!;
    const peerDecline = signNegotiationMessage(
      aliceKeys.secretKey,
      alicePkHex,
      "DECLINE",
      session.proposal.proposalId,
      { reason: "ya no" }
    );
    await negotiationService.handleEnvelope({
      v: PROTOCOL_VERSION,
      type: "negotiation" as P2PMessageType,
      id: `msg-${id}-DECLINE`,
      from: alicePkHex,
      to: bobPkHex,
      ts: Date.now(),
      payload: { action: "DECLINE", negotiationId: id, signed: peerDecline },
    } as never);
    expect(getSession(id)?.state).toBe("DECLINED");

    // El retry no tiene nada que reintentar: la respuesta entrante del peer
    // limpió el pendiente al cerrar la sesión. El estado jamás resucita.
    sendImpl = async () => true;
    const res = await negotiationService.retrySend(id);
    expect(res.sent).toBe(false);
    expect(res.reason).toBe("no_pending_send");
    expect(getSession(id)?.state).toBe("DECLINED");
    expect(getSession(id)?.pendingSend).toBeUndefined();
  });

  it("ACCEPT tardío sobre propuesta expirada → EXPIRED, sin transición", async () => {
    const id = await proposeSession("late-accept", 120);
    await new Promise((r) => setTimeout(r, 250)); // la propuesta expira
    const session = getSession(id)!;
    expect(session.state).toBe("PROPOSED"); // aún no podada

    const lateAccept = signNegotiationMessage(
      aliceKeys.secretKey,
      alicePkHex,
      "ACCEPT",
      session.proposal.proposalId,
      session.proposal
    );
    events = [];
    await negotiationService.handleEnvelope({
      v: PROTOCOL_VERSION,
      type: "negotiation" as P2PMessageType,
      id: `msg-${id}-LATE-ACCEPT`,
      from: alicePkHex,
      to: bobPkHex,
      ts: Date.now(),
      payload: { action: "ACCEPT", negotiationId: id, signed: lateAccept },
    } as never);

    expect(getSession(id)?.state).toBe("EXPIRED");
    expect(eventTypes()).toContain("expired");
    expect(eventTypes()).not.toContain("accepted");
  });

  it("COUNTER tardío sobre propuesta expirada → EXPIRED, sin transición", async () => {
    const id = await proposeSession("late-counter", 120);
    await new Promise((r) => setTimeout(r, 250));
    const session = getSession(id)!;

    const lateCounter = signNegotiationMessage(
      aliceKeys.secretKey,
      alicePkHex,
      "COUNTER",
      session.proposal.proposalId,
      { ...session.proposal, requestedScopes: ["read:notes"] }
    );
    events = [];
    await negotiationService.handleEnvelope({
      v: PROTOCOL_VERSION,
      type: "negotiation" as P2PMessageType,
      id: `msg-${id}-LATE-COUNTER`,
      from: alicePkHex,
      to: bobPkHex,
      ts: Date.now(),
      payload: { action: "COUNTER", negotiationId: id, signed: lateCounter },
    } as never);

    expect(getSession(id)?.state).toBe("EXPIRED");
    expect(eventTypes()).not.toContain("counter_received");
  });

  it("respuesta entrante limpia el pendingSend al cerrar la sesión", async () => {
    const id = await proposeSession("incoming-clears-pending");
    sendImpl = async () => false;
    await negotiationService.acceptSession(id); // ACCEPT no entregado
    expect(getSession(id)?.pendingSend).toBeDefined();

    // El peer declina (lado proponente simulado): al cerrar, el pendiente muere.
    const session = getSession(id)!;
    const peerDecline = signNegotiationMessage(
      aliceKeys.secretKey,
      alicePkHex,
      "DECLINE",
      session.proposal.proposalId,
      { reason: "no" }
    );
    await negotiationService.handleEnvelope({
      v: PROTOCOL_VERSION,
      type: "negotiation" as P2PMessageType,
      id: `msg-${id}-DECLINE2`,
      from: alicePkHex,
      to: bobPkHex,
      ts: Date.now(),
      payload: { action: "DECLINE", negotiationId: id, signed: peerDecline },
    } as never);

    expect(getSession(id)?.state).toBe("DECLINED");
    expect(getSession(id)?.pendingSend).toBeUndefined();
    const res = await negotiationService.retrySend(id);
    expect(res).toEqual({ sent: false, reason: "no_pending_send" });
  });
});
