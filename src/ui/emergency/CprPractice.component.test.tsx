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

jest.mock("nido-cpr", () => {
  // El puente nuevo devuelve el instante monotónico de arranque
  // (F-3): el doble devuelve instantes crecientes, como el nativo.
  let fakeStart = 100_000;
  return {
    hasCprCamera: () => true,
    startBeepingAt: (bpm: number, max: number) => {
      beeps.push([bpm, max]);
      fakeStart += 25_000;
      return fakeStart;
    },
    startBeeping: (bpm: number, max: number) => {
      beeps.push([bpm, max]);
      return true;
    },
    stopBeeping: () => stops.push("beep"),
    startCprCamera: async () => {
      cams.push("start");
      return () => cams.push("stop");
    },
  };
});

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

// 0.1.90: el área segura queda fijada (arriba 24, abajo 34) para
// probar que la raíz del modal a pantalla completa la aplica.
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 34, left: 0, right: 0 }),
}));

import { AppState } from "react-native";
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

  it("0.1.90: la raíz aplica los márgenes del área segura (arriba y abajo)", async () => {
    const view = await render(<CprPractice visible onClose={() => {}} />);
    const flatStyle = (s) => Object.assign({}, ...(Array.isArray(s) ? s : [s]).filter(Boolean));
    const found = [];
    const walk = (n) => {
      if (!n || typeof n !== "object") return;
      const st = flatStyle(n.props?.style);
      if (st.paddingTop === 24 && st.paddingBottom === 34) found.push(n);
      (n.children ?? []).forEach(walk);
    };
    walk(view.toJSON());
    expect(found.length).toBeGreaterThanOrEqual(1);
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

  it("con NIDO en segundo plano la cámara se apaga, y vuelve al volver", async () => {
    let onChange: (st: string) => void = () => {};
    const spy = jest.spyOn(AppState, "addEventListener").mockImplementation((_e, fn) => {
      onChange = fn as (st: string) => void;
      return { remove: () => {} } as never;
    });
    await render(<CprPractice visible onClose={() => {}} />);
    await fireEvent.press(screen.getByTestId("cpr-camera-toggle"));
    await fireEvent.press(screen.getByTestId("cpr-start"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(cams).toEqual(["start"]);
    await act(async () => {
      onChange("background");
    });
    expect(cams).toEqual(["start", "stop"]);
    expect(screen.getByText("cpr.camera.paused")).toBeTruthy();
    // El pitido no se para: la práctica sigue.
    expect(stops).not.toContain("beep");
    await act(async () => {
      onChange("active");
      await Promise.resolve();
    });
    expect(cams).toEqual(["start", "stop", "start"]);
    spy.mockRestore();
  });
});
