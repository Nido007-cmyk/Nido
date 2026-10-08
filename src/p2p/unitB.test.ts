/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * unitB.test.ts — UNIT B (F-4/F-5/F-6): ciclo de vida de identidad superseded.
 *
 * Corre contra SQLite REAL (node:sqlite vía ./sqliteTestBridge), NO contra
 * el mock semántico: Q12 exige la carrera F-1 mid-flight con el motor SQL
 * de verdad (atomicidad, rollback, guardas WHERE autoritativas).
 *
 * Proof bar cubierto:
 *  1. Repros F-4/F-5/F-6 (escenarios pre-fix ahora cerrados).
 *  2. Rollback/crash antes y después del COMMIT; half-state imposible.
 *  3. Replace / DifferentPerson / Cancel / dismiss(=cancel) / rename único.
 *  4. Agent ambiguity → cancel.
 *  5. Resolución live-only del agente.
 *  6. Journal idempotente + doble pairWith.
 *  7. Cadena B→A→C y teardown.
 *  8. Boot repair de orphans; nunca revive user_cancelled.
 *  9. Matriz completa de retry.
 * 10. Teardown obligatorio, idempotente y non-fatal.
 * 11. Re-pair simultáneo: UN solo ganador por identidad vieja (el SQL decide;
 *     el perdedor recibe conflicto tipado con cero efectos); one-sided honest stall.
 * 12. Q12 exacto con carrera real mid-flight y gates JS+SQL.
 * 13. (N6 A/B/C, regresión R4, full suite y tsc: fuera de este archivo.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

// SQLite REAL para ../agent/memory/memoryStore (Q12: no vale el mock).
vi.mock("../agent/memory/memoryStore", async () => {
  const { sqliteMemoryStoreModule } = await import("./sqliteTestBridge");
  return sqliteMemoryStoreModule();
});
// Para UNIT B-4: el handler nido_pair obtiene el messenger del singleton
// compartido; aquí se sustituye por un stub cuya pairWith falla cerrado.
vi.mock("../services/nidoMessenger", async () => {
  const { PairingDisambiguationRequiredError } = await import("./messenger");
  const ambiguous = new PairingDisambiguationRequiredError([
    {
      pkHex: "aa".repeat(32),
      name: "Beto",
      verified: true,
      sigPkHex: null,
      supersededBy: null,
      supersededAt: null,
    },
  ]);
  return {
    getSharedNidoMessenger: () => ({
      ensureIdentity: async () => ({ pkHex: "bb".repeat(32) }),
      pairWith: async () => {
        throw ambiguous;
      },
    }),
  };
});
vi.mock("expo-sqlite", () => ({}));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));

import {
  useSqliteDevice,
  resetSqliteBridge,
  sqliteRaw,
} from "./sqliteTestBridge";
import {
  generateIdentity,
  generateSigningKeypair,
  generateEphemeral,
  randomNonce,
  HANDSHAKE_NONCE_BYTES,
  toHex,
  fromHex,
  fingerprint,
} from "./crypto";
import { encodePairingPayload } from "./pairing";
import { P2PSession, makeEnvelope, deriveAckSessionTag } from "./protocol";
import { randomUUID } from "node:crypto";
import { LoopbackTransport, type P2PTransport } from "./transport";
import {
  NidoMessenger,
  PairingDisambiguationRequiredError,
  type PairDisambiguation,
} from "./messenger";
import {
  commitRepair,
  clearRepairIntent,
  listContacts,
  listAllContacts,
  findContactByPk,
  findContactRowAny,
  getLiveSuccessorPk,
  listRepairIntents,
  runP2PBootRepair,
  getBootRepairLog,
  saveMessage,
  getOutboundMessage,
  getOutbox,
  getIdentity,
  getSigningKeypair,
  saveContact,
  markOutboundSent,
  markOutboundDelivered,
  markOutboundFailed,
  resetOutboundForRetry,
  failPeerOutbox,
  failAllOutbox,
  resolveContactByName,
  StaleReplaceConflictError,
} from "./store";
import { normalizeContactName } from "./contactName";
import {
  createMemorySecureBackend,
  setTestSecureBackend,
} from "../privacy/keyManager";

const backend = createMemorySecureBackend();

function freshMessenger(t?: LoopbackTransport): NidoMessenger {
  return new NidoMessenger(t ?? new LoopbackTransport());
}

async function pairedPeer(
  m: NidoMessenger,
  name: string,
): Promise<{ pkHex: string; code: string }> {
  const id = generateIdentity();
  const sign = generateSigningKeypair();
  const pkHex = toHex(id.publicKey);
  const code = encodePairingPayload(name, id.publicKey, sign.publicKey);
  await m.ensureIdentity("Yo");
  const contact = await m.pairWith(code);
  expect(contact).not.toBeNull();
  expect(contact!.pkHex).toBe(pkHex);
  return { pkHex, code };
}

beforeEach(() => {
  resetSqliteBridge();
  useSqliteDevice("default");
  setTestSecureBackend(backend);
});

// ---------------------------------------------------------------------------
// 1. Repros F-4/F-5/F-6 (escenarios pre-fix, ahora cerrados por el diseño).
// ---------------------------------------------------------------------------
describe("UNIT B-1: repros F-4/F-5/F-6 (post-fix: invariantes cerradas)", () => {
  it("F-4: re-pair por Replace no deja filas stranded — el outbox pendiente falla como peer_superseded", async () => {
    const m = freshMessenger();
    const { pkHex: oldPk } = await pairedPeer(m, "Beto");
    const sent = await m.sendChat("Beto", "hola");
    expect(sent.queued).toBe(true);
    // Pre-fix: commitRepair no existía; el re-pair reescribía el contacto y
    // el outbox quedaba 'queued' para siempre (stranded). Post-fix:
    const id2 = generateIdentity();
    const code2 = encodePairingPayload(
      "Beto",
      id2.publicKey,
      generateSigningKeypair().publicKey,
    );
    const contact = await m.pairWith(code2, { disambiguation: "replace" });
    expect(contact!.pkHex).toBe(toHex(id2.publicKey));
    const row = await getOutboundMessage(sent.id);
    expect(row?.status).toBe("failed");
    expect(row?.failureReason).toBe("identity_changed");
    expect(row?.identityChangeCause).toBe("peer_superseded");
  });

  it("F-5: mensajes antiguos NO se migran en silencio al re-pair", async () => {
    const m = freshMessenger();
    const { pkHex: oldPk } = await pairedPeer(m, "Beto");
    const sent = await m.sendChat("Beto", "viejo");
    const id2 = generateIdentity();
    await m.pairWith(
      encodePairingPayload("Beto", id2.publicKey, generateSigningKeypair().publicKey),
      { disambiguation: "replace" },
    );
    // La fila vieja sigue dirigida a la pk vieja (historia), jamás
    // reescrita a la nueva.
    const row = await getOutboundMessage(sent.id);
    expect(row?.peerPk.toLowerCase()).toBe(oldPk.toLowerCase());
    expect(row?.peerPk.toLowerCase()).not.toBe(toHex(id2.publicKey).toLowerCase());
  });

  it("F-6: una identidad superseded está muerta en todos los paths live", async () => {
    const m = freshMessenger();
    const { pkHex: oldPk } = await pairedPeer(m, "Beto");
    const id2 = generateIdentity();
    await m.pairWith(
      encodePairingPayload("Beto", id2.publicKey, generateSigningKeypair().publicKey),
      { disambiguation: "replace" },
    );
    // Resolución por pk: solo vivos.
    expect(await findContactByPk(oldPk)).toBeNull();
    // Resolución por nombre: resuelve al vivo.
    const r = await resolveContactByName("Beto");
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.contact.pkHex).toBe(toHex(id2.publicKey));
    // Envío por nombre llega al vivo.
    const sent = await m.sendChat("Beto", "al vivo");
    expect(sent.queued).toBe(true);
    const row = await getOutboundMessage(sent.id);
    expect(row?.peerPk.toLowerCase()).toBe(toHex(id2.publicKey).toLowerCase());
  });
});

