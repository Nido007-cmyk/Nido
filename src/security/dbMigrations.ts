/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * dbMigrations.ts — framework de migraciones versionadas de esquema (RISK-3 / TD-5).
 *
 * Problema que resuelve: hasta L1, `formatVersion.ts` solo sabía aceptar o
 * rechazar un major (`checkFormatVersion`): cualquier bump de versión era un
 * fail-closed sin camino de upgrade — un cambio de columna/tipo brickeaba
 * instalaciones existentes. Este motor añade el camino `up()` que faltaba.
 *
 * Diseño:
 * - La versión vive en la tabla `meta` (`key = 'schema_version'`), la misma
 *   que ya estampan `databaseManager.ts` y `rag/db.ts`. El motor la crea si
 *   falta (`CREATE TABLE IF NOT EXISTS`: idempotente, sin cambio de
 *   comportamiento donde el DDL ya la crea).
 * - Una migración es `{ from, to, up }`: `up` corre DENTRO de una transacción
 *   y el stamp de versión se escribe en la MISMA transacción → cada paso es
 *   atómico; un crash deja la versión anterior intacta y el próximo arranque
 *   reintenta desde un estado consistente.
 * - Fail-closed preservado:
 *   - versión corrupta → ErrorClass nombrado (igual que antes);
 *   - versión MÁS NUEVA que este lector → ErrorClass nombrado, nunca se
 *     interpreta un formato futuro (igual que antes);
 *   - versión más vieja SIN camino registrado → `MigrationPathMissingError`
 *     (nuevo: distingue "no hay migración escrita" de "versión corrupta").
 * - SQLCipher: el motor opera sobre un handle YA ABIERTO y con la DEK
 *   aplicada (lo abre `ensureEncryptedDatabase` / `openEncryptedDatabase`
 *   antes de llamar aquí). El cifrado es transparente para el SQL de las
 *   migraciones: no hay interacción criptográfica en este nivel.
 * - Testeable: `MigrationDb` es un subconjunto estructural de
 *   `SecureDbHandle` (sin importarlo: evita ciclos); los tests inyectan un
 *   fake en memoria.
 *
 * Uso (ver `databaseManager.ts`):
 *   await applyMigrations(db, {
 *     formatId: "nido_memory.db",
 *     supportedMajor: MEMORY_DB_SCHEMA_VERSION,
 *     ErrorClass: MemoryDbVersionError,
 *     migrations: MEMORY_MIGRATIONS, // [] en L1: sin migraciones todavía
 *   });
 */

import { FormatVersionError } from "./formatVersion";

/**
 * Subconjunto mínimo del handle que necesita el motor. Estructuralmente
 * compatible con `SecureDbHandle` (src/security/secureDatabase.ts): cualquier
 * handle real puede pasarse sin adaptador.
 */
export interface MigrationDb {
  execAsync(sql: string): Promise<void>;
  getAllAsync<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T | null>;
  runAsync(
    sql: string,
    params?: unknown[],
  ): Promise<{ lastInsertRowId: number; changes: number }>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

/**
 * Una migración de esquema: lleva la base de `from` a `to`.
 *
 * Reglas del registro (validadas al aplicar; un registro roto es un bug de
 * programador y falla rápido con Error plano, no con un error de runtime
 * críptico en el dispositivo):
 * - `from` y `to` son enteros, `to > from`;
 * - no hay dos migraciones con el mismo `from`;
 * - ningún `to` supera el `supportedMajor` del formato.
 */
export interface DbMigration {
  /** Versión de esquema desde la que parte. */
  from: number;
  /** Versión a la que lleva. Siempre > from. */
  to: number;
  /**
   * Aplica el cambio. Corre dentro de una transacción gestionada por el
   * motor; si lanza, la transacción revierte y la versión NO se estampa.
   * Debe ser idempotente frente a reintentos solo en el sentido de que un
   * fallo deja la versión anterior (el motor reintenta desde ahí).
   */
  up: (db: MigrationDb) => Promise<void>;
}

/**
 * No existe un camino de migraciones desde la versión encontrada hasta la
 * soportada. Fail-closed explícito: ni se pierde datos ni se salta en
 * silencio; hay que escribir la migración que falta.
 */
export class MigrationPathMissingError extends Error {
  readonly formatId: string;
  readonly from: number;
  readonly to: number;

