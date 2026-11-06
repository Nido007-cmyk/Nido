// Mensajes de amigo en amigo, fase 2: el servicio (estado en disco, reglas).
import nacl from "tweetnacl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomNonce, toHex } from "../crypto";
import { generateCarryPrekey, sealCarry, type CarryEnvelope } from "./carryCrypto";
import {
  confirmHandoff,
  forgetOwn,
  handoffFor,
  helloFor,
  helloPayload,
  isCarryEnabled,
  markArrivedViaFriends,
  markHelloSent,
  memoryKv,
  receive,
  rememberOpened,
  relayFlags,
  relayGeneration,
  relayUsage,
  resetRelay,
  sealOwn,
  sealOwnDetailed,
  setCarryEnabled,
  setRelayKvForTests,
  type RelayKv,
} from "./relayService";

const NOW = 1_800_000_000_000;
function person() {
  const id = nacl.box.keyPair();
  const sign = nacl.sign.keyPair();
  return { pkHex: toHex(id.publicKey), sigPk: toHex(sign.publicKey), signSecretKey: sign.secretKey, idSecretKey: id.secretKey };
}
const ana = person();
const beto = person();
const caro = person();
const sig = (...ps: Array<ReturnType<typeof person>>) => (pk: string) => ps.find((p) => p.pkHex === pk)?.sigPk ?? null;

