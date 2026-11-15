/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * T-14 (0.1.99) · M-21 en el transporte REAL, con el módulo de banderas
 * REAL (sin mock): lo que se mide es el DEFECTO nuevo y la rama sellada
 * en la preparación (la iniciación se endurece por defecto; el lado
 * respondedor solo endurece con el encendido EXPRESO del usuario).
 *
 *  - Sin elección del usuario: no se llama en claro a un contacto con un
 *    NIDO antiguo ni a un dispositivo desconocido (el ajuste «Solo
 *    saludo privado» manda desde la instalación).
 *  - Sin elección del usuario: un saludo en claro entrante SE SIGUE
 *    contestando (los NIDO antiguos no se quedan fuera por el defecto;
 *    solo el encendido expreso del ajuste los rechaza).
 *  - Con el ajuste apagado a mano: se llama en claro como hasta la
 *    0.1.98 (la elección del usuario manda sobre el defecto).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import nacl from "tweetnacl";
import {
  buildHelloSignMessageV3,
  generateEphemeral,
  generateSigningKeypair,
  randomNonce,
  signDetached,
  toHex,
  HANDSHAKE_NONCE_BYTES,
} from "./crypto";
import { decodeBase64, encodeBase64 } from "./base64";
import { NidoBluetoothTransport, buildHello, parseHello, type NidoP2PBindings } from "./nativeTransport";
import { makeMemoryHelloNonceCache } from "./nonceCache";
import type { P2PTransportEvents } from "./transport";
import { PRIVATE_ONLY_NO_TARGET, PRIVATE_ONLY_OLD_CONTACT } from "./privateHello";
import {
  resetFeatureFlagsForTests,
  setFeatureOverrideForTests,
} from "../config/featureFlags";

type KP = { publicKey: Uint8Array; secretKey: Uint8Array };
const keys = vi.hoisted(() => ({
  me: null as unknown as KP,
  meSign: null as unknown as KP,
  peer: null as unknown as KP,
  peerSign: null as unknown as KP,
  state: { capable: false },
}));
keys.me = nacl.box.keyPair();
keys.meSign = nacl.sign.keyPair();
keys.peer = nacl.box.keyPair();
keys.peerSign = nacl.sign.keyPair();
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const ME = hex(keys.me.publicKey);
const PEER = hex(keys.peer.publicKey);
const MAC = "AA:BB:CC:DD:EE:FF";
const STRANGER_MAC = "11:22:33:44:55:66";

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
    addListener: ((event: string, fn: Listener) => {
      const arr = listeners.get(event) ?? [];
      arr.push(fn);
      listeners.set(event, arr);
      return () => {
        listeners.set(event, (listeners.get(event) ?? []).filter((f) => f !== fn));
      };
    }) as NidoP2PBindings["addListener"],
  };
  return { fake, sent, emit };
}

function makeEvents() {
  const handshakes: string[] = [];
  const events: P2PTransportEvents = {
    onPeerFound: () => {},
    onPeerLost: () => {},
    onFrame: () => {},
    onHandshakeComplete: (pk) => handshakes.push(pk),
    onError: () => {},
  };
  return { events, handshakes };
}

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const nowSec = () => Math.floor(Date.now() / 1000);
const wire = (b64: string) => new TextDecoder().decode(decodeBase64(b64));

/** Saludo en claro «de época 0.1.98»: sin el disparador `rs` de T-13. */
function peerHelloPlain(): Uint8Array {
  const nonceHex = toHex(randomNonce(HANDSHAKE_NONCE_BYTES));
  const eph = toHex(generateEphemeral().publicKey);
  const ts = nowSec();
  const sig = toHex(signDetached(buildHelloSignMessageV3(PEER, eph, nonceHex, ts), keys.peerSign.secretKey));
  const obj = JSON.parse(new TextDecoder().decode(buildHello(PEER, eph, nonceHex, ts, sig))) as Record<string, unknown>;
  delete obj.rs;
  return new TextEncoder().encode(JSON.stringify(obj));
}

describe("T-14 · M-21: el defecto nuevo en el transporte (banderas reales)", () => {
  let f: ReturnType<typeof makeFake>;
  let ev: ReturnType<typeof makeEvents>;
  let t: NidoBluetoothTransport;

  beforeEach(() => {
    // Mundo por defecto: ninguna elección del usuario.
    resetFeatureFlagsForTests();
    keys.state.capable = false;
    f = makeFake();
    ev = makeEvents();
    t = new NidoBluetoothTransport(f.fake, { nonceCache: makeMemoryHelloNonceCache() });
  });

  it("por defecto NO se llama a un contacto con un NIDO antiguo (ni un byte sale)", async () => {
    keys.state.capable = false;
    await t.startDiscovery(ev.events);
    await expect(t.connect(MAC, { targetPkHex: PEER })).rejects.toThrow(PRIVATE_ONLY_OLD_CONTACT);
    expect(f.sent).toHaveLength(0);
    await t.stopDiscovery();
  });

  it("por defecto NO se llama a un dispositivo sin contacto conocido", async () => {
    await t.startDiscovery(ev.events);
    await expect(t.connect(STRANGER_MAC)).rejects.toThrow(PRIVATE_ONLY_NO_TARGET);
    expect(f.sent).toHaveLength(0);
    await t.stopDiscovery();
  });

  it("por defecto, a un contacto que lo admite se le llama con saludo SELLADO", async () => {
    keys.state.capable = true;
    await t.startDiscovery(ev.events);
    const p = t.connect(MAC, { targetPkHex: PEER }).catch(() => {});
    await tick();
    expect(f.sent).toHaveLength(1);
    expect(wire(f.sent[0].base64)).not.toContain(ME);
    await t.stopDiscovery();
    await p;
  });

  it("por defecto, un saludo en claro entrante SE SIGUE contestando (la rama sellada)", async () => {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "X", incoming: true } as never);
    await tick();
    f.emit("onFrame", { address: MAC, base64: encodeBase64(peerHelloPlain()) } as never);
    await tick();
    expect(f.sent).toHaveLength(1);
    expect(parseHello(decodeBase64(f.sent[0].base64)).pk).toBe(ME);
    await t.stopDiscovery();
  });

  it("con el ajuste ENCENDIDO a mano, un saludo en claro entrante no recibe ni un byte", async () => {
    setFeatureOverrideForTests("p2p.privateHelloOnly", true);
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "X", incoming: true } as never);
    await tick();
    f.emit("onFrame", { address: MAC, base64: encodeBase64(peerHelloPlain()) } as never);
    await tick();
    expect(f.sent).toHaveLength(0);
    expect(ev.handshakes).toHaveLength(0);
    await t.stopDiscovery();
  });

  it("con el ajuste APAGADO a mano, se llama en claro a un contacto antiguo (la elección manda)", async () => {
    setFeatureOverrideForTests("p2p.privateHelloOnly", false);
    keys.state.capable = false;
    await t.startDiscovery(ev.events);
    const p = t.connect(MAC, { targetPkHex: PEER }).catch(() => {});
    await tick();
    expect(f.sent).toHaveLength(1);
    expect(wire(f.sent[0].base64)).toContain(ME);
    await t.stopDiscovery();
    await p;
  });
});
