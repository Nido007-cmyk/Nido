/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildHelloSignMessageV3,
  buildConfirmSignMessage,
  deriveSessionKeyV2,
  fromHex,
  generateEphemeral,
  generateSigningKeypair,
  randomNonce,
  signDetached,
  toHex,
  verifyDetached,
  HANDSHAKE_NONCE_BYTES,
} from "./crypto";
import { encodeBase64, decodeBase64 } from "./base64";
import {
  NidoBluetoothTransport,
  createPlatformTransport,
  parseHello,
  buildHello,
  extractMac,
  type NidoP2PBindings,
} from "./nativeTransport";
import {
  parseConfirm,
  buildConfirmV1,
  CONFIRM_WAIT_MS,
  tieBreakKey,
} from "./handshakeV3";
import { makeMemoryHelloNonceCache } from "./nonceCache";
import { NidoMessenger } from "./messenger";
import { P2PSession, makeEnvelope } from "./protocol";
import { LoopbackTransport } from "./transport";
import type { P2PTransportEvents, P2PPeerInfo } from "./transport";

const MY_PK = new Uint8Array(32).fill(1);
const MY_PK_HEX = toHex(MY_PK);
const MY_SIGN = generateSigningKeypair();
const PEER_PK = new Uint8Array(32).fill(2);
const PEER_PK_HEX = toHex(PEER_PK);
const PEER_SIGN = generateSigningKeypair();
const MAC = "AA:BB:CC:DD:EE:FF";
const ATTACKER_MAC = "11:22:33:44:55:66";
const MAC2 = "AA:BB:CC:DD:EE:00";

/** Base mínima en memoria para el test end-to-end (store.saveMessage). */
const e2eMem = vi.hoisted(() => ({ messages: [] as Array<Record<string, unknown>> }));

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
  // Solo para el test end-to-end (messenger + transporte real).
  resolveContactByName: async (name: string) =>
    name.trim().toLowerCase() === "beto"
      ? {
          kind: "ok",
          contact: {
            pkHex: PEER_PK_HEX,
            name: "Beto",
            verified: true,
            sigPkHex: toHex(PEER_SIGN.publicKey),
          },
        }
      : { kind: "not_found" },
  getOutbox: async () => [],
  // N6: el outbox saliente ahora pasa por getOutboundMessage (un intento)
  // y markMessageStatus ('sent' tras entregar al transporte).
  getOutboundMessage: async (id: string) => {
    const row = e2eMem.messages.find((mm) => mm["id"] === id && mm["dir"] === "out");
    return row
      ? {
          id: row["id"],
          dir: "out",
          peerPk: row["peer_pk"],
          type: row["type"],
          text: row["text"],
          status: row["status"],
          ts: row["ts"],
          ackAttempts: 0,
          failureReason: null,
        }
      : null;
  },
  getSentOutbox: async () => [],
  markMessageStatus: async (id: string, status: string) => {
    const row = e2eMem.messages.find((mm) => mm["id"] === id);
    if (row) row["status"] = status;
  },
  // F-1: transición GUARDADA →'sent' (solo desde queued/sent; un estado
  // terminal nunca se resucita). Refleja el SQL autoritativo de store.ts.
  markOutboundSent: async (id: string) => {
    const row = e2eMem.messages.find((mm) => mm["id"] === id && mm["dir"] === "out");
    if (!row) return false;
    if (row["status"] !== "queued" && row["status"] !== "sent") return false;
    row["status"] = "sent";
    row["failure_reason"] = null;
    return true;
  },
  saveMessage: async (msg: {
    id: string;
    dir: string;
    peer_pk?: string;
    peerPk?: string;
    type: string;
    text: string;
    status?: string;
    ts?: number;
  }) => {
    const row = {
      id: msg.id,
      dir: msg.dir,
      peer_pk: (msg.peerPk ?? msg.peer_pk ?? "").toLowerCase(),
      type: msg.type,
      text: msg.text,
      status: msg.status ?? "queued",
      ts: msg.ts ?? Date.now(),
    };
    if (e2eMem.messages.some((m) => m.id === row.id)) return false;
    e2eMem.messages.push(row);
    return true;
  },
}));

