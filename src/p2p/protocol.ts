/**
 * protocol.ts — NIDO P2P: protocolo de mensajes sobre el transporte (Fase E).
 *
 * Frame en el cable: [u32 big-endian: longitud][nonce 24 B][secretbox(JSON envelope)]
 * El cifrado/autenticación lo hace crypto.ts; aquí solo framing y tipos.
 */

import {
  deriveSessionKeyV2,
  fromHex,
  openMessage,
  sealMessage,
  sha512,
  toHex,
  utf8Decode,
  utf8Encode,
  HANDSHAKE_NONCE_BYTES,
} from "./crypto";

export const PROTOCOL_VERSION = 2;

/**
 * v2 (2026-10-05): agregado "negotiation" para el protocolo de negociación
 * NIDO↔NIDO (PROPOSE/COUNTER/ACCEPT/DECLINE/EXPIRE). No se reutiliza
 * "agent_task" para no confundir negotiation (acuerdo) con execution
 * (ejecución). Peers v1 rechazan envelopes v2 (fail-closed).
 *
 * v2.1 (2026-10-05): agregado "pack_share" para Pack Sharing NIDO↔NIDO
 * (OFFER/ACCEPT/DECLINE/CHUNK/CHUNK_ACK/COMPLETE/CANCEL). Las transferencias
 * de packs NUNCA van dentro de chat o agent_task: tienen su propio tipo
 * con su propia state machine y garantías de integridad (SHA-256).
 * Ver src/p2p/packSharing.ts para el protocolo completo.
 */

/**
 * N6: tipo nuevo para el ACK autenticado de entrega. "receipt" queda
 * intacto (read-receipts, garantía distinta, ortogonal).
 *
 * v2: "negotiation" para mensajes del protocolo de negociación agent-to-agent.
 * El subtipo específico (PROPOSE/COUNTER/ACCEPT/DECLINE/EXPIRE) va en
 * `payload.action`. Ver src/p2p/negotiation.ts para la state machine.
 *
 * v2.1: "pack_share" para transferencia de knowledge packs NIDO↔NIDO.
 * El subtipo (OFFER/ACCEPT/DECLINE/CHUNK/CHUNK_ACK/COMPLETE/CANCEL) va en
 * `payload.action`. Ver src/p2p/packSharing.ts para el protocolo completo.
 */
export type P2PMessageType =
  | "chat"
  | "agent_task"
  | "agent_result"
  | "receipt"
  | "session_confirm"
  | "delivery_ack"
  | "negotiation"
  | "pack_share";

export interface P2PEnvelope {
  v: number;
  type: P2PMessageType;
  /** id único del mensaje (uuid). */
  id: string;
  /** pk hex del remitente. */
  from: string;
  /** pk hex del destinatario. */
  to: string;
  /** epoch ms. */
  ts: number;
  payload: Record<string, unknown>;
}

export interface ChatPayload {
  text: string;
}

export interface AgentTaskPayload {
  kind: string;
  text: string;
  args?: Record<string, unknown>;
}

/**
 * v2: Payload para mensajes de negociación NIDO↔NIDO.
 *
 * El campo `action` indica el subtipo: PROPOSE | COUNTER | ACCEPT | DECLINE | EXPIRE.
 * El mensaje firmado completo (SignedNegotiationMessage) va en `signed`.
 * Ver src/p2p/negotiation.ts para la state machine y garantías criptográficas.
 */
export interface NegotiationPayload {
  /** Subtipo de negociación: PROPOSE | COUNTER | ACCEPT | DECLINE | EXPIRE */
  action: "PROPOSE" | "COUNTER" | "ACCEPT" | "DECLINE" | "EXPIRE";
  /** ID de la negociación (para correlacionar mensajes). */
  negotiationId: string;
  /** Mensaje de negociación firmado (serialización canónica + Ed25519). */
  signed: Record<string, unknown>;
}

/**
 * v2.1: Payload para mensajes de Pack Sharing NIDO↔NIDO.
 *
 * El campo `action` indica el subtipo:
 * - OFFER: sender → receiver. Ofrece un pack (advertisement firmado).
 * - ACCEPT: receiver → sender. Acepta la oferta (inicia transferencia).
 * - DECLINE: receiver → sender. Rechaza la oferta.
 * - CHUNK: sender → receiver. Un chunk del pack.
 * - CHUNK_ACK: receiver → sender. Confirma recepción de un chunk.
 * - COMPLETE: sender → receiver. Todos los chunks enviados.
 * - CANCEL: cualquiera → cualquiera. Cancela la transferencia.
 *
 * Ver src/p2p/packSharing.ts para la state machine y garantías.
 */
