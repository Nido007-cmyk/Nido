/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

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
import { V5Ratchet, V5_MARKER, type V5Offer } from "./ratchet";

export const PROTOCOL_VERSION = 2;

/**
 * REBRAND-2026-10-07: Identificadores del protocolo wire (handshake).
 * Son INMUTABLES por diseño: cambiar estos strings rompería la comunicación
 * entre dispositivos con builds de diferente marca. Un rebrand de nombre
 * comercial NUNCA debe tocar estas constantes.
 */
export const PROTOCOL_HELLO_TYPE = "nido-hello";
export const PROTOCOL_CONFIRM_TYPE = "nido-confirm";
export const PROTOCOL_SERVICE_NAME = "nido-p2p";
/** Dominio de derivación del session_tag (N6 §3.3, D3). */
export const ACK_SESSION_TAG_DOMAIN = "nido-ack-session-v1";

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
  | "pack_share"
  | "delegation"
  | "settings";

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

/**
 * 0.1.46 — relleno de mensajes (como Signal y Briar). Antes el tamaño del
 * frame delataba el del texto: un "sí" y un párrafo largo se distinguían a
 * simple vista en el aire. Ahora el JSON se rellena hasta un tamaño fijo:
 * 512 B, 1 KB, 2 KB… hasta 16 KB en potencias de dos, y por encima en
 * múltiplos de 16 KB. (El sobre del mensaje ya ocupa ~250 B, así que 512 B
 * iguala todos los mensajes de hasta ~250 caracteres.)
 *
 * El relleno son ESPACIOS al final del JSON: `JSON.parse` los ignora, así que
 * una versión anterior de NIDO que reciba un mensaje relleno lo lee igual.
 * No cambia el formato del cable.
 */
const PAD_MIN = 512;
const PAD_STEP_LARGE = 16 * 1024;
/** Lo que cabe en un frame descontando nonce (24) + MAC (16), con holgura para v5. */
const MAX_PLAINTEXT_BYTES = MAX_FRAME_BYTES - 24 - 16 - 1200;

export function paddedLength(n: number): number {
  let target: number;
  if (n <= PAD_MIN) target = PAD_MIN;
  else if (n <= PAD_STEP_LARGE) target = 2 ** Math.ceil(Math.log2(n));
  else target = Math.ceil(n / PAD_STEP_LARGE) * PAD_STEP_LARGE;
  return Math.max(n, Math.min(target, MAX_PLAINTEXT_BYTES));
}

/** Tamaño fijo de todos los session_confirm. */
const CONFIRM_PADDED_BYTES = 4096;
/** Cuánto espera L el primer frame v5 de H antes de enviar en clásico. */
export const V5_HOLD_MS = 5000;

function padTo(bytes: Uint8Array, size: number): Uint8Array {
  if (bytes.length >= size) return padPlaintext(bytes);
  const out = new Uint8Array(size);
  out.set(bytes, 0);
  out.fill(0x20, bytes.length);
  return out;
}

