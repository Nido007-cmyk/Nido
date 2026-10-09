/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * r4-adversarial.test.ts — R4: escenarios adversariales A1–A9 del packet
 * (§3.3, §4.4, §4.5, §8).
 *
 * Mapeo de cobertura (algunos escenarios viven en el archivo donde el
 * mecanismo se prueba de forma más directa):
 * - A1 (replay cross-context del PoC original): r4-poc-repro.test.ts
 *   (regresión del PoC que demostró el hijack pre-fix).
 * - A2 (replay dentro del cooldown / ruta viva): nativeTransport.test.ts
 *   ("HELLO capturado (mismos bytes)…", "HELLO fresco con ruta viva…").
 * - A3 (replay tras REINICIO — la cache debe sobrevivir): ESTE archivo.
 * - A4 (relay activo): ESTE archivo — propiedad de transcript binding
 *   (CONFIRM de otra sesión no sirve); el relay activo que entrega bytes
 *   a un peer vivo sigue siendo RESIDUAL documentado (N6 lo resolverá).
 * - A5 (reflexión): nativeTransport.test.ts ("CONFIRM reflejado…").
 * - A6 (mismas claves en dos dispositivos): NO es escenario soportado
 *   (packet §8.4: restore → identidad fresca + re-pairing). Sin test.
 * - A7 (simultaneous dial): nativeTransport.test.ts (ambos órdenes) +
 *   handshakeV3.test.ts (vectores).
 * - A8 (ts fuera de margen / límites): ESTE archivo (+ un caso en
 *   nativeTransport.test.ts).
 * - A9 (el peer reutiliza su propio nonce): ESTE archivo.
 *
 * La aserción cross-component ("HELLO sin CONFIRM jamás mueve una ruta"
 * por la máquina de estados real) vive en nativeTransport.test.ts
 * ("INVARIANTE R4").
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
  buildHello,
  type NidoP2PBindings,
} from "./nativeTransport";
import { parseConfirm, buildConfirmV1 } from "./handshakeV3";
import { makeMemoryHelloNonceCache, type HelloNonceCache } from "./nonceCache";import type { P2PTransportEvents } from "./transport";

const MY_PK = new Uint8Array(32).fill(1);
const MY_PK_HEX = toHex(MY_PK);
const MY_SIGN = generateSigningKeypair();
const PEER_PK = new Uint8Array(32).fill(2);
const PEER_PK_HEX = toHex(PEER_PK);
const PEER_SIGN = generateSigningKeypair();
const MAC = "AA:BB:CC:DD:EE:FF";
const ATTACKER_MAC = "11:22:33:44:55:66";

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

