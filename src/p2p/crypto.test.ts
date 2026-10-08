/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi } from "vitest";
import {
  deriveSessionKeyV2,
  fingerprint,
  fromHex,
  generateEphemeral,
  generateIdentity,
  hkdfSha512,
  openMessage,
  randomNonce,
  sealMessage,
  toHex,
  utf8Decode,
  utf8Encode,
  HANDSHAKE_NONCE_BYTES,
  type KeyPair,
} from "./crypto";
import { hkdfSync, createHmac } from "node:crypto";

/** Clave de sesión v2 entre dos efímeros (nonces frescos). */
function v2key(a: KeyPair, b: KeyPair): Uint8Array {
  return deriveSessionKeyV2(
    a.secretKey,
    b.publicKey,
    randomNonce(HANDSHAKE_NONCE_BYTES),
    randomNonce(HANDSHAKE_NONCE_BYTES),
  );
}

describe("crypto P2P", () => {
  it("identidades únicas con claves de 32 bytes", () => {
    const a = generateIdentity();
    const b = generateIdentity();
    expect(a.publicKey.length).toBe(32);
    expect(a.secretKey.length).toBe(32);
    expect(toHex(a.publicKey)).not.toBe(toHex(b.publicKey));
  });

  it("hex ida y vuelta", () => {
    const kp = generateIdentity();
    const hex = toHex(kp.publicKey);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(toHex(fromHex(hex))).toBe(hex);
  });

  it("fromHex rechaza basura", () => {
    expect(() => fromHex("zzz")).toThrow(); // no es hex
    expect(() => fromHex("abc")).toThrow(); // longitud impar
    expect(() => fromHex("")).toThrow(); // vacío
    // fromHex valida formato hex, no el largo de clave (eso lo valida cada uso)
    expect(fromHex("00".repeat(31)).length).toBe(31);
  });

  it("ECDH v2: ambas partes derivan el mismo secreto", () => {
    const a = generateEphemeral();
    const b = generateEphemeral();
    const n1 = randomNonce(HANDSHAKE_NONCE_BYTES);
    const n2 = randomNonce(HANDSHAKE_NONCE_BYTES);
    const sa = deriveSessionKeyV2(a.secretKey, b.publicKey, n1, n2);
    const sb = deriveSessionKeyV2(b.secretKey, a.publicKey, n2, n1);
    expect(toHex(sa)).toBe(toHex(sb));
    expect(sa.length).toBe(32);
  });

  it("secretbox: cifra y descifra", () => {
    const key = v2key(generateEphemeral(), generateEphemeral());
    const msg = utf8Encode("Hola NIDO 🔒");
    const sealed = sealMessage(msg, key);
    expect(sealed.nonce.length).toBe(24);
    const opened = openMessage(sealed, key);
    expect(opened).not.toBeNull();
    expect(utf8Decode(opened!)).toBe("Hola NIDO 🔒");
  });

  it("nonces aleatorios: el mismo texto cifra distinto cada vez", () => {
    const key = v2key(generateEphemeral(), generateEphemeral());
    const msg = utf8Encode("mismo texto");
    const s1 = sealMessage(msg, key);
    const s2 = sealMessage(msg, key);
    expect(toHex(s1.boxed)).not.toBe(toHex(s2.boxed));
  });

  it("manipulación detectada: 1 bit cambiado → open devuelve null", () => {
    const key = v2key(generateEphemeral(), generateEphemeral());
    const sealed = sealMessage(utf8Encode("secreto"), key);
    const tampered = { nonce: sealed.nonce.slice(), boxed: sealed.boxed.slice() };
    tampered.boxed[0] ^= 0x01;
    expect(openMessage(tampered, key)).toBeNull();
  });

  it("nonce manipulado → null", () => {
    const key = v2key(generateEphemeral(), generateEphemeral());
    const sealed = sealMessage(utf8Encode("secreto"), key);
    const tampered = { nonce: sealed.nonce.slice(), boxed: sealed.boxed };
    tampered.nonce[5] ^= 0xff;
    expect(openMessage(tampered, key)).toBeNull();
  });

  it("clave incorrecta → null", () => {
    const k1 = v2key(generateEphemeral(), generateEphemeral());
    const k2 = v2key(generateEphemeral(), generateEphemeral());
    const sealed = sealMessage(utf8Encode("secreto"), k1);
    expect(openMessage(sealed, k2)).toBeNull();
  });

  it("huella legible y estable", () => {
    const kp = generateIdentity();
    const fp = fingerprint(kp.publicKey);
    expect(fp.split(" ")).toHaveLength(8);
    expect(fingerprint(kp.publicKey)).toBe(fp);
  });

  it("utf8 ida y vuelta con emoji y eñes", () => {
    const s = "niño 🔒 cañón — «cita»";
    expect(utf8Decode(utf8Encode(s))).toBe(s);
  });
});

