/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// @ts-nocheck
// 0.1.32: la tarjeta de alarmas exactas dice la verdad: aviso + botón si
// Android puede retrasar los recordatorios, confirmación si no, y NADA si
// no se puede saber (módulo nativo ausente).
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";

const mockState = { exact: null as boolean | null, opened: 0 };

jest.mock("exact-alarm", () => ({
  canScheduleExactAlarms: async () => mockState.exact,
  openExactAlarmSettings: async () => {
    mockState.opened++;
    return true;
  },
}));
jest.mock("./theme", () => ({
  useTheme: () => ({ colors: {}, typography: { ui: {} } }),
}));
jest.mock("./theme/surfaces", () => ({
  makeSurfaces: () => ({
    sectionLabel: {},
    note: {},
    noteText: {},
    warning: {},
    warningText: {},
    secondaryButton: {},
    secondaryButtonText: {},
  }),
}));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

describe("ExactAlarmCard", () => {
  beforeEach(() => {
    mockState.opened = 0;
  });

  it("sin permiso: avisa y ofrece abrir el ajuste del sistema", async () => {
    mockState.exact = false;
    const { ExactAlarmCard } = require("./ExactAlarmCard");
    await render(<ExactAlarmCard />);
    expect(await screen.findByText("exactAlarm.off")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("exactAlarm.allow"));
    expect(mockState.opened).toBe(1);
  });

  it("con permiso: lo confirma, sin botón", async () => {
    mockState.exact = true;
    const { ExactAlarmCard } = require("./ExactAlarmCard");
    await render(<ExactAlarmCard />);
    expect(await screen.findByText("exactAlarm.ok")).toBeTruthy();
    expect(screen.queryByLabelText("exactAlarm.allow")).toBeNull();
  });

  it("si no se puede saber, no muestra nada (nunca un estado inventado)", async () => {
    mockState.exact = null;
    const { ExactAlarmCard } = require("./ExactAlarmCard");
    await render(<ExactAlarmCard />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("exactAlarm.title")).toBeNull();
  });
});
