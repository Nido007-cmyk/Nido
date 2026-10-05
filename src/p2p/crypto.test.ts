import { describe, it, expect } from "vitest";
import {
  deriveSessionKeyV2,
  fingerprint,
  fromHex,
  generateEphemeral,
  generateIdentity,
  openMessage,
  randomNonce,
  sealMessage,
  toHex,
  utf8Decode,
  utf8Encode,
  HANDSHAKE_NONCE_BYTES,
  type KeyPair,
} from "./crypto";

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