// ---------------------------------------------------------------------------
// 2. Atomicidad: rollback antes del COMMIT; half-state imposible.
// ---------------------------------------------------------------------------
describe("UNIT B-2: atomicidad del commit de re-pair (SQL real)", () => {
  it("un fallo a mitad de commitRepair revierte TODO (rollback real)", async () => {
    const m = freshMessenger();
    const { pkHex: oldPk } = await pairedPeer(m, "Beto");
    const sent = await m.sendChat("Beto", "hola");
    const newPk = toHex(generateIdentity().publicKey);

    // Sabotea la transacción DESPUÉS del supersede pero ANTES del COMMIT:
    // falla el INSERT del journal.
    const raw = sqliteRaw();
    const origPrepare = raw.prepare.bind(raw);
    let calls = 0;
    (raw as unknown as { prepare: typeof origPrepare }).prepare = ((sql: string) => {
      calls++;
      if (/INSERT OR IGNORE INTO p2p_repair_intent/.test(sql) && calls > 0) {
        throw new Error("crash simulado mid-transaction");
      }
      return origPrepare(sql);
    }) as typeof origPrepare;
    try {
      await expect(
        commitRepair({ oldPkHexes: [oldPk], newPkHex: newPk, name: "Beto" }),
      ).rejects.toThrow("crash simulado");
    } finally {
      (raw as unknown as { prepare: typeof origPrepare }).prepare = origPrepare;
    }

    // Half-state imposible: el mundo viejo está INTACTO.
    expect(await findContactByPk(oldPk)).not.toBeNull();
    expect(await findContactByPk(newPk)).toBeNull();
    const row = await getOutboundMessage(sent.id);
    expect(row?.status).not.toBe("failed");
    expect(await listRepairIntents()).toHaveLength(0);
    // La ceremonia puede repetirse limpiamente.
    const ok = await commitRepair({ oldPkHexes: [oldPk], newPkHex: newPk, name: "Beto" });
    expect(ok.superseded).toContain(oldPk.toLowerCase());
  });

  it("post-commit: el intent journalizado sobrevive y el boot repair reconcilia", async () => {
    const m = freshMessenger();
    const { pkHex: oldPk } = await pairedPeer(m, "Beto");
    const sent = await m.sendChat("Beto", "hola");
    const newPk = toHex(generateIdentity().publicKey);
    await commitRepair({ oldPkHexes: [oldPk], newPkHex: newPk, name: "Beto" });
    // Simula crash entre COMMIT y efectos in-memory: el journal sigue ahí.
    expect(await listRepairIntents()).toHaveLength(1);
    // En este camino commitRepair ya falló el outbox; el boot repair no
    // tiene stranded que reconciliar pero limpia el intent.
    const res = await runP2PBootRepair();
    expect(res.intentsReconciled).toBe(1);
    expect(await listRepairIntents()).toHaveLength(0);
    const row = await getOutboundMessage(sent.id);
    expect(row?.identityChangeCause).toBe("peer_superseded");
  });
});

// ---------------------------------------------------------------------------
// 3. Replace / DifferentPerson / Cancel / dismiss / rename único.
// ---------------------------------------------------------------------------
describe("UNIT B-3: desambiguación explícita del emparejamiento", () => {
  async function collisionSetup(): Promise<{
    m: NidoMessenger;
    oldPk: string;
    code2: string;
    newPk: string;
  }> {
    const m = freshMessenger();
    const { pkHex: oldPk } = await pairedPeer(m, "Beto");
    const id2 = generateIdentity();
    const newPk = toHex(id2.publicKey);
    const code2 = encodePairingPayload("Beto", id2.publicKey, generateSigningKeypair().publicKey);
    return { m, oldPk, code2, newPk };
  }

  it("sin elección → PairingDisambiguationRequiredError y NADA se escribe", async () => {
    const { m, oldPk, code2 } = await collisionSetup();
    const before = await listAllContacts();
    await expect(m.pairWith(code2)).rejects.toBeInstanceOf(
      PairingDisambiguationRequiredError,
    );
    expect(await listAllContacts()).toEqual(before);
    expect(await listRepairIntents()).toHaveLength(0);
    expect(await findContactByPk(oldPk)).not.toBeNull();
  });

  it("cancel → null, nada se escribe (dismiss = cancel)", async () => {
    const { m, oldPk, code2 } = await collisionSetup();
    const res = await m.pairWith(code2, { disambiguation: "cancel" });
    expect(res).toBeNull();
    expect(await findContactByPk(oldPk)).not.toBeNull();
    expect(await listContacts()).toHaveLength(1);
    expect(await listRepairIntents()).toHaveLength(0);
  });

  it("replace → supersede total: contacto, journal, causa peer_superseded", async () => {
    const { m, oldPk, code2, newPk } = await collisionSetup();
    const contact = await m.pairWith(code2, { disambiguation: "replace" });
    expect(contact!.pkHex).toBe(newPk);
    expect(await findContactByPk(oldPk)).toBeNull();
    const all = await listAllContacts();
    const oldRow = all.find((c) => c.pkHex === oldPk.toLowerCase());
    expect(oldRow?.supersededBy).toBe(newPk.toLowerCase());
    expect(oldRow?.supersededAt).toBeGreaterThan(0);
    // El intent se journalizó y, tras los efectos post-commit del
    // messenger, se limpió.
    expect(await listRepairIntents()).toHaveLength(0);
  });

  it("different_person convive con rename único", async () => {
    const { m, oldPk, code2, newPk } = await collisionSetup();
    const contact = await m.pairWith(code2, {
      disambiguation: "different_person",
      newName: "Beto 2",
    });
    expect(contact!.pkHex).toBe(newPk);
    expect(contact!.name).toBe("Beto 2");
    // Ambos vivos.
    expect(await findContactByPk(oldPk)).not.toBeNull();
    expect(await findContactByPk(newPk)).not.toBeNull();
    expect(await listRepairIntents()).toHaveLength(0);
  });

  it("different_person sin nombre o con nombre colisionante → error, nada se escribe", async () => {
    const { m, oldPk, code2 } = await collisionSetup();
    await expect(
      m.pairWith(code2, { disambiguation: "different_person", newName: "   " }),
    ).rejects.toThrow(/nombre único/i);
    await expect(
      m.pairWith(code2, { disambiguation: "different_person", newName: "  BETO " }),
    ).rejects.toThrow(/Ya tienes un contacto vivo llamado/);
    expect(await listContacts()).toHaveLength(1);
    expect(await findContactByPk(oldPk)).not.toBeNull();
  });

  it("el mismo nombre normalizado de formas distintas colisiona igual", async () => {
    const m = freshMessenger();
    await pairedPeer(m, "Beto");
    const id2 = generateIdentity();
    // "  BETO " normaliza a "beto": colisión.
    const code2 = encodePairingPayload(
      "  BETO ",
      id2.publicKey,
      generateSigningKeypair().publicKey,
    );
    await expect(m.pairWith(code2)).rejects.toBeInstanceOf(
      PairingDisambiguationRequiredError,
    );
    expect(normalizeContactName("  BETO ")).toBe(normalizeContactName("Beto"));
  });
});

// ---------------------------------------------------------------------------
// 4. Agent ambiguity → cancel (el handler pide la elección por chat).
// ---------------------------------------------------------------------------
describe("UNIT B-4: el agente ante ambigüedad cancela (fail-closed)", () => {
  it("sin disambiguation ante colisión, el handler devuelve las 3 opciones y no escribe", async () => {
    // El stub de getSharedNidoMessenger (vi.mock arriba) falla cerrado con
    // PairingDisambiguationRequiredError, como la implementación real.
    const { buildToolHandlers } = await import("../agent/tools/handlers");
    const id = generateIdentity();
    const sign = generateSigningKeypair();
    const code = encodePairingPayload("Beto", id.publicKey, sign.publicKey);
    const h = buildToolHandlers({ requestConfirm: async () => true });
    const out = await h.nido_pair({ code });
    // Pide la elección por chat: menciona las tres opciones, no asume nada.
    expect(out).toMatch(/replace/i);
    expect(out).toMatch(/different person/i);
    expect(out).toMatch(/cancel/i);
  });

  it("una elección inválida no se convierte en replace", async () => {
    const { buildToolHandlers } = await import("../agent/tools/handlers");
    const id = generateIdentity();
    const sign = generateSigningKeypair();
    const code = encodePairingPayload("Beto", id.publicKey, sign.publicKey);
    const h = buildToolHandlers({ requestConfirm: async () => true });
    const out = await h.nido_pair({ code, disambiguation: "whatever" });
    expect(out).not.toMatch(/emparejado/i);
  });
});

