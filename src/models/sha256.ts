/**
 * sha256.ts — minimal incremental SHA-256 (FIPS 180-4), pure TypeScript,
 * zero dependencies.
 *
 * Why not expo-crypto: Crypto.digest() is one-shot — hashing a multi-GB
 * model file through it means holding the entire file in the JS heap at
 * once (as a base64 string PLUS the decoded bytes, ~2.3x the file size),
 * which OOMs on real devices. This incremental implementation lets
 * ModelManager.verifyChecksum() stream the file in ~1 MiB chunks with
 * O(chunk) peak memory instead, reporting progress and honoring
 * cancellation.
 *
 * Correctness is pinned by sha256.test.ts against the NIST FIPS 180-4
 * vectors ("", "abc", 1_000_000 x "a") plus incremental-update
 * equivalence checks (split inputs must hash identically to one-shot).
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const H_INIT = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

export interface IncrementalSha256 {
  update(data: Uint8Array): void;
  /** Final 32-byte digest. May only be called once — the hasher is consumed. */
  digest(): Uint8Array;
}

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

export function createSha256(): IncrementalSha256 {
  const h = new Uint32Array(H_INIT);
  const w = new Uint32Array(64);
  const block = new Uint8Array(64);
  let blockLen = 0;
  let totalLen = 0; // bytes fed so far (not counting padding)
  let finalized = false;

  function compress(): void {
    for (let i = 0; i < 16; i++) {
      w[i] =
        (block[i * 4] << 24) | (block[i * 4 + 1] << 16) | (block[i * 4 + 2] << 8) | block[i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0;
    h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  }

  return {
    update(data: Uint8Array): void {
      if (finalized) throw new Error("sha256: update() called after digest()");
      totalLen += data.length;
      let off = 0;
      while (off < data.length) {
        const take = Math.min(64 - blockLen, data.length - off);
        block.set(data.subarray(off, off + take), blockLen);
        blockLen += take;
        off += take;
        if (blockLen === 64) {
          compress();
          blockLen = 0;
        }
      }
    },
    digest(): Uint8Array {
      if (finalized) throw new Error("sha256: digest() called twice");
      finalized = true;
      // NIST padding: 0x80, zeros, then 64-bit big-endian bit length.
      const bitLenHi = Math.floor(totalLen / 0x20000000);
      const bitLenLo = (totalLen << 3) >>> 0;
      const padLen = blockLen < 56 ? 56 - blockLen : 120 - blockLen;
      const pad = new Uint8Array(padLen + 8);
      pad[0] = 0x80;
      const dv = new DataView(pad.buffer);
      dv.setUint32(padLen, bitLenHi);
      dv.setUint32(padLen + 4, bitLenLo);
      // Feed padding through update() without tripping the finalized guard.
      finalized = false;
      this.update(pad);
      finalized = true;
      const out = new Uint8Array(32);
      const odv = new DataView(out.buffer);
      for (let i = 0; i < 8; i++) odv.setUint32(i * 4, h[i]);
      return out;
    },
  };
}

/** One-shot SHA-256, returned as lowercase hex. */
export function sha256Hex(data: Uint8Array): string {
  const hasher = createSha256();
  hasher.update(data);
  return Array.from(hasher.digest(), (b) => b.toString(16).padStart(2, "0")).join("");
}
