/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 2026-10-30: las direcciones de aportación al desarrollo viven UNA sola
 * vez en aboutSupport.ts. Esta prueba las trae escritas por segunda vez,
 * de forma independiente, carácter a carácter: si la constante y esta
 * prueba discrepan en un solo carácter, la batería se pone roja — es la
 * guarda contra una errata al transcribir una dirección donde va dinero.
 * También se afirma que el portapapeles recibe el valor intacto y que la
 * sección existe completa en los tres idiomas.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const clip = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("expo-clipboard", () => ({
  setStringAsync: async (value: string) => {
    clip.calls.push(value);
    return true;
  },
}));

import { SUPPORT_ADDRESSES, copySupportAddress } from "./aboutSupport";
import es from "../i18n/locales/es.json";
import en from "../i18n/locales/en.json";
import pt from "../i18n/locales/pt.json";

// Segunda transcripción independiente de las direcciones (2026-10-30).
const SOLANA = "G74aAtEB41eFAcXtRbBVcRVpZDgELBCoFeUo9AyTnjRK";
const BASE = "0x5c030688FAcF0c74a5fF5eB00686A0021d95c1fC";

beforeEach(() => {
  clip.calls.length = 0;
});

describe("direcciones de desarrollo: fuente única, valores exactos", () => {
  it("la tabla tiene exactamente las dos direcciones, carácter a carácter", () => {
    expect(SUPPORT_ADDRESSES).toEqual([
      { id: "solana", address: SOLANA },
      { id: "base", address: BASE },
    ]);
    expect(SOLANA).toHaveLength(44);
    expect(BASE).toHaveLength(42);
  });

  it("el portapapeles recibe Solana intacta: sin espacios, saltos ni recortes", async () => {
    const entry = SUPPORT_ADDRESSES.find((a) => a.id === "solana")!;
    await copySupportAddress(entry.address);
    expect(clip.calls).toEqual([SOLANA]);
  });

  it("el portapapeles recibe Base intacta, con su 0x y sus mayúsculas", async () => {
    const entry = SUPPORT_ADDRESSES.find((a) => a.id === "base")!;
    await copySupportAddress(entry.address);
    expect(clip.calls).toEqual([BASE]);
  });
});

describe("la sección existe completa en los tres idiomas", () => {
  const KEYS = [
    "developmentTitle",
    "developmentBody",
    "developmentSolanaLabel",
    "developmentBaseLabel",
    "developmentCopy",
    "developmentCopied",
  ] as const;
  it.each([
    ["es", es],
    ["en", en],
    ["pt", pt],
  ] as const)("%s: título, cuerpo, etiquetas, copiar y confirmación", (_lang, locale) => {
    const about = (locale as { aboutScreen: Record<string, string> }).aboutScreen;
    for (const k of KEYS) {
      expect(about[k], k).toBeTruthy();
      expect(about[k].trim().length).toBeGreaterThan(0);
    }
    expect(about.developmentSolanaLabel).toContain("Solana");
    expect(about.developmentBaseLabel).toContain("Base");
  });
});
