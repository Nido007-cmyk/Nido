/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.48 — CONFIRM v2 dentro del transporte real, contra un peer guionizado.
 *
 * La verificación formal (formal/nido_handshake.pv, consultas 6-7) encontró
 * un "unknown key share": la firma del CONFIRM v1 no nombra al destinatario.
 * La firma v2 ("s2") sí. Aquí se comprueba:
 *  - nuestro CONFIRM lleva las dos firmas y la v2 nombra al peer;
 *  - un CONFIRM v2 hecho para OTRO destinatario se rechaza (el ataque);
 *  - un NIDO viejo (sin s2) sigue conectando mientras no se le conozca v2;
 *  - un contacto que ya firmó v2 y llega sin ella se rechaza (degradación);
 *  - el transporte avisa al messenger si la v2 verificó.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import nacl from "tweetnacl";
import {
  buildConfirmSignMessage,
  buildConfirmSignMessageV2,
  buildHelloSignMessageV3,
  generateEphemeral,
  fromHex,
  randomNonce,
  signDetached,
  toHex,
  HANDSHAKE_NONCE_BYTES,
} from "./crypto";
import { decodeBase64, encodeBase64 } from "./base64";
import { NidoBluetoothTransport, buildHello, parseHello, type NidoP2PBindings } from "./nativeTransport";
import { buildConfirmV1, parseConfirm } from "./handshakeV3";
import { makeMemoryHelloNonceCache } from "./nonceCache";
import type { P2PTransportEvents } from "./transport";

type KP = { publicKey: Uint8Array; secretKey: Uint8Array };
// vi.hoisted corre antes de los imports: las claves se generan después, y los
// mocks las leen en el momento de cada llamada.
const keys = vi.hoisted(() => ({
  me: null as unknown as KP,
  meSign: null as unknown as KP,
  peer: null as unknown as KP,
  peerSign: null as unknown as KP,
  state: {
    flag: false,
    capable: false,
    capabilityWrites: [] as Array<[string, boolean]>,
    v2Marked: false,
    v2Writes: [] as string[],
    v2LookupFails: false,
  },
}));
keys.me = nacl.box.keyPair();
keys.meSign = nacl.sign.keyPair();
keys.peer = nacl.box.keyPair();
keys.peerSign = nacl.sign.keyPair();
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const ME = hex(keys.me.publicKey);
const PEER = hex(keys.peer.publicKey);
const MAC = "AA:BB:CC:DD:EE:FF";

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
    setContactV4Capable: async (pk: string, v: boolean) => {
      keys.state.capabilityWrites.push([pk, v]);
    },
    saveKnownMac: async () => {},
    isContactConfirmV2: async () => {
      if (keys.state.v2LookupFails) throw new Error("db rota");
      return keys.state.v2Marked;
    },
    setContactConfirmV2: async (pk: string) => {
      keys.state.v2Writes.push(pk);
    },
  };
});

