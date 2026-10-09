/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { rotateDatabaseKey } from "./keyRotation";

// Mock biometricGate
vi.mock("./biometricGate", () => ({
  requireUnlock: vi.fn(),
}));

// Mock keyManager
vi.mock("../privacy/keyManager", () => ({
  getDatabaseKeyHex: vi.fn(),
  registerKeyLossProbe: vi.fn(),
}));

// Mock secureDatabase (evita ciclo con keyManager en tests)
vi.mock("./secureDatabase", () => ({
  MANAGED_DB_NAMES: ["nido_memory.db"],
  getCurrentDriver: vi.fn().mockReturnValue({
    dbDir: () => "/tmp/",
    exists: vi.fn().mockResolvedValue(true),
  }),
}));

// Mock expo-crypto
vi.mock("expo-crypto", () => ({
  getRandomBytesAsync: vi.fn(),
}));

import { requireUnlock } from "./biometricGate";
import { getDatabaseKeyHex } from "../privacy/keyManager";
import { getRandomBytesAsync } from "expo-crypto";

const OLD_DEK = "a".repeat(64);
const NEW_DEK_BYTES = new Uint8Array(32).fill(0x42);

function mockDb() {
  const execCalls: string[] = [];
  return {
    execCalls,
    db: {
      exec: vi.fn(async (sql: string) => {
        execCalls.push(sql);
      }),
      close: vi.fn(async () => {}),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUnlock).mockResolvedValue(undefined);
  vi.mocked(getDatabaseKeyHex).mockResolvedValue(OLD_DEK);
  vi.mocked(getRandomBytesAsync).mockResolvedValue(NEW_DEK_BYTES);
});

describe("F-KEY-1: rotación de DEK", () => {
  it("flujo feliz: rekey + guarda nueva clave", async () => {
    const { db, execCalls } = mockDb();
    const openDb = vi.fn(async () => db);
    const storeDek = vi.fn(async () => {});

    const result = await rotateDatabaseKey("/db/path", openDb, storeDek);

    expect(result.ok).toBe(true);
    expect(openDb).toHaveBeenCalledWith("/db/path", OLD_DEK);
    // Debe haber un PRAGMA rekey con la nueva clave
    expect(execCalls.some((s) => s.includes("PRAGMA rekey"))).toBe(true);
    expect(storeDek).toHaveBeenCalled();
    expect(db.close).toHaveBeenCalled();
  });

  it("biométrico cancelado → no hace nada", async () => {
    vi.mocked(requireUnlock).mockRejectedValue(new Error("cancelled"));
    const openDb = vi.fn();
    const storeDek = vi.fn();

    const result = await rotateDatabaseKey("/db/path", openDb, storeDek);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("cancelada");
    expect(openDb).not.toHaveBeenCalled();
  });

  it("sin DEK actual → fail-closed", async () => {
    vi.mocked(getDatabaseKeyHex).mockResolvedValue(null);
    const openDb = vi.fn();
    const storeDek = vi.fn();

    const result = await rotateDatabaseKey("/db/path", openDb, storeDek);

    expect(result.ok).toBe(false);
    expect(openDb).not.toHaveBeenCalled();
  });

  it("falla Keystore → revierte rekey a la vieja", async () => {
    const { db, execCalls } = mockDb();
    const openDb = vi.fn(async () => db);
    const storeDek = vi.fn(async () => {
      throw new Error("Keystore lleno");
    });

    const result = await rotateDatabaseKey("/db/path", openDb, storeDek);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("revirtió");
    // Debe haber DOS rekeys: uno a la nueva, uno de vuelta a la vieja
    const rekeys = execCalls.filter((s) => s.includes("PRAGMA rekey"));
    expect(rekeys.length).toBe(2);
    // El segundo debe contener la clave vieja
    expect(rekeys[1]).toContain(OLD_DEK);
  });
});
