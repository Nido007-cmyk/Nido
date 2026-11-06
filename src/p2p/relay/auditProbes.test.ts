// SONDAS ADVERSARIAS DE LA AUDITORÍA DEL 2026-11-06, convertidas en
// pruebas permanentes (Módulo 6 del paquete de arreglos del relevo).
// Atacan las promesas publicadas de docs/RELAY.md que la suite original
// no cubría. Solo dos sondas fueron reescritas, y cada una lo dice en su
// sitio: la de restauración (la cambió el Módulo 1, H-1) y la de la
// cuenta UTF-16 (la cambió el Módulo 3, H-4). A las dos sondas del
// almacén que sellan 200 sobres se les subió el timeout porque sellar
// 200 sobres con ML-KEM en una máquina lenta pasa de los 5 s por
// defecto; sus afirmaciones no cambian.
import nacl from "tweetnacl";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { fromHex, hkdfSha512, randomNonce, sha512, toHex, utf8Encode } from "../crypto";
import { kemEncapsulate } from "../pq";
import {
  carryDay,
  carryTag,
  envelopeBytes,
  generateCarryPrekey,
  openCarry,
  sealCarry,
  verifyCarryPrekey,
  MAX_ENVELOPE_TTL_MS,
  PAD_BUCKETS,
  PREKEY_TTL_MS,
  type CarryEnvelope,
} from "./carryCrypto";
import { CarryStore, STORE_LIMITS } from "./carryStore";
import { memoryKv, receive, sealOwn, setCarryEnabled, setRelayKvForTests, helloPayload, type RelayKv } from "./relayService";

const NOW = 1_800_000_000_000;
const H = 3600_000;

function person() {
  const id = nacl.box.keyPair();
  const sign = nacl.sign.keyPair();
  return { pk: toHex(id.publicKey), sigPk: toHex(sign.publicKey), signSk: sign.secretKey, idSk: id.secretKey };
}
const ana = person();
const beto = person();
const caro = person();
const dario = person();
const caroKey = generateCarryPrekey(caro.pk, caro.signSk, NOW);
const anaKey = generateCarryPrekey(ana.pk, ana.signSk, NOW);
const contactsOfCaro = (pk: string) => [ana.pk, beto.pk].includes(pk);
const contactsOfAna = (pk: string) => [caro.pk, beto.pk, dario.pk].includes(pk);

const sealToCaro = (text: string, over: Partial<Parameters<typeof sealCarry>[0]> = {}): CarryEnvelope =>
  sealCarry({ recipient: caroKey.pub, senderPkHex: ana.pk, senderSecretKey: ana.idSk, id: "m-1", kind: "chat", text, now: NOW, ...over });

describe("P3 acolchado: el tamaño del sobre solo revela el cubo", () => {
  it("para textos de 1 a 1500 letras solo existen 4 tamaños de sobre y dentro de un cubo el tamaño es idéntico", () => {
    const byBucket = new Map<number, number>();
    const allSizes = new Set<number>();
    for (const n of [1, 50, 200, 400, 700, 900, 1000, 1100, 1500]) {
      const e = sealToCaro("a".repeat(n));
      const bucket = PAD_BUCKETS.find((x) => (e.box.length / 2) <= 48 + x + 16) ?? 0;
      const b = envelopeBytes(e);
      allSizes.add(b);
      if (byBucket.has(bucket)) expect(byBucket.get(bucket)).toBe(b); // mismo cubo, mismo tamaño
      byBucket.set(bucket, b);
    }
    expect(allSizes.size).toBeLessThanOrEqual(4);
    // 1 letra y 400 letras: mismo tamaño exacto de sobre serializado.
    expect(envelopeBytes(sealToCaro("x"))).toBe(envelopeBytes(sealToCaro("a".repeat(400))));
  });

  it("las claves de fuera son exactamente las admitidas en docs/RELAY.md (ni remitente ni destinatario)", () => {
    const e = sealToCaro("hola");
    expect(Object.keys(e).sort()).toEqual(["box", "eid", "eph", "exp", "hops", "kct", "nonce", "t", "tag", "v"]);
  });
});

