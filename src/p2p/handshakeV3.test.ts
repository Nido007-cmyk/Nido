/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * handshakeV3.test.ts — R4: vectores exactos crypto/wire del HELLO v3 y el
 * CONFIRM v1, a nivel de byte.
 *
 * Estos vectores fijan el cable: cualquier cambio de formato rompe el test
 * a propósito (compatibilidad entre versiones de la app).
 */
import { describe, it, expect } from "vitest";
import {
  buildHelloSignMessage,
  buildHelloSignMessageV3,
  buildConfirmSignMessage,
  buildConfirmSignMessageV2,
  fromHex,
  generateSigningKeypair,
  signDetached,
  toHex,
  verifyDetached,
} from "./crypto";
import {
  buildConfirmV1,
  CONFIRM_TYPE_V1,
  CONFIRM_VERSION,
  HELLO_TS_SKEW_S,
  HELLO_TYPE_V3,
  HELLO_VERSION,
  NONCE_CACHE_WINDOW_S,
  parseConfirm,
  tieBreakKey,
} from "./handshakeV3";

const utf8 = (b: Uint8Array) => new TextDecoder().decode(b);

// Vectores fijos (no aleatorios): el cable queda clavado byte a byte.
const PK = "11".repeat(32);
const EPH = "22".repeat(32);
const NONCE = "33".repeat(16);
const TS = 1780000000;
const CN = "44".repeat(16);
const PN = "55".repeat(16);

describe("R4: vectores exactos del mensaje firmado", () => {
  it("HELLO v3: bytes exactos UTF-8('nido-hello-v3|pk|eph|nonce|ts')", () => {
    expect(utf8(buildHelloSignMessageV3(PK, EPH, NONCE, TS))).toBe(
      `nido-hello-v3|${PK}|${EPH}|${NONCE}|${TS}`,
    );
  });

  it("CONFIRM v1: bytes exactos UTF-8('nido-confirm-v1|pk|cn|pn')", () => {
    expect(utf8(buildConfirmSignMessage(PK, CN, PN))).toBe(
      `nido-confirm-v1|${PK}|${CN}|${PN}`,
    );
  });

  it("los hex en mayúsculas se normalizan a minúsculas antes de firmar", () => {
    const upper = buildHelloSignMessageV3(PK.toUpperCase(), EPH.toUpperCase(), NONCE.toUpperCase(), TS);
    expect(utf8(upper)).toBe(`nido-hello-v3|${PK}|${EPH}|${NONCE}|${TS}`);
  });

  it("ts inválido → throw (0, negativo, no entero, >= 2^40)", () => {
    for (const bad of [0, -1, 1.5, NaN, 2 ** 40, 2 ** 40 + 1]) {
      expect(() => buildHelloSignMessageV3(PK, EPH, NONCE, bad)).toThrow();
    }
    // Límites válidos: 1 y 2^40 - 1 no lanzan.
    expect(() => buildHelloSignMessageV3(PK, EPH, NONCE, 1)).not.toThrow();
    expect(() => buildHelloSignMessageV3(PK, EPH, NONCE, 2 ** 40 - 1)).not.toThrow();
  });

  it("firma/verify roundtrip sobre el mensaje v3 exacto", () => {
    const kp = generateSigningKeypair();
    const msg = buildHelloSignMessageV3(PK, EPH, NONCE, TS);
    const sig = signDetached(msg, kp.secretKey);
    expect(toHex(sig)).toMatch(/^[0-9a-f]{128}$/);
    expect(verifyDetached(msg, sig, kp.publicKey)).toBe(true);
    // Un bit cambiado en el mensaje → no verifica.
    const tampered = new Uint8Array(msg);
    tampered[tampered.length - 1] ^= 1;
    expect(verifyDetached(tampered, sig, kp.publicKey)).toBe(false);
  });

  it("firma/verify roundtrip sobre el mensaje CONFIRM v1 exacto", () => {
    const kp = generateSigningKeypair();
    const msg = buildConfirmSignMessage(PK, CN, PN);
    const sig = signDetached(msg, kp.secretKey);
    expect(verifyDetached(msg, sig, kp.publicKey)).toBe(true);
    // cn y pn NO son intercambiables: el orden importa.
    expect(verifyDetached(buildConfirmSignMessage(PK, PN, CN), sig, kp.publicKey)).toBe(false);
  });

  it("SEPARACIÓN DE DOMINIO: una firma v2 jamás verifica como v3 (y viceversa)", () => {
    const kp = generateSigningKeypair();
    const msgV2 = buildHelloSignMessage(PK, EPH, NONCE);
    const msgV3 = buildHelloSignMessageV3(PK, EPH, NONCE, TS);
    expect(utf8(msgV2)).not.toBe(utf8(msgV3));
    const sigV2 = signDetached(msgV2, kp.secretKey);
    const sigV3 = signDetached(msgV3, kp.secretKey);
    // Cruzados: ambos fallan.
    expect(verifyDetached(msgV3, sigV2, kp.publicKey)).toBe(false);
    expect(verifyDetached(msgV2, sigV3, kp.publicKey)).toBe(false);
    // Rectos: ambos pasan.
    expect(verifyDetached(msgV2, sigV2, kp.publicKey)).toBe(true);
    expect(verifyDetached(msgV3, sigV3, kp.publicKey)).toBe(true);
  });

  it("SEPARACIÓN DE DOMINIO: una firma HELLO v3 jamás verifica como CONFIRM", () => {
    const kp = generateSigningKeypair();
    const helloMsg = buildHelloSignMessageV3(PK, EPH, NONCE, TS);
    const sig = signDetached(helloMsg, kp.secretKey);
    expect(verifyDetached(buildConfirmSignMessage(PK, CN, PN), sig, kp.publicKey)).toBe(false);
  });
});

