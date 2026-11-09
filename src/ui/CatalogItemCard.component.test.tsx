/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// @ts-nocheck
// CatalogItemCard: la insignia de compatibilidad ES el veredicto de
// la vía de carga (0.1.86): «red» significa que ningún peldaño de
// contexto cabe en este aparato, ni el de emergencia con KV q8. La
// tarjeta, sin embargo, ofrecía «Descargar recurso» (y «Reintentar»)
// también a los rojos: 4,4 GB que el aparato jamás podrá cargar.
// 0.1.90: sin botón de descarga ni de reintento cuando la
// compatibilidad es «red»; en verde el botón sigue y funciona.
// La RAM fijada es la de la Tab A9+ del dueño (3416 MiB), cuyos
// veredictos están censados en src/models/compatibility.test.ts:
// Qwen2.5-7B = red, Qwen3-0.6B = green.
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";

jest.mock("./theme", () => ({
  useTheme: () => ({
    colors: {
      bg: { cardElevated: "#111", subtle: "#222", modalOverlay: "rgba(0,0,0,0.5)", terminal: "#333" },
      text: { heading: "#fff", primary: "#eee", secondary: "#bbb", dim: "#888", accentEmerald: "#0f0", accentAmber: "#fa0", accentCyan: "#0ff" },
      border: { default: "#333", subtle: "#444" },
      emerald: { 400: "#0f0", border: "#0a0", bgSubtle: "#021" },
      crimson: { 400: "#f66", border: "#a00", bgSubtle: "#200" },
      amber: { border: "#a80", bgSubtle: "#220" },
      cyan: { border: "#088", bgSubtle: "#022" },
    },
    typography: {
      ui: { titleSm: { fontSize: 15 }, caption: { fontSize: 12 }, body: { fontSize: 14 } },
      mono: { xs: { fontSize: 10 } },
    },
  }),
}));

jest.mock("../services/haptics", () => ({
  impact: () => {},
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? k,
    i18n: { language: "es" },
  }),
}));

jest.mock("ram-monitor", () => ({
  // La Tab A9+ del dueño: su RAM total real (3416 MiB).
  getDeviceTotalRamBytes: () => 3416 * 1024 * 1024,
}));

jest.mock("./components/icons/NidoIcon", () => ({ NidoIcon: () => null }));

jest.mock("../rag/corpusIndexStatus", () => ({
  getCorpusIndexStatus: () => ({}),
  onCorpusIndexStatus: () => () => {},
}));

jest.mock("../utils/safeFormat", () => ({
  displayLang: () => "es",
  formatInt: (n: number) => String(n),
}));

const { CatalogItemCard } = require("./CatalogItemCard");
const { MODEL_CATALOG } = require("../models/manifest");
const byId = (id: string) => MODEL_CATALOG.find((m) => m.id === id);

const baseProps = {
  isActive: false,
  onDownload: () => {},
  onUse: () => {},
  onRemove: () => {},
};

describe("CatalogItemCard: botón de descarga según compatibilidad", () => {
  it("un modelo en rojo («Demasiado pesado») NO ofrece descargar", async () => {
    await render(<CatalogItemCard item={byId("qwen2.5-7b-instruct-q4km")} row={undefined} {...baseProps} />);
    // La insignia roja sí se pinta (es el veredicto honesto)…
    expect(await screen.findByText("catalogItemCard.compat.red")).toBeTruthy();
    // …pero no hay botón de descarga: el archivo no podría cargarse jamás aquí.
    expect(screen.queryByText("catalogItemCard.downloadAsset")).toBeNull();
  });

  it("un modelo en rojo con un error previo tampoco ofrece reintentar", async () => {
    const row = { present: false, downloading: false, progress: 0, error: "falló la red" };
    await render(<CatalogItemCard item={byId("qwen2.5-7b-instruct-q4km")} row={row} {...baseProps} />);
    expect(await screen.findByText("catalogItemCard.compat.red")).toBeTruthy();
    expect(screen.queryByText("catalogItemCard.retryDownload")).toBeNull();
    expect(screen.queryByText("catalogItemCard.downloadAsset")).toBeNull();
  });

  it("un modelo en verde sí ofrece descargar, y el toque llama a onDownload", async () => {
    const onDownload = jest.fn();
    await render(
      <CatalogItemCard item={byId("qwen3-0.6b-q4km")} row={undefined} {...baseProps} onDownload={onDownload} />
    );
    const btn = await screen.findByText("catalogItemCard.downloadAsset");
    expect(btn).toBeTruthy();
    expect(screen.getByText("catalogItemCard.compat.green")).toBeTruthy();
    fireEvent.press(btn);
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onDownload.mock.calls[0][0].id).toBe("qwen3-0.6b-q4km");
  });
});

describe("CatalogItemCard: la familia 3 en la tarjeta", () => {
  it("recién descargado y verificado: ofrece «Seleccionar y usar», nunca «Descargar recurso»", async () => {
    // La aceptación literal del dueño (15:38 MST): tras completarse y
    // verificarse una descarga, la tarjeta ofrece la acción existente
    // «Seleccionar y usar» y su toque llama a onUse.
    const onUse = jest.fn();
    const onDownload = jest.fn();
    const row = { present: true, downloading: false, progress: 0, error: null };
    await render(
      <CatalogItemCard item={byId("qwen3-0.6b-q4km")} row={row} {...baseProps} onUse={onUse} onDownload={onDownload} />
    );
    const btn = await screen.findByText("catalogItemCard.selectUse");
    expect(btn).toBeTruthy();
    expect(screen.queryByText("catalogItemCard.downloadAsset")).toBeNull();
    fireEvent.press(btn);
    expect(onUse).toHaveBeenCalledTimes(1);
    expect(onUse.mock.calls[0][0].id).toBe("qwen3-0.6b-q4km");
    expect(onDownload).not.toHaveBeenCalled();
  });

  it("el aviso durable del motivo se pinta cuando la fila lo trae", async () => {
    const row = {
      present: false,
      downloading: false,
      progress: 0,
      error: null,
      statusNotice: "El archivo está en el dispositivo pero no se pudo comprobar.",
    };
    await render(<CatalogItemCard item={byId("qwen3-0.6b-q4km")} row={row} {...baseProps} />);
    expect(await screen.findByText("El archivo está en el dispositivo pero no se pudo comprobar.")).toBeTruthy();
  });

  it("con un error en memoria, el aviso durable no compite: manda el error", async () => {
    const row = {
      present: false,
      downloading: false,
      progress: 0,
      error: "La descarga se interrumpió después de 0 bytes",
      statusNotice: "La última descarga se interrumpió antes de terminar.",
    };
    await render(<CatalogItemCard item={byId("qwen3-0.6b-q4km")} row={row} {...baseProps} />);
    expect(await screen.findByText("La descarga se interrumpió después de 0 bytes")).toBeTruthy();
    expect(screen.queryByText("La última descarga se interrumpió antes de terminar.")).toBeNull();
  });
});
