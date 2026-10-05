import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMemorySecureBackend,
  setTestSecureBackend,
  loadP2PPrivateKey,
  SecureStoreReadError,
  type SecureBackend,
} from "../privacy/keyManager";
import { generateIdentity, toHex } from "./crypto";
import { resetP2PMem, type P2PMem } from "./p2pMemoryMock";

/**
 * Envuelve un backend para que su próxima lectura falle (transitorio) y
 * luego se recupere. Reproduce el escenario M-1/M-2 del security review.
 */
function failNextRead(inner: SecureBackend): SecureBackend {
  let fail = true;
  return {
    getItemAsync: async (k: string) => {
      if (fail) {
        fail = false;
        throw new Error("boom: fallo transitorio del SecureStore");
      }
      return inner.getItemAsync(k);
    },
    setItemAsync: (k: string, v: string) => inner.setItemAsync(k, v),
    deleteItemAsync: (k: string) => inner.deleteItemAsync(k),
  };
}

const mem: P2PMem = vi.hoisted(() => ({
  identity: [],
  contacts: [],
  messages: [],
  ackLog: [],
  lateAck: [],
  nonceCache: [],
  identityArchive: [],
  repairIntents: [],
  bootRepairLog: [],
}));

vi.mock("../agent/memory/memoryStore", async () => {
  const { p2pMemoryStoreModule } = await import("./p2pMemoryMock");
  return p2pMemoryStoreModule(mem);
});

import { deleteIdentity, getIdentity, getSigningKeypair, saveIdentity, P2PIdentityKeyLossError, saveMessage, getConversation, saveContact, claimHelloNonce, pruneHelloNonceCache, clearHelloNonceCache, deleteHelloNoncesForPeer, saveInboundMessageWithAckLog, getDeliveryAckLogEntry, hasDeliveryAckLogEntry, pruneDeliveryAckLog, messageExists, getOutboundMessage, getSentOutbox, markOutboundDelivered, markOutboundFailed, incrementAckAttempts, resetOutboundForRetry, failPeerOutbox, recoverSentOutboxToQueued, recordLateAck, getLateAckRecord } from "./store";

beforeEach(() => {
  resetP2PMem(mem);
  setTestSecureBackend(createMemorySecureBackend());
});