function makeEvents() {
  const handshakes: string[] = [];
  const errors: string[] = [];
  const events: P2PTransportEvents = {
    onHandshakeComplete: (pk) => handshakes.push(pk),
    onError: (m) => errors.push(m),
  };
  return { events, handshakes, errors };
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const nowSec = () => Math.floor(Date.now() / 1000);

function peerHello(
  ephHex: string,
  ts: number = nowSec(),
): { b64: string; nonceHex: string } {
  const nonceHex = toHex(randomNonce(HANDSHAKE_NONCE_BYTES));
  const msg = buildHelloSignMessageV3(PEER_PK_HEX, ephHex, nonceHex, ts);
  const sigHex = toHex(signDetached(msg, PEER_SIGN.secretKey));
  return {
    b64: encodeBase64(buildHello(PEER_PK_HEX, ephHex, nonceHex, ts, sigHex)),
    nonceHex,
  };
}

function peerConfirm(peerNonceHex: string, myNonceHex: string): string {
  const sigHex = toHex(
    signDetached(
      buildConfirmSignMessage(PEER_PK_HEX, peerNonceHex, myNonceHex),
      PEER_SIGN.secretKey,
    ),
  );
  return encodeBase64(buildConfirmV1(PEER_PK_HEX, peerNonceHex, myNonceHex, sigHex));
}

describe("A3: replay tras reinicio — la cache anti-replay sobrevive", () => {
  let f: ReturnType<typeof makeFake>;
  let ev: ReturnType<typeof makeEvents>;
  // La MISMA instancia de cache para "t1" y "t2": en producción es la tabla
  // SQLCipher, que sobrevive al reinicio del proceso (esto es exactamente
  // lo que el mapa en memoria de B/F1 no hacía).
  let sharedCache: HelloNonceCache & { size(): number };

  beforeEach(() => {
    f = makeFake();
    ev = makeEvents();
    sharedCache = makeMemoryHelloNonceCache();
  });

  function makeTransportWithSharedCache(): NidoBluetoothTransport {
    return new NidoBluetoothTransport(f.fake, { nonceCache: sharedCache });
  }

  it("un HELLO aceptado antes del reinicio se rechaza después (mismos bytes)", async () => {
    // --- "Proceso 1": handshake legítimo en dos fases.
    const t1 = makeTransportWithSharedCache();
    await t1.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "Beto", incoming: true } as never);
    await tick();
    const captured = peerHello(toHex(generateEphemeral().publicKey));
    f.emit("onFrame", { address: MAC, base64: captured.b64 } as never);
    await tick();
    const myHello1 = parseHello(decodeBase64(f.sent[0].base64));
    f.emit("onFrame", {
      address: MAC,
      base64: peerConfirm(captured.nonceHex, myHello1.nonce),
    } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(1);
    expect(sharedCache.size()).toBe(1);
    // Reinicio real = destrucción terminal (el proceso muere y la JS se
    // destruye). shutdownNative() limpia los listeners de enlace; un mero
    // stopDiscovery() los preserva a propósito (nav-drop fix).
    await t1.shutdownNative();

    // --- "Reinicio": instancia fresca, MISMA cache persistente.
    const t2 = makeTransportWithSharedCache();
    await t2.startDiscovery(ev.events);
    // El atacante reinyecta el HELLO capturado en el proceso anterior.
    f.emit("onConnected", { address: ATTACKER_MAC, name: "Atacante", incoming: true } as never);
    await tick();
    f.emit("onFrame", { address: ATTACKER_MAC, base64: captured.b64 } as never);
    await tick();
    // Rechazado por la cache persistente: ni handshake ni ruta.
    expect(ev.handshakes).toHaveLength(1);
    expect(ev.errors.join(" ")).toMatch(/repetido|re-inyección/i);
    expect(f.disconnected).toContain(ATTACKER_MAC);
    await expect(t2.sendFrame(PEER_PK_HEX, new Uint8Array([1]))).rejects.toThrow(/no conectado/i);
    await t2.stopDiscovery();
  });

  it("tras el reinicio, un handshake legítimo con nonce fresco sí funciona", async () => {
    const t1 = makeTransportWithSharedCache();
    await t1.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "Beto", incoming: true } as never);
    await tick();
    const old = peerHello(toHex(generateEphemeral().publicKey));
    f.emit("onFrame", { address: MAC, base64: old.b64 } as never);
    await tick();
    await t1.shutdownNative();

    const t2 = makeTransportWithSharedCache();
    await t2.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "Beto", incoming: true } as never);
    await tick();
    const fresh = peerHello(toHex(generateEphemeral().publicKey));
    // Nuestro HELLO fresco ya salió con el onConnected de arriba.
    const ourHello = parseHello(decodeBase64(f.sent[f.sent.length - 1].base64));
    f.emit("onFrame", { address: MAC, base64: fresh.b64 } as never);
    await tick();
    // Fase 1 aceptada: nuestro CONFIRM es el único frame nuevo…
    expect(() => parseConfirm(decodeBase64(f.sent[f.sent.length - 1].base64))).not.toThrow();
    f.emit("onFrame", {
      address: MAC,
      base64: peerConfirm(fresh.nonceHex, ourHello.nonce),
    } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(1);
    expect(ev.errors).toHaveLength(0);
    await t2.stopDiscovery();
  });
});

