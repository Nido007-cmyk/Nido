/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * T-11 (0.1.99) · sondas de handlers contra el almacén REAL (driver
 * falso respaldado por node:sqlite, mismo patrón que
 * memoryStore.r1.test.ts):
 *
 * - m-15: remember_fact recortaba en silencio a 500 y confirmaba el
 *   texto íntegro. La confirmación debe citar lo GUARDADO y avisar del
 *   recorte. Mismo patrón para las notas de persona de save_person.
 * - P-08: device_time siempre respondía en español por la vía del
 *   modelo; debe usar el idioma de la UI, como su vecino.
 * - P-10(b): create_reminder con un `at` no vacío e imposible guardaba
 *   el recordatorio SIN fecha y lo presentaba como éxito. Debe
 *   devolver un error y no guardar nada. (Desde T-10 el dispatcher ya
 *   rechaza el `at` no ISO; esto es la segunda línea, en el handler.)
 * - P-11: use_skill devolvía un imperativo («Sigue estas
 *   instrucciones») que el bucle envuelve en un bloque <untrusted>:
 *   una orden dentro de un bloque definido como «solo datos». El
 *   contenido debe presentarse como documento, sin moverlo a un canal
 *   confiable.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

const fx = vi.hoisted(() => ({ DOC: "file:///docs/" }));

vi.mock("expo-sqlite", () => ({
  deleteDatabaseAsync: async () => {},
}));

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: fx.DOC,
  getInfoAsync: async () => ({ exists: false }),
  moveAsync: async () => {
    throw new Error("move no usado en estos tests");
  },
  deleteAsync: async () => {},
}));

vi.mock("expo-calendar", () => ({}));
vi.mock("expo-contacts", () => ({}));
vi.mock("expo-document-picker", () => ({}));
vi.mock("expo-file-system", () => ({ File: class {} }));
vi.mock("react-native", () => ({
  Linking: { openURL: vi.fn(async () => {}) },
  Platform: { OS: "android" },
}));

vi.mock("../../privacy/keyManager", async () => {
  const { fakeKeyManagerModule } = await import("../../security/secureDbTestHarness");
  return fakeKeyManagerModule();
});

import { setSecureDbTestDriver } from "../../security/secureDatabase";
import { makeNodeSqliteHandle } from "../../security/secureDbTestHarness";
import { getMemoryDb, clearMemoryDb, getFacts, getPeople, listReminders } from "../memory/memoryStore";
import { buildToolHandlers, setHandlerLangForTest } from "./handlers";
import { listSkills, loadSkill } from "../skills/registry";

let tmpDirs: string[] = [];

function useFreshDb(): void {
  const dir = mkdtempSync(join(tmpdir(), "nido-t11-memory-"));
  tmpDirs.push(dir);
  const dbPath = join(dir, "nido_memory.db");
  setSecureDbTestDriver({
    dbDir: () => `${fx.DOC}SQLite/`,
    openDb: async (path: string) => {
      if (!path.includes("nido_memory.db")) throw new Error(`DB inesperada: ${path}`);
      return makeNodeSqliteHandle(dbPath);
    },
    exists: async (path: string) =>
      path.includes("nido_memory.db") ? existsSync(dbPath) : false,
    remove: async () => {},
    rename: async () => {
      throw new Error("rename no usado en estos tests");
    },
    writeFile: async () => {
      throw new Error("writeFile no usado en estos tests");
    },
  });
}

beforeEach(async () => {
  tmpDirs = [];
  setSecureDbTestDriver({
    dbDir: () => `${fx.DOC}SQLite/`,
    openDb: async () => {
      throw new Error("openDb no usado en beforeEach");
    },
    exists: async () => false,
    remove: async () => {},
    rename: async () => {},
    writeFile: async () => {},
  });
  await clearMemoryDb();
  useFreshDb();
  await clearMemoryDb();
  await getMemoryDb();
  setHandlerLangForTest("es");
});

afterEach(() => {
  setHandlerLangForTest(null);
  setSecureDbTestDriver(null);
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

const handlers = () => buildToolHandlers({ requestConfirm: async () => true });

describe("m-15: la confirmación de remember_fact cita lo guardado, no lo pedido", () => {
  it("un hecho de 600 caracteres se confirma con los 500 guardados y con aviso de recorte", async () => {
    const content = "x".repeat(600);
    const out = await handlers()["remember_fact"]({ content, category: "general" });
    const facts = await getFacts(10);
    expect(facts).toHaveLength(1);
    expect(facts[0].content).toHaveLength(500);
    expect(out).toContain("x".repeat(500));
    expect(out).not.toContain("x".repeat(501));
    expect(out).toMatch(/recort/i);
  });

  it("un hecho corto se confirma tal cual y SIN aviso de recorte", async () => {
    const out = await handlers()["remember_fact"]({
      content: "mi perro se llama Toby",
      category: "general",
    });
    expect(out).toContain("mi perro se llama Toby");
    expect(out).not.toMatch(/recort/i);
  });

  it("las notas de una persona también avisan si se recortan", async () => {
    const notes = "n".repeat(600);
    const out = await handlers()["save_person"]({ name: "Ana", notes });
    const people = await getPeople();
    expect(people).toHaveLength(1);
    expect(people[0].notes).toHaveLength(500);
    expect(out).toMatch(/recort/i);
  });
});

describe("P-08: device_time responde en el idioma de la UI", () => {
  it("español (control)", async () => {
    setHandlerLangForTest("es");
    const out = await handlers()["device_time"]({});
    expect(out).toContain("Ahora son las");
  });

  it("inglés", async () => {
    setHandlerLangForTest("en");
    const out = await handlers()["device_time"]({});
    expect(out).not.toContain("Ahora son las");
    expect(out).toMatch(/It is now|The time is/i);
  });

  it("portugués", async () => {
    setHandlerLangForTest("pt");
    const out = await handlers()["device_time"]({});
    expect(out).not.toContain("Ahora son las");
    expect(out).toMatch(/Agora são/i);
  });
});

describe("P-10(b): create_reminder con `at` imposible no guarda nada", () => {
  it("at no vacío e imposible → error observable y almacén vacío", async () => {
    const out = await handlers()["create_reminder"]({
      text: "llamar al banco",
      at: "basura no fecha",
    });
    expect(out).toMatch(/^Error/);
    expect(await listReminders(10)).toHaveLength(0);
  });

  it("control: una fecha ISO futura sí se guarda, con fecha", async () => {
    const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const out = await handlers()["create_reminder"]({ text: "regar las plantas", at: future });
    expect(out).toContain("Recordatorio guardado");
    const reminders = await listReminders(10);
    expect(reminders).toHaveLength(1);
    expect(reminders[0].due_at).toBeTruthy();
  });

  it("control: sin `at` se sigue guardando sin fecha (pedido legítimo)", async () => {
    const out = await handlers()["create_reminder"]({ text: "comprar pan" });
    expect(out).toContain("Recordatorio guardado");
    expect(await listReminders(10)).toHaveLength(1);
  });
});

describe("P-11: use_skill presenta su contenido como documento, no como orden", () => {
  it("el resultado no contiene el imperativo «Sigue estas instrucciones» y sí el contenido íntegro", async () => {
    const first = listSkills()[0];
    expect(first).toBeTruthy();
    const skill = loadSkill(first.name);
    expect(skill).toBeTruthy();
    const out = await handlers()["use_skill"]({ name: first.name });
    expect(out).not.toContain("Sigue estas instrucciones");
    expect(out).toContain(first.name);
    expect(out).toContain(skill!.instructions.slice(0, 60));
  });
});
