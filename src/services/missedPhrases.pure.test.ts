/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { formatMissedForCopy, looksLikeMissedCommand, MAX_MISSED_CHARS, toMissedPhrase } from "./missedPhrases.pure";

const routing = { route: "model", modelTools: ["create_reminder"], retry: null, fallback: null };

describe("toMissedPhrase", () => {
  it("compacta espacios y conserva la señal", () => {
    expect(toMissedPhrase("  avísame\n\n del   dentista  ", routing, 7)).toEqual({
      ts: 7,
      text: "avísame del dentista",
      route: "model",
      modelTool: "create_reminder",
      retry: null,
      fallback: null,
    });
  });

  it("recorta las frases largas", () => {
    const r = toMissedPhrase("a ".repeat(400), routing, 0);
    expect(r?.text.length).toBe(MAX_MISSED_CHARS);
    expect(r?.text.endsWith("…")).toBe(true);
  });

  it("vacío → nada que guardar", () => {
    expect(toMissedPhrase("   ", routing, 0)).toBeNull();
  });

  it("las etiquetas se sanean igual que en los contadores; el respaldo solo si es conocido", () => {
    expect(toMissedPhrase("x", { route: "Model!", modelTools: ["llama a mamá"], retry: "otro", fallback: "notUnderstood" }, 0)).toMatchObject({
      route: "other",
      modelTool: "other",
      retry: null,
      fallback: "notUnderstood",
    });
    expect(toMissedPhrase("x", { ...routing, fallback: "texto libre" }, 0)?.fallback).toBeNull();
  });
});

describe("formatMissedForCopy", () => {
  it("una línea por frase, con su señal", () => {
    const rows = [
      { ts: 0, text: "avísame del dentista", route: "model", modelTool: "create_reminder", retry: null, fallback: null },
      { ts: 0, text: "bla", route: "model", modelTool: null, retry: "nudge" as const, fallback: "actionFailed" },
      { ts: 0, text: "qué tal", route: "model", modelTool: null, retry: "constrained" as const, fallback: null },
    ];
    expect(formatMissedForCopy(rows)).toBe("[tool:create_reminder] avísame del dentista\n[actionFailed] bla\n[retry:constrained] qué tal");
  });
});

describe("0.1.41 — órdenes que NIDO tomó por conversación", () => {
  it.each([
    "Que no se te olvide que el martes pago la renta",
    "Por cierto,soy vegetariano",
    "Que sabes de mi ?",
    "Que dia cae el 25 de diciembre",
    "mi cumpleaños es el 3 de mayo",
    "llama a mi hermana",
    "btw I'm vegetarian",
    "remind me to call mom",
    "me lembra de pagar a conta",
    "sou alérgico a camarão",
  ])("«%s» se registra", (t) => {
    expect(looksLikeMissedCommand(t)).toBe(true);
  });

  it.each(["¿qué es la inflación?", "hola", "cuéntame un chiste", "¿quién ganó el mundial de 2010?", "gracias"])(
    "«%s» es conversación de verdad",
    (t) => {
      expect(looksLikeMissedCommand(t)).toBe(false);
    },
  );
});