describe("A4: transcript binding — un CONFIRM de otra sesión no sirve", () => {
  let f: ReturnType<typeof makeFake>;
  let ev: ReturnType<typeof makeEvents>;
  let t: NidoBluetoothTransport;

  beforeEach(() => {
    f = makeFake();
    ev = makeEvents();
    t = new NidoBluetoothTransport(f.fake, { nonceCache: makeMemoryHelloNonceCache() });
  });

  it("CONFIRM genuino de la sesión S1 reinyectado en el socket S2 → rechazado (pn no coincide)", async () => {
    await t.startDiscovery(ev.events);
    // Sesión S1 legítima y completa en MAC.
    f.emit("onConnected", { address: MAC, name: "Beto", incoming: true } as never);
    await tick();
    const s1 = peerHello(toHex(generateEphemeral().publicKey));
    f.emit("onFrame", { address: MAC, base64: s1.b64 } as never);
    await tick();
    const myHelloS1 = parseHello(decodeBase64(f.sent[0].base64));
    const genuineConfirmS1 = peerConfirm(s1.nonceHex, myHelloS1.nonce);
    f.emit("onFrame", { address: MAC, base64: genuineConfirmS1 } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(1);

    // Socket S2: el atacante abre otra conexión y completa la fase 1 con un
    // HELLO genuino pero de OTRO contexto (nonce que nunca vimos).
    // Aislamos el transcript binding del cooldown anti-flapping (probado
    // aparte): expirar el cooldown para que el HELLO de S2 llegue a fase 1.
    (t as unknown as { lastHandshakeAt: Map<string, number> }).lastHandshakeAt.set(
      PEER_PK_HEX.toLowerCase(),
      0,
    );
    const S2 = "AA:BB:CC:DD:EE:01";
    f.emit("onConnected", { address: S2, name: "Atacante", incoming: true } as never);
    await tick();
    const s2 = peerHello(toHex(generateEphemeral().publicKey));
    f.emit("onFrame", { address: S2, base64: s2.b64 } as never);
    await tick();
    // La fase 1 de S2 pasa (el HELLO es genuino) → enviamos CONFIRM…
    expect(f.sent.length).toBe(4);
    // …pero el atacante solo tiene el CONFIRM de S1: su `pn` cita el nonce
    // de MI hello en S1, no el de S2 → rechazado. Sin la clave de firma del
    // peer no puede fabricar el CONFIRM de S2.
    f.emit("onFrame", { address: S2, base64: genuineConfirmS1 } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(1); // S2 jamás establece ruta
    expect(ev.errors.join(" ")).toMatch(/nonce|inesperad/i);
    expect(f.disconnected).toContain(S2);
    // La sesión S1 sigue intacta en su MAC.
    const before = f.sent.length;
    await t.sendFrame(PEER_PK_HEX, new Uint8Array([1]));
    expect(f.sent[before].address).toBe(MAC);
    await t.stopDiscovery();
  });

});

describe("A8: límites del timestamp firmado", () => {
  let f: ReturnType<typeof makeFake>;
  let ev: ReturnType<typeof makeEvents>;
  let t: NidoBluetoothTransport;

  beforeEach(() => {
    f = makeFake();
    ev = makeEvents();
    t = new NidoBluetoothTransport(f.fake, { nonceCache: makeMemoryHelloNonceCache() });
  });

  async function phase1(mac: string, ts: number): Promise<void> {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: mac, name: "X", incoming: true } as never);
    await tick();
    const ph = peerHello(toHex(generateEphemeral().publicKey), ts);
    f.emit("onFrame", { address: mac, base64: ph.b64 } as never);
    await tick();
  }

  it("ts en el borde interior (±590 s) → aceptado, se envía CONFIRM", async () => {
    await phase1(MAC, nowSec() - 590);
    expect(f.sent).toHaveLength(2);
    expect(() => parseConfirm(decodeBase64(f.sent[1].base64))).not.toThrow();
    expect(ev.errors).toHaveLength(0);
    await t.stopDiscovery();
  });

  it("ts futuro en el borde interior (+599 s) → aceptado", async () => {
    await phase1(MAC, nowSec() + 590);
    expect(f.sent).toHaveLength(2);
    expect(ev.errors).toHaveLength(0);
    await t.stopDiscovery();
  });

  it("ts fuera del margen (+610 s) → rechazado, sin CONFIRM", async () => {
    await phase1(MAC, nowSec() + 610);
    expect(ev.errors.join(" ")).toMatch(/reloj|margen/i);
    expect(f.disconnected).toContain(MAC);
    expect(f.sent).toHaveLength(1); // solo nuestro HELLO; ningún CONFIRM
    await t.stopDiscovery();
  });

  it("un atacante no puede 'refrescar' el ts de un HELLO capturado (va firmado)", async () => {
    // Captura un HELLO genuino con ts válido…
    const ephHex = toHex(generateEphemeral().publicKey);
    const nonceHex = toHex(randomNonce(HANDSHAKE_NONCE_BYTES));
    const oldTs = nowSec() - 3600;
    const sigHex = toHex(
      signDetached(
        buildHelloSignMessageV3(PEER_PK_HEX, ephHex, nonceHex, oldTs),
        PEER_SIGN.secretKey,
      ),
    );
    // …y reescribe el ts en claro sin poder re-firmar.
    const tampered = encodeBase64(
      buildHello(PEER_PK_HEX, ephHex, nonceHex, nowSec(), sigHex),
    );
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "X", incoming: true } as never);
    await tick();
    f.emit("onFrame", { address: MAC, base64: tampered } as never);
    await tick();
    // La firma ya no verifica (el ts va dentro del mensaje firmado).
    expect(ev.handshakes).toHaveLength(0);
    expect(ev.errors.join(" ")).toMatch(/firma inválida|intermediario/i);
    expect(f.disconnected).toContain(MAC);
    await t.stopDiscovery();
  });
});

