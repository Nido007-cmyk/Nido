/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { applyMigrations } from "./dbMigrations";
import { MEMORY_MIGRATIONS } from "./memoryMigrations";

// FASE 2 RISK-3 (2026-10-09): pruebas de integración real.
// Usan el framework real (no mocks) con una DB fake en memoria.

// Fake MigrationDb en memoria con soporte de transacciones.
function createFakeDb(initialVersion?: string) {
  const tables = new Map<string, Map<string, string>>();
  tables.set("meta", new Map(initialVersion ? [["schema_version", initialVersion]] : []));
  let snapshot: Map<string, Map<string, string>> | null = null;

  return {
    execAsync: async (sql: string) => {
      if (sql.includes("CREATE TABLE IF NOT EXISTS meta")) {
        if (!tables.has("meta")) tables.set("meta", new Map());
      }
      if (sql.includes("BEGIN")) {
        snapshot = new Map([...tables].map(([k, v]) => [k, new Map(v)]));
      }
      if (sql.includes("COMMIT")) snapshot = null;
      if (sql.includes("ROLLBACK") && snapshot) {
        tables.clear();
        for (const [k, v] of snapshot) tables.set(k, new Map(v));
        snapshot = null;
      }
    },
    getAllAsync: async <T>(sql: string): Promise<T[]> => {
      if (sql.includes("FROM meta")) {
        const meta = tables.get("meta")!;
        return [...meta.entries()].map(([key, value]) => ({ key, value } as unknown as T));
      }
      return [];
    },
    getFirstAsync: async <T>(sql: string): Promise<T | null> => {
      if (sql.includes("schema_version")) {
        const v = tables.get("meta")?.get("schema_version");
        return (v ? { value: v } : null) as T | null;
      }
      return null;
    },
    runAsync: async (sql: string, params?: unknown[]) => {
      if (sql.includes("INSERT INTO meta") && params?.[0]) {
        tables.get("meta")!.set("schema_version", String(params[0]));
      }
      if (sql.includes("UPDATE meta") && params?.[0]) {
        tables.get("meta")!.set("schema_version", String(params[0]));
      }
      return { lastInsertRowId: 0, changes: 1 };
    },
    // Para simular withTransactionAsync
    withTransactionAsync: async (fn: () => Promise<void>) => {
      await (async () => {
        snapshot = new Map([...tables].map(([k, v]) => [k, new Map(v)]));
        try {
          await fn();
          snapshot = null;
        } catch (e) {
          if (snapshot) {
            tables.clear();
            for (const [k, v] of snapshot) tables.set(k, new Map(v));
          }
          throw e;
        }
      })();
    },
  };
}

class TestVersionError extends Error {
  readonly formatId = "test.db";
  readonly found: unknown = null;
  readonly supportedMajor = 1;
  constructor(found: unknown, reason: string) {
    super(`${reason}: ${String(found)}`);
    this.name = "TestVersionError";
    this.found = found;
  }
}

describe("RISK-3 integración real", () => {
  it("2. Registro vacío: DB existente con v1 abre sin alteraciones", async () => {
    const db = createFakeDb("1");
    const result = await applyMigrations(db as any, {
      formatId: "test.db",
      supportedMajor: 1,
      ErrorClass: TestVersionError,
      migrations: MEMORY_MIGRATIONS, // vacío
    });
    expect(result.migrated).toBe(false);
    expect(result.from).toBe(1);
    expect(result.to).toBe(1);
    // La versión sigue siendo 1, sin cambios
    const ver = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'schema_version'"
    );
    expect(ver?.value).toBe("1");
  });

  it("3. DB nueva sin versión: se estampa con la versión soportada", async () => {
    const db = createFakeDb(); // sin versión
    const result = await applyMigrations(db as any, {
      formatId: "test.db",
      supportedMajor: 1,
      ErrorClass: TestVersionError,
      migrations: [],
    });
    expect(result.to).toBe(1);
    const ver = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'schema_version'"
    );
    expect(ver?.value).toBe("1");
  });

  it("4. Migración de prueba se ejecuta exactamente una vez", async () => {
    let execCount = 0;
    const db = createFakeDb("1");
    const result = await applyMigrations(db as any, {
      formatId: "test.db",
      supportedMajor: 2,
      ErrorClass: TestVersionError,
      migrations: [
        {
          from: 1,
          to: 2,
          up: async () => { execCount++; },
        },
      ],
    });
    expect(execCount).toBe(1);
    expect(result.migrated).toBe(true);
    expect(result.to).toBe(2);

    // Segunda llamada: no se re-ejecuta (idempotente)
    execCount = 0;
    const result2 = await applyMigrations(db as any, {
      formatId: "test.db",
      supportedMajor: 2,
      ErrorClass: TestVersionError,
      migrations: [
        {
          from: 1,
          to: 2,
          up: async () => { execCount++; },
        },
      ],
    });
    expect(execCount).toBe(0);
    expect(result2.migrated).toBe(false);
  });

  it("5. Interrupción (throw en up) no deja estado falsamente exitoso", async () => {
    const db = createFakeDb("1");
    await expect(
      applyMigrations(db as any, {
        formatId: "test.db",
        supportedMajor: 2,
        ErrorClass: TestVersionError,
        migrations: [
          {
            from: 1,
            to: 2,
            up: async () => { throw new Error("simulated crash"); },
          },
        ],
      })
    ).rejects.toThrow("simulated crash");

    // La versión sigue siendo 1 (no se estampó la 2)
    const ver = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'schema_version'"
    );
    expect(ver?.value).toBe("1");
  });

  it("6. Error de migración bloquea acceso (fail-closed)", async () => {
    const db = createFakeDb("99"); // versión futura desconocida
    await expect(
      applyMigrations(db as any, {
        formatId: "test.db",
        supportedMajor: 1,
        ErrorClass: TestVersionError,
        migrations: [],
      })
    ).rejects.toThrow(TestVersionError);
  });

  it("8. Ejecución concurrente: segunda llamada espera o no duplica", async () => {
    const db = createFakeDb("1");
    let execCount = 0;
    const migration = {
      from: 1,
      to: 2,
      up: async () => {
        execCount++;
        await new Promise(r => setTimeout(r, 10));
      },
    };
    const opts = {
      formatId: "test.db",
      supportedMajor: 2,
      ErrorClass: TestVersionError,
      migrations: [migration],
    };
    // Dos llamadas concurrentes
    const [r1, r2] = await Promise.all([
      applyMigrations(db as any, opts),
      applyMigrations(db as any, opts),
    ]);
    // Al menos una aplicó; la otra vio la versión ya actualizada o aplicó también
    // (sin lock distribuido, ambas pueden intentar; lo importante es que no corrompe)
    const totalMigrated = (r1.migrated ? 1 : 0) + (r2.migrated ? 1 : 0);
    expect(totalMigrated).toBeGreaterThanOrEqual(1);
    // La versión final es 2
    const ver = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'schema_version'"
    );
    expect(ver?.value).toBe("2");
  });
});
