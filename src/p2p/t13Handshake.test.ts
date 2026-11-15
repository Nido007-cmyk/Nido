/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * t13Handshake.test.ts — Tanda T-13 (red y relay II) · 0.1.99.
 *
 * Sondas escritas ANTES de las curas (rojo por la causa exacta de cada
 * asiento) y regresiones permanentes de:
 * - M-22: un HELLO firmado en claro capturado se podía replayar ante OTRO
 *   aparato del mismo contacto y ese aparato respondía con su HELLO
 *   firmado EN CLARO (fuga de presencia). La cura sella la respuesta
 *   cuando el HELLO entrante anuncia `rs` («entiendo la respuesta
 *   sellada», pista aditiva sin firmar, misma doctrina que `c4`). Sin
 *   `rs` (un iniciador 0.1.98, que NO sabría abrir una respuesta sellada
 *   que no esperaba) la respuesta sigue en claro: compatibilidad.
 * - M-30: el registro de red no registraba conexiones Bluetooth ni el
 *   arranque del descubrimiento (solo `lan_connect`).
 * - m-35 (parte TS): el aviso previo a hacerse descubrible sale por el
 *   canal de información del transporte antes de llamar al nativo.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import nacl from "tweetnacl";
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
import { decodeBase64, encodeBase64 } from "./base64";
import {
  NidoBluetoothTransport,
  buildHello,
  parseHello,
  type NidoP2PBindings,
} from "./nativeTransport";
import { buildConfirmV1, parseConfirm } from "./handshakeV3";
import { makeMemoryHelloNonceCache } from "./nonceCache";
import type { P2PTransportEvents } from "./transport";
import { derivePairKey, isSealedFrame, openWithPairKey, parseSealed, sealHandshakeFrame } from "./sealedHandshake";
import { networkAudit, parseStoredEntry, type NetworkAuditStore } from "../privacy/networkAudit";

type KP = { publicKey: Uint8Array; secretKey: Uint8Array };
const keys = vi.hoisted(() => ({
  me: null as unknown as KP,
  meSign: null as unknown as KP,
  peer: null as unknown as KP,
  peerSign: null as unknown as KP,
  state: { flag: false, capable: false, privateOnly: false },
}));
keys.me = nacl.box.keyPair();
keys.meSign = nacl.sign.keyPair();
keys.peer = nacl.box.keyPair();
keys.peerSign = nacl.sign.keyPair();
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const ME = hex(keys.me.publicKey);
const PEER = hex(keys.peer.publicKey);
const MAC = "AA:BB:CC:DD:EE:FF";
const LAN_ADDR = "LAN:192.168.1.5:41234";

vi.mock("./store", () => {
  const h = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  const peerContact = () => ({
    pkHex: h(keys.peer.publicKey),
    name: "Beto",
    verified: true,
    sigPkHex: h(keys.peerSign.publicKey),
    supersededBy: null,
    supersededAt: null,
  });
  return {
    getIdentity: async () => ({ publicKey: keys.me.publicKey, secretKey: keys.me.secretKey, name: "Yo" }),
    getSigningKeypair: async () => keys.meSign,
    findContactByPk: async (pk: string) => (pk.toLowerCase() === peerContact().pkHex ? peerContact() : null),
    listContacts: async () => [peerContact()],
    isContactV4Capable: async () => keys.state.capable,
    setContactV4Capable: async () => {},
    saveKnownMac: async () => {},
  };
});

