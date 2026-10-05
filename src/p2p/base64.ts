/**
 * base64.ts — NIDO: base64 sin dependencias.
 *
 * React Native/Hermes no trae `Buffer` de Node; este helper cubre el
 * encode/decode de Uint8Array <-> base64 que necesita el transporte P2P
 * (el módulo nativo habla en base64 por el puente JS).
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function encodeBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += ALPHABET[(n >>> 18) & 63] + ALPHABET[(n >>> 12) & 63];
    out += i + 1 < bytes.length ? ALPHABET[(n >>> 6) & 63] : "=";
    out += i + 2 < bytes.length ? ALPHABET[n & 63] : "=";
  }
  return out;
}

export function decodeBase64(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, "");
  if (clean.length % 4 !== 0) throw new Error("base64 inválido.");
  const table = new Map<string, number>();
  for (let i = 0; i < ALPHABET.length; i++) table.set(ALPHABET[i], i);
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = table.get(clean[i]) ?? 0;
    const c1 = table.get(clean[i + 1]) ?? 0;
    const c2 = clean[i + 2] === "=" ? 0 : (table.get(clean[i + 2]) ?? 0);
    const c3 = clean[i + 3] === "=" ? 0 : (table.get(clean[i + 3]) ?? 0);
    const n = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    out.push((n >>> 16) & 0xff);
    if (clean[i + 2] !== "=") out.push((n >>> 8) & 0xff);
    if (clean[i + 3] !== "=") out.push(n & 0xff);
  }
  return new Uint8Array(out);
}
