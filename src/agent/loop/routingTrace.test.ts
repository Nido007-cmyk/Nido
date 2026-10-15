/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.39: AgentLoopResult.routing — por dónde salió cada turno, para medir
 * lo que el router deja pasar al modelo. Solo etiquetas, nunca texto.
 */
import { describe, expect, it, vi } from "vitest";
import { runAgentLoop, type AgentEngine } from "./agentLoop";

function fakeEngine(responses: string[]): AgentEngine & { calls: number } {
  let i = 0;
  const engine = {
    calls: 0,
    generate: vi.fn(async () => {
      engine.calls++;
      return responses[Math.min(i++, responses.length - 1)];
    }),
  };
  return engine;
}

const base = { handlers: {}, loadMemory: async () => null };

describe("routing: vías deterministas", () => {
  it("plantilla (saludo) → fixed, sin modelo", async () => {
    const engine = fakeEngine(["NO"]);
    const r = await runAgentLoop("hola", { ...base, engine });
    expect(r.routing).toEqual({ route: "fixed", modelTools: [], retry: null, fallback: null });
    expect(engine.calls).toBe(0);
  });

  it("calculadora → calc", async () => {
    const engine = fakeEngine(["NO"]);
    const r = await runAgentLoop("cuánto es 2+2", { ...base, engine });
    expect(r.routing?.route).toBe("calc");
    expect(engine.calls).toBe(0);
  });

  it("0.1.42: una muletilla delante no saca la orden de su vía", async () => {
    const engine = fakeEngine(["NO"]);
    const r = await runAgentLoop("oye,  cuánto es 2+2 ?", { ...base, engine });
    expect(r.routing?.route).toBe("calc");
    expect(engine.calls).toBe(0);
  });

  it("nunca lleva el texto del mensaje", async () => {
    const engine = fakeEngine(["NO"]);
    const r = await runAgentLoop("cuánto es 1234+5678", { ...base, engine });
    expect(JSON.stringify(r.routing)).not.toMatch(/1234|5678/);
  });
});

describe("routing: lo que se cuela al modelo", () => {
  it("conversación pura → model, sin herramientas ni reintento", async () => {
    const engine = fakeEngine(["Un dato curioso: los pulpos tienen tres corazones."]);
    const r = await runAgentLoop("dime algo interesante", { ...base, engine });
    expect(r.routing).toEqual({ route: "model", modelTools: [], retry: null, fallback: null });
  });

  it("el modelo pide una herramienta → queda apuntada (fallo del router por definición)", async () => {
    const engine = fakeEngine(['```tool\n{"name": "device_time", "arguments": {}}\n```', "Son las 10:30."]);
    const r = await runAgentLoop("oye, ¿qué hora es ahora mismo?", {
      ...base,
      engine,
      handlers: { device_time: async () => "2026-09-26T10:30:00" },
    });
    expect(r.routing?.route).toBe("model");
    expect(r.routing?.modelTools).toEqual(["device_time"]);
    expect(r.routing?.retry).toBeNull();
  });

  it("sin herramienta a la primera: reintento con JSON forzado", async () => {
    const engine = fakeEngine([
      "Listo",
      '{"name": "remember_fact", "arguments": {"content": "llueve"}}',
      "Guardado.",
    ]);
    const r = await runAgentLoop("guarda esto en tu memoria por favor", {
      ...base,
      engine,
      handlers: { remember_fact: async () => "ok" },
    });
    expect(r.routing).toMatchObject({ route: "model", modelTools: ["remember_fact"], retry: "constrained", fallback: null });
  });

  it("el JSON forzado falla y el empujón también → fallback memoryFailed", async () => {
    const engine = fakeEngine(["Listo", "basura", "más basura", "sigo sin herramienta"]);
    const r = await runAgentLoop("guarda esto en tu memoria por favor", {
      ...base,
      engine,
      handlers: { remember_fact: async () => "ok" },
    });
    expect(r.routing).toMatchObject({ route: "model", modelTools: [], retry: "nudge", fallback: "memoryFailed" });
  });
});
