/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Mensajes de amigo en amigo (P2P «relay», fase 1) — la criptografía.
 *
 * El problema: hoy un mensaje NIDO solo llega si los dos teléfonos se
 * encuentran. Con esto, A puede dar a B (un contacto suyo) un sobre
 * sellado para C, y B se lo entrega a C cuando se cruzan, sin internet.
 * B no puede leerlo, ni cambiarlo, ni hacerse pasar por A.
 *
 * Piezas:
 * - **Clave de buzón** (carry prekey): cada teléfono genera un par
 *   X25519 + ML-KEM-768 que caduca a los 14 días, lo firma con su clave
 *   Ed25519 de identidad (la del QR) y se lo da a sus contactos por la
 *   sesión cifrada de siempre. Quien quiera escribirle sin verlo usa esa
 *   clave.
 * - **Sobre** (carry envelope), versión 2: patrón Noise «X» (un solo
 *   mensaje, remitente con clave estática) con ML-KEM-768 mezclado, igual
 *   que el modo «Auth» de HPKE (RFC 9180):
 *     1. X25519(efímera, buzón) y ML-KEM-768 hacia el buzón → clave de
 *        cabecera, que cifra la identidad X25519 del remitente (32 bytes).
 *     2. + X25519(identidad del remitente, buzón) → clave del cuerpo, que
 *        cifra el mensaje con relleno a tamaños fijos.
 *   Todo va atado (en el «info» del KDF) a la clave de buzón exacta (id,
 *   X25519 y hash del ML-KEM), a la efímera, al cifrado ML-KEM y, el
 *   cuerpo, a la identidad del remitente. Para descifrar hay que romper
 *   X25519 **y** ML-KEM; para hacerse pasar por Ana hay que tener la
 *   clave de identidad de Ana (o la clave de buzón secreta de Caro: ver
 *   «KCI» en docs/RELAY.md).
 *
 *   **Sin firma por mensaje, a propósito (negable):** en la v1 cada
 *   mensaje iba firmado con Ed25519, así que quien consiguiera el teléfono
 *   de Caro tenía una prueba transferible de que Ana escribió ese texto.
 *   Con la autenticación por Diffie-Hellman, Caro sabe que es de Ana,
 *   pero no puede probárselo a nadie: ella misma podría haber fabricado un
 *   sobre igual. Es lo que hacen Signal (X3DH) y Noise.
 *
 *   Por fuera, solo lo que un mensajero necesita: una etiqueta que
 *   reconocen los contactos del destinatario, la caducidad y los saltos
 *   que quedan.
 *
 * Dominios nuevos, disjuntos de los demás (ver CRYPTO_ARCHITECTURE §1):
 * "nido-carry-prekey-v2" (firma de la clave de buzón), "nido-carry-v2"
 * (sal del KDF), "nido-carry-ctx-v2", "nido-carry-hdr-v2",
 * "nido-carry-body-v2" y "nido-carry-tag-v2|<día>" (info).
 */

import nacl from "tweetnacl";
import {
  fromHex,
  hkdfSha512,
  randomNonce,
  sha512,
  signDetached,
  toHex,
  utf8Decode,
  utf8Encode,
  verifyDetached,
} from "../crypto";
import {
  kemDecapsulate,
  kemEncapsulate,
  kemKeygen,
  KEM_CIPHERTEXT_BYTES,
  KEM_PUBLIC_KEY_BYTES,
  KEM_SECRET_KEY_BYTES,
} from "../pq";

export const CARRY_VERSION = 2;
/** Vida de una clave de buzón. Se rota antes: ver needsRotation. */
export const PREKEY_TTL_MS = 14 * 24 * 3600 * 1000;
/** Vida máxima de un sobre. */
export const MAX_ENVELOPE_TTL_MS = 72 * 3600 * 1000;
/** Saltos máximos (A → B → D → C = 3). */
export const MAX_HOPS = 3;
/** Tamaños a los que se rellena el contenido (ocultan la longitud real). */
export const PAD_BUCKETS = [1024, 2048, 4096, 8192] as const;
/**
 * Texto máximo dentro de un sobre: 1.500 caracteres caben en el cubo mayor
 * aunque todos ocupen 4 bytes (emojis) más la firma y los campos.
 */
