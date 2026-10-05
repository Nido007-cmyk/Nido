/**
 * replayProtection.ts — NIDO P2P: Anti-replay y revocación.
 *
 * - Anti-replay: cache de nonces vistos con ventana temporal
 * - Revocación: grants, sesiones y peers revocados
 *
 * Todo en memoria (no persistente entre reinicios por diseño;
 * los grants tienen expiración corta de todos modos).
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
    // Evicción por capacidad (FIFO aproximado)
    if (this.nonces.size >= this.maxEntries) {
      const oldest = this.nonces.keys().next().value;
      if (oldest) this.nonces.delete(oldest);
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
