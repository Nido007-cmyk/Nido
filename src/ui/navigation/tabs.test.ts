/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MAIN_TABS, TAB_ICON, TAB_LABEL_KEY, isMainTab } from "./tabs";
import en from "../../i18n/locales/en.json";
import es from "../../i18n/locales/es.json";
import pt from "../../i18n/locales/pt.json";

// iconRegistry require()s PNG files, which the test runner can't load: read the names from its source.
const REGISTRY = readFileSync(new URL("../components/icons/iconRegistry.ts", import.meta.url), "utf8");
const ICON_NAMES = [...REGISTRY.slice(REGISTRY.indexOf("ICON_NAMES"), REGISTRY.indexOf("] as const")).matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);

const get = (obj: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);

describe("barra inferior (0.1.56)", () => {
  it("cinco secciones, en este orden, con Emergencia al alcance del pulgar", () => {
    expect(MAIN_TABS).toEqual(["chat", "emergency", "library", "nido", "settings"]);
  });

  it("cada pestaña tiene un icono que existe y su nombre en es, en y pt", () => {
    for (const tab of MAIN_TABS) {
      expect(ICON_NAMES).toContain(TAB_ICON[tab]);
      for (const locale of [en, es, pt]) expect(typeof get(locale, TAB_LABEL_KEY[tab])).toBe("string");
    }
  });

  it("isMainTab solo acepta las cinco", () => {
    expect(isMainTab("emergency")).toBe(true);
    expect(isMainTab("about")).toBe(false);
    expect(isMainTab(undefined)).toBe(false);
  });

  it("el chat conserva todas las entradas del menú lateral (ningún botón se pierde)", () => {
    const src = readFileSync(new URL("../ChatScreen.tsx", import.meta.url), "utf8");
    for (const key of ["guide", "prompts", "knowledge", "memory", "settings", "telemetry", "nido", "about"]) {
      expect(src).toContain(`key: "${key}"`);
    }
    // Y la barra aparece en Chat, Emergencia, Biblioteca, NIDO y Ajustes.
    expect(src.match(/withTabs\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(src).toContain("<BottomTabBar active=\"chat\"");
  });

  it("el botón de pánico ya no se llama «SOS» (no se confunde con pedir ayuda)", () => {
    for (const locale of [en, es, pt]) expect(get(locale, "panic.short")).not.toBe("SOS");
  });
});