export const MAX_CARRY_TEXT = 1500;
export const TAG_BYTES = 16;
/** Cabecera cifrada: identidad X25519 del remitente (32) + MAC (16). */
export const HEADER_BYTES = 32 + 16;
/** Margen de reloj aceptado entre teléfonos. */
const CLOCK_SKEW_MS = 10 * 60 * 1000;

export interface CarryPrekeyPublic {
  /** 16 bytes aleatorios en hex: nombre de la clave. */
  id: string;
  /** Identidad X25519 del dueño (la del QR), hex. */
  owner: string;
  x25519: string;
  kem: string;
  createdAt: number;
  expiresAt: number;
  /** Firma Ed25519 del dueño, hex. */
  sig: string;
}

export interface CarryPrekeySecret {
  id: string;
  x25519Sk: Uint8Array;
  kemSk: Uint8Array;
  expiresAt: number;
}

function prekeyTranscript(p: Omit<CarryPrekeyPublic, "sig">): Uint8Array {
  const kemHash = toHex(sha512(fromHex(p.kem)).slice(0, 32));
  return utf8Encode(
    `nido-carry-prekey-v${CARRY_VERSION}|${p.owner.toLowerCase()}|${p.id}|${p.x25519.toLowerCase()}|${kemHash}|${p.createdAt}|${p.expiresAt}`,
  );
}

/** Clave de buzón nueva, firmada con la Ed25519 de identidad. */
export function generateCarryPrekey(
  ownerPkHex: string,
  signSecretKey: Uint8Array,
  now: number,
): { pub: CarryPrekeyPublic; secret: CarryPrekeySecret } {
  const x = nacl.box.keyPair();
  const k = kemKeygen();
  const base = {
    id: toHex(randomNonce(16)),
    owner: ownerPkHex.toLowerCase(),
    x25519: toHex(x.publicKey),
    kem: toHex(k.publicKey),
    createdAt: now,
    expiresAt: now + PREKEY_TTL_MS,
  };
  const sig = toHex(signDetached(prekeyTranscript(base), signSecretKey));
  return {
    pub: { ...base, sig },
    secret: { id: base.id, x25519Sk: x.secretKey, kemSk: k.secretKey, expiresAt: base.expiresAt },
  };
}

const HEX = (n: number) => new RegExp(`^[0-9a-f]{${n}}$`);

/**
 * ¿Es esta clave de buzón del contacto, está firmada por él y vigente?
 * `ownerSigPkHex` es la Ed25519 del QR de ese contacto (la única
 * autoridad, como en el saludo). Nunca lanza.
 */
export function verifyCarryPrekey(p: unknown, ownerPkHex: string, ownerSigPkHex: string, now: number): p is CarryPrekeyPublic {
  try {
    const q = p as CarryPrekeyPublic;
    if (!q || typeof q !== "object") return false;
    if (!HEX(32).test(q.id) || !HEX(64).test(q.owner) || !HEX(64).test(q.x25519) || !HEX(128).test(q.sig)) return false;
    if (typeof q.kem !== "string" || q.kem.length !== KEM_PUBLIC_KEY_BYTES * 2 || !/^[0-9a-f]+$/.test(q.kem)) return false;
    if (!Number.isSafeInteger(q.createdAt) || !Number.isSafeInteger(q.expiresAt)) return false;
    if (q.owner !== ownerPkHex.toLowerCase()) return false;
    if (q.expiresAt <= now || q.createdAt > now + CLOCK_SKEW_MS) return false;
    if (q.expiresAt - q.createdAt > PREKEY_TTL_MS) return false;
    const { sig, ...base } = q;
    return verifyDetached(prekeyTranscript(base), fromHex(sig), fromHex(ownerSigPkHex));
  } catch {
    return false;
  }
}

/** ¿Toca generar una clave nueva? A mitad de vida, para que los contactos la reciban antes de que caduque la vieja. */
export function needsRotation(newest: { createdAt: number; expiresAt: number } | null, now: number): boolean {
  if (!newest) return true;
  return now >= newest.createdAt + (newest.expiresAt - newest.createdAt) / 2;
}

const DAY_MS = 24 * 3600 * 1000;
const SALT = `nido-carry-v${CARRY_VERSION}`;

/** Día (UTC) de un instante: la etiqueta cambia cada día. */
export function carryDay(t: number): number {
  return Math.floor(t / DAY_MS);
}

