import { describe, it, expect, vi } from "vitest";
import {
  parseToolCalls,
  stripToolBlocks,
  stripEchoedInstruction,
  finalizeResponse,
  runAgentLoop,
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
});

describe("stripToolBlocks", () => {
  it("quita los bloques y deja la prosa", () => {
    const text = 'Voy a ver la hora.\n```tool\n{"name": "device_time"}\n```\nListo.';
    // El bloque se quita y queda un salto de párrafo en su lugar.
    expect(stripToolBlocks(text)).toBe("Voy a ver la hora.\n\nListo.");
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
    const result = await runAgentLoop("hola", {
      engine,
      handlers: {},
      loadMemory: async () => null,
    });
    expect(result.response).toBe("Hola, ¿en qué te ayudo?");
    expect(result.intent).toBe("conversar");
    expect(result.toolUses).toHaveLength(0);
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
    await runAgentLoop("recuérdame algo", {
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
    const result = await runAgentLoop("hola", {
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
  it("estimatePromptTokens aproxima ~4 chars por token", async () => {
    const { estimatePromptTokens } = await import("./agentLoop");
    expect(estimatePromptTokens("a".repeat(400))).toBe(100);
    expect(estimatePromptTokens("")).toBe(0);
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
    const result = await runAgentLoop("hola", {
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
      runAgentLoop("hola", {
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
    const result = await runAgentLoop("hola", {
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
    const result = await runAgentLoop("hola", {
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
