/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// M-1 (espejo del móvil de la adopción de rivales): la tarjeta de
// búsqueda multilingüe ofrece descargar el e5 sin veredicto alguno
// antes de descargar. Desde este paso enseña la misma insignia de
// tres valores que las filas del catálogo, calculada sobre su destino
// con la RAM del aparato, y con veredicto rojo el gesto de activar
// (que descarga y activa) queda desactivado con el aviso del propio
// veredicto. Los veredictos del e5 medidos en el acto 0 del paso:
// verde en la Tab del dueño (3416 MiB), rojo a 2 GB.
import { jest, describe, it, expect, afterEach } from "@jest/globals";
import React from "react";
import { render, screen } from "@testing-library/react-native";

// La Tab A9+ del dueño por defecto; mutable para el caso en rojo.
let mockRamBytes = 3416 * 1024 * 1024;
jest.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => mockRamBytes,
}));

jest.mock("./theme", () => ({
  useTheme: () => ({
    colors: { text: { secondary: "#bbb" } },
    typography: { ui: {}, mono: { xs: { fontSize: 10 } } },
  }),
}));

jest.mock("./theme/surfaces", () => ({
  makeSurfaces: () => ({
    card: {},
    sectionLabel: {},
    body: {},
    primaryButton: {},
    primaryButtonText: {},
  }),
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? k,
    i18n: { language: "es" },
  }),
}));

jest.mock("../models/ModelManager", () => ({
  ModelManager: class {
    async statusAll() {
      return [];
    }
  },
}));

jest.mock("../services/downloadManager", () => ({
  getDownloadState: () => undefined,
  isDownloading: () => false,
  subscribeDownloads: () => () => {},
  downloadUntilSettled: async () => null,
}));

jest.mock("../rag/embeddingSwitch", () => {
  const { MODEL_CATALOG } = require("../models/manifest");
  const byId = (id: string) => MODEL_CATALOG.find((m: { id: string }) => m.id === id);
  return {
    MULTILINGUAL_EMBEDDING_ID: "multilingual-e5-small-q8",
    embeddingModelById: (id: string) => byId(id),
    activeEmbeddingModel: async () => byId("bge-small-en-v1.5-q8"),
    defaultEmbeddingModel: () => byId("bge-small-en-v1.5-q8"),
    isMultilingualEmbedding: (m: { id: string } | null | undefined) =>
      m?.id === "multilingual-e5-small-q8",
    switchEmbeddingModel: async () => {},
  };
});

jest.mock("../rag/reembed", () => ({
  onReembedProgress: () => () => {},
}));

jest.mock("../utils/safeFormat", () => ({
  displayLang: () => "es",
  formatInt: (n: number) => String(n),
}));

jest.mock("./userFacingError", () => ({
  errorReason: () => "",
}));

const { MultilingualSearchCard } = require("./MultilingualSearchCard");

describe("MultilingualSearchCard: el veredicto de ajuste junto a su gesto (M-1)", () => {
  afterEach(() => {
    mockRamBytes = 3416 * 1024 * 1024;
  });

  it("en verde (la Tab): enseña la insignia verde y el gesto de activar está habilitado", async () => {
    await render(<MultilingualSearchCard />);
    expect(await screen.findByText("catalogItemCard.compat.green")).toBeTruthy();
    const btn = screen.getByLabelText("multilingual.turnOn");
    expect(btn.props.accessibilityState?.disabled).toBeFalsy();
  });

  it("en rojo (2 GB): enseña la insignia roja y el gesto de activar queda desactivado", async () => {
    mockRamBytes = 2 * 1024 * 1024 * 1024;
    await render(<MultilingualSearchCard />);
    expect(await screen.findByText("catalogItemCard.compat.red")).toBeTruthy();
    const btn = screen.getByLabelText("multilingual.turnOn");
    expect(btn.props.accessibilityState?.disabled).toBe(true);
  });
});
