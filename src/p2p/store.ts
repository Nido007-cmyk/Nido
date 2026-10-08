/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * store.ts — NIDO P2P: persistencia (Fase E).
 *
 * Vive en la misma base cifrada que la memoria (`nido_memory.db`):
 * identidad, contactos emparejados y mensajes (bandeja de entrada/salida).
 */

import { getMemoryDb, getMemoryDbEpoch, writeMemoryTransaction } from "../agent/memory/memoryStore";
import {
  deleteP2PPrivateKey,
  deleteP2PSigningKey,
  loadP2PPrivateKey,
  loadP2PSigningKey,
  P2P_SIGN_SK_ALIAS,
  P2P_SK_ALIAS,
  storeP2PPrivateKey,
  storeP2PSigningKey,
} from "../privacy/keyManager";
import { fromHex, signingKeypairFromSeed, generateSigningKeypair, toHex, type KeyPair } from "./crypto";
import { normalizeContactName } from "./contactName";

/**
 * F-2 — Error tipado de pérdida de claves de identidad P2P.
 *
 * Invariante central: identidad P2P durable (fila `p2p_identity`) + CUALQUIER
 * secreto requerido del Keystore ausente = KEY_LOSS, NUNCA first-run.
 *
 * Se lanza cuando la fila de identidad existe pero falta `nido_p2p_sk`
 * (X25519) o `nido_p2p_sign_sk` (Ed25519, solo si la identidad llegó a
 * tener una registrada). Es detectable por `code` ("NIDO_P2P_IDENTITY_KEY_LOST")
 * y distinto del KeyLossError de N4 (pérdida de la DEK de la base).
 * Los bootstraps de identidad (getIdentity/ensureIdentity/getSigningKeypair)
 * lo propagan: NIDO falla cerrado y la UI muestra recovery honesto en vez
 * de generar silenciosamente una identidad nueva (fork silencioso).
 */
export class P2PIdentityKeyLossError extends Error {
  readonly code = "NIDO_P2P_IDENTITY_KEY_LOST";
  /** Alias del Keystore cuyo secreto falta (p. ej. "nido_p2p_sk"). */
  readonly alias: string;
  /** Identidad durable (pk_hex) cuyo secreto se perdió. */
  readonly pkHex: string;
  constructor(alias: string, pkHex: string, message: string) {
    super(message);
    this.name = "P2PIdentityKeyLossError";
    this.alias = alias;
    this.pkHex = pkHex;
  }
}

function p2pIdentityKeyLost(alias: string, pkHex: string): P2PIdentityKeyLossError {
  return new P2PIdentityKeyLossError(
    alias,
    pkHex,
    `P2P identity key lost: durable identity ${pkHex.slice(0, 16)}… exists ` +
      `but Keystore secret "${alias}" is missing. This is key loss, not a ` +
      `first run — refusing to silently generate a new identity.`,
  );
}

const P2P_DDL = `
CREATE TABLE IF NOT EXISTS p2p_identity (
  pk_hex TEXT PRIMARY KEY,
  sk_hex TEXT NOT NULL,
  name   TEXT NOT NULL DEFAULT 'Mi NIDO',
  sign_pk_hex TEXT,  -- F-2: spk Ed25519 de NUESTRA identidad (NULL = aún no generada)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS p2p_contacts (
  pk_hex   TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 1,
  sig_pk   TEXT,  -- clave pública de firma Ed25519 del contacto (QR v2); NULL = QR v1 (sin firma)
  -- UNIT B (F-6): ciclo de vida de identidad superseded. Una fila con
  -- superseded_by NOT NULL está MUERTA en todos los paths live
  -- (resolución, handshake, rutas, sesiones, outbox, retry): solo existe
  -- para auditoría. superseded_by = pk_hex de la identidad que la retiró.
  superseded_by TEXT,
  superseded_at INTEGER,  -- epoch ms del commit de re-pair
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS p2p_messages (
  id        TEXT PRIMARY KEY,
  dir       TEXT NOT NULL,  -- 'in' | 'out'
  peer_pk   TEXT NOT NULL,
  type      TEXT NOT NULL,  -- chat | agent_task | agent_result | receipt
  text      TEXT NOT NULL DEFAULT '',
  status    TEXT NOT NULL DEFAULT 'queued', -- queued | sent | delivered | failed (+ read para 'in')
  ts        INTEGER NOT NULL,
  -- UNIT B (F-5): causa interna de failure_reason='identity_changed'.
  -- NULL en cualquier otro caso. Solo la escriben las tres transiciones
  -- autoritativas: failPeerOutbox (peer_superseded), failAllOutbox
  -- (own_identity_recovered) y el boot-orphan sweep (orphaned_destination).
  -- 'orphaned_destination' NO afirma supersesión: la causa real se
  -- desconoce (migración honesta para filas legacy).
  identity_change_cause TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_p2p_messages_peer ON p2p_messages(peer_pk, ts);
-- R4: cache anti-replay persistente de nonces de HELLO. La PK compuesta
-- hace que check+insert sean UNA operación atómica: un conflicto UNIQUE
-- significa replay -> reject, nunca "insert falló pero continúa".
CREATE TABLE IF NOT EXISTS hello_nonce_cache(
  pk_lower  TEXT NOT NULL,
  nonce_hex TEXT NOT NULL,
  seen_at   INTEGER NOT NULL,
  PRIMARY KEY(pk_lower, nonce_hex)
);
CREATE INDEX IF NOT EXISTS idx_hnc_seen ON hello_nonce_cache(seen_at);
-- N6 §7: log de ACKs de entrega. Permite re-ACKear duplicados incluso
-- después de que la fila del inbox se borró (retención), sin reinsertar.
-- Retención puramente por edad (D12): NINGUNA entrada puede ser eliminada
-- mientras su id siga dentro del horizonte contractual
-- (DEDUP_RETENTION_DAYS) — el volumen jamás acorta el horizonte.
CREATE TABLE IF NOT EXISTS delivery_ack_log(
  message_id   TEXT PRIMARY KEY,  -- payload message_id (N6 §5.1, Tier 2)
  session_tag  TEXT NOT NULL,     -- tag de la sesión donde se persistió (AUDITORÍA: D11 prohíbe copiarlo a un envelope)
  persisted_at INTEGER NOT NULL,  -- epoch ms del commit de persistencia
  acked_at     INTEGER NOT NULL   -- epoch ms del primer ACK emitido
);
CREATE INDEX IF NOT EXISTS idx_dal_persisted ON delivery_ack_log(persisted_at);
-- N6 §4.5: auditoría de ACKs tardíos sobre mensajes cancelados por el
-- usuario. Se registra internamente; NUNCA cambia el estado visible.
CREATE TABLE IF NOT EXISTS n6_late_ack_audit(
  message_id  TEXT PRIMARY KEY,
  session_tag TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
-- UNIT B (R6): journal durable del commit de re-pair. El intent sobrevive a
-- un crash entre COMMIT y los efectos in-memory post-commit; el boot
-- repair lo reconcilia de forma idempotente. INSERT OR IGNORE: un doble
-- pairWith (doble tap / agent retry) no duplica intents ni rompe la
-- segunda transacción.
CREATE TABLE IF NOT EXISTS p2p_repair_intent(
  old_pk     TEXT PRIMARY KEY,  -- identidad retirada
  new_pk     TEXT NOT NULL,     -- identidad que la retiró
  created_at INTEGER NOT NULL
);
-- UNIT B: traza de auditoría del boot repair (journal + orphan sweep).
-- Solo se escribe cuando el sweep realmente cambió algo.
CREATE TABLE IF NOT EXISTS p2p_boot_repair_log(
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  at     INTEGER NOT NULL,
  detail TEXT NOT NULL
);
`;

/**
 * Epoch del ciclo de vida para el que ya corrió el DDL. Sin esto, el flag
 * "ya migrado" sobreviviría a Clear All Data y la base nueva quedaría sin
 * las tablas P2P (roto hasta reiniciar la app).
 */
let migratedEpoch = -1;

/**
 * DDL idempotente sobre un handle ya adquirido. Las ESCRITURAS lo llaman
 * dentro de su writeMemoryTransaction (guard de ciclo de vida): así, un
 * writer obsoleto tras Clear All Data falla ANTES de tocar la base y nunca
 * la reabre. Las lecturas usan migrate() (sin guard: solo leen).
 */
