/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * TRES teléfonos NIDO completos (mensajes de amigo en amigo, docs/RELAY.md).
 * Mismo arnés que e2eTwoPhones.test.ts, con un "cable" por pareja.
 *
 * Ana y Caro son contactos pero no se cruzan; Beto, contacto de los dos,
 * lleva el sobre de Ana a Caro y el acuse de Caro a Ana.
 *
 * Lo que sigue es el comentario original del arnés de dos teléfonos:
 *
 * Dos teléfonos NIDO completos, de punta a punta, en el mismo proceso.
 *
 * Cada "teléfono" tiene su propio messenger, su propio transporte real
 * (NidoBluetoothTransport) y su propia base de datos (memoria simulada). Solo
 * el módulo nativo de Bluetooth es falso: un "cable" que lleva cada frame al
 * otro teléfono. Es lo más parecido a la prueba con dos tablets:
 *   emparejar por QR → conectar → saludo (sellado) → CONFIRM v2 →
 *   session_confirm (cf2, oferta v5 con cabeceras cifradas) → chats en los
 *   dos sentidos.
 *
 * Qué comprueba además del "llega el mensaje":
 *   - Ningún byte que pasa por el cable contiene la identidad de ninguno.
 *   - Los dos contactos quedan marcados con CONFIRM v2.
 *   - Los chats viajan en v5 con la cabecera cifrada (0x06).
 *
 * Cada teléfono corre dentro de su propio AsyncLocalStorage, así la base de
 * datos y las claves que ve cada uno son las suyas aunque los dos trabajen a
 * la vez.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../agent/memory/memoryStore", async () => {
  const { p2pMemoryStoreModuleRouted } = await import("./p2pMemoryMock");
  return p2pMemoryStoreModuleRouted();
});
vi.mock("expo-sqlite", () => ({}));
vi.mock("react-native", () => ({ Platform: { OS: "android" }, AppState: { currentState: "active" } }));

import { makeP2PMem, setP2PMemResolver, type P2PMem } from "./p2pMemoryMock";
import { createMemorySecureBackend, setTestSecureBackend, type SecureBackend } from "../privacy/keyManager";
import { resetFeatureFlagsForTests, setFeatureOverrideForTests } from "../config/featureFlags";
import { NidoMessenger } from "./messenger";
import { NidoBluetoothTransport, type NidoP2PBindings } from "./nativeTransport";
import { makeMemoryHelloNonceCache } from "./nonceCache";
import { decodeBase64 } from "./base64";
import { toHex } from "./crypto";
import type { P2PTransport } from "./transport";
import { memoryKv, relayUsage, setCarryEnabled, setRelayKvForTests, type RelayKv } from "./relay/relayService";

interface PhoneCtx {
  name: string;
  mem: P2PMem;
  backend: SecureBackend;
  relayKv: RelayKv;
}

const als = new AsyncLocalStorage<PhoneCtx>();

type Listener = (payload: never) => void;

interface Phone {
  ctx: PhoneCtx;
  /** Dirección con la que los otros teléfonos ven a este. */
  mac: string;
  listeners: Map<string, Listener[]>;
  /** Teléfonos al alcance, por su dirección. */
  near: Map<string, Phone>;
  bindings: NidoP2PBindings;
  transport: NidoBluetoothTransport;
  m: NidoMessenger;
  pk: string;
  /** Todo lo que este teléfono puso en el cable (base64). */
  wire: string[];
  run<T>(fn: () => Promise<T>): Promise<T>;
}

function emit(p: Phone, event: string, payload: unknown): void {
  als.run(p.ctx, () => {
    for (const fn of p.listeners.get(event) ?? []) fn(payload as never);
  });
}

