/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Núcleo 3 · N-09: la ventana de historial del resumidor. Antes el
// transcript se recortaba por la cola a 6.000 caracteres y los
// turnos viejos no entraban en NINGUNA pasada: sus datos se perdían
// del resumen en silencio. Estas fixtures fijan el resumido
// progresivo por trozos y la instrucción en el idioma de la
// conversación.
import { describe, it, expect, vi, beforeEach } from "vitest";

const generateMock = vi.fn();
vi.mock("../inference/LlamaEngine", () => ({
  llamaEngine: {
    generate: (opts: any) => generateMock(opts),
    hasEmbeddedChatTemplate: () => false,
  },
}));

import { summarizeConversation } from "./summarize";
import type { ConversationTurn } from "../rag/pure";

function inputsOf(): string[] {
  return generateMock.mock.calls.map((c) => String((c[0] as any).prompt ?? ""));
}

beforeEach(() => {
  generateMock.mockReset();
  generateMock.mockImplementation(async () => "resumen de la pasada");
});

describe("N-09 — resumido progresivo por trozos", () => {
  it("un turno viejo con un dato entra en alguna pasada (antes lo cortaba la cola)", async () => {
    const turns: ConversationTurn[] = [
      { role: "user", text: "Mi código de la puerta es 7319, no lo olvides" },
      { role: "assistant", text: "Anotado." },
    ];
    // Relleno suficiente para pasar de largo los 6.000 caracteres.
    for (let i = 0; i < 30; i++) {
      turns.push({ role: "user", text: `relleno ${i} ` + "x".repeat(180) });
      turns.push({ role: "assistant", text: "ok " + "y".repeat(60) });
    }
    await summarizeConversation(turns, null);
    const inputs = inputsOf();
    expect(inputs.length).toBeGreaterThan(1);
    expect(inputs.some((p) => p.includes("7319"))).toBe(true);
    // Cada llamada al motor sigue acotada (el presupuesto de C3 manda por trozo).
    for (const p of inputs) expect(p.length).toBeLessThan(9000);
  });

  it("cada pasada encadena el resumen de la anterior", async () => {
    const turns: ConversationTurn[] = [];
    for (let i = 0; i < 30; i++) {
      turns.push({ role: "user", text: `turno ${i} ` + "z".repeat(200) });
    }
    let call = 0;
    generateMock.mockImplementation(async () => `RESUMEN-${++call}`);
    const out = await summarizeConversation(turns, null);
    const inputs = inputsOf();
    expect(inputs.length).toBeGreaterThan(1);
    expect(inputs[1]).toContain("RESUMEN-1");
    expect(out).toBe(`RESUMEN-${inputs.length}`);
  });

  it("el resumen previo entra en la primera pasada con su etiqueta", async () => {
    await summarizeConversation([{ role: "user", text: "Hola" }], "El usuario se llama Ana.");
    expect(inputsOf()[0]).toContain("Existing summary:");
    expect(inputsOf()[0]).toContain("El usuario se llama Ana.");
  });

  it("una sola línea gigante no rompe el presupuesto: se recorta dentro de su trozo", async () => {
    await summarizeConversation([{ role: "user", text: "w".repeat(20000) }], null);
    for (const p of inputsOf()) expect(p.length).toBeLessThan(9000);
  });
});

describe("N-09 — la instrucción va en el idioma de la conversación", () => {
  it("es", async () => {
    await summarizeConversation([{ role: "user", text: "Hola" }], null, "es");
    expect(inputsOf()[0]).toContain("Resume los datos clave");
    expect(inputsOf()[0]).not.toContain("Summarize the key facts");
  });
  it("pt", async () => {
    await summarizeConversation([{ role: "user", text: "Olá" }], null, "pt");
    expect(inputsOf()[0]).toContain("Resuma os fatos principais");
  });
  it("en por defecto, con la instrucción original", async () => {
    await summarizeConversation([{ role: "user", text: "Hi" }], null);
    expect(inputsOf()[0]).toContain("Summarize the key facts, constraints, and user preferences");
  });
});
