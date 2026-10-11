/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * packShareService.ts — NIDO P2P: Servicio de Pack Sharing en producción.
 *
 * Conecta el transporte P2P (NidoMessenger) con la UI. Es el router que
 * faltaba: antes packSharing.ts tenía cero callers fuera de tests.
 *
 * Flujo sender:
 * 1. UI selecciona pack → packShareService.offerPack(packId, peerPkHex)
 * 2. Servicio crea sesión de envío, envía OFFER via messenger
 * 3. Receiver acepta → servicio recibe ACCEPT → envía chunks
 * 4. Receiver confirma cada chunk (CHUNK_ACK) → progreso
 * 5. Todos confirmados → envía COMPLETE → estado COMPLETE
 *
 * Flujo receiver:
 * 1. Messenger.handleFrame() recibe envelope type="pack_share", action=OFFER
 * 2. Servicio valida advertisement → emite evento offer_received
 * 3. UI muestra oferta → usuario acepta/rechaza
 * 4. Acepta → servicio envía ACCEPT → crea sesión de recepción
 * 5. Recibe CHUNK → verifica hash → almacena → envía CHUNK_ACK
 * 6. Recibe COMPLETE → reensambla → verifica SHA-256 → importa
 *
 * Seguridad:
 * - Nunca se instala un pack sin verificar SHA-256 del contenido completo.
 * - Cada chunk se verifica independientemente antes de almacenar.
 * - Advertisements malformados se rechazan (fail-closed).
 * - Sender revocado → DENY total.
 */

import type { P2PEnvelope, PackSharePayload } from "./protocol";
import type {
  PackAdvertisement,
  PackChunk,
  PackShareSession,
  PackSendSession,
} from "./packSharing";
import {
  createReceiveSession,
  addChunk,
  reassembleChunks,
  isValidAdvertisement,
  hashPackData,
  markChunkAcked,
  nextChunkToSend,
  isSendSessionTimedOut,
} from "./packSharing";
import { globalRevocationRegistry } from "./replayProtection";

/** Función para enviar un envelope pack_share (inyectada por el messenger). */
export type PackShareSendFn = (
  peerPkHex: string,
  action: PackSharePayload["action"],
  sessionId: string,
  data: Record<string, unknown>
) => Promise<void>;

/** Función para obtener los bytes de un pack (inyectada por la UI/capa de datos). */
export type PackDataProvider = (
  packId: string
) => Promise<{ base64Data: string; name: string; description: string } | null>;

/** Función para importar un pack verificado (inyectada por la capa de datos). */
export type PackImporter = (
  packId: string,
  name: string,
  base64Data: string
) => Promise<boolean>;

/** Estados unificados para la UI. */
export type PackTransferState =
  | "offered"      // Oferta pendiente (receiver) o enviada (sender)
  | "declined"
  | "sending"
  | "receiving"
  | "complete"
  | "cancelled"
  | "failed";

export interface PackTransferInfo {
  sessionId: string;
  packId: string;
  packName: string;
  peerPkHex: string;
  /** "send" = yo envío, "receive" = yo recibo */
  direction: "send" | "receive";
  state: PackTransferState;
  /** Progreso 0-1 */
  progress: number;
  /** Tamaño en bytes */
  sizeBytes: number;
  /** Error si state=failed */
  error?: string;
  updatedAt: number;
}

export type PackShareEvent =
  | { type: "offer_received"; info: PackTransferInfo; advertisement: PackAdvertisement }
  | { type: "transfer_updated"; info: PackTransferInfo }
  | { type: "transfer_complete"; info: PackTransferInfo }
  | { type: "transfer_failed"; info: PackTransferInfo; error: string }
  | { type: "offer_declined"; info: PackTransferInfo };

type PackShareEventHandler = (event: PackShareEvent) => void;

class PackShareService {
  private static instance: PackShareService | null = null;
  private sendSessions = new Map<string, PackSendSession>();
  private receiveSessions = new Map<string, PackShareSession>();
  private handlers = new Set<PackShareEventHandler>();
  private myPkHex: string | null = null;
  private sendFn: PackShareSendFn | null = null;
  private dataProvider: PackDataProvider | null = null;
  private importer: PackImporter | null = null;

