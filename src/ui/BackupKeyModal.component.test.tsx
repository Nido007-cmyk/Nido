/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// @ts-nocheck
// Tests del modal compartido de la clave de backup (2026-10-12): es la
// única superficie que muestra la clave en ambas rutas (pantalla de
// respaldo y tarjeta de Ajustes). Se verifica que la clave se ve, que
// «Copiar clave» usa copySecret y que la copia se confirma en pantalla
// (antes copiaba en silencio y parecía que no hacía nada).
import React from "react";
import { render, fireEvent, screen } from "@testing-library/react-native";

const mockCopySecret = jest.fn(async () => {});

jest.mock("./theme", () => ({
  useTheme: () => ({
    colors: {
      bg: { modalOverlay: "rgba(0,0,0,0.5)", card: "#111" },
      text: { primary: "#fff" },
      crimson: { 500: "#f00" },
    },
    typography: {
      ui: {
        title: { fontSize: 18 },
        body: { fontSize: 14 },
      },
    },
  }),
}));

jest.mock("./theme/surfaces", () => ({
  makeSurfaces: () => ({
    primaryButton: {},
    primaryButtonText: {},
    secondaryButton: {},
    secondaryButtonText: {},
  }),
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock("../utils/secretClipboard", () => ({
  copySecret: (...args: unknown[]) => mockCopySecret(...args),
}));

describe("BackupKeyModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("muestra la clave y el botón de copiar cuando hay clave", async () => {
    const { BackupKeyModal } = require("./BackupKeyModal");
    await render(<BackupKeyModal dek="clave-de-prueba-123" dest="" onClose={() => {}} />);
    expect(screen.getByText("clave-de-prueba-123")).toBeTruthy();
    expect(screen.getByLabelText("backup.copyKey")).toBeTruthy();
    expect(screen.getByLabelText("backup.understood")).toBeTruthy();
  });

  it("no muestra la clave cuando dek es null", async () => {
    const { BackupKeyModal } = require("./BackupKeyModal");
    await render(<BackupKeyModal dek={null} dest="" onClose={() => {}} />);
    expect(screen.queryByText("clave-de-prueba-123")).toBeNull();
    expect(screen.queryByLabelText("backup.copyKey")).toBeNull();
  });

  it("copiar usa copySecret y confirma en pantalla", async () => {
    const { BackupKeyModal } = require("./BackupKeyModal");
    await render(<BackupKeyModal dek="clave-de-prueba-123" dest="" onClose={() => {}} />);
    fireEvent.press(screen.getByLabelText("backup.copyKey"));
    expect(await screen.findByText("backup.keyCopiedNote")).toBeTruthy();
    expect(mockCopySecret).toHaveBeenCalledWith("clave-de-prueba-123");
  });

  it("Entendido cierra el modal", async () => {
    const { BackupKeyModal } = require("./BackupKeyModal");
    const onClose = jest.fn();
    await render(<BackupKeyModal dek="clave-de-prueba-123" dest="" onClose={onClose} />);
    fireEvent.press(screen.getByLabelText("backup.understood"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("0.1.29 (M-1): no usa <Modal> (otra ventana sin FLAG_SECURE), sino una capa en la misma ventana", async () => {
    const { BackupKeyModal } = require("./BackupKeyModal");
    await render(<BackupKeyModal dek="clave-de-prueba-123" dest="" onClose={() => {}} />);
    expect(screen.getByText("clave-de-prueba-123")).toBeTruthy();
    // En el árbol renderizado no hay ningún host «Modal».
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/"type":"(RCT)?Modal(HostView)?"/);
  });
});
