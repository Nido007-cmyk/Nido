/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

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
import { getSigningKeypair, findContactByPk } from "./store";

/**
 * R3 FIX 2026-10-08: resuelve la clave de firma Ed25519 establecida por QR
 * para un peer, dada su clave de identidad de transporte (X25519).
 * Por defecto lee el contacto emparejado; inyectable en tests para no tocar
 * SQLite.
 */
export type PeerSigPkResolver = (
  peerIdentityPkHex: string
) => Promise<string | null>;

/** Estados de una negociación activa. */
export interface NegotiationSession {
  negotiationId: string;
  proposalId: string;
  peerPkHex: string;
  state: NegotiationState;
  proposal: TaskProposal;
  updatedAt: number;
  /**
   * Respuesta firmada construida por acción del usuario pero aún NO confirmada
   * como entregada al transporte. Mientras exista, la sesión NO ha cambiado
   * de estado visible: el usuario ve "No enviado / Reintentar".
   * Se reutilizan los mismos bytes firmados (mismo nonce) en cada reintento,
   * así el receptor descarta duplicados por su protección anti-replay.
   */
  pendingSend?: PendingSend;
  /**
   * Guardia anti-doble-tap a nivel servicio: true mientras hay un intento
   * de envío en vuelo para esta sesión. No se persiste.
   */
  sending?: boolean;
}

/** Respuesta firmada pendiente de confirmación de entrega. */
export interface PendingSend {
  action: "ACCEPT" | "DECLINE" | "COUNTER";
  targetState: NegotiationState;
  signed: SignedNegotiationMessage;
  attempts: number;
  lastError: RespondFailureReason;
  updatedAt: number;
}

/** Motivos honestos por los que una respuesta no se marcó como enviada. */
export type RespondFailureReason =
  | "no_session"
  | "invalid_transition"
  | "expired"
  | "no_send_function"
  | "send_rejected"
  | "send_threw"
  | "already_sending"
  | "no_pending_send";

/** Resultado honesto de accept/decline/counter/retry. */
export interface RespondResult {
  /** true solo si el mensaje firmado fue aceptado por el transporte. */
  sent: boolean;
  reason?: RespondFailureReason;
}

/** Eventos que emite el servicio para la UI. */
export type NegotiationEvent =
  | { type: "proposal_received"; session: NegotiationSession }
  | { type: "counter_received"; session: NegotiationSession }
  | { type: "accepted"; session: NegotiationSession }
  | { type: "declined"; session: NegotiationSession; reason?: string }
  | { type: "expired"; session: NegotiationSession }
  | { type: "proposed"; session: NegotiationSession }
  | { type: "ask_required"; session: NegotiationSession; taskId: string }
  | {
      type: "send_failed";
      session: NegotiationSession;
      action: "ACCEPT" | "DECLINE" | "COUNTER" | "PROPOSE";
      reason: RespondFailureReason;
    };

type NegotiationEventHandler = (event: NegotiationEvent) => void;

