/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * ratchet.ts — protocolo v5: Double Ratchet + arranque post-cuántico.
 *
 * Qué añade sobre la sesión clásica (una clave por conexión):
 *
 * 1. CLAVE NUEVA POR MENSAJE (Double Ratchet, el diseño de Signal).
 *    Cada mensaje usa su propia clave, derivada de una cadena que avanza y
 *    borra la anterior. Además, cada vez que cambia el turno de quien
 *    escribe, los dos lados mezclan un X25519 nuevo. Si alguien roba la
 *    memoria del teléfono en un momento dado, no puede leer los mensajes
 *    anteriores (secreto hacia atrás) y deja de leer los siguientes en
 *    cuanto se completa un cambio de turno (recuperación tras compromiso).
 *
 * 2. ARRANQUE HÍBRIDO CON ML-KEM-768 (resistencia cuántica).
 *    La raíz del ratchet mezcla la clave de sesión X25519 con un secreto
 *    ML-KEM-768. Quien grabe hoy el tráfico para descifrarlo con un
 *    ordenador cuántico futuro necesitaría romper también ML-KEM.
 *    La autenticación sigue siendo la de siempre (Ed25519 del handshake),
 *    igual que en PQXDH de Signal: protege contra "grabar ahora, descifrar
 *    después", no contra un atacante cuántico activo hoy.
 *
 * Arranque (sin tocar el handshake ni el cable del HELLO/CONFIRM):
 * - L = identidad con pk menor; H = la mayor.
 * - L manda en su `session_confirm` (sellado con la clave clásica) su clave
 *   de ratchet X25519 y una clave pública ML-KEM.
 * - H encapsula, arranca como "Alice" y desde entonces escribe en v5. Sus
 *   frames v5 llevan el cifrado ML-KEM hasta que recibe el primer v5 de L.
 * - L, al recibir el primer frame v5, desencapsula, arranca como "Bob" y
 *   desde su siguiente mensaje escribe en v5.
 * - Si uno de los dos no tiene v5 activado (o es una versión anterior), no
 *   pasa nada de lo anterior y la sesión sigue en el modo clásico.
 *
 * Frame v5 (cuerpo, tras el prefijo de longitud u32):
 *   0x05 | flags | dh(32) | pn u32 BE | n u32 BE | [ct ML-KEM(1088) si flags&1] | nonce(24) | secretbox
 * La clave de cada mensaje se liga a la cabecera completa:
 *   k = HKDF(sal = mk, ikm = cabecera, info = "nido-v5-msg")
 * Cambiar un solo bit de la cabecera da otra clave y el frame no abre.
 *
 * 0.1.50 — CABECERAS CIFRADAS (por encima de Signal, que las manda en claro).
 * Si los dos lados lo soportan, cada frame v5 va entero dentro de otra caja:
 *   0x06 | nonce(24) | secretbox(frame v5 de arriba, clave de cabecera)
 * Quien graba el tráfico ya no ve la clave de ratchet, los contadores ni el
 * cifrado ML-KEM: solo bytes al azar de tamaño fijo por tramos.
 * - hk0 = HKDF(clave de sesión clásica, ids): para los primeros frames de H
 *   (los que llevan el cifrado ML-KEM, cuando L aún no tiene la raíz).
 * - hk1 = HKDF(raíz v5, ids): para todo lo demás. Mezcla ML-KEM, así que
 *   un ordenador cuántico futuro tampoco ve esas cabeceras.
 * Negociación: L pide "he":1 en su oferta (dentro del session_confirm
 * cifrado); H, si lo entiende, escribe siempre 0x06; L pasa a 0x06 al ver el
 * primer 0x06 de H. Desde entonces un frame 0x05 sin caja se rechaza
 * (nadie puede forzar la vuelta a cabeceras en claro).
 *
 * Todas las operaciones de descifrado trabajan sobre una copia del estado y
 * solo la confirman si el mensaje autentica: un frame falso o repetido no
 * mueve nada.
 */

import nacl from "tweetnacl";
import { hkdfSha512, randomNonce, sha512, toHex, utf8Encode, type KeyPair } from "./crypto";
import {
  KEM_CIPHERTEXT_BYTES,
  KEM_PUBLIC_KEY_BYTES,
  kemDecapsulate,
  kemEncapsulate,
  kemKeygen,
  type KemKeyPair,
} from "./pq";

