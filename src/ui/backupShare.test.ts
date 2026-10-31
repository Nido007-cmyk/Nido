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
const requestDirectoryPermissionsAsync = vi.fn();
const createFileAsync = vi.fn();
const getInfoAsync = vi.fn();
const readAsStringAsync = vi.fn();
const writeAsStringAsync = vi.fn();

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
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: (...args: unknown[]) =>
      requestDirectoryPermissionsAsync(...args),
    createFileAsync: (...args: unknown[]) => createFileAsync(...args),
  },
  getInfoAsync: (...args: unknown[]) => getInfoAsync(...args),
  readAsStringAsync: (...args: unknown[]) => readAsStringAsync(...args),
  writeAsStringAsync: (...args: unknown[]) => writeAsStringAsync(...args),
  EncodingType: { Base64: "base64", UTF8: "utf8" },
}));

vi.mock("../security/backup", () => ({
  createBackup: vi.fn(),
  exportDatabaseKey: vi.fn(async () => "test-key"),
  createPortableBundle: vi.fn(async (uri: string) => uri.replace(/\.db$/, ".nidobackup.json")),
  // La función real está fijada en backup.test.ts (A2): "X.db" ->
  // "X.knowledge.db". Aquí se reproduce su contrato para probar que
  // backupShare la usa en vez de concatenar el nombre a mano.
  knowledgeBackupUriFor: (uri: string) =>
    /\.db$/.test(uri) ? uri.replace(/\.db$/, ".knowledge.db") : `${uri}.knowledge.db`,
}));

import { shareBackupFile, findLatestBackup, saveBackupToFolder } from "./backupShare";

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

describe("saveBackupToFolder (guardar en carpeta, 2026-10-12)", () => {
  const src = "file:///data/user/0/team.nido.app/files/nido-backup-2026-10-09T01-01-29.db";

  beforeEach(() => {
    vi.clearAllMocks();
    requestDirectoryPermissionsAsync.mockResolvedValue({
      granted: true,
      directoryUri: "content://tree/downloads",
    });
    createFileAsync.mockImplementation(
      async (_dir: string, fileName: string) => `content://tree/downloads/${fileName}`
    );
    readAsStringAsync.mockResolvedValue("BASE64DATA");
    writeAsStringAsync.mockResolvedValue(undefined);
  });

  it("copia db + manifest + knowledge cuando los tres existen", async () => {
    // F3-02: el mock de existencia responde por NOMBRE, como el disco
    // real: solo existen los tres ficheros que createBackup escribe.
    // Con el nombre equivocado ("X.db.knowledge.db") el conocimiento
    // no se encontraba y esta prueba quedaba en rojo.
    const existing = new Set([
      src,
      `${src}.manifest.json`,
      src.replace(/\.db$/, ".knowledge.db"),
    ]);
    getInfoAsync.mockImplementation(async (uri: string) => ({ exists: existing.has(uri) }));
    const copied = await saveBackupToFolder(src);
    expect(copied).toEqual([
      "nido-backup-2026-10-09T01-01-29.db",
      "nido-backup-2026-10-09T01-01-29.db.manifest.json",
      "nido-backup-2026-10-09T01-01-29.knowledge.db",
    ]);
    expect(writeAsStringAsync).toHaveBeenCalledTimes(3);
  });

  it("copia solo la db cuando los acompañantes no existen", async () => {
    getInfoAsync.mockResolvedValue({ exists: false });
    const copied = await saveBackupToFolder(src);
    expect(copied).toEqual(["nido-backup-2026-10-09T01-01-29.db"]);
    expect(writeAsStringAsync).toHaveBeenCalledTimes(1);
  });

  it("devuelve null sin copiar nada si no se concede el permiso", async () => {
    requestDirectoryPermissionsAsync.mockResolvedValue({ granted: false });
    const copied = await saveBackupToFolder(src);
    expect(copied).toBeNull();
    expect(createFileAsync).not.toHaveBeenCalled();
    expect(writeAsStringAsync).not.toHaveBeenCalled();
  });
});
