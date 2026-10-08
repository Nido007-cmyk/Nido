/**
 * r4-poc-repro.test.ts — R4 REGRESIÓN del PoC original (A1).
 *
 * Este archivo nació como reproducción del ataque contra el código SIN
 * fix (2026-09-28): un HELLO genuino de Beto capturado en otro contexto,
 * reinyectado por Mallory con el cooldown expirado, era aceptado y
 * `pkToMac[Beto]` pasaba a apuntar a la MAC del atacante (hijack de ruta
 * + `sent` falso).
 *
 * Con el fix (HELLO v3 + CONFIRM v1), el mismo escenario DEBE fallar:
 * el HELLO genuino se valida y hasta se responde con CONFIRM, pero la
 * ruta jamás se establece porque Mallory no puede producir el CONFIRM
 * de Beto citando el nonce fresco de Alice en ESTA conexión.
 */
import { describe, it, expect, vi } from "vitest";
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
  buildHello,
  type NidoP2PBindings,
} from "./nativeTransport";
import { parseConfirm, buildConfirmV1 } from "./handshakeV3";
import { makeMemoryHelloNonceCache } from "./nonceCache";
import type { P2PTransportEvents } from "./transport";

const MY_PK = new Uint8Array(32).fill(1);
const MY_PK_HEX = toHex(MY_PK);
const MY_SIGN = generateSigningKeypair();
const PEER_PK = new Uint8Array(32).fill(2);
const PEER_PK_HEX = toHex(PEER_PK);
const PEER_SIGN = generateSigningKeypair();
const MAC = "AA:BB:CC:DD:EE:FF";
const ATTACKER_MAC = "11:22:33:44:55:66";

