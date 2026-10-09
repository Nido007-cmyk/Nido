/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock expo-file-system/legacy
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "/mock/",
  EncodingType: { UTF8: "utf8", Base64: "base64" },
  getInfoAsync: vi.fn(),
  copyAsync: vi.fn(),
  writeAsStringAsync: vi.fn(),
  readAsStringAsync: vi.fn(),
  deleteAsync: vi.fn(),
}));

vi.mock("../privacy/keyManager", () => ({
  getDatabaseKeyHex: vi.fn().mockResolvedValue("ab".repeat(32)),
}));

vi.mock("./secureDatabase", () => ({
  WAL_CHECKPOINT_SQL: "PRAGMA wal_checkpoint(TRUNCATE);",
}));

vi.mock("./databaseManager", () => ({
  getDatabase: vi.fn().mockResolvedValue({ execAsync: vi.fn() }),
  closeDatabase: vi.fn().mockResolvedValue(undefined),
}));

import * as FileSystem from "expo-file-system/legacy";
import { validateBackup, exportDatabaseKey } from "./backup";

describe("backup.ts — validación (BK-4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rechaza archivo inexistente", async () => {
    (FileSystem.getInfoAsync as any).mockResolvedValue({ exists: false });
    const r = await validateBackup("/no/existe.db");
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("no existe");
  });

  it("rechaza archivo demasiado pequeño", async () => {
    (FileSystem.getInfoAsync as any).mockResolvedValue({ exists: true, size: 100 });
    const r = await validateBackup("/pequeno.db");
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("pequeño");
  });

  it("rechaza archivo sin magic header SQLite (obsoleto - ahora usa trial-open)", async () => {
    // FIX 2026-10-09 (B13): el check de magic header se eliminó porque
    // SQLCipher cifra el header. Ahora se usa trial-open con el DEK.
    // Este test verifica que un archivo inválido sigue siendo rechazado
    // (por manifest corrupto, no por header).
    (FileSystem.getInfoAsync as any).mockResolvedValue({ exists: true, size: 5000 });
    (FileSystem.readAsStringAsync as any).mockResolvedValue("esto no es sqlite");
    const r = await validateBackup("/falso.db");
    expect(r.valid).toBe(false);
    // Ahora falla por manifest, no por header (el header ya no se verifica).
  });

  it("acepta archivo con magic header válido", async () => {
    (FileSystem.getInfoAsync as any).mockImplementation(async (uri: string) => {
      // El manifest no existe en este test (backup viejo sin manifest).
      if (uri.endsWith(".manifest.json")) return { exists: false };
      return { exists: true, size: 5000 };
    });
    (FileSystem.readAsStringAsync as any).mockResolvedValue("SQLite format 3\0 resto...");
    const r = await validateBackup("/valido.db");
    expect(r.valid).toBe(true);
    expect(r.sizeBytes).toBe(5000);
  });
});

describe("backup.ts — exportDatabaseKey", () => {
  it("retorna la clave en hex", async () => {
    const key = await exportDatabaseKey();
    expect(key).toBe("ab".repeat(32));
    expect(key.length).toBe(64);
  });
});
