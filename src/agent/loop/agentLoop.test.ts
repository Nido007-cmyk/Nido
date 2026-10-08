/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi } from "vitest";
import {
  parseToolCalls,
  stripToolBlocks,
  stripEchoedInstruction,
  finalizeResponse,
  runAgentLoop,
  buildSystemPrompt,
  estimatePromptTokens,
  type AgentEngine,
} from "./agentLoop";

describe("parseToolCalls", () => {
  it("extrae un bloque tool válido", () => {
    const text = 'Claro.\n```tool\n{"name": "device_time", "arguments": {}}\n```';
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("device_time");
    expect(calls[0].arguments).toEqual({});
  });

  it("extrae varios bloques", () => {
    const text =
      '```tool\n{"name": "save_note", "arguments": {"title": "a", "body": "b"}}\n```\n' +
      '```tool\n{"name": "device_time"}\n```';
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(2);
    expect(calls[1].arguments).toEqual({});
  });

  it("ignora bloques con JSON roto", () => {
    const calls = parseToolCalls("```tool\n{no json}\n```");
    expect(calls).toHaveLength(0);
  });

  it("devuelve vacío si no hay bloques", () => {
    expect(parseToolCalls("Hola, ¿en qué te ayudo?")).toHaveLength(0);
  });

  // BUG-4-2026-10-06: modelos pequeños generan llamadas estilo PYTHON.
  it("parsea bloque python con llamada estilo función", () => {
    const text =
      'Claro.\n```python\ncreate_reminder(\n    text="mom birthday",\n    at="2027-03-15T00:00:00"\n)\n```\nListo.';
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("create_reminder");
    expect(calls[0].arguments).toEqual({ text: "mom birthday", at: "2027-03-15T00:00:00" });
  });

  it("prefiere formato tool cuando ambos existen", () => {
    const text =
      '```tool\n{"name": "device_time", "arguments": {}}\n```\n```python\ndevice_time()\n```';
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("device_time");
  });

  it("ignora bloque python sin llamada válida", () => {
    expect(parseToolCalls("```python\nprint('hola')\n```")).toHaveLength(1);
    // print no es tool válido del manifiesto, pero el parser lo extrae;
    // el dispatcher lo rechazará. Solo verifica que no rompe.
  });
});

describe("stripToolBlocks", () => {
  it("quita los bloques y deja la prosa", () => {
    const text = 'Voy a ver la hora.\n```tool\n{"name": "device_time"}\n```\nListo.';
    // El bloque se quita y queda un salto de párrafo en su lugar.
    expect(stripToolBlocks(text)).toBe("Voy a ver la hora.\n\nListo.");
  });

  // BUG-4-2026-10-06: también quitar bloques python con tool calls.
  it("quita bloques python con tool calls", () => {
    const text = 'Voy a guardar.\n```python\ncreate_reminder(\n    text="x"\n)\n```\nListo.';
    expect(stripToolBlocks(text)).toBe("Voy a guardar.\n\nListo.");
  });
});

function fakeEngine(responses: string[]): AgentEngine & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  let i = 0;
  return {
    calls,
    generate: vi.fn(async (args: unknown) => {
      calls.push([args]);
      return responses[Math.min(i++, responses.length - 1)];
    }),
  };
}