/**
 * Etiqueta por fuera del sobre: la reconocen quienes tienen la clave de
 * buzón (los contactos del destinatario). No revela al destinatario a
 * nadie más. **Cambia cada día** (como las claves que rotan en las redes
 * de búsqueda de dispositivos): quien lleva sobres sin ser contacto del
 * destinatario no puede ligar los sobres de un día con los del siguiente.
 */
export function carryTag(prekeyId: string, day: number): string {
  return toHex(hkdfSha512(utf8Encode(SALT), fromHex(prekeyId), utf8Encode(`nido-carry-tag-v${CARRY_VERSION}|${day}`), TAG_BYTES));
}

/**
 * Etiquetas con las que puede llegar hoy un sobre para esta clave: un
 * sobre dura 72 h como mucho, así que se miran los últimos 3 días, hoy y
 * mañana (relojes un poco adelantados).
 */
export function carryTagsFor(prekeyId: string, now: number): string[] {
  const d = carryDay(now);
  const out: string[] = [];
  for (let k = d - 3; k <= d + 1; k++) out.push(carryTag(prekeyId, k));
  return out;
}

export interface CarryInner {
  v: number;
  /** Remitente (X25519 de identidad, hex). Debe coincidir con el de la cabecera. */
  from: string;
  /** Destinatario (X25519 de identidad, hex). */
  to: string;
  /** Id estable del mensaje (deduplicación y acuse). */
  id: string;
  ts: number;
  /** Caducidad autenticada: la de fuera es solo una pista para los mensajeros. */
  exp: number;
  prekey: string;
  kind: "chat" | "receipt";
  text: string;
}

export interface CarryEnvelope {
  t: "nido-carry";
  v: number;
  /** Id del sobre, aleatorio (no el del mensaje). */
  eid: string;
  tag: string;
  exp: number;
  hops: number;
  eph: string;
  kct: string;
  /** Nonce del cuerpo (la cabecera usa nonce cero: su clave es de un solo uso). */
  nonce: string;
  /** Cabecera cifrada (48 bytes) seguida del cuerpo cifrado. */
  box: string;
}

function pad(bytes: Uint8Array): Uint8Array {
  const target = PAD_BUCKETS.find((b) => b >= bytes.length + 4);
  if (!target) throw new Error("Mensaje demasiado largo para un sobre.");
  const out = new Uint8Array(target);
  new DataView(out.buffer).setUint32(0, bytes.length);
  out.set(bytes, 4);
  return out;
}

function unpad(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 4 || !PAD_BUCKETS.includes(bytes.length as (typeof PAD_BUCKETS)[number])) return null;
  const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (n > bytes.length - 4) return null;
  // El relleno debe ser ceros: un sobre válido tiene una sola forma.
  for (let i = 4 + n; i < bytes.length; i++) if (bytes[i] !== 0) return null;
  return bytes.slice(4, 4 + n);
}

/** La clave pública ML-KEM va dentro de la secreta (FIPS 203: dk = dk_pke ‖ ek ‖ H(ek) ‖ z). */
export function kemPublicFromSecret(kemSk: Uint8Array): Uint8Array {
  if (kemSk.length !== KEM_SECRET_KEY_BYTES) throw new Error("Clave ML-KEM con tamaño inesperado.");
  const off = 384 * 3;
  return kemSk.slice(off, off + KEM_PUBLIC_KEY_BYTES);
}

const h32 = (b: Uint8Array) => sha512(b).slice(0, 32);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Todo lo público que ata las claves de un sobre: buzón exacto, efímera y cifrado ML-KEM. */
function context(prekeyId: string, rX: Uint8Array, rKem: Uint8Array, eph: Uint8Array, kct: Uint8Array): string {
  return toHex(h32(utf8Encode(`nido-carry-ctx-v${CARRY_VERSION}|${prekeyId}|${toHex(rX)}|${toHex(h32(rKem))}|${toHex(eph)}|${toHex(h32(kct))}`)));
}

/** Paso 1: clave de la cabecera y clave de encadenado, de X25519(efímera, buzón) ‖ ML-KEM. */
function headerKeys(dhE: Uint8Array, ssKem: Uint8Array, ctx: string): { k1: Uint8Array; ck: Uint8Array } {
  const ikm = concat(dhE, ssKem);
  const out = hkdfSha512(utf8Encode(SALT), ikm, utf8Encode(`nido-carry-hdr-v${CARRY_VERSION}|${ctx}`), 64);
  ikm.fill(0);
  return { k1: out.slice(0, 32), ck: out.slice(32, 64) };
}