describe("p2p/store: la privada nunca vive en la base", () => {
  it("saveIdentity guarda la sk en el Keystore y la base queda vacía", async () => {
    const kp = generateIdentity();
    await saveIdentity(kp.publicKey, kp.secretKey, "Yo");
    expect(mem.identity[0].sk_hex).toBe("");
    expect(mem.identity[0].pk_hex).toBe(toHex(kp.publicKey));
    expect(await loadP2PPrivateKey()).toBe(toHex(kp.secretKey));
  });

  it("getIdentity reconstruye desde el Keystore", async () => {
    const kp = generateIdentity();
    await saveIdentity(kp.publicKey, kp.secretKey, "Yo");
    const id = await getIdentity();
    expect(id).not.toBeNull();
    expect(toHex(id!.publicKey)).toBe(toHex(kp.publicKey));
    expect(toHex(id!.secretKey)).toBe(toHex(kp.secretKey));
  });

  it("migración: fila antigua con sk_hex se mueve al Keystore y se limpia", async () => {
    const kp = generateIdentity();
    // Simula base antigua (pre-migración).
    mem.identity = [{ pk_hex: toHex(kp.publicKey), sk_hex: toHex(kp.secretKey), name: "Yo", sign_pk_hex: null }];
    const id = await getIdentity();
    expect(id).not.toBeNull();
    expect(toHex(id!.secretKey)).toBe(toHex(kp.secretKey));
    expect(mem.identity[0].sk_hex).toBe(""); // columna limpiada
    expect(await loadP2PPrivateKey()).toBe(toHex(kp.secretKey));
  });

  it("F-2: fila durable sin sk en ningún lado → P2PIdentityKeyLossError (no null)", async () => {
    const kp = generateIdentity();
    mem.identity = [{ pk_hex: toHex(kp.publicKey), sk_hex: "", name: "Yo", sign_pk_hex: null }];
    const err = await getIdentity().catch((e) => e);
    expect(err).toBeInstanceOf(P2PIdentityKeyLossError);
    expect(err.code).toBe("NIDO_P2P_IDENTITY_KEY_LOST");
    expect(err.alias).toBe("nido_p2p_sk");
    expect(err.pkHex).toBe(toHex(kp.publicKey));
    // La fila queda INTACTA: nada se regeneró ni se sobrescribió.
    expect(mem.identity).toHaveLength(1);
    expect(mem.identity[0].pk_hex).toBe(toHex(kp.publicKey));
  });

  it("deleteIdentity borra base y Keystore", async () => {
    const kp = generateIdentity();
    await saveIdentity(kp.publicKey, kp.secretKey, "Yo");
    await deleteIdentity();
    expect(mem.identity).toHaveLength(0);
    expect(await loadP2PPrivateKey()).toBeNull();
    expect(await getIdentity()).toBeNull();
  });

  it("M-2: un fallo transitorio del Keystore NO hace que getIdentity devuelva null", async () => {
    const kp = generateIdentity();
    await saveIdentity(kp.publicKey, kp.secretKey, "Yo");
    const pkBefore = toHex(kp.publicKey);
    // El backend real ya tiene la sk; la próxima lectura falla (transitorio).
    const real = createMemorySecureBackend();
    await real.setItemAsync("nido_p2p_sk", toHex(kp.secretKey));
    setTestSecureBackend(failNextRead(real));
    // Antes del fix, esto devolvía null → ensureIdentity() generaba y
    // sobrescribía la identidad en silencio. Ahora: error explícito.
    const err = await getIdentity().catch((e) => e);
    expect(err).toBeInstanceOf(SecureStoreReadError);
    expect(String(err.message)).toMatch(/fail-closed/i);
    // Tras recuperarse: la identidad ORIGINAL, sin regeneración.
    const id = await getIdentity();
    expect(id).not.toBeNull();
    expect(toHex(id!.publicKey)).toBe(pkBefore);
    expect(toHex(id!.secretKey)).toBe(toHex(kp.secretKey));
  });

  it("M-2: getSigningKeypair no regenera ante un fallo transitorio", async () => {
    const real = createMemorySecureBackend();
    setTestSecureBackend(real);
    const kp1 = await getSigningKeypair(); // primera vez: genera y guarda
    const pub1 = toHex(kp1.publicKey);
    setTestSecureBackend(failNextRead(real));
    await expect(getSigningKeypair()).rejects.toThrow(SecureStoreReadError);
    // Tras recuperarse: el MISMO par, no uno regenerado.
    const kp2 = await getSigningKeypair();
    expect(toHex(kp2.publicKey)).toBe(pub1);
  });
});

describe("p2p/store: getConversation", () => {
  it("devuelve solo los mensajes del peer, ordenados por fecha", async () => {
    const kp = generateIdentity();
    const peerA = toHex(generateIdentity().publicKey);
    const peerB = toHex(generateIdentity().publicKey);
    await saveIdentity(kp.publicKey, kp.secretKey, "Yo");
    await saveMessage({ id: "a1", dir: "out", peerPk: peerA, type: "chat", text: "hola", status: "sent", ts: 30 });
    await saveMessage({ id: "b1", dir: "in", peerPk: peerB, type: "chat", text: "otro", status: "read", ts: 10 });
    await saveMessage({ id: "a2", dir: "in", peerPk: peerA, type: "chat", text: "qué tal", status: "read", ts: 20 });
    const conv = await getConversation(peerA);
    expect(conv.map((m) => m.id)).toEqual(["a2", "a1"]);
    expect(conv[0]).toMatchObject({ dir: "in", text: "qué tal" });
  });

  it("pk inválida → lista vacía sin lanzar", async () => {
    await expect(getConversation("zzz")).resolves.toEqual([]);
  });
});