export const V5_MARKER = 0x05;
/** 0.1.50: frame v5 con la cabecera cifrada (ver arriba). */
export const V5_HE_MARKER = 0x06;
const FLAG_HAS_CT = 0x01;
const DH_BYTES = 32;
const HEADER_BYTES = 1 + 1 + DH_BYTES + 4 + 4;
const NONCE_BYTES = nacl.secretbox.nonceLength;
const MAC_BYTES = nacl.secretbox.overheadLength;
/** Máximo de claves saltadas que se calculan/guardan (mensajes perdidos). */
export const MAX_SKIP = 256;
/** Máximo de claves saltadas recordadas en total por sesión. */
const MAX_SKIPPED_STORED = 512;

/** Lo que L manda en su session_confirm (todo en hex). */
export interface V5Offer {
  v: 1;
  dh: string;
  ek: string;
  /** 0.1.50: L entiende cabeceras cifradas. Un H viejo ignora el campo. */
  he?: 1;
}

interface State {
  rk: Uint8Array;
  dhs: KeyPair;
  dhr: Uint8Array | null;
  cks: Uint8Array | null;
  ckr: Uint8Array | null;
  ns: number;
  nr: number;
  pn: number;
  skipped: Map<string, Uint8Array>;
  /** Solo H (Alice): cifrado ML-KEM que acompaña sus frames hasta oír a L. */
  ctToSend: Uint8Array | null;
  /**
   * Material que deja de usarse durante un descifrado. Se borra (fill(0))
   * SOLO si el mensaje autentica y el estado nuevo se confirma: mientras se
   * prueba, esos arrays siguen siendo del estado vivo.
   */
  retired: Uint8Array[];
}

/* ---------- KDFs ---------- */

const T_ROOT = utf8Encode("nido-v5-root");
const T_RK = utf8Encode("nido-v5-rk");
const T_MK = utf8Encode("nido-v5-mk");
const T_CK = utf8Encode("nido-v5-ck");
const T_MSG = utf8Encode("nido-v5-msg");
const T_HK0 = utf8Encode("nido-v5-hk0");
const T_HK1 = utf8Encode("nido-v5-hk1");
const T_CHAIN_STEP_MK = new Uint8Array([0x01]);
const T_CHAIN_STEP_CK = new Uint8Array([0x02]);

function concat(...parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function dh(secret: Uint8Array, pub: Uint8Array): Uint8Array {
  const out = nacl.scalarMult(secret, pub);
  let or = 0;
  for (let i = 0; i < out.length; i++) or |= out[i];
  if (or === 0) throw new Error("v5: clave DH del peer inválida.");
  return out;
}

function kdfRk(rk: Uint8Array, dhOut: Uint8Array): [Uint8Array, Uint8Array] {
  const okm = hkdfSha512(rk, dhOut, T_RK, 64);
  const r: [Uint8Array, Uint8Array] = [okm.slice(0, 32), okm.slice(32, 64)];
  okm.fill(0);
  dhOut.fill(0);
  return r;
}

function kdfCk(ck: Uint8Array): [Uint8Array, Uint8Array] {
  const mk = hkdfSha512(ck, T_CHAIN_STEP_MK, T_MK, 32);
  const next = hkdfSha512(ck, T_CHAIN_STEP_CK, T_CK, 32);
  return [next, mk];
}

/**
 * Raíz del ratchet: mezcla la clave de sesión clásica (X25519 efímero del
 * handshake) con el secreto ML-KEM, y se liga a ambas identidades y al
 * intercambio ML-KEM concreto.
 */
export function deriveV5Root(
  sessionKey: Uint8Array,
  kemSecret: Uint8Array,
  lowPkHex: string,
  highPkHex: string,
  ek: Uint8Array,
  ct: Uint8Array,
): Uint8Array {
  const bind = toHex(sha512(concat(ek, ct)).slice(0, 32));
  const info = utf8Encode(`nido-v5-root|${lowPkHex.toLowerCase()}|${highPkHex.toLowerCase()}|${bind}`);
  const ikm = concat(sessionKey, kemSecret);
  const rk = hkdfSha512(T_ROOT, ikm, info, 32);
  ikm.fill(0);
  return rk;
}

/** 0.1.50: claves de cabecera, ligadas a las dos identidades. */
function headerKey(secret: Uint8Array, tag: Uint8Array, lowPkHex: string, highPkHex: string): Uint8Array {
  return hkdfSha512(tag, secret, utf8Encode(`${lowPkHex}|${highPkHex}`), 32);
}

/* ---------- utilidades de estado ---------- */

function cloneState(s: State): State {
  return {
    rk: s.rk,
    dhs: s.dhs,
    dhr: s.dhr,
    cks: s.cks,
    ckr: s.ckr,
    ns: s.ns,
    nr: s.nr,
    pn: s.pn,
    skipped: new Map(s.skipped),
    ctToSend: s.ctToSend,
    retired: [],
  };
}

function skipKey(dhPub: Uint8Array, n: number): string {
  return `${toHex(dhPub)}:${n}`;
}

function u32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
}

