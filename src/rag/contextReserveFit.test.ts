// @ts-nocheck
/**
 * 0.1.90 · Familia 5 — el cuento del zorro en el peldaño de emergencia.
 *
 * Foto del dueño (15:45 MST, Tab A9+, 0.1.89): «Cuéntame un cuento muy
 * corto de un zorro que aprende a nadar» murió con «system (436) +
 * mensaje actual (101) + reserva (512) exceden nCtx 1024 sin siquiera
 * historial». El Qwen3 se había cargado en el peldaño de emergencia
 * (1024) de la escalera de contexto y los ensambladores exigían la
 * reserva pedida ENTERA antes de componer, aunque el suelo degradable
 * de H-12 (degradableGenTokens) ya recortaba la generación DESPUÉS.
 * La cura degrada la reserva ANTES de juzgar el núcleo
 * (effectiveReserveGeneration), con los mismos peldaños.
 *
 * Aceptación: (i) el cuento genera (el ensamblado no muere) en
 * conversación nueva y con historial, en el nCtx de emergencia;
 * (ii) las cuentas caben para cada modelo chico del catálogo, en su
 * nCtx de emergencia y en el de su plan canónico; (iii) el sistema
 * servido es byte a byte el mismo (la seguridad no se degrada).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => 8 * 1024 ** 3,
  getMemoryInfo: () => ({ rssBytes: 0 }),
}));

import { assembleChatMessages, assemblePrompt, degradableGenTokens, effectiveReserveGeneration } from "./pure";
import { defaultTokenCounter } from "../agent/loop/contextBudget";
import { estimatePromptTokens } from "../agent/loop/agentLoop";
import { PERSONALITIES } from "../constants/personalities";
import { MODEL_CATALOG } from "../models/manifest";
import { canonicalSnapshot } from "../models/compatibility";
import { contextCeilingForDevice, contextSpecForModel } from "../models/defaultModel";
import { planContext, EMERGENCY_CONTEXT } from "../inference/memoryLadder";
import { DEFAULT_MAX_TOKENS } from "../models/settings";

const STORY = "Cuéntame un cuento muy corto de un zorro que aprende a nadar";
const succinct = PERSONALITIES.find((p) => p.id === "succinct")!;
const TAB_RAM = Math.floor(3416.14 * 1024 * 1024);

const storyBudget = (nCtx: number) => ({ nCtx, reserveGeneration: 512 });

describe("effectiveReserveGeneration: la reserva baja por los peldaños de H-12", () => {
  it("sin estrechez, la reserva pedida queda intacta", () => {
    expect(effectiveReserveGeneration(512, 4096, 537)).toBe(512);
  });
  it("en el peldaño de emergencia, baja a lo que el núcleo deja (487)", () => {
    expect(effectiveReserveGeneration(512, 1024, 436 + 101)).toBe(487);
  });
  it("nunca baja del suelo de 64", () => {
    expect(effectiveReserveGeneration(512, 1024, 980)).toBe(64);
  });
});

describe("familia 5 (i): el cuento del zorro en nCtx 1024", () => {
  it("conversación nueva: el ensamblado ya no muere y el cuento entra entero", () => {
    const msgs = assembleChatMessages(
      STORY, [], succinct.systemPrompt, undefined, succinct.styleReminder, false,
      storyBudget(EMERGENCY_CONTEXT)
    );
    expect(msgs[0].role).toBe("system");
    const last = msgs[msgs.length - 1];
    expect(last.content).toContain(STORY);
    // Queda generación real: el núcleo + el suelo de 64 cabe.
    const core = defaultTokenCounter(msgs[0].content) + defaultTokenCounter(last.content);
    expect(core + 64).toBeLessThanOrEqual(EMERGENCY_CONTEXT);
  });

  it("con historial de guías y resumen: tampoco muere; el historial se recorta, el sistema no", () => {
    const history = {
      summary:
        "El usuario preguntó por una fuga de gas en casa y se le sirvió la guía de SALVORA PACKS; después descargó y activó el modelo Qwen3-0.6B.",
      turns: [
        { role: "user" as const, text: "Mi casa huele a gas, ¿qué hago?" },
        { role: "assistant" as const, text: "Sal a pie de la casa y llama desde fuera. No enciendas luces ni aparatos." },
        { role: "user" as const, text: "¿Y si es el monóxido de carbono?" },
        { role: "assistant" as const, text: "El monóxido no se puede oler; por eso lleva detector." },
      ],
    };
    const msgs = assembleChatMessages(
      STORY, [], succinct.systemPrompt, history, succinct.styleReminder, false,
      storyBudget(EMERGENCY_CONTEXT)
    );
    const last = msgs[msgs.length - 1];
    expect(last.content).toContain(STORY);
    // El resumen (parte del sistema) sigue presente entero.
    expect(msgs[0].content).toContain("Fuga de gas".toLowerCase().length >= 0 ? "fuga de gas" : "");
    // El total estimado con la reserva efectiva cabe en la ventana.
    const total = msgs.reduce((acc, m) => acc + defaultTokenCounter(m.content), 0);
    expect(total).toBeLessThanOrEqual(EMERGENCY_CONTEXT);
  });

  it("la vía de prompt en texto también deja sitio de generación en 1024", () => {
    const prompt = assemblePrompt(
      STORY, [], succinct.systemPrompt, undefined, succinct.styleReminder, false,
      storyBudget(EMERGENCY_CONTEXT)
    );
    expect(prompt).toContain(STORY);
    expect(defaultTokenCounter(prompt) + 64).toBeLessThanOrEqual(EMERGENCY_CONTEXT);
  });

  it("la guarda honesta sigue: un núcleo que no cabe ni con 64 sigue muriendo", () => {
    const huge = "x".repeat(2400);
    expect(() =>
      assembleChatMessages(huge, [], succinct.systemPrompt, undefined, succinct.styleReminder, false, storyBudget(EMERGENCY_CONTEXT))
    ).toThrow(/sin siquiera historial/);
  });
});

describe("familia 5 (ii): las cuentas por modelo chico del catálogo", () => {
  const small = MODEL_CATALOG.filter(
    (m) => m.kind === "llm" && (m.sizeBytes ?? 0) > 0 && (m.sizeBytes ?? 0) <= 500 * 1024 * 1024
  );

  it("el censo de modelos chicos no viene vacío", () => {
    expect(small.length).toBeGreaterThanOrEqual(3);
  });

  for (const model of small) {
    it(`${model.id}: el cuento cabe en su nCtx de emergencia (${EMERGENCY_CONTEXT})`, () => {
      const msgs = assembleChatMessages(
        STORY, [], succinct.systemPrompt, undefined, succinct.styleReminder, false,
        storyBudget(EMERGENCY_CONTEXT)
      );
      expect(msgs[msgs.length - 1].content).toContain(STORY);
    });

    it(`${model.id}: y en el nCtx de su plan canónico en la Tab A9+`, () => {
      const ceiling = contextCeilingForDevice(model.defaultNCtx, TAB_RAM);
      const { nCtx: _planned, ...specBase } = contextSpecForModel(model, TAB_RAM);
      const plan = planContext(specBase, canonicalSnapshot(TAB_RAM), { ceiling, safety: 1 });
      expect(plan).not.toBeNull();
      const msgs = assembleChatMessages(
        STORY, [], succinct.systemPrompt, undefined, succinct.styleReminder, false,
        storyBudget(plan!.nCtx)
      );
      expect(msgs[msgs.length - 1].content).toContain(STORY);
    });
  }
});

describe("familia 5 (iv): la propuesta aplicada — respuestas completas, no cortadas por tope", () => {
  // La fórmula EXACTA de ChatScreen: ensamblar con el presupuesto,
  // estimar el prompt servido y degradar el deseo sobre lo que queda.
  const chatGenTokens = (query: string, personalityId: string, nCtx: number): number => {
    const p = PERSONALITIES.find((x) => x.id === personalityId)!;
    const msgs = assembleChatMessages(query, [], p.systemPrompt, undefined, p.styleReminder, false, {
      nCtx,
      reserveGeneration: DEFAULT_MAX_TOKENS,
    });
    const joined = msgs.map((m) => m.content).join("\n");
    return degradableGenTokens(DEFAULT_MAX_TOKENS, nCtx - estimatePromptTokens(joined) - 64).genTokens;
  };
  const EMAIL = "Redacta un correo breve y amable para pedir un día libre el viernes a mi jefe";
  const TIRE = "Explícame cómo cambiar una llanta en 5 pasos numerados, cada paso con una sola línea";
  const MiB = 1024 * 1024;
  const small = MODEL_CATALOG.filter(
    (m) => m.kind === "llm" && (m.sizeBytes ?? 0) > 0 && (m.sizeBytes ?? 0) <= 500 * 1024 * 1024
  );

  it("el tope por defecto deja de ser 512: es 1024 (ya ofrecido en Ajustes)", () => {
    expect(DEFAULT_MAX_TOKENS).toBe(1024);
  });

  it("el techo del Qwen3 se queda en 2048: subirlo a 3072 se midió y se rechazó", () => {
    // A 3072 el estimado es 851,2 MiB y el ajuste canónico es de filo
    // (la insignia caería a amarilla); con el estimador corriendo
    // ~7 % por debajo de los picos reales medidos en el aparato
    // (743–760 MB reales frente a 693,8 estimados a 2048), el pico
    // real a 3072 (~910–930 MB) supera la RAM libre medida de la
    // tableta (842 MB). El margen real estaba en el tope de salida,
    // no en el contexto. La matriz a su techo vigente:
    const q3 = MODEL_CATALOG.find((m) => m.id === "qwen3-0.6b-q4km")!;
    expect(contextCeilingForDevice(q3.defaultNCtx, TAB_RAM)).toBe(2048);
    const { nCtx: _c, ...spec } = contextSpecForModel(q3, TAB_RAM);
    const live = { totalRamBytes: TAB_RAM, rssBytes: 367 * MiB, availBytes: 842 * MiB, lowMemThresholdBytes: 216 * MiB };
    expect(planContext(spec, canonicalSnapshot(TAB_RAM), { ceiling: 2048, safety: 1 })?.nCtx).toBe(2048);
    expect(planContext(spec, { ...live, releasableBytes: 470 * MiB }, { ceiling: 2048, safety: 1 })?.nCtx).toBe(2048);
    expect(planContext(spec, live, { ceiling: 2048, safety: 1 })?.nCtx).toBe(EMERGENCY_CONTEXT);
  });

  for (const model of small) {
    it(`${model.id}: la batería de aceptación sale entera en su contexto canónico`, () => {
      const ceiling = contextCeilingForDevice(model.defaultNCtx, TAB_RAM);
      const { nCtx: _p, ...specBase } = contextSpecForModel(model, TAB_RAM);
      const plan = planContext(specBase, canonicalSnapshot(TAB_RAM), { ceiling, safety: 1 });
      expect(plan).not.toBeNull();
      const nCtx = plan!.nCtx;
      // Una respuesta normal (5 pasos de una línea, un cuento muy
      // corto, un correo breve) necesita unas centenas de tokens; el
      // suelo de 400 deja margen de sobra sobre su forma real, y la
      // explicación desarrollada (tono Detallado) pide 800.
      expect(chatGenTokens(TIRE, "succinct", nCtx), "llanta concisa").toBeGreaterThanOrEqual(400);
      expect(chatGenTokens(STORY, "succinct", nCtx), "cuento conciso").toBeGreaterThanOrEqual(400);
      expect(chatGenTokens(EMAIL, "succinct", nCtx), "correo conciso").toBeGreaterThanOrEqual(400);
      expect(chatGenTokens(TIRE, "detailed", nCtx), "llanta detallada").toBeGreaterThanOrEqual(800);
    });

    it(`${model.id}: en el peldaño de emergencia la batería concisa sigue entera`, () => {
      expect(chatGenTokens(TIRE, "succinct", EMERGENCY_CONTEXT), "llanta").toBeGreaterThanOrEqual(400);
      expect(chatGenTokens(STORY, "succinct", EMERGENCY_CONTEXT), "cuento").toBeGreaterThanOrEqual(400);
      expect(chatGenTokens(EMAIL, "succinct", EMERGENCY_CONTEXT), "correo").toBeGreaterThanOrEqual(400);
    });
  }
});

describe("familia 5 (iii): el sistema servido no se degrada", () => {
  it("el mensaje de sistema en 1024 es byte a byte el de una ventana ancha", () => {
    const narrow = assembleChatMessages(
      STORY, [], succinct.systemPrompt, undefined, succinct.styleReminder, false,
      storyBudget(EMERGENCY_CONTEXT)
    );
    const wide = assembleChatMessages(
      STORY, [], succinct.systemPrompt, undefined, succinct.styleReminder, false,
      storyBudget(8192)
    );
    expect(narrow[0].content).toBe(wide[0].content);
    expect(narrow[0].content).toContain("You are Nido");
  });
});
