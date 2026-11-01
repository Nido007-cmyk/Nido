/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * wipeCensus.test.ts — guardia permanente del inventario del borrado
 * total (carril F-REV, tras la revisión adversaria de la 0.1.67).
 *
 * La familia F-REV era de INVENTARIO, no de mecanismo: el borrado
 * verifica con fuerza todo lo que conoce, pero su inventario
 * (DOC_LEFTOVER_FILES en appReset.ts) es un conjunto cerrado que
 * nadie actualizó cuando F3-11 y F3-10 crearon ficheros nuevos en el
 * mismo delta que lo ampliaba. Dos veces pasó en silencio; esta
 * prueba existe para que la tercera sea imposible.
 *
 * Diseño (y por qué no «derivar el inventario solo»): el inventario
 * canónico sigue siendo el de appReset.ts y esta prueba lo IMPORTA
 * de verdad — nada de listas paralelas que se pudran por separado.
 * Lo que la prueba hace es el censo: escanea las fuentes (TS/TSX de
 * src/ y Kotlin de modules/, sin tests ni fixtures), extrae todo
 * literal con forma de nombre de fichero y exige que cada nombre
 * quede clasificado en exactamente una de estas clases:
 *
 *   INVENTARIO  — lo recogen los predicados reales del wipe
 *                 (isDocLeftover / isSqliteLeftover importados).
 *   VERIFICADO  — ficheros que el wipe borra y comprueba por nombre
 *                 fuera del inventario de restos (ajustes, journal y
 *                 las tres bases SQLite con sus sufijos).
 *   DIRECTORIO  — nombres que solo existen dentro de un directorio
 *                 que el wipe borra entero (tabla con el directorio).
 *   FRAGMENTO   — colas de derivaciones cuyo nombre completo siempre
 *                 cuelga de una base ya recogida (tabla con la razón).
 *   EXCLUIDO    — nombres que no son ficheros de los datos de la app
 *                 (tabla con la razón, p. ej. salidas de herramientas
 *                 de desarrollo en la máquina, no en el teléfono).
 *
 * Un productor nuevo que cree un fichero sin clasificar hace FALLAR
 * esta prueba y nombra el fichero y su procedencia: clasificarlo
 * (inventario, directorio o exclusión razonada) es una decisión
 * humana visible en el diff, nunca un olvido silencioso.
 */

import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// El grafo de appReset necesita los mismos mocks que appReset.test.ts
// para cargar en Node; aquí solo se usan sus constantes y predicados.
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  cacheDirectory: "file:///cache/",
  getInfoAsync: async () => ({ exists: false }),
  deleteAsync: async () => {},
  writeAsStringAsync: async () => {},
  readAsStringAsync: async () => "",
  makeDirectoryAsync: async () => {},
  readDirectoryAsync: async () => [],
}));
vi.mock("expo-sqlite", () => ({ deleteDatabaseAsync: async () => {} }));
vi.mock("../inference/LlamaEngine", () => ({ llamaEngine: { unload: async () => {} } }));
vi.mock("../rag/embed", () => ({ embeddingEngine: { unload: async () => {} } }));
vi.mock("../rag/packs", () => ({ closeAllPacks: async () => {} }));
vi.mock("./downloadManager", () => ({
  resetDownloadState: () => {},
  cancelAllDownloads: async () => {},
}));
vi.mock("expo-notifications", () => ({
  cancelAllScheduledNotificationsAsync: async () => {},
  getAllScheduledNotificationsAsync: async () => [],
  dismissAllNotificationsAsync: async () => {},
  getPresentedNotificationsAsync: async () => [],
}));

import { DOC_LEFTOVER_FILES, isDocLeftover, isSqliteLeftover } from "./appReset";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ---------------------------------------------------------------------------
// Censo: extracción de candidatos desde las fuentes
// ---------------------------------------------------------------------------

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:json|txt|db|sqlite|jsonl|nvi|gguf|tmp)$/;
const LITERAL_RE = /"([^"\n]{1,200})"|'([^'\n]{1,200})'|`([^`\n]{1,200})`/g;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

function sourceFiles(): string[] {
  const out: string[] = [];
  for (const p of walk(join(ROOT, "src"))) {
    if (!/\.(ts|tsx)$/.test(p)) continue;
    if (/\.test\.(ts|tsx)$/.test(p) || /\.component\.test\.(ts|tsx)$/.test(p)) continue;
    if (p.includes("__fixtures__")) continue;
    out.push(p);
  }
  for (const p of walk(join(ROOT, "modules"))) {
    if (!p.endsWith(".kt")) continue;
    if (p.split("/").includes("test") || p.includes("node_modules")) continue;
    out.push(p);
  }
  return out;
}