function putU32(b: Uint8Array, o: number, v: number): void {
  b[o] = (v >>> 24) & 0xff;
  b[o + 1] = (v >>> 16) & 0xff;
  b[o + 2] = (v >>> 8) & 0xff;
  b[o + 3] = v & 0xff;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

interface ParsedV5 {
  header: Uint8Array; // todo lo anterior al nonce (incluye ct si hay)
  dh: Uint8Array;
  pn: number;
  n: number;
  ct: Uint8Array | null;
  nonce: Uint8Array;
  boxed: Uint8Array;
}

/** Parsea el cuerpo de un frame v5. null si no tiene forma de v5. */
export function parseV5Body(body: Uint8Array): ParsedV5 | null {
  if (body.length < HEADER_BYTES + NONCE_BYTES + MAC_BYTES) return null;
  if (body[0] !== V5_MARKER) return null;
  const flags = body[1];
  if ((flags & ~FLAG_HAS_CT) !== 0) return null;
  const hasCt = (flags & FLAG_HAS_CT) !== 0;
  const headerLen = HEADER_BYTES + (hasCt ? KEM_CIPHERTEXT_BYTES : 0);
  if (body.length < headerLen + NONCE_BYTES + MAC_BYTES) return null;
  const dhPub = body.slice(2, 2 + DH_BYTES);
  const pn = u32(body, 2 + DH_BYTES);
  const n = u32(body, 2 + DH_BYTES + 4);
  const ct = hasCt ? body.slice(HEADER_BYTES, HEADER_BYTES + KEM_CIPHERTEXT_BYTES) : null;
  return {
    header: body.slice(0, headerLen),
    dh: dhPub,
    pn,
    n,
    ct,
    nonce: body.slice(headerLen, headerLen + NONCE_BYTES),
    boxed: body.slice(headerLen + NONCE_BYTES),
  };
}

function messageKey(mk: Uint8Array, header: Uint8Array): Uint8Array {
  return hkdfSha512(mk, header, T_MSG, 32);
}

function openWith(mk: Uint8Array, p: ParsedV5): Uint8Array | null {
  const k = messageKey(mk, p.header);
  const out = nacl.secretbox.open(p.boxed, p.nonce, k);
  k.fill(0);
  return out;
}

function skipUntil(s: State, until: number): boolean {
  if (s.ckr === null) return true;
  if (until < s.nr) return true;
  if (until - s.nr > MAX_SKIP) return false;
  while (s.nr < until) {
    const [next, mk] = kdfCk(s.ckr);
    s.skipped.set(skipKey(s.dhr!, s.nr), mk);
    s.retired.push(s.ckr);
    s.ckr = next;
    s.nr++;
  }
  // Tope total: se descartan las más antiguas (orden de inserción). No se
  // borran aquí: pueden ser del estado vivo; se borran al confirmar.
  while (s.skipped.size > MAX_SKIPPED_STORED) {
    const oldest = s.skipped.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    const mk = s.skipped.get(oldest);
    if (mk) s.retired.push(mk);
    s.skipped.delete(oldest);
  }
  return true;
}

function dhRatchet(s: State, theirDh: Uint8Array): void {
  s.pn = s.ns;
  s.ns = 0;
  s.nr = 0;
  s.dhr = theirDh;
  const oldRk = s.rk;
  const oldCkr = s.ckr;
  const oldCks = s.cks;
  const oldDhs = s.dhs;
  let mid: Uint8Array;
  [mid, s.ckr] = kdfRk(oldRk, dh(oldDhs.secretKey, s.dhr));
  s.dhs = nacl.box.keyPair();
  [s.rk, s.cks] = kdfRk(mid, dh(s.dhs.secretKey, s.dhr));
  mid.fill(0); // intermedio propio de este paso
  s.retired.push(oldRk, oldDhs.secretKey);
  if (oldCkr) s.retired.push(oldCkr);
  if (oldCks) s.retired.push(oldCks);
}

/* ---------- la sesión v5 ---------- */

export type V5Role = "low" | "high";

/**
 * Estado v5 de UNA conexión. Lo crea P2PSession cuando ambos lados lo
 * activaron. Nunca lanza hacia fuera en `open`: devuelve null.
 */
export class V5Ratchet {
  readonly role: V5Role;
  private state: State | null = null;
  /** Solo L: claves de la oferta, hasta arrancar como Bob. */
  private offer: { dh: KeyPair; kem: KemKeyPair } | null = null;
  private readonly sessionKey: Uint8Array;
  private readonly lowPk: string;
  private readonly highPk: string;
  /** ¿Ya llegó al menos un frame v5 válido del peer? */
  private heardV5 = false;
  /**
   * 0.1.50: ¿cabeceras cifradas? true/false una vez decidido; null = L
   * todavía no sabe si H lo entiende (lo sabrá con el primer frame de H).
   */
  private he: boolean | null = false;
  /**
   * 0.1.50: clave de cabecera desde la clave clásica (primeros frames de H).
   * 0.1.52: se borra en cuanto deja de hacer falta (H: al oír a L; L: con el
   * primer frame de H que ya no trae el cifrado ML-KEM).
   */
  private hk0: Uint8Array | null;
  /** 0.1.50: clave de cabecera desde la raíz v5 (null hasta conocer la raíz). */
  private hk1: Uint8Array | null = null;

  private constructor(role: V5Role, sessionKey: Uint8Array, lowPk: string, highPk: string) {
    this.role = role;
    // Copia propia: P2PSession conserva la suya para el modo clásico.
    this.sessionKey = sessionKey.slice();
    this.lowPk = lowPk.toLowerCase();
    this.highPk = highPk.toLowerCase();
    this.hk0 = headerKey(this.sessionKey, T_HK0, this.lowPk, this.highPk);
  }

  /** 0.1.50: ¿esta conexión ya usa cabeceras cifradas? */
  get headerEncrypted(): boolean {
    return this.he === true;
  }

  /** L: prepara la oferta (clave de ratchet + clave ML-KEM). */
  static createOffer(sessionKey: Uint8Array, lowPk: string, highPk: string): { ratchet: V5Ratchet; offer: V5Offer } {
    const r = new V5Ratchet("low", sessionKey, lowPk, highPk);
    const dhKp = nacl.box.keyPair();
    const kem = kemKeygen();
    r.offer = { dh: dhKp, kem };
    r.he = null; // se sabrá con el primer frame v5 de H
    return { ratchet: r, offer: { v: 1, dh: toHex(dhKp.publicKey), ek: toHex(kem.publicKey), he: 1 } };
  }

  /** H: acepta la oferta de L y arranca como Alice. null si la oferta no es válida. */
  static acceptOffer(sessionKey: Uint8Array, lowPk: string, highPk: string, offer: unknown): V5Ratchet | null {
    const parsed = parseOffer(offer);
    if (!parsed) return null;
    try {
      const r = new V5Ratchet("high", sessionKey, lowPk, highPk);
      const { cipherText, sharedSecret } = kemEncapsulate(parsed.ek);
      const rk0 = deriveV5Root(r.sessionKey, sharedSecret, r.lowPk, r.highPk, parsed.ek, cipherText);
      sharedSecret.fill(0);
      r.he = parsed.he;
      r.hk1 = headerKey(rk0, T_HK1, r.lowPk, r.highPk);
      const dhs = nacl.box.keyPair();
      const [rk, cks] = kdfRk(rk0, dh(dhs.secretKey, parsed.dh));
      rk0.fill(0);
      r.state = {
        rk,
        dhs,
        dhr: parsed.dh,
        cks,
        ckr: null,
        ns: 0,
        nr: 0,
        pn: 0,
        skipped: new Map(),
        ctToSend: cipherText,
        retired: [],
      };
      // La clave clásica ya cumplió su papel en el ratchet: fuera de memoria.
      r.sessionKey.fill(0);
      return r;
    } catch {
      return null;
    }
  }

  /** ¿Puede ya cifrar en v5? (H: siempre tras aceptar; L: tras el primer v5 de H.) */
  get canSend(): boolean {
    return this.state !== null && this.state.cks !== null;
  }

  /** ¿Llegó ya un frame v5 válido del peer? Desde entonces no se acepta el modo clásico. */
  get peerUsesV5(): boolean {
    return this.heardV5;
  }

  /** Cifra un mensaje (ya relleno). Lanza si todavía no puede enviar. */
  seal(plaintext: Uint8Array): Uint8Array {
    const s = this.state;
    if (!s || !s.cks) throw new Error("v5: todavía no se puede cifrar.");
    const [next, mk] = kdfCk(s.cks);
    const hasCt = s.ctToSend !== null;
    const header = new Uint8Array(HEADER_BYTES + (hasCt ? KEM_CIPHERTEXT_BYTES : 0));
    header[0] = V5_MARKER;
    header[1] = hasCt ? FLAG_HAS_CT : 0;
    header.set(s.dhs.publicKey, 2);
    putU32(header, 2 + DH_BYTES, s.pn);
    putU32(header, 2 + DH_BYTES + 4, s.ns);
    if (hasCt) header.set(s.ctToSend!, HEADER_BYTES);
    const nonce = randomNonce(NONCE_BYTES);
    const k = messageKey(mk, header);
    const boxed = nacl.secretbox(plaintext, nonce, k);
    k.fill(0);
    mk.fill(0);
    s.cks.fill(0);
    s.cks = next;
    s.ns++;
    const inner = concat(header, nonce, boxed);
    if (this.he !== true) return inner;
    // 0.1.50: todo el frame v5 dentro de la caja de cabecera. Con el cifrado
    // ML-KEM a bordo (primeros frames de H), L aún no tiene la raíz: hk0.
    const hk = hasCt ? this.hk0 : this.hk1;
    if (!hk) throw new Error("v5: falta la clave de cabecera.");
    const outerNonce = randomNonce(NONCE_BYTES);
    return concat(new Uint8Array([V5_HE_MARKER]), outerNonce, nacl.secretbox(inner, outerNonce, hk));
  }

  private wipeHk0(): void {
    if (this.hk0) {
      this.hk0.fill(0);
      this.hk0 = null;
    }
  }

  /**
   * 0.1.50: quita la caja de cabecera. Devuelve el frame v5 de dentro, o
   * null. Se prueban las claves que este lado conoce (hk1 primero).
   */
  private unwrapHeader(body: Uint8Array): Uint8Array | null {
    if (body.length < 1 + NONCE_BYTES + MAC_BYTES) return null;
    const n = body.slice(1, 1 + NONCE_BYTES);
    const boxed = body.slice(1 + NONCE_BYTES);
    for (const k of [this.hk1, this.hk0]) {
      if (!k) continue;
      const inner = nacl.secretbox.open(boxed, n, k);
      if (inner && inner[0] === V5_MARKER) return inner;
    }
    return null;
  }

  /**
   * Abre el cuerpo de un frame v5. Solo confirma el nuevo estado si el
   * mensaje autentica; si no, devuelve null y nada cambia.
   */
  open(body: Uint8Array): Uint8Array | null {
    // 0.1.50: ¿con caja de cabecera?
    let wrapped = false;
    if (body[0] === V5_HE_MARKER) {
      // Solo si lo pedimos/aceptamos (L lo pidió: he null o true; H: si L lo pidió).
      if (this.he === false) return null;
      const inner = this.unwrapHeader(body);
      if (!inner) return null;
      body = inner;
      wrapped = true;
    } else if (this.he === true) {
      // Ya se usan cabeceras cifradas: un frame sin caja es un intento de
      // volver a cabeceras en claro.
      return null;
    }
    const p = parseV5Body(body);
    if (!p) return null;
    let newHk1: Uint8Array | null = null;
    try {
      let s: State;
      if (this.state === null) {
        // L (Bob) arrancando: hace falta el cifrado ML-KEM.
        if (this.role !== "low" || !this.offer || !p.ct) return null;
        const ss = kemDecapsulate(p.ct, this.offer.kem.secretKey);
        const rk0 = deriveV5Root(this.sessionKey, ss, this.lowPk, this.highPk, this.offer.kem.publicKey, p.ct);
        ss.fill(0);
        newHk1 = headerKey(rk0, T_HK1, this.lowPk, this.highPk);
        s = {
          rk: rk0,
          dhs: this.offer.dh,
          dhr: null,
          cks: null,
          ckr: null,
          ns: 0,
          nr: 0,
          pn: 0,
          skipped: new Map(),
          ctToSend: null,
          retired: [],
        };
      } else {
        s = cloneState(this.state);
      }
      const plain = this.openWithState(s, p);
      if (!plain) {
        newHk1?.fill(0);
        return null;
      }
      // 0.1.50: L decide con el primer frame auténtico de H si hay cabeceras
      // cifradas (lo hay si H mandó la caja), y desde entonces no cambia.
      if (this.he === null) this.he = wrapped;
      if (newHk1) this.hk1 = newHk1;
      // Éxito: se confirma el estado.
      if (this.state === null) {
        // Bob ya arrancó: las claves de la oferta y la clave clásica dejan
        // de hacer falta en el ratchet.
        this.offer!.kem.secretKey.fill(0);
        this.offer = null;
        this.sessionKey.fill(0);
      }
      if (this.role === "high") {
        s.ctToSend = null; // L ya tiene el secreto ML-KEM
        this.wipeHk0(); // H ya no manda frames con el cifrado ML-KEM
      } else if (!p.ct) {
        this.wipeHk0(); // H ya oyó a L: no llegarán más frames con hk0
      }
      // Confirmado: ahora sí se borra lo que este mensaje dejó en desuso.
      for (const k of s.retired) k.fill(0);
      s.retired = [];
      this.state = s;
      this.heardV5 = true;
      return plain;
    } catch {
      return null;
    }
  }

  private openWithState(s: State, p: ParsedV5): Uint8Array | null {
    // 1) ¿Clave saltada guardada?
    const sk = skipKey(p.dh, p.n);
    const saved = s.skipped.get(sk);
    if (saved) {
      const plain = openWith(saved, p);
      if (plain) {
        s.skipped.delete(sk);
        s.retired.push(saved);
      }
      return plain;
    }
    // 2) ¿Nuevo turno del peer? → ratchet DH. Antes de calcular nada se
    // comprueba el coste total (lo que falta de la cadena vieja + la nueva):
    // un frame falso no puede obligar a derivar más de MAX_SKIP claves.
    if (s.dhr === null || !equalBytes(p.dh, s.dhr)) {
      const oldCost = s.ckr !== null && p.pn > s.nr ? p.pn - s.nr : 0;
      if (oldCost + p.n > MAX_SKIP) return null;
      if (!skipUntil(s, p.pn)) return null;
      dhRatchet(s, p.dh);
    }
    if (!skipUntil(s, p.n)) return null;
    if (s.ckr === null) return null;
    const [next, mk] = kdfCk(s.ckr);
    const plain = openWith(mk, p);
    mk.fill(0);
    if (!plain) return null;
    s.retired.push(s.ckr);
    s.ckr = next;
    s.nr++;
    return plain;
  }
}

/**
 * Solo tests: quita la caja de cabecera con las claves de `r` (para comprobar
 * que el frame de dentro existe y que, sin la caja, se rechaza).
 */
export function unwrapHeaderForTests(r: V5Ratchet, body: Uint8Array): Uint8Array | null {
  return (r as unknown as { unwrapHeader(b: Uint8Array): Uint8Array | null }).unwrapHeader(body);
}

function parseOffer(offer: unknown): { dh: Uint8Array; ek: Uint8Array; he: boolean } | null {
  if (typeof offer !== "object" || offer === null) return null;
  const o = offer as Record<string, unknown>;
  if (o.v !== 1 || typeof o.dh !== "string" || typeof o.ek !== "string") return null;
  if (!/^[0-9a-f]{64}$/.test(o.dh)) return null;
  if (o.ek.length !== KEM_PUBLIC_KEY_BYTES * 2 || !/^[0-9a-f]+$/.test(o.ek)) return null;
  const dhBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) dhBytes[i] = parseInt(o.dh.slice(i * 2, i * 2 + 2), 16);
  const ek = new Uint8Array(KEM_PUBLIC_KEY_BYTES);
  for (let i = 0; i < ek.length; i++) ek[i] = parseInt(o.ek.slice(i * 2, i * 2 + 2), 16);
  return { dh: dhBytes, ek, he: o.he === 1 };
}