describe("P5 el borde de 1500", () => {
  it("1500 unidades se sellan; 1501 lanzan al sellar", () => {
    expect(() => sealToCaro("a".repeat(1500))).not.toThrow();
    expect(() => sealToCaro("a".repeat(1501))).toThrow();
  });

  // REESCRITA por el Módulo 3 (H-4, salida A): antes afirmaba que la
  // cuenta era en unidades UTF-16 y que 751 emojis ya no viajaban.
  // Ahora la cuenta es por puntos de código, como dice la letra
  // publicada: 751 emojis viajan y 1.501 puntos de código no.
  it("la cuenta es por puntos de código: 751 emojis viajan; 1.501 puntos de código no", () => {
    const emojis751 = "\u{1F600}".repeat(751); // 751 caracteres, 1502 unidades UTF-16
    expect(emojis751.length).toBe(1502);
    expect(() => sealToCaro(emojis751)).not.toThrow();
    expect(() => sealToCaro("\u{1F600}".repeat(1501))).toThrow();
    const emojis750 = "\u{1F600}".repeat(750);
    expect(() => sealToCaro(emojis750)).not.toThrow();
  });
});

describe("P2 negabilidad también en los acuses", () => {
  it("la propia destinataria del acuse puede fabricar un acuse «de Caro» indistinguible (con su clave de buzón)", () => {
    // Ana fabrica un sobre que su propio teléfono aceptaría como acuse de
    // Caro, usando SOLO su clave secreta de buzón y la identidad pública
    // de Caro: dhS = buzón_secreto(Ana) x identidad(Caro), el mismo valor
    // que Caro calcularía con su identidad secreta. Sin firma: no prueba nada.
    const h32 = (b: Uint8Array) => sha512(b).slice(0, 32);
    const rX = fromHex(anaKey.pub.x25519);
    const rKem = fromHex(anaKey.pub.kem);
    const eph = nacl.box.keyPair();
    const { cipherText, sharedSecret } = kemEncapsulate(rKem);
    const ctx = toHex(h32(utf8Encode(`nido-carry-ctx-v2|${anaKey.pub.id}|${toHex(rX)}|${toHex(h32(rKem))}|${toHex(eph.publicKey)}|${toHex(h32(cipherText))}`)));
    const dhE = nacl.scalarMult(eph.secretKey, rX);
    const ikm = new Uint8Array(64);
    ikm.set(dhE, 0);
    ikm.set(sharedSecret, 32);
    const hk = hkdfSha512(utf8Encode("nido-carry-v2"), ikm, utf8Encode(`nido-carry-hdr-v2|${ctx}`), 64);
    const header = nacl.secretbox(fromHex(caro.pk), new Uint8Array(24), hk.slice(0, 32));
    const dhS = nacl.scalarMult(anaKey.secret.x25519Sk, fromHex(caro.pk));
    const k2 = hkdfSha512(hk.slice(32, 64), dhS, utf8Encode(`nido-carry-body-v2|${ctx}|${caro.pk}`), 32);
    const inner = { v: 2, from: caro.pk, to: ana.pk, id: "r-falso", ts: NOW, exp: NOW + H, prekey: anaKey.pub.id, kind: "receipt", text: "msg-1" };
    const json = utf8Encode(JSON.stringify(inner));
    const plain = new Uint8Array(1024);
    new DataView(plain.buffer).setUint32(0, json.length);
    plain.set(json, 4);
    const nonce = randomNonce(24);
    const body = nacl.secretbox(plain, nonce, k2);
    const forged: CarryEnvelope = {
      t: "nido-carry", v: 2, eid: toHex(randomNonce(16)), tag: carryTag(anaKey.pub.id, carryDay(NOW)),
      exp: NOW + H, hops: 3, eph: toHex(eph.publicKey), kct: toHex(cipherText), nonce: toHex(nonce),
      box: toHex(header) + toHex(body),
    };
    const opened = openCarry(forged, [anaKey.secret], ana.pk, contactsOfAna, NOW);
    expect(opened).toEqual({ from: caro.pk, id: "r-falso", ts: NOW, exp: NOW + H, kind: "receipt", text: "msg-1" });
  });
});