export interface PackSharePayload {
  /** Subtipo de pack sharing */
  action: "OFFER" | "ACCEPT" | "DECLINE" | "CHUNK" | "CHUNK_ACK" | "COMPLETE" | "CANCEL";
  /** ID de la sesión de transferencia (para correlacionar mensajes). */
  sessionId: string;
  /** Datos específicos del subtipo (advertisement, chunk, etc.). */
  data: Record<string, unknown>;
}

export interface AgentResultPayload {
  for_id: string;
  text: string;
}

export interface ReceiptPayload {
  for_id: string;
  status: "delivered" | "read";
}

/**
 * N6 §3.2 — payload del ACK autenticado de entrega.
 *
 * El ACK viaja sellado bajo la clave de la sesión R4 (secretbox sobre el
 * envelope completo); no lleva firma Ed25519 separada (D1: el canal ya es
 * autenticado; una segunda firma no impediría que un endpoint comprometido
 * mintiera sobre haber persistido). El binding entre sesiones viene de
 * `session_tag` (§3.3).
 */
export interface DeliveryAckPayload {
  /** message_id del mensaje original (payload), no el envelope id de transmisión. */
  for_id: string;
  /** tipo del envelope original (chat | agent_task | …). */
  for_type: string;
  /** epoch ms en que el commit de persistencia del emisor resolvió. Informativo. */
  persisted_at: number;
  /** session_tag de la sesión ACTUAL bajo la que se acuña este ACK (D11). */
  session_tag: string;
  /** literal fijo; punto de extensión futuro. */
  attest: "persisted";
}

/** Dominio de derivación del session_tag (N6 §3.3, D3). */
export const ACK_SESSION_TAG_DOMAIN = "nido-ack-session-v1";

/**
 * N6 §3.3 (D3) — deriva el session_tag desde pares canónicos
 * identidad↔nonce, SIN tocar el KDF ni el handshake (aditivo, read-only).
 *
 *   pk_low, pk_high = sorted(pkA, pkB)            // lexicográfico sobre hex
 *   session_tag = hex(sha512(domain || pk_low || nonce_of_pk_low ||
 *                             pk_high || nonce_of_pk_high))
 *
 * Cada parte sabe exactamente qué nonce pertenece a cada identidad (viene
 * del handshake R4: `myNonce` es el nonce del HELLO de mi identidad,
 * `theirNonce` el del HELLO del peer). El orden canónico por pk hace que
 * ambos lados deriven el mismo valor sin negociación, preservando la
 * asociación pk↔nonce (a diferencia de ordenar pks y nonces por separado).
 */
export function deriveAckSessionTag(
  myIdentityPkHex: string,
  peerIdentityPkHex: string,
  myNonce: Uint8Array,
  theirNonce: Uint8Array,
): string {
  // Fail-closed: pks de identidad (32 B en hex) y nonces de handshake
  // (HANDSHAKE_NONCE_BYTES). Sin esto, una entrada malformada derivaría
  // un tag "válido" en forma pero sin anclaje criptográfico real.
  const hexRe = /^[0-9a-fA-F]{64}$/;
  if (!hexRe.test(myIdentityPkHex) || !hexRe.test(peerIdentityPkHex)) {
    throw new Error("nido/ack-tag: pk de identidad inválida");
  }
  if (myNonce.length !== HANDSHAKE_NONCE_BYTES || theirNonce.length !== HANDSHAKE_NONCE_BYTES) {
    throw new Error("nido/ack-tag: nonce de handshake inválido");
  }
  const myPk = myIdentityPkHex.toLowerCase();
  const peerPk = peerIdentityPkHex.toLowerCase();
  const lowFirst = myPk <= peerPk;
  const pkLow = lowFirst ? myPk : peerPk;
  const pkHigh = lowFirst ? peerPk : myPk;
  const nonceLow = lowFirst ? myNonce : theirNonce;
  const nonceHigh = lowFirst ? theirNonce : myNonce;
  const domain = utf8Encode(ACK_SESSION_TAG_DOMAIN);
  const buf = new Uint8Array(
    domain.length + pkLow.length + nonceLow.length + pkHigh.length + nonceHigh.length,
  );
  let o = 0;
  buf.set(domain, o); o += domain.length;
  buf.set(utf8Encode(pkLow), o); o += pkLow.length;
  buf.set(nonceLow, o); o += nonceLow.length;
  buf.set(utf8Encode(pkHigh), o); o += pkHigh.length;
  buf.set(nonceHigh, o);
  return toHex(sha512(buf));
}

const MAX_FRAME_BYTES = 256 * 1024; // 256 KB por mensaje
/** Tope de ids recordados por sesión (anti-replay en memoria). */
const MAX_SEEN_IDS = 10_000;