function makePhone(name: string, mac: string): Phone {
  const ctx: PhoneCtx = { name, mem: makeP2PMem(), backend: createMemorySecureBackend(), relayKv: memoryKv() };
  const listeners = new Map<string, Listener[]>();
  const phone = { ctx, mac, listeners, near: new Map(), wire: [] } as unknown as Phone;
  const later = (fn: () => void) => setTimeout(fn, 0);
  phone.bindings = {
    isBluetoothEnabled: () => true,
    requestPermissions: async () => true,
    startDiscovery: async () => {},
    stopDiscovery: async () => {},
    startServer: async () => {},
    stopServer: async () => {},
    connect: async (address: string) => {
      const other = phone.near.get(address);
      if (!other) throw new Error("fuera de alcance");
      later(() => emit(other, "onConnected", { address: phone.mac, name, incoming: true }));
      later(() => emit(phone, "onConnected", { address, name: other.ctx.name, incoming: false }));
      return { address, name: other.ctx.name };
    },
    sendFrame: async (address: string, base64: string) => {
      phone.wire.push(base64);
      const other = phone.near.get(address);
      if (!other) throw new Error("fuera de alcance");
      later(() => emit(other, "onFrame", { address: phone.mac, base64 }));
    },
    disconnect: async (address: string) => {
      const other = phone.near.get(address);
      if (other) later(() => emit(other, "onDisconnected", { address: phone.mac }));
      later(() => emit(phone, "onDisconnected", { address }));
    },
    shutdown: async () => {},
    getBondedDevices: async () => [],
    addListener: ((event: string, fn: Listener) => {
      const arr = listeners.get(event) ?? [];
      arr.push(fn);
      listeners.set(event, arr);
      return () => listeners.set(event, (listeners.get(event) ?? []).filter((f) => f !== fn));
    }) as NidoP2PBindings["addListener"],
  } as NidoP2PBindings;
  phone.run = <T,>(fn: () => Promise<T>) => als.run(ctx, fn);
  phone.transport = new NidoBluetoothTransport(phone.bindings, { nonceCache: makeMemoryHelloNonceCache() });
  phone.m = new NidoMessenger(phone.transport as unknown as P2PTransport);
  return phone;
}

