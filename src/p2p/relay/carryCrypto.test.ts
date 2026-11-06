// Mensajes de amigo en amigo, fase 1: la criptografía del sobre.
// Lo que se prueba: el destinatario lo abre; nadie más (ni el mensajero,
// ni otro contacto) puede; manipular cualquier parte lo invalida; un
// mensajero no puede hacerse pasar por el remitente; caducidad, versión y
// forma se comprueban sin lanzar.
import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";
import { fromHex, hkdfSha512, randomNonce, sha512, toHex, utf8Encode } from "../crypto";
import { kemEncapsulate, kemKeygen } from "../pq";
import {
  carryDay,
  carryTag,
  carryTextLength,
  envelopeBytes,
  generateCarryPrekey,
  isWellFormedEnvelope,
  kemPublicFromSecret,
  CARRY_VERSION,
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
  return { pk: toHex(id.publicKey), sigPk: toHex(sign.publicKey), signSk: sign.secretKey, idSk: id.secretKey };
}

const NOW = 1_800_000_000_000;
const ana = person();
const beto = person(); // el mensajero
const caro = person(); // la destinataria
const contactsOfCaro = new Set([ana.pk, beto.pk]);
const sigOf = (m: Set<string>) => (pk: string) => m.has(pk);
const caroKey = generateCarryPrekey(caro.pk, caro.signSk, NOW);

/**
 * Implementación independiente del formato v2, escrita a partir de la
 * especificación del comentario de carryCrypto.ts (no reutiliza sus
 * funciones internas). Sirve para dos cosas: comprobar que el código hace
 * lo que dice la especificación, y fabricar sobres que sealCarry nunca
 * haría (falsificaciones, campos fuera de rango).
 */
function forge(o: {
  headerFrom: string;
  staticSecret: Uint8Array;
  inner?: Record<string, unknown>;
  now?: number;
  /** Secreto estático ya calculado (lo que haría Caro con su buzón). */
  dhS?: Uint8Array;
  /** Rellenar con algo distinto de ceros. */
  padByte?: number;
}): CarryEnvelope {
  const now = o.now ?? NOW;
  const h32 = (b: Uint8Array) => sha512(b).slice(0, 32);
  const rX = fromHex(caroKey.pub.x25519);
  const rKem = fromHex(caroKey.pub.kem);
  const eph = nacl.box.keyPair();
  const { cipherText, sharedSecret } = kemEncapsulate(rKem);
  const ctx = toHex(h32(utf8Encode(`nido-carry-ctx-v2|${caroKey.pub.id}|${toHex(rX)}|${toHex(h32(rKem))}|${toHex(eph.publicKey)}|${toHex(h32(cipherText))}`)));
  const dhE = nacl.scalarMult(eph.secretKey, rX);
  const ikm = new Uint8Array(64);
  ikm.set(dhE, 0);
  ikm.set(sharedSecret, 32);
  const hk = hkdfSha512(utf8Encode("nido-carry-v2"), ikm, utf8Encode(`nido-carry-hdr-v2|${ctx}`), 64);
  const header = nacl.secretbox(fromHex(o.headerFrom), new Uint8Array(24), hk.slice(0, 32));
  const dhS = o.dhS ?? nacl.scalarMult(o.staticSecret, rX);
  const k2 = hkdfSha512(hk.slice(32, 64), dhS, utf8Encode(`nido-carry-body-v2|${ctx}|${o.headerFrom}`), 32);
  const inner = { v: 2, from: o.headerFrom, to: caro.pk, id: "f-1", ts: now, exp: now + 3600_000, prekey: caroKey.pub.id, kind: "chat", text: "hola", ...o.inner };
  const json = utf8Encode(JSON.stringify(inner));
  const plain = new Uint8Array(1024).fill(o.padByte ?? 0);
  new DataView(plain.buffer).setUint32(0, json.length);
  plain.set(json, 4);
  const nonce = randomNonce(24);
  const body = nacl.secretbox(plain, nonce, k2);
  return {
    t: "nido-carry",
    v: 2,
    eid: toHex(randomNonce(16)),
    tag: carryTag(caroKey.pub.id, carryDay(now)),
    exp: inner.exp as number,
    hops: 3,
    eph: toHex(eph.publicKey),
    kct: toHex(cipherText),
    nonce: toHex(nonce),
    box: toHex(header) + toHex(body),
  };
}

