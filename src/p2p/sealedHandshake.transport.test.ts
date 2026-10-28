/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * P2P v4 (saludo sellado) dentro del transporte real, contra un peer
 * guionizado. Comprueba que, con el saludo sellado, NINGÚN byte que sale de
 * este teléfono contiene su identidad, y que el handshake v3 de dentro
 * (firmas, nonces, CONFIRM) sigue verificándose igual.
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
  reconnectDelayMs,
  type NidoP2PBindings,
} from "./nativeTransport";
import { buildConfirmV1, parseConfirm } from "./handshakeV3";
import { makeMemoryHelloNonceCache } from "./nonceCache";
import type { P2PTransportEvents } from "./transport";
import { derivePairKey, openWithPairKey, parseSealed, sealHandshakeFrame } from "./sealedHandshake";
import {
  PRIVATE_CHECK_FAILED,
  PRIVATE_ONLY_NO_TARGET,
  PRIVATE_ONLY_OLD_CONTACT,
} from "./privateHello";

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
    capableThrows: false,
    privateOnly: false,
    capabilityWrites: [] as Array<[string, boolean]>,
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
    isContactV4Capable: async () => {
      if (keys.state.capableThrows) throw new Error("db locked");
      return keys.state.capable;
    },
    setContactV4Capable: async (pk: string, v: boolean) => {
      keys.state.capabilityWrites.push([pk, v]);
    },
    saveKnownMac: async () => {},
  };
});

