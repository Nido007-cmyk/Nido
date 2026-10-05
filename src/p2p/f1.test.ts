/**
 * f1.test.ts — F-1 remediation (full adversarial audit 2026-09-28):
 * el write ciego `→sent` en attemptOutboundSend resucitaba filas
 * terminales. Invariante restaurada: una vez que una fila del outbox
 * alcanza un estado terminal (user_cancelled | identity_changed), la
 * finalización de una operación de transporte más antigua NUNCA la
 * resucita a 'sent', NUNCA arma un timer de ACK, y NUNCA la hace
 * elegible para 'delivered'.
 *
 * Estos tests fijan en el repo la semántica de los repros /tmp del audit
 * (RACE-1, RACE-2) y la tabla de transición guardada markOutboundSent.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMemorySecureBackend,
  setTestSecureBackend,
} from "../privacy/keyManager";
import { resetP2PMem, useP2PMem, type P2PMem } from "./p2pMemoryMock";
import { NidoMessenger } from "./messenger";
import type { LoopbackTransport } from "./transport";
import {
  randomNonce,
  fromHex,
  HANDSHAKE_NONCE_BYTES,
  generateIdentity,
  generateSigningKeypair,
} from "./crypto";
import { encodePairingPayload } from "./pairing";
import {
  getOutboundMessage,
  getLateAckRecord,
  getSigningKeypair,
  markOutboundSent,
  saveMessage,
} from "./store";

vi.mock("../agent/memory/memoryStore", async () => {
  const { p2pMemoryStoreModuleRouted } = await import("./p2pMemoryMock");
  return p2pMemoryStoreModuleRouted();
});

// ---------------------------------------------------------------------------
// Harness multi-dispositivo (igual que n6.test.ts)
// ---------------------------------------------------------------------------
function freshMem(): P2PMem {
  return { identity: [], contacts: [], messages: [], ackLog: [], lateAck: [], nonceCache: [], identityArchive: [], repairIntents: [], bootRepairLog: [] };
}
const memA = freshMem();
const memB = freshMem();
const backendA = createMemorySecureBackend();
const backendB = createMemorySecureBackend();

type Ctx = <T>(fn: () => Promise<T>) => Promise<T>;
const asA: Ctx = async (fn) => {
  setTestSecureBackend(backendA);
  useP2PMem(memA);
  return fn();
};
const asB: Ctx = async (fn) => {
  setTestSecureBackend(backendB);
  useP2PMem(memB);
  return fn();
};

/** Transporte cuyo sendFrame se aparca (cola FIFO) hasta release(). */
function makeDeferredTransport() {
  const outbox: Uint8Array[] = [];
  const waiters: Array<() => void> = [];
  let parkNext = false;
  const transport = {
    available: true,
    sendFrame: async (_pk: string, frame: Uint8Array) => {
      if (parkNext) {
        parkNext = false;
        await new Promise<void>((res) => waiters.push(res));
      }
      outbox.push(frame);
    },
    startDiscovery: async () => {},
    stopDiscovery: async () => {},
    connect: async () => ({ pkHex: "", alias: "", transport: "bluetooth" as const }),
  };
  return {
    outbox,
    transport,
    park() {
      parkNext = true;
    },
    release() {
      const w = waiters.shift();
      if (!w) throw new Error("nada aparcado");
      w();
    },
    parked: () => waiters.length,
  };
}

interface Peer {
  m: NidoMessenger;
  pk: string;
  tx: ReturnType<typeof makeDeferredTransport>;
  as: Ctx;
}

async function makePeer(as: Ctx, name: string): Promise<Peer> {
  const tx = makeDeferredTransport();
  const m = new NidoMessenger(tx.transport as unknown as LoopbackTransport);
  const { pkHex } = await as(() => m.ensureIdentity(name));
  return { m, pk: pkHex, tx, as };
}

async function setupAB(): Promise<{ alice: Peer; bob: Peer }> {
  const alice = await makePeer(asA, "Alice");
  const bob = await makePeer(asB, "Bob");
  const aSign = await asA(() => getSigningKeypair());
  const bSign = await asB(() => getSigningKeypair());
  await alice.as(() => alice.m.pairWith(encodePairingPayload("Beto", fromHex(bob.pk), bSign.publicKey)));
  await bob.as(() => bob.m.pairWith(encodePairingPayload("Alice", fromHex(alice.pk), aSign.publicKey)));
  return { alice, bob };
}