// ---------------------------------------------------------------------------
// 5. Resolución live-only del agente.
// ---------------------------------------------------------------------------
describe("UNIT B-5: el agente solo resuelve contactos vivos", () => {
  it("tras replace, el nombre resuelve al sucesor vivo, nunca al superseded", async () => {
    const m = freshMessenger();
    await pairedPeer(m, "Beto");
    const id2 = generateIdentity();
    const newPk = toHex(id2.publicKey);
    await m.pairWith(
      encodePairingPayload("Beto", id2.publicKey, generateSigningKeypair().publicKey),
      { disambiguation: "replace" },
    );
    const r = await resolveContactByName("beto");
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.contact.pkHex).toBe(newPk);
    // listAllContacts es solo auditoría: ningún flujo live la usa.
    const all = await listAllContacts();
    expect(all.length).toBe(2);
    const live = await listContacts();
    expect(live.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 6. Journal idempotente + doble pairWith.
// ---------------------------------------------------------------------------
describe("UNIT B-6: idempotencia del journal y doble pairWith", () => {
  it("dos replace idénticos no duplican intents ni rompen nada", async () => {
    const m = freshMessenger();
    const { pkHex: oldPk } = await pairedPeer(m, "Beto");
    const id2 = generateIdentity();
    const newPk = toHex(id2.publicKey);
    const code2 = encodePairingPayload("Beto", id2.publicKey, generateSigningKeypair().publicKey);
    const c1 = await m.pairWith(code2, { disambiguation: "replace" });
    expect(c1!.pkHex).toBe(newPk);
    // Segundo pairWith del MISMO código: ya es identidad conocida → upsert
    // idempotente, sin colisión (el viejo ya no está vivo).
    const c2 = await m.pairWith(code2, { disambiguation: "replace" });
    expect(c2!.pkHex).toBe(newPk);
    expect(await listRepairIntents()).toHaveLength(0);
    const live = await listContacts();
    expect(live.map((c) => c.pkHex)).toEqual([newPk]);
  });

  it("commitRepair directo dos veces con la misma pk vieja: la segunda es conflicto tipado (cierre de concurrencia)", async () => {
    // UNIT B concurrency closure: el SQL decide. La segunda invocación
    // observa que la pk vieja esperada ya no está viva → conflicto tipado
    // con CERO efectos (rollback), no un éxito silencioso. El doble
    // pairWith a nivel messenger sigue siendo idempotente por el path
    // knownLive (test anterior); aquí se prueba la guarda del txn.
    const m = freshMessenger();
    const { pkHex: oldPk } = await pairedPeer(m, "Beto");
    const newPk = toHex(generateIdentity().publicKey);
    await commitRepair({ oldPkHexes: [oldPk], newPkHex: newPk, name: "Beto" });
    const err = await commitRepair({ oldPkHexes: [oldPk], newPkHex: newPk, name: "Beto" }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(StaleReplaceConflictError);
    expect(err.conflict).toBe("old_identity_already_superseded");
    expect(err.supersededBy?.toLowerCase()).toBe(newPk.toLowerCase());
    // Cero efectos del perdedor: el intent sigue siendo solo el del
    // ganador; la cadena superseded_by no se tocó.
    const intents = await listRepairIntents();
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ oldPk: oldPk.toLowerCase(), newPk: newPk.toLowerCase() });
    const oldRow = (await listAllContacts()).find((c) => c.pkHex === oldPk.toLowerCase());
    expect(oldRow?.supersededBy?.toLowerCase()).toBe(newPk.toLowerCase());
    await clearRepairIntent(oldPk);
    expect(await listRepairIntents()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Cadena B→A→C y teardown.
// ---------------------------------------------------------------------------
describe("UNIT B-7: cadena de supersesión y teardown de ruta", () => {
  it("B→A→C: cada replace retira la anterior; el sucesor es one-hop", async () => {
    const tornDown: string[] = [];
    const t = new LoopbackTransport();
    const orig = t.teardownRouteForPeer.bind(t);
    t.teardownRouteForPeer = async (pk: string) => {
      tornDown.push(pk.toLowerCase());
      await orig(pk);
    };
    const m = freshMessenger(t);
    const { pkHex: pkB } = await pairedPeer(m, "Beto");
    const idA = generateIdentity();
    const pkA = toHex(idA.publicKey);
    await m.pairWith(
      encodePairingPayload("Beto", idA.publicKey, generateSigningKeypair().publicKey),
      { disambiguation: "replace" },
    );
    const idC = generateIdentity();
    const pkC = toHex(idC.publicKey);
    await m.pairWith(
      encodePairingPayload("Beto", idC.publicKey, generateSigningKeypair().publicKey),
      { disambiguation: "replace" },
    );
    // Teardown por cada identidad retirada, en orden.
    expect(tornDown).toEqual([pkB.toLowerCase(), pkA.toLowerCase()]);
    // Solo C vive.
    expect((await listContacts()).map((c) => c.pkHex)).toEqual([pkC]);
    // One-hop y solo-sucesor-vivo (diseño §7.1): el sucesor directo de B
    // es A, pero A también está superseded → NO se persigue la cadena
    // hasta C; el reenvío a B se rechaza como "no_live_successor" (honesto).
    expect(await getLiveSuccessorPk(pkB)).toBeNull();
    expect(await getLiveSuccessorPk(pkA)).toBe(pkC.toLowerCase());
    // La cadena completa queda en el historial de auditoría.
    const all = await listAllContacts();
    expect(all.find((c) => c.pkHex === pkB.toLowerCase())?.supersededBy).toBe(pkA.toLowerCase());
    expect(all.find((c) => c.pkHex === pkA.toLowerCase())?.supersededBy).toBe(pkC.toLowerCase());
  });
});

// ---------------------------------------------------------------------------
// 8. Boot repair de orphans; nunca revive user_cancelled.
// ---------------------------------------------------------------------------
describe("UNIT B-8: boot repair honesto", () => {
  it("huerfanos del outbox fallan como orphaned_destination; user_cancelled intacto", async () => {
    const m = freshMessenger();
    await m.ensureIdentity("Yo");
    const ghostPk = toHex(generateIdentity().publicKey);
    // Mensaje a una identidad que no existe en contactos (huérfano).
    await saveMessage({
      id: "orphan1", dir: "out", peerPk: ghostPk, type: "chat",
      text: "x", status: "queued", ts: Date.now(), ackAttempts: 0,
    });
    // user_cancelled: terminal, nunca se toca.
    await saveMessage({
      id: "cancelled1", dir: "out", peerPk: ghostPk, type: "chat",
      text: "y", status: "failed", ts: Date.now(), ackAttempts: 0,
    });
    await markOutboundFailed("cancelled1", "user_cancelled");
    const res = await runP2PBootRepair();
    expect(res.orphansFailed).toBe(1);
    const orphan = await getOutboundMessage("orphan1");
    expect(orphan?.status).toBe("failed");
    expect(orphan?.failureReason).toBe("identity_changed");
    expect(orphan?.identityChangeCause).toBe("orphaned_destination");
    const cancelled = await getOutboundMessage("cancelled1");
    expect(cancelled?.status).toBe("failed");
    expect(cancelled?.failureReason).toBe("user_cancelled");
    const log = await getBootRepairLog();
    expect(log.some((e) => /orphan sweep/.test(e.detail))).toBe(true);
  });

  it("backfill legacy: identity_changed sin causa → orphaned_destination (R3)", async () => {
    // Simula una base creada ANTES de la lane UNIT B: esquema viejo (sin
    // identity_change_cause) + una fila failed(identity_changed) legacy.
    // Al abrirla, migrateOn añade la columna y el backfill honesto la
    // etiqueta orphaned_destination (causa desconocida, nunca inventada).
    useSqliteDevice("legacy-db");
    const raw = sqliteRaw();
    raw.exec(
      "CREATE TABLE p2p_contacts(pk_hex TEXT PRIMARY KEY, name TEXT NOT NULL, " +
        "verified INTEGER NOT NULL DEFAULT 1, sig_pk TEXT, " +
        "added_at TEXT NOT NULL DEFAULT (datetime('now')));" +
        "CREATE TABLE p2p_messages(id TEXT PRIMARY KEY, dir TEXT NOT NULL, " +
        "peer_pk TEXT NOT NULL, type TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', " +
        "status TEXT NOT NULL DEFAULT 'queued', ts INTEGER NOT NULL, " +
        "ack_attempts INTEGER NOT NULL DEFAULT 0, failure_reason TEXT, " +
        "created_at TEXT NOT NULL DEFAULT (datetime('now')));",
    );
    raw.prepare(
      "INSERT INTO p2p_messages(id, dir, peer_pk, type, text, status, ts, failure_reason) " +
        "VALUES ('legacy1','out','" + "bb".repeat(32) + "','chat','z','failed',1,'identity_changed')",
    ).run();
    // El próximo acceso al store dispara migrateOn (epoch nuevo) + backfill.
    await listContacts();
    const row = await getOutboundMessage("legacy1");
    expect(row?.failureReason).toBe("identity_changed");
    expect(row?.identityChangeCause).toBe("orphaned_destination");
    useSqliteDevice("default");
  });
});

// ---------------------------------------------------------------------------
// 9. Matriz completa de retry.
// ---------------------------------------------------------------------------
describe("UNIT B-9: matriz de retry causa-aware", () => {
  async function failedWith(
    m: NidoMessenger,
    failureReason: "identity_changed" | "user_cancelled" | "timeout",
    cause?: "peer_superseded" | "own_identity_recovered" | "orphaned_destination" | null,
    peerPk?: string,
  ): Promise<string> {
    const pk = peerPk ?? toHex(generateIdentity().publicKey);
    const id = `msg-${Math.random().toString(36).slice(2)}`;
    await saveMessage({
      id, dir: "out", peerPk: pk, type: "chat", text: "t",
      status: "queued", ts: Date.now(), ackAttempts: 3,
    });
    if (failureReason === "user_cancelled") {
      await markOutboundFailed(id, "user_cancelled");
    } else if (failureReason === "identity_changed") {
      // Simula el fail con causa escribiendo directo (el camino real es
      // commitRepair/failPeerOutbox/failAllOutbox; aquí se fija la causa).
      const raw = sqliteRaw();
      raw.prepare(
        "UPDATE p2p_messages SET status='failed', failure_reason='identity_changed', " +
          "identity_change_cause=? WHERE id=?",
      ).run(cause ?? null, id);
    } else {
      await markOutboundFailed(id, "timeout");
    }
    void m;
    return id;
  }

  it("peer_superseded → rechazado con sucesor; orphaned_destination → rechazado honesto", async () => {
    const m = freshMessenger();
    const { pkHex: oldPk } = await pairedPeer(m, "Beto");
    const id2 = generateIdentity();
    const newPk = toHex(id2.publicKey);
    await m.pairWith(
      encodePairingPayload("Beto", id2.publicKey, generateSigningKeypair().publicKey),
      { disambiguation: "replace" },
    );
    const id = await failedWith(m, "identity_changed", "peer_superseded", oldPk);
    const out = await m.retryOutboundMessage(id);
    expect(out).toEqual({ refused: "peer_superseded", supersededBy: newPk.toLowerCase() });
    // ...pero el reenvío explícito al sucesor crea un mensaje NUEVO.
    const resend = await m.resendToSupersedingIdentity(id);
    expect("id" in resend).toBe(true);
    if ("id" in resend) {
      expect(resend.id).not.toBe(id);
      const fresh = await getOutboundMessage(resend.id);
      expect(fresh?.peerPk.toLowerCase()).toBe(newPk.toLowerCase());
      // La fila vieja jamás se mutó.
      const old = await getOutboundMessage(id);
      expect(old?.status).toBe("failed");
      expect(old?.identityChangeCause).toBe("peer_superseded");
    }
  });

  it("orphaned_destination y causa legacy nula → rechazado, sin sucesor inventado", async () => {
    const m = freshMessenger();
    await m.ensureIdentity("Yo");
    const id1 = await failedWith(m, "identity_changed", "orphaned_destination");
    expect(await m.retryOutboundMessage(id1)).toEqual({ refused: "orphaned_destination" });
    const id2 = await failedWith(m, "identity_changed", null);
    expect(await m.retryOutboundMessage(id2)).toEqual({ refused: "orphaned_destination" });
    // resendToSupersedingIdentity exige causa peer_superseded…
    expect(await m.resendToSupersedingIdentity(id1)).toEqual({
      refused: "not_peer_superseded",
    });
    // …y sucesor VIVO (one-hop): si el sucesor también murió, se rechaza
    // como no_live_successor en vez de perseguir la cadena.
    const { pkHex: oldPk } = await pairedPeer(m, "Beto");
    const idMid = generateIdentity();
    const idNew = generateIdentity();
    await commitRepair({
      oldPkHexes: [oldPk],
      newPkHex: toHex(idMid.publicKey),
      name: "Beto",
    });
    await commitRepair({
      oldPkHexes: [toHex(idMid.publicKey)],
      newPkHex: toHex(idNew.publicKey),
      name: "Beto",
    });
    const id3 = await failedWith(m, "identity_changed", "peer_superseded", oldPk);
    expect(await m.resendToSupersedingIdentity(id3)).toEqual({
      refused: "no_live_successor",
    });
  });

  it("own_identity_recovered (F-2) → retry permitido por el camino normal", async () => {
    const m = freshMessenger();
    await m.ensureIdentity("Yo");
    const n = await failAllOutbox("identity_changed");
    void n;
    // failAllOutbox escribe own_identity_recovered; crea una fila así.
    const pk = toHex(generateIdentity().publicKey);
    await saveContact(pk, "Peer", null);
    const id = await failedWith(m, "identity_changed", "own_identity_recovered", pk);
    // resetOutboundForRetry permite own_identity_recovered (gate SQL).
    expect(await resetOutboundForRetry(id)).toBe(true);
  });

  it("user_cancelled: sin gesto explícito se rechaza; con gesto, id fresco y fila vieja intacta", async () => {
    const m = freshMessenger();
    const { pkHex } = await pairedPeer(m, "Beto");
    const id = await failedWith(m, "user_cancelled", null, pkHex);
    expect(await m.retryOutboundMessage(id)).toEqual({ refused: "user_cancelled" });
    const out = await m.retryOutboundMessage(id, { explicitGesture: true });
    expect(out && "freshId" in out && out.freshId).toBe(true);
    if (out && "freshId" in out) {
      expect(out.id).not.toBe(id);
      const old = await getOutboundMessage(id);
      expect(old?.status).toBe("failed");
      expect(old?.failureReason).toBe("user_cancelled");
    }
  });

  it("failPeerOutbox escribe peer_superseded; failAllOutbox escribe own_identity_recovered", async () => {
    const m = freshMessenger();
    const { pkHex } = await pairedPeer(m, "Beto");
    const sent = await m.sendChat("Beto", "hola");
    const n = await failPeerOutbox(pkHex, "identity_changed");
    expect(n).toBe(1);
    const row = await getOutboundMessage(sent.id);
    expect(row?.identityChangeCause).toBe("peer_superseded");
    // F-2: failAllOutbox tras recovery propio.
    const sent2 = await m.sendChat("Beto", "otro");
    await failAllOutbox("identity_changed");
    const row2 = await getOutboundMessage(sent2.id);
    expect(row2?.identityChangeCause).toBe("own_identity_recovered");
  });
});

// ---------------------------------------------------------------------------
// 10. Teardown obligatorio, idempotente y non-fatal.
// ---------------------------------------------------------------------------
describe("UNIT B-10: teardownRouteForPeer obligatorio", () => {
  it("todo P2PTransport lo implementa; Loopback es no-op idempotente", async () => {
    const t = new LoopbackTransport();
    expect(typeof t.teardownRouteForPeer).toBe("function");
    await t.teardownRouteForPeer("aa".repeat(32));
    await t.teardownRouteForPeer("aa".repeat(32)); // idempotente
  });

  it("un teardown que lanza NO revierte el commit (post-commit non-fatal)", async () => {
    const t = new LoopbackTransport();
    t.teardownRouteForPeer = async () => {
      throw new Error("BT roto");
    };
    const m = freshMessenger(t);
    const { pkHex: oldPk } = await pairedPeer(m, "Beto");
    const id2 = generateIdentity();
    const contact = await m.pairWith(
      encodePairingPayload("Beto", id2.publicKey, generateSigningKeypair().publicKey),
      { disambiguation: "replace" },
    );
    expect(contact!.pkHex).toBe(toHex(id2.publicKey));
    expect(await findContactByPk(oldPk)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 11. Re-pair simultáneo y one-sided honest stall.
// ---------------------------------------------------------------------------
describe("UNIT B-11: concurrencia del re-pair", () => {
  it("dos Replace concurrentes de la misma pk vieja: exactamente UN ganador; el perdedor recibe conflicto tipado con cero efectos", async () => {
    // UNIT B concurrency closure (owner 2026-09-28): una identidad vieja
    // tiene como máximo UN reemplazo ganador entre Replace concurrentes.
    // El SQL decide (filosofía F-1): el primer txn que supersede la pk
    // vieja exacta gana; el perdedor observa que su identidad esperada ya
    // no está viva y recibe un conflicto tipado con cero contacto nuevo,
    // cero mutación del outbox, cero mutación de rutas/sesiones y cero
    // efecto en el journal. No se resuelve por nombre, mutex JS, timing
    // ni last-writer-wins.
    const m = freshMessenger();
    const { pkHex: oldPk } = await pairedPeer(m, "Beto");
    const sent = await m.sendChat("Beto", "hola");
    const idA = generateIdentity();
    const idB = generateIdentity();
    const pkA = toHex(idA.publicKey);
    const pkB = toHex(idB.publicKey);
    const codeA = encodePairingPayload("Beto", idA.publicKey, generateSigningKeypair().publicKey);
    const codeB = encodePairingPayload("Beto", idB.publicKey, generateSigningKeypair().publicKey);
    // Ambas ceremonias ven la misma colisión y confirman "replace". El
    // orden de llegada no está determinado: el resultado sí (un ganador).
    // Los objetivos se fijan por PK (los que cada ceremonia mostró).
    const replaceTargets = [oldPk];
    const results = await Promise.allSettled([
      m.pairWith(codeA, { disambiguation: "replace", replaceTargets }),
      m.pairWith(codeB, { disambiguation: "replace", replaceTargets }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason;
    expect(reason).toBeInstanceOf(StaleReplaceConflictError);
    expect(reason.conflict).toBe("old_identity_already_superseded");
    const winner = (fulfilled[0] as PromiseFulfilledResult<{ pkHex: string } | null>).value;
    expect(winner).not.toBeNull();
    const winnerPk = winner!.pkHex.toLowerCase();
    const loserPk = winnerPk === pkA.toLowerCase() ? pkB.toLowerCase() : pkA.toLowerCase();
    // Exactamente un sucesor vivo.
    expect((await listContacts()).map((c) => c.pkHex)).toEqual([winnerPk]);
    // Cadena superseded_by coherente: la vieja apunta al ganador, y solo a él.
    const oldRow = (await listAllContacts()).find((c) => c.pkHex === oldPk.toLowerCase());
    expect(oldRow?.supersededBy?.toLowerCase()).toBe(winnerPk);
    // El conflicto tipado nombra al ganador.
    expect(reason.supersededBy?.toLowerCase()).toBe(winnerPk);
    // Cero efectos del perdedor: sin contacto (ni vivo ni muerto), sin
    // intent con su pk, sin tocar la fila del outbox más allá del fail del
    // ganador.
    expect(await findContactRowAny(loserPk)).toBeNull();
    expect(
      (await listRepairIntents()).some((i) => i.newPk.toLowerCase() === loserPk),
    ).toBe(false);
    const row = await getOutboundMessage(sent.id);
    expect(row?.status).toBe("failed");
    expect(row?.failureReason).toBe("identity_changed");
    expect(row?.identityChangeCause).toBe("peer_superseded");
    expect(row?.peerPk.toLowerCase()).toBe(oldPk.toLowerCase());
    // Sin intents pendientes (el ganador limpió el suyo post-commit).
    expect(await listRepairIntents()).toHaveLength(0);
  });

  it("Replace secuencial tras un Replace completado: conflicto tipado en el pre-check (fail closed), cero escrituras", async () => {
    // Orden B: el segundo pairWith lee DESPUÉS del commit del primero. Su
    // elección explícita "replace" ya no tiene objetivo vivo → falla
    // cerrado en el pre-check, sin escribir nada.
    const m = freshMessenger();
    const { pkHex: oldPk } = await pairedPeer(m, "Beto");
    const idA = generateIdentity();
    const pkA = toHex(idA.publicKey);
    const w = await m.pairWith(
      encodePairingPayload("Beto", idA.publicKey, generateSigningKeypair().publicKey),
      { disambiguation: "replace" },
    );
    expect(w!.pkHex).toBe(pkA);
    const idB = generateIdentity();
    const pkB = toHex(idB.publicKey);
    // El objetivo fijado (la pk vieja) ya no está vivo → conflicto, no un
    // emparejamiento plano silencioso.
    await expect(
      m.pairWith(encodePairingPayload("Beto", idB.publicKey, generateSigningKeypair().publicKey), {
        disambiguation: "replace",
        replaceTargets: [oldPk],
      }),
    ).rejects.toBeInstanceOf(StaleReplaceConflictError);
    // Cero escrituras del segundo: ni siquiera existe la fila.
    expect(await findContactRowAny(pkB)).toBeNull();
    expect((await listContacts()).map((c) => c.pkHex)).toEqual([pkA.toLowerCase()]);
    const oldRow = (await listAllContacts()).find((c) => c.pkHex === oldPk.toLowerCase());
    expect(oldRow?.supersededBy?.toLowerCase()).toBe(pkA.toLowerCase());
  });

  it("commitRepair a nivel store: el SQL decide en ambos órdenes de llegada", async () => {
    // Orden determinista 1: A commitea primero, B pierde.
    {
      const m = freshMessenger();
      const { pkHex: oldPk } = await pairedPeer(m, "Beto");
      const newA = toHex(generateIdentity().publicKey);
      const newB = toHex(generateIdentity().publicKey);
      await commitRepair({ oldPkHexes: [oldPk], newPkHex: newA, name: "Beto" });
      const err = await commitRepair({ oldPkHexes: [oldPk], newPkHex: newB, name: "Beto" }).catch(
        (e) => e,
      );
      expect(err).toBeInstanceOf(StaleReplaceConflictError);
      expect(err.supersededBy?.toLowerCase()).toBe(newA.toLowerCase());
      // Rollback del perdedor: sin contacto, sin intent con su pk, cadena intacta.
      expect(await findContactRowAny(newB)).toBeNull();
      expect(
        (await listRepairIntents()).some((i) => i.newPk.toLowerCase() === newB.toLowerCase()),
      ).toBe(false);
      const oldRow = (await listAllContacts()).find((c) => c.pkHex === oldPk.toLowerCase());
      expect(oldRow?.supersededBy?.toLowerCase()).toBe(newA.toLowerCase());
    }
  });

  it("commitRepair a nivel store: orden inverso — B gana, A pierde igual", async () => {
    // Orden determinista 2: B commitea primero, A pierde. Simétrico: el
    // ganador lo decide el SQL, no el orden de invocación del test.
    const m = freshMessenger();
    const { pkHex: oldPk } = await pairedPeer(m, "Beto");
    const newA = toHex(generateIdentity().publicKey);
    const newB = toHex(generateIdentity().publicKey);
    await commitRepair({ oldPkHexes: [oldPk], newPkHex: newB, name: "Beto" });
    const err = await commitRepair({ oldPkHexes: [oldPk], newPkHex: newA, name: "Beto" }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(StaleReplaceConflictError);
    expect(err.supersededBy?.toLowerCase()).toBe(newB.toLowerCase());
    expect(await findContactRowAny(newA)).toBeNull();
    const oldRow = (await listAllContacts()).find((c) => c.pkHex === oldPk.toLowerCase());
    expect(oldRow?.supersededBy?.toLowerCase()).toBe(newB.toLowerCase());
  });

  it("rollback atómico: si parte del conjunto ya fue superseded, el txn aborta completo", async () => {
    // Dos contactos vivos con el mismo nombre visible ("Beto" y "Beto 2").
    // Un ganador retira solo el primero; un segundo commitRepair que
    // reclama AMBOS debe abortar entero: el segundo contacto sigue vivo.
    const m = freshMessenger();
    const { pkHex: oldPk1 } = await pairedPeer(m, "Beto");
    const idX = generateIdentity();
    const pkX = toHex(idX.publicKey);
    await m.pairWith(
      encodePairingPayload("Beto", idX.publicKey, generateSigningKeypair().publicKey),
      { disambiguation: "different_person", newName: "Beto 2" },
    );
    const newA = toHex(generateIdentity().publicKey);
    await commitRepair({ oldPkHexes: [oldPk1], newPkHex: newA, name: "Beto" });
    const newB = toHex(generateIdentity().publicKey);
    await expect(
      commitRepair({ oldPkHexes: [oldPk1, pkX], newPkHex: newB, name: "Beto" }),
    ).rejects.toBeInstanceOf(StaleReplaceConflictError);
    // El contacto no reclamado por el ganador sigue vivo e intacto.
    expect((await findContactByPk(pkX))?.supersededBy).toBeNull();
    expect(await findContactRowAny(newB)).toBeNull();
  });

  it("Different Person se preserva: dos personas distintas pueden convivir tras un Replace", async () => {
    // La guarda solo aplica cuando ambas operaciones reclaman Replace de
    // la MISMA pk vieja. different_person no reclama nada: convive.
    const m = freshMessenger();
    await pairedPeer(m, "Beto");
    const idA = generateIdentity();
    const pkA = toHex(idA.publicKey);
    await m.pairWith(
      encodePairingPayload("Beto", idA.publicKey, generateSigningKeypair().publicKey),
      { disambiguation: "replace" },
    );
    const idB = generateIdentity();
    const pkB = toHex(idB.publicKey);
    const c = await m.pairWith(
      encodePairingPayload("Beto", idB.publicKey, generateSigningKeypair().publicKey),
      { disambiguation: "different_person", newName: "Beto 2" },
    );
    expect(c).not.toBeNull();
    expect(c!.pkHex).toBe(pkB);
    expect((await listContacts()).map((x) => x.pkHex).sort()).toEqual(
      [pkA.toLowerCase(), pkB.toLowerCase()].sort(),
    );
  });

  it("pinning por PK: el objetivo fijado ya muerto no hace retirar otra identidad del mismo nombre", async () => {
    // La ceremonia mostró la huella de oldPk y el usuario confirmó
    // retirarla. Si oldPk ya murió (otro Replace ganó), el segundo intento
    // NO debe retirar en silencio al ganador (misma "Beto", otra
    // identidad que el usuario nunca confirmó retirar).
    const m = freshMessenger();
    const { pkHex: oldPk } = await pairedPeer(m, "Beto");
    const idA = generateIdentity();
    const pkA = toHex(idA.publicKey);
    await m.pairWith(
      encodePairingPayload("Beto", idA.publicKey, generateSigningKeypair().publicKey),
      { disambiguation: "replace", replaceTargets: [oldPk] },
    );
    const idB = generateIdentity();
    const pkB = toHex(idB.publicKey);
    const err = await m
      .pairWith(encodePairingPayload("Beto", idB.publicKey, generateSigningKeypair().publicKey), {
        disambiguation: "replace",
        replaceTargets: [oldPk],
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(StaleReplaceConflictError);
    expect(err.supersededBy?.toLowerCase()).toBe(pkA.toLowerCase());
    // El ganador (mismo nombre visible) sigue vivo: no se retiró una
    // identidad no confirmada. El perdedor no escribió nada.
    expect((await findContactByPk(pkA))?.supersededBy).toBeNull();
    expect(await findContactRowAny(pkB)).toBeNull();
    expect((await listContacts()).map((c) => c.pkHex)).toEqual([pkA.toLowerCase()]);
  });

  it("one-sided: si el peer nunca hace re-pair, su vista queda honestamente vieja", async () => {
    // A y B emparejados en SUS dispositivos. A pierde su identidad (F-2) y
    // hace recovery: su pk cambia. B NO hace re-pair: B sigue viendo la
    // identidad vieja de A como viva. Eso es honesto — B no puede saberlo;
    // el diseño no inventa presencia ni revive nada a distancia.
    useSqliteDevice("devA");
    setTestSecureBackend(createMemorySecureBackend());
    const mA = freshMessenger();
    const aId = await mA.ensureIdentity("Aldo");

    useSqliteDevice("devB");
    setTestSecureBackend(createMemorySecureBackend());
    const mB = freshMessenger();
    await mB.ensureIdentity("Beto");
    const aSign = generateSigningKeypair();
    await mB.pairWith(encodePairingPayload("Aldo", fromHex(aId.pkHex), aSign.publicKey));

    // B no hizo re-pair: su contacto sigue siendo la pk vieja, viva y sin
    // supersesión inventada.
    const bView = await findContactByPk(aId.pkHex);
    expect(bView).not.toBeNull();
    expect(bView?.supersededBy).toBeNull();
    expect(await getLiveSuccessorPk(aId.pkHex)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 12. Q12 exacto: carrera F-1 mid-flight con SQL real.
// ---------------------------------------------------------------------------
describe("UNIT B-12 (Q12): re-pair mid-flight no resucita un envío perdido", () => {
  it("markOutboundSent pierde contra el fail del re-pair: la BD decide, no el JS", async () => {
    const m = freshMessenger();
    const { pkHex: oldPk } = await pairedPeer(m, "Beto");
    const sent = await m.sendChat("Beto", "hola");
    // El frame ya salió al transporte (in-flight); ANTES de que el ACK
    // path llame a markOutboundSent, el re-pair commitea y falla la fila.
    const newPk = toHex(generateIdentity().publicKey);
    await commitRepair({ oldPkHexes: [oldPk], newPkHex: newPk, name: "Beto" });
    // El perdedor in-flight llama tarde: la guarda SQL lo rechaza.
    const won = await markOutboundSent(sent.id);
    expect(won).toBe(false);
    const row = await getOutboundMessage(sent.id);
    expect(row?.status).toBe("failed");
    expect(row?.identityChangeCause).toBe("peer_superseded");
  });

  it("control: sin re-pair, markOutboundSent gana (queued→sent)", async () => {
    const m = freshMessenger();
    await pairedPeer(m, "Beto");
    const sent = await m.sendChat("Beto", "hola");
    expect(await markOutboundSent(sent.id)).toBe(true);
    expect((await getOutboundMessage(sent.id))?.status).toBe("sent");
  });

  it("el gate SQL de resetOutboundForRetry rechaza peer_superseded aunque el JS lo intente", async () => {
    const m = freshMessenger();
    const { pkHex: oldPk } = await pairedPeer(m, "Beto");
    const sent = await m.sendChat("Beto", "hola");
    const newPk = toHex(generateIdentity().publicKey);
    await commitRepair({ oldPkHexes: [oldPk], newPkHex: newPk, name: "Beto" });
    // Intento directo al gate SQL (sin pasar por el dispatch causa-aware).
    expect(await resetOutboundForRetry(sent.id)).toBe(false);
    const row = await getOutboundMessage(sent.id);
    expect(row?.status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// 13. R1: visibilidad live-only del agente — ningún handler del agente usa
// listAllContacts (solo auditoría). Test estructural: si un flujo
// send/resolve del agente la llamara, una identidad superseded podría
// resolverse por construcción.
// ---------------------------------------------------------------------------
describe("UNIT B-13 (R1): el agente nunca ve identidades superseded", () => {
  it("ningún handler de src/agent ni src/ui referencia listAllContacts", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const roots = ["src/agent", "src/ui"];
    const offenders: string[] = [];
    async function walk(dir: string): Promise<void> {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
          await walk(p);
        } else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) {
          const src = await readFile(p, "utf8");
          if (/\blistAllContacts\b/.test(src)) offenders.push(p);
        }
      }
    }
    for (const r of roots) await walk(r);
    expect(offenders).toEqual([]);
  });

  it("nido_send_message resuelve solo por el path live-only (store-level)", async () => {
    // resolveContactByName es el único resolvedor del agente; es live-only
    // por construcción (la prueba B-5 lo cubre: superseded → not_found).
    const m = freshMessenger();
    const { pkHex: oldPk } = await pairedPeer(m, "Beto");
    const id = generateIdentity();
    const sign = generateSigningKeypair();
    const newPk = toHex(id.publicKey);
    await m.pairWith(encodePairingPayload("Beto", id.publicKey, sign.publicKey), {
      disambiguation: "replace",
    });
    void oldPk;
    const r = await resolveContactByName("beto");
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.contact.pkHex).toBe(newPk);
  });
});

// ---------------------------------------------------------------------------
// 12b. Q12 EXACTO — plan §10 Q12 del red-team, ejecutado de verdad:
// carrera F-1 mid-flight con re-pair, sobre SQL real en dos dispositivos.
// ---------------------------------------------------------------------------
describe("UNIT B-12exact (Q12): re-pair mid-flight, plan exacto del red-team", () => {
  const backendA = createMemorySecureBackend();
  const backendB = createMemorySecureBackend();
  type Ctx = <T>(fn: () => Promise<T>) => Promise<T>;
  const asA: Ctx = async (fn) => {
    setTestSecureBackend(backendA);
    useSqliteDevice("q12a");
    return fn();
  };
  const asB: Ctx = async (fn) => {
    setTestSecureBackend(backendB);
    useSqliteDevice("q12b");
    return fn();
  };

  function makeGatedTransport() {
    const outbox: Uint8Array[] = [];
    const waiters: Array<() => void> = [];
    let parkNext = false;
    const tornDown: string[] = [];
    const transport: P2PTransport = {
      name: "gated",
      available: true,
      startDiscovery: async () => {},
      stopDiscovery: async () => {},
      connect: async () => {
        throw new Error("no");
      },
      sendFrame: async (_pk: string, frame: Uint8Array) => {
        if (parkNext) {
          parkNext = false;
          await new Promise<void>((res) => waiters.push(res));
        }
        outbox.push(frame);
      },
      disconnect: async () => {},
      teardownRouteForPeer: async (pk: string) => {
        tornDown.push(pk.toLowerCase());
      },
    };
    return {
      outbox,
      tornDown,
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

  async function waitParked(tx: ReturnType<typeof makeGatedTransport>, count = 1): Promise<void> {
    for (let i = 0; i < 400 && tx.parked() < count; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    if (tx.parked() < count) throw new Error("sendFrame nunca se aparcó");
  }

  it("pasos 1-7: commit mid-flight, ACK tardío, retry rechazado, resend, boot", async () => {
    resetSqliteBridge();
    const txA = makeGatedTransport();
    const txB = makeGatedTransport();
    const alice = await asA(async () => {
      const m = new NidoMessenger(txA.transport);
      await m.ensureIdentity("Alice");
      return m;
    });
    const bob = await asB(async () => {
      const m = new NidoMessenger(txB.transport);
      await m.ensureIdentity("Bob");
      return m;
    });
    const alicePk = await asA(async () => toHex((await getIdentity())!.publicKey));
    const bobPk = await asB(async () => toHex((await getIdentity())!.publicKey));
    // Pairing mutuo por el path real.
    const aSign = await asA(() => getSigningKeypair());
    const bSign = await asB(() => getSigningKeypair());
    await asA(() => alice.pairWith(encodePairingPayload("Beto", fromHex(bobPk), bSign.publicKey)));
    await asB(() => bob.pairWith(encodePairingPayload("Alice", fromHex(alicePk), aSign.publicKey)));
    // Handshake real A↔B (sesión viva en ambos).
    const aEph = alice.newHandshakeEphemeral();
    const bEph = bob.newHandshakeEphemeral();
    const aNonce = randomNonce(HANDSHAKE_NONCE_BYTES);
    const bNonce = randomNonce(HANDSHAKE_NONCE_BYTES);
    await asA(() => alice.completeHandshake(bobPk, aEph.secretKey, bEph.publicKey, aNonce, bNonce));
    await asB(() => bob.completeHandshake(alicePk, bEph.secretKey, aEph.publicKey, bNonce, aNonce));
    const [confirmA] = txA.outbox.splice(0);
    const [confirmB] = txB.outbox.splice(0);
    await asB(() => bob.handleFrame(alicePk, confirmA));
    await asA(() => alice.handleFrame(bobPk, confirmB));

    // PASO 1: sendChat con sendFrame aparcado (in-flight).
    txA.park();
    const p = asA(() => alice.sendChat("Beto", "hola q12"));
    await waitParked(txA);

    // PASO 2: mid-flight, la txn atómica del re-pair commitea. A nivel
    // store (commitRepair directo): las sesiones del messenger siguen
    // vivas = ventana commit→teardown del Q1 caso 2.
    const bobNew = generateIdentity();
    const bobNewPk = toHex(bobNew.publicKey);
    await asA(() =>
      commitRepair({ oldPkHexes: [bobPk], newPkHex: bobNewPk, name: "Beto" }),
    );

    // PASO 3: se libera el sendFrame aparcado → markOutboundSent pierde.
    const sent = await asA(async () => {
      txA.release();
      return p;
    });
    expect(sent.queued).toBe(true); // attemptOutboundSend devolvió false
    const m1 = sent.id;
    const row3 = await asA(() => getOutboundMessage(m1));
    expect(row3?.status).toBe("failed");
    expect(row3?.failureReason).toBe("identity_changed");
    expect(row3?.identityChangeCause).toBe("peer_superseded");
    // Sin timer de ACK: el timer solo se arma si markOutboundSent gana.

    // PASO 4: el frame sí llegó a Bob (bytes al OS) y Bob emite un
    // delivery_ack VÁLIDO bajo la sesión vieja aún viva.
    const [chatFrame] = txA.outbox.splice(0);
    expect(chatFrame).toBeDefined();
    await asB(() => bob.handleFrame(alicePk, chatFrame));
    const [ackFrame] = txB.outbox.splice(0);
    expect(ackFrame).toBeDefined();
    // Gate JS: processDeliveryAck muere sin tocar la fila.
    await asA(() => alice.handleFrame(bobPk, ackFrame));
    // Gate SQL: markOutboundDelivered rechaza failed/peer_superseded.
    expect(await asA(() => markOutboundDelivered(m1))).toBe(false);
    const row4 = await asA(() => getOutboundMessage(m1));
    expect(row4?.status).toBe("failed");
    expect(row4?.identityChangeCause).toBe("peer_superseded");

    // PASO 5: retry → rechazo tipado; ningún fresh row hacia la pk muerta
    // (el despacho por causa va ANTES del path beyond-horizon).
    const r5 = await asA(() => alice.retryOutboundMessage(m1));
    expect(r5).toEqual({ refused: "peer_superseded", supersededBy: bobNewPk });

    // Sesión con la identidad NUEVA (para que el resend llegue a 'sent').
    const ephA2 = alice.newHandshakeEphemeral();
    const ephB2 = generateEphemeral();
    const nA2 = randomNonce(HANDSHAKE_NONCE_BYTES);
    const nB2 = randomNonce(HANDSHAKE_NONCE_BYTES);
    await asA(() => alice.completeHandshake(bobNewPk, ephA2.secretKey, ephB2.publicKey, nA2, nB2));
    const sessB2 = P2PSession.fromHandshakeV2(ephB2.secretKey, ephA2.publicKey, alicePk, nB2, nA2);
    sessB2.expectRecipient(bobNewPk);
    sessB2.setSessionTag(deriveAckSessionTag(bobNewPk, alicePk, nB2, nA2));
    const confirmB2 = sessB2.pack(
      makeEnvelope("session_confirm", randomUUID(), fromHex(bobNewPk), alicePk, {}),
    );
    await asA(() => alice.handleFrame(bobNewPk, confirmB2));

    // PASO 6: resend explícito → fila NUEVA con message_id fresco al
    // sucesor vivo; la vieja intacta.
    const r6 = await asA(() => alice.resendToSupersedingIdentity(m1));
    expect(r6).not.toHaveProperty("refused");
    const m2 = (r6 as { id: string }).id;
    expect(m2).not.toBe(m1);
    const rowM2 = await asA(() => getOutboundMessage(m2));
    expect(rowM2?.peerPk).toBe(bobNewPk);
    expect(rowM2?.status).toBe("sent");
    const rowM1 = await asA(() => getOutboundMessage(m1));
    expect(rowM1?.status).toBe("failed");
    expect(rowM1?.identityChangeCause).toBe("peer_superseded");

    // PASO 7: boot repair con M presente → intacta (tiene fila de contacto
    // superseded: no es huérfana).
    const sweep = await asA(() => runP2PBootRepair());
    expect(sweep.orphansFailed).toBe(0);
    const row7 = await asA(() => getOutboundMessage(m1));
    expect(row7?.status).toBe("failed");
    expect(row7?.identityChangeCause).toBe("peer_superseded");
  });
});

// ---------------------------------------------------------------------------
// Q10 (red-team §10): concurrent-writer — un saveMessage para la pk vieja
// que compite con la txn del re-pair. La fila o aterriza antes (y el txn la
// falla) o después (y el boot repair la falla como peer_superseded).
// Nunca queda 'queued' varada contra una pk muerta.
// ---------------------------------------------------------------------------
describe("UNIT B-Q10race (concurrent-writer): saveMessage vs re-pair txn", () => {
  const backendA = createMemorySecureBackend();
  const backendB = createMemorySecureBackend();
  const asA = async <T,>(fn: () => Promise<T>): Promise<T> => {
    setTestSecureBackend(backendA);
    useSqliteDevice("q10a");
    return fn();
  };
  const asB = async <T,>(fn: () => Promise<T>): Promise<T> => {
    setTestSecureBackend(backendB);
    useSqliteDevice("q10b");
    return fn();
  };

  it("save antes del txn → el txn la falla; save después → boot la falla; nunca varada", async () => {
    resetSqliteBridge();
    const alice = await asA(async () => {
      const m = new NidoMessenger(new LoopbackTransport());
      await m.ensureIdentity("Alice");
      return m;
    });
    const bobPk = toHex(generateIdentity().publicKey);
    const bSign = generateSigningKeypair();
    await asA(() => alice.pairWith(encodePairingPayload("Beto", fromHex(bobPk), bSign.publicKey)));

    // CASO A: la fila aterriza ANTES del commit → el txn la falla.
    const idA = `q10-a-${randomUUID()}`;
    await asA(() =>
      saveMessage({
        id: idA,
        dir: "out",
        type: "chat",
        peerPk: bobPk,
        text: "antes",
        status: "queued",
        ts: Date.now(),
      }),
    );
    const bobNewA = toHex(generateIdentity().publicKey);
    await asA(() => commitRepair({ oldPkHexes: [bobPk], newPkHex: bobNewA, name: "Beto" }));
    // pairWith borra el intent post-commit; el boot ya no puede apoyarse en él.
    await asA(() => clearRepairIntent(bobPk));
    const rowA = await asA(() => getOutboundMessage(idA));
    expect(rowA?.status).toBe("failed");
    expect(rowA?.identityChangeCause).toBe("peer_superseded");

    // CASO B: la fila aterriza DESPUÉS del commit (la carrera del Q10) →
    // queda 'queued' contra la pk muerta; el boot repair la reconcilia
    // como peer_superseded (la causa es conocible: la fila de contacto
    // registra superseded_by). Nunca varada.
    const idB = `q10-b-${randomUUID()}`;
    await asA(() =>
      saveMessage({
        id: idB,
        dir: "out",
        type: "chat",
        peerPk: bobPk,
        text: "despues",
        status: "queued",
        ts: Date.now(),
      }),
    );
    const stranded = await asA(() => getOutboundMessage(idB));
    expect(stranded?.status).toBe("queued"); // la carrera sí la deja varada…
    const sweep = await asA(() => runP2PBootRepair());
    const rowB = await asA(() => getOutboundMessage(idB));
    expect(rowB?.status).toBe("failed"); // …pero el boot la reconcilia
    expect(rowB?.identityChangeCause).toBe("peer_superseded");
    expect(sweep.orphansFailed).toBe(0); // no es huérfana: es peer_superseded
    const log = await asA(() => getBootRepairLog(5));
    expect(log.some((e) => e.detail.includes("superseded-destination sweep"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Q13 (red-team §10): destroy() mid-transaction. destroy solo toca estado en
// memoria; las txn SQL son atómicas y no se ven afectadas. Un sendFrame
// aparcado que se libera DESPUÉS del destroy no marca nada (assertLive
// post-await): la fila queda 'queued', fail-closed, sin timer huérfano.
// ---------------------------------------------------------------------------
describe("UNIT B-Q13 (destroy mid-flight): la instancia muerta no marca nada", () => {
  const backend = createMemorySecureBackend();
  const as = async <T,>(fn: () => Promise<T>): Promise<T> => {
    setTestSecureBackend(backend);
    useSqliteDevice("q13");
    return fn();
  };

  it("destroy durante sendFrame aparcado → sin markOutboundSent, sin timer", async () => {
    resetSqliteBridge();
    const outbox: Uint8Array[] = [];
    const waiters: Array<() => void> = [];
    let parkNext = false;
    const transport: P2PTransport = {
      name: "gated13",
      available: true,
      startDiscovery: async () => {},
      stopDiscovery: async () => {},
      connect: async () => {
        throw new Error("no");
      },
      sendFrame: async (_pk: string, frame: Uint8Array) => {
        if (parkNext) {
          parkNext = false;
          await new Promise<void>((res) => waiters.push(res));
        }
        outbox.push(frame);
      },
      disconnect: async () => {},
      teardownRouteForPeer: async () => {},
    };
    const m = await as(async () => {
      const mm = new NidoMessenger(transport);
      await mm.ensureIdentity("Alice");
      return mm;
    });
    const bobPk = toHex(generateIdentity().publicKey);
    const bSign = generateSigningKeypair();
    await as(() => m.pairWith(encodePairingPayload("Beto", fromHex(bobPk), bSign.publicKey)));
    // Sesión viva para que el send intente el transporte.
    const ephA = m.newHandshakeEphemeral();
    const ephB = generateEphemeral();
    const nA = randomNonce(HANDSHAKE_NONCE_BYTES);
    const nB = randomNonce(HANDSHAKE_NONCE_BYTES);
    await as(() => m.completeHandshake(bobPk, ephA.secretKey, ephB.publicKey, nA, nB));
    const myPk = await as(async () => toHex((await getIdentity())!.publicKey));
    const sessB = P2PSession.fromHandshakeV2(ephB.secretKey, ephA.publicKey, myPk, nB, nA);
    sessB.expectRecipient(bobPk);
    sessB.setSessionTag(deriveAckSessionTag(bobPk, myPk, nB, nA));
    await as(() =>
      m.handleFrame(bobPk, sessB.pack(makeEnvelope("session_confirm", randomUUID(), fromHex(bobPk), myPk, {}))),
    );

    parkNext = true;
    const p = as(() => m.sendChat("Beto", "q13"));
    for (let i = 0; i < 400 && waiters.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(waiters.length).toBe(1);
    // destroy() a mitad del vuelo.
    await as(() => m.destroy());
    // Se libera el transporte; la instancia muerta no marca nada: el
    // assertLive post-await falla cerrado (lanza) en lugar de transicionar.
    waiters.shift()!();
    await expect(p).rejects.toThrow(/invalidado por Clear All Data/);
    const outboxRows = await as(() => getOutbox());
    expect(outboxRows).toHaveLength(1);
    const sent = { id: outboxRows[0].id, queued: true };
    const row = await as(() => getOutboundMessage(sent.id));
    expect(row?.status).toBe("queued"); // nunca 'sent' desde una instancia muerta
    // Y la SQL sigue operativa para otras instancias (la txn no se corrompió).
    expect(await as(() => getLiveSuccessorPk(bobPk))).toBeNull();
  });
});
