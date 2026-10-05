/**
 * negotiationService.ts — NIDO P2P: Servicio de negociación en producción.
 *
 * Conecta el transporte P2P (NidoMessenger) con la UI (NegotiationCard,
 * ApprovalCard). Es el router real que faltaba: antes processIncomingProposal()
 * tenía cero callers.
 *
 * Flujo:
 * 1. NidoMessenger.handleFrame() recibe envelope type="negotiation"
 * 2. Llama a NegotiationService.getInstance().handleEnvelope()
 * 3. El servicio valida firma/replay/expiry via negotiation.ts
 * 4. Actualiza la state machine
 * 5. Emite eventos para la UI suscrita
 *
 * NO es un demo. Es el wiring de producción.
 */

import type { P2PEnvelope, NegotiationPayload } from "./protocol";
import type {
  TaskProposal,
  SignedNegotiationMessage,
  NegotiationState,
  NegotiationMessageType,
} from "./negotiation";
import {
  verifyProposal,
  verifyNegotiationMessage,
  isExpired,
  signNegotiationMessage,
  createCounter,
  isValidTransition,
} from "./negotiation";
import { globalReplayProtection } from "./replayProtection";
import { processIncomingProposal, type ProposalOutcome } from "./p2pApprovalBridge";
import { fromHex, toHex } from "./crypto";
import { getSigningKeypair } from "./store";

/** Estados de una negociación activa. */
export interface NegotiationSession {
  negotiationId: string;
  proposalId: string;
  peerPkHex: string;
  state: NegotiationState;
  proposal: TaskProposal;
  updatedAt: number;
}

/** Eventos que emite el servicio para la UI. */
export type NegotiationEvent =
  | { type: "proposal_received"; session: NegotiationSession }
  | { type: "counter_received"; session: NegotiationSession }
  | { type: "accepted"; session: NegotiationSession }
  | { type: "declined"; session: NegotiationSession; reason?: string }
  | { type: "expired"; session: NegotiationSession }
  | { type: "ask_required"; session: NegotiationSession; taskId: string };

type NegotiationEventHandler = (event: NegotiationEvent) => void;

/** Función de envío inyectada (normalmente NidoMessenger.sendNegotiationResponse). */
export type NegotiationSendFn = (
  peerPkHex: string,
  action: "ACCEPT" | "DECLINE" | "COUNTER",
  negotiationId: string,
  signed: Record<string, unknown>
) => Promise<boolean>;

/**
 * Servicio singleton de negociación.
 * El messenger lo usa para routear mensajes; la UI se suscribe a eventos.
 */
class NegotiationService {
  private static instance: NegotiationService | null = null;
  private sessions = new Map<string, NegotiationSession>();
  private handlers = new Set<NegotiationEventHandler>();
  private myPkHex: string | null = null;
  private sendFn: NegotiationSendFn | null = null;

  static getInstance(): NegotiationService {
    if (!NegotiationService.instance) {
      NegotiationService.instance = new NegotiationService();
    }
    return NegotiationService.instance;
  }

  /** Configura la identidad local (para verificar recipient). */
  setLocalIdentity(pkHex: string): void {
    this.myPkHex = pkHex.toLowerCase();
  }

  /**
   * Inyecta la función de envío (típicamente conectada a
   * NidoMessenger.sendNegotiationResponse). Sin esto, accept/decline/counter
   * actualizan el estado local pero no envían al peer.
   */
  setSendFunction(fn: NegotiationSendFn): void {
    this.sendFn = fn;
  }

  /** La UI se suscribe a eventos de negociación. */
  subscribe(handler: NegotiationEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  private emit(event: NegotiationEvent): void {
    for (const h of this.handlers) {
      try {
        h(event);
      } catch {
        // Un handler roto no debe tumbar el servicio
      }
    }
  }

  /** Lista las negociaciones activas (para la UI). */
  listSessions(): NegotiationSession[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt
    );
  }

  /**
   * Acepta una negociación: crea un mensaje ACCEPT firmado y lo envía al peer.
   * Actualiza el estado local a ACCEPTED. Retorna true si se envió al peer,
   * false si solo se actualizó localmente (sin transporte).
   */
  async acceptSession(negotiationId: string): Promise<boolean> {
    const session = this.sessions.get(negotiationId);
    if (!session) return false;
    if (!isValidTransition(session.state, "ACCEPTED")) return false;

    let sent = false;
    if (this.sendFn) {
      try {
        const kp = await getSigningKeypair();
        const myPkHex = toHex(kp.publicKey);
        const signed = signNegotiationMessage(
          kp.secretKey,
          myPkHex,
          "ACCEPT",
          session.proposalId,
          session.proposal
        );
        sent = await this.sendFn(
          session.peerPkHex,
          "ACCEPT",
          negotiationId,
          signed as unknown as Record<string, unknown>
        );
      } catch {
        sent = false;
      }
    }

    session.state = "ACCEPTED";
    session.updatedAt = Date.now();
    this.emit({ type: "accepted", session });
    return sent;
  }