async function migrateOn(db: Awaited<ReturnType<typeof getMemoryDb>>): Promise<void> {
  // Se lee el epoch antes del DDL y se sella ese mismo valor después: si
  // Clear All Data se colara en medio, el sello no cubre el ciclo nuevo y
  // el próximo writer del ciclo nuevo repite el DDL sobre la base fresca.
  const epoch = getMemoryDbEpoch();
  if (migratedEpoch === epoch) return;
  await db.execAsync(P2P_DDL);
  // Migración v2 (handshake autenticado): añade sig_pk a bases ya creadas.
  // SQLite no tiene ADD COLUMN IF NOT EXISTS: se intenta y se ignora el
  // error "duplicate column name".
  try {
    await db.execAsync("ALTER TABLE p2p_contacts ADD COLUMN sig_pk TEXT");
  } catch (e) {
    if (!/duplicate column name/i.test(String((e as Error)?.message ?? e))) throw e;
  }
  // Migración N6: columnas de la máquina de estados de entrega en outbox.
  // ack_attempts: intentos de envío con espera de ACK (PROVISIONAL: el
  // presupuesto ACK_TIMEOUT_MS × ACK_MAX_ATTEMPTS lo decide el hardware).
  // failure_reason: 'timeout' | 'identity_changed' | 'user_cancelled'
  // (D7 — la UI conserva cuatro estados; la causa es interna).
  for (const col of ["ALTER TABLE p2p_messages ADD COLUMN ack_attempts INTEGER NOT NULL DEFAULT 0",
                     "ALTER TABLE p2p_messages ADD COLUMN failure_reason TEXT"]) {
    try {
      await db.execAsync(col);
    } catch (e) {
      if (!/duplicate column name/i.test(String((e as Error)?.message ?? e))) throw e;
    }
  }
  // Migración UNIT B (F-5/F-6): ciclo de vida de identidad superseded y
  // causa interna de identity_changed. Las tablas p2p_repair_intent y
  // p2p_boot_repair_log ya se crean en el DDL (CREATE TABLE IF NOT EXISTS).
  for (const col of ["ALTER TABLE p2p_contacts ADD COLUMN superseded_by TEXT",
                     "ALTER TABLE p2p_contacts ADD COLUMN superseded_at INTEGER",
                     "ALTER TABLE p2p_messages ADD COLUMN identity_change_cause TEXT"]) {
    try {
      await db.execAsync(col);
    } catch (e) {
      if (!/duplicate column name/i.test(String((e as Error)?.message ?? e))) throw e;
    }
  }
  // Backfill honesto (R3): las filas identity_changed anteriores a esta
  // lane tienen causa DESCONOCIDA — se etiquetan orphaned_destination,
  // nunca peer_superseded (afirmar supersesión sería inventar causalidad).
  await db.runAsync(
    "UPDATE p2p_messages SET identity_change_cause='orphaned_destination' " +
      "WHERE failure_reason='identity_changed' AND identity_change_cause IS NULL",
  );
  // Migración F-2: registra qué clave pública de firma Ed25519 pertenece a
  // nuestra identidad (se rellena al generar la clave de firma). Sin este
  // marcador no se podría distinguir "identidad antigua que nunca tuvo clave
  // de firma" (generar es legítimo) de "identidad que la tuvo y la perdió"
  // (KEY_LOSS). Además crea el archivo de identidades archivadas tras un
  // recovery honesto: los datos NO se destruyen, se conservan con traza.
  try {
    await db.execAsync("ALTER TABLE p2p_identity ADD COLUMN sign_pk_hex TEXT");
  } catch (e) {
    if (!/duplicate column name/i.test(String((e as Error)?.message ?? e))) throw e;
  }
  // Migración BUG-6 Plan B (2026-10-07): guarda la última MAC conocida por
  // contacto. Si getBondedDevices() sale vacía/stale, el barrido prueba estas
  // MACs primero sin depender del caché del BluetoothAdapter.
  try {
    await db.execAsync("ALTER TABLE p2p_contacts ADD COLUMN last_mac TEXT");
  } catch (e) {
    if (!/duplicate column name/i.test(String((e as Error)?.message ?? e))) throw e;
  }
  await db.execAsync(
    "CREATE TABLE IF NOT EXISTS p2p_identity_archive(" +
      "pk_hex TEXT PRIMARY KEY, name TEXT NOT NULL, sign_pk_hex TEXT, " +
      "lost_at INTEGER NOT NULL, reason TEXT NOT NULL)",
  );
  migratedEpoch = epoch;
}

/** DDL para lecturas: adquiere el handle del ciclo vigente y migra si hace falta. */
async function migrate(): Promise<void> {
  const db = await getMemoryDb();
  await migrateOn(db);
}

export interface P2PIdentity {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  name: string;
}

/**
 * Clave de firma Ed25519 de la identidad. Se genera de forma perezosa la
 * primera vez que se necesita (handshake v2) y vive en el Keystore.
 * Independiente de la clave de cifrado X25519: cada una para su propósito.
 *
 * M-2 (fail-closed): si la lectura del Keystore falla, loadP2PSigningKey()
 * lanza y esta función NO genera una clave nueva — generarla sobrescribiría
 * la real y los peers rechazarían los handshakes. Solo una ausencia genuina
 * (lectura exitosa → null) genera.
 *
 * F-2: "ausencia genuina" se califica contra la fila durable de identidad.
 * Si la identidad ya tenía una clave de firma registrada (sign_pk_hex) y el
 * Keystore no la devuelve, eso es pérdida de clave — se lanza
 * P2PIdentityKeyLossError en vez de generar una nueva en silencio (fork
 * silencioso: los peers conservan la spk antigua y rechazan handshakes).
 * Solo una identidad que NUNCA tuvo clave de firma registrada puede
 * generarla; al hacerlo, la spk pública queda registrada en la fila para
 * que futuras pérdidas sean detectables.
 */
export async function getSigningKeypair(): Promise<KeyPair> {
  const skHex = await loadP2PSigningKey();
  if (skHex) {
    return signingKeypairFromSeed(fromHex(skHex));
  }
  await migrate();
  const db = await getMemoryDb();
  const row = await db.getFirstAsync<{ pk_hex: string; sign_pk_hex: string | null }>(
    "SELECT pk_hex, sign_pk_hex FROM p2p_identity LIMIT 1",
  );
  if (row?.sign_pk_hex) {
    throw p2pIdentityKeyLost(P2P_SIGN_SK_ALIAS, row.pk_hex);
  }
  const kp = generateSigningKeypair();
  // Se guarda la semilla (32 B): basta para reconstruir el par completo.
  await storeP2PSigningKey(toHex(kp.secretKey.slice(0, 32)));
  if (row) {
    await db.runAsync("UPDATE p2p_identity SET sign_pk_hex = ? WHERE pk_hex = ?", [
      toHex(kp.publicKey),
      row.pk_hex,
    ]);
  }
  return kp;
}

/**
 * Devuelve la identidad del dispositivo, o null si aún no existe.
 *
 * La clave privada vive en el Android Keystore (vía SecureStore), nunca en
 * la base. Migración automática: si una fila antigua aún trae `sk_hex`,
 * se mueve al Keystore y la columna se vacía.
 *
 * M-2 (fail-closed): si la lectura del Keystore falla, loadP2PPrivateKey()
 * lanza y esta función propaga el error — NUNCA devuelve null ante un
 * fallo, porque ensureIdentity() interpretaría ese null como "no existe" y
 * generaría/sobrescribiría la identidad.
 *
 * F-2 (fail-closed, invariante central): si la fila durable existe pero el
 * secreto del Keystore falta (p. ej. Keystore invalidado por cambio
 * biométrico o "Clear credentials" con la base intacta), eso es KEY_LOSS,
 * no first-run. Se lanza P2PIdentityKeyLossError — NUNCA se devuelve null,
 * porque ensureIdentity() interpretaría ese null como "no existe" y
 * generaría en silencio una identidad nueva (fork silencioso: todos los
 * pares conservan las claves viejas, los handshakes fallan y el usuario
 * jamás se entera de que su identidad cambió). null solo significa
 * "nunca se creó ninguna identidad".
 */
export async function getIdentity(): Promise<P2PIdentity | null> {
  await migrate();
  const db = await getMemoryDb();
  const row = await db.getFirstAsync<{ pk_hex: string; sk_hex: string; name: string }>(
    "SELECT pk_hex, sk_hex, name FROM p2p_identity LIMIT 1",
  );
  if (!row) return null;
  let skHex = await loadP2PPrivateKey();
  if (!skHex && row.sk_hex) {
    // Migración desde base antigua: mueve la sk al Keystore y limpia la columna.
    // Se captura antes del UPDATE por si el driver devuelve la fila por referencia.
    // R6: ambas escrituras van bajo el guard de ciclo de vida: una lectura
    // obsoleta no puede recrear la clave privada tras Clear All Data.
    const legacySk = row.sk_hex;
    const pkHex = row.pk_hex;
    await writeMemoryTransaction(async (db) => {
      await migrateOn(db);
      await storeP2PPrivateKey(legacySk);
      await db.runAsync("UPDATE p2p_identity SET sk_hex = '' WHERE pk_hex = ?", [pkHex]);
    });
    skHex = legacySk;
  }
  if (!skHex) {
    // F-2: fila durable sin secreto = pérdida de clave, no first-run.
    throw p2pIdentityKeyLost(P2P_SK_ALIAS, row.pk_hex);
  }
  return { publicKey: fromHex(row.pk_hex), secretKey: fromHex(skHex), name: row.name };
}

/**
 * Guarda la identidad (una sola por dispositivo). La privada va al
 * Keystore; en la base solo queda la pública (columna sk_hex vacía).
 *
 * R6: por el ciclo de vida guardado de la base de memoria. La escritura en
 * el Keystore también va dentro del guard: una identidad obsoleta no puede
 * recrear la clave privada tras Clear All Data.
 */