vi.mock("../config/featureFlags", () => ({
  isFeatureEnabled: (f: string) =>
    (f === "p2p.sealedHandshake" && keys.state.flag) || (f === "p2p.privateHelloOnly" && keys.state.privateOnly),
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
  const handshakes: string[] = [];
  const errors: string[] = [];
  const events: P2PTransportEvents = {
    onPeerFound: () => {},
    onPeerLost: () => {},
    onFrame: () => {},
    onHandshakeComplete: (pk) => handshakes.push(pk),
    onError: (m) => {
      if (m !== "__discovery_finished__") errors.push(m);
    },
  };
  return { events, handshakes, errors };
}

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const nowSec = () => Math.floor(Date.now() / 1000);
const wire = (b64: string) => new TextDecoder().decode(decodeBase64(b64));

/** Clave de pareja vista desde el peer (la misma que calcula el transporte). */
const peerPairKey = () => derivePairKey(keys.peer.secretKey, PEER, ME);

function peerHelloPlain(signer = keys.peerSign, pk = PEER): { bytes: Uint8Array; nonceHex: string } {
  const nonceHex = toHex(randomNonce(HANDSHAKE_NONCE_BYTES));
  const eph = toHex(generateEphemeral().publicKey);
  const ts = nowSec();
  const sig = toHex(signDetached(buildHelloSignMessageV3(pk, eph, nonceHex, ts), signer.secretKey));
  return { bytes: buildHello(pk, eph, nonceHex, ts, sig), nonceHex };
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

describe("P2P v4 en el transporte", () => {
  let f: ReturnType<typeof makeFake>;
  let ev: ReturnType<typeof makeEvents>;
  let t: NidoBluetoothTransport;

  beforeEach(() => {
    keys.state.flag = false;
    keys.state.capable = false;
    keys.state.capableThrows = false;
    keys.state.privateOnly = false;
    keys.state.capabilityWrites.length = 0;
    f = makeFake();
    ev = makeEvents();
    t = new NidoBluetoothTransport(f.fake, { nonceCache: makeMemoryHelloNonceCache() });
  });

  it("el HELLO de siempre anuncia que entendemos el saludo sellado (c4)", async () => {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "X", incoming: false } as never);
    await tick();
    expect(parseHello(decodeBase64(f.sent[0].base64)).c4).toBe(true);
    await t.stopDiscovery();
  });

  it("respondedor: un saludo sellado de un contacto se responde sellado y nada revela nuestra identidad", async () => {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "X", incoming: true } as never);
    await tick();
    const ph = peerHelloPlain();
    f.emit("onFrame", {
      address: MAC,
      base64: encodeBase64(sealHandshakeFrame(peerPairKey(), "hello", ph.bytes)),
    } as never);
    await tick();
    expect(f.sent).toHaveLength(1);
    expect(wire(f.sent[0].base64)).not.toContain(ME);
    const ourHello = parseHello(openOurs(f.sent[0].base64, "hello"));
    expect(ourHello.pk).toBe(ME);
    f.emit("onFrame", {
      address: MAC,
      base64: encodeBase64(
        sealHandshakeFrame(peerPairKey(), "confirm", peerConfirmPlain(ph.nonceHex, ourHello.nonce)),
      ),
    } as never);
    await tick();
    expect(f.sent).toHaveLength(2);
    expect(wire(f.sent[1].base64)).not.toContain(ME);
    const ourConfirm = parseConfirm(openOurs(f.sent[1].base64, "confirm"));
    expect(ourConfirm.pn).toBe(ph.nonceHex);
    expect(ev.handshakes).toEqual([PEER]);
    expect(keys.state.capabilityWrites).toContainEqual([PEER, true]);
    await t.stopDiscovery();
  });

  it("respondedor: un saludo sellado de quien no es contacto no recibe ni un byte", async () => {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: STRANGER_MAC, name: "X", incoming: true } as never);
    await tick();
    const stranger = nacl.box.keyPair();
    const key = derivePairKey(stranger.secretKey, toHex(stranger.publicKey), ME);
    const sign = generateSigningKeypair();
    const h = peerHelloPlain(sign, toHex(stranger.publicKey));
    f.emit("onFrame", {
      address: STRANGER_MAC,
      base64: encodeBase64(sealHandshakeFrame(key, "hello", h.bytes)),
    } as never);
    await tick();
    expect(f.sent).toHaveLength(0);
    expect(ev.handshakes).toHaveLength(0);
    await t.stopDiscovery();
  });

  it("respondedor: tras un saludo sellado, un CONFIRM en claro se rechaza (sin vuelta a v3)", async () => {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "X", incoming: true } as never);
    await tick();
    const ph = peerHelloPlain();
    f.emit("onFrame", {
      address: MAC,
      base64: encodeBase64(sealHandshakeFrame(peerPairKey(), "hello", ph.bytes)),
    } as never);
    await tick();
    const ourHello = parseHello(openOurs(f.sent[0].base64, "hello"));
    f.emit("onFrame", {
      address: MAC,
      base64: encodeBase64(peerConfirmPlain(ph.nonceHex, ourHello.nonce)),
    } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(0);
    expect(f.sent).toHaveLength(1);
    await t.stopDiscovery();
  });

  it("iniciador con el interruptor apagado: saludo de siempre (v3) aunque el contacto lo soporte", async () => {
    keys.state.capable = true;
    await t.startDiscovery(ev.events);
    const p = t.connect(MAC, { targetPkHex: PEER }).catch(() => {});
    await tick();
    expect(parseHello(decodeBase64(f.sent[0].base64)).pk).toBe(ME);
    await t.stopDiscovery();
    await p;
  });

  it("iniciador con el interruptor encendido pero contacto sin soporte: v3", async () => {
    keys.state.flag = true;
    await t.startDiscovery(ev.events);
    const p = t.connect(MAC, { targetPkHex: PEER }).catch(() => {});
    await tick();
    expect(parseHello(decodeBase64(f.sent[0].base64)).pk).toBe(ME);
    await t.stopDiscovery();
    await p;
  });

  it("iniciador v4: todo el saludo va sellado y la ruta se establece", async () => {
    keys.state.flag = true;
    keys.state.capable = true;
    await t.startDiscovery(ev.events);
    const connected = t.connect(MAC, { targetPkHex: PEER });
    await tick();
    expect(f.sent).toHaveLength(1);
    expect(wire(f.sent[0].base64)).not.toContain(ME);
    const ourHello = parseHello(openOurs(f.sent[0].base64, "hello"));
    expect(ourHello.pk).toBe(ME);
    // El peer responde sellado con su HELLO…
    const ph = peerHelloPlain();
    f.emit("onFrame", {
      address: MAC,
      base64: encodeBase64(sealHandshakeFrame(peerPairKey(), "hello", ph.bytes)),
    } as never);
    await tick();
    // …nosotros mandamos CONFIRM sellado…
    expect(f.sent).toHaveLength(2);
    expect(wire(f.sent[1].base64)).not.toContain(ME);
    const ourConfirm = parseConfirm(openOurs(f.sent[1].base64, "confirm"));
    expect(ourConfirm.cn).toBe(ourHello.nonce);
    expect(ourConfirm.pn).toBe(ph.nonceHex);
    // …y su CONFIRM sellado cierra el saludo.
    f.emit("onFrame", {
      address: MAC,
      base64: encodeBase64(
        sealHandshakeFrame(peerPairKey(), "confirm", peerConfirmPlain(ph.nonceHex, ourHello.nonce)),
      ),
    } as never);
    const info = await connected;
    expect(info.pkHex).toBe(PEER);
    expect(ev.handshakes).toEqual([PEER]);
    await t.stopDiscovery();
  });

  it("iniciador v4: si el otro responde en claro, se corta (sin vuelta a v3)", async () => {
    keys.state.flag = true;
    keys.state.capable = true;
    await t.startDiscovery(ev.events);
    const connected = t.connect(MAC, { targetPkHex: PEER });
    await tick();
    const ph = peerHelloPlain();
    f.emit("onFrame", { address: MAC, base64: encodeBase64(ph.bytes) } as never);
    await expect(connected).rejects.toThrow(/privado/i);
    expect(ev.handshakes).toHaveLength(0);
    expect(f.sent).toHaveLength(1);
    await t.stopDiscovery();
  });

  it("0.1.52: un HELLO sin c4 NO desmarca al contacto (la pista c4 no va firmada y un atacante puede quitarla)", async () => {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "X", incoming: true } as never);
    await tick();
    const nonceHex = toHex(randomNonce(HANDSHAKE_NONCE_BYTES));
    const eph = toHex(generateEphemeral().publicKey);
    const ts = nowSec();
    const sig = toHex(signDetached(buildHelloSignMessageV3(PEER, eph, nonceHex, ts), keys.peerSign.secretKey));
    const oldHello = new TextEncoder().encode(
      JSON.stringify({ t: "nido-hello", v: 3, pk: PEER, eph, nonce: nonceHex, ts, sig }),
    );
    f.emit("onFrame", { address: MAC, base64: encodeBase64(oldHello) } as never);
    await tick();
    const ourHello = parseHello(decodeBase64(f.sent[0].base64));
    f.emit("onFrame", {
      address: MAC,
      base64: encodeBase64(peerConfirmPlain(nonceHex, ourHello.nonce)),
    } as never);
    await tick();
    expect(ev.handshakes).toEqual([PEER]);
    expect(keys.state.capabilityWrites).not.toContainEqual([PEER, false]);
    await t.stopDiscovery();
  });

  /* ---------- 0.1.55 (P-04): cierre del saludo privado ---------- */

  it("0.1.55: si no se puede comprobar la marca del contacto, NO se llama (antes salía el saludo en claro)", async () => {
    keys.state.flag = true;
    keys.state.capableThrows = true;
    await t.startDiscovery(ev.events);
    await expect(t.connect(MAC, { targetPkHex: PEER })).rejects.toThrow(PRIVATE_CHECK_FAILED);
    expect(f.sent).toHaveLength(0);
    await t.stopDiscovery();
  });

  it("0.1.55: la reconexión automática llama con saludo sellado a un contacto que lo admite", async () => {
    keys.state.flag = true;
    keys.state.capable = true;
    await t.startDiscovery(ev.events);
    // Ruta viva con el contacto (el handshake completo se prueba arriba).
    (t as any).macToPk.set(MAC, PEER);
    (t as any).pkToMac.set(PEER, MAC);
    vi.useFakeTimers();
    try {
      f.emit("onDisconnected", { address: MAC } as never);
      // Solo hasta el primer reintento (sin llegar al timeout del saludo).
      await vi.advanceTimersByTimeAsync(reconnectDelayMs(0) + 50);
    } finally {
      vi.useRealTimers();
    }
    await tick();
    expect(f.sent.length).toBeGreaterThanOrEqual(1);
    // Antes: HELLO en claro con nuestra pk. Ahora: sobre sellado.
    expect(wire(f.sent[0].base64)).not.toContain(ME);
    expect(parseHello(openOurs(f.sent[0].base64, "hello")).pk).toBe(ME);
    await t.stopDiscovery();
  });

  it("0.1.55 «Solo saludo privado»: no llama a un dispositivo sin contacto conocido", async () => {
    keys.state.flag = true;
    keys.state.privateOnly = true;
    await t.startDiscovery(ev.events);
    await expect(t.connect(STRANGER_MAC)).rejects.toThrow(PRIVATE_ONLY_NO_TARGET);
    expect(f.sent).toHaveLength(0);
    await t.stopDiscovery();
  });

  it("0.1.55 «Solo saludo privado»: no llama a un contacto con un NIDO antiguo", async () => {
    keys.state.flag = true;
    keys.state.privateOnly = true;
    keys.state.capable = false;
    await t.startDiscovery(ev.events);
    await expect(t.connect(MAC, { targetPkHex: PEER })).rejects.toThrow(PRIVATE_ONLY_OLD_CONTACT);
    expect(f.sent).toHaveLength(0);
    await t.stopDiscovery();
  });

  it("0.1.55 «Solo saludo privado» implica sellar aunque el interruptor del saludo sellado esté apagado", async () => {
    keys.state.flag = false;
    keys.state.privateOnly = true;
    keys.state.capable = true;
    await t.startDiscovery(ev.events);
    const p = t.connect(MAC, { targetPkHex: PEER }).catch(() => {});
    await tick();
    expect(f.sent).toHaveLength(1);
    expect(wire(f.sent[0].base64)).not.toContain(ME);
    await t.stopDiscovery();
    await p;
  });

  it("0.1.55 «Solo saludo privado»: un saludo en claro de un contacto no recibe ni un byte", async () => {
    keys.state.privateOnly = true;
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "X", incoming: true } as never);
    await tick();
    f.emit("onFrame", { address: MAC, base64: encodeBase64(peerHelloPlain().bytes) } as never);
    await tick();
    expect(f.sent).toHaveLength(0);
    expect(ev.handshakes).toHaveLength(0);
    await t.stopDiscovery();
  });

  it("0.1.55: sin «Solo saludo privado», un saludo en claro se sigue contestando (NIDO antiguos no se quedan fuera)", async () => {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "X", incoming: true } as never);
    await tick();
    f.emit("onFrame", { address: MAC, base64: encodeBase64(peerHelloPlain().bytes) } as never);
    await tick();
    expect(f.sent).toHaveLength(1);
    expect(parseHello(decodeBase64(f.sent[0].base64)).pk).toBe(ME);
    await t.stopDiscovery();
  });
});
