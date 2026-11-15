/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * T-29 de la 0.1.99 — regresión de findLatestBackup.
 *
 * Defecto preexistente (era TESTFIX-2026-10-08) cazado por la
 * re-auditoría de la zona 4 fuera de sus asientos: findLatestBackup
 * filtraba `nido-backup-*.db` SIN excluir el `.knowledge.db`, y el
 * orden alfabético pone el de conocimiento el último: devolvía la
 * base de conocimiento como si fuera la principal. Esa ruta alimenta
 * el botón de compartir de ModelSetupScreen (shareBackupFile →
 * createPortableBundle, que deriva manifest y knowledge DE la
 * principal) y el guardado en carpeta (saveBackupToFolder deriva los
 * acompañantes con knowledgeBackupUriFor): el paquete portable salía
 * con la base equivocada. La poda de T-03, en el mismo fichero, sí
 * aplica la exclusión; findLatestBackup ahora aplica la misma.
 *
 * Mundo de mocks calcado del de la re-auditoría (zona4Poda.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const W = vi.hoisted(() => {
  const DOC = "file:///data/user/0/team.nido.app/files/";
  return {
    DOC,
    dirFiles: new Set<string>(),
    bundleSpy: vi.fn(async (uri: string) => `${uri}.bundle`),
    shareSpy: vi.fn(async (_uri: string) => {}),
  };
});
const DOC = W.DOC;

vi.mock("expo-sharing", () => ({
  isAvailableAsync: vi.fn(async () => true),
  shareAsync: (uri: string) => W.shareSpy(uri),
}));

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: W.DOC,
  readDirectoryAsync: async () => [...W.dirFiles],
  deleteAsync: async () => {},
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
  createBackup: vi.fn(async () => {}),
  exportDatabaseKey: vi.fn(async () => "la-clave-en-hex"),
  createPortableBundle: (uri: string) => W.bundleSpy(uri),
  knowledgeBackupUriFor: (uri: string) =>
    /\.db$/.test(uri) ? uri.replace(/\.db$/, ".knowledge.db") : `${uri}.knowledge.db`,
}));

vi.mock("../security/vaultBackupGate", () => ({
  recordBackupMade: vi.fn(async () => {}),
}));

vi.mock("../security/biometricGate", () => ({
  unlockForSecret: vi.fn(async () => "unlocked"),
}));

import { findLatestBackup, shareBackupFile } from "./backupShare";

function seedGroup(ts: string) {
  W.dirFiles.add(`nido-backup-${ts}.db`);
  W.dirFiles.add(`nido-backup-${ts}.knowledge.db`);
  W.dirFiles.add(`nido-backup-${ts}.db.manifest.json`);
}

beforeEach(() => {
  vi.clearAllMocks();
  W.dirFiles.clear();
});

describe("T-29 · findLatestBackup devuelve la base principal", () => {
  it("con un grupo completo, devuelve el .db principal y no el .knowledge.db", async () => {
    seedGroup("2026-03-01T00-00-00");
    const latest = await findLatestBackup();
    expect(latest).toBe(`${DOC}nido-backup-2026-03-01T00-00-00.db`);
  });

  it("con dos grupos, devuelve el principal del más reciente (el orden alfabético hacía ganar a su knowledge)", async () => {
    seedGroup("2026-02-01T00-00-00");
    seedGroup("2026-03-01T00-00-00");
    const latest = await findLatestBackup();
    expect(latest).toBe(`${DOC}nido-backup-2026-03-01T00-00-00.db`);
  });

  it("un .knowledge.db huérfano con marca posterior a todo principal no se devuelve", async () => {
    seedGroup("2026-03-01T00-00-00");
    W.dirFiles.add("nido-backup-2026-04-01T00-00-00.knowledge.db"); // huérfano, sin principal
    const latest = await findLatestBackup();
    expect(latest).toBe(`${DOC}nido-backup-2026-03-01T00-00-00.db`);
  });

  it("el grupo más reciente a medias (solo .db, creación interrumpida) sí es el último respaldo", async () => {
    seedGroup("2026-03-01T00-00-00");
    W.dirFiles.add("nido-backup-2026-04-01T00-00-00.db"); // sin knowledge ni manifest aún
    const latest = await findLatestBackup();
    expect(latest).toBe(`${DOC}nido-backup-2026-04-01T00-00-00.db`);
  });

  it("sin principales (solo un knowledge huérfano), devuelve null", async () => {
    W.dirFiles.add("nido-backup-2026-04-01T00-00-00.knowledge.db");
    expect(await findLatestBackup()).toBeNull();
  });

  it("el paquete portable de ModelSetupScreen se construye sobre la base principal", async () => {
    seedGroup("2026-02-01T00-00-00");
    seedGroup("2026-03-01T00-00-00");
    const latest = await findLatestBackup();
    expect(latest).not.toBeNull();
    await shareBackupFile(latest!);
    // createPortableBundle recibe la principal: de ella deriva el
    // manifest y el knowledge del bundle. Con el defecto recibía el
    // .knowledge.db y el bundle salía con la base equivocada.
    expect(W.bundleSpy).toHaveBeenCalledTimes(1);
    expect(W.bundleSpy).toHaveBeenCalledWith(`${DOC}nido-backup-2026-03-01T00-00-00.db`);
    expect(W.shareSpy).toHaveBeenCalledWith(`${DOC}nido-backup-2026-03-01T00-00-00.db.bundle`);
  });
});
