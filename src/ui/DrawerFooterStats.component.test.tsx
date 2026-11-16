/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Defecto D + auditoría de telemetría (pasada 0.1.106, foto del
 * dueño 2026-11-16 07:44 MST): en el cajón lateral, las etiquetas
 * «RAM» y «DISCO» se rompían en vertical, letra por letra («R A M»,
 * «DI SC O»), porque la columna de la etiqueta medía 28 px fijos sin
 * protección contra el encogido. Y las cifras no medían lo que la
 * etiqueta afirma: el denominador era una constante de PRESUPUESTO
 * del manifiesto (12 GB / 50 GB, los topes de la auditoría bounty),
 * no la RAM ni el disco del aparato, y el «DISCO» numeraba solo los
 * archivos del catálogo de NIDO. El dueño: «Asegurarnos que esos
 * datos se miden realmente».
 *
 * Contrato fijado:
 * - La etiqueta va ENTERA en su línea: sin ancho fijo que la parta,
 *   sin encoger (flexShrink 0) y a una línea (numberOfLines 1), en
 *   el ancho real del cajón (drawerWidthFor = min(310, 82 %) con
 *   padding 16 → 278 px útiles en la Tab A9+) y a escala de fuente
 *   grande (aquí, caption a 24 px: el doble).
 * - RAM = RSS real del proceso (ram-monitor) sobre la RAM TOTAL
 *   real del aparato (getDeviceTotalRamBytes), no sobre el tope.
 * - DISCO = disco real usado (capacidad total − libre, vía
 *   expo-file-system) sobre la capacidad total real; la fila no
 *   enseña cifra hasta que la primera medición llega.
 * - tok/s: un turno sin generación (guía literal, texto seguro) no
 *   fabrica un «0,0»: la fila solo enseña la última tasa REAL.
 */
import { jest, describe, it, expect } from "@jest/globals";
import React from "react";
import { render, screen, act } from "@testing-library/react-native";

jest.mock("./theme", () => ({
  useTheme: () => ({
    colors: {
      bg: { modalOverlay: "rgba(0,0,0,0.5)" },
      text: { dim: "#888", muted: "#999", accentCyan: "#0ff" },
      border: { default: "#333", subtle: "#444" },
      emerald: { 400: "#0f0" },
      crimson: { 500: "#f00" },
      cyan: { 400: "#0ff" },
    },
    typography: {
      // Escala de fuente grande: el caption al doble de su tamaño.
      ui: { caption: { fontSize: 24 } },
      mono: { xs: { fontSize: 10 } },
    },
  }),
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { rate?: string }) =>
      k === "drawerFooterStats.ram"
        ? "RAM"
        : k === "drawerFooterStats.disk"
          ? "DISCO"
          : k === "drawerFooterStats.lastQuery"
            ? `última consulta · ${opts?.rate ?? "?"} tok/s`
            : k,
    i18n: { language: "es" },
  }),
}));

const GB = 1024 * 1024 * 1024;
jest.mock("ram-monitor", () => ({
  // La Tab A9+ del dueño: 1,2 GB residentes del proceso, 8 GB totales.
  getMemoryInfo: () => ({ rssBytes: 1.2 * GB, totalPssBytes: 1.3 * GB }),
  getDeviceTotalRamBytes: () => 8 * GB,
}));

jest.mock("expo-file-system/legacy", () => ({
  getTotalDiskCapacityAsync: async () => 128 * GB,
  getFreeDiskStorageAsync: async () => 100 * GB,
}));

const mockStorageUsageSpy = jest.fn(async () => 999 * GB);
jest.mock("../models/ModelManager", () => ({
  ModelManager: class {
    currentStorageUsageBytes = mockStorageUsageSpy;
  },
}));

let mockStatsCallback: ((s: { tokPerSec: number }) => void) | null = null;
jest.mock("../services/telemetry", () => ({
  // El último turno registrado fue una guía literal: sin generación.
  getLastQueryStats: () => ({ tokPerSec: 0 }),
  subscribeQueryStats: (cb: (s: { tokPerSec: number }) => void) => {
    mockStatsCallback = cb;
    return () => {};
  },
}));

import { DrawerFooterStats } from "./DrawerFooterStats";

describe("DrawerFooterStats · etiquetas enteras y cifras que miden de verdad", () => {
  it("RAM y DISCO se leen enteros en su línea, sin ancho que los parta", async () => {
    render(<DrawerFooterStats />);
    const ram = await screen.findByText("RAM");
    const disco = await screen.findByText("DISCO");
    for (const label of [ram, disco]) {
      expect(label.props.numberOfLines).toBe(1);
      const style = Object.assign({}, ...(Array.isArray(label.props.style) ? label.props.style : [label.props.style]));
      expect(style.flexShrink).toBe(0);
      expect(style.width).toBeUndefined();
    }
  });

  it("RAM: el denominador es la RAM total real del aparato (8 GB), no el presupuesto de 12", async () => {
    render(<DrawerFooterStats />);
    expect(await screen.findByText("1.2 GB/8.0 GB")).toBeTruthy();
    expect(screen.queryByText(/12\.0 GB/)).toBeNull();
  });

  it("DISCO: usado y total son el disco real (128 − 100 = 28), no el catálogo contra 50", async () => {
    render(<DrawerFooterStats />);
    expect(await screen.findByText("28.0 GB/128.0 GB")).toBeTruthy();
    expect(screen.queryByText(/50\.0 GB/)).toBeNull();
    expect(mockStorageUsageSpy).not.toHaveBeenCalled();
  });

  it("tok/s: un turno sin generación no fabrica un 0,0; la última tasa real se queda", async () => {
    render(<DrawerFooterStats />);
    await screen.findByText("1.2 GB/8.0 GB");
    expect(screen.queryByText(/tok\/s/)).toBeNull();
    act(() => mockStatsCallback?.({ tokPerSec: 12.34 }));
    expect(await screen.findByText("última consulta · 12.3 tok/s")).toBeTruthy();
    // Un turno de guía literal registra 0: la fila NO se degrada a 0,0.
    act(() => mockStatsCallback?.({ tokPerSec: 0 }));
    expect(screen.queryByText(/0\.0 tok\/s/)).toBeNull();
    expect(screen.getByText("última consulta · 12.3 tok/s")).toBeTruthy();
  });
});