/** Mapa nombre → ficheros que lo mencionan como literal. */
function census(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  const add = (name: string, file: string) => {
    const rel = file.slice(ROOT.length + 1);
    (found.get(name) ?? found.set(name, new Set()).get(name)!).add(rel);
  };
  for (const file of sourceFiles()) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      for (const m of line.matchAll(LITERAL_RE)) {
        const content = m[1] ?? m[2] ?? m[3] ?? "";
        if (content.includes("://")) continue; // URLs: no son ficheros locales
        if (NAME_RE.test(content)) {
          add(content, file);
        } else if (content.includes("${")) {
          // Plantilla: el nombre puede ser la cola estática tras la
          // última interpolación (`${dir}pending.json`).
          const tail = content.slice(content.lastIndexOf("}") + 1);
          if (NAME_RE.test(tail)) add(tail, file);
        }
      }
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Clasificación: todo lo que no recogen los predicados reales, con razón
// ---------------------------------------------------------------------------

/** Borrados y verificados por nombre fuera del inventario de restos. */
const VERIFIED_FILES = new Set([
  "settings.json", // SETTINGS_FILE: clearSettings + checkGone en appReset
  "nido-install-state.json", // installStatePath(): borrado + checkGone
  "nido_knowledge.db", // bases SQLite: nombre × DB_SUFFIXES, verificadas
  "aoair_knowledge.db", // (nombre heredado pre-rebrand, mismo trato)
  "nido_memory.db",
]);

/** Solo existen dentro de un directorio que el wipe borra entero. */
const DIR_SCOPED: Record<string, string> = {
  "pending.json": "eval/ (EVAL_REQUESTS_DIR cuelga de EVAL_RESULTS_DIR)",
  "status.json": "eval/ (las *.status.json de deviceEvalRequest)",
  "resume.json": "models/ (cola de <modelo>.gguf.resume.json, modelTrust)",
};

/**
 * Colas de derivación: el nombre completo siempre cuelga de una base
 * recogida por los predicados (prefijos nido-backup-/restored) o de una
 * base SQLite verificada; el fragmento suelto nunca es un fichero.
 */
const FRAGMENTS: Record<string, string> = {
  "manifest.json": "sufijo .manifest.json de nido-backup-*.db y restored.db-*",
  "knowledge.db": "cola de la derivación knowledgeBackupUriFor sobre bases recogidas",
  "X.knowledge.db": "forma con marcador de knowledgeBackupUriFor (X = base recogida)",
  "X.db.knowledge.db": "forma con marcador de knowledgeBackupUriFor (X.db = base recogida)",
  "nido_memory_knowledge.db": "knowledgeBackupUriFor sobre la base SQLite verificada",
};

/** No son ficheros de los datos de la app en el teléfono. */
const EXCLUDED: Record<string, string> = {
  "anon.jsonl":
    "herramienta de evaluación ciega (blindCore, node:fs): sale en la máquina de desarrollo, no en el directorio de documentos",
  "nido-backup.db":
    "nombre de reserva del destino SAF en backupShare (createFileAsync sobre la carpeta que elige el usuario); la copia real lleva la forma con sello nido-backup-<fecha>.db, recogida por prefijo, y este literal nunca nombra un fichero dentro de los datos de la app",
};

function classify(name: string): string | null {
  if (DOC_LEFTOVER_FILES.has(name) || isDocLeftover(name) || isSqliteLeftover(name))
    return "inventario";
  if (VERIFIED_FILES.has(name)) return "verificado";
  if (name in DIR_SCOPED) return `directorio (${DIR_SCOPED[name]})`;
  if (name in FRAGMENTS) return `fragmento (${FRAGMENTS[name]})`;
  if (name in EXCLUDED) return `excluido (${EXCLUDED[name]})`;
  return null;
}

describe("guardia de censo del borrado total (carril F-REV)", () => {
  it("todo nombre de fichero del código está recogido por el borrado o clasificado con razón", () => {
    const found = census();
    // El censo debe ver a los productores conocidos: si el escáner se
    // rompe y devuelve poco, la guardia no puede pasar en falso.
    for (const known of [
      "feature-flags.json",
      "settings-recovered.json",
      "nido-crash-guard.json",
      "nido-last-crash.txt",
      "restored.knowledge.db",
    ]) {
      expect(found.has(known), `el censo debe encontrar ${known}`).toBe(true);
    }
    const unclassified: string[] = [];
    for (const [name, files] of [...found.entries()].sort()) {
      if (classify(name) === null) {
        unclassified.push(`${name}  ←  ${[...files].sort().join(", ")}`);
      }
    }
    expect(
      unclassified,
      "ficheros sin clasificar: o el borrado total los recoge (appReset.ts) " +
        "o esta prueba los clasifica con su razón (directorio/fragmento/excluido):\n" +
        unclassified.join("\n"),
    ).toEqual([]);
  });

  it("las familias dinámicas quedan dentro de los predicados reales", () => {
    // Miembros sintéticos de cada familia con nombre construido por
    // interpolación (el censo de literales no los ve enteros): si un
    // predicado deja de cubrir su familia, esto lo caza.
    for (const n of [
      "nido-backup-2099-01-01T00-00-00.db",
      "nido-backup-2099.db.manifest.json",
      "nido-backup-2099.db.knowledge.db",
      "restored.db-m1abc-zz9",
      "restored.db-m1abc-zz9.manifest.json",
      "restored.db-m1abc-zz9.knowledge.db",
      "restored.db-m1abc-zz9.tmp-m1abc-zz9",
      "restored.knowledge.db",
    ]) {
      expect(isDocLeftover(n), `${n} debe ser resto de documentos`).toBe(true);
    }
    for (const n of [
      "nido_memory.db.pre-restore-2099-01-01",
      "nido-restore-123.db",
      "nido-restore-k-123.db",
    ]) {
      expect(isSqliteLeftover(n), `${n} debe ser resto de SQLite`).toBe(true);
    }
  });

  it("las familias dinámicas siguen vivas en sus productores", () => {
    // Si un productor dejara de producir su familia, el predicado que
    // la cubre quedaría guardando un fantasma y la familia real
    // podría llamarse de otra forma sin que nadie lo notara. Cada
    // familia se busca en el fichero que la escribe de verdad.
    const backup = readFileSync(join(ROOT, "src", "security", "backup.ts"), "utf8");
    const backupShare = readFileSync(join(ROOT, "src", "ui", "backupShare.ts"), "utf8");
    expect(backupShare.includes("nido-backup-"), "backupShare.ts crea los nido-backup-<fecha>.db").toBe(true);
    for (const head of ["nido-restore-", ".pre-restore-", "restored"]) {
      expect(backup.includes(head), `backup.ts debe seguir produciendo ${head}`).toBe(true);
    }
  });
});