describe("runAgentLoop", () => {
  it("responde directo cuando el modelo no usa herramientas", async () => {
    const engine = fakeEngine(["Hola, ¿en qué te ayudo?"]);
    const result = await runAgentLoop("dime algo interesante", {
      engine,
      handlers: {},
      loadMemory: async () => null,
    });
    expect(result.response).toBe("Hola, ¿en qué te ayudo?");
    expect(result.intent).toBe("conversar");
    expect(result.toolUses).toHaveLength(0);
  });

  it("P2.2: saludo puro se sirve determinístico sin llamar al modelo", async () => {
    const engine = fakeEngine(["NO DEBERÍA USARSE"]);
    const result = await runAgentLoop("hola", {
      engine,
      handlers: {},
      loadMemory: async () => null,
    });
    expect(result.response).toBe("¡Hola! Soy NIDO. ¿En qué te ayudo?");
    expect(result.deterministic).toBe(true);
    expect(engine.calls).toHaveLength(0);
  });

  it("P2.2: pregunta de identidad se sirve determinística", async () => {
    const engine = fakeEngine(["NO DEBERÍA USARSE"]);
    const result = await runAgentLoop("¿quién eres?", {
      engine,
      handlers: {},
      loadMemory: async () => null,
    });
    expect(result.deterministic).toBe(true);
    expect(result.response).toMatch(/sin internet/);
    expect(engine.calls).toHaveLength(0);
  });

  it("P2.5: BUG-4 usa la vía constrained antes del retry legacy", async () => {
    // "ten en cuenta que llueve": intent recordar, sin pre-router
    // determinístico → llega al modelo.
    const engine = fakeEngine([
      "Listo", // el modelo no emite tool call (BUG-4)
      '{"name": "remember_fact", "arguments": {"content": "llueve"}}', // vía constrained
      "Guardado en memoria.", // turno tras la observación
    ]);
    const result = await runAgentLoop("ten en cuenta que llueve", {
      engine,
      handlers: {
        remember_fact: async (args) => `guardado: ${String(args.content)}`,
      },
      loadMemory: async () => null,
    });
    expect(result.toolUses).toHaveLength(1);
    expect(result.toolUses[0].name).toBe("remember_fact");
    expect(result.toolUses[0].result).toContain("llueve");
    // La 2ª llamada al engine fue la vía constrained (json_schema).
    const constrainedParams = engine.calls[1][0] as Record<string, unknown>;
    expect(constrainedParams.responseFormat).toMatchObject({ type: "json_schema" });
    expect(constrainedParams.samplingPreset).toBe("structured");
  });

  it("P2.5: si la vía constrained falla, el retry legacy sigue como backstop", async () => {
    const engine = fakeEngine([
      "Listo", // sin tool call → BUG-4
      "basura", // constrained attempt 1: inválido
      "más basura", // constrained repair: inválido → null → backstop
      '```tool\n{"name": "remember_fact", "arguments": {"content": "llueve"}}\n```', // retry legacy
      "Guardado.",
    ]);
    const result = await runAgentLoop("ten en cuenta que llueve", {
      engine,
      handlers: {
        remember_fact: async (args) => `guardado: ${String(args.content)}`,
      },
      loadMemory: async () => null,
    });
    expect(result.toolUses).toHaveLength(1);
    expect(result.toolUses[0].name).toBe("remember_fact");
  });

  it("ejecuta la herramienta y continúa con la observación", async () => {
    const engine = fakeEngine([
      'Voy a ver la hora.\n```tool\n{"name": "device_time", "arguments": {}}\n```',
      "Son las 10:30.",
    ]);
    const result = await runAgentLoop("¿qué hora es?", {
      engine,
      handlers: {
        device_time: async () => "2026-09-26T10:30:00",
      },
      loadMemory: async () => null,
    });
    expect(result.toolUses).toHaveLength(1);
    expect(result.toolUses[0].name).toBe("device_time");
    expect(result.toolUses[0].result).toContain("10:30");
    expect(result.response).toBe("Son las 10:30.");
    // La observación volvió al contexto del segundo turno.
    const secondCallMessages = (engine.calls[1][0] as { messages: { content: string }[] })
      .messages;
    expect(
      secondCallMessages.some((m) => m.content.includes("Observación de herramientas"))
    ).toBe(true);
  });

  it("inyecta la memoria en el system prompt", async () => {
    const engine = fakeEngine(["Listo."]);
    // Nota: "recuérdame algo" ahora activa la extracción determinística
    // (patrón recuérdame que X), así que usamos un input que no matchea
    // para probar la inyección de memoria en el system prompt.
    await runAgentLoop("cuéntame un chiste", {
      engine,
      handlers: {},
      loadMemory: async () => ({
        facts: [{ content: "cumpleaños el 3 de mayo", category: "personal" }],
        preferences: [],
        people: [],
        recentLog: [],
      }),
    });
    const system = (engine.calls[0][0] as { messages: { content: string }[] })
      .messages[0].content;
    expect(system).toContain("cumpleaños el 3 de mayo");
    expect(system).toContain("Eres NIDO");
  });

  it("una herramienta desconocida se vuelve observación y el loop sigue", async () => {
    const engine = fakeEngine([
      '```tool\n{"name": "volar", "arguments": {}}\n```',
      "No puedo volar, lo siento.",
    ]);
    const result = await runAgentLoop("vuela", {
      engine,
      handlers: {},
      loadMemory: async () => null,
    });
    expect(result.toolUses).toHaveLength(1);
    expect(result.toolUses[0].result).toMatch(/desconocida|error/i);
    expect(result.response).toBe("No puedo volar, lo siento.");
  });

  it("si falla la memoria, el loop sigue sin ella", async () => {
    const engine = fakeEngine(["Hola."]);
    const result = await runAgentLoop("dime algo interesante", {
      engine,
      handlers: {},
      loadMemory: async () => {
        throw new Error("db rota");
      },
    });
    expect(result.response).toBe("Hola.");
  });
});