  /**
   * Rechaza una negociación: crea un mensaje DECLINE firmado y lo envía al peer.
   * Actualiza el estado local a DECLINED.
   */
  async declineSession(negotiationId: string, reason?: string): Promise<boolean> {
    const session = this.sessions.get(negotiationId);
    if (!session) return false;
    if (!isValidTransition(session.state, "DECLINED")) return false;

    let sent = false;
    if (this.sendFn) {
      try {
        const kp = await getSigningKeypair();
        const myPkHex = toHex(kp.publicKey);
        const signed = signNegotiationMessage(
          kp.secretKey,
          myPkHex,
          "DECLINE",
          session.proposalId,
          reason ? { reason } : {}
        );
        sent = await this.sendFn(
          session.peerPkHex,
          "DECLINE",
          negotiationId,
          signed as unknown as Record<string, unknown>
        );
      } catch {
        sent = false;
      }
    }

    session.state = "DECLINED";
    session.updatedAt = Date.now();
    this.emit({ type: "declined", session, reason });
    return sent;
  }

  /**
   * Contrapropone: crea una propuesta modificada con los scopes seleccionados,
   * la firma y la envía al peer como COUNTER. Actualiza el estado local.
   */
  async counterSession(
    negotiationId: string,
    modifiedScopes: string[]
  ): Promise<boolean> {
    const session = this.sessions.get(negotiationId);
    if (!session) return false;
    if (!isValidTransition(session.state, "COUNTERED")) return false;

    let sent = false;
    // Crear la contrapropuesta (misma propuesta pero con scopes modificados)
    const counterProposal: TaskProposal = {
      ...session.proposal,
      requestedScopes: modifiedScopes,
    };

    if (this.sendFn) {
      try {
        const kp = await getSigningKeypair();
        const myPkHex = toHex(kp.publicKey);
        const signed = signNegotiationMessage(
          kp.secretKey,
          myPkHex,
          "COUNTER",
          session.proposalId,
          counterProposal
        );
        sent = await this.sendFn(
          session.peerPkHex,
          "COUNTER",
          negotiationId,
          signed as unknown as Record<string, unknown>
        );
      } catch {
        sent = false;
      }
    }

    session.proposal = counterProposal;
    session.state = "COUNTERED";
    session.updatedAt = Date.now();
    this.emit({ type: "counter_received", session });
    return sent;
  }

  /**
   * Punto de entrada desde NidoMessenger.handleFrame().
   * Routea por action y actualiza la state machine.
   */
  async handleEnvelope(env: P2PEnvelope): Promise<void> {
    if (env.type !== "negotiation") return;

    const payload = env.payload as unknown as NegotiationPayload;
    if (!payload || typeof payload.action !== "string") return;

    const { action, negotiationId, signed } = payload;
    if (!negotiationId || !signed) return;

    switch (action) {
      case "PROPOSE":
        await this.handlePropose(env, negotiationId, signed as unknown as SignedNegotiationMessage);
        break;
      case "COUNTER":
        await this.handleCounter(env, negotiationId, signed as unknown as SignedNegotiationMessage);
        break;
      case "ACCEPT":
        await this.handleAccept(env, negotiationId, signed as unknown as SignedNegotiationMessage);
        break;
      case "DECLINE":
        await this.handleDecline(env, negotiationId, signed as unknown as SignedNegotiationMessage);
        break;
      case "EXPIRE":
        this.handleExpire(negotiationId);
        break;
      default:
        // Acción desconocida: se ignora (fail-closed)
        break;
    }
  }

