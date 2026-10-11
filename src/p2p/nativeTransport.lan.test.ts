/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * nativeTransport.lan.test.ts — respaldo por Wi-Fi local (TCP + mDNS).
 *
 * El módulo nativo entrega las conexiones Wi-Fi con direcciones
 * "LAN:<ipv4>:<puerto>" y los MISMOS eventos que Bluetooth. Estos tests
 * prueban que:
 *  - con Bluetooth apagado (o sin permisos) el enlace funciona por Wi-Fi;
 *  - sin soporte Wi-Fi en el nativo, el comportamiento es el de siempre;
 *  - el handshake HELLO/CONFIRM y sus defensas se aplican igual por Wi-Fi;
 *  - la cuota de handshakes entrantes se aplica por IP (no por puerto);
 *  - las direcciones Wi-Fi no se guardan como "MAC conocida";
 *  - cada conexión Wi-Fi queda en el registro de red.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildConfirmSignMessage,
  buildHelloSignMessageV3,
  generateEphemeral,
  generateSigningKeypair,
  randomNonce,
  signDetached,
  toHex,
  HANDSHAKE_NONCE_BYTES,
} from "./crypto";
import { encodeBase64, decodeBase64 } from "./base64";
import {
  NidoBluetoothTransport,
  buildHello,
  extractLanAddress,
  extractMac,
  handshakeRateKey,
  isLanAddress,
  parseHello,
  type NidoP2PBindings,
} from "./nativeTransport";
import { buildConfirmV1 } from "./handshakeV3";
import { makeMemoryHelloNonceCache } from "./nonceCache";
import { networkAudit } from "../privacy/networkAudit";
import type { P2PPeerInfo, P2PTransportEvents } from "./transport";

const MY_PK = new Uint8Array(32).fill(1);
const MY_PK_HEX = toHex(MY_PK);
const MY_SIGN = generateSigningKeypair();
const PEER_PK_HEX = toHex(new Uint8Array(32).fill(2));
const PEER_SIGN = generateSigningKeypair();
const LAN = "LAN:192.168.43.7:41234";

const storeSpies = vi.hoisted(() => ({ saveKnownMac: vi.fn(async () => undefined) }));

vi.mock("./store", () => ({
  getIdentity: async () => ({ publicKey: MY_PK, secretKey: new Uint8Array(32).fill(7), name: "Yo" }),
  getSigningKeypair: async () => MY_SIGN,
  findContactByPk: async (pk: string) =>
    pk === PEER_PK_HEX
      ? { pkHex: PEER_PK_HEX, name: "Beto", verified: true, sigPkHex: toHex(PEER_SIGN.publicKey) }
      : null,
  saveKnownMac: storeSpies.saveKnownMac,
}));

vi.mock("../agent/memory/memoryStore", () => {
  const db = {
    execAsync: async () => undefined,
    getFirstAsync: async () => null,
    getAllAsync: async () => [],
    runAsync: async () => ({ changes: 0 }),
  };
  return {
    getMemoryDb: async () => db,
    getMemoryDbEpoch: () => 0,
    writeMemoryTransaction: async (work: (d: typeof db) => Promise<void>) => {
      await work(db);
    },
  };
});

type Listener = (...args: never[]) => void;

function makeFake(opts: { bluetooth?: boolean; permissions?: boolean; lan?: boolean } = {}) {
  const { bluetooth = true, permissions = true, lan = true } = opts;
  const listeners = new Map<string, Listener[]>();
  const sent: Array<{ address: string; base64: string }> = [];
  const connected: string[] = [];
  const calls: string[] = [];
  const emit = (event: string, payload: never) => {
    for (const fn of listeners.get(event) ?? []) fn(payload);
  };
  const fake: NidoP2PBindings = {
    isBluetoothEnabled: () => bluetooth,
    requestPermissions: async () => {
      calls.push("requestPermissions");
      return permissions;
    },
    startDiscovery: async () => {
      calls.push("startDiscovery");
      if (!bluetooth) throw new Error("No se pudo iniciar el discovery.");
    },
    stopDiscovery: async () => {
      calls.push("stopDiscovery");
    },
    startServer: async () => {
      calls.push("startServer");
    },
    stopServer: async () => {
      calls.push("stopServer");
    },
    connect: async (address: string) => {
      calls.push(`connect:${address}`);
      connected.push(address);
      emit("onConnected", { address, name: null, incoming: false } as never);
      return { address, name: null };
    },
    sendFrame: async (address: string, base64: string) => {
      sent.push({ address, base64 });
    },
    disconnect: async () => undefined,
    shutdown: async () => {
      calls.push("shutdown");
    },
    getBondedDevices: async () => [],
    addListener: ((event: string, fn: Listener) => {
      const arr = listeners.get(event) ?? [];
      arr.push(fn);
      listeners.set(event, arr);
      return () => {
        listeners.set(event, (listeners.get(event) ?? []).filter((f) => f !== fn));
      };
    }) as NidoP2PBindings["addListener"],
  };
  if (lan) {
    fake.startLan = async () => {
      calls.push("startLan");
    };
    fake.stopLan = async () => {
      calls.push("stopLan");
    };
  }
  return { fake, sent, connected, calls, emit };
}