vi.mock("./store", () => ({
  getIdentity: async () => ({ publicKey: MY_PK, secretKey: new Uint8Array(32).fill(7), name: "Yo" }),
  getSigningKeypair: async () => MY_SIGN,
  findContactByPk: async (pk: string) =>
    pk === PEER_PK_HEX
      ? { pkHex: PEER_PK_HEX, name: "Beto", verified: true, sigPkHex: toHex(PEER_SIGN.publicKey) }
      : null,
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
    getBondedDevices: async () => [],
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

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const nowSec = () => Math.floor(Date.now() / 1000);

/**
 * Un HELLO genuino de Beto — firma válida con su clave real — capturado en
 * OTRO contexto (p. ej. Beto→Carol). Nonce fresco que Alice jamás vio y ts
 * fresco: pasa TODAS las validaciones del HELLO. Es el arma del PoC.
 */
function genuineCrossContextHello(): { b64: string; nonceHex: string } {
  const nonceHex = toHex(randomNonce(HANDSHAKE_NONCE_BYTES));
  const ephHex = toHex(generateEphemeral().publicKey);
  const ts = nowSec();
  const msg = buildHelloSignMessageV3(PEER_PK_HEX, ephHex, nonceHex, ts);
  const sigHex = toHex(signDetached(msg, PEER_SIGN.secretKey));
  return {
    b64: encodeBase64(buildHello(PEER_PK_HEX, ephHex, nonceHex, ts, sigHex)),
    nonceHex,
  };
}

function genuinePeerConfirm(peerNonceHex: string, myNonceHex: string): string {
  const sigHex = toHex(
    signDetached(buildConfirmSignMessage(PEER_PK_HEX, peerNonceHex, myNonceHex), PEER_SIGN.secretKey),
  );
  return encodeBase64(buildConfirmV1(PEER_PK_HEX, peerNonceHex, myNonceHex, sigHex));
}

describe("R4 REGRESIÓN (PoC A1): replay cross-context de HELLO genuino", () => {
  it("el replay del PoC original ya NO hijackea la ruta: sin CONFIRM no hay ruta", async () => {
    const { fake, sent, disconnected, emit } = makeFake();
    const t = new NidoBluetoothTransport(fake, { nonceCache: makeMemoryHelloNonceCache() });
    const handshakes: string[] = [];
    const errors: string[] = [];
    const events: P2PTransportEvents = {
      onHandshakeComplete: (pk) => handshakes.push(pk),
      onError: (m) => errors.push(m),
    };
    await t.startDiscovery(events);

    // 1) Sesión viva y legítima Alice↔Beto (dos fases).
    emit("onConnected", { address: MAC, name: "Beto", incoming: true } as never);
    await tick();
    const legit = genuineCrossContextHello(); // Beto genuino también aquí
    emit("onFrame", { address: MAC, base64: legit.b64 } as never);
    await tick();
    const myHelloLegit = parseHello(decodeBase64(sent[0].base64));
    emit("onFrame", {
      address: MAC,
      base64: genuinePeerConfirm(legit.nonceHex, myHelloLegit.nonce),
    } as never);
    await tick();
    expect(handshakes).toHaveLength(1);

    // 2) Cooldown expirado; Mallory reinyecta un HELLO GENUINO de Beto
    //    capturado en otro contexto (nonce fresco para Alice, firma válida).
    (t as unknown as { lastHandshakeAt: Map<string, number> }).lastHandshakeAt.set(
      PEER_PK_HEX.toLowerCase(),
      Date.now() - 11_000,
    );
    const captured = genuineCrossContextHello();
    emit("onConnected", { address: ATTACKER_MAC, name: "Atacante", incoming: true } as never);
    await tick();
    const sentBefore = sent.length;
    emit("onFrame", { address: ATTACKER_MAC, base64: captured.b64 } as never);
    await tick();

    // 3) EL FIX: el HELLO genuino se valida (hasta enviamos CONFIRM), pero
    //    la ruta NO se mueve: sin el CONFIRM de Beto citando NUESTRO nonce
    //    fresco de esta conexión, no hay handshake ni ruta.
    expect(handshakes).toHaveLength(1); // sin handshake nuevo
    expect(sent.length).toBe(sentBefore + 1); // solo nuestro CONFIRM al atacante
    expect(() => parseConfirm(decodeBase64(sent[sent.length - 1].base64))).not.toThrow();
    const ourConfirm = parseConfirm(decodeBase64(sent[sent.length - 1].base64));
    expect(ourConfirm.pn).toBe(captured.nonceHex);
    // La ruta sigue en la MAC legítima: sendFrame NO sale al atacante.
    const before = sent.length;
    await t.sendFrame(PEER_PK_HEX, new Uint8Array([9, 9, 9]));
    expect(sent[before].address).toBe(MAC);

    // 4) Mallory no puede completar: un CONFIRM forjado (otra clave) se
    //    rechaza y su socket se cierra. (Sin esto, el timeout de 10 s lo
    //    cerraría igual: fail-closed.)
    const attackerMyNonce = parseHello(decodeBase64(sent[sentBefore - 1].base64)).nonce;
    const forgedSig = toHex(
      signDetached(
        buildConfirmSignMessage(PEER_PK_HEX, captured.nonceHex, attackerMyNonce),
        generateSigningKeypair().secretKey,
      ),
    );
    const forgedConfirm = encodeBase64(
      buildConfirmV1(PEER_PK_HEX, captured.nonceHex, attackerMyNonce, forgedSig),
    );
    emit("onFrame", { address: ATTACKER_MAC, base64: forgedConfirm } as never);
    await tick();
    expect(handshakes).toHaveLength(1);
    expect(errors.join(" ")).toMatch(/firma.*inválida|intermediario/i);
    expect(disconnected).toContain(ATTACKER_MAC);
    // Y la ruta legítima sigue intacta después del intento.
    const before2 = sent.length;
    await t.sendFrame(PEER_PK_HEX, new Uint8Array([9, 9, 9]));
    expect(sent[before2].address).toBe(MAC);
    await t.stopDiscovery();
  });

  it("variante: el CONFIRM genuino de la sesión legítima no sirve en el socket del atacante", async () => {
    const { fake, sent, disconnected, emit } = makeFake();
    const t = new NidoBluetoothTransport(fake, { nonceCache: makeMemoryHelloNonceCache() });
    const handshakes: string[] = [];
    const errors: string[] = [];
    await t.startDiscovery({
      onHandshakeComplete: (pk) => handshakes.push(pk),
      onError: (m) => errors.push(m),
    });

    // Sesión legítima completa.
    emit("onConnected", { address: MAC, name: "Beto", incoming: true } as never);
    await tick();
    const legit = genuineCrossContextHello();
    emit("onFrame", { address: MAC, base64: legit.b64 } as never);
    await tick();
    const myHelloLegit = parseHello(decodeBase64(sent[0].base64));
    const genuineConfirm = genuinePeerConfirm(legit.nonceHex, myHelloLegit.nonce);
    emit("onFrame", { address: MAC, base64: genuineConfirm } as never);
    await tick();
    expect(handshakes).toHaveLength(1);

    // Mallory abre su socket, completa la fase 1 con otro HELLO genuino de
    // Beto (otro contexto), y reinyecta el CONFIRM genuino de la sesión
    // legítima: el `pn` cita el nonce de MI hello en la sesión legítima,
    // no el del socket del atacante → rechazado (transcript binding).
    (t as unknown as { lastHandshakeAt: Map<string, number> }).lastHandshakeAt.set(
      PEER_PK_HEX.toLowerCase(),
      Date.now() - 11_000,
    );
    emit("onConnected", { address: ATTACKER_MAC, name: "Atacante", incoming: true } as never);
    await tick();
    const captured2 = genuineCrossContextHello();
    emit("onFrame", { address: ATTACKER_MAC, base64: captured2.b64 } as never);
    await tick();
    emit("onFrame", { address: ATTACKER_MAC, base64: genuineConfirm } as never);
    await tick();
    expect(handshakes).toHaveLength(1);
    expect(errors.join(" ")).toMatch(/nonce|inesperad/i);
    expect(disconnected).toContain(ATTACKER_MAC);
    const before = sent.length;
    await t.sendFrame(PEER_PK_HEX, new Uint8Array([9, 9, 9]));
    expect(sent[before].address).toBe(MAC);
    await t.stopDiscovery();
  });
});