describe("P1 el mensajero retoca lo de fuera", () => {
  it("caducidad y saltos de fuera inflados no cambian lo que vale: manda la caducidad autenticada de dentro", () => {
    const e = sealToCaro("hola", { ttlMs: H });
    const touched = { ...e, exp: NOW + 365 * 24 * H, hops: 3 };
    const opened = openCarry(touched, [caroKey.secret], caro.pk, contactsOfCaro, NOW + 30 * 60_000);
    expect(opened?.exp).toBe(NOW + H);
    // Y pasado el plazo de dentro, aunque fuera diga un año, no se abre.
    expect(openCarry(touched, [caroKey.secret], caro.pk, contactsOfCaro, NOW + H + 1)).toBeNull();
  });

  it("el eid no va autenticado: el mismo sobre con otro eid se abre igual (la deduplicación vive en el interior)", () => {
    const e = sealToCaro("hola");
    const rebadged = { ...e, eid: toHex(randomNonce(16)) };
    expect(openCarry(rebadged, [caroKey.secret], caro.pk, contactsOfCaro, NOW)?.text).toBe("hola");
    const st = new CarryStore();
    expect(st.accept(e, beto.pk, NOW)).toBe("stored");
    const st2 = new CarryStore();
    st2.accept(e, beto.pk, NOW);
    expect(st2.accept(rebadged, beto.pk, NOW)).toBe("stored"); // otro teléfono lo ve como nuevo
  });

  it("cambiar la etiqueta por la de OTRA clave de buzón de la misma destinataria lo invalida (contexto atado a la clave)", () => {
    const caroKey2 = generateCarryPrekey(caro.pk, caro.signSk, NOW);
    const e = sealToCaro("hola");
    const swapped = { ...e, tag: carryTag(caroKey2.pub.id, carryDay(NOW)) };
    // La etiqueta manda a la clave 2, pero el contexto criptográfico es el de la clave 1.
    expect(openCarry(swapped, [caroKey.secret, caroKey2.secret], caro.pk, contactsOfCaro, NOW)).toBeNull();
  });
});

describe("P7 bordes de la clave de buzón", () => {
  it("vida de exactamente 14 días vale; 14 días y 1 ms no", () => {
    const exact = generateCarryPrekey(caro.pk, caro.signSk, NOW).pub;
    expect(exact.expiresAt - exact.createdAt).toBe(PREKEY_TTL_MS);
    expect(verifyCarryPrekey(exact, caro.pk, caro.sigPk, NOW)).toBe(true);
    // Emitida 1 ms antes con la misma caducidad: la vida supera el tope.
    const long = generateCarryPrekey(caro.pk, caro.signSk, NOW - 1).pub;
    const shifted = { ...long, expiresAt: NOW - 1 + PREKEY_TTL_MS + 1 };
    // Sin refirmar no vale ni por la firma; la comprobación de vida va antes.
    expect(verifyCarryPrekey(shifted, caro.pk, caro.sigPk, NOW)).toBe(false);
  });

  it("creada hasta 10 minutos en el futuro vale (margen de reloj); más allá no", () => {
    const ahead9 = generateCarryPrekey(caro.pk, caro.signSk, NOW + 9 * 60_000).pub;
    expect(verifyCarryPrekey(ahead9, caro.pk, caro.sigPk, NOW)).toBe(true);
    const ahead11 = generateCarryPrekey(caro.pk, caro.signSk, NOW + 11 * 60_000).pub;
    expect(verifyCarryPrekey(ahead11, caro.pk, caro.sigPk, NOW)).toBe(false);
  });

  it("un sobre sellado hoy se abre con la etiqueta de hace 3 días (ventana de reconocimiento) pero su ts futuro más allá del margen lo mata", () => {
    const future = sealCarry({ recipient: caroKey.pub, senderPkHex: ana.pk, senderSecretKey: ana.idSk, id: "m-f", kind: "chat", text: "del futuro", now: NOW + 24 * H });
    // La etiqueta es de mañana (dentro de la ventana), pero ts supera el margen de 10 min.
    expect(openCarry(future, [caroKey.secret], caro.pk, contactsOfCaro, NOW)).toBeNull();
  });
});