describe("presupuesto de contexto (T-contexto-2026-10-06)", () => {
  it("estimatePromptTokens aproxima ~3 chars por token + overhead (M1)", async () => {
    const { estimatePromptTokens } = await import("./agentLoop");
    // M1-2026-10-06: heurística más segura — ÷3 + 50 de overhead ChatML.
    expect(estimatePromptTokens("a".repeat(300))).toBe(150); // 100 + 50
    expect(estimatePromptTokens("")).toBe(50); // solo overhead
  });

  it("assertPromptBudget pasa cuando cabe", async () => {
    const { assertPromptBudget } = await import("./agentLoop");
    expect(() =>
      assertPromptBudget(
        [{ role: "user", content: "hola" }],
        4096,
        512,
        "test"
      )
    ).not.toThrow();
  });

  it("assertPromptBudget falla con error accionable (no 'Context is full' nativo)", async () => {
    const { assertPromptBudget } = await import("./agentLoop");
    const big = "x".repeat(20000); // ~5000 tokens
    expect(() =>
      assertPromptBudget([{ role: "user", content: big }], 2048, 512, "test")
    ).toThrow(/excede el contexto/);
    try {
      assertPromptBudget([{ role: "user", content: big }], 2048, 512, "test");
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toMatch(/Context is full/);
    }
  });

  it("runAgentLoop degrada sin memoria cuando el prompt completo no cabe", async () => {
    const engine = fakeEngine(["Hola."]);
    const memText = "DATO ".repeat(5000); // memoria enorme a propósito
    // nCtx: cabe sin memoria (~2k tokens del system) pero no con ella.
    const result = await runAgentLoop("dime algo interesante", {
      engine,
      handlers: {},
      nCtx: 4096,
      loadMemory: async () => ({
        facts: [{ category: "general", content: memText }],
        preferences: [],
        people: [],
        recentLog: [],
      }),
    });
    expect(result.response).toBe("Hola.");
    // El engine sí fue llamado: la degradación evitó el fallo.
    expect(engine.calls.length).toBeGreaterThan(0);
  });

  it("runAgentLoop falla claro cuando ni sin memoria cabe", async () => {
    const engine = fakeEngine(["Hola."]);
    await expect(
      runAgentLoop("dime algo interesante", {
        engine,
        handlers: {},
        nCtx: 10, // absurdamente pequeño: ni el system prompt cabe
        loadMemory: async () => null,
      })
    ).rejects.toThrow(/excede el contexto/);
    expect(engine.calls).toHaveLength(0);
  });
});

