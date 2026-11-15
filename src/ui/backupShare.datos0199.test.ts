/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Tanda T-03 de la 0.1.99 (auditoría de la app 2026-11-14, carril 06):
 * - m-64: los respaldos locales `nido-backup-*` se acumulaban sin poda
 *   (N respaldos = N copias completas de las dos bases). Tras crear
 *   uno nuevo se conservan los 2 grupos más recientes y se borran los
 *   demás enteros (.db + .knowledge.db + .manifest.json).
 * - m-65 (decisión del dueño 2026-11-14): el bloqueo del dispositivo
 *   se exige SOLO para mostrar/exportar la clave. Sin bloqueo, el
 *   respaldo se crea igual, pero la clave no sale: createBackupFile
 *   ni siquiera la exporta y devuelve key: null.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const W = vi.hoisted(() => {
  const DOC = "file:///data/user/0/team.nido.app/files/";
  return {
    DOC,
    dirFiles: new Set<string>(),
    deleted: [] as string[],
    createBackupSpy: vi.fn(),
    exportDatabaseKeySpy: vi.fn(async () => "la-clave-en-hex"),
    unlockSpy: vi.fn(async (_reason: string): Promise<"unlocked" | "no-lock"> => "unlocked"),
  };
});
const DOC = W.DOC;

vi.mock("expo-sharing", () => ({
  isAvailableAsync: vi.fn(async () => true),
  shareAsync: vi.fn(async () => {}),
}));

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: W.DOC,
  readDirectoryAsync: async () => [...W.dirFiles],
  deleteAsync: async (uri: string) => {
    W.deleted.push(uri);
    W.dirFiles.delete(uri.replace(W.DOC, ""));
  },
  getInfoAsync: async (uri: string) => ({ exists: W.dirFiles.has(uri.replace(W.DOC, "")) }),
  readAsStringAsync: async () => "",
  writeAsStringAsync: async () => {},
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: vi.fn(async () => ({ granted: false })),
    createFileAsync: vi.fn(async () => ""),
  },
  EncodingType: { Base64: "base64", UTF8: "utf8" },
}));

vi.mock("../security/backup", () => ({
  createBackup: (...args: unknown[]) => W.createBackupSpy(...(args as [string])),
  exportDatabaseKey: (...args: unknown[]) => W.exportDatabaseKeySpy(...(args as [])),
  createPortableBundle: vi.fn(async (uri: string) => uri),
  knowledgeBackupUriFor: (uri: string) =>
    /\.db$/.test(uri) ? uri.replace(/\.db$/, ".knowledge.db") : `${uri}.knowledge.db`,
}));

vi.mock("../security/vaultBackupGate", () => ({
  recordBackupMade: vi.fn(async () => {}),
}));

vi.mock("../security/biometricGate", () => ({
  unlockForSecret: (reason: string) => W.unlockSpy(reason),
}));

import { createBackupFile, pruneLocalBackups } from "./backupShare";

function seedBackupGroup(ts: string) {
  W.dirFiles.add(`nido-backup-${ts}.db`);
  W.dirFiles.add(`nido-backup-${ts}.knowledge.db`);
  W.dirFiles.add(`nido-backup-${ts}.db.manifest.json`);
}

beforeEach(() => {
  vi.clearAllMocks();
  W.dirFiles.clear();
  W.deleted.length = 0;
  W.unlockSpy.mockResolvedValue("unlocked");
  W.createBackupSpy.mockImplementation(async (dest: string) => {
    const base = dest.replace(W.DOC, "");
    W.dirFiles.add(base);
    W.dirFiles.add(base.replace(/\.db$/, ".knowledge.db"));
    W.dirFiles.add(`${base}.manifest.json`);
  });
  W.exportDatabaseKeySpy.mockResolvedValue("la-clave-en-hex");
});

describe("m-64: poda de respaldos locales", () => {
  it("pruneLocalBackups conserva los 2 grupos más recientes y borra los viejos enteros", async () => {
    seedBackupGroup("2026-01-01T00-00-00");
    seedBackupGroup("2026-02-01T00-00-00");
    seedBackupGroup("2026-03-01T00-00-00");
    W.dirFiles.add("settings.json");
    const n = await pruneLocalBackups(2);
    expect(n).toBe(3); // el grupo entero de enero: 3 ficheros
    expect(W.deleted).toEqual(
      expect.arrayContaining([
        `${DOC}nido-backup-2026-01-01T00-00-00.db`,
        `${DOC}nido-backup-2026-01-01T00-00-00.knowledge.db`,
        `${DOC}nido-backup-2026-01-01T00-00-00.db.manifest.json`,
      ]),
    );
    expect(W.dirFiles.has("nido-backup-2026-02-01T00-00-00.db")).toBe(true);
    expect(W.dirFiles.has("nido-backup-2026-03-01T00-00-00.db")).toBe(true);
    expect(W.dirFiles.has("settings.json")).toBe(true);
  });

  it("con dos grupos o menos no borra nada", async () => {
    seedBackupGroup("2026-01-01T00-00-00");
    seedBackupGroup("2026-02-01T00-00-00");
    await expect(pruneLocalBackups(2)).resolves.toBe(0);
    expect(W.deleted).toEqual([]);
  });

  it("crear un respaldo nuevo poda los anteriores: quedan el nuevo y el último previo", async () => {
    seedBackupGroup("2026-01-01T00-00-00");
    seedBackupGroup("2026-02-01T00-00-00");
    seedBackupGroup("2026-03-01T00-00-00");
    const created = await createBackupFile("Crear backup");
    expect(W.dirFiles.has(created.path.replace(DOC, ""))).toBe(true);
    const remaining = [...W.dirFiles].filter(
      (f) => f.endsWith(".db") && !f.endsWith(".knowledge.db") && f.startsWith("nido-backup-"),
    );
    expect(remaining).toHaveLength(2);
    expect(W.dirFiles.has("nido-backup-2026-03-01T00-00-00.db")).toBe(true);
    expect(W.dirFiles.has("nido-backup-2026-01-01T00-00-00.db")).toBe(false);
    expect(W.dirFiles.has("nido-backup-2026-02-01T00-00-00.db")).toBe(false);
  });
});

describe("m-65: sin bloqueo del dispositivo la clave no sale", () => {
  it("con desbloqueo, devuelve la clave como siempre", async () => {
    W.unlockSpy.mockResolvedValue("unlocked");
    const created = await createBackupFile("Crear backup");
    expect(created.key).toBe("la-clave-en-hex");
    expect(created.noLock).toBe(false);
    expect(W.exportDatabaseKeySpy).toHaveBeenCalledTimes(1);
  });

  it("sin bloqueo: el respaldo se crea igual pero la clave ni se exporta", async () => {
    W.unlockSpy.mockResolvedValue("no-lock");
    const created = await createBackupFile("Crear backup");
    expect(W.createBackupSpy).toHaveBeenCalledTimes(1);
    expect(W.dirFiles.has(created.path.replace(DOC, ""))).toBe(true);
    expect(created.noLock).toBe(true);
    expect(created.key).toBeNull();
    expect(W.exportDatabaseKeySpy).not.toHaveBeenCalled();
  });

  it("si el usuario cancela el desbloqueo no se crea nada (comportamiento previo intacto)", async () => {
    W.unlockSpy.mockRejectedValue(new Error("cancelled"));
    await expect(createBackupFile("Crear backup")).rejects.toMatchObject({ code: "authCancelled" });
    expect(W.createBackupSpy).not.toHaveBeenCalled();
  });
});