export async function saveIdentity(publicKey: Uint8Array, secretKey: Uint8Array, name: string): Promise<void> {
  const pkHex = toHex(publicKey);
  const skHex = toHex(secretKey);
  const label = name.trim().slice(0, 40) || "Mi NIDO";
  await writeMemoryTransaction(async (db) => {
    await migrateOn(db);
    await storeP2PPrivateKey(skHex);
    await db.runAsync("DELETE FROM p2p_identity");
    await db.runAsync("INSERT INTO p2p_identity (pk_hex, sk_hex, name) VALUES (?, ?, ?)", [
      pkHex,
      "", // la privada nunca se guarda en la base
      label,
    ]);
  });
}

/** Borra la identidad del dispositivo (base + Keystore, cifrado y firma). R6: ver saveIdentity. */
export async function deleteIdentity(): Promise<void> {
  await writeMemoryTransaction(async (db) => {
    await migrateOn(db);
    await db.runAsync("DELETE FROM p2p_identity");
    // R4 §8.4: al rotar/eliminar nuestra identidad somos criptográficamente
    // un dispositivo nuevo; la cache anti-replay se vacía.
    await db.runAsync("DELETE FROM hello_nonce_cache");
    await deleteP2PPrivateKey();
    await deleteP2PSigningKey();
  });
}

/**
 * F-2 — Archivo de identidades P2P perdidas.
 *
 * Filosofía N4 ("los datos no fueron borrados"): la identidad vieja no se
 * destruye en silencio; queda archivada con traza (pk, nombre, spk, cuándo
 * y por qué) para que el usuario pueda explicar a sus contactos qué pasó.
 * Nunca se regenera nada en silencio desde aquí: esta función solo archiva
 * y limpia; la identidad nueva la crea el caller vía ensureIdentity() tras
 * la confirmación explícita del usuario.
 */
export interface P2PIdentityArchiveRecord {
  oldPkHex: string;
  oldName: string;
  oldSignPkHex: string | null;
  lostAt: number;
}

export async function archiveAndClearP2PIdentity(
  reason: string,
): Promise<P2PIdentityArchiveRecord | null> {
  let record: P2PIdentityArchiveRecord | null = null;
  await writeMemoryTransaction(async (db) => {
    await migrateOn(db);
    const row = await db.getFirstAsync<{ pk_hex: string; name: string; sign_pk_hex: string | null }>(
      "SELECT pk_hex, name, sign_pk_hex FROM p2p_identity LIMIT 1",
    );
    if (!row) return;
    record = {
      oldPkHex: row.pk_hex,
      oldName: row.name,
      oldSignPkHex: row.sign_pk_hex,
      lostAt: Date.now(),
    };
    await db.runAsync(
      "INSERT OR IGNORE INTO p2p_identity_archive(pk_hex, name, sign_pk_hex, lost_at, reason) VALUES (?, ?, ?, ?, ?)",
      [row.pk_hex, row.name, row.sign_pk_hex, record.lostAt, reason],
    );
    await db.runAsync("DELETE FROM p2p_identity");
    // R4 §8.4: identidad rotada = dispositivo criptográficamente nuevo.
    await db.runAsync("DELETE FROM hello_nonce_cache");
    await deleteP2PPrivateKey();
    await deleteP2PSigningKey();
  });
  return record;
}

/**
 * F-2 — Falla todo el outbox pendiente como identity_changed.
 *
 * Tras perder NUESTRA identidad, las filas 'queued'/'sent' se enviaron bajo
 * una identidad que ya no existe: los peers ya no nos reconocerán hasta
 * re-emparejar, y ningún ACK viejo puede validarse. Se falla honestamente
 * (reintentable por el usuario tras re-emparejar), nunca se deja colgado.
 *
 * UNIT B (F-5): la causa interna es SIEMPRE 'own_identity_recovered' — el
 * peer de la fila sigue siendo legítimo. Distinguible de 'peer_superseded'
 * a nivel estructural, no convencional: este es el único escritor de esta
 * causa.
 */
export async function failAllOutbox(reason: "identity_changed"): Promise<number> {
  let count = 0;
  await writeMemoryTransaction(async (db) => {
    await migrateOn(db);
    const res = await db.runAsync(
      "UPDATE p2p_messages SET status='failed', failure_reason=?, identity_change_cause='own_identity_recovered' " +
        "WHERE dir='out' AND status IN ('queued','sent')",
      [reason],
    );
    count = res?.changes ?? 0;
  });
  return count;
}

export interface P2PContact {
  pkHex: string;
  name: string;
  verified: boolean;
  /** Clave pública de firma Ed25519 (QR v2). null = contacto de QR v1, sin firma. */
  sigPkHex: string | null;
  /**
   * UNIT B (F-6): pk_hex de la identidad que retiró a este contacto.
   * null = contacto VIVO. Una fila con supersededBy !== null está muerta en
   * todos los paths live (solo existe para auditoría); listContacts() y
   * findContactByPk() nunca la devuelven.
   */
  supersededBy: string | null;
  /** UNIT B (F-6): epoch ms del commit de re-pair que lo retiró (null = vivo). */
  supersededAt: number | null;
}

/**
 * Añade o actualiza un contacto emparejado (verificado por QR).
 * `sigPkHex` es la clave de firma Ed25519 del contacto (QR v2); sin ella
 * el handshake v2 no puede autenticarse y falla cerrado.
 *
 * R6: por el ciclo de vida guardado de la base de memoria.
 */
export async function saveContact(pkHex: string, name: string, sigPkHex?: string | null): Promise<void> {
  const pk = toHex(fromHex(pkHex)); // valida y normaliza
  let sig: string | null = null;
  if (sigPkHex) {
    const raw = fromHex(sigPkHex);
    if (raw.length !== 32) throw new Error("Clave de firma del contacto inválida.");
    sig = toHex(raw);
  }
  const label = name.trim().slice(0, 40) || "Contacto NIDO";
  await writeMemoryTransaction(async (db) => {
    await migrateOn(db);
    await db.runAsync(
      "INSERT INTO p2p_contacts (pk_hex, name, verified, sig_pk) VALUES (?, ?, 1, ?) " +
        // UNIT B (§8 Q10): si la pk coincide con una fila superseded, la
        // ceremonia explícita la restaura ("la identidad volvió"): se
        // limpia el retiro. Solo un emparejamiento explícito llega aquí.
        "ON CONFLICT(pk_hex) DO UPDATE SET name=excluded.name, verified=1, sig_pk=excluded.sig_pk, " +
        "superseded_by=NULL, superseded_at=NULL",
      [pk, label, sig],
    );
    // R4 §8.4: al re-emparejar, las filas de nonces de esta pk arrancan
    // limpias (evita cualquier confusión entre identidades de re-pairing).
    await db.runAsync("DELETE FROM hello_nonce_cache WHERE pk_lower = ?", [pk.toLowerCase()]);
  });
}

/** Normaliza/valida la spk Ed25519 de un contacto (32 B) o null. */
function normalizeSigPk(sigPkHex?: string | null): string | null {
  if (!sigPkHex) return null;
  const raw = fromHex(sigPkHex);
  if (raw.length !== 32) throw new Error("Clave de firma del contacto inválida.");
  return toHex(raw);
}

/**
 * Elimina un contacto pareado por su pk. También limpia sus mensajes
 * (inbox/outbox/conversación) y nonces. Usado desde la UI para "desparear".
 */
export async function deleteContact(pkHex: string): Promise<void> {
  const pk = toHex(fromHex(pkHex)); // valida y normaliza
  await writeMemoryTransaction(async (db) => {
    await migrateOn(db);
    await db.runAsync("DELETE FROM p2p_contacts WHERE pk_hex = ?", [pk]);
    await db.runAsync("DELETE FROM p2p_messages WHERE peer_pk = ?", [pk]);
    await db.runAsync("DELETE FROM hello_nonce_cache WHERE pk_lower = ?", [pk.toLowerCase()]);
  });
}

export interface RepairCommit {
  /** Pks retiradas (conjunto confirmado por el usuario en la desambiguación; puede ser vacío). */
  oldPkHexes: string[];
  /** Pk nueva que retira a las anteriores. */
  newPkHex: string;
  /** Nombre visible del contacto nuevo. */
  name: string;
  /** Spk Ed25519 del contacto nuevo (QR v2); null = QR v1. */
  sigPkHex?: string | null;
  /** Epoch ms (tests); por defecto Date.now(). */
  nowMs?: number;
}

/**
 * UNIT B concurrency closure (2026-09-28): dos operaciones Replace
 * concurrentes sobre la MISMA pk vieja — solo una puede ganar.
 *
 * Se lanza cuando la transacción observa que la(s) identidad(es) vieja(s)
 * que pretendía reemplazar ya no está(n) viva(s): otro Replace ganó la
 * carrera. El SQL decide (filosofía F-1): el UPDATE de supersesión exige
 * `superseded_by IS NULL` sobre la pk vieja exacta, y si no afecta a
 * TODAS las pks esperadas la transacción aborta ANTES de escribir el
 * contacto nuevo, el outbox o el journal — cero efectos del perdedor
 * (rollback). No se resuelve por nombre, mutex JS, timing ni
 * last-writer-wins.
 */
