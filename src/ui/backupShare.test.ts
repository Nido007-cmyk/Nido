/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// TESTFIX-2026-10-08 (Fix 6): el share sheet debe invocarse con el URI
// correcto del archivo del backup.
const shareAsync = vi.fn();
const isAvailableAsync = vi.fn();

vi.mock("expo-sharing", () => ({
  isAvailableAsync: (...args: unknown[]) => isAvailableAsync(...args),
  shareAsync: (...args: unknown[]) => shareAsync(...args),
}));

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///data/user/0/team.nido.app/files/",
  readDirectoryAsync: async () => [
    "nido-backup-2026-10-08T01-00-00.db",
    "nido-backup-2026-10-09T01-01-29.db",
    "other-file.txt",
  ],
}));

vi.mock("../security/backup", () => ({
  createBackup: vi.fn(),
  exportDatabaseKey: vi.fn(async () => "test-key"),
  createPortableBundle: vi.fn(async (uri: string) => uri.replace(/\.db$/, ".nidobackup.json")),
}));

import { shareBackupFile, findLatestBackup } from "./backupShare";

describe("backupShare (Fix 6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shareBackupFile invoca el share sheet con el URI del archivo", async () => {
    isAvailableAsync.mockResolvedValue(true);
    shareAsync.mockResolvedValue(undefined);
    const path = "file:///data/user/0/team.nido.app/files/nido-backup-2026-10-09T01-01-29.db";
    await shareBackupFile(path);
    expect(isAvailableAsync).toHaveBeenCalled();
    expect(shareAsync).toHaveBeenCalledTimes(1);
    // FIX 2026-10-09 (CR-1): ahora comparte el bundle, no el .db directo.
    expect(shareAsync).toHaveBeenCalledWith(path.replace(/\.db$/, ".nidobackup.json"));
  });

  it("shareBackupFile lanza si el compartido no está disponible", async () => {
    isAvailableAsync.mockResolvedValue(false);
    await expect(
      shareBackupFile("file:///x.db")
    ).rejects.toThrow("sharing-unavailable");
    expect(shareAsync).not.toHaveBeenCalled();
  });

  it("findLatestBackup devuelve el backup más reciente", async () => {
    const latest = await findLatestBackup();
    expect(latest).toBe(
      "file:///data/user/0/team.nido.app/files/nido-backup-2026-10-09T01-01-29.db"
    );
  });
});