vi.mock("../agent/memory/memoryStore", () => {
  const db = {
    execAsync: async (_sql: string) => undefined,
    getFirstAsync: async (_sql: string, _params: unknown[] = []) => null,
    getAllAsync: async (_sql: string) => [],
    runAsync: async (_sql: string, _params: unknown[] = []) => ({ changes: 0 }),
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
  const calls: string[] = [];
  const emit = (event: string, payload: never) => {
    for (const fn of listeners.get(event) ?? []) fn(payload);
  };
  const fake: NidoP2PBindings = {
    isBluetoothEnabled: () => true,
    requestPermissions: async () => true,
    startDiscovery: async () => {
      calls.push("startDiscovery");
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
      emit("onConnected", { address, name: "Peer", incoming: false } as never);
      return { address, name: "Peer" };
    },
    sendFrame: async (address: string, base64: string) => {
      sent.push({ address, base64 });
    },
    disconnect: async (address: string) => {
      disconnected.push(address);
    },
    // B/F4: el binding nativo existe (AsyncFunction("shutdown") en
    // NidoP2PModule.kt); el fake registra la invocación para probar el
    // contrato a nivel de binding.
    shutdown: async () => {
      calls.push("shutdown");
    },
    // BUG-6-2026-10-07: dispositivos emparejados a nivel OS.
    getBondedDevices: async () => [
      { address: "AA:BB:CC:DD:EE:FF", name: "Galaxy Tab A9+ 5G" },
    ],
    addListener: ((event: string, fn: Listener) => {
      const arr = listeners.get(event) ?? [];
      arr.push(fn);
      listeners.set(event, arr);
      return () => {
        listeners.set(event, (listeners.get(event) ?? []).filter((f) => f !== fn));
      };
    }) as NidoP2PBindings["addListener"],
  };
  return { fake, sent, disconnected, calls, emit };
}

/** Transporte con cache anti-replay en memoria (inyectada; misma semántica atómica). */
function makeTransport(fake: NidoP2PBindings): NidoBluetoothTransport {
  return new NidoBluetoothTransport(fake, { nonceCache: makeMemoryHelloNonceCache() });
}

function makeEvents() {
  const found: P2PPeerInfo[] = [];
  const lost: string[] = [];
  const frames: Array<{ pk: string; frame: Uint8Array }> = [];
  const handshakes: Array<{
    pk: string;
    sec: Uint8Array;
    eph: Uint8Array;
    myNonce: Uint8Array;
    theirNonce: Uint8Array;
  }> = [];
  const errors: string[] = [];
  const events: P2PTransportEvents = {
    onPeerFound: (p) => found.push(p),
    onPeerLost: (pk) => lost.push(pk),
    onFrame: (pk, frame) => frames.push({ pk, frame }),
    onHandshakeComplete: (pk, sec, eph, myNonce, theirNonce) =>
      handshakes.push({ pk, sec, eph, myNonce, theirNonce }),
    onError: (m) => {
      if (m !== "__discovery_finished__") errors.push(m);
    },
  };
  return { events, found, lost, frames, handshakes, errors };
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const nowSec = () => Math.floor(Date.now() / 1000);

/**
 * Construye un HELLO v3 válido firmado por `signer` (por defecto el peer).
 * Devuelve también el nonce para poder citarlo en el CONFIRM.
 */
function peerHello(
  ephHex: string,
  pkHex: string = PEER_PK_HEX,
  ts: number = nowSec(),
  signer = PEER_SIGN,
): { b64: string; nonceHex: string } {
  const nonceHex = toHex(randomNonce(HANDSHAKE_NONCE_BYTES));
  const msg = buildHelloSignMessageV3(pkHex, ephHex, nonceHex, ts);
  const sigHex = toHex(signDetached(msg, signer.secretKey));
  return {
    b64: encodeBase64(buildHello(pkHex, ephHex, nonceHex, ts, sigHex)),
    nonceHex,
  };
}

/** HELLO v3 con el efímero manipulado DESPUÉS de firmar (ataque MITM). */
function mitmHello(ephHex: string, pkHex: string = PEER_PK_HEX): string {
  const nonceHex = toHex(randomNonce(HANDSHAKE_NONCE_BYTES));
  const realEph = toHex(generateEphemeral().publicKey);
  const ts = nowSec();
  const msg = buildHelloSignMessageV3(pkHex, realEph, nonceHex, ts);
  const sigHex = toHex(signDetached(msg, PEER_SIGN.secretKey));
  // El atacante sustituye el efímero pero no puede re-firmar.
  return encodeBase64(buildHello(pkHex, ephHex, nonceHex, ts, sigHex));
}

/** HELLO v3 firmado con una clave que NO es la del contacto (suplantación). */
function forgedHello(ephHex: string, pkHex: string = PEER_PK_HEX): string {
  const other = generateSigningKeypair();
  const nonceHex = toHex(randomNonce(HANDSHAKE_NONCE_BYTES));
  const ts = nowSec();
  const msg = buildHelloSignMessageV3(pkHex, ephHex, nonceHex, ts);
  const sigHex = toHex(signDetached(msg, other.secretKey));
  return encodeBase64(buildHello(pkHex, ephHex, nonceHex, ts, sigHex));
}

/**
 * CONFIRM v1 del peer: cita su propio nonce (cn) y el nuestro (pn),
 * firmado con su clave de firma. Es la prueba de presencia viva en ESTA
 * conexión que el transporte exige antes de establecer la ruta.
 */
function peerConfirm(
  peerNonceHex: string,
  myNonceHex: string,
  pkHex: string = PEER_PK_HEX,
  signer = PEER_SIGN,
): string {
  const sigHex = toHex(
    signDetached(buildConfirmSignMessage(pkHex, peerNonceHex, myNonceHex), signer.secretKey),
  );
  return encodeBase64(buildConfirmV1(pkHex, peerNonceHex, myNonceHex, sigHex));
}

describe("nativeTransport: utilidades", () => {
  it("sin módulo nativo → transporte no disponible pero explícito", () => {
    const t = createPlatformTransport();
    expect(t.available).toBe(false);
    expect(t.name).toBe("native");
  });

  it("parseHello/buildHello v3: roundtrip firmado y rechazos", () => {
    const eph = toHex(generateEphemeral().publicKey);
    const nonceHex = toHex(randomNonce(HANDSHAKE_NONCE_BYTES));
    const ts = nowSec();
    const msg = buildHelloSignMessageV3(MY_PK_HEX, eph, nonceHex, ts);
    const sigHex = toHex(signDetached(msg, MY_SIGN.secretKey));
    const body = buildHello(MY_PK_HEX, eph, nonceHex, ts, sigHex);
    expect(parseHello(body)).toEqual({ pk: MY_PK_HEX, eph, nonce: nonceHex, ts, sig: sigHex });
    // v1 → error claro de versión antigua
    expect(() =>
      parseHello(
        new TextEncoder().encode(
          JSON.stringify({ t: "nido-hello", v: 1, pk: MY_PK_HEX, eph }),
        ),
      ),
    ).toThrow(/antiguo/);
    // v:2 → hard cut: mensaje de actualización, sin compat silenciosa
    expect(() =>
      parseHello(
        new TextEncoder().encode(
          JSON.stringify({ t: "nido-hello", v: 2, pk: MY_PK_HEX, eph, nonce: nonceHex, ts, sig: sigHex }),
        ),
      ),
    ).toThrow(/actualiza su app/);
    // v:99 (desconocida) → rechazo explícito, sin downgrade silencioso
    expect(() =>
      parseHello(
        new TextEncoder().encode(
          JSON.stringify({ t: "nido-hello", v: 99, pk: MY_PK_HEX, eph }),
        ),
      ),
    ).toThrow(/desconocida/);
    // v como string (confusión de tipos) → también rechazado
    expect(() =>
      parseHello(
        new TextEncoder().encode(
          JSON.stringify({ t: "nido-hello", v: "3", pk: MY_PK_HEX, eph }),
        ),
      ),
    ).toThrow(/desconocida/);
    expect(() => parseHello(new TextEncoder().encode("basura"))).toThrow();
    expect(() =>
      parseHello(
        new TextEncoder().encode(JSON.stringify({ t: "otro", v: 3 })),
      ),
    ).toThrow();
    // timestamp inválido: ausente, string, 0 o >= 2^40
    for (const badTs of [undefined, "123", 0, 2 ** 40, 1.5]) {
      expect(() =>
        parseHello(
          buildHello(MY_PK_HEX, eph, nonceHex, badTs as unknown as number, sigHex),
        ),
      ).toThrow(/timestamp/i);
    }
    // firma con formato inválido
    expect(() =>
      parseHello(
        buildHello(MY_PK_HEX, eph, nonceHex, ts, "00".repeat(64).slice(0, 100)),
      ),
    ).toThrow(/firma/);
  });

  it("parseConfirm/buildConfirmV1: roundtrip y rechazos", () => {
    const cn = toHex(randomNonce(HANDSHAKE_NONCE_BYTES));
    const pn = toHex(randomNonce(HANDSHAKE_NONCE_BYTES));
    const sigHex = toHex(
      signDetached(buildConfirmSignMessage(MY_PK_HEX, cn, pn), MY_SIGN.secretKey),
    );
    const body = buildConfirmV1(MY_PK_HEX, cn, pn, sigHex);
    expect(parseConfirm(body)).toEqual({ pk: MY_PK_HEX, cn, pn, sig: sigHex });
    expect(() =>
      parseConfirm(
        new TextEncoder().encode(
          JSON.stringify({ t: "nido-confirm", v: 2, pk: MY_PK_HEX, cn, pn, sig: sigHex }),
        ),
      ),
    ).toThrow(/versión/);
    expect(() =>
      parseConfirm(
        new TextEncoder().encode(
          JSON.stringify({ t: "nido-hello", v: 3, pk: MY_PK_HEX, cn, pn, sig: sigHex }),
        ),
      ),
    ).toThrow(/tipo/);
    expect(() => parseConfirm(new TextEncoder().encode("basura"))).toThrow();
  });

  it("tieBreakKey: canónico e independiente del orden local", () => {
    const a = "aa".repeat(16);
    const b = "bb".repeat(16);
    expect(tieBreakKey(a, b)).toBe(tieBreakKey(b, a));
    expect(tieBreakKey(a, b)).toBe(a + b);
    expect(tieBreakKey(b, a)).toBe(a + b);
    expect(() => tieBreakKey("zz", b)).toThrow();
  });

  it("extractMac encuentra la MAC en alias o directa", () => {
    expect(extractMac(`Beto (${MAC})`)).toBe(MAC);
    expect(extractMac(MAC.toLowerCase())).toBe(MAC);
    expect(extractMac("sin mac")).toBeNull();
  });
});

describe("nativeTransport: handshake v3 + CONFIRM", () => {
  let f: ReturnType<typeof makeFake>;
  let ev: ReturnType<typeof makeEvents>;
  let t: NidoBluetoothTransport;

  beforeEach(() => {
    f = makeFake();
    ev = makeEvents();
    t = makeTransport(f.fake);
  });

  /**
   * Handshake legítimo completo en dos fases. Devuelve los nonces para
   * poder citarlos (o falsearlos) en pruebas posteriores.
   */
  async function completeHandshakeWithPeer(
    mac: string = MAC,
  ): Promise<{ eph: string; myNonceHex: string; peerNonceHex: string }> {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: mac, name: "Teléfono de Beto", incoming: true } as never);
    await tick();
    const eph = toHex(generateEphemeral().publicKey);
    const ph = peerHello(eph);
    f.emit("onFrame", { address: mac, base64: ph.b64 } as never);
    await tick();
    // Fase 1 completa: nuestro HELLO salió y respondimos con CONFIRM,
    // pero la ruta AÚN no existe (invariante central R4).
    expect(f.sent).toHaveLength(2);
    expect(ev.handshakes).toHaveLength(0);
    const myHello = parseHello(decodeBase64(f.sent[0].base64));
    const ourConfirm = parseConfirm(decodeBase64(f.sent[1].base64));
    expect(ourConfirm.pk).toBe(MY_PK_HEX);
    expect(ourConfirm.cn).toBe(myHello.nonce); // nuestro nonce fresco
    expect(ourConfirm.pn).toBe(ph.nonceHex); // el nonce del peer en ESTA conexión
    // Fase 2: el peer confirma con presencia viva → ruta establecida.
    f.emit("onFrame", {
      address: mac,
      base64: peerConfirm(ph.nonceHex, myHello.nonce),
    } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(1);
    return { eph, myNonceHex: myHello.nonce, peerNonceHex: ph.nonceHex };
  }

  it("al conectar envía un HELLO v3 firmado con mi pk, efímera, nonce y ts", async () => {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "X", incoming: true } as never);
    await tick();
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0].address).toBe(MAC);
    const hello = parseHello(decodeBase64(f.sent[0].base64));
    expect(hello.pk).toBe(MY_PK_HEX);
    expect(hello.eph).toMatch(/^[0-9a-f]{64}$/);
    expect(hello.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(hello.sig).toMatch(/^[0-9a-f]{128}$/);
    // ts firmado y fresco (±10 min).
    expect(Math.abs(nowSec() - hello.ts)).toBeLessThanOrEqual(600);
    const msg = buildHelloSignMessageV3(hello.pk, hello.eph, hello.nonce, hello.ts);
    expect(verifyDetached(msg, fromHex(hello.sig), MY_SIGN.publicKey)).toBe(true);
    await t.stopDiscovery();
  });

  it("INVARIANTE R4: HELLO válido sin CONFIRM jamás mueve la ruta", async () => {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "Teléfono de Beto", incoming: true } as never);
    await tick();
    const ph = peerHello(toHex(generateEphemeral().publicKey));
    f.emit("onFrame", { address: MAC, base64: ph.b64 } as never);
    await tick();
    // El transporte respondió con su CONFIRM…
    expect(f.sent).toHaveLength(2);
    expect(() => parseConfirm(decodeBase64(f.sent[1].base64))).not.toThrow();
    // …pero NO hay ruta: ni handshake, ni peer encontrado, ni envío posible.
    expect(ev.handshakes).toHaveLength(0);
    expect(ev.found).toHaveLength(0);
    await expect(t.sendFrame(PEER_PK_HEX, new Uint8Array([1, 2, 3]))).rejects.toThrow(
      /no conectado/i,
    );
    // Y un frame de datos en otra MAC no se enruta a ningún pk.
    f.emit("onFrame", {
      address: ATTACKER_MAC,
      base64: encodeBase64(new Uint8Array([9, 9, 9])),
    } as never);
    await tick();
    expect(ev.frames).toHaveLength(0);
    await t.stopDiscovery();
  });

  it("CONFIRM válido del peer → ruta y sesión establecidas", async () => {
    const { eph, myNonceHex, peerNonceHex } = await completeHandshakeWithPeer();
    expect(ev.handshakes).toHaveLength(1);
    expect(ev.handshakes[0].pk).toBe(PEER_PK_HEX);
    expect(ev.handshakes[0].sec).toHaveLength(32);
    expect(toHex(ev.handshakes[0].eph)).toBe(eph);
    expect(toHex(ev.handshakes[0].myNonce)).toBe(myNonceHex);
    expect(toHex(ev.handshakes[0].theirNonce)).toBe(peerNonceHex);
    expect(ev.found).toHaveLength(1);
    expect(ev.found[0]).toMatchObject({ pkHex: PEER_PK_HEX, alias: "Beto" });
    expect(ev.errors).toHaveLength(0);
    await t.stopDiscovery();
  });

  it("CONFIRM con firma forjada → rechazado, sin ruta", async () => {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "X", incoming: true } as never);
    await tick();
    const ph = peerHello(toHex(generateEphemeral().publicKey));
    f.emit("onFrame", { address: MAC, base64: ph.b64 } as never);
    await tick();
    const myHello = parseHello(decodeBase64(f.sent[0].base64));
    // El atacante firma el CONFIRM con otra clave (no puede usar la del peer).
    f.emit("onFrame", {
      address: MAC,
      base64: peerConfirm(ph.nonceHex, myHello.nonce, PEER_PK_HEX, generateSigningKeypair()),
    } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(0);
    expect(ev.errors.join(" ")).toMatch(/firma.*inválida|intermediario/i);
    expect(f.disconnected).toContain(MAC);
    await expect(t.sendFrame(PEER_PK_HEX, new Uint8Array([1]))).rejects.toThrow(/no conectado/i);
    await t.stopDiscovery();
  });

  it("CONFIRM reflejado (mi propio CONFIRM devuelto) → rechazado por identidad", async () => {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "X", incoming: true } as never);
    await tick();
    const ph = peerHello(toHex(generateEphemeral().publicKey));
    f.emit("onFrame", { address: MAC, base64: ph.b64 } as never);
    await tick();
    // El atacante me devuelve mi propio CONFIRM: nombra MI pk, no la del peer.
    f.emit("onFrame", { address: MAC, base64: f.sent[1].base64 } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(0);
    expect(ev.errors.join(" ")).toMatch(/identidad inesperada/i);
    expect(f.disconnected).toContain(MAC);
    await t.stopDiscovery();
  });

  it("CONFIRM que no cita mi nonce fresco (pn ajeno) → rechazado", async () => {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "X", incoming: true } as never);
    await tick();
    const ph = peerHello(toHex(generateEphemeral().publicKey));
    f.emit("onFrame", { address: MAC, base64: ph.b64 } as never);
    await tick();
    const myHello = parseHello(decodeBase64(f.sent[0].base64));
    const wrongPn = toHex(randomNonce(HANDSHAKE_NONCE_BYTES));
    expect(wrongPn).not.toBe(myHello.nonce);
    f.emit("onFrame", {
      address: MAC,
      base64: peerConfirm(ph.nonceHex, wrongPn),
    } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(0);
    expect(ev.errors.join(" ")).toMatch(/nonce ajeno/i);
    expect(f.disconnected).toContain(MAC);
    await t.stopDiscovery();
  });

  it("CONFIRM que no cita el nonce del peer de esta conexión (cn ajeno) → rechazado", async () => {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "X", incoming: true } as never);
    await tick();
    const ph = peerHello(toHex(generateEphemeral().publicKey));
    f.emit("onFrame", { address: MAC, base64: ph.b64 } as never);
    await tick();
    const myHello = parseHello(decodeBase64(f.sent[0].base64));
    const wrongCn = toHex(randomNonce(HANDSHAKE_NONCE_BYTES));
    f.emit("onFrame", {
      address: MAC,
      base64: peerConfirm(wrongCn, myHello.nonce),
    } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(0);
    expect(ev.errors.join(" ")).toMatch(/nonce propio/i);
    expect(f.disconnected).toContain(MAC);
    await t.stopDiscovery();
  });

  it("HELLO v2 → hard cut con mensaje de actualización", async () => {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "X", incoming: true } as never);
    await tick();
    const v2 = new TextEncoder().encode(
      JSON.stringify({
        t: "nido-hello",
        v: 2,
        pk: PEER_PK_HEX,
        eph: toHex(generateEphemeral().publicKey),
        nonce: toHex(randomNonce(HANDSHAKE_NONCE_BYTES)),
        ts: nowSec(),
        sig: "ab".repeat(64),
      }),
    );
    f.emit("onFrame", { address: MAC, base64: encodeBase64(v2) } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(0);
    expect(ev.errors.join(" ")).toMatch(/actualiza su app/);
    expect(f.disconnected).toContain(MAC);
    await t.stopDiscovery();
  });

  it("HELLO con ts fuera del margen → rechazado por frescura", async () => {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "X", incoming: true } as never);
    await tick();
    const stale = peerHello(toHex(generateEphemeral().publicKey), PEER_PK_HEX, nowSec() - 3600);
    f.emit("onFrame", { address: MAC, base64: stale.b64 } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(0);
    expect(ev.errors.join(" ")).toMatch(/reloj|margen/i);
    expect(f.disconnected).toContain(MAC);
    // No se envió CONFIRM ante un HELLO con ts inválido.
    expect(f.sent).toHaveLength(1);
    await t.stopDiscovery();
  });

  it("frames posteriores al handshake se enrutan al peer verificado", async () => {
    await completeHandshakeWithPeer();
    const payload = new Uint8Array([1, 2, 3]);
    f.emit("onFrame", { address: MAC, base64: encodeBase64(payload) } as never);
    await tick();
    expect(ev.frames).toHaveLength(1);
    expect(ev.frames[0].pk).toBe(PEER_PK_HEX);
    expect(ev.frames[0].frame).toEqual(payload);
    await t.stopDiscovery();
  });

  it("red-team: HELLO capturado (mismos bytes) en otra conexión → anti-replay lo rechaza", async () => {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "Teléfono de Beto", incoming: true } as never);
    await tick();
    // HELLO real del peer: viaja en claro por el aire y un atacante cercano puede capturarlo.
    const eph = toHex(generateEphemeral().publicKey);
    const captured = peerHello(eph);
    f.emit("onFrame", { address: MAC, base64: captured.b64 } as never);
    await tick();
    const myHello = parseHello(decodeBase64(f.sent[0].base64));
    f.emit("onFrame", {
      address: MAC,
      base64: peerConfirm(captured.nonceHex, myHello.nonce),
    } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(1);
    // El atacante abre OTRA conexión (su propia MAC) y reinyecta el HELLO capturado.
    f.emit("onConnected", { address: ATTACKER_MAC, name: "Atacante", incoming: true } as never);
    await tick();
    f.emit("onFrame", { address: ATTACKER_MAC, base64: captured.b64 } as never);
    await tick();
    // La firma es válida (es el HELLO real), pero el nonce ya se reclamó:
    // el duplicado se rechaza sin tocar la ruta viva.
    expect(ev.handshakes).toHaveLength(1);
    expect(ev.errors.join(" ")).toMatch(/repetido|re-inyección/i);
    expect(f.disconnected).toContain(ATTACKER_MAC);
    const before = f.sent.length;
    await t.sendFrame(PEER_PK_HEX, new Uint8Array([9, 9, 9]));
    expect(f.sent[before].address).toBe(MAC);
    await t.stopDiscovery();
  });

  it("HELLO fresco con ruta viva reciente → cooldown lo rechaza sin sustituir la sesión", async () => {
    await completeHandshakeWithPeer();
    // Un HELLO NUEVO y genuino del peer (nonce fresco: solo el peer real
    // podría firmarlo) en otra MAC mientras la ruta está viva y reciente.
    f.emit("onConnected", { address: ATTACKER_MAC, name: "Atacante", incoming: true } as never);
    await tick();
    const fresh = peerHello(toHex(generateEphemeral().publicKey));
    f.emit("onFrame", { address: ATTACKER_MAC, base64: fresh.b64 } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(1);
    expect(ev.errors.join(" ")).toMatch(/duplicado/i);
    expect(f.disconnected).toContain(ATTACKER_MAC);
    const before = f.sent.length;
    await t.sendFrame(PEER_PK_HEX, new Uint8Array([9, 9, 9]));
    expect(f.sent[before].address).toBe(MAC);
    await t.stopDiscovery();
  });

  it("peer NO emparejado → se cierra la conexión y no hay handshake", async () => {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "Desconocido", incoming: true } as never);
    await tick();
    const otherPk = toHex(new Uint8Array(32).fill(9));
    const otherSign = generateSigningKeypair();
    const ph = peerHello(toHex(generateEphemeral().publicKey), otherPk, nowSec(), otherSign);
    f.emit("onFrame", { address: MAC, base64: ph.b64 } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(0);
    expect(f.disconnected).toContain(MAC);
    expect(ev.errors.join(" ")).toMatch(/no emparejado/i);
    await t.stopDiscovery();
  });

  it("HELLO inválido → conexión cerrada sin handshake", async () => {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "X", incoming: true } as never);
    await tick();
    f.emit("onFrame", { address: MAC, base64: encodeBase64(new Uint8Array([9, 9])) } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(0);
    expect(f.disconnected).toContain(MAC);
    await t.stopDiscovery();
  });

  it("connect(alias) hace el flujo completo y resuelve con el peer", async () => {
    const eph = toHex(generateEphemeral().publicKey);
    const promise = t.connect(`Beto (${MAC})`);
    await tick();
    // Nuestro HELLO ya salió; el peer responde en dos fases.
    const myHello = parseHello(decodeBase64(f.sent[0].base64));
    const ph = peerHello(eph);
    f.emit("onFrame", { address: MAC, base64: ph.b64 } as never);
    await tick();
    expect(f.sent).toHaveLength(2); // HELLO + CONFIRM propios
    f.emit("onFrame", {
      address: MAC,
      base64: peerConfirm(ph.nonceHex, myHello.nonce),
    } as never);
    const info = await promise;
    expect(info).toMatchObject({ pkHex: PEER_PK_HEX, alias: "Beto", transport: "bluetooth" });
    await t.stopDiscovery();
  });

  it("sendFrame sin ruta → lanza (el messenger lo encola)", async () => {
    await t.startDiscovery(ev.events);
    await expect(t.sendFrame(PEER_PK_HEX, new Uint8Array([1]))).rejects.toThrow(/no conectado/i);
    await t.stopDiscovery();
  });

  it("sendFrame tras handshake llega a la MAC en base64", async () => {
    await completeHandshakeWithPeer();
    const before = f.sent.length;
    const frame = new Uint8Array([5, 6, 7, 8]);
    await t.sendFrame(PEER_PK_HEX, frame);
    expect(f.sent).toHaveLength(before + 1);
    expect(f.sent[before].address).toBe(MAC);
    expect(decodeBase64(f.sent[before].base64)).toEqual(frame);
    await t.stopDiscovery();
  });

  it("onDisconnected limpia la ruta y avisa", async () => {
    await completeHandshakeWithPeer();
    f.emit("onDisconnected", { address: MAC } as never);
    expect(ev.lost).toContain(PEER_PK_HEX);
    await expect(t.sendFrame(PEER_PK_HEX, new Uint8Array([1]))).rejects.toThrow();
    await t.stopDiscovery();
  });

  it("Bluetooth apagado → error claro", async () => {
    const f2 = makeFake();
    f2.fake.isBluetoothEnabled = () => false;
    const t2 = makeTransport(f2.fake);
    await expect(t2.startDiscovery(ev.events)).rejects.toThrow(/apagado/i);
  });

  it("sin permisos → error claro", async () => {
    const f2 = makeFake();
    f2.fake.requestPermissions = async () => false;
    const t2 = makeTransport(f2.fake);
    await expect(t2.startDiscovery(ev.events)).rejects.toThrow(/permisos/i);
  });

  it("MITM: efímero sustituido tras la firma → conexión cerrada, sin handshake", async () => {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "X", incoming: true } as never);
    await tick();
    // El atacante reenvía el HELLO con SU efímero pero la firma original.
    f.emit("onFrame", {
      address: MAC,
      base64: mitmHello(toHex(generateEphemeral().publicKey)),
    } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(0);
    expect(f.disconnected).toContain(MAC);
    expect(ev.errors.join(" ")).toMatch(/firma inválida|intermediario/i);
    await t.stopDiscovery();
  });

  it("firma forjada con otra clave → rechazada aunque el pk sea conocido", async () => {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "X", incoming: true } as never);
    await tick();
    f.emit("onFrame", {
      address: MAC,
      base64: forgedHello(toHex(generateEphemeral().publicKey)),
    } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(0);
    expect(f.disconnected).toContain(MAC);
    expect(ev.errors.join(" ")).toMatch(/firma.*inválida/i);
    await t.stopDiscovery();
  });

  it("HELLO con mi propia pk → rechazado", async () => {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "X", incoming: true } as never);
    await tick();
    const nonceHex = toHex(randomNonce(HANDSHAKE_NONCE_BYTES));
    const ephHex = toHex(generateEphemeral().publicKey);
    const ts = nowSec();
    const sigHex = toHex(
      signDetached(buildHelloSignMessageV3(MY_PK_HEX, ephHex, nonceHex, ts), MY_SIGN.secretKey),
    );
    // Firmado por mí pero findContactByPk no me conoce → no emparejado.
    f.emit("onFrame", {
      address: MAC,
      base64: encodeBase64(buildHello(MY_PK_HEX, ephHex, nonceHex, ts, sigHex)),
    } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(0);
    expect(f.disconnected).toContain(MAC);
    await t.stopDiscovery();
  });

  it("replay de HELLO con ruta viva → no crea sesión nueva ni rompe la actual", async () => {
    await completeHandshakeWithPeer();
    // El atacante reenvía un HELLO válido del peer (firma correcta) sobre
    // la misma MAC. Con la ruta viva, no hay pendiente: el frame cae en la
    // ruta existente y se ignora al no ser un frame de sesión.
    const sameBytes = peerHello(toHex(generateEphemeral().publicKey));
    f.emit("onFrame", { address: MAC, base64: sameBytes.b64 } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(1); // sin handshake nuevo
    expect(f.disconnected).not.toContain(MAC); // la ruta sigue viva
    await t.stopDiscovery();
  });

  it("CONFIRM nunca llega → timeout fail-closed (10 s) y la ruta nunca se crea", async () => {
    vi.useFakeTimers();
    try {
      await t.startDiscovery(ev.events);
      f.emit("onConnected", { address: MAC, name: "X", incoming: true } as never);
      await vi.advanceTimersByTimeAsync(50);
      const ph = peerHello(toHex(generateEphemeral().publicKey));
      f.emit("onFrame", { address: MAC, base64: ph.b64 } as never);
      await vi.advanceTimersByTimeAsync(50);
      // Fase 1 OK (HELLO + CONFIRM enviados) pero sin ruta.
      expect(f.sent).toHaveLength(2);
      expect(ev.handshakes).toHaveLength(0);
      await expect(t.sendFrame(PEER_PK_HEX, new Uint8Array([1]))).rejects.toThrow(/no conectado/i);
      // El peer jamás confirma: el timeout cierra fail-closed.
      await vi.advanceTimersByTimeAsync(CONFIRM_WAIT_MS + 50);
      expect(ev.errors.join(" ")).toMatch(/CONFIRM/i);
      expect(f.disconnected).toContain(MAC);
      expect(ev.handshakes).toHaveLength(0);
      await expect(t.sendFrame(PEER_PK_HEX, new Uint8Array([1]))).rejects.toThrow(/no conectado/i);
      await t.stopDiscovery();
    } finally {
      vi.useRealTimers();
    }
  });

  it("nonces distintos → claves de sesión distintas (replay no resucita sesión)", () => {
    // Cada secreto efímero es de un solo uso: deriveSessionKeyV2 lo borra
    // (higiene de forward-secrecy). Cada derivación usa un par fresco.
    const n1 = randomNonce(HANDSHAKE_NONCE_BYTES);
    const n2 = randomNonce(HANDSHAKE_NONCE_BYTES);
    const a1 = generateEphemeral();
    const b1 = generateEphemeral();
    const k1 = deriveSessionKeyV2(a1.secretKey, b1.publicKey, n1, n2);
    const a2 = generateEphemeral();
    const k2 = deriveSessionKeyV2(a2.secretKey, b1.publicKey, n1, randomNonce(HANDSHAKE_NONCE_BYTES));
    expect(toHex(k1)).not.toBe(toHex(k2));
    // Mismos inputs → misma clave (ambos lados coinciden).
    const k1b = deriveSessionKeyV2(b1.secretKey, a1.publicKey, n2, n1);
    expect(toHex(k1)).toBe(toHex(k1b));
  });
});

