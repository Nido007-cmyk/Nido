/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * pq.ts — ML-KEM-768 (FIPS 203) para el protocolo v5.
 *
 * 0.1.51: en el teléfono se usa mlkem-native (C nativo, el de AWS-LC y
 * libOQS: memoria verificada con CBMC; en AArch64, ensamblador verificado
 * con HOL-Light, también de tiempo constante). @noble/post-quantum (JS puro,
 * sin auditoría independiente) queda solo como respaldo: en tests y si el
 * build no trae la parte nativa.
 *
 * Antes de usar la nativa, se comprueba UNA vez que da exactamente los mismos
 * bytes que la JS (clave, cifrado, secreto y rechazo implícito) con valores
 * fijos y con valores al azar. Si algo no coincide, se usa la JS: nunca se
 * rompe la compatibilidad con el otro teléfono.
 *
 * La aleatoriedad la pone NIDO (nacl.randomBytes, la misma fuente segura del
 * resto del P2P): nunca dependemos del generador interno de ninguna de las
 * dos librerías.
 *
 * Tamaños: clave pública 1184 B, clave secreta 2400 B, cifrado 1088 B,
 * secreto compartido 32 B.
 */
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { fromHex, randomNonce, toHex } from "./crypto";

export const KEM_PUBLIC_KEY_BYTES = 1184;
export const KEM_SECRET_KEY_BYTES = 2400;
export const KEM_CIPHERTEXT_BYTES = 1088;
export const KEM_SHARED_SECRET_BYTES = 32;

export interface KemKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/** Implementación de ML-KEM-768 con aleatoriedad externa. */
interface KemImpl {
  keygen(seed64: Uint8Array): KemKeyPair;
  encapsulate(publicKey: Uint8Array, m32: Uint8Array): { cipherText: Uint8Array; sharedSecret: Uint8Array };
  decapsulate(cipherText: Uint8Array, secretKey: Uint8Array): Uint8Array;
}

const jsImpl: KemImpl = {
  keygen: (seed) => {
    const kp = ml_kem768.keygen(seed);
    return { publicKey: kp.publicKey, secretKey: kp.secretKey };
  },
  encapsulate: (pk, m) => {
    const r = ml_kem768.encapsulate(pk, m);
    return { cipherText: r.cipherText, sharedSecret: r.sharedSecret };
  },
  decapsulate: (ct, sk) => ml_kem768.decapsulate(ct, sk),
};

interface NativeMlkem {
  keypair(coinsHex: string): string | null;
  encaps(pkHex: string, mHex: string): string | null;
  decaps(ctHex: string, skHex: string): string | null;
}

/** Envuelve el módulo nativo con la misma forma que la JS (lanza si falla). */
export function nativeKemImpl(n: NativeMlkem): KemImpl {
  const need = (h: string | null, bytes: number): Uint8Array => {
    if (typeof h !== "string" || h.length !== bytes * 2) throw new Error("ML-KEM nativo: respuesta inválida.");
    return fromHex(h);
  };
  return {
    keygen: (seed) => {
      const r = need(n.keypair(toHex(seed)), KEM_PUBLIC_KEY_BYTES + KEM_SECRET_KEY_BYTES);
      const kp = { publicKey: r.slice(0, KEM_PUBLIC_KEY_BYTES), secretKey: r.slice(KEM_PUBLIC_KEY_BYTES) };
      r.fill(0);
      return kp;
    },
    encapsulate: (pk, m) => {
      const r = need(n.encaps(toHex(pk), toHex(m)), KEM_CIPHERTEXT_BYTES + KEM_SHARED_SECRET_BYTES);
      const out = { cipherText: r.slice(0, KEM_CIPHERTEXT_BYTES), sharedSecret: r.slice(KEM_CIPHERTEXT_BYTES) };
      r.fill(0);
      return out;
    },
    decapsulate: (ct, sk) => need(n.decaps(toHex(ct), toHex(sk)), KEM_SHARED_SECRET_BYTES),
  };
}

const eq = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && toHex(a) === toHex(b);

