/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.48 — segunda barrera del CONFIRM v2, dentro de la sesión cifrada.
 *
 * Cada teléfono nuevo dice "cf2" en su session_confirm (cifrado y
 * autenticado con la clave de sesión: nadie puede quitarlo). Si el CONFIRM
 * del saludo nos llegó SIN la firma v2 pero el peer dice cf2, alguien la quitó
 * por el camino: la sesión no se usa. Así queda cerrada incluso la primera
 * conexión entre dos teléfonos nuevos, antes de que el contacto esté marcado.
 */
import { describe, expect, it } from "vitest";
import { generateEphemeral, generateIdentity, randomNonce, toHex, HANDSHAKE_NONCE_BYTES } from "./crypto";
import { makeEnvelope, P2PSession } from "./protocol";

function pair() {
  const a = generateIdentity();
  const b = generateIdentity();
  const aPk = toHex(a.publicKey);
  const bPk = toHex(b.publicKey);
  const eA = generateEphemeral();
  const eB = generateEphemeral();
  const nA = randomNonce(HANDSHAKE_NONCE_BYTES);
  const nB = randomNonce(HANDSHAKE_NONCE_BYTES);
  const sA = P2PSession.fromHandshakeV2(eA.secretKey, eB.publicKey, bPk, nA, nB);
  const sB = P2PSession.fromHandshakeV2(eB.secretKey, eA.publicKey, aPk, nB, nA);
  sA.expectRecipient(aPk);
  sB.expectRecipient(bPk);
  sA.enableV5(false);
  sB.enableV5(false);
  /** session_confirm de A hacia B, tal como lo manda el messenger. */
  const confirmFromA = () => {
    const frame = sA.pack(makeEnvelope("session_confirm", "c-A", a.publicKey, bPk, sA.confirmPayload()));
    const env = sB.unpack(frame);
    if (!env) throw new Error("no abre");
    return env;
  };
  return { sA, sB, confirmFromA };
}

describe("0.1.48: cf2 en el session_confirm", () => {
  it("todo session_confirm de esta versión dice cf2", () => {
    const { sA } = pair();
    expect(sA.confirmPayload()).toEqual({ cf2: 1 });
  });

  it("CONFIRM sin v2 + el peer dice cf2 → degradación detectada", () => {
    const { sB, confirmFromA } = pair();
    sB.setPeerConfirmV2(false);
    expect(sB.confirmV2Downgrade(confirmFromA())).toBe(true);
  });

  it("CONFIRM con v2 verificada + cf2 → todo bien", () => {
    const { sB, confirmFromA } = pair();
    sB.setPeerConfirmV2(true);
    expect(sB.confirmV2Downgrade(confirmFromA())).toBe(false);
  });

  it("NIDO viejo: sin v2 y sin cf2 → no es degradación (sigue funcionando)", () => {
    const { sB } = pair();
    sB.setPeerConfirmV2(false);
    const old = makeEnvelope("session_confirm", "x", generateIdentity().publicKey, "00".repeat(32), {});
    expect(sB.confirmV2Downgrade(old)).toBe(false);
  });

  it("sesión creada sin el transporte real (sin dato) → no decide nada", () => {
    const { sB, confirmFromA } = pair();
    expect(sB.confirmV2Downgrade(confirmFromA())).toBe(false);
  });

  it("solo cuenta en session_confirm, no en un chat con un campo cf2", () => {
    const { sB } = pair();
    sB.setPeerConfirmV2(false);
    const chat = makeEnvelope("chat", "y", generateIdentity().publicKey, "00".repeat(32), { text: "hola", cf2: 1 });
    expect(sB.confirmV2Downgrade(chat)).toBe(false);
  });
});

describe("0.1.52: unknown key share detectado en la sesión (revisión independiente)", () => {
  /**
   * El ataque: un contacto malicioso C junta dos handshakes. A cree hablar con
   * B; B cree hablar con C; los dos acaban con la MISMA clave de sesión. C le
   * quitó a A la firma v2 del CONFIRM de B (que nombraba a C).
   */
  function uks() {
    const A = generateIdentity();
    const B = generateIdentity();
    const C = generateIdentity();
    const aPk = toHex(A.publicKey);
    const bPk = toHex(B.publicKey);
    const cPk = toHex(C.publicKey);
    const eA = generateEphemeral();
    const eB = generateEphemeral();
    const nA = randomNonce(HANDSHAKE_NONCE_BYTES);
    const nB = randomNonce(HANDSHAKE_NONCE_BYTES);
    const atA = P2PSession.fromHandshakeV2(eA.secretKey, eB.publicKey, bPk, nA, nB); // A: "hablo con B"
    const atB = P2PSession.fromHandshakeV2(eB.secretKey, eA.publicKey, cPk, nB, nA); // B: "hablo con C"
    atA.expectRecipient(aPk);
    atB.expectRecipient(bPk);
    atA.enableV5(false);
    atB.enableV5(false);
    atA.setPeerConfirmV2(false);
    return { atA, atB, B, cPk };
  }

  it("el session_confirm de B (para C) autentica con la clave de A: A lo detecta y sabe que B firma v2", () => {
    const { atA, atB, B, cPk } = uks();
    const frame = atB.pack(makeEnvelope("session_confirm", "c-B", B.publicKey, cPk, atB.confirmPayload()));
    expect(atA.unpack(frame)).toBeNull();
    expect(atA.unknownKeyShare).toEqual({ cf2: true });
  });

  it("un chat de B para C también lo delata", () => {
    const { atA, atB, B, cPk } = uks();
    expect(atA.unpack(atB.pack(makeEnvelope("chat", "x", B.publicKey, cPk, { text: "hola C" })))).toBeNull();
    expect(atA.unknownKeyShare).toEqual({ cf2: false });
  });

  it("basura o un frame de otra sesión NO cuentan (no autentican)", () => {
    const { atA } = uks();
    const other = pair();
    const f = other.sA.pack(makeEnvelope("chat", "y", generateIdentity().publicKey, "00".repeat(32), { text: "x" }));
    expect(atA.unpack(f)).toBeNull();
    expect(atA.unpack(new Uint8Array(200))).toBeNull();
    expect(atA.unknownKeyShare).toBeNull();
  });

  it("una sesión normal nunca lo marca", () => {
    const { sB, confirmFromA } = pair();
    expect(confirmFromA()).not.toBeNull();
    expect(sB.unknownKeyShare).toBeNull();
  });
});