  private async handlePropose(
    env: P2PEnvelope,
    negotiationId: string,
    signed: SignedNegotiationMessage
  ): Promise<void> {
    // 1. Verificar que el mensaje es para nosotros
    const proposal = signed.payload as TaskProposal;
    if (!proposal || typeof proposal !== "object") return;
    if (this.myPkHex && proposal.recipientPkHex.toLowerCase() !== this.myPkHex) {
      return; // No somos el destinatario: se ignora
    }

    // 2. Verificar firma del mensaje
    const signerBytes = fromHex(signed.signerPkHex);
    if (!verifyNegotiationMessage(signed, signerBytes)) return;

    // 3. Verificar que la propuesta interna también está firmada
    const proposerBytes = fromHex(proposal.proposerPkHex);
    if (!verifyProposal(proposal, proposerBytes)) return;

    // 4. Anti-replay (nonce del mensaje)
    if (!globalReplayProtection.checkAndRecord(signed.nonce)) return;

    // 5. Expiry
    if (isExpired(proposal)) {
      // Ya expiró al llegar: se marca como expirada
      const session: NegotiationSession = {
        negotiationId,
        proposalId: proposal.proposalId,
        peerPkHex: proposal.proposerPkHex,
        state: "EXPIRED",
        proposal,
        updatedAt: Date.now(),
      };
      this.sessions.set(negotiationId, session);
      this.emit({ type: "expired", session });
      return;
    }

    // 6. Procesar via el bridge (policy evaluation → AUTO/ASK/DENY)
    const outcome: ProposalOutcome = await processIncomingProposal(
      proposal,
      proposerBytes,
      async () => {
        // queueFn: por ahora retorna un taskId sintético.
        // La integración con el Approval Inbox real se hace en FASE 3.
        return `p2p-${proposal.proposalId}`;
      }
    );

    const session: NegotiationSession = {
      negotiationId,
      proposalId: proposal.proposalId,
      peerPkHex: proposal.proposerPkHex,
      state: "PROPOSED",
      proposal,
      updatedAt: Date.now(),
    };
    this.sessions.set(negotiationId, session);

    if (outcome.action === "auto_accept") {
      session.state = "ACCEPTED";
      session.updatedAt = Date.now();
      this.emit({ type: "accepted", session });
    } else if (outcome.action === "queued_for_approval") {
      // La UI debe mostrar ApprovalCard
      this.emit({ type: "ask_required", session, taskId: outcome.taskId });
      // También se emite proposal_received para que la UI muestre el contexto
      this.emit({ type: "proposal_received", session });
    } else {
      session.state = "DECLINED";
      session.updatedAt = Date.now();
      this.emit({ type: "declined", session, reason: outcome.reason });
    }
  }

  private async handleCounter(
    env: P2PEnvelope,
    negotiationId: string,
    signed: SignedNegotiationMessage
  ): Promise<void> {
    const session = this.sessions.get(negotiationId);
    if (!session) return; // Sin sesión: se ignora
    if (session.state !== "PROPOSED" && session.state !== "COUNTERED") return;

    const signerBytes = fromHex(signed.signerPkHex);
    if (!verifyNegotiationMessage(signed, signerBytes)) return;
    if (!globalReplayProtection.checkAndRecord(signed.nonce)) return;

    const counterProposal = signed.payload as TaskProposal;
    if (!counterProposal || typeof counterProposal !== "object") return;

    session.proposal = counterProposal;
    session.state = "COUNTERED";
    session.updatedAt = Date.now();
    this.emit({ type: "counter_received", session });
  }

  private async handleAccept(
    env: P2PEnvelope,
    negotiationId: string,
    signed: SignedNegotiationMessage
  ): Promise<void> {
    const session = this.sessions.get(negotiationId);
    if (!session) return;
    if (session.state !== "PROPOSED" && session.state !== "COUNTERED") return;

    const signerBytes = fromHex(signed.signerPkHex);
    if (!verifyNegotiationMessage(signed, signerBytes)) return;
    if (!globalReplayProtection.checkAndRecord(signed.nonce)) return;

    session.state = "ACCEPTED";
    session.updatedAt = Date.now();
    this.emit({ type: "accepted", session });
  }

  private async handleDecline(
    env: P2PEnvelope,
    negotiationId: string,
    signed: SignedNegotiationMessage
  ): Promise<void> {
    const session = this.sessions.get(negotiationId);
    if (!session) return;

    const signerBytes = fromHex(signed.signerPkHex);
    if (!verifyNegotiationMessage(signed, signerBytes)) return;
    if (!globalReplayProtection.checkAndRecord(signed.nonce)) return;

    const payload = signed.payload as { reason?: string };
    session.state = "DECLINED";
    session.updatedAt = Date.now();
    this.emit({
      type: "declined",
      session,
      reason: typeof payload?.reason === "string" ? payload.reason : undefined,
    });
  }

  private handleExpire(negotiationId: string): void {
    const session = this.sessions.get(negotiationId);
    if (!session) return;
    // EXPIRE es determinista por tiempo: cualquiera puede notificarlo,
    // pero solo se aplica si realmente expiró.
    if (!isExpired(session.proposal)) return;
    session.state = "EXPIRED";
    session.updatedAt = Date.now();
    this.emit({ type: "expired", session });
  }

  /** Limpia sesiones en estado terminal (para la UI). */
  pruneTerminal(): void {
    for (const [id, s] of this.sessions) {
      if (s.state === "ACCEPTED" || s.state === "DECLINED" || s.state === "EXPIRED") {
        // Se mantienen 1 hora para que la UI muestre el estado final
        if (Date.now() - s.updatedAt > 3600000) {
          this.sessions.delete(id);
        }
      }
    }
  }
}

export const negotiationService = NegotiationService.getInstance();
