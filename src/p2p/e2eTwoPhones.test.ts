/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
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
import { V5_HE_MARKER } from "./ratchet";
import type { P2PTransport } from "./transport";

interface PhoneCtx {
  name: string;
  mem: P2PMem;
  backend: SecureBackend;
}

const als = new AsyncLocalStorage<PhoneCtx>();

type Listener = (payload: never) => void;

interface Phone {
  ctx: PhoneCtx;
  /** Dirección con la que el OTRO teléfono ve a este. */
  mac: string;
  listeners: Map<string, Listener[]>;
  partner: Phone | null;
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
  const ctx: PhoneCtx = { name, mem: makeP2PMem(), backend: createMemorySecureBackend() };
  const listeners = new Map<string, Listener[]>();
  const phone = { ctx, mac, listeners, partner: null, wire: [] } as unknown as Phone;
  const later = (fn: () => void) => setTimeout(fn, 0);
  phone.bindings = {
    isBluetoothEnabled: () => true,
    requestPermissions: async () => true,
    startDiscovery: async () => {},
    stopDiscovery: async () => {},
    startServer: async () => {},
    stopServer: async () => {},
    connect: async (address: string) => {
      const other = phone.partner!;
      // Primero acepta el servidor del otro, luego se entera quien llama.
      later(() => emit(other, "onConnected", { address: phone.mac, name, incoming: true }));
      later(() => emit(phone, "onConnected", { address, name: other.ctx.name, incoming: false }));
      return { address, name: other.ctx.name };
    },
    sendFrame: async (_address: string, base64: string) => {
      phone.wire.push(base64);
      const other = phone.partner!;
      later(() => emit(other, "onFrame", { address: phone.mac, base64 }));
    },
    disconnect: async () => {
      const other = phone.partner!;
      later(() => emit(other, "onDisconnected", { address: phone.mac }));
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

async function until(cond: () => Promise<boolean> | boolean, what: string, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Se agotó la espera: ${what}`);
}

/** Bytes de un frame del cable (base64 → bytes). */
const bytes = (b64: string) => decodeBase64(b64);

async function pairAndConnect(): Promise<{ ana: Phone; beto: Phone }> {
  const ana = makePhone("Ana", "AA:AA:AA:AA:AA:01");
  const beto = makePhone("Beto", "BB:BB:BB:BB:BB:02");
  ana.partner = beto;
  beto.partner = ana;
  ana.pk = (await ana.run(() => ana.m.ensureIdentity("Ana"))).pkHex;
  beto.pk = (await beto.run(() => beto.m.ensureIdentity("Beto"))).pkHex;
  const codeAna = await ana.run(() => ana.m.myPairingCode());
  const codeBeto = await beto.run(() => beto.m.myPairingCode());
  expect(await ana.run(() => ana.m.pairWith(codeBeto))).not.toBeNull();
  expect(await beto.run(() => beto.m.pairWith(codeAna))).not.toBeNull();
  await ana.run(() => ana.m.startLink());
  await beto.run(() => beto.m.startLink());
  await ana.run(() => ana.m.connectPeer(beto.mac, { targetPkHex: beto.pk }));
  await until(
    async () =>
      (await ana.run(async () => ana.m.connectedPeers().includes(beto.pk))) &&
      (await beto.run(async () => beto.m.connectedPeers().includes(ana.pk))),
    "los dos teléfonos conectados",
  );
  return { ana, beto };
}

async function inboxTexts(p: Phone): Promise<string[]> {
  const msgs = await p.run(() => p.m.readInbox());
  return msgs.filter((m) => m.dir === "in").map((m) => m.text);
}

beforeEach(() => {
  resetFeatureFlagsForTests();
  setP2PMemResolver(() => als.getStore()?.mem ?? null);
  // La "caja fuerte" del sistema, también por teléfono.
  const routed: SecureBackend = {
    getItemAsync: (k) => als.getStore()!.backend.getItemAsync(k),
    setItemAsync: (k, v) => als.getStore()!.backend.setItemAsync(k, v),
    deleteItemAsync: (k) => als.getStore()!.backend.deleteItemAsync(k),
  };
  setTestSecureBackend(routed);
});

afterEach(() => {
  setP2PMemResolver(null);
  setTestSecureBackend(null);
});

describe("dos teléfonos NIDO de punta a punta", () => {
  it("emparejar, conectar y chatear en los dos sentidos con todo activado (valores de fábrica)", async () => {
    const { ana, beto } = await pairAndConnect();

    await ana.run(() => ana.m.sendChat("Beto", "hola Beto"));
    await until(async () => (await inboxTexts(beto)).includes("hola Beto"), "Beto recibe");
    await beto.run(() => beto.m.sendChat("Ana", "hola Ana"));
    await until(async () => (await inboxTexts(ana)).includes("hola Ana"), "Ana recibe");
    for (let i = 0; i < 5; i++) {
      await ana.run(() => ana.m.sendChat("Beto", `a${i}`));
      await beto.run(() => beto.m.sendChat("Ana", `b${i}`));
    }
    await until(async () => (await inboxTexts(beto)).includes("a4"), "ráfaga a Beto");
    await until(async () => (await inboxTexts(ana)).includes("b4"), "ráfaga a Ana");

    // CONFIRM v2 verificado en los dos sentidos (marcado por el QR y por el saludo).
    const confirmV2 = (p: Phone, peer: string) =>
      (p.ctx.mem.contacts.find((c) => c.pk_hex === peer) as unknown as { confirm_v2?: number })?.confirm_v2;
    expect(confirmV2(ana, beto.pk)).toBe(1);
    expect(confirmV2(beto, ana.pk)).toBe(1);

    // v5 en uso en los dos lados.
    expect(await ana.run(async () => ana.m.sessionUsesV5(beto.pk))).toBe(true);
    expect(await beto.run(async () => beto.m.sessionUsesV5(ana.pk))).toBe(true);

    // Nada del cable contiene la identidad de ninguno (saludo sellado desde la
    // primera conexión gracias al QR), ni en hex ni en base64.
    const all = [...ana.wire, ...beto.wire];
    for (const b64 of all) {
      const asText = new TextDecoder().decode(bytes(b64));
      for (const pk of [ana.pk, beto.pk]) {
        expect(asText.includes(pk)).toBe(false);
        expect(toHex(bytes(b64)).includes(pk)).toBe(false);
      }
    }

    // Los últimos frames de chat van con la cabecera cifrada (0x06 tras el u32).
    const lastAna = bytes(ana.wire[ana.wire.length - 1]);
    const lastBeto = bytes(beto.wire[beto.wire.length - 1]);
    expect(lastAna[4]).toBe(V5_HE_MARKER);
    expect(lastBeto[4]).toBe(V5_HE_MARKER);
  }, 30000);

  it("con v5 apagado por el usuario: sigue conectando y chateando (modo clásico)", async () => {
    setFeatureOverrideForTests("p2p.ratchetV5", false);
    const { ana, beto } = await pairAndConnect();
    await ana.run(() => ana.m.sendChat("Beto", "clásico"));
    await until(async () => (await inboxTexts(beto)).includes("clásico"), "Beto recibe en clásico");
    await beto.run(() => beto.m.sendChat("Ana", "también"));
    await until(async () => (await inboxTexts(ana)).includes("también"), "Ana recibe en clásico");
    expect(await ana.run(async () => ana.m.sessionUsesV5(beto.pk))).toBe(false);
  }, 30000);

  it("con el saludo privado apagado por el usuario: sigue conectando", async () => {
    setFeatureOverrideForTests("p2p.sealedHandshake", false);
    const { ana, beto } = await pairAndConnect();
    await ana.run(() => ana.m.sendChat("Beto", "sin sellar"));
    await until(async () => (await inboxTexts(beto)).includes("sin sellar"), "Beto recibe");
  }, 30000);
});
