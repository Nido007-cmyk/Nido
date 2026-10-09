/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * BENCHMARK CANDIDATE ONLY — NOT REVIEWED, NOT APPROVED FOR PRODUCTION.
 *
 * Correctness tests for the PBKDF2-HMAC-SHA256 candidate. PBKDF2-HMAC-SHA256
 * vectors cross-checked against Python's hashlib.pbkdf2_hmac (independent
 * implementation) on 2026-09-28; HMAC vector is RFC 4231 §4.2 test case 1.
 * Timing is device-only and is NOT asserted here — only correctness.
 */
import { describe, it, expect } from "vitest";
import { pbkdf2Sync } from "node:crypto";
import {
  hmacSha256,
  pbkdf2Sha256,
  pbkdf2Sha256Chunked,
  PBKDF2_BENCH_ITERATIONS,
  PBKDF2_BENCH_SALT_LEN,
  PBKDF2_BENCH_DK_LEN,
} from "./pbkdf2";

const enc = new TextEncoder();
const hex = (b: Uint8Array) =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

describe("pbkdf2 candidate — RFC 6070-style PBKDF2-HMAC-SHA256 vectors", () => {
  const vectors: Array<{
    name: string;
    password: string;
    salt: string;
    iterations: number;
    dkLen: number;
    expected: string;
  }> = [
    {
      name: "c=1",
      password: "password",
      salt: "salt",
      iterations: 1,
      dkLen: 32,
      expected:
        "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b",
    },
    {
      name: "c=2",
      password: "password",
      salt: "salt",
      iterations: 2,
      dkLen: 32,
      expected:
        "ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43",
    },
    {
      name: "c=4096",
      password: "password",
      salt: "salt",
      iterations: 4096,
      dkLen: 32,
      expected:
        "c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a",
    },
    {
      name: "c=4096, long password/salt, dkLen=40 (multi-block)",
      password: "passwordPASSWORDpassword",
      salt: "saltSALTsaltSALTsaltSALTsaltSALTsalt",
      iterations: 4096,
      dkLen: 40,
      expected:
        "348c89dbcbd32b2f32d814b8116e84cf2b17347ebc1800181c4e2a1fb8dd53e1c635518c7dac47e9",
    },
  ];

  for (const v of vectors) {
    it(`sync: ${v.name}`, () => {
      const out = pbkdf2Sha256(enc.encode(v.password), enc.encode(v.salt), v.iterations, v.dkLen);
      expect(out.length).toBe(v.dkLen);
      expect(hex(out)).toBe(v.expected);
    });
    it(`chunked matches sync: ${v.name}`, async () => {
      const out = await pbkdf2Sha256Chunked(
        enc.encode(v.password),
        enc.encode(v.salt),
        v.iterations,
        v.dkLen,
        7 // tiny chunk size to exercise the chunking path
      );
      expect(hex(out)).toBe(v.expected);
    });
  }

  it("matches node:crypto pbkdf2Sync (independent implementation)", () => {
    const pw = enc.encode("nido-cross-check");
    const salt = enc.encode("cross-check-salt");
    const expected = pbkdf2Sync(pw, salt, 1000, 32, "sha256");
    expect(hex(pbkdf2Sha256(pw, salt, 1000, 32))).toBe(expected.toString("hex"));
  });
});

describe("pbkdf2 candidate — HMAC-SHA256 (RFC 4231 case 1)", () => {
  it("key=0x0b*20, data='Hi There'", () => {
    const out = hmacSha256(new Uint8Array(20).fill(0x0b), enc.encode("Hi There"));
    expect(hex(out)).toBe("b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7");
  });

  it("hashes over-long keys before use", () => {
    const longKey = new Uint8Array(100).fill(0xaa);
    const a = hmacSha256(longKey, enc.encode("data"));
    // RFC 2104: key' = H(key) when len(key) > blocksize — must differ from truncation.
    const truncated = hmacSha256(longKey.subarray(0, 64), enc.encode("data"));
    expect(hex(a)).not.toBe(hex(truncated));
    expect(a.length).toBe(32);
  });
});

describe("pbkdf2 candidate — parameter contract", () => {
  it("exposes the NMB-1 kdf_id 0x0001 parameter set", () => {
    expect(PBKDF2_BENCH_ITERATIONS).toBe(600_000);
    expect(PBKDF2_BENCH_SALT_LEN).toBe(32);
    expect(PBKDF2_BENCH_DK_LEN).toBe(32);
  });

  it("rejects non-positive iterations / dkLen", () => {
    const pw = enc.encode("p");
    const salt = enc.encode("s");
    expect(() => pbkdf2Sha256(pw, salt, 0, 32)).toThrow();
    expect(() => pbkdf2Sha256(pw, salt, 1, 0)).toThrow();
  });

  it("chunked honors small chunk sizes and reports progress", async () => {
    const seen: number[] = [];
    await pbkdf2Sha256Chunked(enc.encode("p"), enc.encode("s"), 10, 32, 3, (done, total) => {
      seen.push(done);
      expect(total).toBe(10);
    });
    expect(seen[seen.length - 1]).toBe(10);
    expect(new Set(seen).size).toBe(seen.length); // strictly increasing
  });
});
