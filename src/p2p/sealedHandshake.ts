/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * sealedHandshake.ts — P2P v4: saludo sellado (identidad oculta).
 *
 * Problema (v3): el HELLO y el CONFIRM viajan en claro y llevan la clave
 * pública permanente del remitente. Quien grabe el tráfico Bluetooth o Wi-Fi
 * cerca puede reconocer el mismo teléfono de una conexión a otra.
 *
 * Solución (inspirada en las etiquetas por contacto de Briar/BTP): cada
 * pareja de contactos comparte una clave estática que nadie más conoce,
 *
 *   S        = X25519(mi_identidad_sk, su_identidad_pk)
 *   K_pareja = HKDF-SHA512(salt="nido-v4-pair", S, info="nido-v4|pk_min|pk_max", 32)
 *
 * y cada frame del saludo (HELLO y CONFIRM v3, sin cambios dentro) se sella:
 *
 *   r      = 16 bytes aleatorios por frame (en claro)
 *   tag    = HKDF(salt=r, K_pareja, info="nido-v4-tag|<tipo>", 16)
 *   k_enc  = HKDF(salt=r, K_pareja, info="nido-v4-enc|<tipo>", 32)
 *   cuerpo = secretbox(HELLO/CONFIRM v3, nonce aleatorio, k_enc)
 *
 * En el cable solo hay bytes aleatorios: {t:"nido-s4", r, g:tag, n, b}.
 * Quien recibe prueba la etiqueta contra cada contacto (sin descifrar nada
 * con quien no coincide) y solo entonces abre el cuerpo. Consecuencias:
 *   - Un observador pasivo no ve ninguna identidad ni puede enlazar
 *     conexiones (r, tag y nonce cambian en cada frame).
 *   - Un desconocido que llame no obtiene nada: no tiene K_pareja.
 *   - Un HELLO sellado para B solo lo puede abrir B: reenviarlo a otro
 *     contacto no sirve (cierra el «reenvío de HELLO» del v3).
 *   - La firma Ed25519, la frescura y el anti-replay del v3 siguen intactos
 *     dentro del sobre: el v4 añade privacidad, no sustituye autenticación.
 *
 * Límites conocidos: el tipo de frame "nido-s4" y su tamaño delatan que es
 * NIDO; un contacto comprometido (con K_pareja) puede reconocer al otro.
 *
 * Módulo puro: sin red ni almacenamiento.
 */
import nacl from "tweetnacl";
import { fromHex, hkdfSha512, toHex, utf8Encode } from "./crypto";
import { decodeBase64, encodeBase64 } from "./base64";

export const SEALED_TYPE = "nido-s4";
export type SealedKind = "hello" | "confirm";

const R_BYTES = 16;
const TAG_BYTES = 16;
/** Tope del frame sellado (JSON). Un HELLO v3 sellado ocupa ~700 B. */
export const MAX_SEALED_FRAME_BYTES = 2048;
/** Tope del contenido descifrado (igual que el handshake v3). */
const MAX_INNER_BYTES = 1024;

/** Comparación de longitud fija sin salida temprana. */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

/**
 * Clave estática de la pareja. Ambos lados obtienen la misma (orden
 * canónico de las pk en `info`). Lanza ante un secreto DH nulo (clave del
 * contacto de orden bajo), igual que la sesión v3.
 */
export function derivePairKey(
  mySecretKey: Uint8Array,
  myPkHex: string,
  theirPkHex: string,
): Uint8Array {
  const theirPk = fromHex(theirPkHex);
  if (mySecretKey.length !== 32 || theirPk.length !== 32) throw new Error("Claves inválidas.");
  const raw = nacl.scalarMult(mySecretKey, theirPk);
  let or = 0;
  for (let i = 0; i < raw.length; i++) or |= raw[i];
  if (or === 0) {
    raw.fill(0);
    throw new Error("Clave del contacto inválida (secreto compartido nulo).");
  }
  const a = myPkHex.toLowerCase();
  const b = theirPkHex.toLowerCase();
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const key = hkdfSha512(utf8Encode("nido-v4-pair"), raw, utf8Encode(`nido-v4|${lo}|${hi}`), 32);
  raw.fill(0);
  return key;
}

function tagFor(pairKey: Uint8Array, r: Uint8Array, kind: SealedKind): Uint8Array {
  return hkdfSha512(r, pairKey, utf8Encode(`nido-v4-tag|${kind}`), TAG_BYTES);
}

