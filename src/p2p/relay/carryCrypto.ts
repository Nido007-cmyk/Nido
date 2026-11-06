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
 * - **Sobre** (carry envelope): por dentro, el mensaje firmado por el
 *   remitente con su Ed25519 (dominio propio) y relleno a tamaños fijos;
 *   cifrado con una clave que sale de un X25519 efímero contra la clave
 *   de buzón **y** de un encapsulado ML-KEM-768 (híbrido: hay que romper
 *   los dos). Por fuera, solo lo que un mensajero necesita: una etiqueta
 *   que reconocen los contactos del destinatario, la caducidad y los
 *   saltos que quedan.
 *
 * Dominios nuevos, disjuntos de los demás (ver CRYPTO_ARCHITECTURE §1):
 * "nido-carry-prekey-v1" (firma de la clave de buzón),
 * "nido-carry-msg-v1" (firma del mensaje), "nido-carry-v1" (sal del KDF),
 * "nido-carry-key-v1" e "nido-carry-tag-v1" (info).
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
import { kemDecapsulate, kemEncapsulate, kemKeygen, KEM_CIPHERTEXT_BYTES, KEM_PUBLIC_KEY_BYTES } from "../pq";

export const CARRY_VERSION = 1;
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
    if (q.expiresAt <= now || q.createdAt > now + 10 * 60 * 1000) return false;
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

/**
 * Etiqueta por fuera del sobre: la reconocen quienes tienen la clave de
 * buzón (los contactos del destinatario). No revela al destinatario a
 * nadie más. Es estable mientras dura la clave: ver el modelo de amenazas.
 */
export function carryTag(prekeyId: string): string {
  return toHex(hkdfSha512(utf8Encode("nido-carry-v1"), fromHex(prekeyId), utf8Encode("nido-carry-tag-v1"), TAG_BYTES));
}

export interface CarryInner {
  v: number;
  /** Remitente (X25519 de identidad, hex). */
  from: string;
  /** Destinatario (X25519 de identidad, hex). */
  to: string;
  /** Id estable del mensaje (deduplicación y acuse). */
  id: string;
  ts: number;
  /** Caducidad firmada: la de fuera es solo una pista para los mensajeros. */
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
  nonce: string;
  box: string;
}

function canonicalInner(i: CarryInner): string {
  return JSON.stringify([i.v, i.from, i.to, i.id, i.ts, i.exp, i.prekey, i.kind, i.text]);
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
  return bytes.slice(4, 4 + n);
}

function deriveKey(dh: Uint8Array, ss: Uint8Array, prekeyId: string, eph: Uint8Array, kct: Uint8Array): Uint8Array {
  const ikm = new Uint8Array(dh.length + ss.length);
  ikm.set(dh, 0);
  ikm.set(ss, dh.length);
  const info = utf8Encode(`nido-carry-key-v1|${prekeyId}|${toHex(eph)}|${toHex(sha512(kct).slice(0, 32))}`);
  const k = hkdfSha512(utf8Encode("nido-carry-v1"), ikm, info, 32);
  ikm.fill(0);
  return k;
}

function isZero(b: Uint8Array): boolean {
  let o = 0;
  for (let i = 0; i < b.length; i++) o |= b[i];
  return o === 0;
}

export interface SealArgs {
  recipient: CarryPrekeyPublic;
  senderPkHex: string;
  senderSignSecretKey: Uint8Array;
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
  const ttl = Math.min(a.ttlMs ?? MAX_ENVELOPE_TTL_MS, MAX_ENVELOPE_TTL_MS, a.recipient.expiresAt - a.now);
  if (ttl <= 0) throw new Error("La clave de buzón del contacto ha caducado.");
  const inner: CarryInner = {
    v: CARRY_VERSION,
    from: a.senderPkHex.toLowerCase(),
    to: a.recipient.owner,
    id: a.id,
    ts: a.now,
    exp: a.now + ttl,
    prekey: a.recipient.id,
    kind: a.kind,
    text: a.text,
  };
  const sig = signDetached(utf8Encode(`nido-carry-msg-v${CARRY_VERSION}|${canonicalInner(inner)}`), a.senderSignSecretKey);
  const plain = pad(utf8Encode(JSON.stringify({ i: inner, s: toHex(sig) })));