  constructor(formatId: string, from: number, to: number) {
    super(
      `[${formatId}] no migration path from schema v${from} to v${to}: ` +
        "fail-closed (escribir la migración que falta; nunca downgrade silencioso)",
    );
    this.name = "MigrationPathMissingError";
    this.formatId = formatId;
    this.from = from;
    this.to = to;
  }
}

export interface ApplyMigrationsOptions {
  /** Identificador estable del formato (p. ej. "nido_memory.db"). */
  formatId: string;
  /** Major que este lector soporta (el destino de las migraciones). */
  supportedMajor: number;
  /** Error nombrado para versión corrupta o más nueva (p. ej. MemoryDbVersionError). */
  ErrorClass: new (found: unknown, reason: string) => FormatVersionError;
  /** Registro de migraciones del formato. Vacío = comportamiento L1 puro. */
  migrations: DbMigration[];
}

export interface MigrationResult {
  /** true si se ejecutó al menos una migración. */
  migrated: boolean;
  /** Versión encontrada al abrir (tras estampar si era instalación nueva). */
  from: number;
  /** Versión final (siempre === supportedMajor al terminar sin lanzar). */
  to: number;
}

const META_DDL =
  "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);";
const SELECT_VERSION_SQL = "SELECT value FROM meta WHERE key = 'schema_version';";

/** Parsea con las mismas reglas que checkFormatVersion: entero o string numérico. */
function parseVersion(found: unknown): number | null {
  if (typeof found === "number") {
    return Number.isInteger(found) ? found : null;
  }
  if (typeof found === "string") {
    const trimmed = found.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isInteger(n) ? n : null;
  }
  return null;
}

/** Valida el registro; un registro roto es bug de programador: falla rápido. */
function validateRegistry(
  formatId: string,
  supportedMajor: number,
  migrations: DbMigration[],
): void {
  if (!Number.isInteger(supportedMajor) || supportedMajor < 1) {
    throw new Error(
      `[${formatId}] applyMigrations: supportedMajor debe ser entero >= 1 (recibido: ${String(supportedMajor)})`,
    );
  }
  const seenFrom = new Set<number>();
  for (const m of migrations) {
    if (!Number.isInteger(m.from) || !Number.isInteger(m.to)) {
      throw new Error(
        `[${formatId}] applyMigrations: migración con from/to no enteros (${String(m.from)}→${String(m.to)})`,
      );
    }
    if (m.to <= m.from) {
      throw new Error(
        `[${formatId}] applyMigrations: migración debe avanzar (from=${m.from}, to=${m.to})`,
      );
    }
    if (seenFrom.has(m.from)) {
      throw new Error(
        `[${formatId}] applyMigrations: dos migraciones parten de v${m.from} (registro ambiguo)`,
      );
    }
    seenFrom.add(m.from);
    if (m.to > supportedMajor) {
      throw new Error(
        `[${formatId}] applyMigrations: migración ${m.from}→${m.to} supera supportedMajor=${supportedMajor} (subir supportedMajor primero)`,
      );
    }
    if (typeof m.up !== "function") {
      throw new Error(
        `[${formatId}] applyMigrations: migración ${m.from}→${m.to} sin función up`,
      );
    }
  }
}

/**
 * Aplica las migraciones pendientes hasta `supportedMajor`.
 *
 * - Instalación nueva (sin fila `schema_version`): estampa `supportedMajor`
 *   (semántica L1 de primera apertura, sin cambios).
 * - Versión actual: no-op.
 * - Versión más nueva: lanza `ErrorClass` (nunca se interpreta un futuro).
 * - Versión más vieja: encadena migraciones `from→to` contiguas hasta el
 *   destino; cada paso corre en transacción con su stamp. Sin camino
 *   completo: `MigrationPathMissingError`.
 */
export async function applyMigrations(
  db: MigrationDb,
  opts: ApplyMigrationsOptions,
): Promise<MigrationResult> {
  const { formatId, supportedMajor, ErrorClass, migrations } = opts;
  validateRegistry(formatId, supportedMajor, migrations);

  // Idempotente: el DDL de cada base ya crea `meta`, pero el motor no debe
  // depender de ello para ser reutilizable (p. ej. rag/db.ts lo crea aparte).
  await db.execAsync(META_DDL);

  const row = await db.getFirstAsync<{ value: string }>(SELECT_VERSION_SQL);
  if (!row) {
    // Primera apertura: estampar (igual que el código L1 que reemplaza).
    await db.runAsync("INSERT INTO meta (key, value) VALUES ('schema_version', ?);", [
      String(supportedMajor),
    ]);
    return { migrated: false, from: supportedMajor, to: supportedMajor };
  }

  const current = parseVersion(row.value);
  if (current === null) {
    throw new ErrorClass(row.value, "corrupt version value");
  }
  if (current === supportedMajor) {
    return { migrated: false, from: current, to: current };
  }
  if (current > supportedMajor) {
    throw new ErrorClass(row.value, "data is newer than this reader supports");
  }

  // current < supportedMajor: construir la cadena from→to.
  const byFrom = new Map<number, DbMigration>();
  for (const m of migrations) byFrom.set(m.from, m);
  const chain: DbMigration[] = [];
  let cursor = current;
  while (cursor < supportedMajor) {
    const step = byFrom.get(cursor);
    if (!step) {
      throw new MigrationPathMissingError(formatId, current, supportedMajor);
    }
    chain.push(step);
    cursor = step.to; // to > from garantizado por validateRegistry: termina.
  }

  for (const step of chain) {
    await db.withTransactionAsync(async () => {
      await step.up(db);
      await db.runAsync("UPDATE meta SET value = ? WHERE key = 'schema_version';", [
        String(step.to),
      ]);
    });
  }
  return { migrated: true, from: current, to: supportedMajor };
}