/** Función de envío inyectada (normalmente NidoMessenger.sendNegotiationResponse). */
export type NegotiationSendFn = (
  peerPkHex: string,
  action: "ACCEPT" | "DECLINE" | "COUNTER" | "PROPOSE",
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
  private peerSigPkResolver: PeerSigPkResolver = async (peerIdentityPkHex) => {
    const contact = await findContactByPk(peerIdentityPkHex);
    return contact?.sigPkHex ?? null;
  };

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
   * R3: reemplaza el resolver de clave de firma del peer (tests).
   * En producción siempre se usa el contacto emparejado por QR.
   */
  setPeerSigPkResolver(fn: PeerSigPkResolver): void {
    this.peerSigPkResolver = fn;
  }

  /**
   * R3 FIX 2026-10-08: verifica que la clave que firma el mensaje de
   * negociación sea la identidad Ed25519 establecida por QR para este peer,
   * no una clave auto-declarada. Sin este anclaje, la firma Ed25519 no aporta
   * seguridad marginal sobre la clave de sesión: ante compromiso de la clave
   * de sesión, un atacante forjaría PROPOSE/ACCEPT/COUNTER con una clave
   * Ed25519 fresca y la firma "verificaría". Fail-closed: sin contacto o sin
   * coincidencia → false.
   */
  private async isPinnedSigner(
    peerIdentityPkHex: string,
    claimedSignerPkHex: string
  ): Promise<boolean> {
    let pinned: string | null;
    try {
      pinned = await this.peerSigPkResolver(peerIdentityPkHex);
    } catch {
      return false;
    }
    if (!pinned) return false;
    return pinned.toLowerCase() === claimedSignerPkHex.toLowerCase();
  }

  /**
   * Inyecta la función de envío (típicamente conectada a
   * NidoMessenger.sendNegotiationResponse). Sin esto, accept/decline/counter
   * registran la respuesta como pendiente (evento `send_failed`) y NO cambian
   * el estado visible: modelo fail-closed.
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
   * OUTGOING-2026-10-08: true si la propuesta la creamos nosotros (saliente).
   * La UI lo necesita para no renderizar nuestras propias propuestas como
   * "X wants to collaborate" con botones Accept/Decline — bug reportado con
   * screenshots: la propuesta se veía como entrante en ambas tablets.
   */
  isOutgoing(session: NegotiationSession): boolean {
    if (!this.myPkHex) return false;
    return session.proposal.proposerPkHex.toLowerCase() === this.myPkHex;
  }

  /**
   * Modelo de entrega fail-closed (requisito del UI/UX gate):
   *
   *   acción del usuario → construir transición → firmar →
   *   intentar envío → confirmar resultado → commit del estado visible
   *
   * El estado visible de la sesión SOLO cambia cuando el transporte acepta
   * el mensaje firmado. Si el envío falla, la sesión conserva su estado
   * anterior y guarda la respuesta firmada en `pendingSend` para reintentar
   * de forma segura (mismos bytes, mismo nonce → sin duplicados en el peer).
   * La UI muestra "No enviado / Reintentar" vía el evento `send_failed`.
   *
   * "sent: true" significa: el transporte P2P vivo aceptó el sobre para este
   * peer. No es un ACK extremo a extremo del peer (eso requeriría protocolo
   * adicional); es la afirmación honesta máxima en esta capa.
   */
  async acceptSession(negotiationId: string): Promise<RespondResult> {
    return this.respond(negotiationId, "ACCEPT", "ACCEPTED", (session) => session.proposal);
  }

  /**
   * Rechaza una negociación: construye el DECLINE firmado y solo commitea
   * DECLINED si el transporte lo acepta.
   */
  async declineSession(negotiationId: string, reason?: string): Promise<RespondResult> {
    return this.respond(negotiationId, "DECLINE", "DECLINED", () =>
      reason ? { reason } : {}
    );
  }

  /**
   * NEGOTIATION-INIT 2026-10-07: propone una colaboración a un peer.
   * Crea la propuesta firmada y la envía vía el sendFn. El recipient la
   * verá en su tab Negotiations para aceptar/rechazar.
   */
  async proposeTo(
    recipientPkHex: string,
    taskDescription: string,
    requestedScopes: string[] = ["send:message"]
  ): Promise<{ sent: boolean; proposalId?: string; reason?: string }> {
    if (!this.sendFn) {
      return { sent: false, reason: "no_send_fn" };
    }
    if (!this.myPkHex) {
      return { sent: false, reason: "no_identity" };
    }
    const desc = taskDescription.trim();
    if (!desc) {
      return { sent: false, reason: "empty_description" };
    }
    try {
      const kp = await getSigningKeypair();
      const myPkHex = toHex(kp.publicKey);
      const { createProposal, signNegotiationMessage } = await import("./negotiation");
      const proposal = createProposal(
        kp.secretKey,
        myPkHex,
        recipientPkHex.toLowerCase(),
        desc,
        requestedScopes,
        {}
      );
      // P2P-1 FIX 2026-10-07: envolver la propuesta en SignedNegotiationMessage
      // vía signNegotiationMessage, como hace respond() para ACCEPT/DECLINE/COUNTER.
      // Antes se pasaba la TaskProposal cruda y handlePropose la descartaba en silencio.
      const signed = signNegotiationMessage(
        kp.secretKey,
        myPkHex,
        "PROPOSE",
        proposal.proposalId,
        proposal
      );
      // Registrar la sesión local como PROPOSED (saliente).
      const session: NegotiationSession = {
        negotiationId: proposal.proposalId,
        proposalId: proposal.proposalId,
        peerPkHex: recipientPkHex.toLowerCase(),
        proposal,
        state: "PROPOSED",
        updatedAt: Date.now(),
        sending: true,
      };
      this.sessions.set(proposal.proposalId, session);
      // Enviar vía el transporte.
      let sent = false;
      try {
        sent = await this.sendFn(
          recipientPkHex.toLowerCase(),
          "PROPOSE",
          proposal.proposalId,
          signed as unknown as Record<string, unknown>
        );
      } catch {
        // M2 FIX: si sendFn lanza, limpiar la sesión. Antes quedaba colgada
        // en PROPOSED con sending:true para siempre.
        this.sessions.delete(proposal.proposalId);
        return { sent: false, reason: "send_threw" };
      }
      session.sending = false;
      if (!sent) {
        this.sessions.delete(proposal.proposalId);
        return { sent: false, reason: "send_failed" };
      }
      this.emit({ type: "proposed", session });
      return { sent: true, proposalId: proposal.proposalId };
    } catch {
      return { sent: false, reason: "send_threw" };
    }
  }

  /**
   * Contrapropone: construye la propuesta modificada, la firma y solo
   * commitea COUNTERED (y la propuesta modificada) si el transporte acepta.
   */
  async counterSession(
    negotiationId: string,
    modifiedScopes: string[]
  ): Promise<RespondResult> {
    return this.respond(negotiationId, "COUNTER", "COUNTERED", (session) => ({
      ...session.proposal,
      requestedScopes: modifiedScopes,
    }));
  }

  /**
   * Reintenta una respuesta pendiente con los mismos bytes firmados.
   * Seguro contra duplicados: el receptor descarta el nonce ya visto.
   */
  async retrySend(negotiationId: string): Promise<RespondResult> {
    const session = this.sessions.get(negotiationId);
    const pending = session?.pendingSend;
    if (!session || !pending) return { sent: false, reason: "no_pending_send" };
    if (session.sending) return { sent: false, reason: "already_sending" };
    if (isExpired(session.proposal)) {
      session.pendingSend = undefined;
      this.expireSession(session);
      return { sent: false, reason: "expired" };
    }
    if (!isValidTransition(session.state, pending.targetState)) {
      // El peer (o el tiempo) movió la sesión mientras el envío estaba
      // pendiente: la respuesta ya no es significativa. No se envía nada
      // y no se sobrescribe el estado terminal alcanzado.
      session.pendingSend = undefined;
      session.updatedAt = Date.now();
      return { sent: false, reason: "invalid_transition" };
    }
    session.sending = true;
    try {
      const result = await this.attemptSend(session, pending);
      if (result.sent) {
        this.commitPending(session, pending);
      } else {
        pending.attempts += 1;
        pending.lastError = result.reason as RespondFailureReason;
        pending.updatedAt = Date.now();
        this.emit({
          type: "send_failed",
          session,
          action: pending.action,
          reason: result.reason as RespondFailureReason,
        });
      }
      return result;
    } finally {
      session.sending = false;
    }
  }

  /**
   * Núcleo del modelo fail-closed. Construye y firma la respuesta una sola
   * vez; el commit del estado visible ocurre solo si el envío se confirma.
   */
  private async respond(
    negotiationId: string,
    action: "ACCEPT" | "DECLINE" | "COUNTER",
    targetState: NegotiationState,
    buildPayload: (session: NegotiationSession) => TaskProposal | { reason?: string }
  ): Promise<RespondResult> {
    const session = this.sessions.get(negotiationId);
    if (!session) return { sent: false, reason: "no_session" };
    if (session.sending) return { sent: false, reason: "already_sending" };
    if (session.pendingSend) {
      // Ya hay una respuesta pendiente: el camino honesto es reintentar,
      // no apilar una segunda respuesta.
      return { sent: false, reason: "already_sending" };
    }
    if (!isValidTransition(session.state, targetState)) {
      return { sent: false, reason: "invalid_transition" };
    }
    if (isExpired(session.proposal)) {
      this.expireSession(session);
      return { sent: false, reason: "expired" };
    }

    session.sending = true;
    try {
      let signed: SignedNegotiationMessage;
      try {
        const kp = await getSigningKeypair();
        const myPkHex = toHex(kp.publicKey);
        signed = signNegotiationMessage(
          kp.secretKey,
          myPkHex,
          action,
          session.proposalId,
          buildPayload(session)
        );
      } catch {
        return { sent: false, reason: "send_threw" };
      }

      const pending: PendingSend = {
        action,
        targetState,
        signed,
        attempts: 0,
        lastError: "send_rejected",
        updatedAt: Date.now(),
      };
      const result = await this.attemptSend(session, pending);
      if (result.sent) {
        this.commitPending(session, pending);
      } else {
        pending.attempts = 1;
        pending.lastError = result.reason as RespondFailureReason;
        pending.updatedAt = Date.now();
        session.pendingSend = pending;
        session.updatedAt = Date.now();
        this.emit({
          type: "send_failed",
          session,
          action,
          reason: result.reason as RespondFailureReason,
        });
      }
      return result;
    } finally {
      session.sending = false;
    }
  }

  /** Intenta entregar los bytes firmados al transporte. No muta estado. */
  private async attemptSend(
    session: NegotiationSession,
    pending: PendingSend
  ): Promise<RespondResult> {
    if (!this.sendFn) return { sent: false, reason: "no_send_function" };
    try {
      const sent = await this.sendFn(
        session.peerPkHex,
        pending.action,
        session.negotiationId,
        pending.signed as unknown as Record<string, unknown>
      );
      return sent ? { sent: true } : { sent: false, reason: "send_rejected" };
    } catch {
      return { sent: false, reason: "send_threw" };
    }
  }

  /**
   * Commit del estado visible. Solo se llama con envío confirmado.
   * Revalida la transición: si el peer movió la sesión a terminal mientras
   * tanto, no se sobrescribe (el peer ignora respuestas tardías por diseño).
   */
  private commitPending(session: NegotiationSession, pending: PendingSend): void {
    if (!isValidTransition(session.state, pending.targetState)) {
      session.pendingSend = undefined;
      session.updatedAt = Date.now();
      return;
    }
    if (pending.action === "COUNTER") {
      session.proposal = pending.signed.payload as TaskProposal;
    }
    session.state = pending.targetState;
    session.pendingSend = undefined;
    session.updatedAt = Date.now();
    if (pending.action === "ACCEPT") {
      this.emit({ type: "accepted", session });
    } else if (pending.action === "DECLINE") {
      const payload = pending.signed.payload as { reason?: string };
      this.emit({
        type: "declined",
        session,
        reason: typeof payload?.reason === "string" ? payload.reason : undefined,
      });
    } else {
      this.emit({ type: "counter_received", session });
    }
  }

  /** Marca una sesión como expirada (determinista por tiempo). */
  private expireSession(session: NegotiationSession): void {
    session.pendingSend = undefined;
    session.state = "EXPIRED";
    session.updatedAt = Date.now();
    this.emit({ type: "expired", session });
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
    // M3 FIX: fromHex lanza ante hex malformado; descartar fail-closed en vez
    // de propagar la excepción (que saltaría flushOutbox en el llamador).
    let signerBytes: Uint8Array;
    try {
      signerBytes = fromHex(signed.signerPkHex);
    } catch {
      return;
    }
    if (!verifyNegotiationMessage(signed, signerBytes)) return;

    // 3. Verificar que la propuesta interna también está firmada
    let proposerBytes: Uint8Array;
    try {
      proposerBytes = fromHex(proposal.proposerPkHex);
    } catch {
      return;
    }
    if (!verifyProposal(proposal, proposerBytes)) return;

    // 4. Anti-replay (nonce del mensaje)
    if (!globalReplayProtection.checkAndRecord(signed.nonce)) return;

    // R2 FIX 2026-10-08: el negotiationId lo elige el proponente. Sin este
    // cheque, un segundo PROPOSE con el mismo ID (nonce fresco, firma válida)
    // reemplazaría silenciosamente la propuesta que el usuario está revisando
    // (proposal swap: aprueba la v1, se ejecuta la v2). Fail-closed: se
    // rechaza el duplicado; un proponente legítimo usa un ID nuevo.
    if (this.sessions.has(negotiationId)) return;

    // R3: anclar la firma a la identidad verificada por QR (ver isPinnedSigner).
    if (!(await this.isPinnedSigner(env.from, signed.signerPkHex))) return;

    // 5. Expiry
    if (isExpired(proposal)) {
      // Ya expiró al llegar: se marca como expirada
      // P2P-2 FIX 2026-10-07: usar env.from (clave de identidad X25519 del transporte)
      // en vez de proposal.proposerPkHex (clave de firma Ed25519). Las sesiones de
      // transporte están indexadas por clave de identidad.
      const session: NegotiationSession = {
        negotiationId,
        proposalId: proposal.proposalId,
        peerPkHex: env.from.toLowerCase(),
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
      // P2P-2 FIX: clave de identidad del transporte (env.from), no la de firma.
      peerPkHex: env.from.toLowerCase(),
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
    // Una respuesta que llega tarde (propuesta ya expirada) no puede
    // transicionar: la sesión expira en lugar de aceptar el COUNTER.
    if (isExpired(session.proposal)) {
      this.expireSession(session);
      return;
    }

    let signerBytes: Uint8Array;
    try {
      signerBytes = fromHex(signed.signerPkHex);
    } catch {
      return; // M3: hex malformado → descartar fail-closed
    }
    if (!verifyNegotiationMessage(signed, signerBytes)) return;
    if (!globalReplayProtection.checkAndRecord(signed.nonce)) return;
    // R3: anclar la firma a la identidad verificada por QR.
    if (!(await this.isPinnedSigner(session.peerPkHex, signed.signerPkHex)))
      return;

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
    // Respuesta tardía sobre propuesta expirada: no transiciona.
    if (isExpired(session.proposal)) {
      this.expireSession(session);
      return;
    }

    let signerBytes: Uint8Array;
    try {
      signerBytes = fromHex(signed.signerPkHex);
    } catch {
      return; // M3: hex malformado → descartar fail-closed
    }
    if (!verifyNegotiationMessage(signed, signerBytes)) return;
    if (!globalReplayProtection.checkAndRecord(signed.nonce)) return;
    // R3: anclar la firma a la identidad verificada por QR.
    if (!(await this.isPinnedSigner(session.peerPkHex, signed.signerPkHex)))
      return;

    session.state = "ACCEPTED";
    session.pendingSend = undefined; // defensa: nada pendiente al cerrar
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
    // DECLINE tardío sobre propuesta expirada: EXPIRED es el estado honesto.
    if (isExpired(session.proposal)) {
      this.expireSession(session);
      return;
    }

    let signerBytes: Uint8Array;
    try {
      signerBytes = fromHex(signed.signerPkHex);
    } catch {
      return; // M3: hex malformado → descartar fail-closed
    }
    if (!verifyNegotiationMessage(signed, signerBytes)) return;
    if (!globalReplayProtection.checkAndRecord(signed.nonce)) return;
    // R3: anclar la firma a la identidad verificada por QR.
    if (!(await this.isPinnedSigner(session.peerPkHex, signed.signerPkHex)))
      return;

    const payload = signed.payload as { reason?: string };
    session.state = "DECLINED";
    session.pendingSend = undefined; // defensa: nada pendiente al cerrar
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
