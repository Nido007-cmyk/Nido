/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// FIX 2026-10-09 (CR2-PATH, CR2-MULTIDB): tests para rotateAllDatabaseKeys.
// Verifica que:
// 1. Rota TODAS las DBs de MANAGED_DB_NAMES con el mismo DEK nuevo
// 2. El staging lista todas las rutas (no una sola)
// 3. Si el keystore falla, revierte TODAS las DBs

vi.mock("../privacy/keyManager", () => ({
  getDatabaseKeyHex: vi.fn().mockResolvedValue("a".repeat(64)),
}));

vi.mock("./biometricGate", () => ({
  requireUnlock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./secureDatabase", () => ({
  MANAGED_DB_NAMES: ["nido_memory.db", "nido_knowledge.db", "aoair_knowledge.db"],
  getCurrentDriver: vi.fn().mockReturnValue({
    dbDir: () => "/data/data/app/SQLite/",
    exists: vi.fn().mockResolvedValue(true),
  }),
}));

vi.mock("expo-crypto", () => ({
  getRandomBytesAsync: vi.fn().mockResolvedValue(new Uint8Array(32).fill(0x42)),
}));

const mockWrite = vi.fn();
const mockDelete = vi.fn();
vi.mock("expo-file-system/legacy", () => ({
  writeAsStringAsync: (...args: unknown[]) => mockWrite(...args),
  deleteAsync: (...args: unknown[]) => mockDelete(...args),
  documentDirectory: "/data/data/app/",
}));

describe("rotateAllDatabaseKeys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rota las 3 DBs con el mismo DEK nuevo", async () => {
    const { rotateAllDatabaseKeys } = await import("./keyRotation");
    const execCalls: { path: string; sql: string }[] = [];
    const openDb = vi.fn().mockImplementation(async (path: string) => ({
      exec: vi.fn().mockImplementation(async (sql: string) => {
        execCalls.push({ path, sql });
      }),
      close: vi.fn().mockResolvedValue(undefined),
    }));
    const storeDek = vi.fn().mockResolvedValue(undefined);

    const result = await rotateAllDatabaseKeys(openDb, storeDek, "/tmp/staging.json");

    expect(result.ok).toBe(true);
    // 3 DBs abiertas
    expect(openDb).toHaveBeenCalledTimes(3);
    // Cada una recibió PRAGMA rekey con el mismo DEK
    const rekeySqls = execCalls.filter(c => c.sql.includes("PRAGMA rekey"));
    expect(rekeySqls).toHaveLength(3);
    const deks = new Set(rekeySqls.map(c => c.sql));
    expect(deks.size).toBe(1); // mismo DEK para las 3
    // Keystore guardado una vez
    expect(storeDek).toHaveBeenCalledTimes(1);
  });

  it("el staging lista todas las rutas", async () => {
    const { rotateAllDatabaseKeys } = await import("./keyRotation");
    const openDb = vi.fn().mockResolvedValue({
      exec: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    });
    const storeDek = vi.fn().mockResolvedValue(undefined);

    await rotateAllDatabaseKeys(openDb, storeDek, "/tmp/staging.json");

    expect(mockWrite).toHaveBeenCalledTimes(1);
    const [, content] = mockWrite.mock.calls[0];
    const parsed = JSON.parse(content as string);
    expect(parsed.dbPaths).toHaveLength(3);
    expect(parsed.dbPaths[0]).toContain("nido_memory.db");
  });

  it("si el keystore falla, revierte las 3 DBs", async () => {
    const { rotateAllDatabaseKeys } = await import("./keyRotation");
    const execCalls: string[] = [];
    const openDb = vi.fn().mockResolvedValue({
      exec: vi.fn().mockImplementation(async (sql: string) => {
        execCalls.push(sql);
      }),
      close: vi.fn().mockResolvedValue(undefined),
    });
    const storeDek = vi.fn().mockRejectedValue(new Error("keystore fail"));

    const result = await rotateAllDatabaseKeys(openDb, storeDek, "/tmp/staging.json");

    expect(result.ok).toBe(false);
    // 3 rekeys + 3 reverts = 6 PRAGMA rekey
    const rekeys = execCalls.filter(s => s.includes("PRAGMA rekey"));
    expect(rekeys).toHaveLength(6);
  });

  it("solo rota las DBs que existen", async () => {
    const { getCurrentDriver } = await import("./secureDatabase");
    const driver = getCurrentDriver() as unknown as { exists: ReturnType<typeof vi.fn> };
    driver.exists.mockImplementation(async (path: string) =>
      path.includes("nido_memory.db")
    );

    const { rotateAllDatabaseKeys } = await import("./keyRotation");
    const openDb = vi.fn().mockResolvedValue({
      exec: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    });
    const storeDek = vi.fn().mockResolvedValue(undefined);

    const result = await rotateAllDatabaseKeys(openDb, storeDek, "/tmp/staging.json");

    expect(result.ok).toBe(true);
    expect(openDb).toHaveBeenCalledTimes(1);
  });
});
