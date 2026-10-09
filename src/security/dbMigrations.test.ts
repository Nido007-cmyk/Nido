/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi } from "vitest";
import {
  applyMigrations,
  MigrationPathMissingError,
  type DbMigration,
  type MigrationDb,
} from "./dbMigrations";
import { FormatVersionError } from "./formatVersion";
import { MEMORY_MIGRATIONS } from "./memoryMigrations";

/** Error nombrado de prueba (imita a MemoryDbVersionError). */
class TestVersionError extends FormatVersionError {
  constructor(found: unknown, reason: string) {
    super("test.db", found, 99, reason);
    this.name = "TestVersionError";
  }
}

/**
 * Fake en memoria de MigrationDb. Solo entiende el SQL que emite el motor
 * (CREATE meta, SELECT/INSERT/UPDATE de schema_version) más un registro de
 * llamadas para que los tests verifiquen el orden de las migraciones.
 * withTransactionAsync hace snapshot/restore de `meta` para simular rollback.
 */
function makeFakeDb(initialVersion?: string): MigrationDb & {
  calls: string[];
  getVersion(): string | null;
} {
  let version: string | null = initialVersion ?? null;
  const calls: string[] = [];
  const snapshot = () => version;
  const restore = (s: string | null) => {
    version = s;
  };
  return {
    calls,
    getVersion: () => version,
    execAsync: async (sql: string) => {
      calls.push(`exec:${sql.slice(0, 40)}`);
      // CREATE TABLE IF NOT EXISTS meta → no-op en el fake.
    },
    getAllAsync: async () => [],
    getFirstAsync: async <T,>(sql: string): Promise<T | null> => {
      calls.push("getFirst:schema_version");
      if (!sql.includes("schema_version")) return null;
      return (version === null ? null : ({ value: version } as unknown as T));
    },
    runAsync: async (sql: string, params?: unknown[]) => {
      calls.push(`run:${sql.slice(0, 24)}:${String(params?.[0] ?? "")}`);
      if (sql.startsWith("INSERT INTO meta")) {
        version = String(params?.[0] ?? "");
      } else if (sql.startsWith("UPDATE meta")) {
        version = String(params?.[0] ?? "");
      }
      return { lastInsertRowId: 0, changes: 1 };
    },
    withTransactionAsync: async (task: () => Promise<void>) => {
      const s = snapshot();
      try {
        await task();
      } catch (e) {
        restore(s);
        throw e;
      }
    },
  };
}

const OPTS = {
  formatId: "test.db",
  supportedMajor: 3,
  ErrorClass: TestVersionError,
};

