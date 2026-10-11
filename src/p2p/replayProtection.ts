/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * replayProtection.ts — NIDO P2P: Anti-replay y revocación.
 *
 * - Anti-replay: cache de nonces vistos con ventana temporal
 * - Revocación: grants, sesiones y peers revocados
 *
 * Todo en memoria (no persistente entre reinicios por diseño;
 * los grants tienen expiración corta de todos modos).
 *
 * La revocación AUTORITATIVA de peers vive en NativeTransport (persistida y
 * fail-closed). Este registro es su ESPEJO en memoria para las capas
 * superiores (pack sharing, autorización de grants): NativeTransport lo
 * actualiza en revokePeer/unrevokePeer y lo puebla al cargar desde disco.
 * Sin ese espejo, `isPeerRevoked` aquí era siempre false (auditoría
 * 2026-10-10, M3).
 */

/** Entrada del cache de nonces. */
interface NonceEntry {
  seenAt: number;
}

/** Grant revocado. */
interface RevokedGrant {
  grantId: string;
  revokedAt: number;
  reason: string;
}

/** Peer revocado. */
interface RevokedPeer {
  peerPkHex: string;
  revokedAt: number;
  reason: string;
}

/**
 * Protección anti-replay con ventana deslizante.
 */
export class ReplayProtection {
  private nonces = new Map<string, NonceEntry>();
  private readonly windowMs: number;
  private readonly maxEntries: number;

  constructor(windowMs: number = 600000, maxEntries: number = 10000) {
    this.windowMs = windowMs;
    this.maxEntries = maxEntries;
  }

  /**
   * Verifica y registra un nonce. Retorna false si es replay.
   */
  checkAndRecord(nonce: string, now: number = Date.now()): boolean {
    this.evictExpired(now);
    if (this.nonces.has(nonce)) {
      return false; // Replay detectado
    }
    // Capacidad: FAIL-CLOSED. Tras evictar lo expirado, si sigue lleno todas
    // las entradas están DENTRO de la ventana; expulsar una (FIFO) permitiría
    // re-aceptar su nonce vigente inundando con nonces basura (auditoría
    // 2026-10-10, M2). Rechazar es seguro: el mensaje legítimo se reintenta
    // cuando la ventana libere espacio.
    if (this.nonces.size >= this.maxEntries) {
      return false;
    }
    this.nonces.set(nonce, { seenAt: now });
    return true;
  }

  /**
   * Verifica sin registrar (para validación previa).
   */
  hasSeen(nonce: string): boolean {
    return this.nonces.has(nonce);
  }

  private evictExpired(now: number): void {
    const cutoff = now - this.windowMs;
    for (const [nonce, entry] of this.nonces) {
      if (entry.seenAt < cutoff) {
        this.nonces.delete(nonce);
      }
    }
  }

  /** Limpia todo (para tests). */
  clear(): void {
    this.nonces.clear();
  }

  get size(): number {
    return this.nonces.size;
  }
}

/**
 * Registro de revocaciones.
 */
export class RevocationRegistry {
  private revokedGrants = new Map<string, RevokedGrant>();
  private revokedPeers = new Map<string, RevokedPeer>();
  private revokedSessions = new Set<string>();

  /**
   * Revoca un grant específico.
   */
  revokeGrant(grantId: string, reason: string): void {
    this.revokedGrants.set(grantId, {
      grantId,
      revokedAt: Date.now(),
      reason,
    });
  }

  /**
   * Revoca un peer completo (todos sus grants quedan inválidos).
   */
  revokePeer(peerPkHex: string, reason: string): void {
    this.revokedPeers.set(peerPkHex.toLowerCase(), {
      peerPkHex: peerPkHex.toLowerCase(),
      revokedAt: Date.now(),
      reason,
    });
  }

  /**
   * Levanta la revocación de un peer (solo tras un re-pair explícito).
   * Refleja `NativeTransport.unrevokePeer`.
   */
  unrevokePeer(peerPkHex: string): void {
    this.revokedPeers.delete(peerPkHex.toLowerCase());
  }

  /**
   * Revoca una sesión.
   */
  revokeSession(sessionId: string): void {
    this.revokedSessions.add(sessionId);
  }

  /**
   * Verifica si un grant está revocado.
   */
  isGrantRevoked(grantId: string): boolean {
    return this.revokedGrants.has(grantId);
  }

  /**
   * Verifica si un peer está revocado.
   */
  isPeerRevoked(peerPkHex: string): boolean {
    return this.revokedPeers.has(peerPkHex.toLowerCase());
  }

  /**
   * Verifica si una sesión está revocada.
   */
  isSessionRevoked(sessionId: string): boolean {
    return this.revokedSessions.has(sessionId);
  }

  /**
   * Verificación completa: grant no revocado Y peer no revocado.
   */
  isGrantUsable(grantId: string, granteePkHex: string): boolean {
    if (this.isGrantRevoked(grantId)) return false;
    if (this.isPeerRevoked(granteePkHex)) return false;
    return true;
  }

  /** Limpia todo (para tests). */
  clear(): void {
    this.revokedGrants.clear();
    this.revokedPeers.clear();
    this.revokedSessions.clear();
  }
}

/** Instancia global (una por proceso). */
export const globalReplayProtection = new ReplayProtection();
export const globalRevocationRegistry = new RevocationRegistry();
