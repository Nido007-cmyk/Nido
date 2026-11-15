/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * capabilityDiscovery.ts — NIDO P2P: Descubrimiento selectivo de capabilities.
 *
 * Un NIDO puede anunciar qué capabilities ofrece, pero de forma selectiva:
 * solo revela capabilities a peers autenticados, y puede filtrar por peer.
 *
 * No es un broadcast público. Es un intercambio 1-a-1 post-handshake.
 */

import nacl from "tweetnacl";
import { toHex as bytesToHex, fromHex as hexToBytes } from "./crypto";
import { canonicalSerialize } from "./negotiation";

/**
 * Descriptor de capability.
 */
export interface CapabilityDescriptor {
  /** Nombre del scope (ej: "read:notes"). */
  scope: string;
  /** Descripción humana. */
  description: string;
  /** Nivel de sensibilidad: low | medium | high. */
  sensitivity: "low" | "medium" | "high";
  /** Si requiere aprobación humana explícita (ASK). */
  requiresApproval: boolean;
}

/**
 * Anuncio de capabilities firmado.
 */
export interface CapabilityAnnouncement {
  announcerPkHex: string;
  /**
   * T-13 (m-36): el anuncio va dirigido a UN par y el destinatario va
   * DENTRO de lo firmado: un anuncio capturado no se puede redirigir a
   * otro par cambiando el campo, porque la firma dejaría de valer.
   */
  forPeerPkHex: string;
  capabilities: CapabilityDescriptor[];
  timestamp: number;
  nonce: string;
  signatureHex: string;
}

/** T-13 (m-36): ventana de frescura de un anuncio (±5 minutos). */
export const ANNOUNCEMENT_MAX_AGE_MS = 5 * 60 * 1000;
/** T-13 (m-36): tope de nonces recordados contra replay. */
const SEEN_NONCES_MAX = 1024;

/**
 * Registro local de capabilities propias.
 */
export class CapabilityRegistry {
  private capabilities = new Map<string, CapabilityDescriptor>();
  /** Peers a los que NO se les revelan ciertas capabilities. */
  private denylist = new Map<string, Set<string>>(); // peerPkHex -> set of scopes
  /**
   * T-13 (m-36): nonces de anuncios ya verificados (anunciante|nonce →
   * instante del anuncio). Un anuncio es de un solo uso: replayarlo no
   * verifica dos veces. Acotado, con poda por edad.
   */
  private seenNonces = new Map<string, number>();

  /**
   * Registra una capability local.
   */
  register(desc: CapabilityDescriptor): void {
    this.capabilities.set(desc.scope, desc);
  }

  /**
   * Oculta un scope a un peer específico.
   */
  hideFromPeer(peerPkHex: string, scope: string): void {
    const key = peerPkHex.toLowerCase();
    if (!this.denylist.has(key)) {
      this.denylist.set(key, new Set());
    }
    this.denylist.get(key)!.add(scope);
  }

  /**
   * Obtiene las capabilities visibles para un peer.
   */
  getVisibleForPeer(peerPkHex: string): CapabilityDescriptor[] {
    const hidden = this.denylist.get(peerPkHex.toLowerCase());
    const result: CapabilityDescriptor[] = [];
    for (const desc of this.capabilities.values()) {
      if (!hidden || !hidden.has(desc.scope)) {
        result.push(desc);
      }
    }
    return result;
  }

  /**
   * Crea un anuncio firmado para un peer específico.
   */
  createAnnouncement(
    secretKey: Uint8Array,
    announcerPkHex: string,
    forPeerPkHex: string
  ): CapabilityAnnouncement {
    const visible = this.getVisibleForPeer(forPeerPkHex);
    const announcement: Omit<CapabilityAnnouncement, "signatureHex"> = {
      announcerPkHex,
      forPeerPkHex,
      capabilities: visible,
      timestamp: Date.now(),
      nonce: bytesToHex(nacl.randomBytes(16)),
    };
    const message = canonicalSerialize(announcement);
    const signature = nacl.sign.detached(
      new TextEncoder().encode(message),
      secretKey
    );
    return { ...announcement, signatureHex: bytesToHex(signature) };
  }

  /**
   * Verifica un anuncio recibido. T-13 (m-36): además de la firma, exige
   * que el anuncio venga dirigido a ESTE par (el destinatario va firmado),
   * que sea fresco (±5 min) y que su nonce no se haya verificado ya
   * (replay). Es método de instancia porque el registro de nonces vive
   * en el registro; antes era estático y solo miraba la firma.
   * El nonce solo se apunta si todo lo demás pasa: un anuncio inválido
   * no quema el nonce de uno bueno.
   */
  verifyAnnouncement(
    announcement: CapabilityAnnouncement,
    announcerPkBytes: Uint8Array,
    expectedForPeerPkHex: string,
    now: number = Date.now()
  ): boolean {
    if (
      typeof announcement.forPeerPkHex !== "string" ||
      announcement.forPeerPkHex.toLowerCase() !== expectedForPeerPkHex.toLowerCase()
    ) {
      return false;
    }
    if (Math.abs(now - announcement.timestamp) > ANNOUNCEMENT_MAX_AGE_MS) return false;
    const { signatureHex, ...unsigned } = announcement;
    const message = canonicalSerialize(unsigned);
    let ok = false;
    try {
      ok = nacl.sign.detached.verify(
        new TextEncoder().encode(message),
        hexToBytes(signatureHex),
        announcerPkBytes
      );
    } catch {
      return false;
    }
    if (!ok) return false;
    const nonceKey = `${announcement.announcerPkHex.toLowerCase()}|${announcement.nonce}`;
    if (this.seenNonces.has(nonceKey)) return false;
    this.seenNonces.set(nonceKey, announcement.timestamp);
    if (this.seenNonces.size > SEEN_NONCES_MAX) {
      for (const [k, ts] of this.seenNonces) {
        if (now - ts > ANNOUNCEMENT_MAX_AGE_MS * 2) this.seenNonces.delete(k);
      }
      // Si ni con la poda por edad baja del tope, fuera las más viejas.
      let excess = this.seenNonces.size - SEEN_NONCES_MAX;
      for (const k of this.seenNonces.keys()) {
        if (excess-- <= 0) break;
        this.seenNonces.delete(k);
      }
    }
    return true;
  }

  clear(): void {
    this.capabilities.clear();
    this.denylist.clear();
    this.seenNonces.clear();
  }
}

/** Instancia global. */
export const globalCapabilityRegistry = new CapabilityRegistry();
