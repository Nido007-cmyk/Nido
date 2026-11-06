// Mensajes de amigo en amigo, fase 1: la criptografía del sobre.
// Lo que se prueba: el destinatario lo abre; nadie más (ni el mensajero,
// ni otro contacto) puede; manipular cualquier parte lo invalida; un
// mensajero no puede hacerse pasar por el remitente; caducidad, versión y
// forma se comprueban sin lanzar.
import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";
import { toHex } from "../crypto";
import {
  carryDay,
  carryTag,
  envelopeBytes,
  generateCarryPrekey,
  isWellFormedEnvelope,
  MAX_ENVELOPE_TTL_MS,
  needsRotation,
  openCarry,
  PAD_BUCKETS,
  PREKEY_TTL_MS,
  sealCarry,
  verifyCarryPrekey,
  type CarryEnvelope,
} from "./carryCrypto";

function person() {
  const id = nacl.box.keyPair();
  const sign = nacl.sign.keyPair();
  return { pk: toHex(id.publicKey), sigPk: toHex(sign.publicKey), signSk: sign.secretKey };
}

const NOW = 1_800_000_000_000;
const ana = person();
const beto = person(); // el mensajero
const caro = person(); // la destinataria
const contactsOfCaro = new Map([[ana.pk, ana.sigPk], [beto.pk, beto.sigPk]]);
const sigOf = (m: Map<string, string>) => (pk: string) => m.get(pk) ?? null;
const caroKey = generateCarryPrekey(caro.pk, caro.signSk, NOW);

function seal(text = "Estoy bien, en casa de la tía.", over: Partial<Parameters<typeof sealCarry>[0]> = {}): CarryEnvelope {
  return sealCarry({ recipient: caroKey.pub, senderPkHex: ana.pk, senderSignSecretKey: ana.signSk, id: "m-1", kind: "chat", text, now: NOW, ...over });
}

describe("clave de buzón", () => {
  it("firmada por su dueño, vigente 14 días", () => {
    expect(verifyCarryPrekey(caroKey.pub, caro.pk, caro.sigPk, NOW)).toBe(true);
    expect(caroKey.pub.expiresAt - caroKey.pub.createdAt).toBe(PREKEY_TTL_MS);
  });
  it("par: firmada por otro, de otro dueño, caducada o retocada → no vale", () => {
    expect(verifyCarryPrekey(caroKey.pub, caro.pk, ana.sigPk, NOW)).toBe(false);
    expect(verifyCarryPrekey(caroKey.pub, ana.pk, caro.sigPk, NOW)).toBe(false);
    expect(verifyCarryPrekey(caroKey.pub, caro.pk, caro.sigPk, NOW + PREKEY_TTL_MS)).toBe(false);
    const tampered = { ...caroKey.pub, x25519: toHex(nacl.box.keyPair().publicKey) };
    expect(verifyCarryPrekey(tampered, caro.pk, caro.sigPk, NOW)).toBe(false);
    const longer = { ...caroKey.pub, expiresAt: caroKey.pub.expiresAt + 1 };
    expect(verifyCarryPrekey(longer, caro.pk, caro.sigPk, NOW)).toBe(false);
    expect(verifyCarryPrekey(null, caro.pk, caro.sigPk, NOW)).toBe(false);
    expect(verifyCarryPrekey({ ...caroKey.pub, kem: "00" }, caro.pk, caro.sigPk, NOW)).toBe(false);
  });
  it("se rota a mitad de vida", () => {
    expect(needsRotation(null, NOW)).toBe(true);
    expect(needsRotation(caroKey.pub, NOW + PREKEY_TTL_MS / 2 - 1)).toBe(false);
    expect(needsRotation(caroKey.pub, NOW + PREKEY_TTL_MS / 2)).toBe(true);
  });
});

