/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// 0.1.117 (UI nueva): la guía con portada y progreso, módulos agrupados y
// lecciones que se abren. Tocar un ejemplo lo escribe en el chat (no lo envía).
import { jest, describe, it, expect } from "@jest/globals";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";

jest.mock("../services/haptics", () => ({
  impact: () => {},
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
}));
jest.mock("./components/icons/NidoIcon", () => ({ NidoIcon: () => null }));
jest.mock("../models/settings", () => ({
  getGuideVisited: async () => ["start.chat"],
  getDisabledToolNames: async () => [],
  markGuideVisited: async () => {},
}));
jest.mock("./theme", () => {
  const { getTypography } = require("./theme/typography");
  const { daylightTheme } = require("./theme/colors");
  return { useTheme: () => ({ colors: daylightTheme, typography: getTypography("standard") }) };
});
jest.mock("react-i18next", () => {
  const es = require("../i18n/locales/es.json");
  const get = (k: string) => k.split(".").reduce((o: any, p: string) => (o == null ? undefined : o[p]), es);
  const t = (k: string, opts?: Record<string, unknown>) => {
    const v = get(k);
    if (opts?.returnObjects) return v;
    if (typeof v !== "string") return k;
    return v.replace(/\{\{(\w+)\}\}/g, (_m: string, n: string) => String(opts?.[n] ?? ""));
  };
  return { useTranslation: () => ({ t, i18n: { language: "es", exists: (k: string) => get(k) !== undefined } }) };
});

describe("UserGuideScreen · diseño nuevo (0.1.117)", () => {
  const { UserGuideScreen } = require("./UserGuideScreen");
  const { allLessonIds } = require("../guide/guideCatalog");

  it("muestra portada, progreso y todos los módulos", async () => {
    await render(<UserGuideScreen onClose={() => {}} onTryExample={() => {}} />);
    expect(await screen.findByText("Aprende a usar NIDO")).toBeTruthy();
    const total = allLessonIds().length;
    expect(await screen.findByText(`1 de ${total} lecciones vistas`)).toBeTruthy();
    for (const title of ["Primeros pasos", "Organízate", "Conocimiento", "Conectar", "Tu privacidad", "Ajusta NIDO"]) {
      expect(screen.getByText(title)).toBeTruthy();
    }
  });

  it("las lecciones nuevas están y un ejemplo se escribe en el chat", async () => {
    const onTryExample = jest.fn();
    await render(<UserGuideScreen onClose={() => {}} onTryExample={onTryExample} />);
    for (const title of ["Práctica de RCP", "Borrar y corregir", "La biblioteca: paquetes y guías", "Botón de pánico", "Tema, texto e idioma"]) {
      expect(await screen.findByText(title)).toBeTruthy();
    }
    await fireEvent.press(screen.getByText("Borrar y corregir"));
    await fireEvent.press(screen.getByLabelText("Pruébalo: olvida mi color favorito"));
    expect(onTryExample).toHaveBeenCalledWith("olvida mi color favorito");
  });
});
