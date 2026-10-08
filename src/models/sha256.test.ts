/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { createSha256, sha256Hex } from "./sha256";

// NIST FIPS 180-4 test vectors + cross-checks against node's crypto.
describe("sha256 (pure-TS incremental)", () => {
  it('hashes "" to the NIST empty-string digest', () => {
    expect(sha256Hex(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });

  it('hashes "abc" to the NIST digest', () => {
    const abc = new Uint8Array([97, 98, 99]);
    expect(sha256Hex(abc)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it('hashes 1,000,000 x "a" (multi-block vector, cross-verified with node/python/sha256sum)', () => {
    const million = new Uint8Array(1_000_000).fill(97);
    expect(sha256Hex(million)).toBe(
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
    );
  });

  it("incremental updates hash identically to one-shot (byte-at-a-time)", () => {
    const data = new Uint8Array([0, 1, 2, 250, 255, 72, 101, 108, 108, 111]);
    const inc = createSha256();
    for (const byte of data) inc.update(new Uint8Array([byte]));
    const hex = Array.from(inc.digest(), (b) => b.toString(16).padStart(2, "0")).join("");
    expect(hex).toBe(sha256Hex(data));
    expect(hex).toBe(createHash("sha256").update(data).digest("hex"));
  });

  it("incremental updates hash identically across odd chunk boundaries", () => {
    // 3 MiB of pseudorandom-ish bytes, fed in prime-sized chunks to hit
    // every block/padding alignment, vs node's one-shot digest.
    const data = new Uint8Array(3 * 1024 * 1024);
    for (let i = 0; i < data.length; i++) data[i] = (i * 31 + 7) & 0xff;
    const inc = createSha256();
    for (let off = 0; off < data.length; off += 7919) {
      inc.update(data.subarray(off, Math.min(off + 7919, data.length)));
    }
    const hex = Array.from(inc.digest(), (b) => b.toString(16).padStart(2, "0")).join("");
    expect(hex).toBe(createHash("sha256").update(data).digest("hex"));
  });

  it("digest() returns 32 bytes and cannot be called twice", () => {
    const h = createSha256();
    h.update(new Uint8Array([1, 2, 3]));
    expect(h.digest()).toHaveLength(32);
    expect(() => h.digest()).toThrow();
  });

  it("update() after digest() throws", () => {
    const h = createSha256();
    h.digest();
    expect(() => h.update(new Uint8Array([1]))).toThrow();
  });
});