async function until(cond: () => Promise<boolean> | boolean, what: string, ms = 10000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Se agotó la espera: ${what}`);
}

const bytes = (b64: string) => decodeBase64(b64);

async function pair(x: Phone, y: Phone): Promise<void> {
  const cx = await x.run(() => x.m.myPairingCode());
  const cy = await y.run(() => y.m.myPairingCode());
  expect(await x.run(() => x.m.pairWith(cy))).not.toBeNull();
  expect(await y.run(() => y.m.pairWith(cx))).not.toBeNull();
}

const linked = async (x: Phone, y: Phone) =>
  (await x.run(async () => x.m.connectedPeers().includes(y.pk))) &&
  (await y.run(async () => y.m.connectedPeers().includes(x.pk)));

/** Se cruzan: quedan al alcance y conectan. */
async function meet(x: Phone, y: Phone): Promise<void> {
  x.near.set(y.mac, y);
  y.near.set(x.mac, x);
  await x.run(() => x.m.connectPeer(y.mac, { targetPkHex: y.pk }));
  await until(() => linked(x, y), `${x.ctx.name} y ${y.ctx.name} conectados`);
}

/** Se separan. */
async function part(x: Phone, y: Phone): Promise<void> {
  await x.run(() => x.m.disconnectPeer(y.pk));
  await until(async () => !(await linked(x, y)), `${x.ctx.name} y ${y.ctx.name} separados`);
  x.near.delete(y.mac);
  y.near.delete(x.mac);
}

/** El estado del relay de un teléfono, tal cual está guardado. */
async function relayRaw(p: Phone): Promise<string> {
  return (await p.ctx.relayKv.get("relay_state_v1")) ?? "";
}

beforeEach(() => {
  resetFeatureFlagsForTests();
  setP2PMemResolver(() => als.getStore()?.mem ?? null);
  setRelayKvForTests(() => als.getStore()!.relayKv);
  const routed: SecureBackend = {
    getItemAsync: (k) => als.getStore()!.backend.getItemAsync(k),
    setItemAsync: (k, v) => als.getStore()!.backend.setItemAsync(k, v),
    deleteItemAsync: (k) => als.getStore()!.backend.deleteItemAsync(k),
  };
  setTestSecureBackend(routed);
});

afterEach(() => {
  setP2PMemResolver(null);
  setRelayKvForTests(null);
  setTestSecureBackend(null);
});

describe("tres teléfonos: de amigo en amigo", () => {
  it("Ana → Beto → Caro sin que Ana y Caro se crucen; el acuse vuelve y nadie en medio lee nada", async () => {
    const ana = makePhone("Ana", "AA:AA:AA:AA:AA:01");
    const beto = makePhone("Beto", "BB:BB:BB:BB:BB:02");
    const caro = makePhone("Caro", "CC:CC:CC:CC:CC:03");
    for (const p of [ana, beto, caro]) {
      p.pk = (await p.run(() => p.m.ensureIdentity(p.ctx.name))).pkHex;
    }
    await pair(ana, beto);
    await pair(beto, caro);
    await pair(ana, caro);
    for (const p of [ana, beto, caro]) await p.run(() => p.m.startLink());
    await beto.run(() => setCarryEnabled(true));

    // Ana y Caro se vieron una vez (se dan sus claves de buzón) y se separan.
    await meet(ana, caro);
    await until(async () => (await relayRaw(ana)).includes(caro.pk), "Ana tiene la clave de buzón de Caro");
    await until(async () => (await relayRaw(caro)).includes(ana.pk), "Caro tiene la de Ana");
    await part(ana, caro);

    // Ana se cruza con Beto y escribe a Caro, que está lejos.
    await meet(ana, beto);
    const SECRET = "Llegamos bien, estamos en el refugio";
    const sent = await ana.run(() => ana.m.sendChat("Caro", SECRET));
    expect(sent.queued).toBe(true);
    await until(async () => (await beto.run(() => relayUsage())).envelopes === 1, "Beto lleva el sobre");
    await part(ana, beto);

    // Beto se cruza con Caro.
    await meet(beto, caro);
    await until(
      async () => (await caro.run(() => caro.m.readInbox())).some((m) => m.dir === "in" && m.text === SECRET),
      "Caro recibe el mensaje de Ana",
    );
    const atCaro = (await caro.run(() => caro.m.readInbox())).find((m) => m.text === SECRET)!;
    expect(atCaro.peerPk.toLowerCase()).toBe(ana.pk.toLowerCase());
    expect(atCaro.id).toBe(sent.id);
    // El acuse de Caro sale hacia Beto.
    await until(async () => (await beto.run(() => relayUsage())).envelopes === 1, "Beto lleva el acuse");
    await part(beto, caro);

    // Beto vuelve a cruzarse con Ana: el mensaje pasa a entregado.
    await meet(ana, beto);
    await until(
      async () => ana.ctx.mem.messages.find((m) => m.id === sent.id)?.status === "delivered",
      "Ana ve su mensaje entregado",
    );
    await until(async () => (await beto.run(() => relayUsage())).envelopes === 0, "Beto ya no lleva nada");

    // Nada de lo que pasó por ningún cable contiene el texto.
    for (const p of [ana, beto, caro]) {
      for (const b64 of p.wire) {
        expect(new TextDecoder().decode(bytes(b64)).includes("refugio")).toBe(false);
      }
    }
  }, 60000);

  it("si Beto no lleva mensajes (valor de fábrica), no guarda nada y el de Ana espera", async () => {
    const ana = makePhone("Ana", "AA:AA:AA:AA:AA:11");
    const beto = makePhone("Beto", "BB:BB:BB:BB:BB:12");
    const caro = makePhone("Caro", "CC:CC:CC:CC:CC:13");
    for (const p of [ana, beto, caro]) {
      p.pk = (await p.run(() => p.m.ensureIdentity(p.ctx.name))).pkHex;
    }
    await pair(ana, beto);
    await pair(beto, caro);
    await pair(ana, caro);
    for (const p of [ana, beto, caro]) await p.run(() => p.m.startLink());
    await meet(ana, caro);
    await until(async () => (await relayRaw(ana)).includes(caro.pk), "Ana tiene la clave de buzón de Caro");
    await part(ana, caro);
    await meet(ana, beto);
    const sent = await ana.run(() => ana.m.sendChat("Caro", "hola"));
    expect(sent.queued).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect((await beto.run(() => relayUsage())).envelopes).toBe(0);
    expect(ana.ctx.mem.messages.find((m) => m.id === sent.id)?.status).toBe("queued");
  }, 60000);
});
