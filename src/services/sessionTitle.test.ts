/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { titleFromQuestion } from "./sessionTitle";

describe("título de chat sin modelo", () => {
  it.each([
    ["¿Qué es la fotosíntesis?", "Qué es la fotosíntesis"],
    ["how do vaccines work?", "How do vaccines work"],
    ["hola, ¿cómo hago RCP a un adulto?", "Cómo hago RCP a un adulto"],
    ["  o que é um buraco negro  ", "O que é um buraco negro"],
  ])("%s → %s", (q, t) => expect(titleFromQuestion(q)).toBe(t));

  it("corta en una palabra entera y marca el corte", () => {
    const t = titleFromQuestion("Compare the French Revolution and the Industrial Revolution in terms of causes");
    expect(t.length).toBeLessThanOrEqual(49);
    expect(t.endsWith("…")).toBe(true);
    expect(t).toMatch(/^Compare the French Revolution and the/);
  });

  it("vacío si no hay texto", () => expect(titleFromQuestion("  ¿?  ")).toBe(""));
});

describe("el chat ya no pide el título al modelo", () => {
  it("ChatScreen no llama a generateSessionTitle", () => {
    const src = readFileSync(fileURLToPath(new URL("../ui/ChatScreen.tsx", import.meta.url)), "utf8");
    expect(src).not.toMatch(/generateSessionTitle\(/);
  });
});