vi.mock("../config/featureFlags", () => ({
  isFeatureEnabled: (f: string) =>
    (f === "p2p.sealedHandshake" && keys.state.flag) || (f === "p2p.privateHelloOnly" && keys.state.privateOnly),
  // T-14 (M-21): el respondedor lee el encendido EXPRESO; en este arnés el
  // estado privateOnly ES la elección del usuario.
  isFeatureExplicitlyEnabled: (f: string) => f === "p2p.privateHelloOnly" && keys.state.privateOnly,
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

function makeFake() {
  const listeners = new Map<string, Listener[]>();
  const sent: Array<{ address: string; base64: string }> = [];
  const emit = (event: string, payload: never) => {
    for (const fn of listeners.get(event) ?? []) fn(payload);
  };
  const calls: string[] = [];
  const fake: NidoP2PBindings = {
    isBluetoothEnabled: () => true,
    requestPermissions: async () => true,
    startDiscovery: async () => {},
    stopDiscovery: async () => {},
    startServer: async () => {},
    stopServer: async () => {},
    connect: async (address: string) => {
      emit("onConnected", { address, name: "Peer", incoming: false } as never);
      return { address, name: "Peer" };
    },
    sendFrame: async (address: string, base64: string) => {
      sent.push({ address, base64 });
    },
    disconnect: async () => {},
    shutdown: async () => {},
    getBondedDevices: async () => [],
    requestDiscoverable: async () => {
      calls.push("native-discoverable");
    },
    addListener: ((event: string, fn: Listener) => {
      const arr = listeners.get(event) ?? [];
      arr.push(fn);
      listeners.set(event, arr);
      return () => {
        listeners.set(event, (listeners.get(event) ?? []).filter((f) => f !== fn));
      };
    }) as NidoP2PBindings["addListener"],
  };
  return { fake, sent, emit, calls };
}

function makeEvents() {
  const handshakes: string[] = [];
  const errors: string[] = [];
  const infos: string[] = [];
  const events: P2PTransportEvents & { onInfo?: (m: string) => void } = {
    onPeerFound: () => {},
    onPeerLost: () => {},
    onFrame: () => {},
    onHandshakeComplete: (pk) => handshakes.push(pk),
    onError: (m) => {
      if (m !== "__discovery_finished__") errors.push(m);
    },
    onInfo: (m) => infos.push(m),
  };
  return { events, handshakes, errors, infos };
}

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const nowSec = () => Math.floor(Date.now() / 1000);
const wire = (b64: string) => new TextDecoder().decode(decodeBase64(b64));

/** Clave de pareja vista desde el peer (la misma que calcula el transporte). */
const peerPairKey = () => derivePairKey(keys.peer.secretKey, PEER, ME);

function peerHelloPlain(signer = keys.peerSign, pk = PEER): { bytes: Uint8Array; nonceHex: string } {
  const nonceHex = toHex(randomNonce(HANDSHAKE_NONCE_BYTES));
  const eph = toHex(generateEphemeral().publicKey);
  const ts = nowSec();
  const sig = toHex(signDetached(buildHelloSignMessageV3(pk, eph, nonceHex, ts), signer.secretKey));
  // Un iniciador 0.1.98 no anuncia `rs`: se quita del JSON que produce
  // nuestro buildHello (0.1.99) para simular su cable exacto.
  const obj = JSON.parse(new TextDecoder().decode(buildHello(pk, eph, nonceHex, ts, sig))) as Record<
    string,
    unknown
  >;
  delete obj.rs;
  return { bytes: new TextEncoder().encode(JSON.stringify(obj)), nonceHex };
}

/**
 * El HELLO en claro de un iniciador que anuncia `rs` tal como quedará en
 * el cable: JSON del HELLO v3 con el campo aditivo. Se construye a mano
 * para que la sonda no dependa de que buildHello ya lo emita.
 */
function peerHelloWithRs(): { bytes: Uint8Array; nonceHex: string } {
  const { bytes, nonceHex } = peerHelloPlain();
  const obj = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  obj.rs = 1;
  return { bytes: new TextEncoder().encode(JSON.stringify(obj)), nonceHex };
}

function peerConfirmPlain(peerNonceHex: string, myNonceHex: string): Uint8Array {
  const sig = toHex(
    signDetached(buildConfirmSignMessage(PEER, peerNonceHex, myNonceHex), keys.peerSign.secretKey),
  );
  return buildConfirmV1(PEER, peerNonceHex, myNonceHex, sig);
}

function openOurs(b64: string, kind: "hello" | "confirm"): Uint8Array {
  const opened = openWithPairKey(parseSealed(decodeBase64(b64)), peerPairKey(), kind);
  if (!opened) throw new Error("no abre con la clave de la pareja");
  return opened;
}

/** Almacén en memoria para el registro de red (sondas M-30). */
function memoryAuditStore(): NetworkAuditStore {
  const rows: string[] = [];
  return {
    append: async (e) => {
      rows.push(JSON.stringify(e));
    },
    loadBefore: async () => [],
    clear: async () => {
      rows.length = 0;
    },
  };
}

describe("T-13 · M-22 respuesta sellada al HELLO en claro que anuncia rs", () => {
  let f: ReturnType<typeof makeFake>;
  let ev: ReturnType<typeof makeEvents>;
  let t: NidoBluetoothTransport;

  beforeEach(() => {
    keys.state.flag = false;
    keys.state.capable = false;
    keys.state.privateOnly = false;
    f = makeFake();
    ev = makeEvents();
    t = new NidoBluetoothTransport(f.fake, { nonceCache: makeMemoryHelloNonceCache() });
  });

  it("nuestro HELLO anuncia rs (pista aditiva)", async () => {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "X", incoming: false } as never);
    await tick();
    expect(parseHello(decodeBase64(f.sent[0].base64)).rs).toBe(true);
    await t.stopDiscovery();
  });

  it("respondedor: HELLO en claro con rs → la respuesta sale sellada y el handshake se completa sellado", async () => {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "X", incoming: true } as never);
    await tick();
    const ph = peerHelloWithRs();
    f.emit("onFrame", { address: MAC, base64: encodeBase64(ph.bytes) } as never);
    await tick();
    expect(f.sent).toHaveLength(1);
    // Ningún byte en claro con nuestra identidad: el frame es un sobre sellado.
    expect(isSealedFrame(decodeBase64(f.sent[0].base64))).toBe(true);
    expect(wire(f.sent[0].base64)).not.toContain(ME);
    const ourHello = parseHello(openOurs(f.sent[0].base64, "hello"));
    expect(ourHello.pk).toBe(ME);
    // El CONFIRM del peer también debe venir sellado (sin vuelta a v3).
    f.emit("onFrame", {
      address: MAC,
      base64: encodeBase64(sealHandshakeFrame(peerPairKey(), "confirm", peerConfirmPlain(ph.nonceHex, ourHello.nonce))),
    } as never);
    await tick();
    expect(ev.handshakes).toEqual([PEER]);
    await t.stopDiscovery();
  });

  it("respondedor: HELLO en claro SIN rs (iniciador 0.1.98) → respuesta en claro, como hoy", async () => {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "X", incoming: true } as never);
    await tick();
    const ph = peerHelloPlain();
    f.emit("onFrame", { address: MAC, base64: encodeBase64(ph.bytes) } as never);
    await tick();
    expect(f.sent).toHaveLength(1);
    expect(isSealedFrame(decodeBase64(f.sent[0].base64))).toBe(false);
    expect(parseHello(decodeBase64(f.sent[0].base64)).pk).toBe(ME);
    await t.stopDiscovery();
  });

  it("replay: el HELLO capturado, replayado ante OTRO aparato del mismo contacto, solo obtiene respuesta sellada", async () => {
    // El aparato C: otra identidad, la misma lista de contactos (el mismo Beto).
    const captured = peerHelloWithRs();
    const cId = nacl.box.keyPair();
    const cSign = nacl.sign.keyPair();
    const savedMe = keys.me;
    const savedSign = keys.meSign;
    keys.me = cId;
    keys.meSign = cSign;
    try {
      const fc = makeFake();
      const evc = makeEvents();
      const tc = new NidoBluetoothTransport(fc.fake, { nonceCache: makeMemoryHelloNonceCache() });
      await tc.startDiscovery(evc.events);
      fc.emit("onConnected", { address: MAC, name: "X", incoming: true } as never);
      await tick();
      fc.emit("onFrame", { address: MAC, base64: encodeBase64(captured.bytes) } as never);
      await tick();
      expect(fc.sent).toHaveLength(1);
      const cPk = hex(cId.publicKey);
      expect(wire(fc.sent[0].base64)).not.toContain(cPk);
      expect(isSealedFrame(decodeBase64(fc.sent[0].base64))).toBe(true);
      // Y lo sellado solo lo abre la clave de pareja Beto↔C.
      const cPairKey = derivePairKey(keys.peer.secretKey, PEER, cPk);
      const opened = openWithPairKey(parseSealed(decodeBase64(fc.sent[0].base64)), cPairKey, "hello");
      expect(opened).not.toBeNull();
      expect(parseHello(opened!).pk).toBe(cPk);
      await tc.stopDiscovery();
    } finally {
      keys.me = savedMe;
      keys.meSign = savedSign;
    }
  });

  it("iniciador: llamamos en claro y el respondedor contesta sellado → adoptamos la clave y el handshake se completa", async () => {
    keys.state.capable = false; // sin marca v4: nuestro HELLO sale en claro
    await t.startDiscovery(ev.events);
    const p = t.connect(MAC, { targetPkHex: PEER }).catch(() => {});
    await tick();
    expect(f.sent).toHaveLength(1);
    const ourHello = parseHello(decodeBase64(f.sent[0].base64));
    expect(ourHello.pk).toBe(ME);
    // El respondedor (0.1.99) contesta sellado con la clave de pareja.
    const ph = peerHelloPlain();
    f.emit("onFrame", {
      address: MAC,
      base64: encodeBase64(sealHandshakeFrame(peerPairKey(), "hello", ph.bytes)),
    } as never);
    await tick();
    // Nuestro CONFIRM sale sellado con la clave adoptada.
    expect(f.sent).toHaveLength(2);
    expect(isSealedFrame(decodeBase64(f.sent[1].base64))).toBe(true);
    const ourConfirm = parseConfirm(openOurs(f.sent[1].base64, "confirm"));
    expect(ourConfirm.pn).toBe(ph.nonceHex);
    // Y el CONFIRM del peer, sellado, cierra el handshake.
    f.emit("onFrame", {
      address: MAC,
      base64: encodeBase64(
        sealHandshakeFrame(peerPairKey(), "confirm", peerConfirmPlain(ph.nonceHex, ourHello.nonce)),
      ),
    } as never);
    await tick();
    expect(ev.handshakes).toEqual([PEER]);
    await t.stopDiscovery();
    await p;
  });

  it("iniciador: si el respondedor contesta en claro (0.1.98), el handshake sigue como hoy (control)", async () => {
    keys.state.capable = false;
    await t.startDiscovery(ev.events);
    const p = t.connect(MAC, { targetPkHex: PEER }).catch(() => {});
    await tick();
    const ourHello = parseHello(decodeBase64(f.sent[0].base64));
    const ph = peerHelloPlain();
    f.emit("onFrame", { address: MAC, base64: encodeBase64(ph.bytes) } as never);
    await tick();
    expect(f.sent).toHaveLength(2);
    expect(isSealedFrame(decodeBase64(f.sent[1].base64))).toBe(false);
    f.emit("onFrame", {
      address: MAC,
      base64: encodeBase64(peerConfirmPlain(ph.nonceHex, ourHello.nonce)),
    } as never);
    await tick();
    expect(ev.handshakes).toEqual([PEER]);
    await t.stopDiscovery();
    await p;
  });
});