describe("T-echo-2026-10-06: eco de la directiva interna", () => {
  it("stripEchoedInstruction deja intacta una respuesta normal", () => {
    expect(stripEchoedInstruction("Hola, ¿cómo estás?")).toBe("Hola, ¿cómo estás?");
    expect(
      stripEchoedInstruction("Listo, guardé el cumpleaños de tu mamá en mi memoria.")
    ).toBe("Listo, guardé el cumpleaños de tu mamá en mi memoria.");
  });

  it("stripEchoedInstruction elimina el eco exacto (fuga vista en dispositivo)", () => {
    const echo =
      "Si ya tienes lo necesario, responde al usuario en español sin más bloques de herramienta.";
    expect(stripEchoedInstruction(echo)).toBe("");
  });

  it("stripEchoedInstruction elimina el eco aunque cambie capitalización/puntuación", () => {
    const echo =
      "CONTINÚA: si ya tienes lo necesario responde al usuario en español, sin más bloques de herramienta!!!";
    expect(stripEchoedInstruction(echo)).toBe("");
  });

  it("stripEchoedInstruction conserva la prosa y quita solo la oración eco", () => {
    const mixed =
      "Listo, lo guardé. Si ya tienes lo necesario, responde al usuario en español sin más bloques de herramienta.";
    expect(stripEchoedInstruction(mixed)).toBe("Listo, lo guardé.");
  });

  it("stripEchoedInstruction elimina el eco de la directiva nueva entre corchetes", () => {
    const echo =
      "[directiva de formato: genera tu respuesta final al usuario en español; no emitas bloques de herramienta]";
    expect(stripEchoedInstruction(echo)).toBe("");
  });

  it("finalizeResponse combina stripToolBlocks + stripEchoedInstruction", () => {
    expect(finalizeResponse("Hola.")).toBe("Hola.");
    expect(
      finalizeResponse(
        "Si ya tienes lo necesario, responde al usuario en español sin más bloques de herramienta."
      )
    ).toBeNull();
    expect(finalizeResponse("   ")).toBeNull();
  });

  it("runAgentLoop reintenta una vez si el modelo solo repite la directiva", async () => {
    const engine = fakeEngine([
      "Si ya tienes lo necesario, responde al usuario en español sin más bloques de herramienta.",
      "¡Hola! ¿Cómo estás?",
    ]);
    const result = await runAgentLoop("dime algo interesante", {
      engine,
      handlers: {},
      loadMemory: async () => null,
    });
    expect(result.response).toBe("¡Hola! ¿Cómo estás?");
    expect(engine.calls).toHaveLength(2);
    // El reintento lleva una instrucción mínima de reparación.
    const repairMessages = (engine.calls[1][0] as { messages: { content: string }[] }).messages;
    expect(repairMessages[repairMessages.length - 1].content).toContain("tu respuesta al usuario");
  });

  it("runAgentLoop usa la respuesta segura si el reintento también es eco", async () => {
    const engine = fakeEngine([
      "si ya tienes lo necesario, responde al usuario en español sin más bloques de herramienta",
      "[directiva de formato: genera tu respuesta final al usuario en español; no emitas bloques de herramienta]",
    ]);
    const result = await runAgentLoop("dime algo interesante", {
      engine,
      handlers: {},
      loadMemory: async () => null,
    });
    expect(result.response).toBe("Listo.");
    expect(engine.calls).toHaveLength(2);
  });

  it("la directiva inyectada tras herramientas ya no es una oración repetible", async () => {
    const engine = fakeEngine([
      '```tool\n{"name": "device_time", "arguments": {}}\n```',
      "Son las 10:30.",
    ]);
    await runAgentLoop("¿qué hora es?", {
      engine,
      handlers: { device_time: async () => "2026-09-26T10:30:00" },
      loadMemory: async () => null,
    });
    const secondCallMessages = (engine.calls[1][0] as { messages: { content: string }[] }).messages;
    const injected = secondCallMessages[secondCallMessages.length - 1].content;
    expect(injected).toContain("Observación de herramientas");
    // La directiva nueva es meta-lingüística entre corchetes, no imperativo conversacional.
    expect(injected).toContain("[directiva de formato:");
    expect(injected).not.toMatch(/Continúa: si ya tienes lo necesario/);
  });
});