describe("P4 topes del almacén", () => {
  it("el tope de 2 MB manda antes que el de 200 con sobres del cubo mayor", () => {
    const st = new CarryStore();
    const sources = ["a", "b", "c", "d", "e", "f", "g"].map((c) => c.repeat(64));
    let accepted = 0;
    let last: string = "";
    for (let i = 0; i < 200; i++) {
      const e = sealToCaro("漢".repeat(1500), { id: `bulk-${i}` }); // 1500 unidades, ~4500 bytes: cubo de 8192
      const r = st.accept(e, sources[i % sources.length], NOW);
      if (r === "stored") accepted++;
      last = r;
      if (r === "full") break;
    }
    expect(last).toBe("full");
    expect(accepted).toBeLessThan(200);
    expect(st.bytes()).toBeLessThanOrEqual(STORE_LIMITS.maxBytes);
    expect(st.size()).toBe(accepted);
  }, 120_000);

  it("con el almacén lleno de sobres ajenos, ni mi propio sobre entra (se queda en solo directo)", () => {
    const st = new CarryStore();
    const sources = ["a", "b", "c", "d", "e", "f", "g"].map((c) => c.repeat(64));
    for (let i = 0; i < 200; i++) {
      expect(st.accept(sealToCaro("hola", { id: `f-${i}` }), sources[i % sources.length], NOW)).toBe("stored");
    }
    expect(st.addOwn(sealToCaro("mio", { id: "own-1" }), NOW)).toBe("full");
  }, 120_000);

  it("borde de caducidad en el almacén: exp == ahora ya es tarde; exp == ahora+1 entra y el barrido lo tira al llegar", () => {
    const st = new CarryStore();
    const dead = { ...sealToCaro("hola", { id: "b-1" }), exp: NOW };
    expect(st.accept(dead, beto.pk, NOW)).toBe("expired");
    const alive = { ...sealToCaro("hola", { id: "b-2" }), exp: NOW + 1 };
    expect(st.accept(alive, beto.pk, NOW)).toBe("stored");
    expect(st.sweep(NOW + 1)).toBe(1);
  });

  // REESCRITA por el Módulo 1 (H-1): antes afirmaba que restore() dejaba
  // pasar copias y caducidad infladas en el estado guardado. Ahora
  // restore() reaplica los topes de put(): afirma el comportamiento
  // nuevo. La restauración recibe el ahora explícito para no depender
  // del reloj de la máquina.
  it("restore() reaplica los topes: copias y caducidad infladas en el estado guardado no sobreviven", () => {
    const st = new CarryStore();
    const e = sealToCaro("hola", { id: "r-1" });
    st.restore([{ env: { ...e, exp: NOW + 10 * 365 * 24 * H }, from: beto.pk, copiesLeft: 1_000_000, givenTo: [] }], [], NOW);
    // Caducidad: recortada a llegada + 72 h; a las 73 h se barre.
    expect(st.sweep(NOW + 73 * H)).toBe(1);
    expect(st.has(e.eid)).toBe(false);
    // Copias: reparte como mucho a carrierCopies (3) mensajeros distintos.
    const st2 = new CarryStore();
    st2.restore([{ env: e, from: beto.pk, copiesLeft: 1_000_000, givenTo: [] }], [], NOW);
    let given = 0;
    for (let i = 0; i < 8; i++) {
      const peer = String(i).repeat(64).replace(/./g, (c) => "0123456789abcdef"[Number(c)]);
      const plan = st2.planHandoff(peer, new Set<string>(), true, NOW);
      if (plan.carry.length) given++;
      st2.commitHandoff(peer, [], plan.carry.map((x) => x.eid));
    }
    expect(given).toBeLessThanOrEqual(STORE_LIMITS.carrierCopies);
  });
});

/* ------------------------------------------------------- nivel servicio */

const kvs = new Map<string, RelayKv>();
let current = "";
function on(p: { pk: string }) {
  current = p.pk;
  if (!kvs.has(current)) kvs.set(current, memoryKv());
}
const bookMap = new Map([
  [ana.pk, ana.sigPk],
  [beto.pk, beto.sigPk],
  [caro.pk, caro.sigPk],
  [dario.pk, dario.sigPk],
]);
const book = (pk: string) => bookMap.get(pk) ?? null;
const meOf = (p: typeof ana) => ({ pkHex: p.pk, signSecretKey: p.signSk, idSecretKey: p.idSk });

beforeEach(() => {
  kvs.clear();
  setRelayKvForTests(() => kvs.get(current) as RelayKv);
});
afterEach(() => setRelayKvForTests(null));

async function hello(x: typeof ana, y: typeof ana, now: number) {
  on(x);
  const hx = await helloPayload(meOf(x), now);
  on(y);
  const hy = await helloPayload(meOf(y), now);
  await receive(x.pk, hx, meOf(y), book, now);
  on(x);
  await receive(y.pk, hy, meOf(x), book, now);
}

