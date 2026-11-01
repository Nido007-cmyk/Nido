/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// @ts-nocheck
/**
 * H-11 + C-06 (tarjeta): los avisos de importación se leen de la base
 * al montar (sobreviven a la pantalla), se agrupan por razón con la
 * cadena de cada razón — no la agregada que ignoraba `reason`
 * (ADV2-05) —, se descartan por grupo, y el «importar de todos modos»
 * del caso 1-total vive solo en el momento de importar.
 *
 * El mundo es el módulo de documentImporter simulado con estado: la
 * tarjeta no importa nada en estas pruebas salvo la del momento; los
 * avisos llegan sembrados como filas persistidas.
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";

const holder = {
  collections: [] as any[],
  warnings: {} as Record<string, any[]>,
  dismissed: [] as Array<[string, string]>,
  importCalls: [] as any[],
  pickedFiles: null as any[] | null,
  nextImportResult: null as any,
};

jest.mock("../services/documentImporter", () => ({
  pickDocuments: async () => holder.pickedFiles,
  importDocuments: async (...args: any[]) => {
    holder.importCalls.push(args);
    return holder.nextImportResult;
  },
  exportCollection: async () => {},
  listCustomCollections: async () => holder.collections,
  setCustomCollectionActive: async () => {},
  deleteCustomCollection: async () => {},
  listImportWarnings: async (ids: string[]) => {
    const out: Record<string, any[]> = {};
    for (const id of ids) if (holder.warnings[id]) out[id] = holder.warnings[id];
    return out;
  },
  dismissImportWarnings: async (collectionId: string, reason: string) => {
    holder.dismissed.push([collectionId, reason]);
    holder.warnings[collectionId] = (holder.warnings[collectionId] ?? []).filter((w) => w.reason !== reason);
  },
  ensureImportFingerprintRegistry: async () => {},
}));

jest.mock("./theme", () => ({
  useTheme: () => ({
    typography: { ui: { body: {}, subtext: {} } },
    colors: {
      bg: { surface: "#000", cardElevated: "#111", subtle: "#222", terminal: "#333", card: "#111", modalOverlay: "rgba(0,0,0,0.5)" },
      text: { heading: "#fff", primary: "#fff", secondary: "#ccc", dim: "#999", accentCyan: "#0ff", accentEmerald: "#0f0", accentAmber: "#fa0", muted: "#888", inverse: "#000" },
      border: { default: "#444", subtle: "#555", elevated: "#666" },
      amber: { 600: "#B07C2A" },
      crimson: { 400: "#C05A44", 500: "#B3442F" },
      emerald: { 400: "#3ECF6F", 500: "#2F9E44", 600: "#227A35", bgSubtle: "rgba(47,158,68,0.10)" },
    },
  }),
}));

jest.mock("./components/icons/NidoIcon", () => ({
  NidoIcon: () => null,
}));

jest.mock("./components/calm/NidoMascot", () => ({
  NidoMascot: () => null,
}));

jest.mock("./components/PrivateTextInput", () => {
  const { TextInput } = require("react-native");
  return { PrivateTextInput: TextInput };
});

jest.mock("react-i18next", () => {
  const es = require("../i18n/locales/es.json");
  const dig = (obj: any, path: string) => path.split(".").reduce((o, k) => (o ? o[k] : undefined), obj);
  return {
    useTranslation: () => ({
      t: (key: string, opts: any = {}) => {
        let k = key;
        if (typeof opts.count === "number") {
          const plural = dig(es, `${key}_${opts.count === 1 ? "one" : "other"}`);
          if (typeof plural === "string") k = `${key}_${opts.count === 1 ? "one" : "other"}`;
        }
        const raw = dig(es, k);
        if (typeof raw !== "string") return key;
        return raw.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(opts[name] ?? ""));
      },
    }),
  };
});

import { PersonalDocumentsManager } from "./PersonalDocumentsManager";

const COL = {
  id: "c1",
  name: "Clínica",
  sourceFilename: "mixto.pdf",
  docCount: 2,
  chunkCount: 3,
  sizeBytes: 100,
  active: true,
  createdAt: 1,
  lastAccessed: 0,
};

beforeEach(() => {
  holder.collections = [{ ...COL }];
  holder.warnings = {};
  holder.dismissed = [];
  holder.importCalls = [];
  holder.pickedFiles = null;
  holder.nextImportResult = null;
});

describe("H-11: la tarjeta lee los avisos persistidos", () => {
  it("montaje fresco: enseña los avisos sembrados agrupados por razón, cada uno con su cadena", async () => {
    holder.warnings = {
      c1: [
        { name: "mixto.pdf", reason: "ocrFailed", ocrCode: "OCR_FAILED", ocrMessage: "engine died" },
        { name: "vacio.txt", reason: "noText" },
      ],
    };
    await render(<PersonalDocumentsManager />);
    // La línea de ocrFailed dice lo que pasó (no «no aportó texto»).
    expect(await screen.findByText(/no se pudo leer ni con el reconocimiento de texto \(OCR\): mixto\.pdf \(OCR_FAILED\)/)).toBeTruthy();
    // Y la de noText conserva su cadena de siempre.
    expect(screen.getByText(/1 documento no aportó texto: vacio\.txt/)).toBeTruthy();
  });

  it("dos razones × dos ficheros: dos líneas, nombres agrupados por razón", async () => {
    holder.warnings = {
      c1: [
        { name: "a.pdf", reason: "ocrFailed", ocrCode: "OCR_FAILED", ocrMessage: "boom" },
        { name: "b.pdf", reason: "ocrFailed", ocrCode: "OCR_FAILED", ocrMessage: "boom" },
        { name: "c.pdf", reason: "ocrEmpty" },
        { name: "d.pdf", reason: "ocrEmpty" },
      ],
    };
    await render(<PersonalDocumentsManager />);
    expect(await screen.findByText(/no se pudieron leer ni con el reconocimiento de texto \(OCR\): a\.pdf \(OCR_FAILED\), b\.pdf \(OCR_FAILED\)/)).toBeTruthy();
    expect(screen.getByText(/2 documentos: el reconocimiento no encontró texto en sus páginas escaneadas: c\.pdf, d\.pdf/)).toBeTruthy();
  });

  it("descartar un grupo: se borra ese grupo en la base y al remontar no vuelve; el otro queda", async () => {
    holder.warnings = {
      c1: [
        { name: "mixto.pdf", reason: "ocrFailed", ocrCode: "OCR_FAILED", ocrMessage: "engine died" },
        { name: "vacio.txt", reason: "noText" },
      ],
    };
    const first = await render(<PersonalDocumentsManager />);
    await screen.findByText(/no se pudo leer ni con el reconocimiento de texto/);
    const dismissButtons = screen.getAllByText("Descartar");
    expect(dismissButtons).toHaveLength(2);
    await fireEvent.press(dismissButtons[0]); // el grupo ocrFailed va primero
    expect(holder.dismissed).toEqual([["c1", "ocrFailed"]]);
    await first.unmount();
    const second = await render(<PersonalDocumentsManager />);
    expect(await second.findByText(/no aportó texto: vacio\.txt/)).toBeTruthy();
    expect(second.queryByText(/no se pudo leer ni con el reconocimiento/)).toBeNull();
    // Sin raíces vivas al cerrar: la limpieza automática de RNTL
    // desmonta tarde y una raíz rezagada arrastra al test siguiente.
    await second.unmount();
  });
});

describe("C-06: «importar de todos modos» vive solo en el momento", () => {
  it("tras un caso 1-total, la tarjeta ofrece la acción y al pulsarla reimporta forzando", async () => {
    holder.pickedFiles = [{ uri: "file:///nota.txt", name: "nota.txt", size: 10 }];
    holder.nextImportResult = {
      ...COL,
      duplicateImport: true,
      importWarnings: [{ name: "nota.txt", reason: "alreadyImported", previousName: "nota.txt" }],
    };
    holder.warnings = {
      c1: [{ name: "nota.txt", reason: "alreadyImported", previousName: "nota.txt" }],
    };
    const view = await render(<PersonalDocumentsManager />);
    // La tarjeta está montada cuando su aviso sembrado se lee de la base.
    await view.findByText(/ya estaba en esta colección/);
    // La persona escribe el nombre y pulsa importar.
    const input = view.getByPlaceholderText(/Nombre de la colección/);
    await fireEvent.changeText(input, "Otra");
    await fireEvent.press(await view.findByText("Elegir archivos e importar"));
    const anyway = await view.findByText("Importar de todos modos");
    await fireEvent.press(anyway);
    expect(holder.importCalls).toHaveLength(2);
    expect(holder.importCalls[1][3]).toEqual({ forceDuplicates: true });
  });
});