describe("applyMigrations", () => {
  it("instalación nueva: estampa supportedMajor, migrated=false", async () => {
    const db = makeFakeDb();
    const res = await applyMigrations(db, { ...OPTS, migrations: [] });
    expect(res).toEqual({ migrated: false, from: 3, to: 3 });
    expect(db.getVersion()).toBe("3");
  });

  it("versión actual: no-op", async () => {
    const db = makeFakeDb("3");
    const res = await applyMigrations(db, { ...OPTS, migrations: [] });
    expect(res).toEqual({ migrated: false, from: 3, to: 3 });
    expect(db.calls.filter((c) => c.startsWith("run:"))).toHaveLength(0);
  });

  it("acepta string numérico ('2' → 2)", async () => {
    const db = makeFakeDb("2");
    const mig: DbMigration = {
      from: 2,
      to: 3,
      up: async () => {},
    };
    const res = await applyMigrations(db, { ...OPTS, migrations: [mig] });
    expect(res).toEqual({ migrated: true, from: 2, to: 3 });
    expect(db.getVersion()).toBe("3");
  });

  it("encadena migraciones 1→2→3 en orden y estampa cada paso", async () => {
    const db = makeFakeDb("1");
    const order: string[] = [];
    const migrations: DbMigration[] = [
      { from: 1, to: 2, up: async () => { order.push("1→2"); } },
      { from: 2, to: 3, up: async () => { order.push("2→3"); } },
    ];
    const res = await applyMigrations(db, { ...OPTS, migrations });
    expect(res).toEqual({ migrated: true, from: 1, to: 3 });
    expect(order).toEqual(["1→2", "2→3"]);
    expect(db.getVersion()).toBe("3");
  });

  it("una migración puede saltar varios majors (1→3 directo)", async () => {
    const db = makeFakeDb("1");
    const migrations: DbMigration[] = [{ from: 1, to: 3, up: async () => {} }];
    const res = await applyMigrations(db, { ...OPTS, migrations });
    expect(res).toEqual({ migrated: true, from: 1, to: 3 });
  });

  it("sin camino: MigrationPathMissingError (fail-closed)", async () => {
    const db = makeFakeDb("1");
    const err = await applyMigrations(db, { ...OPTS, migrations: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(MigrationPathMissingError);
    expect((err as Error).name).toBe("MigrationPathMissingError");
    expect((err as MigrationPathMissingError).from).toBe(1);
    expect((err as MigrationPathMissingError).to).toBe(3);
    // Nada se escribió: la versión sigue intacta.
    expect(db.getVersion()).toBe("1");
  });

  it("hueco en la cadena (solo 2→3, actual=1): MigrationPathMissingError", async () => {
    const db = makeFakeDb("1");
    const migrations: DbMigration[] = [{ from: 2, to: 3, up: async () => {} }];
    await expect(applyMigrations(db, { ...OPTS, migrations })).rejects.toBeInstanceOf(
      MigrationPathMissingError,
    );
  });

  it("versión más nueva: ErrorClass nombrado, nunca downgrade", async () => {
    const db = makeFakeDb("99");
    const err = await applyMigrations(db, { ...OPTS, migrations: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(TestVersionError);
    expect((err as Error).name).toBe("TestVersionError");
    expect(db.getVersion()).toBe("99");
  });

  it("versión corrupta: ErrorClass nombrado", async () => {
    const db = makeFakeDb("no-es-un-numero");
    const err = await applyMigrations(db, { ...OPTS, migrations: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(TestVersionError);
  });

  it("fallo en up(): revierte el stamp, el error se propaga", async () => {
    const db = makeFakeDb("1");
    const boom = new Error("DDL roto");
    const migrations: DbMigration[] = [
      {
        from: 1,
        to: 2,
        up: async () => {
          throw boom;
        },
      },
      { from: 2, to: 3, up: async () => {} },
    ];
    const err = await applyMigrations(db, { ...OPTS, migrations }).catch((e) => e);
    expect(err).toBe(boom);
    // El stamp sigue en 1: el próximo arranque reintenta desde un estado válido.
    expect(db.getVersion()).toBe("1");
  });

  it("up() recibe el handle para DDL/DML", async () => {
    const db = makeFakeDb("2");
    const seen: string[] = [];
    const migrations: DbMigration[] = [
      {
        from: 2,
        to: 3,
        up: async (h) => {
          await h.execAsync("ALTER TABLE facts ADD COLUMN lang TEXT;");
          seen.push("up-called");
        },
      },
    ];
    await applyMigrations(db, { ...OPTS, migrations });
    expect(seen).toEqual(["up-called"]);
    expect(db.calls.some((c) => c.includes("ALTER TABLE"))).toBe(true);
  });

  describe("validación del registro (falla rápido, bug de programador)", () => {
    it("to <= from → Error", async () => {
      const db = makeFakeDb("1");
      const migrations: DbMigration[] = [{ from: 2, to: 2, up: async () => {} }];
      await expect(applyMigrations(db, { ...OPTS, migrations })).rejects.toThrow(
        /debe avanzar/,
      );
    });

    it("from duplicado → Error", async () => {
      const db = makeFakeDb("1");
      const migrations: DbMigration[] = [
        { from: 1, to: 2, up: async () => {} },
        { from: 1, to: 3, up: async () => {} },
      ];
      await expect(applyMigrations(db, { ...OPTS, migrations })).rejects.toThrow(
        /ambiguo/,
      );
    });

    it("to > supportedMajor → Error", async () => {
      const db = makeFakeDb("1");
      const migrations: DbMigration[] = [{ from: 1, to: 4, up: async () => {} }];
      await expect(applyMigrations(db, { ...OPTS, migrations })).rejects.toThrow(
        /supera supportedMajor/,
      );
    });

    it("supportedMajor inválido → Error", async () => {
      const db = makeFakeDb();
      await expect(
        applyMigrations(db, { ...OPTS, supportedMajor: 0, migrations: [] }),
      ).rejects.toThrow(/supportedMajor/);
    });
  });
});

describe("MEMORY_MIGRATIONS (L1)", () => {
  it("registro vacío: applyMigrations es idéntico al check anterior", async () => {
    expect(MEMORY_MIGRATIONS).toEqual([]);
    const v1 = makeFakeDb("1");
    const res = await applyMigrations(v1, {
      formatId: "nido_memory.db",
      supportedMajor: 1,
      ErrorClass: TestVersionError,
      migrations: MEMORY_MIGRATIONS,
    });
    expect(res).toEqual({ migrated: false, from: 1, to: 1 });
  });

  it("v0 sin camino → MigrationPathMissingError (no MemoryDbVersionError silencioso)", async () => {
    const v0 = makeFakeDb("0");
    await expect(
      applyMigrations(v0, {
        formatId: "nido_memory.db",
        supportedMajor: 1,
        ErrorClass: TestVersionError,
        migrations: MEMORY_MIGRATIONS,
      }),
    ).rejects.toBeInstanceOf(MigrationPathMissingError);
  });
});
