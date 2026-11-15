/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * t12Transport.test.ts — Tanda T-12 (red y relay I) · 0.1.99.
 *
 * Sondas escritas ANTES de las curas y regresiones permanentes de:
 * - M-24 (capa 1): la ruta establecida reenviaba TODOS los frames que un
 *   par autenticado mandara, sin cuota: la inundación llegaba íntegra a
 *   la capa de mensajería. Ahora hay una cubeta de frames por par en el
 *   propio transporte.
 * - m-37: al completar el saludo, el lector LAN de Kotlin quitaba el
 *   timeout PARA SIEMPRE por conteo de frames, sin autenticación. La
 *   cura es una señal puente: cuando el transporte JS establece la ruta
 *   (único punto donde macToPk se muta, tras verificar el CONFIRM), avisa
 *   al módulo nativo con markLanAuthenticated(dirección). Aquí se prueba
 *   el eslabón JS; el lado Kotlin se verifica por build (sin vitest).
 * - m-40: parseHello y parseConfirm decodificaban el cuerpo (bytes NO
 *   autenticados) con un TextDecoder permisivo: secuencias UTF-8
 *   inválidas se convertían en U+FFFD y el JSON «parseaba». La decodificación
 *   del camino de handshake ahora es estricta (fatal: true).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildHelloSignMessageV3,
  buildConfirmSignMessage,
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
  parseHello,
  type NidoP2PBindings,
} from "./nativeTransport";
import { parseConfirm, buildConfirmV1 } from "./handshakeV3";
import { makeMemoryHelloNonceCache } from "./nonceCache";
import type { P2PTransportEvents, P2PPeerInfo } from "./transport";

const MY_PK = new Uint8Array(32).fill(1);
const MY_PK_HEX = toHex(MY_PK);
const MY_SIGN = generateSigningKeypair();
const PEER_PK = new Uint8Array(32).fill(2);
const PEER_PK_HEX = toHex(PEER_PK);
const PEER_SIGN = generateSigningKeypair();
const MAC = "AA:BB:CC:DD:EE:FF";
const LAN_ADDR = "LAN:192.168.1.50:40443";

vi.mock("./store", () => ({
  getIdentity: async () => ({
    publicKey: MY_PK,
    secretKey: new Uint8Array(32).fill(7),
    name: "Yo",
  }),
  getSigningKeypair: async () => MY_SIGN,
  findContactByPk: async (pk: string) =>
    pk === PEER_PK_HEX
      ? { pkHex: PEER_PK_HEX, name: "Beto", verified: true, sigPkHex: toHex(PEER_SIGN.publicKey) }
      : null,
}));

type Listener = (e: never) => void;

function makeFake() {
  const listeners = new Map<string, Listener[]>();
  const sent: Array<{ address: string; base64: string }> = [];
  const lanAuthenticated: string[] = [];
  const emit = (event: string, payload: unknown) => {
    for (const fn of listeners.get(event) ?? []) fn(payload as never);
  };
  const fake = {
    isBluetoothEnabled: () => true,
    requestPermissions: async () => true,
    startDiscovery: async () => {},
    stopDiscovery: async () => {},
    startServer: async () => {},
    stopServer: async () => {},
    connect: async (address: string) => {
      emit("onConnected", { address, name: "Peer", incoming: false });
      return { address, name: "Peer" };
    },
    sendFrame: async (address: string, base64: string) => {
      sent.push({ address, base64 });
    },
    disconnect: async () => {},
    shutdown: async () => {},
    getBondedDevices: async () => [],
    markLanAuthenticated: (address: string) => {
      lanAuthenticated.push(address);
    },
    addListener: ((event: string, fn: Listener) => {
      const arr = listeners.get(event) ?? [];
      arr.push(fn);
      listeners.set(event, arr);
      return () => {
        listeners.set(event, (listeners.get(event) ?? []).filter((f) => f !== fn));
      };
    }) as NidoP2PBindings["addListener"],
  } as unknown as NidoP2PBindings;
  return { fake, sent, lanAuthenticated, emit };
}