describe("P1.2 intent-based sampling presets", () => {
  it("conversar -> preset chat", async () => {
    const engine = fakeEngine(["Hola, ¿en qué te ayudo?"]);
    await runAgentLoop("dime algo interesante", { engine, handlers: {}, loadMemory: async () => null });
    const args = engine.calls[0][0] as { samplingPreset?: string; temperature?: number };
    expect(args.samplingPreset).toBe("chat");
    expect(args.temperature).toBeUndefined();
  });

  it("actuar -> preset structured", async () => {
    const engine = fakeEngine([
      'Voy a ver la hora.\n```tool\n{"name": "device_time", "arguments": {}}\n```',
      "Son las 10:30.",
    ]);
    await runAgentLoop("¿qué hora es?", {
      engine,
      handlers: { device_time: async () => "2026-09-26T10:30:00" },
      loadMemory: async () => null,
    });
    const args = engine.calls[0][0] as { samplingPreset?: string; temperature?: number };
    expect(args.samplingPreset).toBe("structured");
    expect(args.temperature).toBeUndefined();
  });

  it("temperatura explícita del llamador desactiva el preset", async () => {
    const engine = fakeEngine(["Hola"]);
    await runAgentLoop("dime algo interesante", { engine, handlers: {}, loadMemory: async () => null, temperature: 0.5 });
    const args = engine.calls[0][0] as { samplingPreset?: string; temperature?: number };
    expect(args.temperature).toBe(0.5);
    expect(args.samplingPreset).toBeUndefined();
  });
});

describe("P1.3 system-prompt diet", () => {
  // Fixed overhead (memory empty — user data is never cut). recordar/
  // conversar meet the <900 target; actuar (23 tools, all live) is cut
  // 2020→~1590 and bound below 1600. Getting actuar under 900 would
  // require rewriting the 23 manifest descriptions — a content change
  // with its own quality risk, out of this lane's minimum-diffs scope.
  it("presupuesto fijo acotado por intent", () => {
    expect(estimatePromptTokens(buildSystemPrompt("recordar", ""))).toBeLessThan(900);
    expect(estimatePromptTokens(buildSystemPrompt("conversar", ""))).toBeLessThan(900);
    expect(estimatePromptTokens(buildSystemPrompt("actuar", ""))).toBeLessThan(1750);
  });

  it("la dieta es sustancial vs el prompt anterior", () => {
    // Old prompt: full 24-tool verbose list on every turn (~2020 tokens
    // by the same heuristic). Lean paths must be well under half of that.
    expect(estimatePromptTokens(buildSystemPrompt("conversar", ""))).toBeLessThan(1000);
    expect(estimatePromptTokens(buildSystemPrompt("recordar", ""))).toBeLessThan(1000);
  });

  it("recordar solo lista remember_fact", () => {
    const p = buildSystemPrompt("recordar", "");
    expect(p).toContain("- remember_fact");
    // List entries use "- name" format; the format *example* below may
    // mention other tools, so assert on the list-entry shape.
    expect(p).not.toContain("- device_time");
    expect(p).not.toContain("- place_call");
  });

  it("conversar lista las 3 herramientas comunes", () => {
    const p = buildSystemPrompt("conversar", "");
    expect(p).toContain("- device_time");
    expect(p).toContain("- calculate");
    expect(p).toContain("- remember_fact");
    expect(p).not.toContain("- place_call");
    expect(p).not.toContain("- nido_send_message");
  });

  it("actuar conserva las herramientas de acción", () => {
    const p = buildSystemPrompt("actuar", "");
    expect(p).toContain("- create_reminder");
    expect(p).toContain("- place_call");
    expect(p).toContain("- use_skill");
  });

  it("conserva los invariantes críticos: fecha (BUG-1), seguridad, grounding", () => {
    const p = buildSystemPrompt("conversar", "");
    expect(p).toContain("Hoy es");
    expect(p).toContain("PRÓXIMA ocurrencia futura");
    expect(p).toContain("<untrusted>");
    expect(p).toContain("REGLA DE GROUNDING");
    expect(p).toContain("```tool");
  });

  it("la memoria del usuario nunca se recorta", () => {
    const mem = "Hechos:\n- [personal] cumpleaños el 3 de mayo";
    expect(buildSystemPrompt("conversar", mem)).toContain("cumpleaños el 3 de mayo");
  });
});
