/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// @ts-nocheck
// Práctica de RCP (0.1.76): la pantalla. Siempre con el aviso de hacerlo
// sobre un cojín o un maniquí, nunca sobre una persona; sin botón de
// llamada (no es una herramienta para emergencias). Empezar arranca el
// pitido a 110; la cámara solo si se activa; parar lo apaga todo.
// Testing Library 14: render, fireEvent y act son asíncronos.
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

const beeps: Array<[number, number]> = [];
const stops: string[] = [];
const cams: string[] = [];

jest.mock("nido-cpr", () => ({
  hasCprCamera: () => true,
  startBeeping: (bpm: number, max: number) => {
    beeps.push([bpm, max]);
    return true;
  },
  stopBeeping: () => stops.push("beep"),
  startCprCamera: async () => {
    cams.push("start");
    return () => cams.push("stop");
  },
}));

jest.mock("expo-keep-awake", () => ({
  activateKeepAwake: jest.fn(),
  deactivateKeepAwake: jest.fn(),
}));

jest.mock("../../voice/tts", () => ({
  speakAloud: jest.fn(async () => {}),
  stopSpeaking: jest.fn(),
}));

jest.mock("../../services/haptics", () => ({
  impact: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
}));

jest.mock("../components/icons/NidoIcon", () => ({ NidoIcon: () => null }));

jest.mock("../theme/ThemeContext", () => ({
  useTheme: () => ({
    colors: {
      id: "daylight",
      bg: { black: "#000", card: "#111" },
      text: { heading: "#fff", primary: "#fff", secondary: "#ccc", dim: "#999", inverse: "#000", accentEmerald: "#0f0" },
      border: { default: "#444" },
      amber: { bgSubtle: "#220", border: "#440" },
      crimson: { 400: "#c55", 500: "#b34", 600: "#933" },
      emerald: { 500: "#2f9", bgSubtle: "#020" },
    },
    typography: {
      ui: {
        body: { fontSize: 16 },
        caption: { fontSize: 13 },
        title: { fontSize: 20 },
        titleSm: { fontSize: 17 },
        titleLg: { fontSize: 24 },
      },
    },
  }),
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "es", resolvedLanguage: "es" },
  }),
}));

import { CprPractice } from "./CprPractice";
import { CPR_GUIDE } from "../../cpr/cprCoach";

beforeEach(() => {
  beeps.length = 0;
  stops.length = 0;
  cams.length = 0;
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

describe("práctica de RCP", () => {
  it("aviso de práctica, la guía tal cual y ningún botón de llamada", async () => {
    await render(<CprPractice visible onClose={() => {}} />);
    expect(screen.getByText("cpr.practice.title")).toBeTruthy();
    expect(screen.getByText("cpr.practice.banner")).toBeTruthy();
    expect(screen.getByText(`• ${CPR_GUIDE.es.before[0]}`)).toBeTruthy();
    expect(screen.queryByText("cpr.call")).toBeNull();
  });

  it("empezar pita a 110 sin límite (solo compresiones); parar lo apaga", async () => {
    await render(<CprPractice visible onClose={() => {}} />);
    await fireEvent.press(screen.getByTestId("cpr-start"));
    expect(beeps).toEqual([[110, 0]]);
    await act(async () => {
      jest.advanceTimersByTime(1200);
    });
    await fireEvent.press(screen.getByTestId("cpr-stop"));
    expect(stops).toContain("beep");
    expect(screen.getByTestId("cpr-start")).toBeTruthy();
  });

  it("30:2: pita 30 y vuelve a pitar tras la pausa de respiraciones", async () => {
    await render(<CprPractice visible onClose={() => {}} />);
    await fireEvent.press(screen.getByText("cpr.mode302"));
    await fireEvent.press(screen.getByTestId("cpr-start"));
    expect(beeps).toEqual([[110, 30]]);
    await act(async () => {
      jest.advanceTimersByTime(30 * (60000 / 110) + 6000 + 200);
    });
    expect(beeps).toEqual([[110, 30], [110, 30]]);
  });

  it("la cámara solo se enciende si se activa, y se apaga al parar", async () => {
    await render(<CprPractice visible onClose={() => {}} />);
    await fireEvent.press(screen.getByTestId("cpr-camera-toggle"));
    await fireEvent.press(screen.getByTestId("cpr-start"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(cams).toEqual(["start"]);
    await fireEvent.press(screen.getByTestId("cpr-stop"));
    expect(cams).toEqual(["start", "stop"]);
  });

  it("par: sin activar la cámara, la cámara no se enciende", async () => {
    await render(<CprPractice visible onClose={() => {}} />);
    await fireEvent.press(screen.getByTestId("cpr-start"));
    expect(cams).toEqual([]);
  });
});
