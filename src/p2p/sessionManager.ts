/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * sessionManager.ts — NIDO P2P: Gestión de sesiones con disconnect/reconnect safety.
 *
 * Una sesión representa una conexión autenticada entre dos NIDOs.
 * Maneja:
 * - Establecimiento post-handshake
 * - Heartbeat/liveness
 * - Disconnect limpio vs abrupto
 * - Reconnect seguro (re-validación, no reutilización ciega de estado)
 * - Expiración de sesiones
 *
 * Seguridad:
 * - Reconnect NO hereda grants automáticamente (re-validación)
 * - Sesiones expiradas no pueden resucitarse
 * - Estado ambiguo → fail-closed (sesión inválida)
 */

import { globalRevocationRegistry } from "./replayProtection";
import { randomNonce, toHex } from "./crypto";

/** Estados de sesión. */
export type SessionState =
  | "ESTABLISHING"
  | "ACTIVE"
  | "SUSPENDED" // Disconnect temporal, puede resumirse
  | "CLOSED" // Terminada limpiamente
  | "EXPIRED" // Expiró por timeout
  | "REVOKED"; // Revocada explícitamente

/** Información de sesión. */
export interface Session {
  sessionId: string;
  peerPkHex: string;
  state: SessionState;
  establishedAt: number;
  lastHeartbeatAt: number;
  expiresAt: number;
  /** Grants activos en esta sesión. */
  activeGrantIds: Set<string>;
  /** Contador de mensajes para detección de reordenamiento. */
  messageCounter: number;
  /** Último contador entrante aceptado (estrictamente creciente). */
  lastIncomingCounter: number;
}

/** Configuración de sesión. */
export interface SessionConfig {
  /** TTL de sesión en ms. */
  sessionTtlMs: number;
  /** Intervalo de heartbeat en ms. */
  heartbeatIntervalMs: number;
  /** Timeout de heartbeat en ms (sin heartbeat → SUSPENDED). */
  heartbeatTimeoutMs: number;
}

const DEFAULT_CONFIG: SessionConfig = {
  sessionTtlMs: 3600000, // 1 hora
  heartbeatIntervalMs: 30000, // 30 segundos
  heartbeatTimeoutMs: 90000, // 90 segundos
};

/**
 * Gestor de sesiones P2P.
 */
export class SessionManager {
  private sessions = new Map<string, Session>();
  private config: SessionConfig;

