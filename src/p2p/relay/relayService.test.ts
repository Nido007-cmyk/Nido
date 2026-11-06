// Mensajes de amigo en amigo, fase 2: el servicio (estado en disco, reglas).
import nacl from "tweetnacl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toHex } from "../crypto";
import { generateCarryPrekey, sealCarry, type CarryEnvelope } from "./carryCrypto";
import {
  forgetOwn,
  handoffFor,
  helloPayload,
  isCarryEnabled,
  memoryKv,
  receive,
  relayFlags,
  relayUsage,
  resetRelay,
  sealOwn,
  setCarryEnabled,
  setRelayKvForTests,
  type RelayKv,
} from "./relayService";

const NOW = 1_800_000_000_000;
function person() {
  const id = nacl.box.keyPair();
  const sign = nacl.sign.keyPair();
  return { pkHex: toHex(id.publicKey), sigPk: toHex(sign.publicKey), signSecretKey: sign.secretKey };
}
const ana = person();
const beto = person();
const caro = person();
const sig = (...ps: Array<ReturnType<typeof person>>) => (pk: string) => ps.find((p) => p.pkHex === pk)?.sigPk ?? null;

/** Un KV por teléfono; `on(x)` cambia de teléfono. */
const kvs = new Map<string, RelayKv>();
let current = "";
function on(p: ReturnType<typeof person>) {
  current = p.pkHex;
  if (!kvs.has(current)) kvs.set(current, memoryKv());
}

beforeEach(() => {
  kvs.clear();
  setRelayKvForTests(() => kvs.get(current) as RelayKv);
});
afterEach(() => setRelayKvForTests(null));

describe("ajustes", () => {
  it("llevar sobres de otros viene apagado", async () => {
    on(beto);
    expect(await isCarryEnabled()).toBe(false);
    await setCarryEnabled(true);
    expect(await isCarryEnabled()).toBe(true);
  });
});

describe("clave de buzón", () => {
  it("se crea una vez, se reutiliza y rota a mitad de vida", async () => {
    on(caro);
    const a = await helloPayload(caro, NOW);
    const b = await helloPayload(caro, NOW + 1000);
    expect(b.prekey.id).toBe(a.prekey.id);
    const c = await helloPayload(caro, NOW + 8 * 24 * 3600 * 1000);
    expect(c.prekey.id).not.toBe(a.prekey.id);
  });
});

describe("tres teléfonos: Ana → Beto → Caro", () => {
  it("Caro recibe por Beto, Ana recibe el acuse, Beto no puede leer", async () => {
    const book = sig(ana, beto, caro);
    /** Dos contactos con sesión se dan su clave de buzón y si llevan sobres. */
    async function hello(x: ReturnType<typeof person>, y: ReturnType<typeof person>) {
      on(x);
      const hx = await helloPayload(x, NOW);
      on(y);
      const hy = await helloPayload(y, NOW);
      await receive(x.pkHex, hx, y, book, NOW);
      on(x);
      await receive(y.pkHex, hy, x, book, NOW);
    }
    on(beto);
    await setCarryEnabled(true);
    await hello(ana, beto);
    await hello(beto, caro);
    await hello(ana, caro); // se conocen, pero no se cruzan

    // Ana no puede hablar con Caro: sella y se lo da a Beto.
    on(ana);
    expect(await sealOwn(ana, caro.pkHex, "msg-1", "chat", "Llegamos bien", NOW)).toBe(true);
    // Aún no lo lleva nadie: sin marca.
    expect(await relayFlags(["msg-1"])).toEqual({});
    const toBeto = await handoffFor(beto.pkHex, NOW);
    expect(await relayFlags(["msg-1"])).toEqual({ "msg-1": "out" });
    expect(toBeto).toHaveLength(1);
    expect(JSON.stringify(toBeto)).not.toContain("Llegamos");

    on(beto);
    expect(await receive(ana.pkHex, { put: toBeto }, beto, book, NOW + 1000)).toEqual({ chats: [], receipts: [], stored: 1 });

    // Beto se cruza con Caro.
    const toCaro = await handoffFor(caro.pkHex, NOW + 3600_000);
    expect(toCaro).toHaveLength(1);
    expect((await relayUsage()).envelopes).toBe(0);

    on(caro);
    const atCaro = await receive(beto.pkHex, { put: toCaro }, caro, book, NOW + 3600_000);
    expect(atCaro.chats).toEqual([{ from: ana.pkHex, id: "msg-1", ts: NOW, kind: "chat", text: "Llegamos bien" }]);
    expect(await relayFlags(["msg-1"])).toEqual({ "msg-1": "in" });

    // El acuse vuelve por el mismo camino.
    expect(await sealOwn(caro, ana.pkHex, "r-1", "receipt", "msg-1", NOW + 3600_000)).toBe(true);
    const back = await handoffFor(beto.pkHex, NOW + 3600_000);
    on(beto);
    await receive(caro.pkHex, { put: back }, beto, book, NOW + 3600_000);
    const toAna = await handoffFor(ana.pkHex, NOW + 7200_000);
    on(ana);
    const atAna = await receive(beto.pkHex, { put: toAna }, ana, book, NOW + 7200_000);
    expect(atAna.receipts).toEqual([{ from: caro.pkHex, id: "msg-1" }]);
  });

  it("si Beto no lleva sobres, no guarda nada (pero sí recibe los suyos)", async () => {
    on(caro);
    const helloCaro = await helloPayload(caro, NOW);
    on(ana);
    await receive(caro.pkHex, helloCaro, ana, sig(beto, caro), NOW);
    await sealOwn(ana, caro.pkHex, "m", "chat", "hola", NOW);
    // Beto dice que no lleva: Ana no le da nada.
    on(beto);
    const helloBeto = await helloPayload(beto, NOW);
    expect(helloBeto.carries).toBe(false);
    on(ana);
    await receive(beto.pkHex, helloBeto, ana, sig(beto, caro), NOW);
    expect(await handoffFor(beto.pkHex, NOW)).toEqual([]);
    // Y aunque se los mandaran, no los guarda.
    const raw = sealCarry({ recipient: helloCaro.prekey, senderPkHex: ana.pkHex, senderSignSecretKey: ana.signSecretKey, id: "z", kind: "chat", text: "x", now: NOW });
    on(beto);
    expect((await receive(ana.pkHex, { put: [raw] }, beto, sig(ana, caro), NOW)).stored).toBe(0);
  });

  it("al llegar directo, el sobre deja de viajar", async () => {
    on(caro);
    const helloCaro = await helloPayload(caro, NOW);
    on(ana);
    await receive(caro.pkHex, helloCaro, ana, sig(beto, caro), NOW);
    await sealOwn(ana, caro.pkHex, "m", "chat", "hola", NOW);
    expect((await relayUsage()).envelopes).toBe(1);
    await forgetOwn("m");
    expect((await relayUsage()).envelopes).toBe(0);
  });

  it("sin clave de buzón del destinatario no se sella", async () => {
    on(ana);
    expect(await sealOwn(ana, caro.pkHex, "m", "chat", "hola", NOW)).toBe(false);
  });
});