export class StaleReplaceConflictError extends Error {
  readonly code = "NIDO_PAIR_STALE_REPLACE";
  readonly conflict = "old_identity_already_superseded" as const;
  /** Pks viejas que se pretendían reemplazar (normalizadas, minúsculas). */
  readonly oldPkHexes: string[];
  /** Quién ganó la carrera (superseded_by de la pk vieja), si se conoce. */
  readonly supersededBy: string | null;
  constructor(oldPkHexes: string[], supersededBy: string | null) {
    super(
      "Replace conflict: the identity you meant to replace was already " +
        "superseded by another pairing" +
        (supersededBy ? ` (now superseded by ${supersededBy.slice(0, 16)}…)` : "") +
        ". Nothing was written.",
    );
    this.name = "StaleReplaceConflictError";
    this.oldPkHexes = oldPkHexes;
    this.supersededBy = supersededBy;
  }
}

/**
 * UNIT B (§3.1): commit ATÓMICO de re-pair — la única escritura durable
 * del emparejamiento con supersesión. Una sola writeMemoryTransaction:
 *
 *  1. supersede de las pks viejas (solo filas aún vivas);
 *  2. upsert del contacto nuevo (si la pk coincide con una fila superseded,
 *     la restaura: "la identidad volvió", §8 Q10);
 *  3. fail del outbox pendiente de las pks viejas como
 *     failed(identity_changed/peer_superseded) — F-4/F-5;
 *  4. higiene de nonces para la pk nueva (R4 §8.4);
 *  5. journal del intent (idempotente: INSERT OR IGNORE — R6).
 *
 * Crash antes del COMMIT → rollback: el mundo viejo queda intacto y la
 * ceremonia puede repetirse. Crash después → el intent journalizado
 * sobrevive y el boot repair (§6) reconcilia. El caso F-4 (filas
 * stranded) se vuelve irrepresentable.
 *
 * Los efectos in-memory (timers, sesiones, teardown de ruta) los hace el
 * messenger DESPUÉS del commit, nunca dentro.
 */
export async function commitRepair(c: RepairCommit): Promise<{ superseded: string[] }> {
  const newPk = toHex(fromHex(c.newPkHex)).toLowerCase();
  const olds = [...new Set(c.oldPkHexes.map((p) => toHex(fromHex(p)).toLowerCase()))].filter(
    (p) => p !== newPk,
  );
  const sig = normalizeSigPk(c.sigPkHex);
  const label = c.name.trim().slice(0, 40) || "Contacto NIDO";
  const now = c.nowMs ?? Date.now();
  let superseded: string[] = [];
  await writeMemoryTransaction(async (db) => {
    await migrateOn(db);
    const placeholders = olds.map(() => "?").join(",");
    if (olds.length > 0) {
      // UNIT B concurrency closure: el SQL decide quién gana. El UPDATE
      // solo toca filas aún vivas; si no afecta a TODAS las pks esperadas,
      // otro Replace ganó la carrera (total o parcialmente) → abortamos
      // ANTES de escribir el contacto nuevo, el outbox o el journal.
      // Lanzar dentro del txn = rollback: cero efectos del perdedor.
      const res = await db.runAsync(
        "UPDATE p2p_contacts SET superseded_by=?, superseded_at=? " +
          `WHERE pk_hex IN (${placeholders}) AND superseded_by IS NULL`,
        [newPk, now, ...olds],
      );
      const changed = Number(res?.changes ?? 0);
      if (changed !== olds.length) {
        const winner = await db.getFirstAsync<{ superseded_by: string | null }>(
          "SELECT superseded_by FROM p2p_contacts WHERE pk_hex = ? LIMIT 1",
          [olds[0]],
        );
        throw new StaleReplaceConflictError(olds, winner?.superseded_by ?? null);
      }
    }
    await db.runAsync(
      "INSERT INTO p2p_contacts (pk_hex, name, verified, sig_pk) VALUES (?, ?, 1, ?) " +
        "ON CONFLICT(pk_hex) DO UPDATE SET name=excluded.name, verified=1, sig_pk=excluded.sig_pk, " +
        "superseded_by=NULL, superseded_at=NULL",
      [newPk, label, sig],
    );
    if (olds.length > 0) {
      await db.runAsync(
        "UPDATE p2p_messages SET status='failed', failure_reason='identity_changed', " +
          "identity_change_cause='peer_superseded' " +
          `WHERE dir='out' AND peer_pk IN (${placeholders}) AND status IN ('queued','sent')`,
        olds,
      );
    }
    await db.runAsync("DELETE FROM hello_nonce_cache WHERE pk_lower = ?", [newPk]);
    for (const old of olds) {
      // R6: idempotente — un doble pairWith no duplica intents ni rompe
      // la segunda transacción.
      await db.runAsync(
        "INSERT OR IGNORE INTO p2p_repair_intent(old_pk, new_pk, created_at) VALUES (?, ?, ?)",
        [old, newPk, now],
      );
    }
    if (olds.length > 0) {
      const rows = await db.getAllAsync<{ pk_hex: string }>(
        `SELECT pk_hex FROM p2p_contacts WHERE pk_hex IN (${placeholders}) AND superseded_by = ?`,
        [...olds, newPk],
      );
      superseded = rows.map((r) => r.pk_hex);
    }
  });
  return { superseded };
}

/**
 * UNIT B (§3.1): borra el intent journalizado tras los efectos in-memory
 * post-commit. Si el proceso muere antes, el boot repair lo reconcilia.
 */
export async function clearRepairIntent(oldPkHex: string): Promise<void> {
  let pk: string;
  try {
    pk = toHex(fromHex(oldPkHex)).toLowerCase();
  } catch {
    return;
  }
  await writeMemoryTransaction(async (db) => {
    await migrateOn(db);
    await db.runAsync("DELETE FROM p2p_repair_intent WHERE old_pk = ?", [pk]);
  });
}

/** UNIT B: intents journalizados pendientes (tests/auditoría). */
export async function listRepairIntents(): Promise<Array<{ oldPk: string; newPk: string; createdAt: number }>> {
  await migrate();
  const db = await getMemoryDb();
  const rows = await db.getAllAsync<{ old_pk: string; new_pk: string; created_at: number }>(
    "SELECT old_pk, new_pk, created_at FROM p2p_repair_intent ORDER BY created_at",
  );
  return rows.map((r) => ({ oldPk: r.old_pk, newPk: r.new_pk, createdAt: r.created_at }));
}

export interface BootRepairResult {
  /** Intents journalizados reconciliados (y borrados). */
  intentsReconciled: number;
  /** Filas huérfanas falladas como orphaned_destination. */
  orphansFailed: number;
}

/**
 * UNIT B (§6): boot repair — corre UNA vez al arrancar, ANTES de
 * recoverOutbox(). Una sola transacción:
 *
 *  1. Reconcilia intents journalizados: verifica el supersede y falla
 *     AHORA como peer_superseded cualquier fila queued/sent que hubiera
 *     quedado stranded para la pk vieja; borra el intent (idempotente).
 *  2. Orphan sweep: filas queued/sent cuyo peer_pk no tiene fila de
 *     contacto VIVA ni SUPERSEDED → failed(identity_changed/
 *     orphaned_destination). La causa real se desconoce: esta etiqueta no
 *     afirma supersesión (R3).
 *
 * Explícitamente prohibido: re-crear contactos, devolver filas a 'queued',
 * limpiar superseded_by, o tocar filas 'failed' (incluido user_cancelled).
 * recoverOutbox() corre después: las huérfanas ya están failed y no puede
 * revivirlas.
 */