describe("R4: constantes del protocolo", () => {
  it("tipos y versiones del cable", () => {
    expect(HELLO_TYPE_V3).toBe("nido-hello");
    expect(HELLO_VERSION).toBe(3);
    expect(CONFIRM_TYPE_V1).toBe("nido-confirm");
    expect(CONFIRM_VERSION).toBe(1);
  });

  it("HELLO_TS_SKEW_S es 600 (PROVISIONAL hasta pruebas reales)", () => {
    expect(HELLO_TS_SKEW_S).toBe(600);
  });

  it("la ventana de la cache cubre el skew con margen", () => {
    expect(NONCE_CACHE_WINDOW_S).toBeGreaterThan(HELLO_TS_SKEW_S);
  });
});

describe("R4: cable del CONFIRM v1", () => {
  it("buildConfirmV1 produce el JSON exacto esperado", () => {
    const sig = "ab".repeat(64);
    const body = buildConfirmV1(PK, CN, PN, sig);
    expect(JSON.parse(utf8(body))).toEqual({
      t: "nido-confirm",
      v: 1,
      pk: PK,
      cn: CN,
      pn: PN,
      sig,
    });
  });

  it("parseConfirm acepta el roundtrip y normaliza a minúsculas", () => {
    const sig = "AB".repeat(64);
    const parsed = parseConfirm(buildConfirmV1(PK.toUpperCase(), CN, PN, sig));
    expect(parsed).toEqual({ pk: PK, cn: CN, pn: PN, sig: sig.toLowerCase() });
  });

  it("parseConfirm rechaza: no-JSON, tipo/versión, campos malformados", () => {
    const sig = "ab".repeat(64);
    const good = { t: "nido-confirm", v: 1, pk: PK, cn: CN, pn: PN, sig };
    expect(() => parseConfirm(new TextEncoder().encode("no json"))).toThrow();
    expect(() => parseConfirm(new TextEncoder().encode(JSON.stringify({ ...good, t: "x" })))).toThrow(
      /tipo/,
    );
    expect(() => parseConfirm(new TextEncoder().encode(JSON.stringify({ ...good, v: 2 })))).toThrow(
      /versión/,
    );
    expect(() =>
      parseConfirm(new TextEncoder().encode(JSON.stringify({ ...good, pk: "corta" }))),
    ).toThrow(/pk/);
    expect(() =>
      parseConfirm(new TextEncoder().encode(JSON.stringify({ ...good, cn: "corto" }))),
    ).toThrow(/cn/);
    expect(() =>
      parseConfirm(new TextEncoder().encode(JSON.stringify({ ...good, pn: "corto" }))),
    ).toThrow(/pn/);
    expect(() =>
      parseConfirm(new TextEncoder().encode(JSON.stringify({ ...good, sig: "corta" }))),
    ).toThrow(/firma/);
    // Un HELLO no es un CONFIRM aunque los campos coincidan en forma.
    expect(() =>
      parseConfirm(
        new TextEncoder().encode(
          JSON.stringify({ t: "nido-hello", v: 3, pk: good.pk, cn: good.cn, pn: good.pn, sig: good.sig }),
        ),
      ),
    ).toThrow(/tipo/);
  });
});