describe("nativeTransport: simultaneous dial (tie-break determinista)", () => {
  let f: ReturnType<typeof makeFake>;
  let ev: ReturnType<typeof makeEvents>;
  let t: NidoBluetoothTransport;

  beforeEach(() => {
    f = makeFake();
    ev = makeEvents();
    t = makeTransport(f.fake);
  });

  /**
   * Dos sockets confirmados con el mismo peer. Devuelve la MAC que el
   * transporte conservó. `reversed` invierte el orden de llegada de los
   * CONFIRMs: el ganador del tie-break debe ser el mismo.
   */
  async function simultaneousDial(
    firstMac: string,
    secondMac: string,
    reversed = false,
  ): Promise<string> {
    await t.startDiscovery(ev.events);
    // Socket 1: fases HELLO.
    f.emit("onConnected", { address: firstMac, name: "Beto-1", incoming: true } as never);
    await tick();
    const ph1 = peerHello(toHex(generateEphemeral().publicKey));
    f.emit("onFrame", { address: firstMac, base64: ph1.b64 } as never);
    await tick();
    const myHello1 = parseHello(decodeBase64(f.sent[0].base64));
    // Socket 2: fases HELLO.
    f.emit("onConnected", { address: secondMac, name: "Beto-2", incoming: true } as never);
    await tick();
    const ph2 = peerHello(toHex(generateEphemeral().publicKey));
    f.emit("onFrame", { address: secondMac, base64: ph2.b64 } as never);
    await tick();
    const myHello2 = parseHello(decodeBase64(f.sent[2].base64));
    // Claves canónicas por socket (lo que ambos peers calcularían
    // independientemente): el ganador NO depende del orden local.
    const k1 = tieBreakKey(myHello1.nonce, ph1.nonceHex);
    const k2 = tieBreakKey(myHello2.nonce, ph2.nonceHex);
    const expectedWinner = k1 < k2 ? firstMac : secondMac;
    // Los CONFIRMs llegan en el orden indicado.
    const first = { mac: firstMac, cn: ph1.nonceHex, pn: myHello1.nonce };
    const second = { mac: secondMac, cn: ph2.nonceHex, pn: myHello2.nonce };
    const seq = reversed ? [second, first] : [first, second];
    for (const s of seq) {
      f.emit("onFrame", { address: s.mac, base64: peerConfirm(s.cn, s.pn) } as never);
      await tick();
    }
    // El ganador es determinista por los nonces; el orden de llegada solo
    // decide si el perdedor alcanzó a emitir su evento de handshake antes de
    // ser desplazado (1 evento) o no (2 eventos: el segundo lo supersede).
    // Lo que el diseño exige (§4.5): al final hay UNA sola ruta y es la del
    // ganador.
    expect(ev.handshakes.length).toBeGreaterThanOrEqual(1);
    expect(ev.handshakes.length).toBeLessThanOrEqual(2);
    const before = f.sent.length;
    await t.sendFrame(PEER_PK_HEX, new Uint8Array([7]));
    expect(f.sent[before].address).toBe(expectedWinner);
    return expectedWinner;
  }

  it("dos sockets confirmados → gana el de menor K (CONFIRMs en orden 1→2)", async () => {
    const winner = await simultaneousDial(MAC, MAC2, false);
    // El perdedor se desconectó con gracia; la ruta sobreviviente es la ganadora.
    const loser = winner === MAC ? MAC2 : MAC;
    expect(f.disconnected).toContain(loser);
    expect(ev.errors).toHaveLength(0);
    await t.stopDiscovery();
  });

  it("dos sockets confirmados → gana el de menor K (CONFIRMs en orden 2→1)", async () => {
    const winner = await simultaneousDial(MAC, MAC2, true);
    const loser = winner === MAC ? MAC2 : MAC;
    expect(f.disconnected).toContain(loser);
    expect(ev.errors).toHaveLength(0);
    await t.stopDiscovery();
  });
});

