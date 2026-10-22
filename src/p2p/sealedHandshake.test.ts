/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
import { describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import { toHex } from "./crypto";
import {
  derivePairKey,
  isSealedFrame,
  MAX_SEALED_FRAME_BYTES,
  openFromAnyContact,
  openWithPairKey,
  parseSealed,
  sealHandshakeFrame,
} from "./sealedHandshake";

function party() {
  const kp = nacl.box.keyPair();
  return { kp, pkHex: toHex(kp.publicKey) };
}

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const HELLO = enc(
  JSON.stringify({ t: "nido-hello", v: 3, pk: "ab".repeat(32), eph: "cd".repeat(32), nonce: "ef".repeat(16), ts: 1, sig: "01".repeat(64) }),
);

describe("P2P v4: saludo sellado", () => {
  const a = party();
  const b = party();
  const c = party();

  it("los dos lados de una pareja obtienen la misma clave; otra pareja, otra clave", () => {
    const ab = derivePairKey(a.kp.secretKey, a.pkHex, b.pkHex);
    const ba = derivePairKey(b.kp.secretKey, b.pkHex, a.pkHex);
    const ac = derivePairKey(a.kp.secretKey, a.pkHex, c.pkHex);
    expect(toHex(ab)).toBe(toHex(ba));
    expect(toHex(ab)).not.toBe(toHex(ac));
  });

  it("una clave de contacto de orden bajo (todo ceros) se rechaza", () => {
    expect(() => derivePairKey(a.kp.secretKey, a.pkHex, "00".repeat(32))).toThrow(/nulo/);
  });

  it("en el cable no aparece ninguna identidad ni el contenido", () => {
    const k = derivePairKey(a.kp.secretKey, a.pkHex, b.pkHex);
    const wire = dec(sealHandshakeFrame(k, "hello", HELLO));
    expect(wire).not.toContain(a.pkHex);
    expect(wire).not.toContain(b.pkHex);
    expect(wire).not.toContain("ab".repeat(32));
    expect(wire).not.toContain("nido-hello");
    expect(wire.length).toBeLessThan(MAX_SEALED_FRAME_BYTES);
  });

  it("dos frames del mismo contenido no se pueden enlazar (todo cambia)", () => {
    const k = derivePairKey(a.kp.secretKey, a.pkHex, b.pkHex);
    const x = parseSealed(sealHandshakeFrame(k, "hello", HELLO));
    const y = parseSealed(sealHandshakeFrame(k, "hello", HELLO));
    expect(toHex(x.r)).not.toBe(toHex(y.r));
    expect(toHex(x.g)).not.toBe(toHex(y.g));
    expect(toHex(x.n)).not.toBe(toHex(y.n));
    expect(toHex(x.b)).not.toBe(toHex(y.b));
  });

  it("el destinatario identifica al contacto entre varios y abre el saludo", () => {
    const kab = derivePairKey(a.kp.secretKey, a.pkHex, b.pkHex);
    const frame = sealHandshakeFrame(kab, "hello", HELLO);
    expect(isSealedFrame(frame)).toBe(true);
    const candidates = [
      { id: "c", pairKey: derivePairKey(b.kp.secretKey, b.pkHex, c.pkHex) },
      { id: "a", pairKey: derivePairKey(b.kp.secretKey, b.pkHex, a.pkHex) },
    ];
    const out = openFromAnyContact(parseSealed(frame), candidates, "hello");
    expect(out?.contact.id).toBe("a");
    expect(dec(out!.inner)).toBe(dec(HELLO));
  });

  it("un tercero (otra pareja) no puede abrirlo ni reconocerlo", () => {
    const kab = derivePairKey(a.kp.secretKey, a.pkHex, b.pkHex);
    const frame = parseSealed(sealHandshakeFrame(kab, "hello", HELLO));
    const kcb = derivePairKey(c.kp.secretKey, c.pkHex, b.pkHex);
    const kca = derivePairKey(c.kp.secretKey, c.pkHex, a.pkHex);
    expect(openWithPairKey(frame, kcb, "hello")).toBeNull();
    expect(openWithPairKey(frame, kca, "hello")).toBeNull();
  });

  it("un HELLO no se puede hacer pasar por CONFIRM ni al revés", () => {
    const k = derivePairKey(a.kp.secretKey, a.pkHex, b.pkHex);
    const h = parseSealed(sealHandshakeFrame(k, "hello", HELLO));
    expect(openWithPairKey(h, k, "confirm")).toBeNull();
    expect(openWithPairKey(h, k, "hello")).not.toBeNull();
  });

  it("cualquier bit cambiado en el cuerpo, la etiqueta o r invalida el frame", () => {
    const k = derivePairKey(a.kp.secretKey, a.pkHex, b.pkHex);
    const base = parseSealed(sealHandshakeFrame(k, "hello", HELLO));
    for (const field of ["r", "g", "n", "b"] as const) {
      const t = { ...base, [field]: base[field].slice() };
      t[field][0] ^= 1;
      expect(openWithPairKey(t, k, "hello")).toBeNull();
    }
  });

  it("frames que no son sellados o están mal formados se rechazan sin romper", () => {
    expect(isSealedFrame(HELLO)).toBe(false);
    expect(isSealedFrame(new Uint8Array(0))).toBe(false);
    expect(isSealedFrame(new Uint8Array(MAX_SEALED_FRAME_BYTES + 1).fill(123))).toBe(false);
    for (const bad of [
      "{}",
      "basura",
      JSON.stringify({ t: "nido-s4" }),
      JSON.stringify({ t: "nido-s4", r: "zz", g: "00".repeat(16), n: "00".repeat(24), b: "AA==" }),
      JSON.stringify({ t: "nido-s4", r: "00".repeat(16), g: "00".repeat(16), n: "00".repeat(24), b: "" }),
      JSON.stringify({ t: "nido-s4", r: "00".repeat(15), g: "00".repeat(16), n: "00".repeat(24), b: "AA==" }),
    ]) {
      expect(() => parseSealed(enc(bad))).toThrow();
    }
  });

  it("fuzz: 500 frames aleatorios nunca abren ni lanzan fuera de parse", () => {
    const k = derivePairKey(a.kp.secretKey, a.pkHex, b.pkHex);
    for (let i = 0; i < 500; i++) {
      const junk = nacl.randomBytes(1 + (i % 900));
      let parsed;
      try {
        parsed = parseSealed(junk);
      } catch {
        continue;
      }
      expect(openWithPairKey(parsed, k, "hello")).toBeNull();
    }
    for (let i = 0; i < 300; i++) {
      const sealed = {
        r: nacl.randomBytes(16),
        g: nacl.randomBytes(16),
        n: nacl.randomBytes(24),
        b: nacl.randomBytes(16 + (i % 400)),
      };
      expect(openWithPairKey(sealed, k, "hello")).toBeNull();
      expect(openFromAnyContact(sealed, [{ pairKey: k }], "confirm")).toBeNull();
    }
  });

  it("contenido vacío o enorme no se sella", () => {
    const k = derivePairKey(a.kp.secretKey, a.pkHex, b.pkHex);
    expect(() => sealHandshakeFrame(k, "hello", new Uint8Array(0))).toThrow();
    expect(() => sealHandshakeFrame(k, "hello", new Uint8Array(2000))).toThrow();
  });
});
