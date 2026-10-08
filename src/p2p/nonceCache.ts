/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * nonceCache.ts — NIDO P2P: backend de la cache anti-replay de nonces de
 * HELLO (R4), inyectable para tests.
 *
 * El backend por defecto es persistente (SQLCipher, `hello_nonce_cache`
 * en `nido_memory.db` — sobrevive a reinicios, que es lo que mata el PoC
 * post-restart). Los tests inyectan un backend en memoria con la misma
 * semántica atómica.
 */

import { claimHelloNonce, pruneHelloNonceCache } from "./store";

/** Contrato de la cache anti-replay. */
export interface HelloNonceCache {
  /**
   * Reclama el par (pk, nonce) de forma ATÓMICA.
   * Devuelve true si el nonce es nuevo (reclamado), false si ya estaba
   * (replay -> el llamante debe rechazar fail-closed). Un fallo real de la
   * base se propaga como throw (fail-closed: el handshake se rechaza sin
   * enviar CONFIRM).
   */
  claim(pkLower: string, nonceHex: string, seenAtSec: number): Promise<boolean>;
  /** Poda oportunista de filas más viejas que `olderThanSec` (best-effort). */
  prune(olderThanSec: number): Promise<void>;
}

/** Backend persistente por defecto (SQLCipher vía store.ts). */
export const defaultHelloNonceCache: HelloNonceCache = {
  claim: (pkLower, nonceHex, seenAtSec) => claimHelloNonce(pkLower, nonceHex, seenAtSec),
  prune: (olderThanSec) => pruneHelloNonceCache(olderThanSec),
};

/** Backend en memoria con semántica atómica (para tests). */
export function makeMemoryHelloNonceCache(): HelloNonceCache & { size(): number; clear(): void } {
  const seen = new Map<string, number>();
  return {
    async claim(pkLower: string, nonceHex: string, seenAtSec: number): Promise<boolean> {
      const key = `${pkLower.toLowerCase()}:${nonceHex.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.set(key, Math.floor(seenAtSec));
      return true;
    },
    async prune(olderThanSec: number): Promise<void> {
      for (const [k, ts] of seen) {
        if (ts < olderThanSec) seen.delete(k);
      }
    },
    size: () => seen.size,
    clear: () => seen.clear(),
  };
}
