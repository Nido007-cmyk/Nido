/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// __DEV__ es un global de React Native: se define para el entorno de test.
vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

vi.mock("expo-calendar", () => ({}));
vi.mock("expo-contacts", () => ({}));
vi.mock("expo-document-picker", () => ({}));
vi.mock("expo-file-system", () => ({ File: class {} }));
// settings.ts (vía i18n/index) importa expo-file-system/legacy a nivel de módulo.
vi.mock("expo-file-system/legacy", () => ({
  default: undefined,
  documentDirectory: "file:///docs/",
  getInfoAsync: vi.fn(async () => ({ exists: false, isDirectory: false, size: 0 })),
  readAsStringAsync: vi.fn(async () => {
    throw new Error("not found");
  }),
  writeAsStringAsync: vi.fn(async () => undefined),
  deleteAsync: vi.fn(async () => undefined),
}));
vi.mock("expo-sqlite", () => ({}));
vi.mock("react-native", () => ({ Linking: { openURL: vi.fn() }, Platform: { OS: "android" } }));

import i18n from "./index";

/**
 * i18n debt lane: prueba que todas las claves migradas (TD-12b + cuerdas
 * P1 antes hardcodeadas en español) resuelven en EN/ES/PT, y que bajo `es`
 * la salida es byte-idéntica a los literales anteriores (sin cambio de
 * comportamiento para usuarios en español).
 */

const ALL_KEYS: Array<{ key: string; vars?: Record<string, string> }> = [
  // TD-12b (M-5)
  { key: "agentConfirm.pairBindingKnownSameName", vars: { known: "Beto" } },
  { key: "agentConfirm.pairBindingKnownOtherName", vars: { known: "Beto", name: "Roberto" } },
  { key: "agentConfirm.pairBindingNameConflict", vars: { name: "Beto" } },
  // M-6 diálogos (antes solo en el fallback TS)
  { key: "agentConfirm.approveTaskTitle" },
  { key: "agentConfirm.approveTaskMessage", vars: { sender: "Beto (id ab12…)", action: "haz algo", when: "ayer" } },
  { key: "agentConfirm.rejectTaskTitle" },
  { key: "agentConfirm.rejectTaskMessage", vars: { sender: "Beto (id ab12…)", action: "haz algo" } },
  { key: "agentConfirm.taskNotFound" },
  // M-3
  { key: "agentConfirm.confirmBlocked", vars: { tool: "nido_pair" } },
  { key: "agentConfirm.confirmCancelled" },
  // M-6 salidas de herramientas
  { key: "agentTasks.reviewEmpty" },
  { key: "agentTasks.reviewHeader", vars: { count: "2" } },
  { key: "agentTasks.reviewItem", vars: { id: "t1", sender: "Beto", pkShort: "ab12cd34", action: "haz algo", when: "ayer" } },
  { key: "agentTasks.reviewFooter" },
  { key: "agentTasks.decideMissingId" },
  { key: "agentTasks.decideApproved", vars: { id: "t1" } },
  { key: "agentTasks.decideRejected", vars: { id: "t1" } },
  { key: "agentTasks.decideNotFound", vars: { id: "t1" } },
  { key: "agentTasks.unknownSender" },
  // M-4
  { key: "p2p.sendChatEmpty" },
  { key: "p2p.sendChatTooLong" },
  { key: "p2p.sendChatContactNotFound", vars: { name: "Nadie" } },
  { key: "p2p.sendChatContactAmbiguous", vars: { count: "2", name: "Beto", options: "• Beto (id ab12…)" } },
];

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("i18n: claves migradas resuelven en EN/ES/PT", () => {
  for (const lang of ["en", "es", "pt"] as const) {
    it(`todas las claves resuelven en ${lang} (sin claves crudas ni huecos)`, async () => {
      await i18n.changeLanguage(lang);
      for (const { key, vars } of ALL_KEYS) {
        const s = i18n.t(key, vars);
        expect(s, key).not.toBe(key);
        expect(s, key).not.toBe("");
        expect(s, key).not.toMatch(/\{\{\w+\}\}/);
      }
    });
  }

  it("EN es el idioma por defecto (English-first)", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("agentConfirm.confirmCancelled")).toBe("Understood, I did nothing.");
  });
});

