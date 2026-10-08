/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * p2pMemoryMock.ts — mock COMPARTIDO de la base SQLite para los tests P2P.
 *
 * SOLO TESTS. Replica la semántica INSERT/SELECT/UPDATE/DELETE que
 * `p2p/store.ts` espera de expo-sqlite, incluyendo las tablas N6
 * (`delivery_ack_log`, `n6_late_ack_audit`) y las columnas del outbox
 * (`ack_attempts`, `failure_reason`). Un solo lugar donde mantener la
 * fidelidad del mock cuando el store gane SQL nuevo.
 *
 * Uso:
 *   const mem = vi.hoisted(() => makeP2PMem());
 *   vi.mock("../agent/memory/memoryStore", () => p2pMemoryStoreModule(mem));
 *   beforeEach(() => { resetP2PMem(mem); ... });
 */
export interface P2PMemMessage {
  id: string;
  dir: string;
  peer_pk: string;
  type: string;
  text: string;
  status: string;
  ts: number;
  ack_attempts?: number;
  failure_reason?: string | null;
  /** UNIT B: causa interna de failure_reason='identity_changed'. */
  identity_change_cause?: string | null;
}

export interface P2PMemIdentity {
  pk_hex: string;
  sk_hex: string;
  name: string;
  /** F-2: spk Ed25519 de NUESTRA identidad (null = aún no generada). */
  sign_pk_hex: string | null;
}

export interface P2PMem {
  identity: P2PMemIdentity[];
  contacts: Array<{
    pk_hex: string;
    name: string;
    verified: number;
    sig_pk: string | null;
    /** UNIT B: pk que retiró esta identidad (null = viva). */
    superseded_by: string | null;
    /** UNIT B: epoch ms del commit de re-pair. */
    superseded_at: number | null;
  }>;
  messages: P2PMemMessage[];
  ackLog: Array<{ message_id: string; session_tag: string; persisted_at: number; acked_at: number }>;
  lateAck: Array<{ message_id: string; session_tag: string; received_at: number }>;
  nonceCache: Array<{ pk_lower: string; nonce_hex: string; seen_at: number }>;
  /** F-2: identidades archivadas tras recovery honesto (nunca destruidas). */
  identityArchive: Array<{
    pk_hex: string;
    name: string;
    sign_pk_hex: string | null;
    lost_at: number;
    reason: string;
  }>;
  /** UNIT B: journal idempotente de intents de re-pair (crash-recovery). */
  repairIntents: Array<{ old_pk: string; new_pk: string; created_at: number }>;
  /** UNIT B: traza del boot repair. */
  bootRepairLog: Array<{ at: number; detail: string }>;
}

export function makeP2PMem(): P2PMem {
  return {
    identity: [], contacts: [], messages: [], ackLog: [], lateAck: [],
    nonceCache: [], identityArchive: [], repairIntents: [], bootRepairLog: [],
  };
}

export function resetP2PMem(mem: P2PMem): void {
  mem.identity = [];
  mem.contacts = [];
  mem.messages = [];
  mem.ackLog = [];
  mem.lateAck = [];
  mem.nonceCache = [];
  mem.identityArchive = [];
  mem.repairIntents = [];
  mem.bootRepairLog = [];
}

const ok = (changes: number) => ({ lastInsertRowId: 0, changes });

