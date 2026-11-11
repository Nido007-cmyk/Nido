/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * prepareEngine.test.ts — carga del modelo cuando el turno lo necesita
 * (2026-11-11).
 *
 * Defecto probado en la 0.1.93: el envío cargaba el modelo antes de
 * mirar el texto, así que un turno que la capa determinista o una guía
 * responden sin modelo esperaba la carga entera, y si el modelo no
 * cabía el envío se detenía sin respuesta. El bucle del agente recibe
 * ahora `prepareEngine`: se llama una sola vez, justo antes del primer
 * uso del modelo, y nunca en las vías deterministas.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAgentLoop, estimatePromptTokens, type AgentEngine } from "./agentLoop";

function fakeEngine(responses: string[]): AgentEngine & { calls: Array<{ nPredict?: number }> } {
  const calls: Array<{ nPredict?: number }> = [];
  let i = 0;
  return {
    calls,
    generate: vi.fn(async (args: { nPredict?: number }) => {
      calls.push(args);
      return responses[Math.min(i++, responses.length - 1)];
    }) as never,
  };
}

const TIME: Array<[string, "es" | "en" | "pt"]> = [
  ["¿qué hora es?", "es"],
  ["what time is it", "en"],
  ["que horas são", "pt"],
];

describe("prepareEngine — las vías deterministas no cargan el modelo (es/en/pt)", () => {
  it.each(TIME)("«%s» (%s) responde por código sin pedir el motor", async (text, lang) => {
    const engine = fakeEngine(["no debería llamarse"]);
    const prepareEngine = vi.fn(async () => 2048);
    const result = await runAgentLoop(text, {
      engine,
      lang,
      handlers: { device_time: async () => "martes, 13 de octubre de 2026, 9:41" } as never,
      prepareEngine,
    });
    expect(result.toolUses.map((u) => u.name)).toContain("device_time");
    expect(result.routing?.route).not.toBe("model");
    expect(prepareEngine).not.toHaveBeenCalled();
    expect(engine.calls).toHaveLength(0);
  });

  it("una pregunta sobre la memoria guardada tampoco lo pide", async () => {
    const engine = fakeEngine(["no debería llamarse"]);
    const prepareEngine = vi.fn(async () => 2048);
    const result = await runAgentLoop("¿cómo se llama mi mamá?", {
      engine,
      lang: "es",
      handlers: {},
      prepareEngine,
      loadMemory: async () => ({
        facts: [],
        preferences: [],
        people: [{ name: "Rosa", relationship: "mamá" }],
        recentLog: [],
      }) as never,
    });
    expect(result.response).toContain("Rosa");
    expect(prepareEngine).not.toHaveBeenCalled();
    expect(engine.calls).toHaveLength(0);
  });
});

describe("prepareEngine — el turno que genera lo pide una vez y antes de generar", () => {
  it("se llama una sola vez y antes del primer generate, aunque el bucle dé varios pasos", async () => {
    const order: string[] = [];
    const engine: AgentEngine = {
      generate: vi.fn(async () => {
        order.push("generate");
        return order.filter((o) => o === "generate").length === 1
          ? '```tool\n{"name": "device_time", "arguments": {}}\n```'
          : "Son las 9:41.";
      }) as never,
    };
    const prepareEngine = vi.fn(async () => {
      order.push("prepare");
      return 4096;
    });
    const result = await runAgentLoop("dime algo interesante sobre los relojes", {
      engine,
      lang: "es",
      handlers: { device_time: async () => "9:41" } as never,
      prepareEngine,
    });
    expect(result.response.length).toBeGreaterThan(0);
    expect(prepareEngine).toHaveBeenCalledTimes(1);
    expect(order[0]).toBe("prepare");
    expect(order.filter((o) => o === "generate").length).toBeGreaterThanOrEqual(1);
  });

  it("el presupuesto usa el n_ctx que devuelve la carga, no el supuesto", async () => {
    // Con 4096 supuestos el turno pide los 512 tokens enteros. El n_ctx
    // del modelo que de verdad quedó cargado es más estrecho: se elige
    // aquí el mayor que ya no deja sitio para 512 (lo que ocupa el
    // prompt + 512 + el margen de 64 − 1), sin fijar a mano el tamaño
    // del prompt de sistema.
    const wide = fakeEngine(["Hola."]);
    await runAgentLoop("dime algo interesante", { engine: wide, handlers: {}, nCtx: 4096 });
    expect(wide.calls[0].nPredict).toBe(512);
    const used = estimatePromptTokens(
      (wide.calls[0] as unknown as { messages: Array<{ content: string }> }).messages.map((m) => m.content).join("\n")
    );
    const realNCtx = used + 512 + 64 - 1;
    const narrow = fakeEngine(["Hola."]);
    await runAgentLoop("dime algo interesante", {
      engine: narrow,
      handlers: {},
      nCtx: 4096,
      prepareEngine: async () => realNCtx,
    });
    expect(narrow.calls[0].nPredict).toBe(511);
  });

  it("si la carga no devuelve n_ctx vale el declarado; sin prepareEngine nada cambia", async () => {
    const a = fakeEngine(["Hola."]);
    await runAgentLoop("dime algo interesante", { engine: a, handlers: {}, nCtx: 4096, prepareEngine: async () => undefined });
    const b = fakeEngine(["Hola."]);
    await runAgentLoop("dime algo interesante", { engine: b, handlers: {}, nCtx: 4096 });
    expect(a.calls[0].nPredict).toBe(b.calls[0].nPredict);
  });

  it("si el modelo no cabe, el error de la carga sube tal cual y no se genera", async () => {
    const engine = fakeEngine(["Hola."]);
    const boom = new Error("RAM_BUDGET: no cabe");
    await expect(
      runAgentLoop("dime algo interesante", {
        engine,
        handlers: {},
        prepareEngine: async () => {
          throw boom;
        },
      })
    ).rejects.toBe(boom);
    expect(engine.calls).toHaveLength(0);
  });
});

