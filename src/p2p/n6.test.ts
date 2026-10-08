/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * n6.test.ts — N6 delivery acknowledgment: Traces A/B/C + batería adversarial.
 *
 * Cada NidoMessenger representa un DISPOSITIVO con su propia base SQLCipher:
 * memA/memB/memC se enrutan con useP2PMem() y los backends del Keystore son
 * independientes. Sin esta separación, la fila del outbox del emisor
 * contaminaría el dedup gate del receptor (en producción son bases distintas).
 *
 * Trazas (§8 del design packet):
 * - A: persist → ACK perdido → retry (mismo message_id, envelope fresco) →
 *      sin segunda persistencia/efecto → re-ACK fresco → delivered.
 * - B: el dedup honra el ack log aunque la fila del inbox falte; el volumen
 *      no evicta dentro del horizonte (volumen masivo a nivel store en
 *      store.test.ts: 10_005 entradas sobreviven a la poda).
 * - C: reconexión S1→S2 — el re-ACK usa el tag ACTUAL; el tag histórico
 *      queda solo como auditoría; un ACK con tag stale se rechaza.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  createMemorySecureBackend,
  setTestSecureBackend,
} from "../privacy/keyManager";
import { resetP2PMem, useP2PMem, type P2PMem } from "./p2pMemoryMock";
import { NidoMessenger } from "./messenger";
import { isValidAckPayload } from "./messenger";
import type { LoopbackTransport } from "./transport";
import {
  P2PSession,
  makeEnvelope,
  deriveAckSessionTag,
  type DeliveryAckPayload,
} from "./protocol";
import {
  generateEphemeral,
  generateIdentity,
  generateSigningKeypair,
  randomNonce,
  toHex,
  fromHex,
  HANDSHAKE_NONCE_BYTES,
} from "./crypto";
import { encodePairingPayload } from "./pairing";
import {
  getOutboundMessage,
  getDeliveryAckLogEntry,
  getPendingAgentTasks,
  getLateAckRecord,
  getSigningKeypair,
  messageExists,
} from "./store";

vi.mock("../agent/memory/memoryStore", async () => {
  const { p2pMemoryStoreModuleRouted } = await import("./p2pMemoryMock");
  return p2pMemoryStoreModuleRouted();
});

// ---------------------------------------------------------------------------
// Harness multi-dispositivo
// ---------------------------------------------------------------------------
function freshMem(): P2PMem {
  return { identity: [], contacts: [], messages: [], ackLog: [], lateAck: [], nonceCache: [], identityArchive: [], repairIntents: [], bootRepairLog: [] };
}
const memA = freshMem();
const memB = freshMem();
const memC = freshMem();
const backendA = createMemorySecureBackend();
const backendB = createMemorySecureBackend();
const backendC = createMemorySecureBackend();

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
const asC: Ctx = async (fn) => {
  setTestSecureBackend(backendC);
  useP2PMem(memC);
  return fn();
};

function makeScriptTransport() {
  const outbox: Uint8Array[] = [];
  const transport = {
    available: true,
    sendFrame: async (_pk: string, frame: Uint8Array) => {
      outbox.push(frame);
    },
    startDiscovery: async () => {},
    stopDiscovery: async () => {},
    connect: async () => ({ pkHex: "", alias: "", transport: "bluetooth" as const }),
  };
  return { outbox, transport };
}

interface Peer {
  m: NidoMessenger;
  pk: string;
  tx: { outbox: Uint8Array[] };
  as: Ctx;
}