describe("base64 sin dependencias", () => {
  it("roundtrip con padding variado", () => {
    for (const bytes of [
      new Uint8Array([]),
      new Uint8Array([1]),
      new Uint8Array([1, 2]),
      new Uint8Array([1, 2, 3]),
      new Uint8Array(256).map((_, i) => i),
    ]) {
      expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
    }
  });
});

describe("R4: anti-replay persistente de HELLO (nonce claim atómico)", () => {
  let f: ReturnType<typeof makeFake>;
  let ev: ReturnType<typeof makeEvents>;
  let t: NidoBluetoothTransport;

  beforeEach(() => {
    f = makeFake();
    ev = makeEvents();
    t = makeTransport(f.fake);
    e2eMem.messages = [];
  });

  /** Simula >10 s desde el último handshake: el cooldown ya no protege. */
  function expireCooldown() {
    (t as unknown as { lastHandshakeAt: Map<string, number> }).lastHandshakeAt.set(
      PEER_PK_HEX.toLowerCase(),
      Date.now() - 11_000,
    );
  }

  /** Handshake legítimo entrante en dos fases; devuelve el HELLO exacto (capturable). */
  async function legitHandshake(fromMac: string = MAC): Promise<string> {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: fromMac, name: "Teléfono de Beto", incoming: true } as never);
    await tick();
    const captured = peerHello(toHex(generateEphemeral().publicKey));
    f.emit("onFrame", { address: fromMac, base64: captured.b64 } as never);
    await tick();
    const myHello = parseHello(decodeBase64(f.sent[0].base64));
    f.emit("onFrame", {
      address: fromMac,
      base64: peerConfirm(captured.nonceHex, myHello.nonce),
    } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(1);
    return captured.b64;
  }

  /** El atacante abre su propia conexión RFCOMM y reinyecta bytes capturados. */
  async function replayFromAttacker(capturedB64: string) {
    f.emit("onConnected", { address: ATTACKER_MAC, name: "Atacante", incoming: true } as never);
    await tick();
    f.emit("onFrame", { address: ATTACKER_MAC, base64: capturedB64 } as never);
    await tick();
  }

  it("replay del HELLO capturado tras expirar el cooldown → rechazado; la ruta no se toca", async () => {
    const captured = await legitHandshake();
    expireCooldown(); // el hueco probado: el cooldown de 10 s ya no frena el replay
    await replayFromAttacker(captured);
    // Sin handshake nuevo: el replay ni siquiera llega a fase de CONFIRM válida.
    expect(ev.handshakes).toHaveLength(1);
    expect(ev.errors.join(" ")).toMatch(/repetido|re-inyección/i);
    // Fail-closed: el socket del atacante se cierra.
    expect(f.disconnected).toContain(ATTACKER_MAC);
    // La ruta sigue apuntando a la MAC legítima: ningún frame sale al atacante.
    const before = f.sent.length;
    await t.sendFrame(PEER_PK_HEX, new Uint8Array([9, 9, 9]));
    expect(f.sent).toHaveLength(before + 1);
    expect(f.sent[before].address).toBe(MAC);
    await t.stopDiscovery();
  });

  it("replay sin ruta previa (socket legítimo caído) → también rechazado", async () => {
    const captured = await legitHandshake();
    // El socket legítimo cae: la ruta se olvida, pero la memoria anti-replay persiste.
    f.emit("onDisconnected", { address: MAC } as never);
    await tick();
    expect(ev.lost).toContain(PEER_PK_HEX);
    await replayFromAttacker(captured);
    expect(ev.handshakes).toHaveLength(1);
    expect(ev.errors.join(" ")).toMatch(/repetido|re-inyección/i);
    expect(f.disconnected).toContain(ATTACKER_MAC);
    await t.stopDiscovery();
  });

  it("reconnect legítimo con nonce fresco → aceptado (el anti-replay no bloquea handshakes reales)", async () => {
    await legitHandshake();
    f.emit("onDisconnected", { address: MAC } as never);
    await tick();
    // El peer real vuelve con un HELLO nuevo: nonce fresco, firma válida.
    f.emit("onConnected", { address: MAC, name: "Teléfono de Beto", incoming: true } as never);
    await tick();
    const ph = peerHello(toHex(generateEphemeral().publicKey));
    // Nuestro segundo HELLO ya salió con el onConnected de arriba.
    const ourHello2 = parseHello(decodeBase64(f.sent[f.sent.length - 1].base64));
    f.emit("onFrame", { address: MAC, base64: ph.b64 } as never);
    await tick();
    const myHello = ourHello2;
    f.emit("onFrame", {
      address: MAC,
      base64: peerConfirm(ph.nonceHex, myHello.nonce),
    } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(2);
    expect(ev.errors).toHaveLength(0);
    await t.stopDiscovery();
  });

  it("material stale: tras un segundo handshake legítimo, el nonce viejo sigue rechazado", async () => {
    const first = await legitHandshake();
    f.emit("onDisconnected", { address: MAC } as never);
    await tick();
    f.emit("onConnected", { address: MAC, name: "Teléfono de Beto", incoming: true } as never);
    await tick();
    const ph = peerHello(toHex(generateEphemeral().publicKey));
    // Nuestro segundo HELLO ya salió con el onConnected de arriba.
    const ourHello2 = parseHello(decodeBase64(f.sent[f.sent.length - 1].base64));
    f.emit("onFrame", { address: MAC, base64: ph.b64 } as never);
    await tick();
    const myHello = ourHello2;
    f.emit("onFrame", {
      address: MAC,
      base64: peerConfirm(ph.nonceHex, myHello.nonce),
    } as never);
    await tick();
    expect(ev.handshakes).toHaveLength(2);
    expireCooldown(); // aísla el check anti-replay del cooldown
    await replayFromAttacker(first);
    expect(ev.handshakes).toHaveLength(2);
    expect(ev.errors.join(" ")).toMatch(/repetido|re-inyección/i);
    expect(f.disconnected).toContain(ATTACKER_MAC);
    await t.stopDiscovery();
  });

  it("end-to-end: sesión viva + HELLO repetido → sendChat jamás marca `sent` hacia la MAC del atacante", async () => {
    // Cableado real: messenger sobre el transporte nativo con radio simulada.
    const m = new NidoMessenger(t);
    await m.ensureIdentity();
    const errors: string[] = [];
    const handshakes: Array<{
      sec: Uint8Array;
      eph: Uint8Array;
      myNonce: Uint8Array;
      theirNonce: Uint8Array;
    }> = [];
    await t.startDiscovery({
      onHandshakeComplete: (pk, sec, eph, myNonce, theirNonce) => {
        // Copia antes de completeHandshake: la KDF borra el secreto
        // efímero in-place (higiene de forward-secrecy); el espejo del
        // peer modela su propia copia del secreto.
        handshakes.push({ sec: sec.slice(), eph, myNonce, theirNonce });
        void m.completeHandshake(pk, sec, eph, myNonce, theirNonce).catch(() => {});
      },
      onFrame: (pk, frame) => {
        void m.handleFrame(pk, frame).catch(() => {});
      },
      onError: (msg) => {
        errors.push(msg);
      },
    });

    // 1) Handshake legítimo con Beto en dos fases; el atacante captura el HELLO en el aire.
    f.emit("onConnected", { address: MAC, name: "Teléfono de Beto", incoming: true } as never);
    await tick();
    const captured = peerHello(toHex(generateEphemeral().publicKey));
    f.emit("onFrame", { address: MAC, base64: captured.b64 } as never);
    await tick();
    const myHello = parseHello(decodeBase64(f.sent[0].base64));
    f.emit("onFrame", {
      address: MAC,
      base64: peerConfirm(captured.nonceHex, myHello.nonce),
    } as never);
    await tick();
    expect(handshakes).toHaveLength(1);

    // 2) Sesión viva: el peer confirma con un frame válido bajo la clave del
    //    handshake (la candidata se promociona; isPeerLive = true).
    const hs = handshakes[0];
    // Cada fromHandshakeV2 consume (borra) su buffer de secreto: el peer
    // y nuestra vista usan copias independientes, como en la realidad.
    const mirror = P2PSession.fromHandshakeV2(hs.sec.slice(), hs.eph, PEER_PK_HEX, hs.myNonce, hs.theirNonce);
    // Vista "lado Alice" de la misma sesión: misma clave, etiquetas invertidas,
    // para verificar los frames que NOSOTROS enviamos.
    const aliceSide = P2PSession.fromHandshakeV2(hs.sec.slice(), hs.eph, MY_PK_HEX, hs.myNonce, hs.theirNonce);
    aliceSide.expectRecipient(PEER_PK_HEX);
    const confirm = mirror.pack(
      makeEnvelope("session_confirm", "confirm-e2e-1", fromHex(PEER_PK_HEX), MY_PK_HEX, {}),
    );
    f.emit("onFrame", { address: MAC, base64: encodeBase64(confirm) } as never);
    await tick();

    // 3) Envío directo con sesión viva: sale por la MAC legítima y queda `sent`.
    const r1 = await m.sendChat("Beto", "hola");
    expect(r1.queued).toBe(false);
    const sent1 = f.sent[f.sent.length - 1];
    expect(sent1.address).toBe(MAC);
    expect(aliceSide.unpack(decodeBase64(sent1.base64))?.type).toBe("chat");

    // 4) El atacante reinyecta el HELLO capturado con el cooldown expirado.
    (t as unknown as { lastHandshakeAt: Map<string, number> }).lastHandshakeAt.set(
      PEER_PK_HEX.toLowerCase(),
      Date.now() - 11_000,
    );
    f.emit("onConnected", { address: ATTACKER_MAC, name: "Atacante", incoming: true } as never);
    await tick();
    f.emit("onFrame", { address: ATTACKER_MAC, base64: captured.b64 } as never);
    await tick();
    expect(handshakes).toHaveLength(1); // el replay no deriva ni candidata
    expect(errors.join(" ")).toMatch(/repetido|re-inyección/i);
    expect(f.disconnected).toContain(ATTACKER_MAC);

    // 5) Segundo envío: sigue saliendo por la MAC legítima. Al atacante solo
    //    le llegó nuestro propio HELLO/CONFIRM de handshake, jamás un frame cifrado.
    const r2 = await m.sendChat("Beto", "segundo");
    expect(r2.queued).toBe(false);
    const sent2 = f.sent[f.sent.length - 1];
    expect(sent2.address).toBe(MAC);
    expect(aliceSide.unpack(decodeBase64(sent2.base64))?.type).toBe("chat");
    for (const s of f.sent.filter((s) => s.address === ATTACKER_MAC)) {
      const parsed = (() => {
        try {
          return parseHello(decodeBase64(s.base64));
        } catch {
          return null;
        }
      })();
      if (!parsed) {
        // Solo se acepta nuestro CONFIRM (fase 1) hacia el atacante.
        expect(() => parseConfirm(decodeBase64(s.base64))).not.toThrow();
      }
    }
    // Ambos mensajes quedaron registrados como `sent`… y ambos viajaron de
    // verdad a la MAC legítima: ningún `sent` falso.
    const statuses = e2eMem.messages
      .filter((mm) => mm["dir"] === "out")
      .map((mm) => mm["status"]);
    expect(statuses).toEqual(["sent", "sent"]);
    await t.stopDiscovery();
  });
});