function makeEvents() {
  const found: P2PPeerInfo[] = [];
  const handshakes: string[] = [];
  const errors: string[] = [];
  const events: P2PTransportEvents = {
    onPeerFound: (p) => found.push(p),
    onHandshakeComplete: (pk) => handshakes.push(pk),
    onError: (m) => errors.push(m),
  };
  return { events, found, handshakes, errors };
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const nowSec = () => Math.floor(Date.now() / 1000);

function peerHello(): { b64: string; nonceHex: string } {
  const eph = toHex(generateEphemeral().publicKey);
  const nonceHex = toHex(randomNonce(HANDSHAKE_NONCE_BYTES));
  const ts = nowSec();
  const sig = toHex(signDetached(buildHelloSignMessageV3(PEER_PK_HEX, eph, nonceHex, ts), PEER_SIGN.secretKey));
  return { b64: encodeBase64(buildHello(PEER_PK_HEX, eph, nonceHex, ts, sig)), nonceHex };
}

function peerConfirm(peerNonceHex: string, myNonceHex: string, signer = PEER_SIGN): string {
  const sig = toHex(signDetached(buildConfirmSignMessage(PEER_PK_HEX, peerNonceHex, myNonceHex), signer.secretKey));
  return encodeBase64(buildConfirmV1(PEER_PK_HEX, peerNonceHex, myNonceHex, sig));
}

const makeTransport = (fake: NidoP2PBindings) =>
  new NidoBluetoothTransport(fake, { nonceCache: makeMemoryHelloNonceCache() });

describe("Wi-Fi local: utilidades de direcciones", () => {
  it("extractLanAddress valida IP y puerto", () => {
    expect(extractLanAddress(`NIDO Wi-Fi (${LAN})`)).toBe(LAN);
    expect(extractLanAddress("lan:10.0.0.2:5000")).toBe("LAN:10.0.0.2:5000");
    expect(extractLanAddress("LAN:300.0.0.1:5000")).toBeNull();
    expect(extractLanAddress("LAN:10.0.0.1:70000")).toBeNull();
    expect(extractLanAddress("AA:BB:CC:DD:EE:FF")).toBeNull();
    // Una dirección Wi-Fi no se confunde con una MAC.
    expect(extractMac(LAN)).toBeNull();
  });

  it("isLanAddress y la clave de cuota por IP", () => {
    expect(isLanAddress(LAN)).toBe(true);
    expect(isLanAddress("AA:BB:CC:DD:EE:FF")).toBe(false);
    expect(handshakeRateKey("LAN:192.168.43.7:50001")).toBe("LAN:192.168.43.7");
    expect(handshakeRateKey("LAN:192.168.43.7:50002")).toBe("LAN:192.168.43.7");
    expect(handshakeRateKey("AA:BB:CC:DD:EE:FF")).toBe("AA:BB:CC:DD:EE:FF");
  });
});

describe("Wi-Fi local: arranque y respaldo", () => {
  beforeEach(() => storeSpies.saveKnownMac.mockClear());

  it("Bluetooth apagado + Wi-Fi disponible → enlaza solo por Wi-Fi", async () => {
    const f = makeFake({ bluetooth: false });
    const ev = makeEvents();
    const t = makeTransport(f.fake);
    await expect(t.startDiscovery(ev.events)).resolves.toBeUndefined();
    expect(f.calls).toContain("startLan");
    expect(f.calls).not.toContain("startServer");
    expect(f.calls).not.toContain("requestPermissions");
    await t.stopDiscovery();
    expect(f.calls).toContain("stopLan");
  });

  it("sin soporte Wi-Fi en el nativo → mismo error de siempre con Bluetooth apagado", async () => {
    const f = makeFake({ bluetooth: false, lan: false });
    const t = makeTransport(f.fake);
    await expect(t.startDiscovery(makeEvents().events)).rejects.toThrow("El Bluetooth está apagado.");
  });

  it("sin soporte Wi-Fi y sin permisos → mismo error de siempre", async () => {
    const f = makeFake({ permissions: false, lan: false });
    const t = makeTransport(f.fake);
    await expect(t.startDiscovery(makeEvents().events)).rejects.toThrow(/permisos de Bluetooth/);
  });

  it("sin permisos de Bluetooth + Wi-Fi → sigue por Wi-Fi y lo avisa", async () => {
    const f = makeFake({ permissions: false });
    const ev = makeEvents();
    const t = makeTransport(f.fake);
    await t.startDiscovery(ev.events);
    expect(f.calls).toContain("startLan");
    expect(f.calls).not.toContain("startServer");
    expect(ev.errors.some((e) => /solo Wi-Fi local/.test(e))).toBe(true);
    await t.stopDiscovery();
  });

  it("Bluetooth encendido + Wi-Fi → arranca ambos", async () => {
    const f = makeFake();
    const t = makeTransport(f.fake);
    await t.startDiscovery(makeEvents().events);
    expect(f.calls).toEqual(expect.arrayContaining(["startServer", "startDiscovery", "startLan"]));
    await t.stopDiscovery();
  });

  it("un NIDO anunciado por Wi-Fi llega como peer cercano de tipo 'lan'", async () => {
    const f = makeFake();
    const ev = makeEvents();
    const t = makeTransport(f.fake);
    await t.startDiscovery(ev.events);
    f.emit("onDeviceFound", { address: LAN, name: "NIDO Wi-Fi" } as never);
    expect(ev.found).toEqual([{ pkHex: "", alias: `NIDO Wi-Fi (${LAN})`, transport: "lan" }]);
    await t.stopDiscovery();
  });
});

describe("Wi-Fi local: handshake completo", () => {
  beforeEach(() => storeSpies.saveKnownMac.mockClear());

  it("connect por alias Wi-Fi: HELLO/CONFIRM, ruta 'lan', registro de red, sin MAC conocida", async () => {
    const f = makeFake({ bluetooth: false });
    const ev = makeEvents();
    const t = makeTransport(f.fake);
    await t.startDiscovery(ev.events);
    const auditBefore = networkAudit.list().length;

    const pending = t.connect(`NIDO Wi-Fi (${LAN})`);
    await tick();
    // Conecta a la dirección Wi-Fi y NO detiene el discovery Bluetooth.
    expect(f.calls).toContain(`connect:${LAN}`);
    expect(f.calls).not.toContain("stopDiscovery");
    // Nuestro HELLO salió por la conexión Wi-Fi.
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0].address).toBe(LAN);
    const myHello = parseHello(decodeBase64(f.sent[0].base64));

    const ph = peerHello();
    f.emit("onFrame", { address: LAN, base64: ph.b64 } as never);
    await tick();
    expect(f.sent).toHaveLength(2); // nuestro CONFIRM
    f.emit("onFrame", { address: LAN, base64: peerConfirm(ph.nonceHex, myHello.nonce) } as never);

    const info = await pending;
    expect(info).toEqual({ pkHex: PEER_PK_HEX, alias: "Beto", transport: "lan" });
    expect(ev.handshakes).toEqual([PEER_PK_HEX]);
    // Los datos posteriores van por la misma conexión Wi-Fi.
    await t.sendFrame(PEER_PK_HEX, new Uint8Array([1, 2, 3]));
    expect(f.sent[2].address).toBe(LAN);
    // La IP Wi-Fi no se guarda como MAC conocida.
    expect(storeSpies.saveKnownMac).not.toHaveBeenCalled();
    // La conexión quedó en el registro de red.
    const entries = networkAudit.list();
    expect(entries.length).toBe(auditBefore + 1);
    expect(entries[0]).toMatchObject({ kind: "lan_connect", endpoint: "192.168.43.7:41234 (saliente)" });
    await t.stopDiscovery();
  });

  it("CONFIRM con firma forjada por Wi-Fi → rechazado igual que por Bluetooth", async () => {
    const f = makeFake({ bluetooth: false });
    const ev = makeEvents();
    const t = makeTransport(f.fake);
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: LAN, name: null, incoming: true } as never);
    await tick();
    const myHello = parseHello(decodeBase64(f.sent[0].base64));
    const ph = peerHello();
    f.emit("onFrame", { address: LAN, base64: ph.b64 } as never);
    await tick();
    f.emit("onFrame", {
      address: LAN,
      base64: peerConfirm(ph.nonceHex, myHello.nonce, generateSigningKeypair()),
    } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(0);
    await expect(t.sendFrame(PEER_PK_HEX, new Uint8Array([1]))).rejects.toThrow(/no conectado/i);
    await t.stopDiscovery();
  });

  it("cuota de handshakes entrantes por IP: cambiar de puerto no la salta", async () => {
    const f = makeFake({ bluetooth: false });
    const t = makeTransport(f.fake);
    await t.startDiscovery(makeEvents().events);
    // 8 conexiones entrantes desde la MISMA IP con puertos distintos.
    for (let port = 50001; port <= 50008; port++) {
      f.emit("onConnected", { address: `LAN:192.168.43.9:${port}`, name: null, incoming: true } as never);
    }
    await tick(50);
    // Solo las primeras 5 (INBOUND_HANDSHAKE_MAX_PER_WINDOW) reciben HELLO.
    expect(f.sent).toHaveLength(5);
    // Otra IP de la red no se ve afectada.
    f.emit("onConnected", { address: "LAN:192.168.43.10:50001", name: null, incoming: true } as never);
    await tick();
    expect(f.sent).toHaveLength(6);
    await t.stopDiscovery();
  });
});
