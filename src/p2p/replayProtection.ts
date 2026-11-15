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

/**
 * T-12 (0.1.99, M-25): anti-replay de NEGOCIACIÓN por cubetas.
 *
 * La cache única anterior tenía un fallo de aislamiento: era global y
 * fail-closed, así que UN solo par podía llenarla con 10.000 nonces
 * basura (el nonce se consume antes de comprobar la firma anclada al QR)
 * y dejar mudas a TODAS las negociaciones legítimas durante la ventana.
 *
 * Aquí cada par tiene su cubeta (tope por par), con un tope global como
 * cota de memoria de respaldo. Dentro de cada cubeta se mantiene la regla
 * M2: fail-closed, jamás FIFO (expulsar un nonce vigente permitiría
 * re-aceptar su replay). Un par solo puede llenar SU cubeta: para agotar
 * también el respaldo global harían falta muchos pares inundando a la vez,
 * y aun así cada cubeta conserva lo ya registrado.
 */
export class BucketedReplayProtection {
  private buckets = new Map<string, Map<string, number>>();
  private total = 0;
  private readonly windowMs: number;
  private perPeerMax: number;
  private globalMax: number;

  constructor(windowMs: number = 600000, perPeerMax: number = 1000, globalMax: number = 10000) {
    this.windowMs = windowMs;
    this.perPeerMax = perPeerMax;
    this.globalMax = globalMax;
  }

  /**
   * Verifica y registra un nonce DENTRO de la cubeta de su par.
   * false si es replay, si la cubeta del par está llena o si el respaldo
   * global está lleno.
   */
  checkAndRecord(peerKey: string, nonce: string, now: number = Date.now()): boolean {
    const key = peerKey.toLowerCase();
    this.evictExpired(now);
    let bucket = this.buckets.get(key);
    if (bucket?.has(nonce)) return false; // replay dentro de su cubeta
    if (bucket && bucket.size >= this.perPeerMax) return false; // su cubeta, llena
    if (this.total >= this.globalMax) return false; // respaldo global, lleno
    if (!bucket) {
      bucket = new Map<string, number>();
      this.buckets.set(key, bucket);
    }
    bucket.set(nonce, now);
    this.total += 1;
    return true;
  }

  private evictExpired(now: number): void {
    const cutoff = now - this.windowMs;
    for (const [key, bucket] of this.buckets) {
      for (const [nonce, seenAt] of bucket) {
        if (seenAt < cutoff) {
          bucket.delete(nonce);
          this.total -= 1;
        }
      }
      if (bucket.size === 0) this.buckets.delete(key);
    }
  }

  /** Limpia todo (para tests). */
  clear(): void {
    this.buckets.clear();
    this.total = 0;
  }

  get size(): number {
    return this.total;
  }

  peerSize(peerKey: string): number {
    return this.buckets.get(peerKey.toLowerCase())?.size ?? 0;
  }

  /** Ajuste de topes para tests (patrón de la casa: featureFlags). */
  setLimitsForTests(perPeerMax: number, globalMax: number): void {
    this.perPeerMax = perPeerMax;
    this.globalMax = globalMax;
  }
}

/** Anti-replay de negociación: cubetas por par (M-25). */
export const globalNegotiationReplayProtection = new BucketedReplayProtection();