describe("entradas hostiles (lección de Bridgefy: un mensaje malo no tumba nada)", () => {
  it("basura, tipos raros, montones y desconocidos: nunca lanza ni guarda", async () => {
    on(beto);
    await setCarryEnabled(true);
    const junk: unknown[] = [
      null,
      undefined,
      42,
      "x",
      [],
      { put: "no" },
      { put: [null, 1, "a", {}, { t: "nido-carry" }] },
      { prekey: { id: "zz" } },
      { prekey: null, carries: "sí" },
      { put: Array.from({ length: 10_000 }, () => ({ t: "nido-carry", v: 1 })) },
      JSON.parse('{"__proto__":{"polluted":true},"put":[]}'),
    ];
    for (const j of junk) {
      const r = await receive(ana.pkHex, j, beto, sig(ana), NOW);
      expect(r.stored).toBe(0);
      expect(r.chats).toEqual([]);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((await relayUsage()).envelopes).toBe(0);
  });

  it("de quien no es contacto no se acepta nada", async () => {
    on(caro);
    const helloCaro = await helloPayload(caro, NOW);
    const env: CarryEnvelope = sealCarry({ recipient: helloCaro.prekey, senderPkHex: ana.pkHex, senderSignSecretKey: ana.signSecretKey, id: "m", kind: "chat", text: "x", now: NOW });
    on(beto);
    await setCarryEnabled(true);
    const stranger = person();
    expect(await receive(stranger.pkHex, { put: [env] }, beto, sig(ana, caro), NOW)).toEqual({ chats: [], receipts: [], stored: 0 });
  });

  it("una clave de buzón falsificada se ignora", async () => {
    const mallory = person();
    const fake = generateCarryPrekey(caro.pkHex, mallory.signSecretKey, NOW).pub;
    on(ana);
    await receive(caro.pkHex, { prekey: fake }, ana, sig(caro), NOW);
    expect(await sealOwn(ana, caro.pkHex, "m", "chat", "hola", NOW)).toBe(false);
  });

  it("un mismo contacto no pasa de 30 sobres por entrega", async () => {
    on(caro);
    const helloCaro = await helloPayload(caro, NOW);
    const many = Array.from({ length: 40 }, (_, i) =>
      sealCarry({ recipient: helloCaro.prekey, senderPkHex: ana.pkHex, senderSignSecretKey: ana.signSecretKey, id: `m${i}`, kind: "chat", text: "x", now: NOW }),
    );
    on(beto);
    await setCarryEnabled(true);
    expect((await receive(ana.pkHex, { put: many }, beto, sig(ana, caro), NOW)).stored).toBe(30);
  });
});

describe("borrar", () => {
  it("resetRelay lo tira todo, y apagar tira los sobres de otros", async () => {
    on(caro);
    const helloCaro = await helloPayload(caro, NOW);
    const env = sealCarry({ recipient: helloCaro.prekey, senderPkHex: ana.pkHex, senderSignSecretKey: ana.signSecretKey, id: "m", kind: "chat", text: "x", now: NOW });
    on(beto);
    await setCarryEnabled(true);
    await receive(ana.pkHex, { put: [env] }, beto, sig(ana, caro), NOW);
    expect((await relayUsage()).envelopes).toBe(1);
    await setCarryEnabled(false);
    expect((await relayUsage()).envelopes).toBe(0);
    await setCarryEnabled(true);
    await resetRelay();
    expect(await isCarryEnabled()).toBe(false);
  });
});