describe("B/F4: apagado nativo en la destrucción terminal", () => {
  it("destroy() detiene discovery/servidor y DESPUÉS invoca el shutdown nativo", async () => {
    const f = makeFake();
    const t = makeTransport(f.fake);
    const m = new NidoMessenger(t);
    const { events } = makeEvents();
    await t.startDiscovery(events);
    await m.destroy();
    // Orden: stopDiscovery() desuscribe y limpia primero; el apagado nativo
    // (cierre de sockets RFCOMM) va después, nunca antes.
    // P2P-ALWAYS-ON 2026-10-07: stopDiscovery() ya NO detiene el servidor;
    // el servidor se mantiene corriendo (foreground service) hasta el
    // shutdown terminal. Por eso "stopServer" ya no aparece aquí.
    expect(f.calls).toEqual([
      "startServer",
      "startDiscovery",
      "stopDiscovery",
      "shutdown",
    ]);
    // El messenger quedó invalidado: operar falla explícito (fail closed).
    await expect(m.startLink()).rejects.toThrow(/invalidado/i);
  });

  it("doble destroy() invoca el shutdown nativo una sola vez (idempotente)", async () => {
    const f = makeFake();
    const t = makeTransport(f.fake);
    const m = new NidoMessenger(t);
    await m.destroy();
    await m.destroy();
    expect(f.calls.filter((c) => c === "shutdown")).toHaveLength(1);
  });

  it("si el shutdown nativo lanza, destroy() igual completa e invalida el messenger", async () => {
    const f = makeFake();
    f.fake.shutdown = async () => {
      throw new Error("BT_ERROR: bridge nativo muerto");
    };
    const t = makeTransport(f.fake);
    const m = new NidoMessenger(t);
    // No lanza: el apagado nativo es best-effort; la invalidación en memoria
    // ya es efectiva y el wipe sigue fail-closed.
    await m.destroy();
    await expect(m.startLink()).rejects.toThrow(/invalidado/i);
  });

  it("destroy() con handshake en curso: el pendiente se rechaza y el shutdown nativo corre", async () => {
    const f = makeFake();
    // connect() que nunca resuelve ni emite eventos: el HELLO queda pendiente.
    f.fake.connect = async (address: string) => {
      await new Promise(() => {});
      return { address, name: "Peer" };
    };
    const t = makeTransport(f.fake);
    const m = new NidoMessenger(t);
    const { events } = makeEvents();
    await t.startDiscovery(events);
    const pendingConnect = t.connect("Peer (AA:BB:CC:DD:EE:11)");
    pendingConnect.catch(() => {}); // el rechazo se verifica abajo
    await tick();
    await m.destroy();
    // El pendiente se rechaza explícito (nada queda colgado)…
    await expect(pendingConnect).rejects.toThrow(/Discovery detenido/);
    // …y el apagado nativo se invocó de todos modos.
    expect(f.calls).toContain("shutdown");
  });

  it("stopLink() NO invoca el shutdown nativo (apagado temporal, no terminal)", async () => {
    const f = makeFake();
    const t = makeTransport(f.fake);
    const m = new NidoMessenger(t);
    const { events } = makeEvents();
    await t.startDiscovery(events);
    await m.stopLink();
    expect(f.calls).toContain("stopDiscovery");
    expect(f.calls).not.toContain("shutdown");
  });

  it("destroy() sin módulo nativo (loopback, sin shutdownNative) no falla", async () => {
    const m = new NidoMessenger(new LoopbackTransport());
    await m.destroy(); // no lanza aunque el transporte no exponga shutdownNative
    await expect(m.startLink()).rejects.toThrow(/invalidado/i);
  });

  it("shutdownNative() sin bindings es un no-op exitoso e idempotente", async () => {
    const t = makeTransport(null as unknown as NidoP2PBindings);
    await t.shutdownNative();
    await t.shutdownNative(); // segunda llamada: no-op
  });

  it("una instancia fresca post-destroy puede rearrancar discovery (reconnect preservado)", async () => {
    const f = makeFake();
    const t1 = makeTransport(f.fake);
    const m1 = new NidoMessenger(t1);
    await t1.startDiscovery(makeEvents().events);
    await m1.destroy();
    expect(f.calls).toContain("shutdown");
    // Instancia fresca del ciclo nuevo (como tras completeP2PDataReset):
    // el servidor nativo puede rearrancar sin residuos del ciclo anterior.
    const t2 = makeTransport(f.fake);
    await t2.startDiscovery(makeEvents().events);
    expect(f.calls.filter((c) => c === "startServer")).toHaveLength(2);
    await t2.stopDiscovery();
  });
});