export async function runP2PBootRepair(): Promise<BootRepairResult> {
  let intentsReconciled = 0;
  let orphansFailed = 0;
  await writeMemoryTransaction(async (db) => {
    await migrateOn(db);
    const intents = await db.getAllAsync<{ old_pk: string; new_pk: string }>(
      "SELECT old_pk, new_pk FROM p2p_repair_intent",
    );
    for (const intent of intents) {
      const res = await db.runAsync(
        "UPDATE p2p_messages SET status='failed', failure_reason='identity_changed', " +
          "identity_change_cause='peer_superseded' " +
          "WHERE dir='out' AND peer_pk = ? AND status IN ('queued','sent')",
        [intent.old_pk],
      );
      const stranded = res?.changes ?? 0;
      await db.runAsync("DELETE FROM p2p_repair_intent WHERE old_pk = ?", [intent.old_pk]);
      intentsReconciled++;
      if (stranded > 0) {
        await db.runAsync("INSERT INTO p2p_boot_repair_log(at, detail) VALUES (?, ?)", [
          Date.now(),
          `re-pair intent ${intent.old_pk.slice(0, 16)}…: failed ${stranded} stranded outbox rows as peer_superseded`,
        ]);
      }
    }
    const orphanRows = await db.getAllAsync<{ id: string }>(
      "SELECT id FROM p2p_messages WHERE dir='out' AND status IN ('queued','sent') " +
        "AND lower(peer_pk) NOT IN (SELECT lower(pk_hex) FROM p2p_contacts)",
    );
    if (orphanRows.length > 0) {
      await db.runAsync(
        "UPDATE p2p_messages SET status='failed', failure_reason='identity_changed', " +
          "identity_change_cause='orphaned_destination' " +
          "WHERE dir='out' AND status IN ('queued','sent') " +
          "AND lower(peer_pk) NOT IN (SELECT lower(pk_hex) FROM p2p_contacts)",
      );
      orphansFailed = orphanRows.length;
      await db.runAsync("INSERT INTO p2p_boot_repair_log(at, detail) VALUES (?, ?)", [
        Date.now(),
        `orphan sweep: failed ${orphanRows.length} rows as orphaned_destination (destination identity unknown)`,
      ]);
    }
    // UNIT B (§10 Q10): carrera resolve→commit→saveMessage. Una fila que
    // aterrizó DESPUÉS del commit contra una pk ya superseded quedaría
    // 'queued' para siempre (el outbox fail del txn ya pasó; no es huérfana
    // porque la fila de contacto existe). La causa ES conocible (la fila de
    // contacto registra superseded_by): se falla como peer_superseded,
    // honesto y auditable por separado.
    const supersededRows = await db.getAllAsync<{ id: string }>(
      "SELECT m.id FROM p2p_messages m JOIN p2p_contacts c ON lower(m.peer_pk) = lower(c.pk_hex) " +
        "WHERE m.dir='out' AND m.status IN ('queued','sent') AND c.superseded_by IS NOT NULL",
    );
    if (supersededRows.length > 0) {
      await db.runAsync(
        "UPDATE p2p_messages SET status='failed', failure_reason='identity_changed', " +
          "identity_change_cause='peer_superseded' " +
          "WHERE dir='out' AND status IN ('queued','sent') AND lower(peer_pk) IN " +
          "(SELECT lower(pk_hex) FROM p2p_contacts WHERE superseded_by IS NOT NULL)",
      );
      await db.runAsync("INSERT INTO p2p_boot_repair_log(at, detail) VALUES (?, ?)", [
        Date.now(),
        `superseded-destination sweep: failed ${supersededRows.length} rows as peer_superseded (landed after the re-pair commit)`,
      ]);
    }
  });
  return { intentsReconciled, orphansFailed };
}

/** UNIT B: traza del boot repair (tests/auditoría). */
export async function getBootRepairLog(limit = 50): Promise<Array<{ at: number; detail: string }>> {
  await migrate();
  const db = await getMemoryDb();
  const rows = await db.getAllAsync<{ at: number; detail: string }>(
    "SELECT at, detail FROM p2p_boot_repair_log ORDER BY id DESC LIMIT ?",
    [limit],
  );
  return rows.map((r) => ({ at: r.at, detail: r.detail }));
}

export async function listContacts(): Promise<P2PContact[]> {
  await migrate();
  const db = await getMemoryDb();
  const rows = await db.getAllAsync<{ pk_hex: string; name: string; verified: number; sig_pk: string | null }>(
    // UNIT B (F-6): SOLO contactos vivos. Una identidad superseded está
    // muerta en todos los paths live: resolución, handshake, rutas,
    // sesiones, outbox y retry.
    "SELECT pk_hex, name, verified, sig_pk FROM p2p_contacts WHERE superseded_by IS NULL ORDER BY name",
  );
  return rows.map((r) => ({ pkHex: r.pk_hex, name: r.name, verified: r.verified === 1, sigPkHex: r.sig_pk ?? null, supersededBy: null, supersededAt: null }));
}

/**
 * UNIT B (R1): variante de auditoría/historial que incluye identidades
 * superseded. EXCLUSIVAMENTE para historial/auditoría: ningún flujo de
 * envío, resolución o emparejamiento del agente (ni de la UI) puede usarla
 * para resolver un destinatario — test-asserted.
 */
export async function listAllContacts(): Promise<P2PContact[]> {
  await migrate();
  const db = await getMemoryDb();
  const rows = await db.getAllAsync<{
    pk_hex: string; name: string; verified: number; sig_pk: string | null;
    superseded_by: string | null; superseded_at: number | null;
  }>(
    "SELECT pk_hex, name, verified, sig_pk, superseded_by, superseded_at FROM p2p_contacts ORDER BY name",
  );
  return rows.map((r) => ({
    pkHex: r.pk_hex, name: r.name, verified: r.verified === 1, sigPkHex: r.sig_pk ?? null,
    supersededBy: r.superseded_by ?? null, supersededAt: r.superseded_at ?? null,
  }));
}

/** Busca contacto por clave pública (normalizada a minúsculas). UNIT B: solo vivos. */
export async function findContactByPk(pkHex: string): Promise<P2PContact | null> {
  await migrate();
  let pk: string;
  try {
    pk = toHex(fromHex(pkHex));
  } catch {
    return null;
  }
  const db = await getMemoryDb();
  const row = await db.getFirstAsync<{ pk_hex: string; name: string; verified: number; sig_pk: string | null }>(
    // UNIT B (F-6): una pk superseded lee como DESCONOCIDA — el path
    // fail-closed que R4 ya ejerce para pks desconocidas.
    "SELECT pk_hex, name, verified, sig_pk FROM p2p_contacts WHERE pk_hex = ? AND superseded_by IS NULL LIMIT 1",
    [pk],
  );
  if (!row) return null;
  return { pkHex: row.pk_hex, name: row.name, verified: row.verified === 1, sigPkHex: row.sig_pk ?? null, supersededBy: null, supersededAt: null };
}

/**
 * UNIT B: lectura de una fila de contacto SIN filtro de ciclo de vida
 * (viva o superseded). Solo para: nota "identidad retirada" de la
 * ceremonia, resolución del sucesor en resend/retry, y auditoría.
 * NUNCA para resolución de destinatarios.
 */
export async function findContactRowAny(pkHex: string): Promise<P2PContact | null> {
  await migrate();
  let pk: string;
  try {
    pk = toHex(fromHex(pkHex));
  } catch {
    return null;
  }
  const db = await getMemoryDb();
  const row = await db.getFirstAsync<{
    pk_hex: string; name: string; verified: number; sig_pk: string | null;
    superseded_by: string | null; superseded_at: number | null;
  }>(
    "SELECT pk_hex, name, verified, sig_pk, superseded_by, superseded_at FROM p2p_contacts WHERE pk_hex = ? LIMIT 1",
    [pk],
  );
  if (!row) return null;
  return {
    pkHex: row.pk_hex, name: row.name, verified: row.verified === 1, sigPkHex: row.sig_pk ?? null,
    supersededBy: row.superseded_by ?? null, supersededAt: row.superseded_at ?? null,
  };
}

/**
 * UNIT B (§7.1, one-hop-only): el sucesor VIVO de una identidad retirada.
 * Lee la fila (viva o muerta) del pk viejo, toma superseded_by y exige que
 * el sucesor esté VIVO. Si el sucesor fue a su vez retirado → null
 * (rehúso honesto: cada hop es una ceremonia humana distinta; el diseño
 * prohíbe chain-chasing automático).
 */
export async function getLiveSuccessorPk(oldPkHex: string): Promise<string | null> {
  let oldPk: string;
  try {
    oldPk = toHex(fromHex(oldPkHex));
  } catch {
    return null;
  }
  const old = await findContactRowAny(oldPk);
  const next = old?.supersededBy;
  if (!next) return null;
  const live = await findContactByPk(next);
  return live ? live.pkHex : null;
}

/**
 * M-4: normalización para comparar nombres de contacto. Re-exportada desde
 * ./contactName (módulo sin dependencias nativas; una sola normalización
 * para store, messenger y ceremonia).
 */
export { normalizeContactName } from "./contactName";

/**
 * M-4: resolución de contacto por nombre, EXACTA y sin adivinanzas.
 * - 0 coincidencias → { kind: "not_found" }.
 * - 1 coincidencia exacta (normalizada) → { kind: "ok", contact }.
 * - >1 coincidencias → { kind: "ambiguous", candidates }: el llamador debe
 *   pedir desambiguación; NUNCA se elige un destinatario por el usuario.
 */
export type ContactResolution =
  | { kind: "ok"; contact: P2PContact }
  | { kind: "not_found" }
  | { kind: "ambiguous"; candidates: P2PContact[] };

export async function resolveContactByName(name: string): Promise<ContactResolution> {
  await migrate();
  const needle = normalizeContactName(name);
  if (!needle) return { kind: "not_found" };
  const matches = (await listContacts()).filter(
    (c) => normalizeContactName(c.name) === needle,
  );
  if (matches.length === 0) return { kind: "not_found" };
  if (matches.length === 1) return { kind: "ok", contact: matches[0] };
  return { kind: "ambiguous", candidates: matches };
}