vi.mock("../config/featureFlags", () => ({
  isFeatureEnabled: (f: string) => f === "p2p.sealedHandshake" && keys.state.flag,
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
  const disconnected: string[] = [];
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
    disconnect: async (address: string) => {
      disconnected.push(address);
    },
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
  return { fake, sent, disconnected, emit };
}

function makeEvents() {
  const handshakes: Array<{ pk: string; v2: boolean | undefined }> = [];
  const errors: string[] = [];
  const events: P2PTransportEvents = {
    onPeerFound: () => {},
    onPeerLost: () => {},
    onFrame: () => {},
    onHandshakeComplete: (pk, _s, _e, _mn, _tn, v2) => handshakes.push({ pk, v2 }),
    onError: (m) => {
      if (m !== "__discovery_finished__") errors.push(m);
    },
  };
  return { events, handshakes, errors };
}

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const nowSec = () => Math.floor(Date.now() / 1000);

function peerHello(): { b64: string; nonceHex: string } {
  const nonceHex = toHex(randomNonce(HANDSHAKE_NONCE_BYTES));
  const eph = toHex(generateEphemeral().publicKey);
  const ts = nowSec();
  const sig = toHex(signDetached(buildHelloSignMessageV3(PEER, eph, nonceHex, ts), keys.peerSign.secretKey));
  return { b64: encodeBase64(buildHello(PEER, eph, nonceHex, ts, sig)), nonceHex };
}

/** CONFIRM del peer. `to` = destinatario que nombra la firma v2; null = sin v2 (NIDO viejo). */
function peerConfirm(peerNonceHex: string, myNonceHex: string, to: string | null, s2Override?: string): string {
  const sig = toHex(signDetached(buildConfirmSignMessage(PEER, peerNonceHex, myNonceHex), keys.peerSign.secretKey));
  const s2 =
    s2Override ??
    (to === null
      ? undefined
      : toHex(signDetached(buildConfirmSignMessageV2(PEER, to, peerNonceHex, myNonceHex), keys.peerSign.secretKey)));
  return encodeBase64(buildConfirmV1(PEER, peerNonceHex, myNonceHex, sig, s2));
}

describe("0.1.48: CONFIRM v2 (firma con destinatario)", () => {
  let f: ReturnType<typeof makeFake>;
  let ev: ReturnType<typeof makeEvents>;
  let t: NidoBluetoothTransport;

  beforeEach(() => {
    keys.state.v2Marked = false;
    keys.state.v2Writes.length = 0;
    keys.state.v2LookupFails = false;
    f = makeFake();
    ev = makeEvents();
    t = new NidoBluetoothTransport(f.fake, { nonceCache: makeMemoryHelloNonceCache() });
  });

  /** Iniciador: mandamos HELLO, llega el del peer, mandamos CONFIRM. */
  async function upToOurConfirm(): Promise<{ ph: { nonceHex: string }; myNonce: string }> {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "Beto", incoming: false } as never);
    await tick();
    const myNonce = parseHello(decodeBase64(f.sent[0].base64)).nonce;
    const ph = peerHello();
    f.emit("onFrame", { address: MAC, base64: ph.b64 } as never);
    await tick();
    return { ph, myNonce };
  }

  it("nuestro CONFIRM lleva la firma v1 y la v2, y la v2 nombra al peer", async () => {
    const { ph, myNonce } = await upToOurConfirm();
    const ours = parseConfirm(decodeBase64(f.sent[1].base64));
    expect(ours.s2).toMatch(/^[0-9a-f]{128}$/);
    const v2 = buildConfirmSignMessageV2(ME, PEER, myNonce, ph.nonceHex);
    expect(nacl.sign.detached.verify(v2, fromHex(ours.s2!), keys.meSign.publicKey)).toBe(true);
    // Y la v1 sigue siendo la de siempre (la que verifica un NIDO viejo).
    const v1 = buildConfirmSignMessage(ME, myNonce, ph.nonceHex);
    expect(nacl.sign.detached.verify(v1, fromHex(ours.sig), keys.meSign.publicKey)).toBe(true);
    await t.stopDiscovery();
  });

  it("CONFIRM v2 válido: ruta establecida, contacto marcado y el messenger lo sabe", async () => {
    const { ph, myNonce } = await upToOurConfirm();
    f.emit("onFrame", { address: MAC, base64: peerConfirm(ph.nonceHex, myNonce, ME) } as never);
    await tick();
    expect(ev.handshakes).toEqual([{ pk: PEER, v2: true }]);
    expect(keys.state.v2Writes).toEqual([PEER]);
    await t.stopDiscovery();
  });

  it("ataque: CONFIRM v2 firmado para OTRO destinatario se rechaza", async () => {
    const { ph, myNonce } = await upToOurConfirm();
    const otro = toHex(nacl.box.keyPair().publicKey);
    f.emit("onFrame", { address: MAC, base64: peerConfirm(ph.nonceHex, myNonce, otro) } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(0);
    expect(ev.errors.join(" ")).toMatch(/no iba dirigida a este teléfono/);
    expect(f.disconnected).toContain(MAC);
    expect(keys.state.v2Writes).toHaveLength(0);
    await t.stopDiscovery();
  });

  it("firma v2 basura (bien formada) se rechaza", async () => {
    const { ph, myNonce } = await upToOurConfirm();
    f.emit("onFrame", { address: MAC, base64: peerConfirm(ph.nonceHex, myNonce, ME, "ab".repeat(64)) } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(0);
    await t.stopDiscovery();
  });

  it("NIDO viejo (sin v2) y contacto sin marcar: conecta como siempre", async () => {
    const { ph, myNonce } = await upToOurConfirm();
    f.emit("onFrame", { address: MAC, base64: peerConfirm(ph.nonceHex, myNonce, null) } as never);
    await tick();
    expect(ev.handshakes).toEqual([{ pk: PEER, v2: false }]);
    expect(keys.state.v2Writes).toHaveLength(0);
    await t.stopDiscovery();
  });

  it("degradación: contacto que ya firmó v2 llega sin ella → rechazado", async () => {
    keys.state.v2Marked = true;
    const { ph, myNonce } = await upToOurConfirm();
    f.emit("onFrame", { address: MAC, base64: peerConfirm(ph.nonceHex, myNonce, null) } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(0);
    expect(ev.errors.join(" ")).toMatch(/degradación/);
    expect(f.disconnected).toContain(MAC);
    await t.stopDiscovery();
  });

  it("si no se puede leer la marca, un CONFIRM sin v2 se rechaza (fail-closed)", async () => {
    keys.state.v2LookupFails = true;
    const { ph, myNonce } = await upToOurConfirm();
    f.emit("onFrame", { address: MAC, base64: peerConfirm(ph.nonceHex, myNonce, null) } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(0);
    await t.stopDiscovery();
  });

  it("respondedor: también exige y verifica la v2 antes de soltar su CONFIRM", async () => {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "Beto", incoming: true } as never);
    await tick();
    const ph = peerHello();
    f.emit("onFrame", { address: MAC, base64: ph.b64 } as never);
    await tick();
    const ourHello = parseHello(decodeBase64(f.sent[0].base64));
    const otro = toHex(nacl.box.keyPair().publicKey);
    f.emit("onFrame", { address: MAC, base64: peerConfirm(ph.nonceHex, ourHello.nonce, otro) } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(0);
    // Nuestro CONFIRM nunca salió: solo el HELLO.
    expect(f.sent).toHaveLength(1);
    await t.stopDiscovery();
  });
});