/** Rellena con espacios (0x20) hasta `paddedLength`. */
export function padPlaintext(bytes: Uint8Array): Uint8Array {
  const target = paddedLength(bytes.length);
  if (target === bytes.length) return bytes;
  const out = new Uint8Array(target);
  out.set(bytes, 0);
  out.fill(0x20, bytes.length);
  return out;
}
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
  /** id de envelope → `ts` (epoch ms) del mensaje, para la evicción segura. */
  private seenIds = new Map<string, number>();
  /**
   * Marca de agua de evicción (auditoría 2026-10-10, M1): `ts` más alto de
   * los ids ya expulsados del conjunto. Un frame cuyo `ts` sea <= a esta
   * marca solo puede ser un mensaje ya visto y expulsado (un replay), así
   * que se rechaza. Sin esto, un frame capturado se podía reinyectar tras
   * 10 000 mensajes posteriores en la misma sesión. No cambia el cable ni
   * exige que los relojes coincidan: `ts` viaja DENTRO del secretbox y la
   * marca solo se compara con `ts` del propio emisor.
   */
  private evictedTsMax = -Infinity;
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
  /** 0.1.46 — protocolo v5 (Double Ratchet + ML-KEM). null = modo clásico. */
  private v5: V5Ratchet | null = null;
  /** ¿Este lado tiene v5 activado (interruptor)? Lo fija el messenger. */
  private v5Enabled = false;
  /** H: v5 acaba de arrancar y conviene mandar un frame para que L arranque. */
  private v5KickoffPending = false;
  /**
   * L: momento en que H anunció (en su session_confirm) que tiene v5. Desde
   * ahí, durante V5_HOLD_MS, la cola NO se vacía en modo clásico: se espera
   * el primer frame v5 de H para que también los mensajes encolados vayan
   * con clave por mensaje y ML-KEM. Pasado ese tiempo, se envía igual.
   */
  private v5CapSeenAt: number | null = null;
  /**
   * El session_confirm AUTÉNTICO del peer dice que no tiene v5 (L sin
   * oferta, o H sin r5cap): el modo clásico es decisión suya, no un ataque.
   */
  private peerSaidNoV5 = false;
  /** Momento de creación (para saber cuándo ya debería ir en v5). */
  readonly createdAt = Date.now();

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

  /* ---------- protocolo v5 ---------- */

  /**
   * Activa (o no) v5 para esta sesión. Solo tiene efecto si el peer también
   * lo tiene: si no, la sesión sigue en modo clásico como siempre.
   */
  enableV5(on: boolean): void {
    this.v5Enabled = on;
  }

  /** ¿La sesión ya cifra en v5? (para diagnóstico y la UI). */
  get usesV5(): boolean {
    return this.v5 !== null && this.v5.canSend;
  }

  /**
   * Carga útil del `session_confirm` propio. Si este lado es L (pk menor) y
   * tiene v5 activado, incluye la oferta v5; si no, `{}` como siempre.
   * Requiere `expectRecipient` (la sesión necesita saber cuál es mi pk).
   */
  confirmPayload(): Record<string, unknown> {
    if (!this.v5Enabled || !this.ownPkHex || this.v5) return {};
    // H solo anuncia que lo tiene: así L sabe que merece la pena esperar.
    if (!(this.ownPkHex < this.peerPkHex)) return { r5cap: 1 };
    try {
      const { ratchet, offer } = V5Ratchet.createOffer(this.sessionKey, this.ownPkHex, this.peerPkHex);
      this.v5 = ratchet;
      return { r5: offer satisfies V5Offer };
    } catch {
      return {};
    }
  }

  /**
   * L: ¿hay que retener la cola un momento porque H tiene v5 y su primer
   * frame v5 está al llegar? (ver v5CapSeenAt).
   */
  get holdForV5(): boolean {
    if (!this.v5 || this.v5.canSend || this.v5CapSeenAt === null) return false;
    return Date.now() - this.v5CapSeenAt < V5_HOLD_MS;
  }

  /** Milisegundos que quedan de espera (0 si no se espera). */
  get v5HoldRemainingMs(): number {
    if (!this.holdForV5 || this.v5CapSeenAt === null) return 0;
    return Math.max(0, V5_HOLD_MS - (Date.now() - this.v5CapSeenAt));
  }

  /** H: ¿hay que mandar ya un frame v5 para que L arranque? (se consume). */
  takeV5Kickoff(): boolean {
    const k = this.v5KickoffPending;
    this.v5KickoffPending = false;
    return k;
  }

  /** H recibió el session_confirm de L: si trae oferta v5 y v5 está activado, arranca. */
  /** El peer dijo, en un frame autenticado, que no usa v5. */
  get peerDeclinedV5(): boolean {
    return this.peerSaidNoV5;
  }

  private maybeAcceptV5(env: P2PEnvelope): void {
    if (env.type !== "session_confirm" || !this.v5Enabled || !this.ownPkHex) return;
    const pl = env.payload as { r5?: unknown; r5cap?: unknown };
    const peerIsLow = this.peerPkHex < this.ownPkHex;
    // Confirm auténtico del peer sin señal de v5 → el peer lo tiene apagado.
    // (Soy H: el confirm de L no trae oferta. Soy L con oferta: el confirm
    // clásico de H no trae r5cap; el "kick" v5 de H no cuenta porque llega
    // cuando ya puedo cifrar en v5.)
    if (peerIsLow && !this.v5 && pl.r5 === undefined) this.peerSaidNoV5 = true;
    if (!peerIsLow && this.v5 && !this.v5.canSend && pl.r5cap === undefined) this.peerSaidNoV5 = true;
    // L con oferta hecha: H anuncia que tiene v5 → esperar su primer frame v5.
    if (
      this.v5 &&
      this.v5.role === "low" &&
      !this.v5.canSend &&
      (env.payload as { r5cap?: unknown }).r5cap === 1 &&
      this.v5CapSeenAt === null
    ) {
      this.v5CapSeenAt = Date.now();
      return;
    }
    if (this.v5) return;
    if (!(this.peerPkHex < this.ownPkHex)) return; // solo H acepta
    const offer = (env.payload as { r5?: unknown }).r5;
    if (offer === undefined) return;
    const r = V5Ratchet.acceptOffer(this.sessionKey, this.peerPkHex, this.ownPkHex, offer);
    if (r) {
      this.v5 = r;
      this.v5KickoffPending = true;
    }
  }

  /** Empaqueta un envelope en un frame listo para el socket. */
  pack(envelope: P2PEnvelope): Uint8Array {
    validateEnvelope(envelope);
    const json = JSON.stringify(envelope);
    const plain = utf8Encode(json);
    if (plain.length > MAX_PLAINTEXT_BYTES) throw new Error("Mensaje demasiado grande.");
    // Todos los session_confirm miden lo mismo (4 KB), lleven o no la oferta
    // v5 (~2,8 KB): el tamaño no delata si hay oferta. Ojo: su POSICIÓN sí
    // (es el primer frame de sesión de L), así que un atacante en el camino
    // podría descartarlo; eso solo deja la sesión en clásico y la UI lo
    // avisa (ver NidoMessenger.sessionV5Warning). No es de los dos primeros
    // frames (HELLO y CONFIRM), los únicos con tope nativo de 4 KB.
    const padded = envelope.type === "session_confirm" ? padTo(plain, CONFIRM_PADDED_BYTES) : padPlaintext(plain);
    let body: Uint8Array;
    if (this.v5 && this.v5.canSend) {
      body = this.v5.seal(padded);
    } else {
      const sealed = sealMessage(padded, this.sessionKey);
      body = new Uint8Array(sealed.nonce.length + sealed.boxed.length);
      body.set(sealed.nonce, 0);
      body.set(sealed.boxed, sealed.nonce.length);
    }
    const bodyLen = body.length;
    if (bodyLen > MAX_FRAME_BYTES) throw new Error("Mensaje demasiado grande.");
    const frame = new Uint8Array(4 + bodyLen);
    frame[0] = (bodyLen >>> 24) & 0xff;
    frame[1] = (bodyLen >>> 16) & 0xff;
    frame[2] = (bodyLen >>> 8) & 0xff;
    frame[3] = bodyLen & 0xff;
    frame.set(body, 4);
    return frame;
  }

  /**
   * Descifra el cuerpo: v5 si la sesión lo tiene, clásico si el peer todavía
   * no pasó a v5. Nunca lanza.
   */
  private openBody(body: Uint8Array): Uint8Array | null {
    if (this.v5) {
      if (body[0] === V5_MARKER) {
        const plain = this.v5.open(body);
        if (plain) {
          // Los dos sentidos ya van en v5: la clave clásica de la conexión
          // no se vuelve a usar (ni para cifrar ni para descifrar), así que
          // se borra. Un robo de memoria posterior no abriría los primeros
          // frames clásicos de esta conexión.
          if (this.v5.canSend && this.v5.peerUsesV5) this.sessionKey.fill(0);
          return plain;
        }
      }
      // Desde el primer v5 del peer, el modo clásico queda cerrado.
      if (this.v5.peerUsesV5) return null;
    }
    if (body.length < 24 + 16) return null;
    return openMessage({ nonce: body.slice(0, 24), boxed: body.slice(24) }, this.sessionKey);
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
    const opened = this.openBody(frame.slice(4));
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
      // Replay de un id ya expulsado por capacidad: su `ts` no supera la
      // marca de agua (fail-closed; ver evictedTsMax). `ts` no finito también
      // se rechaza: no se puede ordenar frente a la marca.
      if (!Number.isFinite(env.ts) || env.ts <= this.evictedTsMax) return null;
      this.seenIds.set(env.id, env.ts);
      if (this.seenIds.size > MAX_SEEN_IDS) {
        // Evicción FIFO: Map itera en orden de inserción. Se recuerda el `ts`
        // del expulsado para seguir rechazando su replay.
        const oldest = this.seenIds.entries().next().value as [string, number] | undefined;
        if (oldest !== undefined) {
          this.seenIds.delete(oldest[0]);
          if (oldest[1] > this.evictedTsMax) this.evictedTsMax = oldest[1];
        }
      }
      // Un frame válido bajo la clave de esta sesión demuestra que el peer
      // conoce la clave: la sesión está viva (ver P2PSession.peerLive).
      this.peerLive = true;
      // v5: H arranca al ver la oferta de L (síncrono, antes de cualquier
      // await, para que el siguiente frame ya vea el estado correcto).
      this.maybeAcceptV5(env);
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
  const types: P2PMessageType[] = ["chat", "agent_task", "agent_result", "receipt", "session_confirm", "delivery_ack", "negotiation", "pack_share", "delegation", "settings"];
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
