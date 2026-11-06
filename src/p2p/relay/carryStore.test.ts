// Mensajes de amigo en amigo, fase 1: el almacén y el reparto.
import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";
import { toHex } from "../crypto";
import { carryTagsFor, generateCarryPrekey, sealCarry, type CarryEnvelope } from "./carryCrypto";
import { CarryStore, STORE_LIMITS } from "./carryStore";

const NOW = 1_800_000_000_000;
function person() {
  const id = nacl.box.keyPair();
  const sign = nacl.sign.keyPair();
  return { pk: toHex(id.publicKey), signSk: sign.secretKey, idSk: id.secretKey };
}
const ana = person();
const caro = person();
const caroKey = generateCarryPrekey(caro.pk, nacl.sign.keyPair().secretKey, NOW);
const caroTags = new Set(carryTagsFor(caroKey.pub.id, NOW));
const none = new Set<string>();
const env = (over: Partial<Parameters<typeof sealCarry>[0]> = {}): CarryEnvelope =>
  sealCarry({ recipient: caroKey.pub, senderPkHex: ana.pk, senderSecretKey: ana.idSk, id: "m", kind: "chat", text: "hola", now: NOW, ...over });
const B = "b".repeat(64);
const D = "d".repeat(64);
const E = "e".repeat(64);
const F = "f".repeat(64);
const C = caro.pk;

describe("aceptar", () => {
  it("guarda uno bueno; rechaza repetido, caducado, sin saltos y basura", () => {
    const s = new CarryStore();
    const e = env();
    expect(s.accept(e, B, NOW)).toBe("stored");
    expect(s.accept(e, D, NOW)).toBe("duplicate");
    expect(s.accept(env({ ttlMs: 1000 }), B, NOW + 2000)).toBe("expired");
    expect(s.accept({ ...env(), hops: 0 }, B, NOW)).toBe("no_hops");
    expect(s.accept({ t: "nido-carry" }, B, NOW)).toBe("malformed");
  });
  it("topes: 30 por contacto que los trae, 200 en total", () => {
    const s = new CarryStore();
    for (let i = 0; i < STORE_LIMITS.maxPerSource; i++) expect(s.accept(env({ id: `a${i}` }), B, NOW)).toBe("stored");
    expect(s.accept(env({ id: "extra" }), B, NOW)).toBe("source_full");
    const t = new CarryStore({ ...STORE_LIMITS, maxEnvelopes: 3, maxPerSource: 99 });
    for (let i = 0; i < 3; i++) t.accept(env({ id: `x${i}` }), B, NOW);
    expect(t.accept(env({ id: "x3" }), D, NOW)).toBe("full");
  });
  it("lo caducado se tira y deja sitio", () => {
    const s = new CarryStore({ ...STORE_LIMITS, maxEnvelopes: 1 });
    s.accept(env({ ttlMs: 1000 }), B, NOW);
    expect(s.accept(env({ id: "2" }), B, NOW + 500)).toBe("full");
    expect(s.accept(env({ id: "3" }), B, NOW + 1500)).toBe("stored");
  });
});

describe("repartir", () => {
  it("a la destinataria se le entrega siempre y se borra de aquí", () => {
    const s = new CarryStore();
    const e = env();
    s.accept(e, B, NOW);
    const out = s.handoff(C, caroTags, false, NOW);
    expect(out.deliver.map((x) => x.eid)).toEqual([e.eid]);
    expect(s.size()).toBe(0);
    expect(s.accept(e, D, NOW)).toBe("duplicate"); // ya entregado: no vuelve
  });
  it("copias limitadas (quien escribe y cada mensajero), con un salto menos cada vez", () => {
    const lim = { ...STORE_LIMITS, originCopies: 3, carrierCopies: 1 };
    const s = new CarryStore(lim);
    const e = env();
    s.addOwn(e, NOW);
    const given = [B, D, E, F].map((p) => s.handoff(p, none, true, NOW).carry.length);
    expect(given).toEqual([1, 1, 1, 0]);
    const carrier = new CarryStore(lim);
    const got = { ...e, hops: e.hops - 1 };
    carrier.accept(got, B, NOW);
    expect(carrier.handoff(D, none, true, NOW).carry[0].hops).toBe(got.hops - 1);
    expect(carrier.handoff(E, none, true, NOW).carry).toEqual([]);
    expect(STORE_LIMITS.originCopies).toBe(8);
    expect(STORE_LIMITS.carrierCopies).toBe(3);
  });
  it("par: nunca se devuelve a quien lo trajo, ni se da dos veces a la misma persona", () => {
    const s = new CarryStore({ ...STORE_LIMITS, carrierCopies: 5 });
    s.accept(env(), B, NOW);
    expect(s.handoff(B, none, true, NOW).carry).toEqual([]);
    expect(s.handoff(D, none, true, NOW).carry.length).toBe(1);
    expect(s.handoff(D, none, true, NOW).carry).toEqual([]);
  });
  it("par: con el último salto ya no se pasa a otro mensajero (solo a la destinataria)", () => {
    const s = new CarryStore();
    s.accept({ ...env(), hops: 1 }, B, NOW);
    expect(s.handoff(D, none, true, NOW).carry).toEqual([]);
    expect(s.handoff(C, caroTags, true, NOW).deliver.length).toBe(1);
  });
  it("par: a quien no quiere llevar sobres no se le dan (pero sí los suyos)", () => {
    const s = new CarryStore();
    s.accept(env(), B, NOW);
    expect(s.handoff(D, none, false, NOW).carry).toEqual([]);
    expect(s.handoff(C, caroTags, false, NOW).deliver.length).toBe(1);
  });
});