/** Paso 2: clave del cuerpo, que añade X25519(identidad del remitente, buzón). */
function bodyKey(ck: Uint8Array, dhS: Uint8Array, ctx: string, senderPkHex: string): Uint8Array {
  return hkdfSha512(ck, dhS, utf8Encode(`nido-carry-body-v${CARRY_VERSION}|${ctx}|${senderPkHex}`), 32);
}

function isZero(b: Uint8Array): boolean {
  let o = 0;
  for (let i = 0; i < b.length; i++) o |= b[i];
  return o === 0;
}

const ZERO_NONCE = new Uint8Array(nacl.secretbox.nonceLength);

export interface SealArgs {
  recipient: CarryPrekeyPublic;
  senderPkHex: string;
  /** Clave secreta X25519 de identidad del remitente (la del QR). */
  senderSecretKey: Uint8Array;
  id: string;
  kind: CarryInner["kind"];
  text: string;
  now: number;
  ttlMs?: number;
  hops?: number;
}

/** Sella un mensaje para `recipient` (su clave de buzón ya verificada). */
export function sealCarry(a: SealArgs): CarryEnvelope {
  if (a.text.length > MAX_CARRY_TEXT) throw new Error("Mensaje demasiado largo para un sobre.");
  if (typeof a.id !== "string" || a.id.length === 0 || a.id.length > 64) throw new Error("Id de mensaje inválido.");
  const senderPk = a.senderPkHex.toLowerCase();
  if (toHex(nacl.scalarMult.base(a.senderSecretKey)) !== senderPk) throw new Error("La clave secreta no es la de esta identidad.");
  const ttl = Math.min(a.ttlMs ?? MAX_ENVELOPE_TTL_MS, MAX_ENVELOPE_TTL_MS, a.recipient.expiresAt - a.now);
  if (ttl <= 0) throw new Error("La clave de buzón del contacto ha caducado.");
  const inner: CarryInner = {
    v: CARRY_VERSION,
    from: senderPk,
    to: a.recipient.owner,
    id: a.id,
    ts: a.now,
    exp: a.now + ttl,
    prekey: a.recipient.id,
    kind: a.kind,
    text: a.text,
  };
  const plain = pad(utf8Encode(JSON.stringify(inner)));

  const rX = fromHex(a.recipient.x25519);
  const rKem = fromHex(a.recipient.kem);
  const eph = nacl.box.keyPair();
  const dhE = nacl.scalarMult(eph.secretKey, rX);
  eph.secretKey.fill(0);
  const dhS = nacl.scalarMult(a.senderSecretKey, rX);
  if (isZero(dhE) || isZero(dhS)) throw new Error("Clave de buzón inválida.");
  const { cipherText, sharedSecret } = kemEncapsulate(rKem);
  const ctx = context(a.recipient.id, rX, rKem, eph.publicKey, cipherText);
  const { k1, ck } = headerKeys(dhE, sharedSecret, ctx);
  dhE.fill(0);
  sharedSecret.fill(0);
  const header = nacl.secretbox(fromHex(senderPk), ZERO_NONCE, k1);
  k1.fill(0);
  const k2 = bodyKey(ck, dhS, ctx, senderPk);
  ck.fill(0);
  dhS.fill(0);
  const nonce = randomNonce(nacl.secretbox.nonceLength);
  const body = nacl.secretbox(plain, nonce, k2);
  k2.fill(0);
  return {
    t: "nido-carry",
    v: CARRY_VERSION,
    eid: toHex(randomNonce(16)),
    tag: carryTag(a.recipient.id, carryDay(a.now)),
    exp: inner.exp,
    hops: Math.max(1, Math.min(MAX_HOPS, a.hops ?? MAX_HOPS)),
    eph: toHex(eph.publicKey),
    kct: toHex(cipherText),
    nonce: toHex(nonce),
    box: toHex(header) + toHex(body),
  };
}