export interface P2PStoredMessage {
  id: string;
  dir: "in" | "out";
  peerPk: string;
  type: string;
  text: string;
  status: string;
  ts: number;
  /** N6: intentos de envío con espera de ACK (solo 'out'). */
  ackAttempts?: number;
  /** N6: causa interna del estado 'failed': timeout | identity_changed | user_cancelled. */
  failureReason?: string | null;
  /**
   * UNIT B (F-5): causa interna de failure_reason='identity_changed'.
   * null en cualquier otro caso. Las tres causas son distinguibles y el
   * retry las trata distinto (ver tabla en §7 del packet de diseño).
   */
  identityChangeCause?: IdentityChangeCause | null;
}

/**
 * UNIT B (F-5): las tres causas distinguibles de
 * failure_reason='identity_changed'.
 * - peer_superseded: el PEER fue re-emparejado (re-pair); retry REFUSADO.
 * - own_identity_recovered: NUESTRA identidad se recuperó (F-2); el peer
 *   sigue siendo legítimo; retry PERMITIDO (espera re-pair del peer).
 * - orphaned_destination: boot-orphan sweep; la causa real se DESCONOCE;
 *   retry REFUSADO sin afirmar supersesión.
 */
export type IdentityChangeCause =
  | "peer_superseded"
  | "own_identity_recovered"
  | "orphaned_destination";

const IDENTITY_CHANGE_CAUSES: ReadonlySet<string> = new Set([
  "peer_superseded",
  "own_identity_recovered",
  "orphaned_destination",
]);

function assertIdentityChangeCause(c: string): asserts c is IdentityChangeCause {
  if (!IDENTITY_CHANGE_CAUSES.has(c)) throw new Error(`identity_change_cause inválido: ${c}`);
}

/** N6: causas internas de 'failed' (D7). La UI conserva cuatro estados. */
export type N6FailureReason = "timeout" | "identity_changed" | "user_cancelled";

const N6_FAILURE_REASONS: ReadonlySet<string> = new Set([
  "timeout",
  "identity_changed",
  "user_cancelled",
]);

function assertN6FailureReason(r: string): asserts r is N6FailureReason {
  if (!N6_FAILURE_REASONS.has(r)) throw new Error(`failure_reason inválido: ${r}`);
}

type P2PMessageRow = {
  id: string; dir: string; peer_pk: string; type: string; text: string; status: string; ts: number;
  ack_attempts?: number | null; failure_reason?: string | null; identity_change_cause?: string | null;
};

function rowToMessage(r: P2PMessageRow): P2PStoredMessage {
  return {
    id: r.id, dir: r.dir as "in" | "out", peerPk: r.peer_pk, type: r.type,
    text: r.text, status: r.status, ts: r.ts,
    ackAttempts: r.ack_attempts ?? 0,
    failureReason: r.failure_reason ?? null,
    identityChangeCause: (r.identity_change_cause ?? null) as IdentityChangeCause | null,
  };
}

const P2P_MESSAGE_COLS =
  "id, dir, peer_pk, type, text, status, ts, ack_attempts, failure_reason, identity_change_cause";

/**
 * Guarda un mensaje. Idempotente: si el id ya existe no lo toca
 * (INSERT OR IGNORE) y devuelve false — un replay nunca debe reescribir
 * el estado (p. ej. marcar como no leído algo ya leído).
 *
 * R6: por el ciclo de vida guardado: un frame entrante obsoleto no puede
 * recrear la base de memoria tras Clear All Data.
 */
export async function saveMessage(msg: {
  id: string;
  dir: "in" | "out";
  peerPk: string;
  type: string;
  text: string;
  status?: string;
  ts?: number;
  ackAttempts?: number;
  failureReason?: N6FailureReason | null;
  /** UNIT B (F-5): solo la escriben las transiciones autoritativas. */
  identityChangeCause?: IdentityChangeCause | null;
}): Promise<boolean> {
  const row = {
    id: msg.id,
    dir: msg.dir,
    peerPk: msg.peerPk.toLowerCase(),
    type: msg.type,
    text: msg.text,
    status: msg.status ?? "queued",
    ts: msg.ts ?? Date.now(),
    ackAttempts: msg.ackAttempts ?? 0,
    failureReason: msg.failureReason ?? null,
    identityChangeCause: msg.identityChangeCause ?? null,
  };
  let inserted = false;
  await writeMemoryTransaction(async (db) => {
    await migrateOn(db);
    const res = await db.runAsync(
      "INSERT OR IGNORE INTO p2p_messages (id, dir, peer_pk, type, text, status, ts, ack_attempts, failure_reason, identity_change_cause) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [row.id, row.dir, row.peerPk, row.type, row.text, row.status, row.ts, row.ackAttempts, row.failureReason, row.identityChangeCause],
    );
    inserted = (res?.changes ?? 0) > 0;
  });
  return inserted;
}

/** Conversación con un peer (entrantes + salientes), ordenada por fecha. */
export async function getConversation(peerPkHex: string, limit = 200): Promise<P2PStoredMessage[]> {
  await migrate();
  let pk: string;
  try {
    pk = toHex(fromHex(peerPkHex));
  } catch {
    return [];
  }
  const db = await getMemoryDb();
  const rows = await db.getAllAsync<P2PMessageRow>(
    `SELECT ${P2P_MESSAGE_COLS} FROM p2p_messages ` +
      "WHERE peer_pk = ? ORDER BY ts ASC LIMIT ?",
    [pk, limit],
  );
  return rows.map(rowToMessage);
}

/** Bandeja de entrada: mensajes recibidos no leídos. */
export async function getUnreadInbox(): Promise<P2PStoredMessage[]> {
  await migrate();
  const db = await getMemoryDb();
  const rows = await db.getAllAsync<P2PMessageRow>(
    `SELECT ${P2P_MESSAGE_COLS} FROM p2p_messages WHERE dir='in' AND status != 'read' ORDER BY ts`);
  return rows.map(rowToMessage);
}

/** Cola de salida: mensajes pendientes de entregar al peer. */
export async function getOutbox(): Promise<P2PStoredMessage[]> {
  await migrate();
  const db = await getMemoryDb();
  const rows = await db.getAllAsync<P2PMessageRow>(
    `SELECT ${P2P_MESSAGE_COLS} FROM p2p_messages WHERE dir='out' AND status='queued' ORDER BY ts`);
  return rows.map(rowToMessage);
}

export async function markMessageStatus(id: string, status: string): Promise<void> {
  // R6: ver saveMessage.
  await writeMemoryTransaction(async (db) => {
    await migrateOn(db);
    await db.runAsync("UPDATE p2p_messages SET status=? WHERE id=?", [status, id]);
  });
}

/**
 * DELETE-MSG 2026-10-07: borra un mensaje del chat P2P por id.
 * Solo borra localmente (el peer conserva su copia — el borrado no se propaga).
 */
export async function deleteMessage(id: string): Promise<void> {
  await writeMemoryTransaction(async (db) => {
    await migrateOn(db);
    await db.runAsync("DELETE FROM p2p_messages WHERE id=?", [id]);
  });
}

/**
 * F-1 remediation (full adversarial audit 2026-09-28): transición GUARDADA
 * a 'sent' para el outbox. El UPDATE solo tiene efecto si la fila sigue en
 * un estado PRE-TERMINAL ('queued'|'sent') — la base de datos decide la
 * carrera, no un re-check en JS: si la fila alcanzó un estado terminal
 * (failed por cualquier causa, o delivered) mientras los bytes estaban en
 * vuelo, la transición pierde y devuelve false.
 *
 * El intento perdedor NO debe armar timer ni tocar failure_reason: el estado
 * terminal gana. (Los bytes ya salieron al OS — eso no se deshace — pero el
 * estado local permanece terminal y un ACK tardío jamás puede sobrescribir
 * la causa: ver markOutboundDelivered + processDeliveryAck + D7.)
 *
 * Entering 'sent' always clears failure_reason (igual que
 * resetOutboundForRetry): una fila 'sent' nunca carga una causa terminal.
 */
export async function markOutboundSent(id: string): Promise<boolean> {
  let changed = false;
  await writeMemoryTransaction(async (db) => {
    await migrateOn(db);
    const res = await db.runAsync(
      "UPDATE p2p_messages SET status='sent', failure_reason=NULL " +
        "WHERE id=? AND dir='out' AND status IN ('queued','sent')",
      [id],
    );
    changed = (res?.changes ?? 0) > 0;
  });
  return changed;
}

/**
 * N6 §5: persiste un mensaje ENTRANTE junto con su entrada del
 * delivery_ack_log EN LA MISMA TRANSACCIÓN. El receptor solo puede
 * emitir ACK después de que este commit resuelva (D4): un crash entre
 * el insert del mensaje y el insert del log no puede dejar un mensaje
 * persistido sin su registro de dedup (o viceversa).
 *
 * Devuelve true si el mensaje es NUEVO (insertado), false si el
 * message_id ya existía (dedup — el llamante debe tomar la ruta
 * dedup/re-ACK, sin efectos).
 */
