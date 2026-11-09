/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// @ts-nocheck
// 0.1.87 (pieza 5): el botón del lector en la pestaña Biblioteca.
// El dueño no encontraba el lector con la app configurada («Tampoco
// veo el Lector»): vivía solo tras la franja del asistente y un
// botón enterrado en Ajustes. Aquí se prueba la superficie nueva:
// el botón junto al título, visible, que llama a onOpenLibrary (la
// capa de App, la única copia del lector), y el reenvío de la prop
// por la sección de packs hasta el contenido de conocimiento.
// ModelSetupScreen va mockeado: lo que se prueba es el cable de
// esta pantalla y su botón, no el contenido de Ajustes.
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";

const mockState = { modelSetupProps: [] as Array<Record<string, unknown>> };

jest.mock("./theme/ThemeContext", () => ({
  useTheme: () => ({
    colors: {
      bg: { black: "#000", cardElevated: "#111", surface: "#222" },
      text: { heading: "#fff", primary: "#fff", secondary: "#ccc", inverse: "#000" },
      border: { default: "#444", elevated: "#666" },
      emerald: { 400: "#3ECF6F", 500: "#2F9E44" },
    },
    typography: {
      ui: {
        headline: { fontSize: 20 },
        subtext: { fontSize: 13 },
        title: { fontSize: 18 },
        titleSm: { fontSize: 15 },
      },
    },
  }),
}));
jest.mock("./components/icons/NidoIcon", () => ({ NidoIcon: () => null }));
jest.mock("./PersonalDocumentsManager", () => ({ PersonalDocumentsManager: () => null }));
jest.mock("./ModelSetupScreen", () => ({
  ModelSetupScreen: (props: Record<string, unknown>) => {
    mockState.modelSetupProps.push(props);
    return null;
  },
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe("LibraryScreen · el botón del lector (0.1.87)", () => {
  beforeEach(() => {
    mockState.modelSetupProps = [];
  });

  it("0.1.88: la apertura del lector es UNA sola, la banda final, y abre el lector de App", async () => {
    const { LibraryScreen } = require("./LibraryScreen");
    const onOpenLibrary = jest.fn();
    await render(
      <LibraryScreen onOpenGuide={() => {}} onOpenPromptIdeas={() => {}} onOpenLibrary={onOpenLibrary} />
    );
    // Ni junto al título ni repetida dentro de la sección embebida:
    // en toda la pantalla hay exactamente una apertura.
    const all = screen.getAllByLabelText("guideLibrary.open");
    expect(all).toHaveLength(1);
    fireEvent.press(all[0]);
    expect(onOpenLibrary).toHaveBeenCalledTimes(1);
  });

  it("sin la prop no hay botón: el lector sigue siendo solo la capa de App", async () => {
    const { LibraryScreen } = require("./LibraryScreen");
    await render(<LibraryScreen onOpenGuide={() => {}} onOpenPromptIdeas={() => {}} />);
    expect(screen.queryByLabelText("guideLibrary.open")).toBeNull();
  });

  it("0.1.88: la sección embebida va marcada como sitio SIN entrada interior (libraryEntryInside en falso)", async () => {
    const { LibraryScreen } = require("./LibraryScreen");
    const onOpenLibrary = jest.fn();
    await render(
      <LibraryScreen onOpenGuide={() => {}} onOpenPromptIdeas={() => {}} onOpenLibrary={onOpenLibrary} />
    );
    const knowledge = mockState.modelSetupProps.find((p) => p.section === "knowledge");
    expect(knowledge).toBeTruthy();
    expect(knowledge.libraryEntryInside).toBe(false);
    expect(knowledge.onOpenLibrary).toBeUndefined();
  });
});
