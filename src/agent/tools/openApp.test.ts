/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// __DEV__ es un global de React Native: se define para el entorno de test.
vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

// Los handlers importan react-native de forma dinámica: se mockea el módulo.
// También se mockean los módulos nativos que no existen fuera del teléfono.
vi.mock("expo-calendar", () => ({}));
vi.mock("expo-contacts", () => ({}));
vi.mock("expo-document-picker", () => ({}));
vi.mock("expo-file-system", () => ({ File: class {} }));
vi.mock("expo-sqlite", () => ({}));
vi.mock("react-native", () => ({ Linking: { openURL: vi.fn() }, Platform: { OS: "android" } }));

import { Linking } from "react-native";
import { SENSITIVE_TOOLS, confirmBlockedMessage } from "./confirm";
import { classifyOpenAppTarget } from "./externalLink";
import { buildToolHandlers } from "./handlers";

const openURL = Linking.openURL as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  openURL.mockClear();
});

describe("P-F1: open_app detrás de la puerta de confirmación", () => {
  it("SENSITIVE_TOOLS incluye open_app", () => {
    expect(SENSITIVE_TOOLS.has("open_app")).toBe(true);
  });

  it("cada esquema permitido confirmado abre el enlace normalizado", async () => {
    const cases: Array<[string, string]> = [
      ["https://nido.example/x", "https://nido.example/x"],
      ["http://nido.example/x", "http://nido.example/x"],
      ["tel:+15551234567", "tel:+15551234567"],
      ["sms:+15551234567", "sms:+15551234567"],
      ["mailto:hola@nido.example", "mailto:hola@nido.example"],
    ];
    for (const [input, expected] of cases) {
      openURL.mockClear();
      const h = buildToolHandlers({ requestConfirm: async () => true });
      const out = await h["open_app"]({ link: input });
      expect(openURL).toHaveBeenCalledOnce();
      expect(openURL).toHaveBeenCalledWith(expected);
      expect(out).toMatch(/Abriendo/);
    }
  });

  it("esquemas en mayúsculas/mixtas se normalizan a minúsculas", async () => {
    const h = buildToolHandlers({ requestConfirm: async () => true });
    await h["open_app"]({ link: "HTTPS://NIDO.EXAMPLE/X" });
    expect(openURL).toHaveBeenCalledWith("https://NIDO.EXAMPLE/X");
    openURL.mockClear();
    await h["open_app"]({ link: "HtTp://nido.example" });
    expect(openURL).toHaveBeenCalledWith("http://nido.example");
    openURL.mockClear();
    await h["open_app"]({ link: "TEL:+15551234567" });
    expect(openURL).toHaveBeenCalledWith("tel:+15551234567");
  });

  it("espacios al inicio/final se recortan antes de clasificar", async () => {
    const h = buildToolHandlers({ requestConfirm: async () => true });
    await h["open_app"]({ link: "   https://nido.example/x   " });
    expect(openURL).toHaveBeenCalledOnce();
    expect(openURL).toHaveBeenCalledWith("https://nido.example/x");
  });

  it("cancelar → cero acción externa; openURL nunca se llamó", async () => {
    const seen: Array<{ title: string; message: string }> = [];
    const h = buildToolHandlers({
      requestConfirm: async (req) => {
        seen.push(req);
        return false;
      },
    });
    const out = await h["open_app"]({ link: "https://nido.example/x" });
    // El diálogo SÍ se mostró (la puerta se pidió) antes de cualquier acción…
    expect(seen).toHaveLength(1);
    expect(seen[0].message).toContain("https://nido.example/x");
    // …pero al cancelar no se tocó el sistema.
    expect(openURL).not.toHaveBeenCalled();
    expect(out).toMatch(/I did nothing/i);
  });

  it("sin canal de confirmación → bloqueado (fail-closed), openURL intacto", async () => {
    const h = buildToolHandlers(); // sin requestConfirm
    const out = await h["open_app"]({ link: "https://nido.example/x" });
    expect(out).toBe(confirmBlockedMessage("open_app"));
    expect(openURL).not.toHaveBeenCalled();
  });

  it("canal de confirmación que lanza → fail-closed, openURL intacto", async () => {
    const h = buildToolHandlers({
      requestConfirm: async () => {
        throw new Error("ui rota");
      },
    });
    const out = await h["open_app"]({ link: "https://nido.example/x" });
    expect(openURL).not.toHaveBeenCalled();
    expect(out).toMatch(/I did nothing/i);
  });

  it("esquema no permitido → falla cerrado aunque el usuario confirme", async () => {
    for (const bad of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<h1>x</h1>",
      "intent://nido.example#Intent;scheme=https;end",
      "market://details?id=com.x",
      "file:///etc/passwd",
      "fb://profile",
      "customscheme://x",
    ]) {
      openURL.mockClear();
      const seen: Array<{ title: string; message: string }> = [];
      const h = buildToolHandlers({
        requestConfirm: async (req) => {
          seen.push(req);
          return true; // incluso confirmando, nada debe pasar
        },
      });
      const out = await h["open_app"]({ link: bad });
      expect(openURL, bad).not.toHaveBeenCalled();
      expect(seen, bad).toHaveLength(1);
      expect(out, bad).toMatch(/no puede abrir este enlace|can't open this link/i);
    }
  });

  it("objetivos malformados/vacíos fallan cerrados", async () => {
    for (const bad of [
      "",
      "   ",
      "com.android.calendar", // nombre de paquete: no es un enlace
      "nido.example/x", // sin esquema
      "https//sin-dos-puntos",
      "https ://espacio-en-esquema",
      "%68ttps://esquema-codificado", // %68 = 'h': el esquema nunca se decodifica
      "java\tscript:alert(1)", // tab contrabandeado
      "java\nscript:alert(1)", // newline contrabandeado
    ]) {
      openURL.mockClear();
      const h = buildToolHandlers({ requestConfirm: async () => true });
      const out = await h["open_app"]({ link: bad });
      expect(openURL, JSON.stringify(bad)).not.toHaveBeenCalled();
      expect(out, JSON.stringify(bad)).toMatch(/no puede abrir este enlace|can't open this link/i);
    }
  });

  it("argumento no-string → falla cerrado", async () => {
    const h = buildToolHandlers({ requestConfirm: async () => true });
    const out = await h["open_app"]({ link: 42 });
    expect(openURL).not.toHaveBeenCalled();
    expect(out).toMatch(/no puede abrir este enlace|can't open this link/i);
  });

  it("el diálogo muestra el enlace normalizado, no el crudo", async () => {
    const seen: Array<{ title: string; message: string }> = [];
    const h = buildToolHandlers({
      requestConfirm: async (req) => {
        seen.push(req);
        return false;
      },
    });
    await h["open_app"]({ link: "  HTTPS://nido.example/x  " });
    expect(seen).toHaveLength(1);
    expect(seen[0].message).toContain("https://nido.example/x");
    expect(seen[0].message).not.toContain("HTTPS://");
  });
});

describe("P-F1: clasificador puro de enlaces", () => {
  it("permite los 5 esquemas y normaliza mayúsculas", () => {
    expect(classifyOpenAppTarget("https://x")).toMatchObject({ ok: true, scheme: "https" });
    expect(classifyOpenAppTarget("HTTP://x")).toMatchObject({
      ok: true,
      scheme: "http",
      normalized: "http://x",
    });
    expect(classifyOpenAppTarget("TEL:+1")).toMatchObject({ ok: true, scheme: "tel" });
    expect(classifyOpenAppTarget("Sms:+1")).toMatchObject({ ok: true, scheme: "sms" });
    expect(classifyOpenAppTarget("MAILTO:a@b.c")).toMatchObject({ ok: true, scheme: "mailto" });
  });

  it("rechaza esquemas peligrosos y personalizados", () => {
    for (const bad of ["javascript:alert(1)", "data:,x", "intent://x", "file:///x"]) {
      const c = classifyOpenAppTarget(bad);
      expect(c.ok, bad).toBe(false);
      if (!c.ok) expect(c.reason).toBe("scheme-not-allowed");
    }
  });

  it("rechaza trucos de codificación y caracteres de control", () => {
    expect(classifyOpenAppTarget("%68ttps://x").ok).toBe(false); // esquema codificado
    expect(classifyOpenAppTarget("java\tscript:x").ok).toBe(false);
    expect(classifyOpenAppTarget("https://exa mple.com").ok).toBe(false); // espacio interno
    expect(classifyOpenAppTarget("").ok).toBe(false);
    expect(classifyOpenAppTarget("com.android.calendar").ok).toBe(false); // sin esquema
  });
});