describe("T-13 · M-30 el registro de red registra Bluetooth y descubrimiento", () => {
  let f: ReturnType<typeof makeFake>;
  let ev: ReturnType<typeof makeEvents>;
  let t: NidoBluetoothTransport;

  beforeEach(() => {
    networkAudit._resetForTests(memoryAuditStore());
    f = makeFake();
    ev = makeEvents();
    t = new NidoBluetoothTransport(f.fake, { nonceCache: makeMemoryHelloNonceCache() });
  });

  it("los tipos nuevos sobreviven a la persistencia (parseStoredEntry)", () => {
    const base = { ts: new Date().toISOString(), endpoint: "x", assetId: "", bytesExpected: 0, bytesReceived: 0 };
    expect(parseStoredEntry(JSON.stringify({ ...base, kind: "bt_connect" }))?.kind).toBe("bt_connect");
    expect(parseStoredEntry(JSON.stringify({ ...base, kind: "discovery" }))?.kind).toBe("discovery");
  });

  it("una conexión Bluetooth deja entrada bt_connect; una LAN deja lan_connect (control)", async () => {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "X", incoming: true } as never);
    await tick();
    f.emit("onConnected", { address: LAN_ADDR, name: "Y", incoming: false } as never);
    await tick();
    const kinds = networkAudit.list().map((e) => e.kind);
    expect(kinds).toContain("bt_connect");
    expect(kinds).toContain("lan_connect");
    const bt = networkAudit.list().find((e) => e.kind === "bt_connect");
    expect(bt?.endpoint).toContain(MAC);
    await t.stopDiscovery();
  });

  it("arrancar el descubrimiento deja UNA entrada discovery por activación", async () => {
    await t.startDiscovery(ev.events);
    const found = networkAudit.list().filter((e) => e.kind === "discovery");
    expect(found).toHaveLength(1);
    await t.stopDiscovery();
  });
});

describe("T-13 · m-35 aviso previo a hacerse descubrible (parte TS)", () => {
  it("requestDiscoverable avisa por onInfo ANTES de llamar al nativo", async () => {
    const f = makeFake();
    const ev = makeEvents();
    const order: string[] = [];
    ev.events.onInfo = (m) => {
      ev.infos.push(m);
      order.push("info");
    };
    const orig = f.fake.requestDiscoverable!;
    f.fake.requestDiscoverable = async () => {
      order.push("native");
      return orig();
    };
    const t = new NidoBluetoothTransport(f.fake, { nonceCache: makeMemoryHelloNonceCache() });
    await t.startDiscovery(ev.events);
    await t.requestDiscoverable();
    expect(order).toEqual(["info", "native"]);
    expect(ev.infos[0]).toMatch(/visible/i);
    await t.stopDiscovery();
  });
});