/** Forma del sobre, sin abrirlo (lo que comprueba cualquier mensajero). Nunca lanza. */
export function isWellFormedEnvelope(e: unknown): e is CarryEnvelope {
  try {
    const q = e as CarryEnvelope;
    if (!q || typeof q !== "object" || q.t !== "nido-carry" || q.v !== CARRY_VERSION) return false;
    if (!HEX(32).test(q.eid) || !HEX(TAG_BYTES * 2).test(q.tag) || !HEX(64).test(q.eph) || !HEX(48).test(q.nonce)) return false;
    if (typeof q.kct !== "string" || q.kct.length !== KEM_CIPHERTEXT_BYTES * 2 || !/^[0-9a-f]+$/.test(q.kct)) return false;
    if (!Number.isSafeInteger(q.exp) || !Number.isInteger(q.hops) || q.hops < 0 || q.hops > MAX_HOPS) return false;
    if (typeof q.box !== "string" || q.box.length % 2 !== 0 || !/^[0-9a-f]+$/.test(q.box)) return false;
    const boxLen = q.box.length / 2;
    return PAD_BUCKETS.some((b) => HEADER_BYTES + b + nacl.secretbox.overheadLength === boxLen);
  } catch {
    return false;
  }
}

/** Tamaño en bytes que ocupa el sobre (para los topes del almacén). */
export function envelopeBytes(e: CarryEnvelope): number {
  return JSON.stringify(e).length;
}

export interface OpenedCarry {
  from: string;
  id: string;
  ts: number;
  /** Caducidad autenticada (hasta cuándo recordar que ya se abrió). */
  exp: number;
  kind: CarryInner["kind"];
  text: string;
}

/**
 * Abre un sobre dirigido a mí. Devuelve null si no es para mí, si está
 * manipulado, caducado, o si el remitente no es un contacto mío. Nunca
 * lanza.
 *
 * @param myPrekeys mis claves de buzón secretas vigentes (un sobre nunca dura más que su clave)
 * @param myPkHex mi identidad X25519
 * @param isContact ¿es esta identidad X25519 un contacto mío (vivo, no revocado)?
 */
export function openCarry(
  e: unknown,
  myPrekeys: readonly CarryPrekeySecret[],
  myPkHex: string,
  isContact: (pkHex: string) => boolean,
  now: number,
): OpenedCarry | null {
  try {
    if (!isWellFormedEnvelope(e)) return null;
    const me = myPkHex.toLowerCase();
    const pk = myPrekeys.find((p) => carryTagsFor(p.id, now).includes(e.tag));
    if (!pk) return null;
    const eph = fromHex(e.eph);
    const kct = fromHex(e.kct);
    const rX = nacl.scalarMult.base(pk.x25519Sk);
    const rKem = kemPublicFromSecret(pk.kemSk);
    const ctx = context(pk.id, rX, rKem, eph, kct);
    const dhE = nacl.scalarMult(pk.x25519Sk, eph);
    if (isZero(dhE)) return null;
    const ss = kemDecapsulate(kct, pk.kemSk);
    const { k1, ck } = headerKeys(dhE, ss, ctx);
    dhE.fill(0);
    ss.fill(0);
    const box = fromHex(e.box);
    const senderRaw = nacl.secretbox.open(box.subarray(0, HEADER_BYTES), ZERO_NONCE, k1);
    k1.fill(0);
    if (!senderRaw || senderRaw.length !== 32) return null;
    const from = toHex(senderRaw);
    // Antes de gastar más: solo contactos (y nunca yo mismo).
    if (from === me || !isContact(from)) return null;
    const dhS = nacl.scalarMult(pk.x25519Sk, senderRaw);
    if (isZero(dhS)) return null;
    const k2 = bodyKey(ck, dhS, ctx, from);
    ck.fill(0);
    dhS.fill(0);
    const plain = nacl.secretbox.open(box.subarray(HEADER_BYTES), fromHex(e.nonce), k2);
    k2.fill(0);
    if (!plain) return null;
    const body = unpad(plain);
    if (!body) return null;
    const i = JSON.parse(utf8Decode(body)) as CarryInner;
    if (!i || typeof i !== "object" || i.v !== CARRY_VERSION) return null;
    if (i.from !== from || i.to !== me || i.prekey !== pk.id) return null;
    if (i.kind !== "chat" && i.kind !== "receipt") return null;
    if (typeof i.text !== "string" || i.text.length > MAX_CARRY_TEXT) return null;
    if (typeof i.id !== "string" || i.id.length === 0 || i.id.length > 64) return null;
    if (!Number.isSafeInteger(i.exp) || !Number.isSafeInteger(i.ts)) return null;
    if (i.exp <= now || i.ts > now + CLOCK_SKEW_MS || i.exp - i.ts > MAX_ENVELOPE_TTL_MS) return null;
    return { from, id: i.id, ts: i.ts, exp: i.exp, kind: i.kind, text: i.text };
  } catch {
    return null;
  }
}
