/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * pq.ts — ML-KEM-768 (FIPS 203) para el protocolo v5.
 *
 * Envoltorio mínimo sobre @noble/post-quantum (JS puro, sin código nativo).
 * La aleatoriedad la pone NIDO (nacl.randomBytes, la misma fuente segura del
 * resto del P2P): nunca dependemos del generador interno de la librería, que
 * en Hermes no tiene WebCrypto.
 *
 * Tamaños: clave pública 1184 B, clave secreta 2400 B, cifrado 1088 B,
 * secreto compartido 32 B.
 */
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { randomNonce } from "./crypto";

export const KEM_PUBLIC_KEY_BYTES = 1184;
export const KEM_SECRET_KEY_BYTES = 2400;
export const KEM_CIPHERTEXT_BYTES = 1088;
export const KEM_SHARED_SECRET_BYTES = 32;

export interface KemKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/** Par ML-KEM-768 nuevo (semilla de 64 B de la fuente segura). */
export function kemKeygen(): KemKeyPair {
  const seed = randomNonce(64);
  try {
    const kp = ml_kem768.keygen(seed);
    return { publicKey: kp.publicKey, secretKey: kp.secretKey };
  } finally {
    seed.fill(0);
  }
}

/** Encapsula hacia `publicKey`: devuelve el cifrado y el secreto (32 B). */
export function kemEncapsulate(publicKey: Uint8Array): { cipherText: Uint8Array; sharedSecret: Uint8Array } {
  if (publicKey.length !== KEM_PUBLIC_KEY_BYTES) throw new Error("ML-KEM: clave pública inválida.");
  const m = randomNonce(32);
  try {
    const r = ml_kem768.encapsulate(publicKey, m);
    return { cipherText: r.cipherText, sharedSecret: r.sharedSecret };
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
  return ml_kem768.decapsulate(cipherText, secretKey);
}