async function makePeer(as: Ctx, name: string): Promise<Peer> {
  const { outbox, transport } = makeScriptTransport();
  const m = new NidoMessenger(transport as unknown as LoopbackTransport);
  const { pkHex } = await as(() => m.ensureIdentity(name));
  return { m, pk: pkHex, tx: { outbox }, as };
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

let eidCounter = 0;
const eid = () => `env-${++eidCounter}-${Date.now()}`;

function drain(p: Peer): Uint8Array[] {
  return p.tx.outbox.splice(0);
}

interface SessionViews {
  tag: string;
  /** Empaqueta frames que `a` acepta (vista lado-b). */
  toA: P2PSession;
  /** Empaqueta frames que `b` acepta (vista lado-a). */
  toB: P2PSession;
}

/**
 * Handshake v3 completo por el path REAL: completeHandshake emite el
 * session_confirm (H-8) y aquí se entrega cruzado — nada artesanal.
 * Al volver, ambas sesiones están live. Los outboxes quedan limpios
 * salvo lo que el flushOutbox del confirm emita (test de crash: el
 * reenvío del mensaje recuperado — debe sobrevivir, no se drena).
 */
async function handshake(a: Peer, b: Peer): Promise<SessionViews> {
  const aEph = a.m.newHandshakeEphemeral();
  const bEph = b.m.newHandshakeEphemeral();
  const aNonce = randomNonce(HANDSHAKE_NONCE_BYTES);
  const bNonce = randomNonce(HANDSHAKE_NONCE_BYTES);
  // Copias para las vistas de test: completeHandshake borra los secretos
  // efímeros in-place (higiene de forward-secrecy). Cada peer real
  // conserva su propia copia; aquí la modelamos explícitamente.
  const aSecView = aEph.secretKey.slice();
  const bSecView = bEph.secretKey.slice();
  await a.as(() => a.m.completeHandshake(b.pk, aEph.secretKey, bEph.publicKey, aNonce, bNonce));
  await b.as(() => b.m.completeHandshake(a.pk, bEph.secretKey, aEph.publicKey, bNonce, aNonce));
  const tag = deriveAckSessionTag(a.pk, b.pk, aNonce, bNonce);
  const toA = P2PSession.fromHandshakeV2(bSecView, aEph.publicKey, a.pk, bNonce, aNonce);
  const toB = P2PSession.fromHandshakeV2(aSecView, bEph.publicKey, b.pk, aNonce, bNonce);
  // Vistas para empaquetar/leer frames artesanales en cada dirección.
  const [confirmA] = drain(a); // session_confirm real de Alice (H-8)
  const [confirmB] = drain(b); // session_confirm real de Bob
  if (!confirmA || !confirmB) throw new Error("handshake: falta session_confirm");
  await b.as(() => b.m.handleFrame(a.pk, confirmA)); // Bob promueve → live
  await a.as(() => a.m.handleFrame(b.pk, confirmB)); // Alice promueve → live → flushOutbox
  return { tag, toA, toB };
}

function ackPayload(forId: string, tag: string): Record<string, unknown> {
  return {
    for_id: forId,
    for_type: "chat",
    persisted_at: Date.now(),
    session_tag: tag,
    attest: "persisted",
  } as unknown as Record<string, unknown>;
}

beforeEach(() => {
  resetP2PMem(memA);
  resetP2PMem(memB);
  resetP2PMem(memC);
  useP2PMem(memA);
  setTestSecureBackend(backendA);
});

// ---------------------------------------------------------------------------
// Traza A
// ---------------------------------------------------------------------------
describe("N6 Trace A — persist → ACK perdido → retry idempotente → delivered", () => {
  it("retry con mismo message_id y envelope fresco: sin duplicados, con re-ACK, delivered", async () => {
    const { alice, bob } = await setupAB();
    const s = await handshake(alice, bob);

    const { id, queued } = await alice.as(() => alice.m.sendChat("Beto", "hola trace A"));
    expect(queued).toBe(false);
    const [f1] = drain(alice);
    expect(f1).toBeDefined();
    expect((await alice.as(() => getOutboundMessage(id)))?.status).toBe("sent");

    // Bob recibe y persiste (commit), emite ACK… que se PIERDE en la red.
    await bob.as(() => bob.m.handleFrame(alice.pk, f1));
    expect(memB.messages.filter((m) => m.dir === "in")).toHaveLength(1);
    expect(memB.ackLog).toHaveLength(1);
    const [ackLost] = drain(bob);
    expect(ackLost).toBeDefined();
    // …no se entrega a Alice.

    // Expira la espera de ACK → reintento: MISMO message_id, envelope fresco.
    await alice.as(() => alice.m.runAckSweep(Date.now() + 31_000));
    const [f2] = drain(alice);
    expect(f2).toBeDefined();
    expect(Buffer.from(f2).equals(Buffer.from(f1))).toBe(false); // envelope id fresco
    const env2 = s.toA.unpack(f2); // vista de Bob: lee frames de Alice
    expect(env2?.payload).toMatchObject({ text: "hola trace A", message_id: id });

    // Bob: dedup — ni segunda fila ni segundo efecto; pero re-ACKea fresco.
    const before = memB.messages.length;
    await bob.as(() => bob.m.handleFrame(alice.pk, f2));
    expect(memB.messages.filter((m) => m.dir === "in")).toHaveLength(1);
    expect(memB.messages.length).toBe(before);
    const [ack2] = drain(bob);
    expect(ack2).toBeDefined();

    // El re-ACK llega: delivered. Es la única vía hacia 'delivered'.
    await alice.as(() => alice.m.handleFrame(bob.pk, ack2));
    expect((await alice.as(() => getOutboundMessage(id)))?.status).toBe("delivered");
  });
});

// ---------------------------------------------------------------------------
// Traza C
// ---------------------------------------------------------------------------
describe("N6 Trace C — reconexión S1→S2: el re-ACK usa el tag actual", () => {
  it("re-ACK con tag_S2; tag_S1 solo en auditoría; ACK con tag stale se rechaza", async () => {
    const { alice, bob } = await setupAB();
    const s1 = await handshake(alice, bob);

    const { id } = await alice.as(() => alice.m.sendChat("Beto", "hola trace C"));
    const [f1] = drain(alice);
    await bob.as(() => bob.m.handleFrame(alice.pk, f1));
    const [ackS1] = drain(bob); // se pierde; da igual para el trace
    expect(ackS1).toBeDefined();

    // Reconexión: handshake nuevo → tag distinto.
    const s2 = await handshake(alice, bob);
    expect(s2.tag).not.toBe(s1.tag);

    // Reintento tras la reconexión → Bob dedup → re-ACK.
    await alice.as(() => alice.m.runAckSweep(Date.now() + 31_000));
    const [f2] = drain(alice);
    await bob.as(() => bob.m.handleFrame(alice.pk, f2));
    const [ack2] = drain(bob);
    const ackEnv = s2.toB.unpack(ack2); // vista de Alice: lee frames de Bob
    expect(ackEnv?.type).toBe("delivery_ack");
    const payload = ackEnv?.payload as unknown as DeliveryAckPayload;
    expect(payload.session_tag).toBe(s2.tag); // tag ACTUAL, no el histórico
    expect(payload.for_id).toBe(id);

    // El ack log conserva el tag histórico S1 solo como auditoría.
    const logEntry = await bob.as(() => getDeliveryAckLogEntry(id));
    expect(logEntry?.sessionTag).toBe(s1.tag);

    // ACK con tag STALE (S1) empaquetado bajo la clave S2 → rechazado (validación 4).
    const stale = s2.toA.pack(makeEnvelope("delivery_ack", eid(), fromHex(bob.pk), alice.pk, ackPayload(id, s1.tag)));
    await alice.as(() => alice.m.handleFrame(bob.pk, stale));
    expect((await alice.as(() => getOutboundMessage(id)))?.status).toBe("sent");

    // Replay del ACK original S1 (clave vieja) → muere en Tier-1 (unpack null).
    const replayed = await alice.as(() => alice.m.handleFrame(bob.pk, ackS1));
    expect(replayed).toBeNull();
    expect((await alice.as(() => getOutboundMessage(id)))?.status).toBe("sent");

    // El re-ACK vigente sí entrega.
    await alice.as(() => alice.m.handleFrame(bob.pk, ack2));
    expect((await alice.as(() => getOutboundMessage(id)))?.status).toBe("delivered");
  });
});

// ---------------------------------------------------------------------------
// Traza B
// ---------------------------------------------------------------------------
describe("N6 Trace B — el dedup sobrevive sin la fila del inbox; volumen no evicta", () => {
  it("ack log sin fila de inbox → dedup igual, re-ACK, sin reinserción", async () => {
    const { alice, bob } = await setupAB();
    await handshake(alice, bob);

    const { id } = await alice.as(() => alice.m.sendChat("Beto", "hola trace B"));
    const [f1] = drain(alice);
    await bob.as(() => bob.m.handleFrame(alice.pk, f1));
    drain(bob);

    // La fila del inbox se pierde pero el ack log sobrevive.
    memB.messages = memB.messages.filter((m) => !(m.dir === "in" && m.id === id));
    expect(await bob.as(() => messageExists(id))).toBe(false);
    expect(await bob.as(() => getDeliveryAckLogEntry(id))).not.toBeNull();

    // Reintento → dedup por ack log: sin reinserción, sin efectos, con re-ACK.
    await alice.as(() => alice.m.runAckSweep(Date.now() + 31_000));
    const [f2] = drain(alice);
    await bob.as(() => bob.m.handleFrame(alice.pk, f2));
    expect(memB.messages.filter((m) => m.dir === "in")).toHaveLength(0);
    const [ack2] = drain(bob);
    expect(ack2).toBeDefined();

    await alice.as(() => alice.m.handleFrame(bob.pk, ack2));
    expect((await alice.as(() => getOutboundMessage(id)))?.status).toBe("delivered");
  });
});

// ---------------------------------------------------------------------------
// Batería adversarial
// ---------------------------------------------------------------------------
describe("N6 adversarial — los ACK inválidos mueren fail-closed", () => {
  it("ACK forjado (bit flip) → unpack null, sin cambio de estado", async () => {
    const { alice, bob } = await setupAB();
    await handshake(alice, bob);
    const { id } = await alice.as(() => alice.m.sendChat("Beto", "hola"));
    const [f1] = drain(alice);
    await bob.as(() => bob.m.handleFrame(alice.pk, f1));
    const [ack] = drain(bob);
    ack[40] ^= 0x01;
    const res = await alice.as(() => alice.m.handleFrame(bob.pk, ack));
    expect(res).toBeNull();
    expect((await alice.as(() => getOutboundMessage(id)))?.status).toBe("sent");
  });

  it("ACK con forma inválida (sin attest) → se ignora", async () => {
    const { alice, bob } = await setupAB();
    const s = await handshake(alice, bob);
    const { id } = await alice.as(() => alice.m.sendChat("Beto", "hola"));
    const bad = s.toA.pack(
      makeEnvelope("delivery_ack", eid(), fromHex(bob.pk), alice.pk, {
        for_id: id,
        for_type: "chat",
        persisted_at: Date.now(),
        session_tag: s.tag,
      }),
    );
    await alice.as(() => alice.m.handleFrame(bob.pk, bad));
    expect((await alice.as(() => getOutboundMessage(id)))?.status).toBe("sent");
  });

  it("ACK para un message_id desconocido → se ignora", async () => {
    const { alice, bob } = await setupAB();
    const s = await handshake(alice, bob);
    const { id } = await alice.as(() => alice.m.sendChat("Beto", "hola"));
    const bad = s.toA.pack(makeEnvelope("delivery_ack", eid(), fromHex(bob.pk), alice.pk, ackPayload("no-existe", s.tag)));
    await alice.as(() => alice.m.handleFrame(bob.pk, bad));
    expect((await alice.as(() => getOutboundMessage(id)))?.status).toBe("sent");
  });

  it("ACK del peer equivocado → se ignora (el mensaje es de otro peer)", async () => {
    const { alice, bob } = await setupAB();
    const carol = await makePeer(asC, "Carol");
    const cSign = await asC(() => getSigningKeypair());
    const aSign = await asA(() => getSigningKeypair());
    await alice.as(() =>
      alice.m.pairWith(encodePairingPayload("Carol", fromHex(carol.pk), cSign.publicKey)),
    );
    await carol.as(() =>
      carol.m.pairWith(encodePairingPayload("Alice", fromHex(alice.pk), aSign.publicKey)),
    );
    const sAB = await handshake(alice, bob);
    const sAC = await handshake(alice, carol);
    void sAB;

    const { id } = await alice.as(() => alice.m.sendChat("Beto", "para bob"));
    // Carol forja un ACK "válido" bajo SU sesión para el mensaje de Bob.
    const forged = sAC.toA.pack(
      makeEnvelope("delivery_ack", eid(), fromHex(carol.pk), alice.pk, ackPayload(id, sAC.tag)),
    );
    await alice.as(() => alice.m.handleFrame(carol.pk, forged));
    expect((await alice.as(() => getOutboundMessage(id)))?.status).toBe("sent");
  });

  it("ACK con for_type distinto al del mensaje → se ignora (confusión de tipos)", async () => {
    const { alice, bob } = await setupAB();
    const s = await handshake(alice, bob);
    const { id } = await alice.as(() => alice.m.sendChat("Beto", "hola"));
    const [f1] = drain(alice);
    await bob.as(() => bob.m.handleFrame(alice.pk, f1));
    drain(bob);
    // ACK "válido" en forma y tag pero declarando for_type=agent_task para
    // un mensaje chat → validación 5b lo rechaza.
    const confused = s.toA.pack(
      makeEnvelope("delivery_ack", eid(), fromHex(bob.pk), alice.pk, {
        for_id: id,
        for_type: "agent_task",
        persisted_at: Date.now(),
        session_tag: s.tag,
        attest: "persisted",
      }),
    );
    await alice.as(() => alice.m.handleFrame(bob.pk, confused));
    expect((await alice.as(() => getOutboundMessage(id)))?.status).toBe("sent");
  });

  it("ACK duplicado → idempotente, sigue delivered sin error", async () => {
    const { alice, bob } = await setupAB();
    await handshake(alice, bob);
    const { id } = await alice.as(() => alice.m.sendChat("Beto", "hola"));
    const [f1] = drain(alice);
    await bob.as(() => bob.m.handleFrame(alice.pk, f1));
    const [ack] = drain(bob);
    await alice.as(() => alice.m.handleFrame(bob.pk, ack));
    await alice.as(() => alice.m.handleFrame(bob.pk, ack)); // duplicado
    expect((await alice.as(() => getOutboundMessage(id)))?.status).toBe("delivered");
  });

  it("cancelado + ACK tardío → sigue failed(user_cancelled); auditoría interna", async () => {
    const { alice, bob } = await setupAB();
    await handshake(alice, bob);
    const { id } = await alice.as(() => alice.m.sendChat("Beto", "hola"));
    const [f1] = drain(alice);
    await bob.as(() => bob.m.handleFrame(alice.pk, f1));
    const [ack] = drain(bob);

    expect(await alice.as(() => alice.m.cancelOutboundMessage(id))).toBe(true);
    expect((await alice.as(() => getOutboundMessage(id)))?.failureReason).toBe("user_cancelled");

    // El ACK tardío genuino llega: la intención del usuario gana.
    await alice.as(() => alice.m.handleFrame(bob.pk, ack));
    const row = await alice.as(() => getOutboundMessage(id));
    expect(row?.status).toBe("failed");
    expect(row?.failureReason).toBe("user_cancelled");
    expect(await alice.as(() => getLateAckRecord(id))).not.toBeNull();
  });

  it("timeout: 1 inicial + 3 reintentos; el 4.º timeout → failed(timeout); ACK tardío aún entrega", async () => {
    const { alice, bob } = await setupAB();
    await handshake(alice, bob);
    const { id } = await alice.as(() => alice.m.sendChat("Beto", "hola"));
    // Los 3 reintentos salen; Bob persiste una vez y re-ACKea (todo se pierde).
    for (let i = 0; i < 3; i++) {
      const [f] = drain(alice);
      await bob.as(() => bob.m.handleFrame(alice.pk, f));
      drain(bob); // ACK perdido
      await alice.as(() => alice.m.runAckSweep(Date.now() + 31_000));
    }
    drain(alice);
    await alice.as(() => alice.m.runAckSweep(Date.now() + 31_000)); // 4º → agota
    const row = await alice.as(() => getOutboundMessage(id));
    expect(row?.status).toBe("failed");
    expect(row?.failureReason).toBe("timeout");
    expect(row?.ackAttempts).toBe(4);
    expect(memB.messages.filter((m) => m.dir === "in")).toHaveLength(1); // Bob persistió una vez

    // Reintento manual dentro del horizonte: MISMO id, vuelve a intentar.
    const retry = await alice.as(() => alice.m.retryOutboundMessage(id));
    expect(retry).toEqual({ id, freshId: false });
    const [f5] = drain(alice);
    await bob.as(() => bob.m.handleFrame(alice.pk, f5));
    const [ackLate] = drain(bob);
    await alice.as(() => alice.m.handleFrame(bob.pk, ackLate));
    expect((await alice.as(() => getOutboundMessage(id)))?.status).toBe("delivered");
  });

  it("relay-then-drop: sin ACK jamás → failed(timeout), nunca delivered", async () => {
    const { alice, bob } = await setupAB();
    await handshake(alice, bob);
    const { id } = await alice.as(() => alice.m.sendChat("Beto", "al vacío"));
    // Los frames salen al "aire" pero ningún peer los procesa jamás.
    for (let i = 0; i < 4; i++) {
      drain(alice);
      await alice.as(() => alice.m.runAckSweep(Date.now() + 31_000));
    }
    drain(alice);
    const row = await alice.as(() => getOutboundMessage(id));
    expect(row?.status).toBe("failed");
    expect(row?.failureReason).toBe("timeout");
    expect(row?.status).not.toBe("delivered");
    void bob;
  });

  it("crash del emisor tras 'sent' → restart recupera a queued (nunca delivered) y reenvía", async () => {
    const { alice, bob } = await setupAB();
    await handshake(alice, bob);
    const { id } = await alice.as(() => alice.m.sendChat("Beto", "hola crash"));
    const [f1] = drain(alice);
    await bob.as(() => bob.m.handleFrame(alice.pk, f1));
    drain(bob); // ACK perdido
    expect((await alice.as(() => getOutboundMessage(id)))?.status).toBe("sent");

    // Crash: la instancia muere; una nueva comparte la MISMA base (mismo dispositivo).
    await alice.as(() => alice.m.destroy());
    const { outbox: outbox2, transport: t2 } = makeScriptTransport();
    const alice2 = new NidoMessenger(t2 as unknown as LoopbackTransport);
    const A2: Peer = { m: alice2, pk: alice.pk, tx: { outbox: outbox2 }, as: asA };
    await asA(() => alice2.startLink()); // §4.4: sent→queued, una vez
    expect((await asA(() => getOutboundMessage(id)))?.status).toBe("queued");

    // Reconexión: el session_confirm dispara flushOutbox → reenvío mismo message_id.
    const s2 = await handshake(A2, bob);
    const [f2] = drain(A2);
    expect(f2).toBeDefined();
    const env2 = s2.toA.unpack(f2); // vista de Bob: lee el reenvío de Alice
    expect(env2?.payload).toMatchObject({ message_id: id });
    await bob.as(() => bob.m.handleFrame(alice.pk, f2));
    expect(memB.messages.filter((m) => m.dir === "in")).toHaveLength(1); // sin duplicado
    const [ack2] = drain(bob);
    await asA(() => alice2.handleFrame(bob.pk, ack2));
    expect((await asA(() => getOutboundMessage(id)))?.status).toBe("delivered");
    await asA(() => alice2.destroy());
  });

  it("post-re-pair: la identidad vieja muere — su ACK ya no abre ni valida", async () => {
    const { alice, bob } = await setupAB();
    await handshake(alice, bob);
    const { id } = await alice.as(() => alice.m.sendChat("Beto", "hola"));
    const [f1] = drain(alice);
    await bob.as(() => bob.m.handleFrame(alice.pk, f1));
    const [ack] = drain(bob);

    // Re-pair: mismo nombre "Beto", OTRA clave → failed(identity_changed).
    // UNIT B: el re-pair exige elección explícita (replace).
    const bob2keys = generateIdentity();
    const bob2sign = generateSigningKeypair();
    await alice.as(() =>
      alice.m.pairWith(encodePairingPayload("Beto", bob2keys.publicKey, bob2sign.publicKey), {
        disambiguation: "replace",
      }),
    );
    const row = await alice.as(() => getOutboundMessage(id));
    expect(row?.status).toBe("failed");
    expect(row?.failureReason).toBe("identity_changed");

    // El ACK de la identidad vieja ya ni siquiera abre (sesión eliminada).
    const res = await alice.as(() => alice.m.handleFrame(bob.pk, ack));
    expect(res).toBeNull();
    expect((await alice.as(() => getOutboundMessage(id)))?.status).toBe("failed");
  });

  it("agent_task duplicado → un solo efecto: una fila, una aprobación pendiente", async () => {
    const { alice, bob } = await setupAB();
    const s = await handshake(alice, bob);

    const payload = { kind: "reminder", text: "recuérdame X", args: { at: "9:00" }, message_id: "task-1" };
    const mkFrame = () =>
      s.toB.pack(makeEnvelope("agent_task", eid(), fromHex(alice.pk), bob.pk, payload));

    await bob.as(() => bob.m.handleFrame(alice.pk, mkFrame()));
    drain(bob); // ACK
    await bob.as(() => bob.m.handleFrame(alice.pk, mkFrame())); // retry legítimo
    const [ack2] = drain(bob);
    expect(ack2).toBeDefined(); // re-ACK sí, segundo efecto no

    const rows = memB.messages.filter((m) => m.dir === "in" && m.id === "task-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toContain("reminder");
    const pending = await bob.as(() => getPendingAgentTasks());
    expect(pending.filter((t) => t.id === "task-1")).toHaveLength(1);
  });

  it("Tier-1 sin excepciones: un delivery_ack con envelope id repetido muere en unpack", async () => {
    const { alice, bob } = await setupAB();
    const s = await handshake(alice, bob);
    const ack = s.toA.pack(
      makeEnvelope("delivery_ack", "ack-env-1", fromHex(bob.pk), alice.pk, ackPayload("x", s.tag)),
    );
    const r1 = await alice.as(() => alice.m.handleFrame(bob.pk, ack));
    expect(r1?.type).toBe("delivery_ack"); // primer pase: unpack OK (luego se ignora por id)
    const r2 = await alice.as(() => alice.m.handleFrame(bob.pk, ack));
    expect(r2).toBeNull(); // replay de transmisión: Tier-1, sin excepciones
  });
});

// ---------------------------------------------------------------------------
// Propiedades del session_tag y del validador
// ---------------------------------------------------------------------------
describe("N6 — session_tag y validación del ACK", () => {
  it("deriveAckSessionTag: canónico (orden-independiente) y liga nonce↔identidad", () => {
    const a = generateIdentity();
    const b = generateIdentity();
    const nA = randomNonce(HANDSHAKE_NONCE_BYTES);
    const nB = randomNonce(HANDSHAKE_NONCE_BYTES);
    const t1 = deriveAckSessionTag(toHex(a.publicKey), toHex(b.publicKey), nA, nB);
    const t2 = deriveAckSessionTag(toHex(b.publicKey), toHex(a.publicKey), nB, nA);
    expect(t1).toBe(t2); // orden canónico: mismo par, mismo tag
    const t3 = deriveAckSessionTag(toHex(a.publicKey), toHex(b.publicKey), nB, nA);
    expect(t3).not.toBe(t1); // nonces cruzados → tag distinto (asociación pk↔nonce)
    expect(t1).toMatch(/^[0-9a-f]{128}$/); // SHA-512 en hex
  });

  it("deriveAckSessionTag rechaza entradas malformadas", () => {
    const a = generateIdentity();
    const n = randomNonce(HANDSHAKE_NONCE_BYTES);
    expect(() => deriveAckSessionTag("zz", toHex(a.publicKey), n, n)).toThrow();
    expect(() => deriveAckSessionTag(toHex(a.publicKey), toHex(a.publicKey), new Uint8Array(3), n)).toThrow();
  });

  it("isValidAckPayload: forma exacta o nada", () => {
    const good: DeliveryAckPayload = {
      for_id: "x",
      for_type: "chat",
      persisted_at: 1,
      session_tag: "ab".repeat(64),
      attest: "persisted",
    };
    expect(isValidAckPayload(good)).toBe(true);
    expect(isValidAckPayload({ ...good, attest: "seen" })).toBe(false);
    expect(isValidAckPayload({ ...good, extra: 1 })).toBe(false);
    expect(isValidAckPayload({ ...good, session_tag: "ab".repeat(63) })).toBe(false);
    expect(isValidAckPayload({ ...good, for_id: "" })).toBe(false);
    expect(isValidAckPayload({ ...good, persisted_at: -1 })).toBe(false);
    expect(isValidAckPayload(null)).toBe(false);
    expect(isValidAckPayload("ack")).toBe(false);
  });

  it("R4 congelado: el tag no altera el KDF (interop con/sin tag)", () => {
    const a = generateIdentity();
    const b = generateIdentity();
    const aEph = generateEphemeral();
    const bEph = generateEphemeral();
    const nA = randomNonce(HANDSHAKE_NONCE_BYTES);
    const nB = randomNonce(HANDSHAKE_NONCE_BYTES);
    // Vista del emisor (a) y vista del receptor (b): mismo material R4.
    // Cada fromHandshakeV2 consume (borra) su buffer de secreto: copias
    // independientes, como en la realidad.
    const sender = P2PSession.fromHandshakeV2(aEph.secretKey, bEph.publicKey, toHex(b.publicKey), nA, nB);
    const receiverPlain = P2PSession.fromHandshakeV2(bEph.secretKey.slice(), aEph.publicKey, toHex(a.publicKey), nB, nA);
    const receiverTagged = P2PSession.fromHandshakeV2(bEph.secretKey.slice(), aEph.publicKey, toHex(a.publicKey), nB, nA);
    sender.setSessionTag(deriveAckSessionTag(toHex(a.publicKey), toHex(b.publicKey), nA, nB));
    const frame = sender.pack(makeEnvelope("chat", "e1", a.publicKey, toHex(b.publicKey), { text: "x" }));
    // Misma clave de sesión R4: el tag es aditivo, el receptor sin tag abre igual.
    expect(receiverPlain.unpack(frame)).not.toBeNull();
    expect(receiverTagged.sessionTag).toBeNull(); // el tag vive en el emisor; el receptor lo deriva al completar
    expect(sender.sessionTag).toMatch(/^[0-9a-f]{128}$/);
  });
});

// ---------------------------------------------------------------------------
// i18n: honestidad visual en EN/ES/PT
// ---------------------------------------------------------------------------
describe("N6 i18n — solo 'delivered' lleva checkmark", () => {
  const locales = ["en", "es", "pt"] as const;
  const strings = Object.fromEntries(
    locales.map((l) => [
      l,
      JSON.parse(readFileSync(new URL(`../i18n/locales/${l}.json`, import.meta.url), "utf-8")).nido as Record<
        string,
        string
      >,
    ]),
  );

  it("los cuatro sufijos existen en los tres idiomas", () => {
    for (const l of locales) {
      for (const k of ["queuedSuffix", "sentSuffix", "deliveredSuffix", "failedSuffix"]) {
        expect(strings[l][k], `${l}.${k}`).toBeTruthy();
      }
    }
  });

  it("paridad EN/ES/PT de las acciones de reintento (§10: Retry vs Send again)", () => {
    for (const l of locales) {
      for (const k of ["retryAction", "sendAgainAction", "retryNotice", "sendAgainNotice"]) {
        expect(strings[l][k], `${l}.${k}`).toBeTruthy();
      }
      // La distinción del packet: más allá del horizonte es un envío NUEVO,
      // no un reintento — el copy no debe confundirlos.
      expect(strings[l].retryAction).not.toBe(strings[l].sendAgainAction);
    }
  });

  it("ningún estado salvo 'delivered' usa ✓", () => {
    for (const l of locales) {
      expect(strings[l].sentSuffix).not.toContain("✓");
      expect(strings[l].queuedSuffix).not.toContain("✓");
      expect(strings[l].failedSuffix).not.toContain("✓");
      expect(strings[l].sentNotice).not.toContain("✓");
      expect(strings[l].deliveredSuffix).toContain("✓");
    }
  });
});