describe("DIAG-2026-10-07: estado del servidor RFCOMM nativo", () => {
  it("readServerStatus devuelve el estado nativo cuando el binding lo expone", () => {
    const f = makeFake();
    (f.fake as NidoP2PBindings).getServerStatus = () => ({
      alive: true,
      acceptedCount: 3,
      lastAcceptAt: 1234567890,
    });
    const t = makeTransport(f.fake);
    expect(t.readServerStatus()).toEqual({ alive: true, acceptedCount: 3, lastAcceptAt: 1234567890 });
  });

  it("readServerStatus devuelve null con bindings viejos (sin getServerStatus)", () => {
    const f = makeFake();
    const t = makeTransport(f.fake);
    expect(t.readServerStatus()).toBeNull();
  });

  it("doLink falla con error visible si el servidor no quedó escuchando", async () => {
    const f = makeFake();
    (f.fake as NidoP2PBindings).getServerStatus = () => ({
      alive: false,
      acceptedCount: 0,
      lastAcceptAt: 0,
    });
    const t = makeTransport(f.fake);
    await expect(t.startDiscovery(makeEvents().events)).rejects.toThrow(/no quedó escuchando/);
  });

  it("doLink continúa normal si el servidor quedó escuchando", async () => {
    const f = makeFake();
    (f.fake as NidoP2PBindings).getServerStatus = () => ({
      alive: true,
      acceptedCount: 0,
      lastAcceptAt: 0,
    });
    const t = makeTransport(f.fake);
    await t.startDiscovery(makeEvents().events);
    expect(f.calls).toContain("startServer");
    await t.stopDiscovery();
  });

  it("doLink continúa normal con bindings viejos (sin diagnóstico)", async () => {
    const f = makeFake();
    const t = makeTransport(f.fake);
    await t.startDiscovery(makeEvents().events);
    expect(f.calls).toContain("startServer");
    await t.stopDiscovery();
  });
});

