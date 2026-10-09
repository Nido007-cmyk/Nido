/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * BENCHMARK CANDIDATE ONLY — NOT REVIEWED, NOT APPROVED FOR PRODUCTION.
 * This measurement does not constitute L3 authorization.
 *
 * pbkdf2.ts — candidate PBKDF2-HMAC-SHA256 for the NMB-1 physical cost gate
 * (PBKDF2-600k on the Tab A9+, release/Hermes).
 *
 * What this is: a measurement instrument. It implements the exact
 * kdf_id 0x0001 parameter set from the NMB-1 draft (PBKDF2-HMAC-SHA256,
 * 600,000 iterations, 32-byte salt, 32-byte output) on top of the repo's
 * existing NIST-pinned SHA-256 primitive (src/models/sha256.ts) — no new
 * crypto primitives, no new dependencies.
 *
 * What this is NOT: reviewed production crypto. If L3 is ever authorized,
 * it re-implements from the frozen spec under full review. Do NOT import
 * this module from production code — the quarantine tripwire test
 * (src/eval/pbkdf2Quarantine.test.ts) fails the suite if you do.
 */

import { createSha256 } from "../../../src/models/sha256";

/** NMB-1 draft kdf_id 0x0001 parameters — the exact set under measurement. */
export const PBKDF2_BENCH_ITERATIONS = 600_000;
export const PBKDF2_BENCH_SALT_LEN = 32;
export const PBKDF2_BENCH_DK_LEN = 32;
export const PBKDF2_BENCH_KDF_ID = "0x0001";

/** How often the chunked variant yields to the event loop. */
export const PBKDF2_BENCH_CHUNK_ITERATIONS = 4096;

const SHA256_LEN = 32;
const SHA256_BLOCK = 64;

/**
 * HMAC-SHA256 per RFC 2104, built on the repo's incremental SHA-256.
 * Keys longer than the block size are hashed first, per spec.
 */
export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  let k = key;
  if (k.length > SHA256_BLOCK) {
    const h = createSha256();
    h.update(k);
    k = h.digest();
  }
  const kPad = new Uint8Array(SHA256_BLOCK);
  kPad.set(k);
  const iPad = new Uint8Array(SHA256_BLOCK);
  const oPad = new Uint8Array(SHA256_BLOCK);
  for (let i = 0; i < SHA256_BLOCK; i++) {
    iPad[i] = kPad[i] ^ 0x36;
    oPad[i] = kPad[i] ^ 0x5c;
  }
  const inner = createSha256();
  inner.update(iPad);
  inner.update(message);
  const innerDigest = inner.digest();
  const outer = createSha256();
  outer.update(oPad);
  outer.update(innerDigest);
  return outer.digest();
}

function checkArgs(iterations: number, dkLen: number): void {
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error(`pbkdf2: iterations must be a positive integer (got ${iterations})`);
  }
  if (!Number.isInteger(dkLen) || dkLen < 1 || dkLen > 0xffffffff * SHA256_LEN) {
    throw new Error(`pbkdf2: dkLen out of range (got ${dkLen})`);
  }
}

/**
 * PBKDF2-HMAC-SHA256 per RFC 8018 §5.2. Fully synchronous — this is the
 * worst-case UI-jank variant the benchmark measures (unchunked).
 */
export function pbkdf2Sha256(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  dkLen: number
): Uint8Array {
  checkArgs(iterations, dkLen);
  const blocks = Math.ceil(dkLen / SHA256_LEN);
  const out = new Uint8Array(dkLen);
  const saltBlock = new Uint8Array(salt.length + 4);
  saltBlock.set(salt);
  const dv = new DataView(saltBlock.buffer, saltBlock.byteOffset, saltBlock.byteLength);
  for (let b = 1; b <= blocks; b++) {
    dv.setUint32(salt.length, b); // INT(b), 4-octet big-endian
    let u = hmacSha256(password, saltBlock);
    const t = new Uint8Array(u); // copy: u is reassigned below
    for (let i = 1; i < iterations; i++) {
      u = hmacSha256(password, u);
      for (let j = 0; j < SHA256_LEN; j++) t[j] ^= u[j];
    }
    out.set(t.subarray(0, Math.min(SHA256_LEN, dkLen - (b - 1) * SHA256_LEN)), (b - 1) * SHA256_LEN);
  }
  return out;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    const g = globalThis as unknown as {
      setImmediate?: (cb: () => void) => void;
    };
    if (typeof g.setImmediate === "function") g.setImmediate(resolve);
    else setTimeout(resolve, 0);
  });
}

/**
 * Same KDF, but yields to the event loop every `chunkIterations` iterations
 * so the UI thread stays responsive (the ANR-safe variant under measurement).
 * `onChunk(done, total)` fires after each chunk — the benchmark task uses it
 * for progress reporting.
 */
export async function pbkdf2Sha256Chunked(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  dkLen: number,
  chunkIterations: number = PBKDF2_BENCH_CHUNK_ITERATIONS,
  onChunk?: (done: number, total: number) => void
): Promise<Uint8Array> {
  checkArgs(iterations, dkLen);
  if (!Number.isInteger(chunkIterations) || chunkIterations < 1) {
    throw new Error(`pbkdf2: chunkIterations must be a positive integer (got ${chunkIterations})`);
  }
  const blocks = Math.ceil(dkLen / SHA256_LEN);
  const out = new Uint8Array(dkLen);
  const saltBlock = new Uint8Array(salt.length + 4);
  saltBlock.set(salt);
  const dv = new DataView(saltBlock.buffer, saltBlock.byteOffset, saltBlock.byteLength);
  for (let b = 1; b <= blocks; b++) {
    dv.setUint32(salt.length, b);
    let u = hmacSha256(password, saltBlock);
    const t = new Uint8Array(u);
    let done = 1;
    while (done < iterations) {
      const n = Math.min(chunkIterations, iterations - done);
      for (let i = 0; i < n; i++) {
        u = hmacSha256(password, u);
        for (let j = 0; j < SHA256_LEN; j++) t[j] ^= u[j];
      }
      done += n;
      onChunk?.(done, iterations);
      await yieldToEventLoop();
    }
    out.set(t.subarray(0, Math.min(SHA256_LEN, dkLen - (b - 1) * SHA256_LEN)), (b - 1) * SHA256_LEN);
  }
  return out;
}