describe("lo que un mensajero no puede inflar", () => {
  it("la caducidad de fuera nunca pasa de 72 h desde que llega", async () => {
    const s = new CarryStore();
    const e = { ...env(), exp: NOW + 365 * 24 * 3600 * 1000 };
    expect(s.accept(e, B, NOW)).toBe("stored");
    // A las 72 h y un poco, ya no está.
    s.sweep(NOW + 72 * 3600 * 1000 + 1);
    expect(s.size()).toBe(0);
  });
});

describe("restaurar reaplica los topes (H-1)", () => {
  const H = 3600_000;
  const peers = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "a"].map((c) => c.repeat(64));
  function givenCount(s: CarryStore): number {
    let given = 0;
    for (const p of peers) if (s.handoff(p, none, true, NOW).carry.length) given++;
    return given;
  }
  it("copiesLeft inflado en el estado guardado se recorta al máximo del origen (mensajero: 3)", () => {
    const s = new CarryStore();
    const e = env({ id: "r-copies" });
    s.restore([{ env: e, from: B, copiesLeft: 1_000_000, givenTo: [], arrivedAt: NOW }], [], NOW);
    expect(givenCount(s)).toBeLessThanOrEqual(STORE_LIMITS.carrierCopies);
    expect(givenCount(new CarryStore())).toBe(0);
  });
  it("copiesLeft inflado de un sobre propio se recorta al máximo de origen (8)", () => {
    const s = new CarryStore();
    const e = env({ id: "r-own" });
    s.restore([{ env: e, from: null, copiesLeft: 1_000_000, givenTo: [], arrivedAt: NOW }], [], NOW);
    const given = givenCount(s);
    expect(given).toBeLessThanOrEqual(STORE_LIMITS.originCopies);
    expect(given).toBeGreaterThan(STORE_LIMITS.carrierCopies);
  });
  it("la caducidad de fuera inflada se recorta a llegada + 72 h y el barrido la tira", () => {
    const s = new CarryStore();
    const e = { ...env({ id: "r-exp" }), exp: NOW + 10 * 365 * 24 * H };
    s.restore([{ env: e, from: B, copiesLeft: 3, givenTo: [], arrivedAt: NOW }], [], NOW);
    expect(s.sweep(NOW + 73 * H)).toBe(1);
    expect(s.has(e.eid)).toBe(false);
  });
  it("una fila sin instante de llegada (estado de la 0.1.76) se recorta contra el ahora de restaurar", () => {
    const s = new CarryStore();
    const e = { ...env({ id: "r-legacy" }), exp: NOW + 10 * 365 * 24 * H };
    s.restore([{ env: e, from: B, copiesLeft: 3, givenTo: [] }], [], NOW);
    expect(s.sweep(NOW + 73 * H)).toBe(1);
    expect(s.has(e.eid)).toBe(false);
  });
  it("el tope por contacto (30) también manda al restaurar", () => {
    const s = new CarryStore();
    const rows = Array.from({ length: 40 }, (_, i) => ({ env: env({ id: `r-src-${i}` }), from: B, copiesLeft: 3, givenTo: [], arrivedAt: NOW }));
    s.restore(rows, [], NOW);
    expect(s.size()).toBe(STORE_LIMITS.maxPerSource);
  });
  it("el tope de bytes también manda al restaurar", () => {
    const lim = { ...STORE_LIMITS, maxBytes: 5000 };
    const s = new CarryStore(lim);
    const rows = Array.from({ length: 10 }, (_, i) => ({ env: env({ id: `r-big-${i}` }), from: B, copiesLeft: 3, givenTo: [], arrivedAt: NOW }));
    s.restore(rows, [], NOW);
    expect(s.bytes()).toBeLessThanOrEqual(lim.maxBytes);
    expect(s.size()).toBeLessThan(10);
    expect(s.size()).toBeGreaterThan(0);
  });
  it("las entradas de seen con NaN o Infinity no entran (sweep nunca las retiraría)", () => {
    const s = new CarryStore();
    s.restore([], [["eid-nan", Number.NaN], ["eid-inf", Number.POSITIVE_INFINITY], ["eid-ok", NOW + 1000]], NOW);
    expect(s.known("eid-nan")).toBe(false);
    expect(s.known("eid-inf")).toBe(false);
    expect(s.known("eid-ok")).toBe(true);
    expect(s.sweep(NOW + 1000)).toBe(0);
    expect(s.known("eid-ok")).toBe(false);
  });
  it("la ida y vuelta de un estado honesto es identidad", () => {
    const s = new CarryStore();
    s.accept(env({ id: "h-1" }), B, NOW);
    s.addOwn(env({ id: "h-2" }), NOW);
    s.handoff(D, none, true, NOW);
    const snap = s.snapshot();
    const t = new CarryStore();
    t.restore(snap.held, snap.seen, NOW);
    expect(t.snapshot()).toEqual(snap);
  });
});