function seal(text = "Estoy bien, en casa de la tía.", over: Partial<Parameters<typeof sealCarry>[0]> = {}): CarryEnvelope {
  return sealCarry({ recipient: caroKey.pub, senderPkHex: ana.pk, senderSecretKey: ana.idSk, id: "m-1", kind: "chat", text, now: NOW, ...over });
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

describe("especificación y propiedades (revisión de seguridad)", () => {
  it("la versión del formato es la 2", () => {
    expect(CARRY_VERSION).toBe(2);
  });
  it("una implementación independiente de la especificación da sobres que se abren", () => {
    const env = forge({ headerFrom: ana.pk, staticSecret: ana.idSk });
    expect(openCarry(env, [caroKey.secret], caro.pk, sigOf(contactsOfCaro), NOW)).toEqual({
      from: ana.pk, id: "f-1", ts: NOW, exp: NOW + 3600_000, kind: "chat", text: "hola",
    });
  });
  it("la clave pública ML-KEM sale de la secreta (FIPS 203)", () => {
    const k = kemKeygen();
    expect(toHex(kemPublicFromSecret(k.secretKey))).toBe(toHex(k.publicKey));
    expect(toHex(kemPublicFromSecret(caroKey.secret.kemSk))).toBe(caroKey.pub.kem);
  });
  it("negable: Caro, con su clave de buzón, puede fabricar un sobre «de Ana» (por eso no prueba nada ante terceros)", () => {
    // DH(identidad de Ana, buzón de Caro) = DH(buzón de Caro, identidad de Ana):
    // el sobre no contiene nada que solo Ana pudiera haber hecho.
    const dhS = nacl.scalarMult(caroKey.secret.x25519Sk, fromHex(ana.pk));
    const madeByCaro = forge({ headerFrom: ana.pk, staticSecret: new Uint8Array(32), dhS, inner: { text: "texto inventado" } });
    expect(openCarry(madeByCaro, [caroKey.secret], caro.pk, sigOf(contactsOfCaro), NOW)?.from).toBe(ana.pk);
  });
  it("par: cabecera y cuerpo no se pueden mezclar entre sobres", () => {
    const a = seal("uno");
    const b = seal("dos");
    const hdrLen = 48 * 2;
    const mixed = { ...a, box: a.box.slice(0, hdrLen) + b.box.slice(hdrLen) };
    expect(openCarry(mixed, [caroKey.secret], caro.pk, sigOf(contactsOfCaro), NOW)).toBeNull();
    const mixed2 = { ...a, nonce: b.nonce, box: a.box.slice(0, hdrLen) + b.box.slice(hdrLen) };
    expect(openCarry(mixed2, [caroKey.secret], caro.pk, sigOf(contactsOfCaro), NOW)).toBeNull();
  });
  it("par: el «from» de dentro tiene que ser el de la cabecera", () => {
    const env = forge({ headerFrom: ana.pk, staticSecret: ana.idSk, inner: { from: beto.pk } });
    expect(openCarry(env, [caroKey.secret], caro.pk, sigOf(contactsOfCaro), NOW)).toBeNull();
  });
  it("par: una caducidad de dentro de más de 72 h desde el envío se rechaza", () => {
    const env = forge({ headerFrom: ana.pk, staticSecret: ana.idSk, inner: { exp: NOW + MAX_ENVELOPE_TTL_MS + 1 } });
    expect(openCarry(env, [caroKey.secret], caro.pk, sigOf(contactsOfCaro), NOW)).toBeNull();
  });
  it("par: para otro destinatario, otra clave de buzón o con versión vieja → no", () => {
    for (const inner of [{ to: beto.pk }, { prekey: "00".repeat(16) }, { v: 1 }, { kind: "otro" }, { id: "" }, { id: "x".repeat(65) }]) {
      const env = forge({ headerFrom: ana.pk, staticSecret: ana.idSk, inner });
      expect(openCarry(env, [caroKey.secret], caro.pk, sigOf(contactsOfCaro), NOW)).toBeNull();
    }
  });
  it("par: un remitente que no es contacto se descarta tras la cabecera (sin descifrar el cuerpo)", () => {
    const stranger = person();
    const env = forge({ headerFrom: stranger.pk, staticSecret: stranger.idSk, inner: { from: stranger.pk } });
    const asked: string[] = [];
    expect(openCarry(env, [caroKey.secret], caro.pk, (pk) => (asked.push(pk), false), NOW)).toBeNull();
    expect(asked).toEqual([stranger.pk]);
  });
  it("par: relleno con basura (no ceros) se rechaza: un sobre válido tiene una sola forma", () => {
    const env = forge({ headerFrom: ana.pk, staticSecret: ana.idSk, padByte: 7 });
    expect(openCarry(env, [caroKey.secret], caro.pk, sigOf(contactsOfCaro), NOW)).toBeNull();
  });
  it("cada sobre usa una efímera y un cifrado ML-KEM nuevos", () => {
    const a = seal("x");
    const b = seal("x");
    expect(a.eph).not.toBe(b.eph);
    expect(a.kct).not.toBe(b.kct);
    expect(a.box).not.toBe(b.box);
  });
});

describe("sobre", () => {
  it("la destinataria lo abre y ve quién escribe", () => {
    const opened = openCarry(seal(), [caroKey.secret], caro.pk, sigOf(contactsOfCaro), NOW + 1000);
    expect(opened).toEqual({ from: ana.pk, id: "m-1", ts: NOW, exp: NOW + MAX_ENVELOPE_TTL_MS, kind: "chat", text: "Estoy bien, en casa de la tía." });
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
    const manana = sealCarry({ recipient: caroKey.pub, senderPkHex: ana.pk, senderSecretKey: ana.idSk, id: "m-2", kind: "chat", text: "x", now: NOW + DAY });
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
    expect(openCarry(seal(), [betoKey.secret], beto.pk, sigOf(new Set([ana.pk])), NOW)).toBeNull();
  });
  it("par: cualquier byte cambiado por el camino lo invalida", () => {
    const env = seal();
    const flip = (hex: string, at: number) => hex.slice(0, at) + (hex[at] === "0" ? "1" : "0") + hex.slice(at + 1);
    for (const field of ["box", "eph", "kct", "nonce"] as const) {
      const bad = { ...env, [field]: flip(env[field], 10) };
      expect(openCarry(bad, [caroKey.secret], caro.pk, sigOf(contactsOfCaro), NOW)).toBeNull();
    }
  });
  it("par: un mensajero no puede hacerse pasar por Ana (sin la clave de identidad de Ana)", () => {
    // Beto conoce la clave de buzón de Caro y fabrica un sobre cuya
    // cabecera dice «Ana», pero solo tiene SU clave de identidad.
    const forged = forge({ headerFrom: ana.pk, staticSecret: beto.idSk, inner: { from: ana.pk, text: "Soy Ana, mándame tu clave" } });
    expect(openCarry(forged, [caroKey.secret], caro.pk, sigOf(contactsOfCaro), NOW)).toBeNull();
    // sealCarry ni siquiera lo permite.
    expect(() => sealCarry({ recipient: caroKey.pub, senderPkHex: ana.pk, senderSecretKey: beto.idSk, id: "x", kind: "chat", text: "x", now: NOW })).toThrow();
  });
  it("par: de alguien que no es contacto de Caro → no se abre (sin spam de desconocidos)", () => {
    const stranger = person();
    const env = sealCarry({ recipient: caroKey.pub, senderPkHex: stranger.pk, senderSecretKey: stranger.idSk, id: "s", kind: "chat", text: "hola", now: NOW });
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
    for (const junk of [null, 1, "x", {}, { ...seal(), v: 1 }, { ...seal(), hops: 9 }, { ...seal(), box: "zz" }, { ...seal(), box: seal().box + "00" }]) {
      expect(isWellFormedEnvelope(junk)).toBe(false);
      expect(openCarry(junk, [caroKey.secret], caro.pk, sigOf(contactsOfCaro), NOW)).toBeNull();
    }
    expect(isWellFormedEnvelope(seal())).toBe(true);
  });
  it("demasiado largo → no se sella", () => {
    expect(() => seal("a".repeat(1501))).toThrow();
  });
});

describe("la cuenta de 1.500 es por puntos de código (H-4)", () => {
  const emoji = "\u{1F600}"; // 1 punto de código, 2 unidades UTF-16, 4 bytes UTF-8
  /** Como forge(), pero con el cubo mayor: para textos largos de emojis. */
  function forgeBig(text: string): CarryEnvelope {
    const h32 = (b: Uint8Array) => sha512(b).slice(0, 32);
    const rX = fromHex(caroKey.pub.x25519);
    const rKem = fromHex(caroKey.pub.kem);
    const eph = nacl.box.keyPair();
    const { cipherText, sharedSecret } = kemEncapsulate(rKem);
    const ctx = toHex(h32(utf8Encode(`nido-carry-ctx-v2|${caroKey.pub.id}|${toHex(rX)}|${toHex(h32(rKem))}|${toHex(eph.publicKey)}|${toHex(h32(cipherText))}`)));
    const dhE = nacl.scalarMult(eph.secretKey, rX);
    const ikm = new Uint8Array(64);
    ikm.set(dhE, 0);
    ikm.set(sharedSecret, 32);
    const hk = hkdfSha512(utf8Encode("nido-carry-v2"), ikm, utf8Encode(`nido-carry-hdr-v2|${ctx}`), 64);
    const header = nacl.secretbox(fromHex(ana.pk), new Uint8Array(24), hk.slice(0, 32));
    const dhS = nacl.scalarMult(ana.idSk, rX);
    const k2 = hkdfSha512(hk.slice(32, 64), dhS, utf8Encode(`nido-carry-body-v2|${ctx}|${ana.pk}`), 32);
    const inner = { v: 2, from: ana.pk, to: caro.pk, id: "big-1", ts: NOW, exp: NOW + 3600_000, prekey: caroKey.pub.id, kind: "chat", text };
    const json = utf8Encode(JSON.stringify(inner));
    const plain = new Uint8Array(8192);
    new DataView(plain.buffer).setUint32(0, json.length);
    plain.set(json, 4);
    const nonce = randomNonce(24);
    const body = nacl.secretbox(plain, nonce, k2);
    return {
      t: "nido-carry",
      v: 2,
      eid: toHex(randomNonce(16)),
      tag: carryTag(caroKey.pub.id, carryDay(NOW)),
      exp: NOW + 3600_000,
      hops: 3,
      eph: toHex(eph.publicKey),
      kct: toHex(cipherText),
      nonce: toHex(nonce),
      box: toHex(header) + toHex(body),
    };
  }

  it("carryTextLength cuenta puntos de código, no unidades UTF-16", () => {
    expect(carryTextLength("abc")).toBe(3);
    expect(carryTextLength(emoji.repeat(751))).toBe(751);
    expect(emoji.repeat(751).length).toBe(1502);
  });
  it("1.500 emojis se sellan, caben en el cubo mayor y se abren enteros", () => {
    const e = seal(emoji.repeat(1500));
    // El peor caso de la promesa: 1.500 puntos de código de 4 bytes caben en 8 KB.
    expect(e.box.length / 2).toBe(48 + PAD_BUCKETS[PAD_BUCKETS.length - 1] + 16);
    const opened = openCarry(e, [caroKey.secret], caro.pk, sigOf(contactsOfCaro), NOW);
    expect(opened?.text).toBe(emoji.repeat(1500));
  });
  it("1.501 emojis no se sellan; 750 emojis y 750 letras (1.500 puntos) sí", () => {
    expect(() => seal(emoji.repeat(1501))).toThrow();
    expect(() => seal(emoji.repeat(750) + "a".repeat(750))).not.toThrow();
    expect(() => seal(emoji.repeat(750) + "a".repeat(751))).toThrow();
  });
  it("al abrir manda la misma cuenta: un sobre fabricado con 1.501 emojis no se abre y con 1.500 sí", () => {
    expect(openCarry(forgeBig(emoji.repeat(1501)), [caroKey.secret], caro.pk, sigOf(contactsOfCaro), NOW)).toBeNull();
    expect(openCarry(forgeBig(emoji.repeat(1500)), [caroKey.secret], caro.pk, sigOf(contactsOfCaro), NOW)?.text).toBe(emoji.repeat(1500));
  });
});