export async function saveInboundMessageWithAckLog(msg: {
  id: string;
  peerPk: string;
  type: string;
  text: string;
  status?: string;
  ts?: number;
  sessionTag: string;
  persistedAt?: number;
}): Promise<boolean> {
  if (!/^[0-9a-f]{128}$/.test(msg.sessionTag)) throw new Error("session_tag inválido para el ack log.");
  const ts = msg.ts ?? Date.now();
  const persistedAt = msg.persistedAt ?? ts;
  let inserted = false;
  await writeMemoryTransaction(async (db) => {
    await migrateOn(db);
    const res = await db.runAsync(
      "INSERT OR IGNORE INTO p2p_messages (id, dir, peer_pk, type, text, status, ts) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [msg.id, "in", msg.peerPk.toLowerCase(), msg.type, msg.text, msg.status ?? "delivered", ts],
    );
    inserted = (res?.changes ?? 0) > 0;
    if (inserted) {
      await db.runAsync(
        "INSERT OR IGNORE INTO delivery_ack_log (message_id, session_tag, persisted_at, acked_at) VALUES (?, ?, ?, ?)",
        [msg.id, msg.sessionTag, persistedAt, persistedAt],
      );
    }
  });
  return inserted;
}

/** N6: entrada del ack log para un message_id (dedup incluso tras borrar el inbox). */
export async function getDeliveryAckLogEntry(messageId: string): Promise<{
  messageId: string; sessionTag: string; persistedAt: number; ackedAt: number;
} | null> {
  await migrate();
  const db = await getMemoryDb();
  const row = await db.getFirstAsync<{
    message_id: string; session_tag: string; persisted_at: number; acked_at: number;
  }>("SELECT message_id, session_tag, persisted_at, acked_at FROM delivery_ack_log WHERE message_id = ? LIMIT 1", [messageId]);
  if (!row) return null;
  return { messageId: row.message_id, sessionTag: row.session_tag, persistedAt: row.persisted_at, ackedAt: row.acked_at };
}

/** N6 §7: ¿este message_id ya fue persistido (inbox o ack log)? */
export async function hasDeliveryAckLogEntry(messageId: string): Promise<boolean> {
  return (await getDeliveryAckLogEntry(messageId)) !== null;
}

/**
 * N6 §7 / D12: podado del ack log ESTRICTAMENTE POR EDAD. Ninguna entrada
 * puede ser eliminada mientras su id siga dentro del horizonte contractual
 * (persisted_at >= now - DEDUP_RETENTION_DAYS): el volumen jamás acorta el
 * horizonte. Sin cap por filas (el cap futuro sería back-pressure, D12).
 */
export async function pruneDeliveryAckLog(olderThanMs: number): Promise<number> {
  let deleted = 0;
  await writeMemoryTransaction(async (db) => {
    await migrateOn(db);
    const res = await db.runAsync("DELETE FROM delivery_ack_log WHERE persisted_at < ?", [Math.floor(olderThanMs)]);
    deleted = res?.changes ?? 0;
  });
  return deleted;
}

/** N6: un mensaje saliente concreto con su estado de entrega. */
export async function getOutboundMessage(id: string): Promise<P2PStoredMessage | null> {
  await migrate();
  const db = await getMemoryDb();
  const row = await db.getFirstAsync<P2PMessageRow>(
    `SELECT ${P2P_MESSAGE_COLS} FROM p2p_messages WHERE id = ? AND dir = 'out' LIMIT 1`,
    [id],
  );
  return row ? rowToMessage(row) : null;
}

/**
 * N6 §4.1: marca un mensaje saliente como 'failed' con su causa interna.
 * Idempotente respecto a estados terminales: nunca sobrescribe 'delivered'.
 */
export async function markOutboundFailed(id: string, reason: N6FailureReason): Promise<boolean> {
  assertN6FailureReason(reason);
  let changed = false;
  await writeMemoryTransaction(async (db) => {
    await migrateOn(db);
    const res = await db.runAsync(
      "UPDATE p2p_messages SET status='failed', failure_reason=? " +
        "WHERE id=? AND dir='out' AND status != 'delivered'",
      [reason, id],
    );
    changed = (res?.changes ?? 0) > 0;
  });
  return changed;
}

/** N6: incrementa el contador de intentos de un mensaje saliente. */
export async function incrementAckAttempts(id: string): Promise<number> {
  let attempts = 0;
  await writeMemoryTransaction(async (db) => {
    await migrateOn(db);
    await db.runAsync("UPDATE p2p_messages SET ack_attempts = ack_attempts + 1 WHERE id=? AND dir='out'", [id]);
    const row = await db.getFirstAsync<{ ack_attempts: number }>(
      "SELECT ack_attempts FROM p2p_messages WHERE id=? AND dir='out' LIMIT 1",
      [id],
    );
    attempts = row?.ack_attempts ?? 0;
  });
  return attempts;
}

/**
 * N6 §4.3: prepara un mensaje 'failed' para reintento del usuario.
 * Dentro del horizonte: mismo id, ack_attempts a 0 (el id se conserva;
 * §7). Devuelve false si el mensaje ya no es reintentable.
 *
 * UNIT B (§7, F-5): el gate es SQL (filosofía F-1). Las causas
 * 'peer_superseded' y 'orphaned_destination' se RECHAZAN aquí mismo: un
 * retry jamás puede revivir una fila cuya identidad destino murió. El
 * llamador (messenger.retryOutboundMessage) traduce el false a un rechazo
 * tipado con la causa.
 */
export async function resetOutboundForRetry(id: string): Promise<boolean> {
  let changed = false;
  await writeMemoryTransaction(async (db) => {
    await migrateOn(db);
    const res = await db.runAsync(
      "UPDATE p2p_messages SET status='queued', ack_attempts=0, failure_reason=NULL, identity_change_cause=NULL " +
        "WHERE id=? AND dir='out' AND status='failed' " +
        "AND NOT (failure_reason='identity_changed' " +
        "AND identity_change_cause IN ('peer_superseded','orphaned_destination'))",
      [id],
    );
    changed = (res?.changes ?? 0) > 0;
  });
  return changed;
}

/**
 * N6 §4.3 / §6.6: al cambiar la identidad del peer (re-pair), todos los
 * 'pending'/'sent' de ese peer pasan a failed(identity_changed): ningún
 * ACK viejo puede validarse jamás contra la identidad nueva.
 *
 * UNIT B (F-5): la causa interna es SIEMPRE 'peer_superseded'. Distinción
 * estructural con 'own_identity_recovered' (ver failAllOutbox).
 */
export async function failPeerOutbox(peerPkHex: string, reason: N6FailureReason): Promise<number> {
  assertN6FailureReason(reason);
  let count = 0;
  await writeMemoryTransaction(async (db) => {
    await migrateOn(db);
    const res = await db.runAsync(
      "UPDATE p2p_messages SET status='failed', failure_reason=?, identity_change_cause='peer_superseded' " +
        "WHERE dir='out' AND peer_pk=? AND status IN ('queued','sent')",
      [reason, toHex(fromHex(peerPkHex)).toLowerCase()],
    );
    count = res?.changes ?? 0;
  });
  return count;
}

/**
 * N6 §4.4: recuperación tras reinicio/crash del emisor. Toda fila 'sent'
 * vuelve a 'queued' ("desconocido — se re-verificará"): NUNCA 'delivered'.
 * El reenvío usa el mismo message_id; el receptor hace dedup (§5.1).
 */
export async function recoverSentOutboxToQueued(): Promise<number> {
  let count = 0;
  await writeMemoryTransaction(async (db) => {
    await migrateOn(db);
    const res = await db.runAsync(
      "UPDATE p2p_messages SET status='queued' WHERE dir='out' AND status='sent'",
    );
    count = res?.changes ?? 0;
  });
  return count;
}

/**
 * N6 §4.5: registra internamente un ACK tardío genuino sobre un mensaje
 * cancelado por el usuario. Auditoría solamente: el estado visible NO
 * cambia (la cancelación del usuario es terminal).
 */
export async function recordLateAck(messageId: string, sessionTag: string, receivedAt: number): Promise<void> {
  await writeMemoryTransaction(async (db) => {
    await migrateOn(db);
    await db.runAsync(
      "INSERT INTO n6_late_ack_audit (message_id, session_tag, received_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(message_id) DO UPDATE SET session_tag=excluded.session_tag, received_at=excluded.received_at",
      [messageId, sessionTag, Math.floor(receivedAt)],
    );
  });
}

/** N6: ¿existe ya un mensaje (in) con este message_id? (dedup gate, Tier 2). */
export async function messageExists(id: string): Promise<boolean> {
  await migrate();
  const db = await getMemoryDb();
  const row = await db.getFirstAsync<{ one: number }>(
    "SELECT 1 AS one FROM p2p_messages WHERE id = ? LIMIT 1",
    [id],
  );
  return row !== null;
}

/**
 * N6 P2: 'delivered' solo se alcanza por esta función, y solo se la llama
 * con un ACK ya validado (§3.2 + §4.5). Defensa en profundidad: el UPDATE
 * nunca puede sacar un mensaje de 'failed' con causa user_cancelled ni
 * reescribir un 'delivered' terminal.
 */
