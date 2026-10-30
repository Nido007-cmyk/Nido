/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/** D9 (29-10-2026): la bóveda solo se activa con un respaldo de los últimos 30 días. */
import { describe, expect, it } from "vitest";
import {
  assertRecentBackup,
  isBackupRecent,
  NoRecentBackupError,
  recordBackupMade,
  VAULT_BACKUP_MAX_AGE_MS,
  type BackupDateStore,
} from "./vaultBackupGate";

function mem(): BackupDateStore & { v: string | null } {
  const s = {
    v: null as string | null,
    async get() {
      return s.v;
    },
    async set(x: string) {
      s.v = x;
    },
  };
  return s;
}

const NOW = 1_800_000_000_000;

describe("respaldo antes de la bóveda", () => {
  it("sin respaldo, no se activa", async () => {
    await expect(assertRecentBackup(NOW, mem())).rejects.toBeInstanceOf(NoRecentBackupError);
  });

  it("con un respaldo de hoy, sí", async () => {
    const st = mem();
    await recordBackupMade(NOW, st);
    await expect(assertRecentBackup(NOW + 1000, st)).resolves.toBeUndefined();
  });

  it("un respaldo de hace más de 30 días ya no vale", () => {
    expect(isBackupRecent(String(NOW - VAULT_BACKUP_MAX_AGE_MS - 1), NOW)).toBe(false);
    expect(isBackupRecent(String(NOW - VAULT_BACKUP_MAX_AGE_MS + 1), NOW)).toBe(true);
  });

  it("una fecha rara o del futuro no cuenta", () => {
    expect(isBackupRecent("ayer", NOW)).toBe(false);
    expect(isBackupRecent(String(NOW + 3_600_000), NOW)).toBe(false);
    expect(isBackupRecent("0", NOW)).toBe(false);
  });

  it("si SecureStore falla al guardar, no lanza (y la bóveda lo pedirá otra vez)", async () => {
    const broken: BackupDateStore = {
      get: async () => {
        throw new Error("x");
      },
      set: async () => {
        throw new Error("x");
      },
    };
    await expect(recordBackupMade(NOW, broken)).resolves.toBeUndefined();
    await expect(assertRecentBackup(NOW, broken)).rejects.toMatchObject({ code: "E_NO_RECENT_BACKUP" });
  });
});