describe("BUG-6-2026-10-07: MACs emparejadas a nivel OS en el barrido", () => {
  it("getBondedMacs devuelve las MACs normalizadas a mayúsculas", async () => {
    const f = makeFake();
    const t = makeTransport(f.fake);
    expect(await t.getBondedMacs()).toEqual(["AA:BB:CC:DD:EE:FF"]);
  });

  it("getBondedMacs filtra entradas inválidas y deduplica", async () => {
    const f = makeFake();
    (f.fake as NidoP2PBindings).getBondedDevices = async () => [
      { address: "aa:bb:cc:dd:ee:ff", name: "Tablet" },
      { address: "AA:BB:CC:DD:EE:FF", name: "Duplicado" },
      { address: "no-es-mac", name: "Basura" },
      { address: "", name: null },
    ];
    const t = makeTransport(f.fake);
    expect(await t.getBondedMacs()).toEqual(["AA:BB:CC:DD:EE:FF"]);
  });

  it("getBondedMacs devuelve [] si el binding falla (best-effort)", async () => {
    const f = makeFake();
    (f.fake as NidoP2PBindings).getBondedDevices = async () => {
      throw new Error("BT apagado");
    };
    const t = makeTransport(f.fake);
    expect(await t.getBondedMacs()).toEqual([]);
  });

  it("el fake sin getBondedDevices no compila: el binding es obligatorio (regression)", () => {
    // Si alguien quita getBondedDevices del puente JS, este test falla en tsc
    // porque NidoP2PBindings lo exige.
    const f = makeFake();
    expect(typeof f.fake.getBondedDevices).toBe("function");
  });
});

