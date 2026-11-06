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
  return { pk: toHex(id.publicKey), signSk: sign.secretKey };
}
const ana = person();
const caro = person();
const caroKey = generateCarryPrekey(caro.pk, nacl.sign.keyPair().secretKey, NOW);
const caroTags = new Set(carryTagsFor(caroKey.pub.id, NOW));
const none = new Set<string>();
const env = (over: Partial<Parameters<typeof sealCarry>[0]> = {}): CarryEnvelope =>
  sealCarry({ recipient: caroKey.pub, senderPkHex: ana.pk, senderSignSecretKey: ana.signSk, id: "m", kind: "chat", text: "hola", now: NOW, ...over });
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

