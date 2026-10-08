/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * sqliteTestBridge.ts — SOLO TESTS (UNIT B, Q12).
 *
 * Puente entre `src/p2p/store.ts` y una SQLite REAL (`node:sqlite`,
 * `DatabaseSync`), exponiendo la interfaz estilo expo-sqlite que el store
 * espera de `../agent/memory/memoryStore`:
 *   - getMemoryDb() → { execAsync, runAsync, getAllAsync, getFirstAsync }
 *   - getMemoryDbEpoch()
 *   - writeMemoryTransaction(work) — con writeChain como el módulo real y
 *     transacción REAL (BEGIN IMMEDIATE … COMMIT/ROLLBACK).
 *
 * El mock semántico `p2pMemoryMock.ts` no sirve para Q12: la carrera F-1
 * mid-flight exige el motor SQL de verdad (atomicidad, rollback, guardas
 * WHERE autoritativas). Soporta múltiples "dispositivos" con `useDevice()`,
 * cada uno con su propia base `:memory:` y su propio epoch (para que el
 * `migratedEpoch` del store no salte el DDL al cambiar de dispositivo).
 */
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

type SqlParams = ReadonlyArray<unknown>;

interface ExpoLikeDb {
  execAsync(sql: string): Promise<void>;
  runAsync(
    sql: string,
    params?: SqlParams,
  ): Promise<{ lastInsertRowId: number | bigint; changes: number | bigint }>;
  getAllAsync<T>(sql: string, params?: SqlParams): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: SqlParams): Promise<T | null>;
}

function asInput(params: SqlParams): SQLInputValue[] {
  return params as SQLInputValue[];
}

function wrap(raw: DatabaseSync): ExpoLikeDb {
  return {
    execAsync: async (sql: string) => {
      raw.exec(sql);
    },
    runAsync: async (sql: string, params: SqlParams = []) => {
      const info = raw.prepare(sql).run(...asInput(params));
      return { lastInsertRowId: info.lastInsertRowid, changes: info.changes };
    },
    getAllAsync: async <T>(sql: string, params: SqlParams = []): Promise<T[]> => {
      return raw.prepare(sql).all(...asInput(params)) as T[];
    },
    getFirstAsync: async <T>(sql: string, params: SqlParams = []): Promise<T | null> => {
      const row = raw.prepare(sql).get(...asInput(params)) as T | undefined;
      return row === undefined ? null : row;
    },
  };
}

interface DeviceDb {
  raw: DatabaseSync;
  db: ExpoLikeDb;
  epoch: number;
}

const devices = new Map<string, DeviceDb>();
let activeKey = "default";
let epochCounter = 1;
let writeChain: Promise<void> = Promise.resolve();

function device(key: string): DeviceDb {
  let d = devices.get(key);
  if (!d) {
    const raw = new DatabaseSync(":memory:");
    d = { raw, db: wrap(raw), epoch: epochCounter++ };
    devices.set(key, d);
  }
  return d;
}

/** Cambia el dispositivo activo (cada uno con su propia base SQLite real). */
export function useSqliteDevice(key: string): void {
  activeKey = key;
  device(key); // crea si no existe
}

/** Cierra y recrea TODAS las bases (estado limpio entre tests). */
export function resetSqliteBridge(): void {
  for (const d of devices.values()) {
    try {
      d.raw.close();
    } catch {
      /* ya cerrada */
    }
  }
  devices.clear();
  activeKey = "default";
  writeChain = Promise.resolve();
  // epochCounter NO se reinicia: un epoch jamás se reutiliza, así el
  // `migratedEpoch` del store nunca cree migrada una base fresca.
}

/** Módulo sustituto de `../agent/memory/memoryStore` para vi.mock. */
export function sqliteMemoryStoreModule() {
  return {
    getMemoryDb: async () => device(activeKey).db,
    getMemoryDbEpoch: () => device(activeKey).epoch,
    writeMemoryTransaction: (work: (db: ExpoLikeDb) => Promise<void>): Promise<void> => {
      // Misma semántica de serialización que el módulo real: cadena de
      // escritores; cada writer corre su transacción real.
      const run = writeChain.then(async () => {
        const d = device(activeKey);
        d.raw.exec("BEGIN IMMEDIATE");
        try {
          await work(d.db);
          d.raw.exec("COMMIT");
        } catch (e) {
          try {
            d.raw.exec("ROLLBACK");
          } catch {
            /* rollback best-effort */
          }
          throw e;
        }
      });
      writeChain = run.catch(() => {});
      return run;
    },
  };
}

/** Acceso de bajo nivel al motor real (para inyectar fallos / inspeccionar). */
export function sqliteRaw(): DatabaseSync {
  return device(activeKey).raw;
}