function encKeyFor(pairKey: Uint8Array, r: Uint8Array, kind: SealedKind): Uint8Array {
  return hkdfSha512(r, pairKey, utf8Encode(`nido-v4-enc|${kind}`), 32);
}

/** Sella un frame del saludo v3 (HELLO o CONFIRM) para un contacto. */
export function sealHandshakeFrame(
  pairKey: Uint8Array,
  kind: SealedKind,
  inner: Uint8Array,
): Uint8Array {
  if (inner.length === 0 || inner.length > MAX_INNER_BYTES) throw new Error("Saludo de tamaño inválido.");
  const r = nacl.randomBytes(R_BYTES);
  const tag = tagFor(pairKey, r, kind);
  const k = encKeyFor(pairKey, r, kind);
  const n = nacl.randomBytes(nacl.secretbox.nonceLength);
  const boxed = nacl.secretbox(inner, n, k);
  k.fill(0);
  return new TextEncoder().encode(
    JSON.stringify({ t: SEALED_TYPE, r: toHex(r), g: toHex(tag), n: toHex(n), b: encodeBase64(boxed) }),
  );
}

export interface ParsedSealed {
  r: Uint8Array;
  g: Uint8Array;
  n: Uint8Array;
  b: Uint8Array;
}

/** ¿El frame es un saludo sellado? Barato: no descifra nada. */
export function isSealedFrame(body: Uint8Array): boolean {
  if (body.length === 0 || body.length > MAX_SEALED_FRAME_BYTES) return false;
  // `{"t":"nido-s4"` al principio: evita parsear JSON de cualquier frame.
  const head = new TextDecoder().decode(body.subarray(0, 24));
  return head.startsWith(`{"t":"${SEALED_TYPE}"`);
}

/** Parse estricto. Lanza si el formato no es exactamente el esperado. */
export function parseSealed(body: Uint8Array): ParsedSealed {
  if (body.length > MAX_SEALED_FRAME_BYTES) throw new Error("Saludo sellado demasiado grande.");
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
  } catch {
    throw new Error("Saludo sellado ilegible.");
  }
  if (o.t !== SEALED_TYPE) throw new Error("No es un saludo sellado.");
  const hex = (v: unknown, bytes: number): Uint8Array => {
    if (typeof v !== "string" || !new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(v)) {
      throw new Error("Saludo sellado con campos inválidos.");
    }
    return fromHex(v);
  };
  if (typeof o.b !== "string" || o.b.length === 0 || o.b.length > MAX_SEALED_FRAME_BYTES) {
    throw new Error("Saludo sellado sin cuerpo.");
  }
  let b: Uint8Array;
  try {
    b = decodeBase64(o.b);
  } catch {
    throw new Error("Saludo sellado con cuerpo inválido.");
  }
  return { r: hex(o.r, R_BYTES), g: hex(o.g, TAG_BYTES), n: hex(o.n, nacl.secretbox.nonceLength), b };
}

/**
 * Abre un saludo sellado con UNA clave de pareja ya conocida (el iniciador,
 * o el respondedor tras identificar al contacto). null si no es para esta
 * pareja, si el tipo no coincide o si fue manipulado.
 */
export function openWithPairKey(
  sealed: ParsedSealed,
  pairKey: Uint8Array,
  kind: SealedKind,
): Uint8Array | null {
  const tag = tagFor(pairKey, sealed.r, kind);
  const match = equalBytes(tag, sealed.g);
  tag.fill(0);
  if (!match) return null;
  const k = encKeyFor(pairKey, sealed.r, kind);
  const opened = nacl.secretbox.open(sealed.b, sealed.n, k);
  k.fill(0);
  if (!opened || opened.length === 0 || opened.length > MAX_INNER_BYTES) return null;
  return opened;
}

/**
 * Respondedor: identifica al contacto probando la etiqueta contra cada
 * clave de pareja. Recorre SIEMPRE todas las candidatas (sin salida
 * temprana) para no filtrar por tiempo en qué posición está el contacto.
 */
export function openFromAnyContact<T extends { pairKey: Uint8Array }>(
  sealed: ParsedSealed,
  candidates: readonly T[],
  kind: SealedKind,
): { contact: T; inner: Uint8Array } | null {
  let found: T | null = null;
  for (const c of candidates) {
    const tag = tagFor(c.pairKey, sealed.r, kind);
    if (equalBytes(tag, sealed.g) && found === null) found = c;
    tag.fill(0);
  }
  if (!found) return null;
  const inner = openWithPairKey(sealed, found.pairKey, kind);
  return inner ? { contact: found, inner } : null;
}
