/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// @ts-nocheck
// Pieza A (PI-3/AI-05): la sección de packs añadidos muestra la marca de
// origen SOLO de los packs que la puerta verificó, ofrece el gesto de
// añadir con su cadena, y quitar un pack pasa por la confirmación de
// A.3. El servicio va mockeado: lo que se prueba es la superficie.
import React from "react";
import { Alert } from "react-native";
import { render, screen, fireEvent } from "@testing-library/react-native";

const mockState = {
  items: [
    {
      filename: "salvora-emergencias-casa.sqlite",
      name: "SALVORA Home Emergencies",
      origin: "salvora",
      sizeBytes: 602112,
      sha256: "71173cda",
      embeddingModelSha256: "ec38e8da142596baa913124ae50550de284b6916bf59577ef2f0cb9660c2f514",
    },
  ] as Array<Record<string, unknown>>,
  importOutcome: { status: "cancelled" } as Record<string, unknown>,
  removed: [] as string[],
  listCalls: 0,
  activeSha256: "e4165e3a71af97f1b4820da61079826d8752a2088e313af0c7d346796c38eff5",
};

jest.mock("../services/packImporter", () => ({
  listImportedPacks: async () => {
    mockState.listCalls++;
    return mockState.items;
  },
  importPackFromFile: async () => mockState.importOutcome,
  removeImportedPack: async (filename: string) => {
    mockState.removed.push(filename);
  },
}));
jest.mock("../rag/embeddingSwitch", () => ({
  activeEmbeddingModel: async () => ({ sha256: mockState.activeSha256 }),
}));
jest.mock("./theme", () => ({
  useTheme: () => ({
    colors: {
      bg: {},
      text: {},
      border: {},
      emerald: {},
      crimson: { 400: "#f00" },
    },
    typography: { ui: {}, mono: {} },
  }),
}));
jest.mock("./theme/spacing", () => ({ spacing: { md: 12, sm: 8 }, radii: { lg: 12, sm: 6 } }));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { origin?: string; max?: string }) =>
      opts?.origin ? `${k}:${opts.origin}` : opts?.max ? `${k}:${opts.max}` : k,
  }),
}));

describe("ImportedPacksSection", () => {
  beforeEach(() => {
    mockState.removed = [];
    mockState.listCalls = 0;
    mockState.importOutcome = { status: "cancelled" };
    // 0.1.87: la huella activa vuelve al bge entre casos — un caso
    // la cambia para el aviso y, sin restaurar, los siguientes
    // renders no encontraban la tarjeta (la lista se quedaba con
    // el estado del render anterior en este entorno de jest).
    mockState.activeSha256 = "e4165e3a71af97f1b4820da61079826d8752a2088e313af0c7d346796c38eff5";
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it("muestra la cabecera, el gesto de añadir y la marca firmada del pack verificado", async () => {
    const { ImportedPacksSection } = require("./ImportedPacksSection");
    await render(<ImportedPacksSection />);
    expect(await screen.findByText("packImport.addedHeading")).toBeTruthy();
    expect(screen.getByText("packImport.addButton")).toBeTruthy();
    expect(await screen.findByText("SALVORA Home Emergencies")).toBeTruthy();
    // AI-05: la marca dice la llave que verificó, compuesta con su origen.
    expect(screen.getByText("packImport.signedBy:SALVORA PACKS")).toBeTruthy();
  });

  it("un rechazo de la puerta se enseña con su cadena de A.3", async () => {
    mockState.importOutcome = { status: "rejected", reason: "not-signed-by-us" };
    const { ImportedPacksSection } = require("./ImportedPacksSection");
    await render(<ImportedPacksSection />);
    fireEvent.press(screen.getByLabelText("packImport.addButton"));
    await screen.findByText("packImport.addedHeading");
    expect(Alert.alert).toHaveBeenCalledWith("packImport.notSignedByUs");
  });

  it("0.1.87 (pieza 5): el segundo botón del lector vive en el encabezado de esta sección", async () => {
    const { ImportedPacksSection } = require("./ImportedPacksSection");
    const onOpenLibrary = jest.fn();
    await render(<ImportedPacksSection onOpenLibrary={onOpenLibrary} />);
    const btn = await screen.findByLabelText("guideLibrary.open");
    fireEvent.press(btn);
    expect(onOpenLibrary).toHaveBeenCalledTimes(1);
  });

  it("0.1.87: avisa cuando el pack es de otro modelo de embeddings, y calla cuando es del activo", async () => {
    const { ImportedPacksSection } = require("./ImportedPacksSection");
    // El pack del campo real se embebió con el modelo multilingüe
    // (ec38…) y el activo del mock es el bge (e416…): el aviso sale.
    await render(<ImportedPacksSection />);
    expect(await screen.findByText("multilingual.packOtherModel")).toBeTruthy();
    mockState.activeSha256 = "ec38e8da142596baa913124ae50550de284b6916bf59577ef2f0cb9660c2f514";
    await render(<ImportedPacksSection />);
    await screen.findByText("SALVORA Home Emergencies");
    expect(screen.queryByText("multilingual.packOtherModel")).toBeNull();
  });

  it("0.1.87 (pieza 5): sin la prop no hay botón del lector en el encabezado", async () => {
    const { ImportedPacksSection } = require("./ImportedPacksSection");
    await render(<ImportedPacksSection />);
    await screen.findByText("SALVORA Home Emergencies");
    expect(screen.queryByLabelText("guideLibrary.open")).toBeNull();
  });

  it("quitar pide la confirmación de A.3 y borra el pack al aceptarla", async () => {
    const { ImportedPacksSection } = require("./ImportedPacksSection");
    await render(<ImportedPacksSection />);
    await screen.findByText("SALVORA Home Emergencies");
    fireEvent.press(screen.getByLabelText("packImport.removeAction"));
    expect(Alert.alert).toHaveBeenCalled();
    const call = (Alert.alert as jest.Mock).mock.calls.at(-1);
    expect(call[0]).toBe("packImport.removeAction");
    expect(call[1]).toBe("packImport.removeConfirmBody");
    const destructive = call[2].find((b: { style?: string }) => b.style === "destructive");
    await destructive.onPress();
    expect(mockState.removed).toEqual(["salvora-emergencias-casa.sqlite"]);
  });
});
