/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// 0.1.108 (pasada de la 0.1.107, Tab A9+): la fórmula de memoria NO
// se toca; la superficie de la tarjeta, sí. Tres defectos, tres
// regresiones:
//  A1 · la foto viva de la tarjeta no traía el crédito liberable que
//       la carga real sí aplica (LlamaEngine.loadNow): el modelo
//       ACTIVO se juzgaba cargándose encima de sí mismo y salía con
//       «Currently in use» y «Needs a lot of memory» a la vez. Con el
//       residente declarado en la prop `residentLoad`, su tarjeta
//       aplica el crédito y el veredicto es el de la carga.
//  A2 · la foto viva se tomaba una vez al montar y no se refrescaba
//       nunca: al cambiar el modelo activo (una carga/descarga acaba
//       de ocurrir) la foto se rehace.
//  A3 · el chip «Default» era la bandera estática `required` del
//       catálogo y nombraba al 1.5B, que en esta tableta ni siquiera
//       cabe: el chip solo se pinta en el default calculado para la
//       RAM del aparato (defaultLlmForRam): en la Tab, el 0.5B Q4.
// La foto viva de estos tests es la banda de la pasada: RSS de
// 868 MiB (la app en uso, con el modelo residente dentro) y término
// en vivo holgado, para que mande la cuenta por total (≈500 MiB
// disponibles): sin crédito el Qwen3 sale amarillo; con su crédito
// (693,8 MiB en su techo de 2048), verde. La canónica de la Tab no
// cambia: los pequeños verdes en vacío y el 1.5B en rojo, como fija
// el censo de src/models/compatibility.test.ts.
import { jest, describe, it, expect } from "@jest/globals";
import React from "react";
import { render, screen } from "@testing-library/react-native";

jest.mock("./theme", () => ({
  useTheme: () => ({
    colors: {
      id: "nightgarden",
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

// La Tab A9+ del dueño (3416 MiB) con la lectura en vivo mutable: los
// tests mueven mockRssBytes para cambiar la foto entre renders.
let mockRssBytes = 868 * 1024 * 1024;
jest.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => 3416 * 1024 * 1024,
  getMemoryInfo: () => ({ rssBytes: mockRssBytes, totalPssBytes: mockRssBytes }),
  getAvailableMemory: () => ({ availBytes: 2 * 1024 * 1024 * 1024, thresholdBytes: 216 * 1024 * 1024 }),
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
const byId = (id: string) => MODEL_CATALOG.find((m: { id: string }) => m.id === id);

const baseProps = {
  isActive: false,
  onDownload: () => {},
  onUse: () => {},
  onRemove: () => {},
};

describe("CatalogItemCard 0.1.108 · A1: el crédito del residente", () => {
  it("sin crédito declarado, la foto de la pasada juzga al Qwen3 en amarillo", async () => {
    await render(<CatalogItemCard item={byId("qwen3-0.6b-q4km")} row={undefined} {...baseProps} />);
    expect(await screen.findByText("catalogItemCard.compat.yellow")).toBeTruthy();
    expect(screen.queryByText("catalogItemCard.compat.green")).toBeNull();
  });

  it("la tarjeta del ACTIVO con su residente declarado aplica el crédito: verde", async () => {
    await render(
      <CatalogItemCard
        item={byId("qwen3-0.6b-q4km")}
        row={undefined}
        {...baseProps}
        isActive
        residentLoad={{ model: byId("qwen3-0.6b-q4km"), nCtx: 2048, memoryProfile: "default" }}
      />
    );
    expect(await screen.findByText("catalogItemCard.compat.green")).toBeTruthy();
    expect(screen.queryByText("catalogItemCard.compat.yellow")).toBeNull();
  });

  // Sucesión (tanda too-heavy, pasada de la 0.1.115): el caso de la
  // 0.1.108 decía «el crédito es SOLO de la tarjeta del residente».
  // Aquella forma era el defecto: la carga real aplica el crédito
  // del saliente en TODA sustitución, así que una tarjeta distinta
  // de la del residente también se juzga con el crédito declarado —
  // es la carga que de verdad ocurriría al tocar «Usar» en ella.
  it("el crédito declarado también juzga a las demás tarjetas: es el de la sustitución real", async () => {
    await render(
      <CatalogItemCard
        item={byId("qwen2.5-0.5b-instruct-q4km")}
        row={undefined}
        {...baseProps}
        residentLoad={{ model: byId("qwen3-0.6b-q4km"), nCtx: 2048, memoryProfile: "default" }}
      />
    );
    expect(await screen.findByText("catalogItemCard.compat.green")).toBeTruthy();
    expect(screen.queryByText("catalogItemCard.compat.yellow")).toBeNull();
  });
});

describe("CatalogItemCard 0.1.108 · A2: la foto viva se refresca", () => {
  it("al cambiar el modelo activo, la foto se rehace con la memoria de ese momento", async () => {
    const view = await render(<CatalogItemCard item={byId("qwen3-0.6b-q4km")} row={undefined} {...baseProps} />);
    expect(await screen.findByText("catalogItemCard.compat.yellow")).toBeTruthy();
    // El modelo se descarga / la app se vacía: el RSS cae a la base y
    // la misma foto viva ya admite el modelo en su techo.
    mockRssBytes = 512 * 1024 * 1024;
    await view.rerender(
      <CatalogItemCard item={byId("qwen3-0.6b-q4km")} row={undefined} {...baseProps} isActive />
    );
    expect(await screen.findByText("catalogItemCard.compat.green")).toBeTruthy();
    expect(screen.queryByText("catalogItemCard.compat.yellow")).toBeNull();
    mockRssBytes = 868 * 1024 * 1024;
  });
});

describe("CatalogItemCard 0.1.108 · A3: el chip «Default» es el del aparato", () => {
  it("en la Tab el 1.5B NO lleva el chip (y su roja se queda)", async () => {
    await render(<CatalogItemCard item={byId("qwen2.5-1.5b-instruct-q4km")} row={undefined} {...baseProps} />);
    expect(await screen.findByText("catalogItemCard.compat.red")).toBeTruthy();
    expect(screen.queryByText("catalogItemCard.default")).toBeNull();
  });

  it("en la Tab el chip lo lleva el 0.5B Q4, su default calculado", async () => {
    await render(<CatalogItemCard item={byId("qwen2.5-0.5b-instruct-q4km")} row={undefined} {...baseProps} />);
    expect(await screen.findByText("catalogItemCard.default")).toBeTruthy();
  });
});
