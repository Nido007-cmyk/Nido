/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * inboundQuota.ts — T-12 (0.1.99, M-24): cuotas del RECEPTOR.
 *
 * Hasta esta tanda, un par ya autenticado (ruta establecida, sesión válida)
 * podía inundar este teléfono sin ningún tope del lado que recibe:
 * - frames: el transporte reenviaba todo lo que llegara por la ruta;
 * - texto: un chat entrante se persistía con cualquier longitud, cuando el
 *   propio envío limita a 4.000 caracteres (messenger.ts);
 * - volumen: los mensajes guardados crecían sin cuota por par.
 *
 * Tres capas, todas por par y fail-closed DENTRO de su ventana (la misma
 * filosofía que ReplayProtection: nada de FIFO que un atacante pueda usar
 * para expulsar lo legítimo):
 * 1. Cubeta de frames por par en la ruta establecida (nativeTransport).
 * 2. Tope de texto de chat entrante = el tope del propio envío (messenger).
 * 3. Cuota de bytes persistidos por par y ventana (messenger, antes de
 *    guardar). Lo que excede se descarta y se CUENTA, nunca se trunca:
 *    un mensaje a medias sería un mensaje falso.
 *
 * Los contadores de descarte quedan expuestos (snapshot) para diagnóstico:
 * un descarte por cuota no debe ser invisible, pero tampoco un error que
 * bloquee la conversación: el par legítimo recupera su cubeta al girar la
 * ventana.
 */

export interface InboundQuotaLimits {
  /** Capa 1: frames máximos por par dentro de la ventana de frames. */
  maxFramesPerPeer: number;
  frameWindowMs: number;
  /** Capa 3: bytes máximos persistidos por par dentro de la ventana. */
  maxPersistBytesPerPeer: number;
  persistWindowMs: number;
  /** Capa 2: caracteres máximos de un texto de chat entrante. */
  maxChatTextChars: number;
}

export const INBOUND_QUOTA_DEFAULTS: InboundQuotaLimits = {
  // Un humano no manda ni 100 mensajes/minuto; 2.000 frames/min por par da
  // margen de sobra a sincronizaciones y reenvíos legítimos (con el tope de
  // 256 KB por frame, el peor caso teórico queda en ~96 MB/min por par).
  maxFramesPerPeer: 2000,
  frameWindowMs: 60_000,
  // 8 MB guardados por par cada 10 min: miles de mensajes normales; corta
  // la inundación de almacenamiento sin tocar una conversación real.
  maxPersistBytesPerPeer: 8 * 1024 * 1024,
  persistWindowMs: 600_000,
  // El mismo tope que el envío propio (sendChat): lo que yo no puedo
  // mandar, tampoco lo acepto como texto de chat.
  maxChatTextChars: 4000,
};

/** Pares con cubeta propia; más allá, cubeta de desborde compartida. */
const MAX_TRACKED_PEERS = 1024;

interface PeerWindow {
  frameStart: number;
  frames: number;
  byteStart: number;
  bytes: number;
}

function freshWindow(now: number): PeerWindow {
  return { frameStart: now, frames: 0, byteStart: now, bytes: 0 };
}

export class InboundQuota {
  private limits: InboundQuotaLimits = { ...INBOUND_QUOTA_DEFAULTS };
  private peers = new Map<string, PeerWindow>();
  private overflow: PeerWindow | null = null;
  private framesDropped = 0;
  private persistDropped = 0;
  private textDropped = 0;

  private windowFor(peerKey: string, now: number): PeerWindow {
    const key = peerKey.toLowerCase();
    let w = this.peers.get(key);
    if (!w) {
      if (this.peers.size >= MAX_TRACKED_PEERS) {
        // Demasiados pares distintos: cubeta compartida (acotada también).
        if (!this.overflow) this.overflow = freshWindow(now);
        return this.overflow;
      }
      w = freshWindow(now);
      this.peers.set(key, w);
    }
    return w;
  }

  /** Capa 1: ¿puede este par entregar otro frame ahora? */
  tryFrame(peerKey: string, now: number = Date.now()): boolean {
    const w = this.windowFor(peerKey, now);
    if (now - w.frameStart >= this.limits.frameWindowMs) {
      w.frameStart = now;
      w.frames = 0;
    }
    if (w.frames >= this.limits.maxFramesPerPeer) {
      this.framesDropped += 1;
      return false;
    }
    w.frames += 1;
    return true;
  }

  /** Capa 3: ¿pueden persistirse `bytes` más de este par ahora? */
  tryPersist(peerKey: string, bytes: number, now: number = Date.now()): boolean {
    const w = this.windowFor(peerKey, now);
    if (now - w.byteStart >= this.limits.persistWindowMs) {
      w.byteStart = now;
      w.bytes = 0;
    }
    if (w.bytes + bytes > this.limits.maxPersistBytesPerPeer) {
      this.persistDropped += 1;
      return false;
    }
    w.bytes += bytes;
    return true;
  }

  /** Capa 2: el messenger descarta el texto y lo cuenta aquí. */
  noteOversizedText(): void {
    this.textDropped += 1;
  }

  /** Capa 2: tope de caracteres vigente para un texto de chat entrante. */
  get chatTextLimit(): number {
    return this.limits.maxChatTextChars;
  }

  snapshot(): {
    framesDropped: number;
    persistDropped: number;
    textDropped: number;
    trackedPeers: number;
  } {
    return {
      framesDropped: this.framesDropped,
      persistDropped: this.persistDropped,
      textDropped: this.textDropped,
      trackedPeers: this.peers.size,
    };
  }

  /** Limpia cubetas y contadores (para tests). */
  clear(): void {
    this.peers.clear();
    this.overflow = null;
    this.framesDropped = 0;
    this.persistDropped = 0;
    this.textDropped = 0;
  }

  /** Ajuste de límites para tests (patrón de la casa: featureFlags). */
  setLimitsForTests(partial: Partial<InboundQuotaLimits>): void {
    this.limits = { ...this.limits, ...partial };
  }

  resetLimits(): void {
    this.limits = { ...INBOUND_QUOTA_DEFAULTS };
  }
}

/** Instancia global (una por proceso). */
export const inboundQuota = new InboundQuota();

export function setInboundQuotaLimitsForTests(partial: Partial<InboundQuotaLimits>): void {
  inboundQuota.setLimitsForTests(partial);
}

export function resetInboundQuotaForTests(): void {
  inboundQuota.resetLimits();
  inboundQuota.clear();
}