describe("A9: el peer reutiliza su propio nonce en otro socket → replay", () => {
  let f: ReturnType<typeof makeFake>;
  let ev: ReturnType<typeof makeEvents>;
  let t: NidoBluetoothTransport;

  beforeEach(() => {
    f = makeFake();
    ev = makeEvents();
    t = new NidoBluetoothTransport(f.fake, { nonceCache: makeMemoryHelloNonceCache() });
  });

  it("segundo HELLO con el mismo nonce (peer con bug o malicioso) → rechazado; la sesión original intacta", async () => {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "Beto", incoming: true } as never);
    await tick();
    // Peer defectuoso: construye el HELLO una vez y lo envía por dos sockets.
    const ephHex = toHex(generateEphemeral().publicKey);
    const nonceHex = toHex(randomNonce(HANDSHAKE_NONCE_BYTES));
    const ts = nowSec();
    const sigHex = toHex(
      signDetached(buildHelloSignMessageV3(PEER_PK_HEX, ephHex, nonceHex, ts), PEER_SIGN.secretKey),
    );
    const dupHello = encodeBase64(buildHello(PEER_PK_HEX, ephHex, nonceHex, ts, sigHex));
    // Socket 1: handshake completo.
    f.emit("onFrame", { address: MAC, base64: dupHello } as never);
    await tick();
    const myHello1 = parseHello(decodeBase64(f.sent[0].base64));
    f.emit("onFrame", { address: MAC, base64: peerConfirm(nonceHex, myHello1.nonce) } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(1);
    // Socket 2: el MISMO HELLO (mismo nonce) → replay aunque la firma sea válida.
    const S2 = "AA:BB:CC:DD:EE:02";
    f.emit("onConnected", { address: S2, name: "Beto-2", incoming: true } as never);
    await tick();
    f.emit("onFrame", { address: S2, base64: dupHello } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(1);
    expect(ev.errors.join(" ")).toMatch(/repetido|re-inyección/i);
    expect(f.disconnected).toContain(S2);
    // La sesión original sigue en su MAC.
    const before = f.sent.length;
    await t.sendFrame(PEER_PK_HEX, new Uint8Array([1]));
    expect(f.sent[before].address).toBe(MAC);
    await t.stopDiscovery();
  });
});
