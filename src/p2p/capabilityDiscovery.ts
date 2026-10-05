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
  capabilities: CapabilityDescriptor[];
  timestamp: number;
  nonce: string;
  signatureHex: string;
}

/**
 * Registro local de capabilities propias.
 */
export class CapabilityRegistry {
  private capabilities = new Map<string, CapabilityDescriptor>();
  /** Peers a los que NO se les revelan ciertas capabilities. */
  private denylist = new Map<string, Set<string>>(); // peerPkHex -> set of scopes

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
   * Verifica un anuncio recibido.
   */
  static verifyAnnouncement(
    announcement: CapabilityAnnouncement,
    announcerPkBytes: Uint8Array
  ): boolean {
    const { signatureHex, ...unsigned } = announcement;
    const message = canonicalSerialize(unsigned);
    const signature = hexToBytes(signatureHex);
    return nacl.sign.detached.verify(
      new TextEncoder().encode(message),
      signature,
      announcerPkBytes
    );
  }

  clear(): void {
    this.capabilities.clear();
    this.denylist.clear();
  }
}

/** Instancia global. */
export const globalCapabilityRegistry = new CapabilityRegistry();
