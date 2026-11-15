/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * T-14 (0.1.99) · relevo: m-49, m-52 y P-21.
 *
 * m-49: el almacén de tránsito reserva hueco para los sobres PROPIOS:
 * los ajenos topan antes (tope total − reserva) y un sobre propio entra
 * aunque el almacén esté «lleno» de ajenos.
 *
 * m-52: el barrido de caducados corre al arrancar el servicio (su
 * primer uso en el proceso) y a demanda (`sweepRelay`, lo que llama la
 * tarjeta al abrirse), no solo cuando el azar de una entrega lo cruza:
 * se comprueba sobre lo PERSISTIDO (las bolsas `own` y `opened`, que
 * ningún otro camino poda al saludar).
 *
 * P-21: `receive` y `helloFor` no guardan el estado cuando la llamada
 * no cambió nada (antes: un guardado completo por saludo y por frame).
 */
import { describe, it, expect, vi } from "vitest";
import { CarryStore, STORE_LIMITS } from "./carryStore";
import type { CarryEnvelope } from "./carryCrypto";
import * as relay from "./relayService";
import { generateIdentity, generateSigningKeypair, toHex } from "../crypto";

const NOW = 1_760_000_000_000;

/** Sobre bien formado sin criptografía: basta para los topes del almacén. */
function fakeEnvelope(i: number, exp: number): CarryEnvelope {
  const boxBytes = 48 + 1024 + 16; // HEADER_BYTES + cubo menor + overhead
  return {
    t: "nido-carry",
    v: 2,
    eid: "ab".repeat(14) + i.toString(16).padStart(4, "0"),
    tag: "cd".repeat(16),
    eph: "ef".repeat(32),
    kct: "12".repeat(1088),
    nonce: "34".repeat(22) + i.toString(16).padStart(4, "0"),
    box: "56".repeat(boxBytes),
    exp,
    hops: 3,
  } as CarryEnvelope;
}

function me() {
  const id = generateIdentity();
  const sign = generateSigningKeypair();
  return {
    pkHex: toHex(id.publicKey).toLowerCase(),
    signPkHex: toHex(sign.publicKey).toLowerCase(),
    signSecretKey: sign.secretKey,
    idSecretKey: id.secretKey,
  };
}

const bookOf = (peer: ReturnType<typeof me>) => (pk: string) =>
  pk.toLowerCase() === peer.pkHex ? peer.signPkHex : null;

/** Estado con las cuatro bolsas caducadas, en la forma real que guarda el servicio. */
function expiredState() {
  const past = NOW - 1000;
  return {
    enabled: true,
    mine: [
      {
        pub: { id: "aa".repeat(8), owner: "b".repeat(64), x25519: "c".repeat(64), kem: "d".repeat(10), createdAt: 0, expiresAt: past, sig: "e".repeat(10) },
        x: "f".repeat(64),
        k: "9".repeat(10),
      },
    ],
    peers: {},
    held: [{ env: fakeEnvelope(1, past), from: "a".repeat(64), copiesLeft: 1, givenTo: [] }],
    seen: [],
    seenFp: [],
    own: { "msg-1": { eid: "ab".repeat(16), exp: past } },
    flags: {},
    opened: { "remitente|chat|in-1": past },
  };
}

async function persisted(kv: relay.RelayKv) {
  const raw = await kv.get("relay_state_v1");
  return JSON.parse(raw ?? "{}") as Record<string, unknown>;
}

const seedState = (kv: relay.RelayKv, state: unknown) =>
  kv.setMany([["relay_state_v1", JSON.stringify(state)]]);