  constructor(config: Partial<SessionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Crea una nueva sesión post-handshake.
   */
  createSession(peerPkHex: string, now: number = Date.now()): Session {
    // Auditoría 2026-10-10 (M3): id con PRNG criptográfico, no Math.random().
    const sessionId = `sess_${now}_${toHex(randomNonce(8))}`;
    const session: Session = {
      sessionId,
      peerPkHex: peerPkHex.toLowerCase(),
      state: "ESTABLISHING",
      establishedAt: now,
      lastHeartbeatAt: now,
      expiresAt: now + this.config.sessionTtlMs,
      activeGrantIds: new Set(),
      messageCounter: 0,
      lastIncomingCounter: 0,
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * ¿El peer de esta sesión fue revocado? Si sí, la sesión pasa a REVOKED.
   * Auditoría 2026-10-10 (M3): antes solo se miraba la revocación de la
   * sesión, así que revocar al PEER no cerraba sus sesiones activas.
   */
  private revokeIfPeerRevoked(s: Session): boolean {
    if (globalRevocationRegistry.isPeerRevoked(s.peerPkHex)) {
      s.state = "REVOKED";
      s.activeGrantIds.clear();
      return true;
    }
    return false;
  }

  /**
   * Marca sesión como activa (handshake completo).
   */
  activateSession(sessionId: string): boolean {
    const s = this.sessions.get(sessionId);
    if (!s || s.state !== "ESTABLISHING") return false;
    if (this.revokeIfPeerRevoked(s)) return false;
    s.state = "ACTIVE";
    return true;
  }

  /**
   * Registra heartbeat. Retorna false si la sesión no es válida.
   */
  heartbeat(sessionId: string, now: number = Date.now()): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    if (s.state === "REVOKED" || s.state === "EXPIRED" || s.state === "CLOSED") {
      return false;
    }
    if (globalRevocationRegistry.isSessionRevoked(sessionId)) {
      s.state = "REVOKED";
      return false;
    }
    if (now > s.expiresAt) {
      s.state = "EXPIRED";
      return false;
    }
    // Re-validación real antes de latir/reactivar (el comentario original
    // lo prometía pero no se hacía): peer revocado → sesión REVOKED.
    if (this.revokeIfPeerRevoked(s)) return false;
    s.lastHeartbeatAt = now;
    if (s.state === "SUSPENDED") {
      s.state = "ACTIVE";
    }
    return true;
  }

  /**
   * Verifica salud de sesiones (llamar periódicamente).
   * Marca como SUSPENDED las sin heartbeat, EXPIRED las vencidas.
   */
  checkHealth(now: number = Date.now()): void {
    for (const [id, s] of this.sessions) {
      if (s.state === "ACTIVE" || s.state === "SUSPENDED") {
        if (now > s.expiresAt) {
          s.state = "EXPIRED";
        } else if (now - s.lastHeartbeatAt > this.config.heartbeatTimeoutMs) {
          s.state = "SUSPENDED";
        }
      } else if (
        (s.state === "CLOSED" || s.state === "EXPIRED" || s.state === "REVOKED") &&
        now > s.expiresAt + this.config.sessionTtlMs
      ) {
        // Poda de sesiones terminales ya vencidas: el mapa no crece sin límite.
        this.sessions.delete(id);
      }
    }
  }

  /**
   * Cierra una sesión limpiamente.
   */
  closeSession(sessionId: string): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    s.state = "CLOSED";
    s.activeGrantIds.clear();
    return true;
  }

  /**
   * Revoca una sesión (no puede reabrirse).
   */
  revokeSession(sessionId: string): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    s.state = "REVOKED";
    s.activeGrantIds.clear();
    globalRevocationRegistry.revokeSession(sessionId);
    return true;
  }

  /**
   * Obtiene una sesión si está activa y válida.
   */
  getActiveSession(sessionId: string, now: number = Date.now()): Session | null {
    const s = this.sessions.get(sessionId);
    if (!s) return null;
    if (s.state !== "ACTIVE") return null;
    if (now > s.expiresAt) {
      s.state = "EXPIRED";
      return null;
    }
    if (globalRevocationRegistry.isSessionRevoked(sessionId)) {
      s.state = "REVOKED";
      return null;
    }
    if (this.revokeIfPeerRevoked(s)) return null;
    return s;
  }

  /**
   * Asocia un grant a una sesión.
   */
  attachGrant(sessionId: string, grantId: string): boolean {
    const s = this.sessions.get(sessionId);
    if (!s || s.state !== "ACTIVE") return false;
    if (this.revokeIfPeerRevoked(s)) return false;
    s.activeGrantIds.add(grantId);
    return true;
  }

  /**
   * Incrementa y retorna el contador de mensajes (anti-reordenamiento).
   */
  nextMessageCounter(sessionId: string): number | null {
    const s = this.sessions.get(sessionId);
    if (!s || s.state !== "ACTIVE") return null;
    s.messageCounter += 1;
    return s.messageCounter;
  }

  /**
   * Valida el contador de un mensaje ENTRANTE: debe ser estrictamente mayor
   * que el último aceptado (anti-replay/reordenamiento). `nextMessageCounter`
   * solo numera lo que enviamos; sin esta verificación el contador no
   * protegía nada al recibir (auditoría 2026-10-10, M3).
   */
  acceptIncomingCounter(sessionId: string, counter: number): boolean {
    const s = this.sessions.get(sessionId);
    if (!s || s.state !== "ACTIVE") return false;
    if (!Number.isSafeInteger(counter) || counter <= s.lastIncomingCounter) return false;
    s.lastIncomingCounter = counter;
    return true;
  }

  /** Para tests. */
  clear(): void {
    this.sessions.clear();
  }

  get size(): number {
    return this.sessions.size;
  }
}

/** Instancia global. */
export const globalSessionManager = new SessionManager();