/**
 * Una sesión cifrada con un peer: guarda el secreto derivado del handshake.
 * En el handshake real cada lado genera un efímero y lo intercambia;
 * aquí se modela con ambos keypairs para tests y para el transporte.
 *
 * Defensas por sesión:
 * - Anti-replay: cada id de mensaje se acepta una sola vez.
 * - Destinatario: si se declara la propia clave (`expectRecipient`), se
 *   rechaza todo envelope cuyo `to` no sea yo.
 * Nota: la ventana de frescura por `ts` no se impone: los relojes de dos
 * teléfonos pueden diferir y un rechazo agresivo rompería la mensajería
 * legítima. El id único + nonce aleatorio ya impiden el replay útil.
 */
export class P2PSession {
  readonly peerPkHex: string;
  private sessionKey: Uint8Array;
  private seenIds = new Set<string>();
  private ownPkHex: string | null = null;
  /**
   * Liveness del peer: solo se marca cuando llega un frame válido bajo la
   * clave de ESTA sesión. Un HELLO repetido por un atacante crea una sesión
   * bajo la cual el atacante jamás puede producir un frame válido, así que
   * la cola nunca se vacía hacia una sesión fantasma (ver
   * docs/HANDSHAKE_THREAT_MODEL.md).
   */
  private peerLive = false;
  /**
   * N6 §3.3 — session_tag de esta sesión (D3). Puramente derivado de los
   * nonces del handshake R4; NO modifica el KDF ni el establecimiento de
   * la ruta. null = no derivado (los ACK se rechazan fail-closed).
   */
  private ackSessionTag: string | null = null;

  private constructor(peerPkHex: string, sessionKey: Uint8Array) {
    this.peerPkHex = peerPkHex;
    this.sessionKey = sessionKey;
  }

  /** Declara mi propia clave de identidad para validar el destinatario. */
  expectRecipient(ownPkHex: string): void {
    this.ownPkHex = ownPkHex.toLowerCase();
  }

  /** Marca que el peer demostró conocer la clave de esta sesión. */

  /** ¿El peer ya confirmó esta sesión con un frame válido? */
  get isPeerLive(): boolean {
    return this.peerLive;
  }

  /** N6 §3.3: session_tag de la sesión actualmente establecida (D11). */
  get sessionTag(): string | null {
    return this.ackSessionTag;
  }

  /**
   * N6 §3.3: fija el session_tag derivado del handshake R4. Aditivo:
   * no toca la clave de sesión ni el handshake. El tag debe derivarse con
   * deriveAckSessionTag(miPk, peerPk, myNonce, theirNonce).
   */
  setSessionTag(tag: string): void {
    if (!/^[0-9a-f]{128}$/.test(tag)) throw new Error("session_tag inválido.");
    this.ackSessionTag = tag;
  }

  /**
   * Handshake v2 (autenticado): la clave de sesión queda ligada a los
   * nonces de ambos HELLO, así un HELLO repetido no resucita sesiones.
   *
   * N6: `sessionTag` es opcional y puramente aditivo — si se pasa, la
   * sesión puede emitir/validar ACKs; si no, los ACK se rechazan
   * fail-closed. R4 queda intacto.
   */
  static fromHandshakeV2(
    myEphemeralSecret: Uint8Array,
    theirEphemeralPk: Uint8Array,
    peerIdentityPkHex: string,
    myNonce: Uint8Array,
    theirNonce: Uint8Array,
    sessionTag?: string,
  ): P2PSession {
    const key = deriveSessionKeyV2(myEphemeralSecret, theirEphemeralPk, myNonce, theirNonce);
    const s = new P2PSession(peerIdentityPkHex.toLowerCase(), key);
    if (sessionTag !== undefined) s.setSessionTag(sessionTag);
    return s;
  }

  /** Empaqueta un envelope en un frame listo para el socket. */
  pack(envelope: P2PEnvelope): Uint8Array {
    validateEnvelope(envelope);
    const json = JSON.stringify(envelope);
    const sealed = sealMessage(utf8Encode(json), this.sessionKey);
    const bodyLen = sealed.nonce.length + sealed.boxed.length;
    if (bodyLen > MAX_FRAME_BYTES) throw new Error("Mensaje demasiado grande.");
    const frame = new Uint8Array(4 + bodyLen);
    frame[0] = (bodyLen >>> 24) & 0xff;
    frame[1] = (bodyLen >>> 16) & 0xff;
    frame[2] = (bodyLen >>> 8) & 0xff;
    frame[3] = bodyLen & 0xff;
    frame.set(sealed.nonce, 4);
    frame.set(sealed.boxed, 4 + sealed.nonce.length);
    return frame;
  }