describe("T-14 · m-49: reserva para sobres propios en el almacén", () => {
  it("con topes pequeños: los ajenos paran en el tope menos la reserva y el propio entra", () => {
    const limits = { ...STORE_LIMITS, maxEnvelopes: 10, maxPerSource: 100, ownReserve: 2, ownReserveBytes: 0 };
    const s = new CarryStore(limits);
    const exp = NOW + 60_000;
    for (let i = 0; i < 8; i++) expect(s.accept(fakeEnvelope(i, exp), "a".repeat(64), NOW)).toBe("stored");
    // El noveno ajeno ya no entra: quedan 2 huecos reservados.
    expect(s.accept(fakeEnvelope(100, exp), "a".repeat(64), NOW)).toBe("full");
    // Los propios usan la reserva y luego el tope entero.
    expect(s.addOwn(fakeEnvelope(200, exp), NOW)).toBe("stored");
    expect(s.addOwn(fakeEnvelope(201, exp), NOW)).toBe("stored");
    expect(s.addOwn(fakeEnvelope(202, exp), NOW)).toBe("full");
  });

  it("la restauración reaplica la misma partición (lo heredado de más se poda)", () => {
    const limits = { ...STORE_LIMITS, maxEnvelopes: 10, maxPerSource: 100, ownReserve: 2, ownReserveBytes: 0 };
    const exp = NOW + 60_000;
    const held = Array.from({ length: 10 }, (_, i) => ({ env: fakeEnvelope(i, exp), from: "a".repeat(64), copiesLeft: 1, givenTo: [] as string[] }));
    const s = new CarryStore(limits);
    s.restore(held, [], NOW);
    expect(s.size()).toBe(8);
    expect(s.addOwn(fakeEnvelope(300, exp), NOW)).toBe("stored");
  });

  it("servicio: con el almacén sembrado de ajenos hasta el tope, mi sobre propio SÍ se sella", async () => {
    const kv = relay.memoryKv();
    relay.setRelayKvForTests(() => kv);
    const yo = me();
    const caro = me();
    const book = bookOf(caro);
    // La clave de buzón de Caro queda registrada (sin esto no hay a quién sellar).
    const hp = await relay.helloPayload(caro, NOW);
    await relay.receive(caro.pkHex, hp, yo, book, NOW);
    // Siembra: el almacén, lleno de sobres ajenos (un remitente distinto
    // por sobre, para no chocar con el tope por par, que no es el tema).
    const state = await persisted(kv);
    const exp = NOW + 3 * 24 * 3600 * 1000;
    state.held = Array.from({ length: STORE_LIMITS.maxEnvelopes }, (_, i) => ({
      env: fakeEnvelope(i, exp),
      from: (i + 1).toString(16).padStart(64, "0"),
      copiesLeft: 1,
      givenTo: [],
    }));
    await seedState(kv, state);
    const res = await relay.sealOwnDetailed(yo, caro.pkHex, "t14-1", "chat", "hola", NOW);
    expect(res).toBe("sealed");
    const usage = await relay.relayUsage();
    expect(usage.envelopes).toBe(STORE_LIMITS.maxEnvelopes - STORE_LIMITS.ownReserve + 1);
  }, 120_000);
});

describe("T-14 · P-21: sin cambios, sin guardado", () => {
  function countingKv() {
    const inner = relay.memoryKv();
    let sets = 0;
    const kv: relay.RelayKv = {
      get: (k) => inner.get(k),
      setMany: async (entries) => {
        sets++;
        await inner.setMany(entries);
      },
    };
    return { kv, sets: () => sets };
  }

  it("receive repetido con el mismo saludo no guarda la segunda vez", async () => {
    const { kv, sets } = countingKv();
    relay.setRelayKvForTests(() => kv);
    const yo = me();
    const peer = me();
    const book = bookOf(peer);
    const hp = await relay.helloPayload(peer, NOW);
    await relay.receive(peer.pkHex, hp, yo, book, NOW);
    const afterFirst = sets();
    expect(afterFirst).toBeGreaterThan(0);
    await relay.receive(peer.pkHex, hp, yo, book, NOW);
    expect(sets()).toBe(afterFirst);
    // Y un saludo vacío tampoco cambia nada.
    await relay.receive(peer.pkHex, {}, yo, book, NOW);
    expect(sets()).toBe(afterFirst);
  }, 120_000);

  it("helloFor repetido sin rotación no guarda; el primero, sí", async () => {
    const { kv, sets } = countingKv();
    relay.setRelayKvForTests(() => kv);
    const yo = me();
    await relay.helloFor(yo, NOW);
    const afterFirst = sets();
    expect(afterFirst).toBeGreaterThan(0);
    await relay.helloFor(yo, NOW);
    expect(sets()).toBe(afterFirst);
  }, 120_000);
});

describe("T-14 · m-52: el barrido corre al arrancar y a demanda", () => {
  it("sweepRelay tira lo caducado de las cuatro bolsas y lo deja guardado", async () => {
    const kv = relay.memoryKv();
    relay.setRelayKvForTests(() => kv);
    await seedState(kv, expiredState());
    const dropped = await relay.sweepRelay(NOW);
    expect(dropped).toBe(1);
    const state = await persisted(kv);
    expect(state.held).toHaveLength(0);
    expect(state.mine).toHaveLength(0);
    expect(Object.keys(state.own as object)).toHaveLength(0);
    expect(Object.keys(state.opened as object)).toHaveLength(0);
    // Y quedó persistido: una segunda pasada ya no encuentra nada.
    expect(await relay.sweepRelay(NOW)).toBe(0);
  }, 120_000);

  it("el primer uso del servicio en el proceso barre lo caducado (arranque)", async () => {
    vi.resetModules();
    const fresh = await import("./relayService");
    const kv = fresh.memoryKv();
    fresh.setRelayKvForTests(() => kv);
    await seedState(kv, expiredState());
    const yo = me();
    // helloFor es el primer uso: al entrar, el arranque barre. Las bolsas
    // own/opened son la prueba: ningún otro camino las poda al saludar.
    await fresh.helloFor(yo, NOW);
    const raw = await kv.get("relay_state_v1");
    const state = JSON.parse(raw ?? "{}") as Record<string, unknown>;
    expect(Object.keys(state.own as object)).toHaveLength(0);
    expect(Object.keys(state.opened as object)).toHaveLength(0);
  }, 120_000);
});