describe("R4: tie-break de simultaneous dial (vectores)", () => {
  // Nonces fijos de 4 "lados": socket1 = (a1,b1), socket2 = (a2,b2).
  const a1 = "10".repeat(16);
  const b1 = "20".repeat(16);
  const a2 = "15".repeat(16);
  const b2 = "05".repeat(16);

  it("K = min||max, independiente del orden local de cada peer", () => {
    // El peer A ve (a1, b1); el peer B ve (b1, a1): misma K.
    expect(tieBreakKey(a1, b1)).toBe(tieBreakKey(b1, a1));
    expect(tieBreakKey(a1, b1)).toBe("10".repeat(16) + "20".repeat(16));
    expect(tieBreakKey(a2, b2)).toBe("05".repeat(16) + "15".repeat(16));
  });

  it("ambos peers eligen el mismo ganador sin importar el orden local", () => {
    const k1 = tieBreakKey(a1, b1);
    const k2 = tieBreakKey(a2, b2);
    // Vista del peer A: compara K1 vs K2.
    const winnerA = k1 < k2 ? "socket1" : "socket2";
    // Vista del peer B (orden local invertido en ambos sockets): misma comparación.
    const k1b = tieBreakKey(b1, a1);
    const k2b = tieBreakKey(b2, a2);
    const winnerB = k1b < k2b ? "socket1" : "socket2";
    expect(winnerA).toBe(winnerB);
    expect(winnerA).toBe("socket2"); // K2 = 05… < K1 = 10…
  });

  it("comparación lexicográfica byte-wise sobre hex minúsculas", () => {
    // "0a" < "a0" como bytes (0x0a < 0xa0) y como strings ASCII.
    expect(tieBreakKey("a0".repeat(16), "0a".repeat(16))).toBe(
      "0a".repeat(16) + "a0".repeat(16),
    );
  });

  it("nonces inválidos → throw (fail-closed)", () => {
    expect(() => tieBreakKey("zz", b1)).toThrow();
    expect(() => tieBreakKey(a1, "corto")).toThrow();
  });

  it("fromHex sigue disponible para el transporte (sanity)", () => {
    expect(toHex(fromHex(PK))).toBe(PK);
  });
});

describe("0.1.48: CONFIRM v2 (firma con destinatario)", () => {
  const PEER = "66".repeat(32);
  const SIG = "77".repeat(64);
  const S2 = "88".repeat(64);

  it("vector exacto: 'nido-confirm-v2|pk|peer|cn|pn'", () => {
    expect(utf8(buildConfirmSignMessageV2(PK, PEER, CN, PN))).toBe(
      `nido-confirm-v2|${PK}|${PEER}|${CN}|${PN}`,
    );
    // En minúsculas, como v1.
    expect(utf8(buildConfirmSignMessageV2(PK.toUpperCase(), PEER.toUpperCase(), CN, PN))).toBe(
      `nido-confirm-v2|${PK}|${PEER}|${CN}|${PN}`,
    );
  });

  it("v1 y v2 nunca firman los mismos bytes (separación de dominio)", () => {
    expect(utf8(buildConfirmSignMessageV2(PK, PEER, CN, PN))).not.toBe(utf8(buildConfirmSignMessage(PK, CN, PN)));
  });

  it("el cable con s2 se parsea y conserva la firma v2", () => {
    const c = parseConfirm(buildConfirmV1(PK, CN, PN, SIG, S2));
    expect(c).toEqual({ pk: PK, cn: CN, pn: PN, sig: SIG, s2: S2 });
  });

  it("sin s2 (NIDO viejo) se parsea igual que siempre, sin campo s2", () => {
    const c = parseConfirm(buildConfirmV1(PK, CN, PN, SIG));
    expect(c).toEqual({ pk: PK, cn: CN, pn: PN, sig: SIG });
    expect("s2" in c).toBe(false);
  });

  it("s2 presente pero mal formado → rechazado", () => {
    const base = { t: CONFIRM_TYPE_V1, v: CONFIRM_VERSION, pk: PK, cn: CN, pn: PN, sig: SIG };
    for (const bad of ["", "zz".repeat(64), "88".repeat(63), 123, null, ["x"]]) {
      const body = new TextEncoder().encode(JSON.stringify({ ...base, s2: bad }));
      expect(() => parseConfirm(body)).toThrow();
    }
  });

  it("el CONFIRM con las dos firmas cabe de sobra en el tope del handshake", () => {
    expect(buildConfirmV1(PK, CN, PN, SIG, S2).length).toBeLessThan(600);
  });

  it("una firma v2 hecha para otro destinatario no verifica para mí", () => {
    const kp = generateSigningKeypair();
    const me = "99".repeat(32);
    const sigForOther = signDetached(buildConfirmSignMessageV2(PK, PEER, CN, PN), kp.secretKey);
    expect(verifyDetached(buildConfirmSignMessageV2(PK, PEER, CN, PN), sigForOther, kp.publicKey)).toBe(true);
    expect(verifyDetached(buildConfirmSignMessageV2(PK, me, CN, PN), sigForOther, kp.publicKey)).toBe(false);
  });
});