function drain(p: Peer): Uint8Array[] {
  return p.tx.outbox.splice(0);
}

/** Handshake v3 por el path real (igual que n6.test.ts). */
async function handshake(a: Peer, b: Peer): Promise<void> {
  const aEph = a.m.newHandshakeEphemeral();
  const bEph = b.m.newHandshakeEphemeral();
  const aNonce = randomNonce(HANDSHAKE_NONCE_BYTES);
  const bNonce = randomNonce(HANDSHAKE_NONCE_BYTES);
  await a.as(() => a.m.completeHandshake(b.pk, aEph.secretKey, bEph.publicKey, aNonce, bNonce));
  await b.as(() => b.m.completeHandshake(a.pk, bEph.secretKey, aEph.publicKey, bNonce, aNonce));
  const [confirmA] = drain(a);
  const [confirmB] = drain(b);
  if (!confirmA || !confirmB) throw new Error("handshake: falta session_confirm");
  await b.as(() => b.m.handleFrame(a.pk, confirmA));
  await a.as(() => a.m.handleFrame(b.pk, confirmB));
}

async function waitParked(tx: ReturnType<typeof makeDeferredTransport>, count = 1): Promise<void> {
  for (let i = 0; i < 400 && tx.parked() < count; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  if (tx.parked() < count) throw new Error("sendFrame nunca se aparcó");
}

beforeEach(() => {
  resetP2PMem(memA);
  resetP2PMem(memB);
  useP2PMem(memA);
  setTestSecureBackend(backendA);
});

// ---------------------------------------------------------------------------
// RACE-1: cancel del usuario durante sendFrame in-flight
// ---------------------------------------------------------------------------
describe("F-1 RACE-1 — cancel(user_cancelled) durante sendFrame in-flight", () => {
  it("la fila permanece failed/user_cancelled; no se arma timer; el ACK genuino posterior no entrega", async () => {
    const { alice, bob } = await setupAB();
    await handshake(alice, bob);
    alice.tx.park();

    // 1. El envío se aparca dentro de transport.sendFrame (el await).
    const sendP = alice.as(() => alice.m.sendChat("Beto", "hola race1"));
    await waitParked(alice.tx);
    const id = memA.messages.find((m) => m.dir === "out")!.id;
    expect((await alice.as(() => getOutboundMessage(id)))?.status).toBe("queued");

    // 2. El usuario cancela mientras los bytes están en vuelo → terminal.
    expect(await alice.as(() => alice.m.cancelOutboundMessage(id))).toBe(true);
    expect((await alice.as(() => getOutboundMessage(id)))?.failureReason).toBe("user_cancelled");

    // 3. El sendFrame aparcado se resuelve → la transición guardada pierde.
    alice.tx.release();
    await sendP;

    const row = await alice.as(() => getOutboundMessage(id));
    expect(row?.status).toBe("failed");
    expect(row?.failureReason).toBe("user_cancelled");

    // Los bytes SÍ salieron al OS (no se puede deshacer): capturarlos para
    // el paso 5. El punto de la remediación es el ESTADO, no los bytes.
    const [stray] = drain(alice);
    expect(stray).toBeDefined();

    // 4. Sin timer de ACK armado: un sweep posterior no produce frames ni
    //    intentos (pre-fix: el write ciego re-armaba el timer).
    const attemptsBefore = row?.ackAttempts ?? 0;
    await alice.as(() => alice.m.runAckSweep(Date.now() + 61_000));
    expect(drain(alice)).toHaveLength(0);
    expect((await alice.as(() => getOutboundMessage(id)))?.ackAttempts).toBe(attemptsBefore);

    // 5. El peer persiste los bytes extraviados y ACKea de verdad. La
    //    intención del usuario gana igual: el ACK tardío se audita, el
    //    estado visible NO cambia (D7).
    await bob.as(() => bob.m.handleFrame(alice.pk, stray));
    const [ack] = drain(bob);
    expect(ack).toBeDefined();
    await alice.as(() => alice.m.handleFrame(bob.pk, ack));
    const end = await alice.as(() => getOutboundMessage(id));
    expect(end?.status).toBe("failed");
    expect(end?.failureReason).toBe("user_cancelled");
    expect(await alice.as(() => getLateAckRecord(id))).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RACE-2: re-pair durante sendFrame in-flight
// ---------------------------------------------------------------------------
describe("F-1 RACE-2 — re-pair(identity_changed) durante sendFrame in-flight", () => {
  it("la fila permanece failed/identity_changed; un ACK de la sesión superseded no la revive", async () => {
    const { alice, bob } = await setupAB();
    await handshake(alice, bob);
    alice.tx.park();

    const sendP = alice.as(() => alice.m.sendChat("Beto", "hola race2"));
    await waitParked(alice.tx);
    const id = memA.messages.find((m) => m.dir === "out")!.id;

    // Beto consigue un dispositivo nuevo (misma etiqueta, identidad nueva).
    // UNIT B: el re-pair exige elección explícita (replace = misma persona,
    // dispositivo nuevo).
    const beto2 = generateIdentity();
    const beto2Sign = generateSigningKeypair();
    await alice.as(() =>
      alice.m.pairWith(encodePairingPayload("Beto", beto2.publicKey, beto2Sign.publicKey), {
        disambiguation: "replace",
      }),
    );
    const mid = await alice.as(() => getOutboundMessage(id));
    expect(mid?.status).toBe("failed");
    expect(mid?.failureReason).toBe("identity_changed");

    // El sendFrame aparcado se resuelve sobre la sesión YA superseded.
    alice.tx.release();
    await sendP;

    const row = await alice.as(() => getOutboundMessage(id));
    expect(row?.status).toBe("failed");
    expect(row?.failureReason).toBe("identity_changed");

    // El frame extraviado (empaquetado bajo la sesión vieja) llega al Bob
    // viejo: lo persiste y ACKea con la sesión superseded. En Alice la
    // sesión vieja ya no existe → el ACK muere en unpack (validación 1) y
    // jamás puede revivir la fila.
    const [stray] = drain(alice);
    expect(stray).toBeDefined();
    await bob.as(() => bob.m.handleFrame(alice.pk, stray));
    const [oldAck] = drain(bob);
    expect(oldAck).toBeDefined();
    await alice.as(() => alice.m.handleFrame(bob.pk, oldAck));
    const end = await alice.as(() => getOutboundMessage(id));
    expect(end?.status).toBe("failed");
    expect(end?.failureReason).toBe("identity_changed");
    expect(await alice.as(() => getLateAckRecord(id))).toBeNull(); // identity_changed ni se audita: muere antes
  });
});

// ---------------------------------------------------------------------------
// Dos intentos concurrentes no pueden mover una fila terminal
// ---------------------------------------------------------------------------
describe("F-1 — dos finalizaciones concurrentes no mueven una fila terminal", () => {
  it("cancel entre dos sendFrame aparcados → ambos pierden; sin timer", async () => {
    const { alice, bob } = await setupAB();
    await handshake(alice, bob);

    // Dos intentos concurrentes sobre la misma fila: sendChat + flush.
    alice.tx.park();
    const sendP = alice.as(() => alice.m.sendChat("Beto", "doble"));
    await waitParked(alice.tx);
    const rowId = memA.messages.find((m) => m.dir === "out")!.id;
    alice.tx.park(); // el segundo intento también se aparca
    const rowPeerPk = (await alice.as(() => getOutboundMessage(rowId)))!.peerPk;
    const flushP = alice.as(() =>
      (alice.m as unknown as { flushOutbox: (p: string) => Promise<void> }).flushOutbox(rowPeerPk),
    );
    await waitParked(alice.tx, 2);

    // La fila se vuelve terminal con AMBOS envíos en vuelo.
    expect(await alice.as(() => alice.m.cancelOutboundMessage(rowId))).toBe(true);

    alice.tx.release(); // completa el primer intento
    alice.tx.release(); // completa el segundo intento
    await sendP;
    await flushP;

    const row = await alice.as(() => getOutboundMessage(rowId));
    expect(row?.status).toBe("failed");
    expect(row?.failureReason).toBe("user_cancelled");
    // Ningún intento armó timer: el sweep no genera frames ni intentos.
    drain(alice);
    await alice.as(() => alice.m.runAckSweep(Date.now() + 61_000));
    expect(drain(alice)).toHaveLength(0);
    expect((await alice.as(() => getOutboundMessage(rowId)))?.ackAttempts).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// markOutboundSent: tabla de transición guardada (store-level)
// ---------------------------------------------------------------------------
describe("F-1 — markOutboundSent: la BD decide la transición", () => {
  it("queued→true, sent→true (limpia failure_reason), failed/delivered→false", async () => {
    await asA(async () => {
      const peer = "ab".repeat(32);
      await saveMessage({ id: "q1", dir: "out", peerPk: peer, type: "chat", text: "a" }); // queued
      expect(await markOutboundSent("q1")).toBe(true);
      expect((await getOutboundMessage("q1"))?.status).toBe("sent");
      expect((await getOutboundMessage("q1"))?.failureReason).toBeNull();

      // sent→sent permitido (reintento legítimo del path onAckTimeout),
      // y limpia cualquier failure_reason residual.
      await saveMessage({ id: "s1", dir: "out", peerPk: peer, type: "chat", text: "b", status: "sent", failureReason: "timeout" });
      expect(await markOutboundSent("s1")).toBe(true);
      expect((await getOutboundMessage("s1"))?.status).toBe("sent");
      expect((await getOutboundMessage("s1"))?.failureReason).toBeNull();

      // Estados terminales: la transición pierde.
      await saveMessage({ id: "f1", dir: "out", peerPk: peer, type: "chat", text: "c", status: "failed", failureReason: "user_cancelled" });
      expect(await markOutboundSent("f1")).toBe(false);
      expect((await getOutboundMessage("f1"))?.status).toBe("failed");
      expect((await getOutboundMessage("f1"))?.failureReason).toBe("user_cancelled");

      await saveMessage({ id: "f2", dir: "out", peerPk: peer, type: "chat", text: "d", status: "failed", failureReason: "identity_changed" });
      expect(await markOutboundSent("f2")).toBe(false);
      expect((await getOutboundMessage("f2"))?.failureReason).toBe("identity_changed");

      await saveMessage({ id: "f3", dir: "out", peerPk: peer, type: "chat", text: "e", status: "failed", failureReason: "timeout" });
      expect(await markOutboundSent("f3")).toBe(false);
      expect((await getOutboundMessage("f3"))?.status).toBe("failed");

      await saveMessage({ id: "d1", dir: "out", peerPk: peer, type: "chat", text: "f", status: "delivered" });
      expect(await markOutboundSent("d1")).toBe(false);
      expect((await getOutboundMessage("d1"))?.status).toBe("delivered");

      // Fila inexistente: pierde sin efecto.
      expect(await markOutboundSent("nope")).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Paths normales intactos
// ---------------------------------------------------------------------------
describe("F-1 — paths ordinarios intactos", () => {
  it("envío exitoso ordinario → sent (queued=false)", async () => {
    const { alice, bob } = await setupAB();
    await handshake(alice, bob);
    const { id, queued } = await alice.as(() => alice.m.sendChat("Beto", "normal"));
    expect(queued).toBe(false);
    const row = await alice.as(() => getOutboundMessage(id));
    expect(row?.status).toBe("sent");
    expect(row?.failureReason).toBeNull();
  });

  it("timeout/retry intacto: 1 inicial + 3 reintentos → failed(timeout); retry manual → delivered", async () => {
    const { alice, bob } = await setupAB();
    await handshake(alice, bob);
    const { id } = await alice.as(() => alice.m.sendChat("Beto", "hola timeout"));
    expect((await alice.as(() => getOutboundMessage(id)))?.status).toBe("sent");
    for (let i = 0; i < 3; i++) {
      const [f] = drain(alice);
      await bob.as(() => bob.m.handleFrame(alice.pk, f));
      drain(bob); // ACK perdido
      await alice.as(() => alice.m.runAckSweep(Date.now() + 31_000));
    }
    drain(alice);
    await alice.as(() => alice.m.runAckSweep(Date.now() + 31_000)); // 4º → agota
    const failed = await alice.as(() => getOutboundMessage(id));
    expect(failed?.status).toBe("failed");
    expect(failed?.failureReason).toBe("timeout");

    // Reintento manual dentro del horizonte: MISMO id → delivered.
    const retry = await alice.as(() => alice.m.retryOutboundMessage(id));
    expect(retry).toEqual({ id, freshId: false });
    const [f5] = drain(alice);
    await bob.as(() => bob.m.handleFrame(alice.pk, f5));
    const [ackLate] = drain(bob);
    await alice.as(() => alice.m.handleFrame(bob.pk, ackLate));
    expect((await alice.as(() => getOutboundMessage(id)))?.status).toBe("delivered");
  });
});