  const eph = nacl.box.keyPair();
  const dh = nacl.scalarMult(eph.secretKey, fromHex(a.recipient.x25519));
  if (isZero(dh)) throw new Error("Clave de buzón inválida.");
  const { cipherText, sharedSecret } = kemEncapsulate(fromHex(a.recipient.kem));
  const key = deriveKey(dh, sharedSecret, a.recipient.id, eph.publicKey, cipherText);
  dh.fill(0);
  sharedSecret.fill(0);
  eph.secretKey.fill(0);
  const nonce = randomNonce(nacl.secretbox.nonceLength);
  const box = nacl.secretbox(plain, nonce, key);
  key.fill(0);
  return {
    t: "nido-carry",
    v: CARRY_VERSION,
    eid: toHex(randomNonce(16)),
    tag: carryTag(a.recipient.id),
    exp: inner.exp,
    hops: Math.max(1, Math.min(MAX_HOPS, a.hops ?? MAX_HOPS)),
    eph: toHex(eph.publicKey),
    kct: toHex(cipherText),
    nonce: toHex(nonce),
    box: toHex(box),
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
    const boxLen = q.box.length / 2;
    if (typeof q.box !== "string" || !/^[0-9a-f]+$/.test(q.box)) return false;
    return PAD_BUCKETS.some((b) => b + nacl.secretbox.overheadLength === boxLen);
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
  kind: CarryInner["kind"];
  text: string;
}

/**
 * Abre un sobre dirigido a mí. Devuelve null si no es para mí, si está
 * manipulado, caducado, o si el remitente no es un contacto mío con esa
 * firma. Nunca lanza.
 *
 * @param myPrekeys mis claves de buzón secretas vigentes (un sobre nunca dura más que su clave)
 * @param myPkHex mi identidad X25519
 * @param senderSigPk firma Ed25519 del contacto con esa identidad, o null si no es contacto
 */
export function openCarry(
  e: unknown,
  myPrekeys: readonly CarryPrekeySecret[],
  myPkHex: string,
  senderSigPk: (pkHex: string) => string | null,
  now: number,
): OpenedCarry | null {
  try {
    if (!isWellFormedEnvelope(e)) return null;
    const pk = myPrekeys.find((p) => carryTag(p.id) === e.tag);
    if (!pk) return null;
    const ephPk = fromHex(e.eph);
    const dh = nacl.scalarMult(pk.x25519Sk, ephPk);
    if (isZero(dh)) return null;
    const kct = fromHex(e.kct);
    const ss = kemDecapsulate(kct, pk.kemSk);
    const key = deriveKey(dh, ss, pk.id, ephPk, kct);
    dh.fill(0);
    ss.fill(0);
    const plain = nacl.secretbox.open(fromHex(e.box), fromHex(e.nonce), key);
    key.fill(0);
    if (!plain) return null;
    const body = unpad(plain);
    if (!body) return null;
    const parsed = JSON.parse(utf8Decode(body)) as { i: CarryInner; s: string };
    const i = parsed.i;
    if (!i || i.v !== CARRY_VERSION || i.to !== myPkHex.toLowerCase() || i.prekey !== pk.id) return null;
    if (i.kind !== "chat" && i.kind !== "receipt") return null;
    if (typeof i.text !== "string" || i.text.length > MAX_CARRY_TEXT || typeof i.id !== "string" || i.id.length > 64) return null;
    if (!Number.isSafeInteger(i.exp) || i.exp <= now || !Number.isSafeInteger(i.ts) || i.ts > now + 10 * 60 * 1000) return null;
    if (!HEX(64).test(i.from) || i.from === myPkHex.toLowerCase()) return null;
    const sigPk = senderSigPk(i.from);
    if (!sigPk || !HEX(128).test(parsed.s)) return null;
    if (!verifyDetached(utf8Encode(`nido-carry-msg-v${CARRY_VERSION}|${canonicalInner(i)}`), fromHex(parsed.s), fromHex(sigPk))) return null;
    return { from: i.from, id: i.id, ts: i.ts, kind: i.kind, text: i.text };
  } catch {
    return null;
  }
}