export async function markOutboundDelivered(id: string): Promise<boolean> {
  let changed = false;
  await writeMemoryTransaction(async (db) => {
    await migrateOn(db);
    const res = await db.runAsync(
      "UPDATE p2p_messages SET status='delivered', failure_reason=NULL " +
        "WHERE id=? AND dir='out' AND (status IN ('queued','sent') " +
        "OR (status='failed' AND failure_reason='timeout'))",
      [id],
    );
    changed = (res?.changes ?? 0) > 0;
  });
  return changed;
}

/** N6: mensajes salientes en 'sent' (entregados al stack, sin ACK todavía). */
export async function getSentOutbox(): Promise<P2PStoredMessage[]> {
  await migrate();
  const db = await getMemoryDb();
  const rows = await db.getAllAsync<P2PMessageRow>(
    `SELECT ${P2P_MESSAGE_COLS} FROM p2p_messages WHERE dir='out' AND status='sent' ORDER BY ts`,
  );
  return rows.map(rowToMessage);
}

/** N6 §4.5: lectura de la auditoría de ACKs tardíos (para tests/auditoría). */
export async function getLateAckRecord(messageId: string): Promise<{
  messageId: string; sessionTag: string; receivedAt: number;
} | null> {
  await migrate();
  const db = await getMemoryDb();
  const row = await db.getFirstAsync<{ message_id: string; session_tag: string; received_at: number }>(
    "SELECT message_id, session_tag, received_at FROM n6_late_ack_audit WHERE message_id = ? LIMIT 1",
    [messageId],
  );
  if (!row) return null;
  return { messageId: row.message_id, sessionTag: row.session_tag, receivedAt: row.received_at };
}

/**
 * M-6: bandeja de aprobación. Tareas remotas (agent_task) entrantes que
 * siguen esperando una decisión humana explícita. NUNCA se auto-ejecutan:
 * el único camino fuera de "queued" es decideAgentTask().
 */
export async function getPendingAgentTasks(): Promise<P2PStoredMessage[]> {
  await migrate();
  const db = await getMemoryDb();
  const rows = await db.getAllAsync<P2PMessageRow>(
    `SELECT ${P2P_MESSAGE_COLS} FROM p2p_messages ` +
      "WHERE dir='in' AND type='agent_task' AND status='queued' ORDER BY ts",
  );
  return rows.map(rowToMessage);
}

/** Una tarea remota concreta (para mostrarla en el diálogo de decisión). */
export async function getAgentTask(id: string): Promise<P2PStoredMessage | null> {
  await migrate();
  const db = await getMemoryDb();
  const row = await db.getFirstAsync<P2PMessageRow>(
    `SELECT ${P2P_MESSAGE_COLS} FROM p2p_messages ` +
      "WHERE id=? AND dir='in' AND type='agent_task' LIMIT 1",
    [id],
  );
  if (!row) return null;
  return rowToMessage(row);
}

/**
 * M-6: registra la decisión humana sobre una tarea encolada. Solo
 * transiciona desde "queued": una tarea ya decidida no cambia de estado
 * (idempotente y sin sorpresas). Devuelve true si quedó registrada.
 */
export async function decideAgentTask(
  id: string,
  decision: "approved" | "rejected",
): Promise<boolean> {
  // R6: ver saveMessage.
  let decided = false;
  await writeMemoryTransaction(async (db) => {
    await migrateOn(db);
    const res = await db.runAsync(
      "UPDATE p2p_messages SET status=? " +
        "WHERE id=? AND dir='in' AND type='agent_task' AND status='queued'",
      [decision, id],
    );
    decided = (res?.changes ?? 0) > 0;
  });
  return decided;
}
/**
 * R4 — cache anti-replay persistente de nonces de HELLO.
 *
 * Vive en la misma base cifrada que la memoria (`nido_memory.db`), así
 * sobrevive a reinicios (el PoC post-restart muere aquí). La decisión de
 * replay es UN INSERT atómico: la PK compuesta (pk_lower, nonce_hex) hace
 * que un conflicto UNIQUE signifique "replay -> reject" — no existe un
 * SELECT-then-INSERT separado vulnerable a carrera.
 */

export const NONCE_CACHE_DEFAULT_WINDOW_S = 3600;

/**
 * Reclama el par (pk, nonce) de forma atómica.
 *
 * Devuelve true si el nonce es NUEVO (reclamado) o false si ya estaba
 * (replay -> el llamante debe rechazar fail-closed). Un error distinto de
 * un conflicto UNIQUE se propaga (fail-closed: el handshake se rechaza
 * sin enviar CONFIRM).
 *
 * Podado oportunista en la misma transacción: las filas más viejas que
 * `windowS` corresponden a HELLOs que el chequeo de frescura rechaza de
 * todos modos, así que podarlas no puede re-admitir un replay (§8.2).
 */
export async function claimHelloNonce(
  pkLower: string,
  nonceHex: string,
  seenAtSec: number,
  windowS: number = NONCE_CACHE_DEFAULT_WINDOW_S,
): Promise<boolean> {
  const pk = pkLower.toLowerCase();
  const nonce = nonceHex.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pk) || !/^[0-9a-f]{32}$/.test(nonce)) {
    throw new Error("Par (pk, nonce) inválido para la cache anti-replay.");
  }
  let claimed = false;
  await writeMemoryTransaction(async (db) => {
    await migrateOn(db);
    try {
      await db.runAsync(
        "INSERT INTO hello_nonce_cache (pk_lower, nonce_hex, seen_at) VALUES (?, ?, ?)",
        [pk, nonce, Math.floor(seenAtSec)],
      );
      claimed = true;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      // Conflicto de PK = este (pk, nonce) ya se vio: replay.
      if (/unique|primary/i.test(msg)) {
        claimed = false;
      } else {
        throw e; // fallo real de base: fail-closed, no se reclama
      }
    }
    // Podado oportunista (best-effort dentro de la misma transacción).
    try {
      await db.runAsync("DELETE FROM hello_nonce_cache WHERE seen_at < ?", [
        Math.floor(seenAtSec) - Math.floor(windowS),
      ]);
    } catch {
      /* el podado nunca bloquea el handshake */
    }
  });
  return claimed;
}

/**
 * Podado explícito de la cache anti-replay (p. ej. al arrancar el
 * transporte). Borra las filas más viejas que `olderThanSec`.
 */
export async function pruneHelloNonceCache(olderThanSec: number): Promise<void> {
  await writeMemoryTransaction(async (db) => {
    await migrateOn(db);
    await db.runAsync("DELETE FROM hello_nonce_cache WHERE seen_at < ?", [
      Math.floor(olderThanSec),
    ]);
  });
}

/**
 * Vacía la cache anti-replay completa. R4 §8.4: al rotar nuestra
 * identidad somos criptográficamente un dispositivo nuevo.
 */
export async function clearHelloNonceCache(): Promise<void> {
  await writeMemoryTransaction(async (db) => {
    await migrateOn(db);
    await db.runAsync("DELETE FROM hello_nonce_cache");
  });
}

/**
 * Borra las filas de nonces de un peer concreto. R4 §8.4: al eliminar un
 * contacto (cuando K1 aterrice) o re-emparejarlo con identidad nueva.
 */
export async function deleteHelloNoncesForPeer(pkHex: string): Promise<void> {
  const pk = toHex(fromHex(pkHex)).toLowerCase();
  await writeMemoryTransaction(async (db) => {
    await migrateOn(db);
    await db.runAsync("DELETE FROM hello_nonce_cache WHERE pk_lower = ?", [pk]);
  });
}

/**
 * BUG-6 Plan B (2026-10-07): guarda la MAC con la que se completó un handshake
 * exitoso. Si getBondedDevices() sale vacía/stale, el barrido prueba estas MACs
 * conocidas primero sin depender del caché del BluetoothAdapter.
 */
export async function saveKnownMac(pkHex: string, mac: string): Promise<void> {
  const pk = pkHex.toLowerCase();
  const macUpper = mac.toUpperCase();
  if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(macUpper)) return;
  await writeMemoryTransaction(async (db) => {
    await migrateOn(db);
    await db.runAsync(
      "UPDATE p2p_contacts SET last_mac = ? WHERE pk_hex = ? AND superseded_by IS NULL",
      [macUpper, pk]
    );
  });
}

/**
 * BUG-6 Plan B: retorna mapa pkHex -> MAC conocida (solo contactos vivos con MAC guardada).
 */
export async function getKnownMacs(): Promise<Map<string, string>> {
  await migrate();
  const db = await getMemoryDb();
  const rows = await db.getAllAsync<{ pk_hex: string; last_mac: string | null }>(
    "SELECT pk_hex, last_mac FROM p2p_contacts WHERE superseded_by IS NULL AND last_mac IS NOT NULL"
  );
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.last_mac) map.set(r.pk_hex.toLowerCase(), r.last_mac.toUpperCase());
  }
  return map;
}