describe("cableado — ChatScreen ya no carga el modelo al pulsar enviar", () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../ui/ChatScreen.tsx"), "utf8");
  const sendAt = source.indexOf("const send = useCallback(async (override?");
  const sendEnd = source.indexOf("}, [input, generating, ready, activeSessionId", sendAt);
  const send = source.slice(sendAt, sendEnd);

  it("el envío no espera a ensureChatModel fuera de requireChatModel", () => {
    expect(sendAt).toBeGreaterThan(-1);
    expect(sendEnd).toBeGreaterThan(sendAt);
    // La única llamada a ensureChatModel dentro del envío vive en requireChatModel.
    expect(send.match(/ensureChatModel\(\)/g)?.length).toBe(1);
    const helperAt = send.indexOf("const requireChatModel = async");
    const ensureAt = send.indexOf("ensureChatModel()");
    expect(helperAt).toBeGreaterThan(-1);
    expect(ensureAt).toBeGreaterThan(helperAt);
    expect(ensureAt - helperAt).toBeLessThan(400);
  });

  it("la capa determinista y la guía literal van antes de cualquier petición del modelo", () => {
    const firstRequire = send.indexOf("await requireChatModel()");
    expect(firstRequire).toBeGreaterThan(-1);
    for (const marker of [
      "matchSafetyAnswer(query, uiLang)",
      "answerKnowledgeQueryWithCategory(query, kbLocale)",
      "matchSmallTalk(query, uiLang)",
      "answerFromPackFacts(query, uiLang)",
    ]) {
      const at = send.indexOf(marker);
      expect(at, marker).toBeGreaterThan(-1);
      expect(at, marker).toBeLessThan(firstRequire);
    }
    // En la ruta fija: guía literal y texto seguro de salud antes de pedir el modelo.
    const guideAt = send.indexOf("await answerFromGuide(query, uiLang, retrievalQuery)");
    const safeAt = send.indexOf("const safe = healthSafeText(uiLang);");
    const fixedRequire = send.indexOf("await requireChatModel();\n          // Detener durante");
    expect(guideAt).toBeGreaterThan(-1);
    expect(safeAt).toBeGreaterThan(guideAt);
    expect(fixedRequire).toBeGreaterThan(safeAt);
    const firstGenerate = send.indexOf("await llamaEngine.generate(genInput)");
    expect(firstGenerate).toBeGreaterThan(fixedRequire);
  });

  it("cada camino que genera pide el modelo antes de usarlo", () => {
    const before = (need: string, use: string) => {
      const useAt = send.indexOf(use);
      expect(useAt, use).toBeGreaterThan(-1);
      const needAt = send.lastIndexOf(need, useAt);
      expect(needAt, use).toBeGreaterThan(-1);
      return useAt - needAt;
    };
    expect(before("await requireChatModel();", "await runDeepResearch(")).toBeLessThan(80);
    expect(before("await requireChatModel();", "await runAdaptiveChat(")).toBeLessThan(80);
    expect(send).toContain("prepareEngine: async () => {\n            await requireChatModel();");
  });

  it("el resumen en segundo plano no carga el modelo por su cuenta", () => {
    expect(send).toContain("settings.autoSummarize && !wasStopped && llamaEngine.isLoaded");
  });
});