describe("p2p/store: cache anti-replay de nonces de HELLO (R4)", () => {
  const PK_A = "aa".repeat(32);
  const PK_B = "bb".repeat(32);
  const N1 = "11".repeat(16);
  const N2 = "22".repeat(16);

  it("claim atómico: primer claim → true; conflicto UNIQUE → false (replay)", async () => {
    expect(await claimHelloNonce(PK_A, N1, 1000)).toBe(true);
    expect(await claimHelloNonce(PK_A, N1, 1001)).toBe(false); // replay
    expect(await claimHelloNonce(PK_A, N2, 1002)).toBe(true); // otro nonce: ok
    expect(await claimHelloNonce(PK_B, N1, 1003)).toBe(true); // otro pk: ok
    expect(mem.nonceCache).toHaveLength(3);
  });

  it("normaliza pk y nonce a minúsculas", async () => {
    expect(await claimHelloNonce(PK_A.toUpperCase(), N1.toUpperCase(), 1000)).toBe(true);
    expect(await claimHelloNonce(PK_A, N1, 1001)).toBe(false);
    expect(mem.nonceCache[0].pk_lower).toBe(PK_A);
  });

  it("par (pk, nonce) inválido → throw (fail-closed, no se reclama nada)", async () => {
    await expect(claimHelloNonce("corta", N1, 1000)).rejects.toThrow();
    await expect(claimHelloNonce(PK_A, "corto", 1000)).rejects.toThrow();
    expect(mem.nonceCache).toHaveLength(0);
  });

  it("el claim poda oportunistamente las filas viejas (evicción segura)", async () => {
    await claimHelloNonce(PK_A, N1, 1000, 100); // ventana de 100 s
    await claimHelloNonce(PK_A, N2, 2000, 100);
    // N1 quedó con seen_at=1000 < 2000-100=1900 → podado en el segundo claim.
    expect(mem.nonceCache.map((r) => r.nonce_hex)).toEqual([N2]);
  });

  it("pruneHelloNonceCache borra solo las filas viejas", async () => {
    await claimHelloNonce(PK_A, N1, 1000, 10 ** 9);
    await claimHelloNonce(PK_A, N2, 2000, 10 ** 9);
    await pruneHelloNonceCache(1500);
    expect(mem.nonceCache.map((r) => r.nonce_hex)).toEqual([N2]);
  });

  it("clearHelloNonceCache vacía la tabla", async () => {
    await claimHelloNonce(PK_A, N1, 1000);
    await claimHelloNonce(PK_B, N2, 1000);
    await clearHelloNonceCache();
    expect(mem.nonceCache).toHaveLength(0);
  });

  it("deleteHelloNoncesForPeer borra solo las filas de ese peer", async () => {
    await claimHelloNonce(PK_A, N1, 1000);
    await claimHelloNonce(PK_B, N2, 1000);
    await deleteHelloNoncesForPeer(PK_A);
    expect(mem.nonceCache.map((r) => r.pk_lower)).toEqual([PK_B]);
  });

  it("saveContact limpia las filas de nonces del peer (re-pairing, §8.4)", async () => {
    await claimHelloNonce(PK_A, N1, 1000);
    await claimHelloNonce(PK_B, N2, 1000);
    await saveContact(PK_A, "Beto", "cc".repeat(32));
    expect(mem.nonceCache.map((r) => r.pk_lower)).toEqual([PK_B]);
  });

  it("deleteIdentity vacía la cache anti-replay (§8.4: identidad nueva)", async () => {
    await claimHelloNonce(PK_A, N1, 1000);
    await deleteIdentity();
    expect(mem.nonceCache).toHaveLength(0);
  });
});

