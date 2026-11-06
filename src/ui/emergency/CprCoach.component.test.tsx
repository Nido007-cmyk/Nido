/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// @ts-nocheck
// Asistente de RCP (0.1.76): la pantalla. En emergencia no se ofrece la
// cámara (un «CPR aid with feedback» es clase II en EE. UU.); en práctica
// sí, con el aviso de no hacerlo sobre una persona. Empezar arranca el
// pitido a 110 y la pantalla encendida; parar o cerrar lo apaga todo.
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

import { CprCoach } from "./CprCoach";
import { CPR_GUIDE } from "../../cpr/cprCoach";

beforeEach(() => {
  beeps.length = 0;
  stops.length = 0;
  cams.length = 0;
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

describe("asistente de RCP", () => {
  it("emergencia: la guía tal cual, el número de emergencias y SIN cámara", () => {
    const onCall = jest.fn();
    render(<CprCoach visible onClose={() => {}} emergency={{ value: "911", tel: "tel:911" }} onCall={onCall} />);
    expect(screen.getByText("cpr.title")).toBeTruthy();
    expect(screen.getByText(`• ${CPR_GUIDE.es.before[0]}`)).toBeTruthy();
    expect(screen.queryByTestId("cpr-camera-toggle")).toBeNull();
    fireEvent.press(screen.getByText("cpr.call"));
    expect(onCall).toHaveBeenCalledWith("tel:911");
  });

  it("empezar pita a 110 sin límite (solo compresiones); parar lo apaga", () => {
    render(<CprCoach visible onClose={() => {}} />);
    fireEvent.press(screen.getByTestId("cpr-start"));
    expect(beeps).toEqual([[110, 0]]);
    act(() => {
      jest.advanceTimersByTime(1200);
    });
    expect(screen.getByTestId("cpr-stop")).toBeTruthy();
    fireEvent.press(screen.getByTestId("cpr-stop"));
    expect(stops).toContain("beep");
    expect(screen.getByTestId("cpr-start")).toBeTruthy();
  });

  it("30:2: pita 30 y vuelve a pitar tras la pausa de respiraciones", () => {
    render(<CprCoach visible onClose={() => {}} />);
    fireEvent.press(screen.getByText("cpr.mode302"));
    fireEvent.press(screen.getByTestId("cpr-start"));
    expect(beeps).toEqual([[110, 30]]);
    act(() => {
      jest.advanceTimersByTime(30 * (60000 / 110) + 6000 + 200);
    });
    expect(beeps).toEqual([[110, 30], [110, 30]]);
  });

  it("práctica: aviso de no hacerlo sobre una persona y cámara opcional", async () => {
    render(<CprCoach visible onClose={() => {}} practice emergency={{ value: "911", tel: "tel:911" }} onCall={() => {}} />);
    expect(screen.getByText("cpr.practice.title")).toBeTruthy();
    expect(screen.getByText("cpr.practice.banner")).toBeTruthy();
    expect(screen.queryByText("cpr.call")).toBeNull();
    fireEvent.press(screen.getByTestId("cpr-camera-toggle"));
    await act(async () => {
      fireEvent.press(screen.getByTestId("cpr-start"));
    });
    expect(cams).toEqual(["start"]);
    fireEvent.press(screen.getByTestId("cpr-stop"));
    expect(cams).toEqual(["start", "stop"]);
  });

  it("par: en práctica sin activar la cámara, la cámara no se enciende", () => {
    render(<CprCoach visible onClose={() => {}} practice />);
    fireEvent.press(screen.getByTestId("cpr-start"));
    expect(cams).toEqual([]);
  });
});