export function makeP2PMemoryDb(mem: P2PMem) {
  return {
    execAsync: async (_sql: string) => undefined,
    getFirstAsync: async (sql: string, params: any[] = []) => {
      if (sql.includes("FROM p2p_identity")) return mem.identity[0] ?? null;
      if (sql.includes("SELECT 1 AS one FROM p2p_messages")) {
        return mem.messages.some((m) => m.id === params[0]) ? { one: 1 } : null;
      }
      if (sql.includes("FROM delivery_ack_log")) {
        return mem.ackLog.find((a) => a.message_id === params[0]) ?? null;
      }
      if (sql.includes("FROM n6_late_ack_audit")) {
        return mem.lateAck.find((a) => a.message_id === params[0]) ?? null;
      }
      if (sql.includes("FROM p2p_messages") && sql.includes("dir = 'out'")) {
        const m = mem.messages.find((x) => x.id === params[0] && x.dir === "out");
        return m
          ? {
              id: m.id,
              dir: "out",
              peer_pk: m.peer_pk,
              type: m.type,
              text: m.text,
              status: m.status,
              ts: m.ts,
              ack_attempts: m.ack_attempts ?? 0,
              failure_reason: m.failure_reason ?? null,
              identity_change_cause: m.identity_change_cause ?? null,
            }
          : null;
      }
      if (sql.includes("FROM p2p_contacts") && sql.includes("pk_hex =")) {
        // UNIT B: findContactByPk lleva "AND superseded_by IS NULL" (solo
        // vivos); findContactRowAny no (lee cualquier fila).
        const liveOnly = sql.includes("superseded_by IS NULL");
        return (
          mem.contacts.find((c) => c.pk_hex === params[0] && (!liveOnly || c.superseded_by === null)) ?? null
        );
      }
      if (sql.includes("FROM p2p_messages")) {
        return mem.messages.find((m) => m.id === params[0]) ?? null;
      }
      return null;
    },
    getAllAsync: async (sql: string, params: any[] = []) => {
      if (sql.includes("FROM p2p_messages")) {
        if (sql.includes("dir='out'") && sql.includes("status='sent'")) {
          return mem.messages
            .filter((m) => m.dir === "out" && m.status === "sent")
            .sort((a, b) => a.ts - b.ts);
        }
        if (sql.includes("dir='out'")) {
          return mem.messages
            .filter((m) => m.dir === "out" && m.status === "queued")
            .sort((a, b) => a.ts - b.ts);
        }
        if (sql.includes("type='agent_task'")) {
          return mem.messages
            .filter((m) => m.dir === "in" && m.type === "agent_task" && m.status === "queued")
            .sort((a, b) => a.ts - b.ts);
        }
        if (sql.includes("dir='in'")) {
          return mem.messages
            .filter((m) => m.dir === "in" && m.status !== "read")
            .sort((a, b) => b.ts - a.ts);
        }
        // Genérico (store.test.ts): filtro por peer y límite opcionales.
        const rows = mem.messages
          .filter((m) => !params.length || m.peer_pk === params[0])
          .sort((a, b) => a.ts - b.ts);
        const limit = params[1] ?? rows.length;
        return rows.slice(0, limit);
      }
      if (sql.includes("FROM p2p_contacts")) {
        if (sql.includes("LIKE")) {
          const norm = String(params[1] ?? params[0] ?? "")
            .replace(/%/g, "")
            .toLowerCase()
            .normalize("NFC");
          return mem.contacts.filter(
            (c) =>
              c.superseded_by === null && c.name.toLowerCase().normalize("NFC").includes(norm),
          );
        }
        if (sql.includes("superseded_by IS NULL")) {
          // UNIT B: listContacts — solo identidades vivas.
          return mem.contacts.filter((c) => c.superseded_by === null);
        }
        return [...mem.contacts];
      }
      if (sql.includes("FROM p2p_repair_intent")) {
        // UNIT B: journal de intents (listRepairIntents / commitRepair).
        return mem.repairIntents.map((r) => ({
          old_pk: r.old_pk,
          new_pk: r.new_pk,
          created_at: r.created_at,
        }));
      }
      if (sql.includes("FROM p2p_boot_repair_log")) {
        // UNIT B: traza del boot repair.
        const limit = params[0] ?? mem.bootRepairLog.length;
        return mem.bootRepairLog
          .slice()
          .sort((a, b) => b.at - a.at)
          .slice(0, limit)
          .map((r) => ({ at: r.at, detail: r.detail }));
      }
      if (sql.includes("FROM p2p_messages") && sql.includes("NOT IN")) {
        // UNIT B: barrido de huérfanos del boot repair — filas out
        // pre-terminales cuyo peer ya no tiene contacto (vivo o no).
        const known = new Set(mem.contacts.map((c) => c.pk_hex.toLowerCase()));
        return mem.messages
          .filter(
            (m) =>
              m.dir === "out" &&
              (m.status === "queued" || m.status === "sent") &&
              !known.has(m.peer_pk.toLowerCase()),
          )
          .map((m) => ({ id: m.id }));
      }
      return [];
    },
    runAsync: async (sql: string, params: any[] = []) => {
      if (sql.startsWith("DELETE FROM p2p_identity")) {
        mem.identity = [];
        return ok(1);
      }
      if (sql.includes("INSERT INTO p2p_identity")) {
        mem.identity = [{ pk_hex: params[0], sk_hex: params[1], name: params[2], sign_pk_hex: null }];
        return ok(1);
      }
      if (sql.includes("UPDATE p2p_identity SET sign_pk_hex")) {
        const [signPkHex, pkHex] = params as string[];
        const row = mem.identity.find((r) => r.pk_hex === pkHex);
        if (row) row.sign_pk_hex = signPkHex;
        return ok(row ? 1 : 0);
      }
      if (sql.includes("INTO p2p_identity_archive")) {
        const [pk_hex, name, sign_pk_hex, lost_at, reason] = params as Array<string | number | null>;
        if (!mem.identityArchive.some((r) => r.pk_hex === pk_hex)) {
          mem.identityArchive.push({
            pk_hex: pk_hex as string,
            name: name as string,
            sign_pk_hex: sign_pk_hex as string | null,
            lost_at: lost_at as number,
            reason: reason as string,
          });
        }
        return ok(1);
      }
      if (sql.includes("UPDATE p2p_identity SET sk_hex")) {
        if (mem.identity[0]) mem.identity[0].sk_hex = "";
        return ok(1);
      }
      if (sql.startsWith("DELETE FROM delivery_ack_log")) {
        const before = mem.ackLog.length;
        mem.ackLog = mem.ackLog.filter((a) => a.persisted_at >= params[0]);
        return ok(before - mem.ackLog.length);
      }
      if (sql.includes("INTO delivery_ack_log")) {
        const [message_id, session_tag, persisted_at, acked_at] = params as Array<string | number>;
        if (mem.ackLog.some((a) => a.message_id === message_id)) return ok(0);
        mem.ackLog.push({
          message_id: message_id as string,
          session_tag: session_tag as string,
          persisted_at: persisted_at as number,
          acked_at: acked_at as number,
        });
        return ok(1);
      }
      if (sql.includes("INTO n6_late_ack_audit")) {
        const [message_id, session_tag, received_at] = params as Array<string | number>;
        const ex = mem.lateAck.find((a) => a.message_id === message_id);
        if (ex) {
          ex.session_tag = session_tag as string;
          ex.received_at = received_at as number;
        } else {
          mem.lateAck.push({
            message_id: message_id as string,
            session_tag: session_tag as string,
            received_at: received_at as number,
          });
        }
        return ok(1);
      }
      if (sql.includes("INTO p2p_messages")) {
        const [id, dir, peer_pk, type, text, status, ts, ack_attempts, failure_reason] =
          params as Array<string | number | null | undefined>;
        if (mem.messages.some((m) => m.id === id)) return ok(0);
        mem.messages.push({
          id: id as string,
          dir: dir as string,
          peer_pk: peer_pk as string,
          type: type as string,
          text: text as string,
          status: status as string,
          ts: ts as number,
          ack_attempts: (ack_attempts as number) ?? 0,
          failure_reason: (failure_reason as string | null) ?? null,
        });
        return ok(1);
      }
      if (sql.startsWith("DELETE FROM hello_nonce_cache WHERE pk_lower")) {
        mem.nonceCache = mem.nonceCache.filter((r) => r.pk_lower !== params[0]);
        return ok(1);
      }
      if (sql.startsWith("DELETE FROM hello_nonce_cache WHERE seen_at")) {
        mem.nonceCache = mem.nonceCache.filter((r) => r.seen_at >= params[0]);
        return ok(1);
      }
      if (sql.startsWith("DELETE FROM hello_nonce_cache")) {
        mem.nonceCache = [];
        return ok(1);
      }
      if (sql.includes("INTO hello_nonce_cache")) {
        const [pk_lower, nonce_hex, seen_at] = params;
        if (mem.nonceCache.some((r) => r.pk_lower === pk_lower && r.nonce_hex === nonce_hex)) {
          throw new Error(
            "UNIQUE constraint failed: hello_nonce_cache.pk_lower, hello_nonce_cache.nonce_hex",
          );
        }
        mem.nonceCache.push({ pk_lower, nonce_hex, seen_at });
        return ok(1);
      }
      if (sql.includes("INTO p2p_contacts")) {
        const [pk, name, sig] = params as Array<string | null>;
        const existing = mem.contacts.find((c) => c.pk_hex === pk);
        if (existing) {
          existing.name = name as string;
          existing.sig_pk = sig ?? null;
          // UNIT B: re-pair con la misma pk la restaura (defensivo).
          existing.superseded_by = null;
          existing.superseded_at = null;
        } else {
          mem.contacts.push({
            pk_hex: pk as string,
            name: name as string,
            verified: 1,
            sig_pk: sig ?? null,
            superseded_by: null,
            superseded_at: null,
          });
        }
        return ok(1);
      }
      if (sql.includes("UPDATE p2p_contacts SET superseded_by=")) {
        // UNIT B: commitRepair retira una identidad vieja (solo si sigue viva).
        const [newPk, now, ...oldPks] = params as Array<string | number>;
        let n = 0;
        for (const oldPk of oldPks) {
          const c = mem.contacts.find((x) => x.pk_hex === oldPk && x.superseded_by === null);
          if (c) {
            c.superseded_by = newPk as string;
            c.superseded_at = now as number;
            n++;
          }
        }
        return ok(n);
      }
      if (sql.includes("INTO p2p_repair_intent")) {
        // UNIT B: journal idempotente (INSERT OR IGNORE).
        const [oldPk, newPk, createdAt] = params as Array<string | number>;
        if (mem.repairIntents.some((r) => r.old_pk === oldPk)) return ok(0);
        mem.repairIntents.push({ old_pk: oldPk as string, new_pk: newPk as string, created_at: createdAt as number });
        return ok(1);
      }
      if (sql.includes("DELETE FROM p2p_repair_intent")) {
        const before = mem.repairIntents.length;
        mem.repairIntents = mem.repairIntents.filter((r) => r.old_pk !== params[0]);
        return ok(before - mem.repairIntents.length);
      }
      if (sql.includes("INTO p2p_boot_repair_log")) {
        // UNIT B: traza del boot repair.
        const [at, detail] = params as Array<string | number>;
        mem.bootRepairLog.push({ at: at as number, detail: detail as string });
        return ok(1);
      }
      if (sql.includes("UPDATE p2p_contacts SET name")) {
        const [name, pk] = params as string[];
        const c = mem.contacts.find((x) => x.pk_hex === pk);
        if (c) c.name = name;
        return ok(c ? 1 : 0);
      }
      // --- UNIT B: transiciones con causa (antes que los handlers genéricos) ---
      if (sql.includes("identity_change_cause='peer_superseded'") && sql.includes("peer_pk IN")) {
        // commitRepair: retira el outbox pre-terminal hacia la identidad vieja.
        const [oldPk] = params as string[];
        const oldLower = oldPk.toLowerCase();
        let n = 0;
        for (const m of mem.messages) {
          if (
            m.dir === "out" &&
            m.peer_pk.toLowerCase() === oldLower &&
            (m.status === "queued" || m.status === "sent")
          ) {
            m.status = "failed";
            m.failure_reason = "identity_changed";
            m.identity_change_cause = "peer_superseded";
            n++;
          }
        }
        return ok(n);
      }
      if (sql.includes("identity_change_cause='peer_superseded'") && sql.includes("superseded_by IS NOT NULL")) {
        // UNIT B (§10 Q10): barrido de destinos superseded — filas que
        // aterrizaron después del commit contra una pk ya retirada.
        const dead = new Set(
          mem.contacts.filter((c) => c.superseded_by !== null).map((c) => c.pk_hex.toLowerCase()),
        );
        let n = 0;
        for (const m of mem.messages) {
          if (
            m.dir === "out" &&
            (m.status === "queued" || m.status === "sent") &&
            dead.has(m.peer_pk.toLowerCase())
          ) {
            m.status = "failed";
            m.failure_reason = "identity_changed";
            m.identity_change_cause = "peer_superseded";
            n++;
          }
        }
        return ok(n);
      }
      if (sql.includes("identity_change_cause='orphaned_destination'")) {
        // Boot repair: barrido de huérfanos (destino sin contacto).
        const known = new Set(mem.contacts.map((c) => c.pk_hex.toLowerCase()));
        let n = 0;
        for (const m of mem.messages) {
          if (
            m.dir === "out" &&
            (m.status === "queued" || m.status === "sent") &&
            !known.has(m.peer_pk.toLowerCase())
          ) {
            m.status = "failed";
            m.failure_reason = "identity_changed";
            m.identity_change_cause = "orphaned_destination";
            n++;
          }
        }
        return ok(n);
      }
      if (sql.includes("SET status='failed'") && sql.includes("peer_pk=?")) {
        const [reason, peerPk] = params as string[];
        // UNIT B: failPeerOutbox anota la causa peer_superseded.
        const cause = sql.includes("identity_change_cause='peer_superseded'") ? "peer_superseded" : undefined;
        let n = 0;
        for (const m of mem.messages) {
          if (m.dir === "out" && m.peer_pk === peerPk && (m.status === "queued" || m.status === "sent")) {
            m.status = "failed";
            m.failure_reason = reason;
            if (cause) m.identity_change_cause = cause;
            n++;
          }
        }
        return ok(n);
      }
      // --- N6: transiciones del outbox (antes que el UPDATE genérico) ---
      if (sql.includes("SET status='delivered'")) {
        const [id] = params as string[];
        const m = mem.messages.find((x) => x.id === id && x.dir === "out");
        const allowed =
          m &&
          (m.status === "queued" ||
            m.status === "sent" ||
            (m.status === "failed" && m.failure_reason === "timeout"));
        if (allowed && m) {
          m.status = "delivered";
          m.failure_reason = null;
          return ok(1);
        }
        return ok(0);
      }
      // F-2: failAllOutbox — un solo parámetro (reason), sin peer_pk ni id.
      // UNIT B: la causa es own_identity_recovered.
      if (sql.includes("SET status='failed'") && params.length === 1) {
        const [reason] = params as string[];
        let n = 0;
        for (const m of mem.messages) {
          if (m.dir === "out" && (m.status === "queued" || m.status === "sent")) {
            m.status = "failed";
            m.failure_reason = reason;
            m.identity_change_cause = "own_identity_recovered";
            n++;
          }
        }
        return ok(n);
      }
      if (sql.includes("SET status='failed'")) {
        const [reason, id] = params as string[];
        const m = mem.messages.find((x) => x.id === id && x.dir === "out" && x.status !== "delivered");
        if (m) {
          m.status = "failed";
          m.failure_reason = reason;
          return ok(1);
        }
        return ok(0);
      }
      if (sql.includes("SET ack_attempts = ack_attempts + 1")) {
        const [id] = params as string[];
        const m = mem.messages.find((x) => x.id === id && x.dir === "out");
        if (!m) return ok(0);
        m.ack_attempts = (m.ack_attempts ?? 0) + 1;
        return { lastInsertRowId: 0, changes: 1, ack_attempts: m.ack_attempts } as {
          lastInsertRowId: number;
          changes: number;
        };
      }
      if (sql.includes("SET status='queued', ack_attempts=0")) {
        // UNIT B: resetOutboundForRetry — el gate SQL rechaza filas
        // failed/identity_changed con causa peer_superseded/orphaned_destination.
        const [id] = params as string[];
        const m = mem.messages.find((x) => x.id === id && x.dir === "out" && x.status === "failed");
        if (m) {
          const blocked =
            m.failure_reason === "identity_changed" &&
            (m.identity_change_cause === "peer_superseded" ||
              m.identity_change_cause === "orphaned_destination");
          if (blocked) return ok(0);
          m.status = "queued";
          m.ack_attempts = 0;
          m.failure_reason = null;
          m.identity_change_cause = null;
          return ok(1);
        }
        return ok(0);
      }
      if (sql.includes("SET status='queued' WHERE")) {
        let n = 0;
        for (const m of mem.messages) {
          if (m.dir === "out" && m.status === "sent") {
            m.status = "queued";
            n++;
          }
        }
        return ok(n);
      }
      // F-1: transición GUARDADA →'sent' (solo desde estados pre-terminales).
      // Debe ir antes del UPDATE genérico de abajo: refleja fielmente el
      // WHERE status IN ('queued','sent') del SQL real.
      if (sql.includes("SET status='sent', failure_reason=NULL")) {
        const [id] = params as string[];
        const m = mem.messages.find(
          (x) => x.id === id && x.dir === "out" && (x.status === "queued" || x.status === "sent"),
        );
        if (m) {
          m.status = "sent";
          m.failure_reason = null;
          return ok(1);
        }
        return ok(0);
      }
      if (sql.startsWith("UPDATE p2p_messages SET status=")) {
        const [status, id] = params as string[];
        const m = mem.messages.find((x) => x.id === id);
        if (m) m.status = status;
        return ok(m ? 1 : 0);
      }
      return ok(0);
    },
  };
}