  /**
   * Desempaqueta UN frame completo. Devuelve null si la autenticación falla,
   * si el mensaje es un replay/duplicado, si el destinatario no soy yo o si
   * el remitente no coincide con el peer: se descarta en silencio.
   */
  unpack(frame: Uint8Array): P2PEnvelope | null {
    if (frame.length < 4 + 24 + 16) return null;
    const bodyLen = (frame[0] << 24) | (frame[1] << 16) | (frame[2] << 8) | frame[3];
    if (bodyLen !== frame.length - 4 || bodyLen > MAX_FRAME_BYTES) return null;
    const nonce = frame.slice(4, 28);
    const boxed = frame.slice(28);
    const opened = openMessage({ nonce, boxed }, this.sessionKey);
    if (!opened) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(utf8Decode(opened));
    } catch {
      return null;
    }
    try {
      const env = parsed as P2PEnvelope;
      validateEnvelope(env);
      if (env.from.toLowerCase() !== this.peerPkHex) return null; // suplantación
      if (this.ownPkHex && env.to.toLowerCase() !== this.ownPkHex) return null; // destinatario incorrecto
      if (this.seenIds.has(env.id)) return null; // replay o duplicado
      this.seenIds.add(env.id);
      if (this.seenIds.size > MAX_SEEN_IDS) {
        // Evicción FIFO: Set itera en orden de inserción.
        const oldest = this.seenIds.values().next().value as string | undefined;
        if (oldest !== undefined) this.seenIds.delete(oldest);
      }
      // Un frame válido bajo la clave de esta sesión demuestra que el peer
      // conoce la clave: la sesión está viva (ver P2PSession.peerLive).
      this.peerLive = true;
      return env;
    } catch {
      return null;
    }
  }
}

/** Reensambla frames desde un stream (el socket entrega chunks arbitrarios). */
export class FrameReassembler {
  private buffer = new Uint8Array(0);

  /** Descarta el buffer parcial (p. ej. al cerrarse el socket a mitad de frame). */
  reset(): void {
    this.buffer = new Uint8Array(0);
  }

  /** Bytes pendientes sin completar un frame (diagnóstico). */
  pendingBytes(): number {
    return this.buffer.length;
  }

  push(chunk: Uint8Array): Uint8Array[] {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer, 0);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;
    const frames: Uint8Array[] = [];
    while (this.buffer.length >= 4) {
      const bodyLen = (this.buffer[0] << 24) | (this.buffer[1] << 16) | (this.buffer[2] << 8) | this.buffer[3];
      if (bodyLen <= 0 || bodyLen > MAX_FRAME_BYTES) {
        // Frame corrupto: descarta todo para no atascarse.
        this.buffer = new Uint8Array(0);
        break;
      }
      if (this.buffer.length < 4 + bodyLen) break;
      frames.push(this.buffer.slice(0, 4 + bodyLen));
      this.buffer = this.buffer.slice(4 + bodyLen);
    }
    return frames;
  }
}

function validateEnvelope(env: P2PEnvelope): void {
  if (typeof env !== "object" || env === null) throw new Error("Envelope inválido.");
  if (env.v !== PROTOCOL_VERSION) throw new Error("Versión de protocolo no soportada.");
  const types: P2PMessageType[] = ["chat", "agent_task", "agent_result", "receipt", "session_confirm", "delivery_ack", "negotiation", "pack_share"];
  if (!types.includes(env.type)) throw new Error("Tipo de mensaje desconocido.");
  if (typeof env.id !== "string" || !env.id) throw new Error("Falta id.");
  if (typeof env.from !== "string" || typeof env.to !== "string") throw new Error("Falta from/to.");
  // from/to deben ser claves hex válidas de 32 bytes
  if (fromHex(env.from).length !== 32 || fromHex(env.to).length !== 32) {
    throw new Error("from/to inválidos.");
  }
  // Normaliza a minúsculas
  env.from = env.from.toLowerCase();
  env.to = env.to.toLowerCase();
  if (typeof env.ts !== "number") throw new Error("Falta ts.");
  if (typeof env.payload !== "object" || env.payload === null) throw new Error("Falta payload.");
}

export function makeEnvelope(
  type: P2PMessageType,
  id: string,
  fromPk: Uint8Array,
  toPkHex: string,
  payload: Record<string, unknown>,
): P2PEnvelope {
  if (fromPk.length !== 32) throw new Error("Clave propia inválida.");
  return {
    v: PROTOCOL_VERSION,
    type,
    id,
    from: toHex(fromPk),
    to: toHex(fromHex(toPkHex)),
    ts: Date.now(),
    payload,
  };
}