describe("p2p/store: N6 — outbox, ack log y auditoría", () => {
  const TAG = "ab".repeat(64); // 128 hex chars
  const PEER = "cd".repeat(32);

  async function seedOut(id: string, status: "queued" | "sent" | "failed" | "delivered" = "queued") {
    await saveMessage({
      id, dir: "out", peerPk: PEER, type: "chat", text: "hola",
      status, ts: Date.now(), ackAttempts: 0,
    });
  }

  it("saveInboundMessageWithAckLog: mensaje + ack log en una transacción; idempotente", async () => {
    const first = await saveInboundMessageWithAckLog({
      id: "m1", peerPk: PEER, type: "chat", text: "hola", status: "delivered",
      ts: 1000, sessionTag: TAG, persistedAt: 1001,
    });
    expect(first).toBe(true);
    expect(await messageExists("m1")).toBe(true);
    expect(await hasDeliveryAckLogEntry("m1")).toBe(true);
    const entry = await getDeliveryAckLogEntry("m1");
    expect(entry?.sessionTag).toBe(TAG);

    // Reintento del mismo message_id: no duplica ni el mensaje ni el log.
    const second = await saveInboundMessageWithAckLog({
      id: "m1", peerPk: PEER, type: "chat", text: "hola", status: "delivered",
      ts: 1000, sessionTag: TAG, persistedAt: 1002,
    });
    expect(second).toBe(false);
    expect(mem.messages.filter((m) => m.id === "m1")).toHaveLength(1);
    expect(mem.ackLog.filter((a) => a.message_id === "m1")).toHaveLength(1);
  });

  it("saveInboundMessageWithAckLog rechaza session_tag con forma inválida", async () => {
    await expect(
      saveInboundMessageWithAckLog({
        id: "m2", peerPk: PEER, type: "chat", text: "x", status: "delivered",
        ts: 1000, sessionTag: "corto", persistedAt: 1001,
      }),
    ).rejects.toThrow(/session_tag/i);
    expect(await messageExists("m2")).toBe(false);
  });

  it("markOutboundDelivered: solo desde queued/sent o failed(timeout); nunca desde user_cancelled", async () => {
    await seedOut("d1", "sent");
    expect(await markOutboundDelivered("d1")).toBe(true);
    expect((await getOutboundMessage("d1"))?.status).toBe("delivered");

    await seedOut("d2", "failed");
    await markOutboundFailed("d2", "timeout");
    expect(await markOutboundDelivered("d2")).toBe(true);

    await seedOut("d3", "failed");
    await markOutboundFailed("d3", "user_cancelled");
    expect(await markOutboundDelivered("d3")).toBe(false);
    expect((await getOutboundMessage("d3"))?.status).toBe("failed");

    await seedOut("d4", "failed");
    await markOutboundFailed("d4", "identity_changed");
    expect(await markOutboundDelivered("d4")).toBe(false);
  });

  it("markOutboundFailed nunca toca un 'delivered' terminal", async () => {
    await seedOut("d5", "delivered");
    expect(await markOutboundFailed("d5", "timeout")).toBe(false);
    expect((await getOutboundMessage("d5"))?.status).toBe("delivered");
  });

  it("incrementAckAttempts / resetOutboundForRetry / getSentOutbox", async () => {
    await seedOut("s1", "sent");
    await seedOut("s2", "sent");
    expect(await incrementAckAttempts("s1")).toBe(1);
    expect(await incrementAckAttempts("s1")).toBe(2);
    expect((await getSentOutbox()).map((m) => m.id).sort()).toEqual(["s1", "s2"]);

    await markOutboundFailed("s1", "timeout");
    expect(await resetOutboundForRetry("s1")).toBe(true);
    const row = await getOutboundMessage("s1");
    expect(row?.status).toBe("queued");
    expect(row?.ackAttempts).toBe(0);
    expect(row?.failureReason).toBeNull();
  });

  it("failPeerOutbox falla queued+sent del peer con la causa dada; recoverSentOutboxToQueued revierte sent→queued", async () => {
    await seedOut("p1", "queued");
    await seedOut("p2", "sent");
    expect(await failPeerOutbox(PEER, "identity_changed")).toBe(2);
    for (const id of ["p1", "p2"]) {
      const row = await getOutboundMessage(id);
      expect(row?.status).toBe("failed");
      expect(row?.failureReason).toBe("identity_changed");
    }
    await seedOut("p3", "sent");
    expect(await recoverSentOutboxToQueued()).toBe(1);
    expect((await getOutboundMessage("p3"))?.status).toBe("queued");
  });

  it("pruneDeliveryAckLog: solo por edad, nunca por volumen", async () => {
    const now = Date.now();
    const old = now - 91 * 86_400_000;
    // 10_005 entradas dentro del horizonte: ninguna se evicta.
    for (let i = 0; i < 10_005; i++) {
      await saveInboundMessageWithAckLog({
        id: `vol-${i}`, peerPk: PEER, type: "chat", text: "x", status: "delivered",
        ts: now, sessionTag: TAG, persistedAt: now,
      });
    }
    await saveInboundMessageWithAckLog({
      id: "old-1", peerPk: PEER, type: "chat", text: "x", status: "delivered",
      ts: old, sessionTag: TAG, persistedAt: old,
    });
    const pruned = await pruneDeliveryAckLog(now);
    expect(pruned).toBe(1);
    expect(await hasDeliveryAckLogEntry("old-1")).toBe(false);
    expect(await hasDeliveryAckLogEntry("vol-0")).toBe(true);
    expect(await hasDeliveryAckLogEntry("vol-10004")).toBe(true);
  });

  it("recordLateAck / getLateAckRecord: auditoría de ACKs tardíos", async () => {
    await recordLateAck("lz-1", TAG, 1234);
    const rec = await getLateAckRecord("lz-1");
    expect(rec?.sessionTag).toBe(TAG);
    expect(rec?.receivedAt).toBe(1234);
    expect(await getLateAckRecord("nope")).toBeNull();
  });
});