describe("sobre", () => {
  it("la destinataria lo abre y ve quién escribe", () => {
    const opened = openCarry(seal(), [caroKey.secret], caro.pk, sigOf(contactsOfCaro), NOW + 1000);
    expect(opened).toEqual({ from: ana.pk, id: "m-1", ts: NOW, kind: "chat", text: "Estoy bien, en casa de la tía." });
  });
  it("por fuera no se ve ni el texto ni el remitente ni el destinatario", () => {
    const env = seal();
    const visible = JSON.stringify(env);
    expect(visible).not.toContain("tía");
    expect(visible).not.toContain(ana.pk);
    expect(visible).not.toContain(caro.pk);
    expect(env.tag).toBe(carryTag(caroKey.pub.id, carryDay(NOW)));
  });
  it("la etiqueta cambia cada día y aun así se abre hasta que caduca", () => {
    const DAY = 24 * 3600 * 1000;
    const hoy = seal();
    const manana = sealCarry({ recipient: caroKey.pub, senderPkHex: ana.pk, senderSignSecretKey: ana.signSk, id: "m-2", kind: "chat", text: "x", now: NOW + DAY });
    expect(manana.tag).not.toBe(hoy.tag);
    expect(openCarry(hoy, [caroKey.secret], caro.pk, sigOf(contactsOfCaro), NOW + 71 * 3600 * 1000)).not.toBeNull();
    expect(openCarry(manana, [caroKey.secret], caro.pk, sigOf(contactsOfCaro), NOW + DAY + 1000)).not.toBeNull();
  });
  it("relleno: mensajes de 1 y de 400 letras ocupan lo mismo; el máximo con emojis cabe", () => {
    expect(envelopeBytes(seal("a"))).toBe(envelopeBytes(seal("a".repeat(400))));
    expect(PAD_BUCKETS.length).toBeGreaterThan(1);
    const emojis = seal("😀".repeat(750)); // 1.500 unidades UTF-16, 3.000 bytes
    expect(isWellFormedEnvelope(emojis)).toBe(true);
    expect(openCarry(emojis, [caroKey.secret], caro.pk, sigOf(contactsOfCaro), NOW)?.text).toBe("😀".repeat(750));
    const worst = seal("\u{10FFFF}".repeat(750) );
    expect(isWellFormedEnvelope(worst)).toBe(true);
  });
  it("par: el mensajero (u otro contacto) no puede abrirlo", () => {
    const betoKey = generateCarryPrekey(beto.pk, beto.signSk, NOW);
    expect(openCarry(seal(), [betoKey.secret], beto.pk, sigOf(new Map([[ana.pk, ana.sigPk]])), NOW)).toBeNull();
  });
  it("par: cualquier byte cambiado por el camino lo invalida", () => {
    const env = seal();
    const flip = (hex: string, at: number) => hex.slice(0, at) + (hex[at] === "0" ? "1" : "0") + hex.slice(at + 1);
    for (const field of ["box", "eph", "kct", "nonce"] as const) {
      const bad = { ...env, [field]: flip(env[field], 10) };
      expect(openCarry(bad, [caroKey.secret], caro.pk, sigOf(contactsOfCaro), NOW)).toBeNull();
    }
  });
  it("par: un mensajero no puede hacerse pasar por Ana (firma por dentro)", () => {
    // Beto conoce la clave de buzón de Caro y sella un sobre con su propia
    // firma diciendo que es de Ana: Caro lo rechaza.
    const forged = sealCarry({ recipient: caroKey.pub, senderPkHex: ana.pk, senderSignSecretKey: beto.signSk, id: "x", kind: "chat", text: "Soy Ana, mándame tu clave", now: NOW });
    expect(openCarry(forged, [caroKey.secret], caro.pk, sigOf(contactsOfCaro), NOW)).toBeNull();
  });
  it("par: de alguien que no es contacto de Caro → no se abre (sin spam de desconocidos)", () => {
    const stranger = person();
    const env = sealCarry({ recipient: caroKey.pub, senderPkHex: stranger.pk, senderSignSecretKey: stranger.signSk, id: "s", kind: "chat", text: "hola", now: NOW });
    expect(openCarry(env, [caroKey.secret], caro.pk, sigOf(contactsOfCaro), NOW)).toBeNull();
  });
  it("par: caducado (por la fecha firmada, aunque un mensajero cambie la de fuera)", () => {
    const env = seal("x", { ttlMs: 60_000 });
    expect(openCarry(env, [caroKey.secret], caro.pk, sigOf(contactsOfCaro), NOW + 61_000)).toBeNull();
    const stretched = { ...env, exp: NOW + MAX_ENVELOPE_TTL_MS };
    expect(openCarry(stretched, [caroKey.secret], caro.pk, sigOf(contactsOfCaro), NOW + 61_000)).toBeNull();
  });
  it("la caducidad nunca pasa de 72 h ni de la vida de la clave de buzón", () => {
    expect(seal("x", { ttlMs: 10 * MAX_ENVELOPE_TTL_MS }).exp).toBe(NOW + MAX_ENVELOPE_TTL_MS);
    expect(seal("x", { now: caroKey.pub.expiresAt - 1000 }).exp).toBe(caroKey.pub.expiresAt);
    expect(() => seal("x", { now: caroKey.pub.expiresAt })).toThrow();
  });
  it("forma: rechaza basura sin lanzar; acepta solo tamaños del relleno", () => {
    for (const junk of [null, 1, "x", {}, { ...seal(), v: 2 }, { ...seal(), hops: 9 }, { ...seal(), box: "zz" }, { ...seal(), box: seal().box + "00" }]) {
      expect(isWellFormedEnvelope(junk)).toBe(false);
      expect(openCarry(junk, [caroKey.secret], caro.pk, sigOf(contactsOfCaro), NOW)).toBeNull();
    }
    expect(isWellFormedEnvelope(seal())).toBe(true);
  });
  it("demasiado largo → no se sella", () => {
    expect(() => seal("a".repeat(1501))).toThrow();
  });
});