/** Lo que el teléfono actual da a `peer` y que sale de verdad (plan + confirmación). */
async function give(peer: string, now: number): Promise<CarryEnvelope[]> {
  const h = await handoffFor(peer, now);
  await confirmHandoff(peer, h.delivered, h.carried);
  return h.envelopes;
}

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
    const toBeto = await give(beto.pkHex, NOW);
    expect(await relayFlags(["msg-1"])).toEqual({ "msg-1": "out" });
    expect(toBeto).toHaveLength(1);
    expect(JSON.stringify(toBeto)).not.toContain("Llegamos");

    on(beto);
    expect(await receive(ana.pkHex, { put: toBeto }, beto, book, NOW + 1000)).toEqual({ chats: [], receipts: [], stored: 1 });

    // Beto se cruza con Caro.
    const toCaro = await give(caro.pkHex, NOW + 3600_000);
    expect(toCaro).toHaveLength(1);
    expect((await relayUsage()).envelopes).toBe(0);

    on(caro);
    const atCaro = await receive(beto.pkHex, { put: toCaro }, caro, book, NOW + 3600_000);
    expect(atCaro.chats).toEqual([{ from: ana.pkHex, id: "msg-1", ts: NOW, exp: NOW + 72 * 3600 * 1000, kind: "chat", text: "Llegamos bien" }]);
    // La marca la pone quien lo guarda como nuevo (el messenger).
    expect(await relayFlags(["msg-1"])).toEqual({});
    await markArrivedViaFriends("msg-1");
    expect(await relayFlags(["msg-1"])).toEqual({ "msg-1": "in" });

    // El acuse vuelve por el mismo camino.
    expect(await sealOwn(caro, ana.pkHex, "r-1", "receipt", "msg-1", NOW + 3600_000)).toBe(true);
    const back = await give(beto.pkHex, NOW + 3600_000);
    on(beto);
    await receive(caro.pkHex, { put: back }, beto, book, NOW + 3600_000);
    const toAna = await give(ana.pkHex, NOW + 7200_000);
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
    expect(await give(beto.pkHex, NOW)).toEqual([]);
    // Y aunque se los mandaran, no los guarda.
    const raw = sealCarry({ recipient: helloCaro.prekey, senderPkHex: ana.pkHex, senderSecretKey: ana.idSecretKey, id: "z", kind: "chat", text: "x", now: NOW });
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

  it("al cruzarse con el destinatario, mi sobre no se le da (el mensaje va directo)", async () => {
    on(caro);
    const helloCaro = await helloPayload(caro, NOW);
    on(ana);
    await receive(caro.pkHex, { ...helloCaro, carries: true }, ana, sig(beto, caro), NOW);
    await sealOwn(ana, caro.pkHex, "m", "chat", "hola", NOW);
    expect(await give(caro.pkHex, NOW)).toEqual([]);
    // Pero un acuse mío sí se le entrega (no tiene otro camino).
    expect(await sealOwn(ana, caro.pkHex, "r", "receipt", "x", NOW)).toBe(true);
    expect(await give(caro.pkHex, NOW)).toHaveLength(1);
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
    const env: CarryEnvelope = sealCarry({ recipient: helloCaro.prekey, senderPkHex: ana.pkHex, senderSecretKey: ana.idSecretKey, id: "m", kind: "chat", text: "x", now: NOW });
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
      sealCarry({ recipient: helloCaro.prekey, senderPkHex: ana.pkHex, senderSecretKey: ana.idSecretKey, id: `m${i}`, kind: "chat", text: "x", now: NOW }),
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
    const env = sealCarry({ recipient: helloCaro.prekey, senderPkHex: ana.pkHex, senderSecretKey: ana.idSecretKey, id: "m", kind: "chat", text: "x", now: NOW });
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

describe("disco", () => {
  it("si la lectura falla, la operación se cancela y no borra lo guardado", async () => {
    on(caro);
    const first = await helloPayload(caro, NOW);
    const real = kvs.get(caro.pkHex)!;
    let broken = true;
    kvs.set(caro.pkHex, {
      get: async (k) => {
        if (broken) throw new Error("base bloqueada");
        return real.get(k);
      },
      setMany: (e) => real.setMany(e),
    });
    await expect(helloPayload(caro, NOW + 1000)).rejects.toThrow();
    await expect(setCarryEnabled(true)).rejects.toThrow();
    broken = false;
    // La clave de buzón sigue siendo la misma (no se creó otra encima de un estado vacío).
    expect((await helloPayload(caro, NOW + 2000)).prekey.id).toBe(first.prekey.id);
  });

  it("datos dañados o con tipos raros: se ignoran sin romper nada", async () => {
    on(beto);
    await kvs.get(beto.pkHex)!.setMany([
      ["relay_state_v1", JSON.stringify({ enabled: "sí", mine: [1, null, { pub: 3 }], peers: { x: 5, y: { prekeys: "no" } }, held: [{ env: 1 }], seen: [7, ["a", 1]], own: { m: 3 } })],
      ["relay_flags_v1", "{no es json"],
    ]);
    expect(await isCarryEnabled()).toBe(false);
    expect(await relayUsage()).toEqual({ envelopes: 0, bytes: 0, enabled: false });
    expect(await relayFlags(["m"])).toEqual({});
    const h = await helloPayload(beto, NOW);
    expect(h.prekey.owner).toBe(beto.pkHex.toLowerCase());
  });
});

describe("entregar sin perder nada", () => {
  it("si el envío falla (no se confirma), el sobre sigue aquí para la próxima vez", async () => {
    on(caro);
    const helloCaro = await helloPayload(caro, NOW);
    const env = sealCarry({ recipient: helloCaro.prekey, senderPkHex: ana.pkHex, senderSecretKey: ana.idSecretKey, id: "m", kind: "chat", text: "x", now: NOW });
    on(beto);
    await setCarryEnabled(true);
    await receive(caro.pkHex, helloCaro, beto, sig(ana, caro), NOW);
    await receive(ana.pkHex, { put: [env] }, beto, sig(ana, caro), NOW);
    const plan = await handoffFor(caro.pkHex, NOW);
    expect(plan.delivered).toEqual([env.eid]);
    // Se cortó la conexión antes de mandarlo: no se confirma.
    expect((await relayUsage()).envelopes).toBe(1);
    expect((await give(caro.pkHex, NOW)).map((e) => e.eid)).toEqual([env.eid]);
    expect((await relayUsage()).envelopes).toBe(0);
  });
});

describe("saludo", () => {
  it("solo hace falta repetirlo si cambió algo o pasó un día", async () => {
    on(ana);
    const h1 = await helloFor(ana, NOW, beto.pkHex);
    expect(h1.needed).toBe(true);
    await markHelloSent(beto.pkHex, h1, NOW);
    expect((await helloFor(ana, NOW + 1000, beto.pkHex)).needed).toBe(false);
    // Cambia el ajuste: hay que decírselo.
    await setCarryEnabled(true);
    expect((await helloFor(ana, NOW + 2000, beto.pkHex)).needed).toBe(true);
    await markHelloSent(beto.pkHex, { prekey: h1.prekey, carries: true }, NOW + 2000);
    expect((await helloFor(ana, NOW + 3000, beto.pkHex)).needed).toBe(false);
    // Un día después, se repite por si el último se perdió.
    expect((await helloFor(ana, NOW + 2000 + 24 * 3600 * 1000, beto.pkHex)).needed).toBe(true);
  });

  it("la generación sube cuando hay algo nuevo que dar, y no con un saludo normal", async () => {
    on(caro);
    const helloCaro = await helloPayload(caro, NOW);
    on(ana);
    const g0 = relayGeneration();
    await helloFor(ana, NOW);
    await helloFor(ana, NOW + 1);
    expect(relayGeneration()).toBe(g0 + 1); // la primera crea la clave
    await receive(caro.pkHex, helloCaro, ana, sig(caro), NOW);
    expect(relayGeneration()).toBe(g0 + 2);
    await sealOwn(ana, caro.pkHex, "m", "chat", "hola", NOW);
    expect(relayGeneration()).toBe(g0 + 3);
  });
});

describe("revisión de seguridad", () => {
  it("el mismo mensaje en otro sobre (otro eid) no se acepta dos veces", async () => {
    on(caro);
    const helloCaro = await helloPayload(caro, NOW);
    const mk = () => sealCarry({ recipient: helloCaro.prekey, senderPkHex: ana.pkHex, senderSecretKey: ana.idSecretKey, id: "same", kind: "chat", text: "hola", now: NOW });
    const first = await receive(beto.pkHex, { put: [mk()] }, caro, sig(ana, beto), NOW);
    expect(first.chats).toHaveLength(1);
    const again = await receive(beto.pkHex, { put: [mk()] }, caro, sig(ana, beto), NOW + 1000);
    expect(again.chats).toHaveLength(0);
  });

  it("un sobre con mi etiqueta que no se abre (no-contacto, manipulado) no se guarda para llevar", async () => {
    on(caro);
    await setCarryEnabled(true);
    const helloCaro = await helloPayload(caro, NOW);
    const stranger = person();
    const env = sealCarry({ recipient: helloCaro.prekey, senderPkHex: stranger.pkHex, senderSecretKey: stranger.idSecretKey, id: "s", kind: "chat", text: "spam", now: NOW });
    const r = await receive(beto.pkHex, { put: [env] }, caro, sig(ana, beto), NOW);
    expect(r).toEqual({ chats: [], receipts: [], stored: 0 });
    expect((await relayUsage()).envelopes).toBe(0);
  });
});

describe("el borde de 1.500 en el servicio cuenta puntos de código (H-4)", () => {
  it("sealOwn: 751 emojis viajan (751 puntos de código); 1.501 no", async () => {
    const book = sig(ana, beto, caro);
    on(ana);
    const ha = await helloPayload(ana, NOW);
    on(caro);
    const hc = await helloPayload(caro, NOW);
    await receive(ana.pkHex, ha, caro, book, NOW);
    on(ana);
    await receive(caro.pkHex, hc, ana, book, NOW);
    const emoji = "\u{1F600}";
    expect(await sealOwn(ana, caro.pkHex, "e-751", "chat", emoji.repeat(751), NOW)).toBe(true);
    expect(await sealOwn(ana, caro.pkHex, "e-1500", "chat", emoji.repeat(1500), NOW)).toBe(true);
    expect(await sealOwn(ana, caro.pkHex, "e-1501", "chat", emoji.repeat(1501), NOW)).toBe(false);
  });
});

describe("la causa de no sellar se distingue (H-5)", () => {
  async function helloAnaCaro() {
    const book = sig(ana, beto, caro);
    on(ana);
    const ha = await helloPayload(ana, NOW);
    on(caro);
    const hc = await helloPayload(caro, NOW);
    await receive(ana.pkHex, ha, caro, book, NOW);
    on(ana);
    await receive(caro.pkHex, hc, ana, book, NOW);
    return hc;
  }
  it("sin clave de buzón es no_prekey; demasiado largo es too_long; con todo en orden, sealed", async () => {
    on(ana);
    expect(await sealOwnDetailed(ana, caro.pkHex, "x-1", "chat", "hola", NOW)).toBe("no_prekey");
    expect(await sealOwnDetailed(ana, caro.pkHex, "x-2", "chat", "a".repeat(1501), NOW)).toBe("too_long");
    await helloAnaCaro();
    expect(await sealOwnDetailed(ana, caro.pkHex, "x-3", "chat", "hola", NOW)).toBe("sealed");
  });
  it("con el almacén lleno de sobres ajenos, la causa es store_full (y sealOwn sigue devolviendo false)", async () => {
    const hc = await helloAnaCaro();
    const base = sealCarry({ recipient: hc.prekey, senderPkHex: beto.pkHex, senderSecretKey: beto.idSecretKey, id: "bulk", kind: "chat", text: "hola", now: NOW });
    const sources = ["a", "b", "c", "d", "e", "f", "g"].map((c) => c.repeat(64));
    const held = Array.from({ length: 210 }, (_, i) => ({
      env: { ...base, eid: toHex(randomNonce(16)) },
      from: sources[i % sources.length],
      copiesLeft: 3,
      givenTo: [] as string[],
      arrivedAt: NOW,
    }));
    const kvAna = kvs.get(ana.pkHex) as RelayKv;
    const state = JSON.parse((await kvAna.get("relay_state_v1")) as string) as Record<string, unknown>;
    state.held = held;
    await kvAna.setMany([["relay_state_v1", JSON.stringify(state)]]);
    on(ana);
    expect((await relayUsage()).envelopes).toBe(200);
    expect(await sealOwnDetailed(ana, caro.pkHex, "mio-1", "chat", "hola", NOW)).toBe("store_full");
    expect(await sealOwn(ana, caro.pkHex, "mio-1", "chat", "hola", NOW)).toBe(false);
  });
});

describe("la memoria antirrepetición no expulsa entradas vivas (N-1)", () => {
  // Forma unitaria sobre rememberOpened, la función que receive() usa:
  // sellar y abrir 5.001 sobres de verdad en una prueba costaría minutos
  // de ML-KEM por sobre y no mediría otra cosa que esta función.
  it("con el tope lleno de entradas vivas, crece antes que olvidar una viva", () => {
    const opened: Record<string, number> = {};
    for (let i = 0; i < 5000; i++) opened[`remitente|chat|m-${i}`] = NOW + 3600_000 + i;
    rememberOpened(opened, "remitente|chat|m-nuevo", NOW + 7200_000, NOW);
    expect(Object.keys(opened).length).toBe(5001);
    expect(opened["remitente|chat|m-0"]).toBe(NOW + 3600_000);
    expect(opened["remitente|chat|m-nuevo"]).toBe(NOW + 7200_000);
  });
  it("al llegar al tope, las caducadas sí se olvidan", () => {
    const opened: Record<string, number> = {};
    for (let i = 0; i < 5000; i++) opened[`r|chat|m-${i}`] = i < 100 ? NOW - 1 : NOW + 3600_000;
    rememberOpened(opened, "r|chat|nuevo", NOW + 3600_000, NOW);
    expect(Object.keys(opened).length).toBe(4901);
    expect(opened["r|chat|m-0"]).toBeUndefined();
    expect(opened["r|chat|nuevo"]).toBe(NOW + 3600_000);
  });
  it("por debajo del tope no se olvida nada", () => {
    const opened: Record<string, number> = { "r|chat|viejo": NOW - 1 };
    rememberOpened(opened, "r|chat|nuevo", NOW + 1000, NOW);
    expect(Object.keys(opened).length).toBe(2);
  });
});