function makeEvents() {
  const frames: Array<{ pk: string; frame: Uint8Array }> = [];
  const handshakes: Array<{ pk: string }> = [];
  const events: P2PTransportEvents = {
    onPeerFound: (_p: P2PPeerInfo) => {},
    onPeerLost: (_pk: string) => {},
    onFrame: (pk, frame) => frames.push({ pk, frame }),
    onHandshakeComplete: (pk) => handshakes.push({ pk }),
    onError: (_m: string) => {},
  };
  return { events, frames, handshakes };
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const nowSec = () => Math.floor(Date.now() / 1000);

function peerConfirm(peerNonceHex: string, myNonceHex: string): string {
  const sigHex = toHex(
    signDetached(buildConfirmSignMessage(PEER_PK_HEX, peerNonceHex, myNonceHex), PEER_SIGN.secretKey),
  );
  return encodeBase64(buildConfirmV1(PEER_PK_HEX, peerNonceHex, myNonceHex, sigHex));
}

describe("T-12 · transporte (M-24 capa 1, m-37)", () => {
  let f: ReturnType<typeof makeFake>;
  let ev: ReturnType<typeof makeEvents>;
  let t: NidoBluetoothTransport;
  let buildHello: (pk: string, eph: string, nonce: string, ts: number, sig: string) => Uint8Array;

  beforeEach(async () => {
    f = makeFake();
    ev = makeEvents();
    t = new NidoBluetoothTransport(f.fake, { nonceCache: makeMemoryHelloNonceCache() });
    buildHello = (await import("./nativeTransport")).buildHello;
  });

  async function completeHandshake(address: string): Promise<void> {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address, name: "Teléfono de Beto", incoming: false });
    await tick();
    const eph = toHex(generateEphemeral().publicKey);
    const nonceHex = toHex(randomNonce(HANDSHAKE_NONCE_BYTES));
    const ts = nowSec();
    const sigHex = toHex(
      signDetached(buildHelloSignMessageV3(PEER_PK_HEX, eph, nonceHex, ts), PEER_SIGN.secretKey),
    );
    f.emit("onFrame", {
      address,
      base64: encodeBase64(buildHello(PEER_PK_HEX, eph, nonceHex, ts, sigHex)),
    });
    await tick();
    expect(f.sent.length).toBeGreaterThanOrEqual(2);
    const myHello = parseHello(decodeBase64(f.sent[0].base64));
    f.emit("onFrame", { address, base64: peerConfirm(nonceHex, myHello.nonce) });
    await tick();
    expect(ev.handshakes).toHaveLength(1);
  }

  it("m-37: al establecerse la ruta LAN, el transporte avisa al módulo nativo (markLanAuthenticated)", async () => {
    await completeHandshake(LAN_ADDR);
    expect(f.lanAuthenticated).toEqual([LAN_ADDR]);
    await t.stopDiscovery();
  });

  it("m-37: en Bluetooth no se emite la señal LAN", async () => {
    await completeHandshake(MAC);
    expect(f.lanAuthenticated).toEqual([]);
    await t.stopDiscovery();
  });

  it("M-24 capa 1: la ruta establecida corta la inundación de frames de un par (cubeta por par)", async () => {
    const quota = await import("./inboundQuota").catch(() => null);
    expect(quota, "inboundQuota debe existir (M-24)").not.toBeNull();
    quota!.setInboundQuotaLimitsForTests({ maxFramesPerPeer: 5, frameWindowMs: 60_000 });
    quota!.inboundQuota.clear();
    try {
      await completeHandshake(MAC);
      const before = ev.frames.length;
      for (let i = 0; i < 7; i++) {
        f.emit("onFrame", { address: MAC, base64: encodeBase64(new Uint8Array([1, 2, 3, i])) });
      }
      await tick();
      expect(ev.frames.length - before).toBe(5);
      expect(quota!.inboundQuota.snapshot().framesDropped).toBe(2);
    } finally {
      quota!.resetInboundQuotaForTests();
      await t.stopDiscovery();
    }
  });
});

describe("T-12 · m-40: decodificación estricta en el camino de handshake", () => {
  /** Inserta un byte UTF-8 inválido (0xFF) dentro de un campo extra del JSON. */
  function withInvalidUtf8(validBody: Uint8Array): Uint8Array {
    const text = new TextDecoder().decode(validBody);
    const obj = JSON.parse(text) as Record<string, unknown>;
    obj["x"] = "�";
    const rebuilt = new TextEncoder().encode(JSON.stringify(obj));
    // Sustituir el carácter de reemplazo (3 bytes UTF-8) por un 0xFF crudo:
    // el cuerpo resultante ya NO es UTF-8 válido, pero con un decodificador
    // permisivo volvería a «parsear» como el mismo JSON.
    const idx = rebuilt.findIndex((b, i) => b === 0xef && rebuilt[i + 1] === 0xbf && rebuilt[i + 2] === 0xbd);
    expect(idx).toBeGreaterThanOrEqual(0);
    const out = new Uint8Array(rebuilt.length - 2);
    out.set(rebuilt.slice(0, idx), 0);
    out[idx] = 0xff;
    out.set(rebuilt.slice(idx + 3), idx + 1);
    return out;
  }

  it("parseHello rechaza un cuerpo con UTF-8 inválido en vez de decodificarlo con reemplazos", async () => {
    const { buildHello } = await import("./nativeTransport");
    const valid = buildHello(
      "a".repeat(64),
      "b".repeat(64),
      "c".repeat(32),
      1780000000,
      "d".repeat(128),
    );
    expect(() => parseHello(withInvalidUtf8(valid))).toThrow("HELLO no es JSON.");
  });

  it("parseConfirm rechaza un cuerpo con UTF-8 inválido en vez de decodificarlo con reemplazos", () => {
    const valid = buildConfirmV1("a".repeat(64), "c".repeat(32), "e".repeat(32), "d".repeat(128));
    expect(() => parseConfirm(withInvalidUtf8(valid))).toThrow("CONFIRM no es JSON.");
  });
});