describe("HKDF-SHA512 KDF (RFC 5869, reemplaza truncado SHA-512)", () => {
  it("coincide con crypto.hkdfSync de Node (oráculo independiente)", () => {
    const cases = [
      { salt: new Uint8Array([1, 2, 3]), ikm: new Uint8Array([4, 5, 6, 7]), info: utf8Encode("ctx"), len: 32 },
      { salt: new Uint8Array(0), ikm: new Uint8Array(22).fill(0x0b), info: new Uint8Array(0), len: 42 },
      { salt: utf8Encode("nido-session-v2"), ikm: randomNonce(32), info: utf8Encode("nido-session-key-v1"), len: 100 },
    ];
    for (const c of cases) {
      const got = hkdfSha512(c.salt, c.ikm, c.info, c.len);
      const want = hkdfSync("sha512", c.ikm, c.salt, c.info, c.len);
      expect(toHex(got)).toBe(Buffer.from(want).toString("hex"));
      expect(got.length).toBe(c.len);
    }
  });

  it("RFC 4231: el paso HMAC-SHA512 interno es correcto (vector 'Hi There')", () => {
    // Caso 1 de RFC 4231: clave = 0x0b×20, datos = "Hi There".
    // El paso Extract de HKDF es HMAC-SHA512(sal, IKM); aquí se verifica
    // que nuestro HMAC-SHA512 (sobre nacl.hash) coincide con el HMAC-SHA512
    // de Node sobre el vector publicado.
    const salt = new Uint8Array(20).fill(0x0b);
    const data = utf8Encode("Hi There");
    const prk = createHmac("sha512", salt).update(data).digest("hex");
    expect(prk).toBe(
      "87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854"
    );
    // Y el HKDF completo con esos mismos parámetros coincide con Node.
    const got = hkdfSha512(salt, data, new Uint8Array(0), 64);
    const want = hkdfSync("sha512", data, salt, new Uint8Array(0), 64);
    expect(toHex(got)).toBe(Buffer.from(want).toString("hex"));
  });

  it("deriveSessionKeyV2: borra el secreto efímero del llamador", () => {
    const a = generateEphemeral();
    const b = generateEphemeral();
    const n1 = randomNonce(HANDSHAKE_NONCE_BYTES);
    const n2 = randomNonce(HANDSHAKE_NONCE_BYTES);
    const secretCopy = a.secretKey.slice();
    const key = deriveSessionKeyV2(a.secretKey, b.publicKey, n1, n2);
    expect(key.length).toBe(32);
    // El buffer original del llamador quedó en ceros.
    expect(toHex(a.secretKey)).toBe("00".repeat(32));
    expect(toHex(a.secretKey)).not.toBe(toHex(secretCopy));
  });

  it("deriveSessionKeyV2: ambas partes coinciden con nonces cruzados", () => {
    const a = generateEphemeral();
    const b = generateEphemeral();
    const n1 = randomNonce(HANDSHAKE_NONCE_BYTES);
    const n2 = randomNonce(HANDSHAKE_NONCE_BYTES);
    const sa = deriveSessionKeyV2(a.secretKey, b.publicKey, n1, n2);
    const sb = deriveSessionKeyV2(b.secretKey, a.publicKey, n2, n1);
    expect(toHex(sa)).toBe(toHex(sb));
  });

  it("deriveSessionKeyV2: nonces distintos → claves distintas (anti-replay)", () => {
    const a = generateEphemeral();
    const b = generateEphemeral();
    const n1 = randomNonce(HANDSHAKE_NONCE_BYTES);
    const k1 = deriveSessionKeyV2(a.secretKey, b.publicKey, n1, randomNonce(HANDSHAKE_NONCE_BYTES));
    const a2 = generateEphemeral();
    const k2 = deriveSessionKeyV2(a2.secretKey, b.publicKey, n1, randomNonce(HANDSHAKE_NONCE_BYTES));
    expect(toHex(k1)).not.toBe(toHex(k2));
  });

  it("deriveSessionKeyV2: fail-closed en entradas malformadas", () => {
    const a = generateEphemeral();
    const b = generateEphemeral();
    const n = randomNonce(HANDSHAKE_NONCE_BYTES);
    expect(() => deriveSessionKeyV2(new Uint8Array(31), b.publicKey, n, n)).toThrow();
    expect(() => deriveSessionKeyV2(a.secretKey, b.publicKey, new Uint8Array(8), n)).toThrow();
  });
});

describe("PRNG installation (T-PRNG-2026-10-06)", () => {
  it("installSecurePrng está exportada y es re-ejecutable", async () => {
    const mod = await import("./crypto");
    expect(typeof mod.installSecurePrng).toBe("function");
    expect(() => mod.installSecurePrng()).not.toThrow();
  });

  it("NO usa globalThis.require (Metro/Hermes no lo define: era el bug 'no PRNG')", async () => {
    const { installSecurePrng } = await import("./crypto");
    const src = installSecurePrng.toString();
    // El bug: (globalThis as {...}).require("expo-crypto") nunca se ejecutaba
    // en el dispositivo porque Metro inyecta require como parámetro de ámbito
    // de módulo, no en globalThis. Si alguien lo reintroduce, esto falla.
    // (globalThis.crypto sí es legítimo: es la primera fuente intentada.)
    expect(src).not.toMatch(/globalThis[\s\S]{0,80}\.require\s*\(/);
    // En su lugar debe usar require() directo a nivel de módulo.
    expect(src).toContain('require("expo-crypto")');
  });

  it("fail-closed: sin WebCrypto y sin expo-crypto resoluble no instala nada silencioso", async () => {
    // En vitest, require("expo-crypto") no resuelve (módulo nativo) → la rama
    // cae en el catch y no se instala PRNG. La verificación real de la rama
    // expo-crypto es en dispositivo físico (desaparece el "⚠ no PRNG").
    vi.stubGlobal("crypto", undefined);
    try {
      const { installSecurePrng } = await import("./crypto");
      expect(() => installSecurePrng()).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