/**
 * ¿`candidate` da exactamente los mismos bytes que la JS? Con una semilla fija
 * y otra al azar: clave pública y secreta, cifrado, secreto, desencapsulado y
 * el rechazo implícito de un cifrado alterado. Nunca lanza.
 */
export function kemImplMatchesReference(candidate: KemImpl): boolean {
  try {
    const fixedSeed = new Uint8Array(64).map((_, i) => (i * 7 + 1) & 0xff);
    const fixedM = new Uint8Array(32).map((_, i) => (i * 13 + 5) & 0xff);
    for (const [seed, m] of [
      [fixedSeed, fixedM],
      [randomNonce(64), randomNonce(32)],
    ] as const) {
      const a = candidate.keygen(seed);
      const b = jsImpl.keygen(seed);
      if (!eq(a.publicKey, b.publicKey) || !eq(a.secretKey, b.secretKey)) return false;
      const ea = candidate.encapsulate(b.publicKey, m);
      const eb = jsImpl.encapsulate(b.publicKey, m);
      if (!eq(ea.cipherText, eb.cipherText) || !eq(ea.sharedSecret, eb.sharedSecret)) return false;
      if (!eq(candidate.decapsulate(eb.cipherText, b.secretKey), eb.sharedSecret)) return false;
      const bad = eb.cipherText.slice();
      bad[0] ^= 1;
      if (!eq(candidate.decapsulate(bad, b.secretKey), jsImpl.decapsulate(bad, b.secretKey))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

let chosen: { impl: KemImpl; name: "mlkem-native" | "noble" } | null = null;

/** Solo tests: fuerza una implementación (null = volver a elegir). */
export function setKemImplForTests(impl: KemImpl | null, name: "mlkem-native" | "noble" = "noble"): void {
  chosen = impl ? { impl, name } : null;
}

function impl(): KemImpl {
  if (chosen) return chosen.impl;
  let picked: { impl: KemImpl; name: "mlkem-native" | "noble" } = { impl: jsImpl, name: "noble" };
  try {
    // require perezoso: en Node/tests el módulo nativo no existe.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require("nido-p2p") as { mlkemNative?: NativeMlkem | null };
    if (m?.mlkemNative) {
      const n = nativeKemImpl(m.mlkemNative);
      if (kemImplMatchesReference(n)) picked = { impl: n, name: "mlkem-native" };
    }
  } catch {
    /* sin módulo nativo: JS */
  }
  chosen = picked;
  return picked.impl;
}

/** Qué implementación de ML-KEM está en uso (para Ajustes/diagnóstico). */
export function kemBackend(): "mlkem-native" | "noble" {
  impl();
  return chosen!.name;
}

/** Par ML-KEM-768 nuevo (semilla de 64 B de la fuente segura). */
export function kemKeygen(): KemKeyPair {
  const seed = randomNonce(64);
  try {
    return impl().keygen(seed);
  } finally {
    seed.fill(0);
  }
}

/** Encapsula hacia `publicKey`: devuelve el cifrado y el secreto (32 B). */
export function kemEncapsulate(publicKey: Uint8Array): { cipherText: Uint8Array; sharedSecret: Uint8Array } {
  if (publicKey.length !== KEM_PUBLIC_KEY_BYTES) throw new Error("ML-KEM: clave pública inválida.");
  const m = randomNonce(32);
  try {
    return impl().encapsulate(publicKey, m);
  } finally {
    m.fill(0);
  }
}

/**
 * Desencapsula. ML-KEM nunca "falla": un cifrado alterado da un secreto
 * aleatorio distinto (rechazo implícito), y la autenticación del primer
 * mensaje v5 lo detecta.
 */
export function kemDecapsulate(cipherText: Uint8Array, secretKey: Uint8Array): Uint8Array {
  if (cipherText.length !== KEM_CIPHERTEXT_BYTES) throw new Error("ML-KEM: cifrado inválido.");
  if (secretKey.length !== KEM_SECRET_KEY_BYTES) throw new Error("ML-KEM: clave secreta inválida.");
  return impl().decapsulate(cipherText, secretKey);
}