/**
 * Módulo mockeado para `vi.mock("../agent/memory/memoryStore", ...)`.
 * Semántica R6: epoch fijo y la "transacción" ejecuta el trabajo sobre la
 * db simulada de forma inmediata.
 */
export function p2pMemoryStoreModule(mem: P2PMem) {
  const db = makeP2PMemoryDb(mem);
  return {
    getMemoryDb: async () => db,
    getMemoryDbEpoch: () => 0,
    writeMemoryTransaction: async (work: (d: typeof db) => Promise<void>) => {
      await work(db);
    },
  };
}

// ---------------------------------------------------------------------------
// Memorias enrutadas (tests multi-dispositivo, p. ej. n6.test.ts).
//
// Cada NidoMessenger representa un DISPOSITIVO con su propia base SQLCipher.
// El mock de memoryStore es único por módulo, así que el test cambia la
// memoria activa con useP2PMem() antes de operar con cada messenger:
//   useP2PMem(memA); await alice.sendChat(...);
//   useP2PMem(memB); await bob.handleFrame(...);
// El Proxy reenvía cada acceso a la memoria activa EN EL MOMENTO DEL ACCESO
// (no se cachea), porque p2p/store.ts cachea el objeto db entre llamadas.
// ---------------------------------------------------------------------------
let activeMem: P2PMem | null = null;

/** Activa la memoria (dispositivo) que verá el mock a partir de ahora. */
export function useP2PMem(mem: P2PMem | null): void {
  activeMem = mem;
}

function currentMem(): P2PMem {
  if (!activeMem) throw new Error("p2pMemoryMock: llama useP2PMem(mem) antes de operar");
  return activeMem;
}

/** Variante enrutada de p2pMemoryStoreModule para tests multi-dispositivo. */
export function p2pMemoryStoreModuleRouted() {
  const proxy = new Proxy({} as P2PMem, {
    get: (_t, prop) => (currentMem() as unknown as Record<string | symbol, unknown>)[prop],
    set: (_t, prop, value) => {
      (currentMem() as unknown as Record<string | symbol, unknown>)[prop] = value;
      return true;
    },
  });
  const db = makeP2PMemoryDb(proxy);
  return {
    getMemoryDb: async () => db,
    getMemoryDbEpoch: () => 0,
    writeMemoryTransaction: async (work: (d: typeof db) => Promise<void>) => {
      await work(db);
    },
  };
}