describe("i18n: sin cambio de comportamiento bajo español (byte-idéntico)", () => {
  // Nota: en vitest el `require("../../i18n")` perezoso de handlers/confirm
  // no resuelve (usa el respaldo inglés, patrón preexistente). La prueba de
  // cableado (handlers → clave) corre en inglés en pairConfirm.test.ts; aquí
  // se prueba que el catálogo en español contiene byte-idénticos los
  // literales que antes estaban hardcodeados.
  beforeEach(async () => {
    await i18n.changeLanguage("es");
  });

  it("TD-12b: advertencia identidad conocida (mismo nombre) idéntica al literal anterior", async () => {
    expect(i18n.t("agentConfirm.pairBindingKnownSameName", { known: "Beto" })).toBe(
      "Esta identidad ya está emparejada como «Beto».",
    );
    expect(
      i18n.t("agentConfirm.pairBindingKnownOtherName", { known: "Beto", name: "Roberto" }),
    ).toBe("Esta identidad ya está emparejada como «Beto» (no como «Roberto»).");
  });

  it("TD-12b: advertencia OTRA identidad idéntica al literal anterior", async () => {
    expect(i18n.t("agentConfirm.pairBindingNameConflict", { name: "Beto" })).toBe(
      "Atención: ya tienes un contacto llamado «Beto» con OTRA identidad. " +
        "Solo confirma si escaneaste este código en persona, del dispositivo real.",
    );
  });

  it("M-3: confirmBlockedMessage en español idéntico al literal anterior", async () => {
    expect(i18n.t("agentConfirm.confirmBlocked", { tool: "nido_pair" })).toBe(
      "Bloqueado por seguridad: «nido_pair» requiere confirmación explícita " +
        "del usuario, pero el canal de confirmación no está disponible. " +
        "La acción NO se ejecutó.",
    );
    expect(i18n.t("agentConfirm.confirmCancelled")).toBe("Entendido, no hice nada.");
  });

  it("M-6: claves de diálogo que antes solo existían en el fallback inglés ahora resuelven en español", async () => {
    expect(i18n.t("agentConfirm.approveTaskTitle")).toBe("Aprobar tarea de NIDO");
    expect(i18n.t("agentConfirm.taskNotFound")).toBe(
      "No hay ninguna tarea pendiente con ese id (quizá ya se decidió).",
    );
  });

  it("M-6: salidas de herramientas en español idénticas a los literales anteriores", async () => {
    expect(i18n.t("agentTasks.reviewEmpty")).toBe(
      "No hay tareas NIDO pendientes de aprobación.",
    );
    expect(i18n.t("agentTasks.reviewHeader", { count: "2" })).toBe(
      "Tareas NIDO pendientes de tu aprobación (2):",
    );
    expect(i18n.t("agentTasks.decideApproved", { id: "t1" })).toBe(
      "Tarea t1 aprobada y registrada. No se ejecutó nada automáticamente.",
    );
    expect(i18n.t("agentTasks.decideRejected", { id: "t1" })).toBe(
      "Tarea t1 rechazada y registrada.",
    );
    expect(i18n.t("agentTasks.decideNotFound", { id: "t1" })).toBe(
      "No hay ninguna tarea pendiente con id «t1» (quizá ya se decidió).",
    );
    expect(i18n.t("agentTasks.decideMissingId")).toBe(
      "Error: indica el id de la tarea (ver nido_review_tasks).",
    );
  });

  it("M-4: errores de sendChat en español idénticos a los literales anteriores", async () => {
    expect(i18n.t("p2p.sendChatEmpty")).toBe("El mensaje está vacío.");
    expect(i18n.t("p2p.sendChatTooLong")).toBe("Mensaje demasiado largo (máx. 4000 caracteres).");
    expect(i18n.t("p2p.sendChatContactNotFound", { name: "Nadie" })).toBe(
      'No tienes ningún contacto NIDO llamado "Nadie". Empareja primero escaneando su QR.',
    );
    expect(
      i18n.t("p2p.sendChatContactAmbiguous", {
        count: "2",
        name: "Beto",
        options: "• Beto (id ab12cd34…)",
      }),
    ).toBe(
      'Hay 2 contactos NIDO llamados "Beto". No sé a cuál te refieres; elige uno:\n• Beto (id ab12cd34…)',
    );
  });

  it("approvalInbox: remitente desconocido en español idéntico al literal anterior", async () => {
    expect(i18n.t("agentTasks.unknownSender")).toBe("Contacto NIDO desconocido");
  });
});

describe("i18n: portugués resuelve las claves de seguridad", () => {
  it("PT: advertencias y bloqueos en portugués", async () => {
    await i18n.changeLanguage("pt");
    expect(i18n.t("agentConfirm.pairBindingKnownSameName", { known: "Beto" })).toContain(
      "já está pareada",
    );
    expect(i18n.t("agentConfirm.confirmBlocked", { tool: "nido_pair" })).toContain(
      "Bloqueado por segurança",
    );
    expect(i18n.t("agentTasks.reviewEmpty")).toBe("Não há tarefas do NIDO aguardando aprovação.");
    expect(i18n.t("p2p.sendChatEmpty")).toBe("A mensagem está vazia.");
  });
});