describe("P5/P6/P8 a nivel de servicio", () => {
  it("sealOwn: 1500 letras viajan, 1501 no (sin lanzar)", async () => {
    await hello(ana, caro, NOW);
    on(ana);
    expect(await sealOwn(meOf(ana), caro.pk, "ok-1500", "chat", "a".repeat(1500), NOW)).toBe(true);
    expect(await sealOwn(meOf(ana), caro.pk, "no-1501", "chat", "a".repeat(1501), NOW)).toBe(false);
  });

  it("replay: el mismo sobre entregado dos veces solo abre la primera; el mismo acuse, igual", async () => {
    on(beto);
    await setCarryEnabled(true);
    await hello(ana, beto, NOW);
    await hello(beto, caro, NOW);
    await hello(ana, caro, NOW);
    on(ana);
    expect(await sealOwn(meOf(ana), caro.pk, "msg-r", "chat", "hola", NOW)).toBe(true);
    const { handoffFor, confirmHandoff } = await import("./relayService");
    const h1 = await handoffFor(beto.pk, NOW);
    await confirmHandoff(beto.pk, h1.delivered, h1.carried);
    on(beto);
    await receive(ana.pk, { put: h1.envelopes }, meOf(beto), book, NOW);
    const h2 = await handoffFor(caro.pk, NOW);
    await confirmHandoff(caro.pk, h2.delivered, h2.carried);
    on(caro);
    const first = await receive(beto.pk, { put: h2.envelopes }, meOf(caro), book, NOW);
    expect(first.chats).toHaveLength(1);
    const second = await receive(beto.pk, { put: h2.envelopes }, meOf(caro), book, NOW);
    expect(second.chats).toEqual([]);
    expect(second.stored).toBe(0);

    // El acuse de Caro vuelve por Beto; entregarlo dos veces a Ana solo vale la primera.
    on(caro);
    expect(await sealOwn(meOf(caro), ana.pk, "r-r", "receipt", "msg-r", NOW)).toBe(true);
    const back = await handoffFor(beto.pk, NOW);
    await confirmHandoff(beto.pk, back.delivered, back.carried);
    on(beto);
    await receive(caro.pk, { put: back.envelopes }, meOf(beto), book, NOW);
    const toAna = await handoffFor(ana.pk, NOW);
    await confirmHandoff(ana.pk, toAna.delivered, toAna.carried);
    on(ana);
    const r1 = await receive(beto.pk, { put: toAna.envelopes }, meOf(ana), book, NOW);
    expect(r1.receipts).toEqual([{ from: caro.pk, id: "msg-r" }]);
    const r2 = await receive(beto.pk, { put: toAna.envelopes }, meOf(ana), book, NOW);
    expect(r2.receipts).toEqual([]);
  });

  it("un acuse fabricado por OTRO contacto para un mensaje que no era suyo pasa el servicio (el amarre vive en el messenger)", async () => {
    await hello(ana, dario, NOW);
    await hello(ana, caro, NOW);
    // Ana tiene un mensaje para Caro con id conocido por Dario en esta sonda;
    // en la realidad el id es un UUID aleatorio que Dario no conoce.
    on(dario);
    expect(await sealOwn(meOf(dario), ana.pk, "r-x", "receipt", "msg-para-caro", NOW)).toBe(true);
    const { handoffFor, confirmHandoff } = await import("./relayService");
    const h = await handoffFor(ana.pk, NOW);
    await confirmHandoff(ana.pk, h.delivered, h.carried);
    on(ana);
    const res = await receive(dario.pk, { put: h.envelopes }, meOf(ana), book, NOW);
    // El servicio lo entrega tal cual; quien lo rechaza es messenger.handleCarry
    // exigiendo row.peerPk === receipt.from (verificado por lectura de código).
    expect(res.receipts).toEqual([{ from: dario.pk, id: "msg-para-caro" }]);
  });

  it("de un no-contacto no entra ni el saludo ni un sobre válido, aunque lleve sobres activado", async () => {
    on(caro);
    await setCarryEnabled(true);
    const stranger = person();
    const env = sealCarry({ recipient: caroKey.pub, senderPkHex: stranger.pk, senderSecretKey: stranger.idSk, id: "s-1", kind: "chat", text: "spam", now: NOW });
    const res = await receive(stranger.pk, { put: [env] }, meOf(caro), book, NOW);
    expect(res).toEqual({ chats: [], receipts: [], stored: 0 });
  });
});
