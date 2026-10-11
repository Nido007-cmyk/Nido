/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * utf8AndLimits.test.ts — regresiones de la auditoría 2026-10-10 (L1, L4).
 *
 * L1: el UTF-8 propio de crypto.ts debe comportarse EXACTAMENTE como el
 * estándar (WHATWG): utf8Decode = TextDecoder({fatal:true}),
 * utf8DecodeLossy = TextDecoder(), utf8Encode = TextEncoder. Se compara
 * contra la implementación de referencia con casos fijos y fuzzing.
 * L4: CONFIRM sobredimensionado se rechaza antes de parsear.
 */

import { describe, it, expect } from "vitest";
import { utf8Decode, utf8DecodeLossy, utf8Encode } from "./crypto";
import { buildConfirmV1, parseConfirm, MAX_HANDSHAKE_BODY_BYTES } from "./handshakeV3";

const strict = new TextDecoder("utf-8", { fatal: true });
const lossy = new TextDecoder("utf-8");
const enc = new TextEncoder();

function refStrict(b: Uint8Array): string | "THROWS" {
  try {
    return strict.decode(b);
  } catch {
    return "THROWS";
  }
}
function oursStrict(b: Uint8Array): string | "THROWS" {
  try {
    return utf8Decode(b);
  } catch {
    return "THROWS";
  }
}

/** PRNG determinista (xorshift32) para que el fuzzing sea reproducible. */
function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x;
  };
}

describe("L1: utf8Decode es estricto", () => {
  const invalid: Array<[string, number[]]> = [
    ["secuencia truncada de 3 bytes", [0xe2, 0x82]],
    ["sobrelarga de '/' (C0 AF)", [0xc0, 0xaf]],
    ["sobrelarga de 3 bytes (E0 80 AF)", [0xe0, 0x80, 0xaf]],
    ["continuación inválida (C3 28)", [0xc3, 0x28]],
    ["byte de inicio prohibido F8", [0xf8, 0x88, 0x80, 0x80, 0x80]],
    ["surrogate codificado (ED A0 80)", [0xed, 0xa0, 0x80]],
    ["> U+10FFFF (F4 90 80 80)", [0xf4, 0x90, 0x80, 0x80]],
    ["continuación suelta (80)", [0x80]],
  ];
  for (const [name, bytes] of invalid) {
    it(`rechaza: ${name}`, () => {
      expect(() => utf8Decode(Uint8Array.from(bytes))).toThrow();
      // Y la variante tolerante coincide con TextDecoder.
      expect(utf8DecodeLossy(Uint8Array.from(bytes))).toBe(lossy.decode(Uint8Array.from(bytes)));
    });
  }

  it("decodifica texto válido (ASCII, acentos, emoji, CJK)", () => {
    const s = "hola ñandú — 你好 🐦‍⬛ \u0000 fin";
    expect(utf8Decode(enc.encode(s))).toBe(s);
  });

  it("fuzzing: idéntico a TextDecoder (fatal y tolerante) en 20 000 entradas", () => {
    const next = rng(0xc0ffee);
    // Sesgo hacia bytes "interesantes" de UTF-8 para cubrir los bordes.
    const pool = [0x00, 0x2f, 0x7f, 0x80, 0x8f, 0x90, 0x9f, 0xa0, 0xbf, 0xc0, 0xc1, 0xc2, 0xdf, 0xe0, 0xed, 0xef, 0xf0, 0xf4, 0xf5, 0xff];
    for (let n = 0; n < 20_000; n++) {
      const len = next() % 12;
      const b = new Uint8Array(len);
      for (let i = 0; i < len; i++) b[i] = next() % 3 === 0 ? next() & 0xff : pool[next() % pool.length];
      expect(oursStrict(b)).toBe(refStrict(b));
      expect(utf8DecodeLossy(b)).toBe(lossy.decode(b));
    }
  });

  it("entradas grandes (> 8192 unidades) se decodifican completas", () => {
    const s = "añ🐦".repeat(5000);
    expect(utf8Decode(enc.encode(s))).toBe(s);
  });
});

describe("L1: utf8Encode coincide con TextEncoder", () => {
  it("surrogates sueltos → U+FFFD sin comerse el carácter siguiente", () => {
    for (const s of ["\ud800", "a\ud800b", "\udc00", "\ud800𐀀", "x\udbffy"]) {
      expect(Array.from(utf8Encode(s))).toEqual(Array.from(enc.encode(s)));
    }
  });

  it("fuzzing: idéntico a TextEncoder en 20 000 cadenas", () => {
    const next = rng(0xbeef);
    const pool = [0x41, 0x7f, 0x80, 0x7ff, 0x800, 0xd7ff, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xe000, 0xfffd, 0xffff];
    for (let n = 0; n < 20_000; n++) {
      const len = next() % 8;
      let s = "";
      for (let i = 0; i < len; i++) s += String.fromCharCode(next() % 2 ? pool[next() % pool.length] : next() & 0xffff);
      expect(Array.from(utf8Encode(s))).toEqual(Array.from(enc.encode(s)));
    }
  });

  it("cadenas bien formadas: salida igual que antes (no cambia firmas ni hashes)", () => {
    const s = JSON.stringify({ hex: "ab".repeat(32), t: "nido-hello-v3|ñ|🐦" });
    expect(Array.from(utf8Encode(s))).toEqual(Array.from(enc.encode(s)));
    expect(utf8Decode(utf8Encode(s))).toBe(s);
  });
});

describe("L4: CONFIRM sobredimensionado", () => {
  const PK = "a".repeat(64);
  const CN = "b".repeat(32);
  const PN = "c".repeat(32);
  const SIG = "d".repeat(128);

  it("un CONFIRM legítimo cabe holgadamente y sigue parseando", () => {
    const body = buildConfirmV1(PK, CN, PN, SIG);
    expect(body.length).toBeLessThan(MAX_HANDSHAKE_BODY_BYTES / 2);
    expect(parseConfirm(body)).toEqual({ pk: PK, cn: CN, pn: PN, sig: SIG });
  });

  it("> 1 KB se rechaza antes de JSON.parse", () => {
    const big = enc.encode(
      JSON.stringify({ t: "nido-confirm", v: 1, pk: PK, cn: CN, pn: PN, sig: SIG, pad: "x".repeat(2000) })
    );
    expect(() => parseConfirm(big)).toThrow("CONFIRM demasiado grande.");
  });
});