  static getInstance(): PackShareService {
    if (!PackShareService.instance) {
      PackShareService.instance = new PackShareService();
    }
    return PackShareService.instance;
  }

  /**
   * ¿Está conectado el servicio (identidad, envío y proveedor de datos)?
   * PACKS-2026-10-10: en la app todavía no se conecta; la UI lo usa para
   * decir la verdad en vez de culpar a la conexión con el peer.
   */
  isReady(): boolean {
    return this.sendFn !== null && this.dataProvider !== null && this.myPkHex !== null;
  }

  /** Configura la identidad local. */
  setLocalIdentity(pkHex: string): void {
    this.myPkHex = pkHex.toLowerCase();
  }

  /** El messenger inyecta la función de envío. */
  setSendFunction(fn: PackShareSendFn): void {
    this.sendFn = fn;
  }

  /** La capa de datos inyecta el proveedor de bytes del pack. */
  setDataProvider(provider: PackDataProvider): void {
    this.dataProvider = provider;
  }

  /** La capa de datos inyecta el importador de packs verificados. */
  setImporter(importer: PackImporter): void {
    this.importer = importer;
  }

  subscribe(handler: PackShareEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  private emit(event: PackShareEvent): void {
    for (const h of this.handlers) {
      try {
        h(event);
      } catch {
        // Un handler roto no tumba el servicio
      }
    }
  }

  /** Lista todas las transferencias (para la UI). */
  listTransfers(): PackTransferInfo[] {
    const result: PackTransferInfo[] = [];
    for (const s of this.sendSessions.values()) {
      result.push(this.sendSessionToInfo(s));
    }
    for (const [sessionId, s] of this.receiveSessions) {
      result.push(this.receiveSessionToInfo(sessionId, s));
    }
    return result.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private sendSessionToInfo(s: PackSendSession): PackTransferInfo {
    const stateMap: Record<PackSendSession["state"], PackTransferState> = {
      OFFERED: "offered",
      ACCEPTED: "sending",
      DECLINED: "declined",
      COMPLETE: "complete",
      CANCELLED: "cancelled",
      FAILED: "failed",
    };
    const total = s.chunks.length;
    return {
      sessionId: s.sessionId,
      packId: s.packId,
      packName: s.advertisement.name,
      peerPkHex: s.peerPkHex,
      direction: "send",
      state: stateMap[s.state],
      progress: total === 0 ? 1 : s.acked.size / total,
      sizeBytes: s.advertisement.sizeBytes,
      updatedAt: s.lastActivityAt,
    };
  }

  private receiveSessionToInfo(
    sessionId: string,
    s: PackShareSession
  ): PackTransferInfo {
    const total = s.advertisement.chunkCount;
    const received = s.received.size;
    // Determinar estado por progreso
    let state: PackTransferState = "receiving";
    if (received === 0) state = "offered";
    else if (received === total) state = "complete";
    return {
      sessionId,
      packId: s.packId,
      packName: s.advertisement.name,
      peerPkHex: s.advertisement.senderId,
      direction: "receive",
      state,
      progress: total === 0 ? 1 : received / total,
      sizeBytes: s.advertisement.sizeBytes,
      updatedAt: s.startedAt,
    };
  }

  // ==========================================================================
  // SENDER: iniciar oferta
  // ==========================================================================

  /**
   * Inicia el envío de un pack a un peer.
   * La UI llama a esto después de que el usuario selecciona pack y peer.
   */
  async offerPack(packId: string, peerPkHex: string): Promise<string | null> {
    if (!this.sendFn || !this.dataProvider || !this.myPkHex) return null;

    // Verificar que el peer no está revocado
    if (globalRevocationRegistry.isPeerRevoked(peerPkHex)) return null;

    const packData = await this.dataProvider(packId);
    if (!packData) return null;

    const sessionId = `ps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Importar createSendSession dinámicamente para evitar ciclos
    const { createSendSession } = await import("./packSharing");
    const session = await createSendSession(
      sessionId,
      packId,
      packData.name,
      packData.description,
      packData.base64Data,
      this.myPkHex,
      peerPkHex
    );
    if (!session) return null;

    this.sendSessions.set(sessionId, session);

    // Enviar OFFER
    await this.sendFn(peerPkHex, "OFFER", sessionId, {
      advertisement: session.advertisement,
    });

    this.emit({ type: "transfer_updated", info: this.sendSessionToInfo(session) });
    return sessionId;
  }

  /**
   * Cancela un envío.
   */
  async cancelSend(sessionId: string): Promise<void> {
    const session = this.sendSessions.get(sessionId);
    if (!session || !this.sendFn) return;
    if (session.state === "COMPLETE" || session.state === "CANCELLED") return;

    session.state = "CANCELLED";
    session.lastActivityAt = Date.now();
    await this.sendFn(session.peerPkHex, "CANCEL", sessionId, {}).catch(() => {});
    this.emit({ type: "transfer_updated", info: this.sendSessionToInfo(session) });
  }

  // ==========================================================================
  // RECEIVER: aceptar/rechazar oferta
  // ==========================================================================

  /**
   * Acepta una oferta recibida. La UI llama a esto cuando el usuario acepta.
   */
  async acceptOffer(sessionId: string): Promise<boolean> {
    const session = this.receiveSessions.get(sessionId);
    if (!session || !this.sendFn) return false;

    const senderPkHex = session.advertisement.senderId;
    await this.sendFn(senderPkHex, "ACCEPT", sessionId, {});
    // El estado cambia a "receiving" cuando llegue el primer chunk
    this.emit({
      type: "transfer_updated",
      info: this.receiveSessionToInfo(sessionId, session),
    });
    return true;
  }

  /**
   * Rechaza una oferta recibida.
   */
  async declineOffer(sessionId: string): Promise<boolean> {
    const session = this.receiveSessions.get(sessionId);
    if (!session || !this.sendFn) return false;

    const senderPkHex = session.advertisement.senderId;
    await this.sendFn(senderPkHex, "DECLINE", sessionId, {}).catch(() => {});
    this.receiveSessions.delete(sessionId);
    this.emit({
      type: "offer_declined",
      info: {
        sessionId,
        packId: session.packId,
        packName: session.advertisement.name,
        peerPkHex: senderPkHex,
        direction: "receive",
        state: "declined",
        progress: 0,
        sizeBytes: session.advertisement.sizeBytes,
        updatedAt: Date.now(),
      },
    });
    return true;
  }

  // ==========================================================================
  // ROUTING: punto de entrada desde el messenger
  // ==========================================================================

  async handleEnvelope(env: P2PEnvelope): Promise<void> {
    if (env.type !== "pack_share") return;

    const payload = env.payload as unknown as PackSharePayload;
    if (!payload || typeof payload.action !== "string") return;

    const { action, sessionId, data } = payload;
    if (!sessionId || !data) return;

    // Verificar que el sender no está revocado (para mensajes entrantes)
    const senderPkHex = env.from.toLowerCase();
    if (globalRevocationRegistry.isPeerRevoked(senderPkHex)) return;

    switch (action) {
      case "OFFER":
        await this.handleOffer(env, sessionId, data);
        break;
      case "ACCEPT":
        await this.handleAccept(sessionId, senderPkHex);
        break;
      case "DECLINE":
        this.handleDecline(sessionId);
        break;
      case "CHUNK":
        await this.handleChunk(sessionId, senderPkHex, data);
        break;
      case "CHUNK_ACK":
        await this.handleChunkAck(sessionId, data);
        break;
      case "COMPLETE":
        await this.handleComplete(sessionId, senderPkHex);
        break;
      case "CANCEL":
        this.handleCancel(sessionId);
        break;
      default:
        // Acción desconocida: se ignora (fail-closed)
        break;
    }
  }

  private async handleOffer(
    env: P2PEnvelope,
    sessionId: string,
    data: Record<string, unknown>
  ): Promise<void> {
    const adv = data.advertisement as PackAdvertisement;
    if (!isValidAdvertisement(adv)) return; // Malformado: se ignora

    // Verificar que el senderId del advertisement coincide con el remitente
    if (adv.senderId.toLowerCase() !== env.from.toLowerCase()) return;

    // No aceptar ofertas duplicadas
    if (this.receiveSessions.has(sessionId)) return;

    const session = createReceiveSession(adv, this.myPkHex ?? "");
    this.receiveSessions.set(sessionId, session);

    this.emit({
      type: "offer_received",
      info: this.receiveSessionToInfo(sessionId, session),
      advertisement: adv,
    });
  }

  private async handleAccept(
    sessionId: string,
    senderPkHex: string
  ): Promise<void> {
    const session = this.sendSessions.get(sessionId);
    if (!session) return;
    if (session.state !== "OFFERED") return; // Solo se acepta una oferta pendiente
    if (session.peerPkHex !== senderPkHex) return; // Solo el peer destinatario

    session.state = "ACCEPTED";
    session.lastActivityAt = Date.now();
    this.emit({ type: "transfer_updated", info: this.sendSessionToInfo(session) });

    // Empezar a enviar chunks
    await this.sendNextChunks(sessionId);
  }

  private handleDecline(sessionId: string): void {
    const session = this.sendSessions.get(sessionId);
    if (!session) return;
    if (session.state !== "OFFERED") return;

    session.state = "DECLINED";
    session.lastActivityAt = Date.now();
    this.emit({ type: "transfer_updated", info: this.sendSessionToInfo(session) });
  }

  private async handleChunk(
    sessionId: string,
    senderPkHex: string,
    data: Record<string, unknown>
  ): Promise<void> {
    const session = this.receiveSessions.get(sessionId);
    if (!session || !this.sendFn) return;

    // Verificar que el chunk viene del sender correcto
    if (session.advertisement.senderId.toLowerCase() !== senderPkHex) return;

    const chunk = data.chunk as PackChunk;
    if (!chunk || typeof chunk !== "object") return;

    // Validar el chunk básicamente
    if (chunk.packId !== session.packId) return;
    if (typeof chunk.index !== "number" || chunk.index < 0) return;
    if (chunk.index >= session.advertisement.chunkCount) return;

    // addChunk verifica el hash del chunk y previene duplicados
    const complete = await addChunk(session, chunk);
    // Si el chunk fue inválido o duplicado, addChunk retorna false y no se confirma
    // Verificamos si realmente se almacenó
    if (!session.received.has(chunk.index)) return;

    // Enviar ACK
    await this.sendFn(senderPkHex, "CHUNK_ACK", sessionId, {
      index: chunk.index,
    }).catch(() => {});

    this.emit({
      type: "transfer_updated",
      info: this.receiveSessionToInfo(sessionId, session),
    });

    if (complete) {
      // Todos los chunks recibidos, esperar COMPLETE para verificar
      // (la verificación final se hace en handleComplete)
    }
  }

  private async handleChunkAck(
    sessionId: string,
    data: Record<string, unknown>
  ): Promise<void> {
    const session = this.sendSessions.get(sessionId);
    if (!session) return;
    if (session.state !== "ACCEPTED") return;

    const index = data.index as number;
    if (typeof index !== "number") return;

    const allAcked = markChunkAcked(session, index);
    this.emit({ type: "transfer_updated", info: this.sendSessionToInfo(session) });

    if (allAcked) {
      // Todos confirmados: enviar COMPLETE
      if (this.sendFn) {
        await this.sendFn(session.peerPkHex, "COMPLETE", sessionId, {}).catch(() => {});
      }
      session.state = "COMPLETE";
      session.lastActivityAt = Date.now();
      this.emit({ type: "transfer_complete", info: this.sendSessionToInfo(session) });
    } else {
      // Enviar el siguiente chunk
      await this.sendNextChunks(sessionId);
    }
  }

  private async handleComplete(
    sessionId: string,
    senderPkHex: string
  ): Promise<void> {
    const session = this.receiveSessions.get(sessionId);
    if (!session) return;
    if (session.advertisement.senderId.toLowerCase() !== senderPkHex) return;

    // Reensamblar y verificar SHA-256
    const chunks = Array.from(session.received.values());
    const reassembled = reassembleChunks(chunks);
    if (!reassembled) {
      this.failReceive(sessionId, session, "Chunks incompletos o desordenados");
      return;
    }

    const actualHash = await hashPackData(reassembled);
    if (actualHash !== session.advertisement.hash.toLowerCase()) {
      this.failReceive(sessionId, session, "Hash mismatch: integridad comprometida");
      return;
    }

    // ¡Integridad verificada! Importar el pack.
    if (this.importer) {
      const imported = await this.importer(
        session.packId,
        session.advertisement.name,
        reassembled
      );
      if (!imported) {
        this.failReceive(sessionId, session, "Error al importar el pack");
        return;
      }
    }

    // Éxito: limpiar la sesión y notificar
    const info = this.receiveSessionToInfo(sessionId, session);
    info.state = "complete";
    info.progress = 1;
    info.updatedAt = Date.now();
    this.receiveSessions.delete(sessionId);
    this.emit({ type: "transfer_complete", info });
  }

  private handleCancel(sessionId: string): void {
    // Puede ser sender o receiver
    const sendSession = this.sendSessions.get(sessionId);
    if (sendSession) {
      sendSession.state = "CANCELLED";
      sendSession.lastActivityAt = Date.now();
      this.emit({ type: "transfer_updated", info: this.sendSessionToInfo(sendSession) });
      return;
    }
    const recvSession = this.receiveSessions.get(sessionId);
    if (recvSession) {
      const info = this.receiveSessionToInfo(sessionId, recvSession);
      info.state = "cancelled";
      info.updatedAt = Date.now();
      this.receiveSessions.delete(sessionId);
      this.emit({ type: "transfer_updated", info });
    }
  }

  private failReceive(
    sessionId: string,
    session: PackShareSession,
    error: string
  ): void {
    const info = this.receiveSessionToInfo(sessionId, session);
    info.state = "failed";
    info.error = error;
    info.updatedAt = Date.now();
    this.receiveSessions.delete(sessionId);
    this.emit({ type: "transfer_failed", info, error });
  }

  /**
   * Envía los siguientes chunks pendientes.
   * Por simplicidad, envía de uno en uno esperando ACK (stop-and-wait).
   * Esto es más lento pero más robusto y simple de razonar.
   */
  private async sendNextChunks(sessionId: string): Promise<void> {
    const session = this.sendSessions.get(sessionId);
    if (!session || !this.sendFn) return;
    if (session.state !== "ACCEPTED") return;

    // Verificar timeout
    if (isSendSessionTimedOut(session)) {
      session.state = "FAILED";
      this.emit({
        type: "transfer_failed",
        info: this.sendSessionToInfo(session),
        error: "Timeout: sin actividad del receiver",
      });
      return;
    }

    const chunk = nextChunkToSend(session);
    if (!chunk) return; // Todos enviados, esperando ACKs

    await this.sendFn(session.peerPkHex, "CHUNK", sessionId, {
      chunk,
    }).catch(() => {
      // Error de envío: se reintentará cuando llegue el próximo ACK
      // o cuando la UI reintente manualmente
    });
  }

  /** Limpia sesiones en estado terminal (para la UI). */
  pruneTerminal(): void {
    const oneHour = 3600000;
    const now = Date.now();
    for (const [id, s] of this.sendSessions) {
      if ((s.state === "COMPLETE" || s.state === "CANCELLED" || s.state === "FAILED" || s.state === "DECLINED") &&
          now - s.lastActivityAt > oneHour) {
        this.sendSessions.delete(id);
      }
    }
    // Las sesiones de recepción se limpian al completarse/fallir
  }

  /** Para tests: acceso a las sesiones. */
  _getSendSession(sessionId: string): PackSendSession | undefined {
    return this.sendSessions.get(sessionId);
  }

  _getReceiveSession(sessionId: string): PackShareSession | undefined {
    return this.receiveSessions.get(sessionId);
  }

  /** Para tests: limpiar todo el estado. */
  _reset(): void {
    this.sendSessions.clear();
    this.receiveSessions.clear();
    this.myPkHex = null;
    this.sendFn = null;
    this.dataProvider = null;
    this.importer = null;
  }
}

export const packShareService = PackShareService.getInstance();