describe("R7: higiene del secreto efímero + carrera de handshake", () => {
  let f: ReturnType<typeof makeFake>;
  let ev: ReturnType<typeof makeEvents>;
  let t: NidoBluetoothTransport;

  beforeEach(() => {
    f = makeFake();
    ev = makeEvents();
    t = makeTransport(f.fake);
  });

  type PendingView = { myEphSecret: Uint8Array };
  const pendingOf = (tt: NidoBluetoothTransport) =>
    (tt as unknown as { pending: Map<string, PendingView> }).pending;

  it("failHello borra el secreto efímero (no solo la ruta de éxito)", async () => {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "X", incoming: true } as never);
    await tick();
    expect(f.sent).toHaveLength(1); // nuestro HELLO salió
    const pend = pendingOf(t).get(MAC);
    expect(pend).toBeDefined();
    const secret = pend!.myEphSecret;
    expect(secret.some((b) => b !== 0)).toBe(true); // sanidad: no era cero

    // HELLO malformado → handleHello falla → failHello.
    f.emit("onFrame", {
      address: MAC,
      base64: encodeBase64(new Uint8Array([1, 2, 3])),
    } as never);
    await tick();

    expect(secret.every((b) => b === 0)).toBe(true); // borrado
    expect(pendingOf(t).has(MAC)).toBe(false);
  });

  it("desconexión a mitad del handshake borra el secreto efímero", async () => {
    await t.startDiscovery(ev.events);
    f.emit("onConnected", { address: MAC, name: "X", incoming: true } as never);
    await tick();
    const pend = pendingOf(t).get(MAC);
    expect(pend).toBeDefined();
    const secret = pend!.myEphSecret;

    f.emit("onDisconnected", { address: MAC } as never);
    await tick();

    expect(secret.every((b) => b === 0)).toBe(true);
    expect(pendingOf(t).has(MAC)).toBe(false);
  });

  it("dos frames concurrentes generan un solo HELLO (sin efímero huérfano)", async () => {
    await t.startDiscovery(ev.events);
    const eph = toHex(generateEphemeral().publicKey);
    const ph = peerHello(eph);
    // Sin onConnected previo: el primer frame dispara beginHello (RACE-FIX);
    // el segundo llega mientras el primero aún está en sus awaits.
    f.emit("onFrame", { address: MAC, base64: ph.b64 } as never);
    f.emit("onFrame", { address: MAC, base64: ph.b64 } as never);
    await tick(100);

    const hellos = f.sent.filter((s) => {
      try {
        parseHello(decodeBase64(s.base64));
        return true;
      } catch {
        return false;
      }
    });
    // Antes del fix: dos beginHello concurrentes → dos HELLOs y un efímero
    // huérfano sin borrar. Ahora: reserva síncrona → uno solo.
    expect(hellos).toHaveLength(1);
  });

  it("un frame durante hello-starting se espera, no se pierde (sin deadlock)", async () => {
    await t.startDiscovery(ev.events);
    const eph = toHex(generateEphemeral().publicKey);
    const ph = peerHello(eph);
    // Solo UN frame, sin onConnected: el RACE-FIX inicia beginHello y luego
    // reprocesa el frame. El handshake debe completar la fase 1.
    f.emit("onFrame", { address: MAC, base64: ph.b64 } as never);
    await tick(100);
    // Nuestro HELLO + nuestro CONFIRM (fase 1 completa).
    expect(f.sent).toHaveLength(2);
    expect(ev.handshakes).toHaveLength(0); // la ruta aún no existe (R4)
  });
});
