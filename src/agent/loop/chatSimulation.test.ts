/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * chatSimulation.test.ts — NIDO: simulación del chat REAL, de extremo a
 * extremo (el patrón de la guía: mandar el mensaje como lo manda el
 * usuario y ver qué responde la app).
 *
 * Reproduce la composición de ChatScreen.send que decide el destino de
 * un mensaje: la puerta (classifyIntent ∈ {recordar, actuar}) y, solo
 * si la puerta abre, runAgentLoop con la memoria que se va guardando
 * entre turnos. Si la puerta no abre, el turno cae al conocimiento.
 *
 * Nació del fallo físico de la v0.1.21 (Tab A9+, chat nuevo): «Mi mama
 * se llama Marta» caía al conocimiento y citaba «Lista (Madrid Metro)»
 * con cada pieza verde por separado — el extractor sabía extraer, el
 * loop sabía guardar, pero la puerta nunca dejaba pasar la frase y
 * ningún test probaba el mensaje completo, de la puerta a la respuesta.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { classifyIntent } from "./intent";
import { isGenericMemoryQuestionShape, memoryGateHit } from "./memoryQuery";
import { runAgentLoop, type AgentEngine } from "./agentLoop";

const store = vi.hoisted(() => ({
  people: [] as Array<{ name: string; relationship?: string; notes?: string }>,
  facts: [] as Array<{ content: string; category: string }>,
  reminders: [] as Array<{ text: string; dueAt?: string }>,
}));

vi.mock("../memory/memoryStore", () => ({
  savePerson: vi.fn(async (p: { name: string; relationship?: string; notes?: string }) => {
    store.people.push(p);
    return p;
  }),
  saveFact: vi.fn(async (f: { content: string; category: string }) => {
    store.facts.push(f);
    return f;
  }),
  saveReminder: vi.fn(async (r: { text: string; dueAt?: string }) => {
    store.reminders.push(r);
    return { id: `r${store.reminders.length}`, ...r };
  }),
}));

function fakeEngine(): AgentEngine & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    generate: vi.fn(async (args: unknown) => {
      calls.push([args]);
      return "RESPUESTA DEL MODELO";
    }),
  };
}

type Lang = "es" | "en" | "pt";

/** Snapshot del store mock, con la forma de loadMemorySnapshot. */
function snapshotFromStore() {
  return {
    facts: store.facts.map((f) => ({ ...f })),
    preferences: [] as Array<{ key: string; value: string }>,
    people: store.people.map((p) => ({ ...p })),
    recentLog: [] as Array<{ day: string; entry: string }>,
  };
}

/** Espía de la sonda 0.1.23: cuántas veces consultó la snapshot. */
const probe = { loads: 0 };

type SendOptions = { deepResearch?: boolean };

/** Un turno del chat, tal como lo compone ChatScreen. */
async function send(text: string, lang: Lang, engine: AgentEngine, opts: SendOptions = {}) {
  let intent = classifyIntent(text);
  // 0.1.23: sonda con hit de memoria — misma composición que ChatScreen.
  // Si la puerta dice conversar y la forma es pregunta genérica en
  // primera persona, se consulta lo guardado; solo un hit fuerte
  // (memoryGateHit) reclasifica a recordar y la snapshot de la sonda se
  // reutiliza como loadMemory del loop. En Deep Research la sonda se
  // salta. Sin hit, el turno sigue exactamente el camino de siempre.
  let probedSnapshot: ReturnType<typeof snapshotFromStore> | null = null;
  if (intent === "conversar" && !opts.deepResearch && isGenericMemoryQuestionShape(text)) {
    probe.loads += 1;
    const snap = snapshotFromStore();
    if (memoryGateHit(text, snap)) {
      intent = "recordar";
      probedSnapshot = snap;
    }
  }
  if (intent !== "recordar" && intent !== "actuar") {
    return { route: "knowledge" as const, response: null, toolUses: [] as Array<{ name: string }> };
  }
  const result = await runAgentLoop(text, {
    engine,
    handlers: {},
    lang,
    loadMemory: async () => probedSnapshot ?? snapshotFromStore(),
  });
  return { route: "agent" as const, response: result.response, toolUses: result.toolUses };
}

beforeEach(() => {
  store.people.length = 0;
  store.facts.length = 0;
  store.reminders.length = 0;
  probe.loads = 0;
});

describe("simulación del chat — la conversación física de la Tab A9+ (0.1.21)", () => {
  it("ES: «Mi mama se llama Marta» se guarda y «¿Cómo se llama mi mamá?» responde Marta", async () => {
    const engine = fakeEngine();
    const t1 = await send("Mi mama se llama Marta", "es", engine);
    expect(t1.route).toBe("agent");
    expect(store.people).toEqual([{ name: "Marta", relationship: "mamá" }]);

    const t2 = await send("¿Cómo se llama mi mamá?", "es", engine);
    expect(t2.route).toBe("agent");
    expect(t2.response).toBe("Tu mamá se llama Marta.");
    // Todo determinista: el modelo nunca se invocó.
    expect(engine.calls).toHaveLength(0);
  });

  it("ES: «Mi mamá se llama Marta» (con acento) hace el mismo recorrido", async () => {
    const engine = fakeEngine();
    const t1 = await send("Mi mamá se llama Marta", "es", engine);
    expect(t1.route).toBe("agent");
    expect(store.people).toEqual([{ name: "Marta", relationship: "mamá" }]);
    expect(engine.calls).toHaveLength(0);
  });

  it("ES: «Yo me llamo Ruben» se guarda y «¿Cómo me llamo?» responde Ruben", async () => {
    const engine = fakeEngine();
    const t1 = await send("Yo me llamo Ruben", "es", engine);
    expect(t1.route).toBe("agent");
    expect(store.facts).toEqual([{ content: "Me llamo Ruben", category: "general", source: "user" }]);

    const t2 = await send("¿Cómo me llamo?", "es", engine);
    expect(t2.response).toBe("Te llamas Ruben.");
    expect(engine.calls).toHaveLength(0);
  });

  it("ES: «Mi cumpleaños es el 5 de mayo» guarda el hecho y crea el recordatorio", async () => {
    const engine = fakeEngine();
    const t1 = await send("Mi cumpleaños es el 5 de mayo", "es", engine);
    expect(t1.route).toBe("agent");
    expect(store.facts).toHaveLength(1);
    expect(store.facts[0].content).toContain("cumpleaños");
    expect(store.reminders).toHaveLength(1);
    expect(engine.calls).toHaveLength(0);
  });

  it("ES: «guarda que mañana tengo dentista» guarda el hecho", async () => {
    const engine = fakeEngine();
    const t1 = await send("guarda que mañana tengo dentista", "es", engine);
    expect(t1.route).toBe("agent");
    expect(store.facts).toHaveLength(1);
    expect(store.facts[0].content).toContain("dentista");
  });

  it("ES: «Pon un temporizador de 2 minutos» crea el temporizador sin pasar por el modelo", async () => {
    const engine = fakeEngine();
    const before = Date.now();
    const t1 = await send("Pon un temporizador de 2 minutos", "es", engine);
    expect(t1.route).toBe("agent");
    expect(store.reminders).toHaveLength(1);
    expect(store.reminders[0].text).toBe("Temporizador");
    const due = new Date(store.reminders[0].dueAt!).getTime();
    expect(Math.abs(due - (before + 120_000))).toBeLessThan(10_000);
    expect(t1.toolUses[0].name).toBe("create_reminder");
    expect(engine.calls).toHaveLength(0);
  });

  it("EN: “My mom's name is Marta” saves her, “What's my mom's name?” answers Marta", async () => {
    const engine = fakeEngine();
    const t1 = await send("My mom's name is Marta", "en", engine);
    expect(t1.route).toBe("agent");
    expect(store.people).toEqual([{ name: "Marta", relationship: "mom" }]);

    const t2 = await send("What's my mom's name?", "en", engine);
    expect(t2.response).toBe("Your mom's name is Marta.");
    expect(engine.calls).toHaveLength(0);
  });

  it("PT: «Minha mãe se chama Marta» guarda, «Como se chama minha mãe?» responde", async () => {
    const engine = fakeEngine();
    const t1 = await send("Minha mãe se chama Marta", "pt", engine);
    expect(t1.route).toBe("agent");
    expect(store.people).toEqual([{ name: "Marta", relationship: "mãe" }]);

    const t2 = await send("Como se chama minha mãe?", "pt", engine);
    expect(t2.response).toBe("Sua mãe se chama Marta.");
    expect(engine.calls).toHaveLength(0);
  });

  it("sin ancla personal, el mensaje sigue yendo al conocimiento", async () => {
    const engine = fakeEngine();
    const t1 = await send("¿Cómo se llama la capital de España?", "es", engine);
    expect(t1.route).toBe("knowledge");
    expect(store.people).toHaveLength(0);
    expect(store.facts).toHaveLength(0);
  });
});

describe("simulación del chat — consultas genéricas con hit de memoria (0.1.23)", () => {
  // La puerta pura sigue diciendo conversar para estas preguntas (pin en
  // intent.test.ts); lo que las rescata es la sonda de ChatScreen: forma
  // genérica + hit fuerte contra lo guardado. Guardar primero, preguntar
  // después, y la respuesta es la cita exacta del hecho guardado.
  const quote = (fact: string, lang: Lang) =>
    lang === "es"
      ? `Según lo que me contaste: «${fact}».`
      : lang === "en"
        ? `From what you told me: “${fact}”.`
        : `Pelo que você me contou: “${fact}”.`;

  it("ES: «Mi color favorito es el verde» → «¿cuál es mi color favorito?» cita el hecho", async () => {
    const engine = fakeEngine();
    const t1 = await send("Mi color favorito es el verde", "es", engine);
    expect(t1.route).toBe("agent");
    expect(store.facts).toHaveLength(1);

    const t2 = await send("¿cuál es mi color favorito?", "es", engine);
    expect(t2.route).toBe("agent");
    expect(t2.response).toBe(quote(store.facts[0].content, "es"));
    expect(engine.calls).toHaveLength(0);
  });

  it("ES: «Vivo en Tucson» → «¿dónde vivo?» cita el hecho (hit de 1 término único)", async () => {
    const engine = fakeEngine();
    const t1 = await send("Vivo en Tucson", "es", engine);
    expect(t1.route).toBe("agent");
    expect(store.facts).toHaveLength(1);

    const t2 = await send("¿dónde vivo?", "es", engine);
    expect(t2.route).toBe("agent");
    expect(t2.response).toBe(quote(store.facts[0].content, "es"));
    expect(engine.calls).toHaveLength(0);
  });

  it("ES: «Mi coche es un Toyota» → «¿qué coche tengo?» cita el hecho", async () => {
    const engine = fakeEngine();
    const t1 = await send("Mi coche es un Toyota", "es", engine);
    expect(t1.route).toBe("agent");
    expect(store.facts).toHaveLength(1);

    const t2 = await send("¿qué coche tengo?", "es", engine);
    expect(t2.route).toBe("agent");
    expect(t2.response).toBe(quote(store.facts[0].content, "es"));
    expect(engine.calls).toHaveLength(0);
  });

  it("EN: “My favorite color is green” → “What's my favorite color?” quotes the fact", async () => {
    const engine = fakeEngine();
    const t1 = await send("My favorite color is green", "en", engine);
    expect(t1.route).toBe("agent");
    expect(store.facts).toHaveLength(1);

    const t2 = await send("What's my favorite color?", "en", engine);
    expect(t2.route).toBe("agent");
    expect(t2.response).toBe(quote(store.facts[0].content, "en"));
    expect(engine.calls).toHaveLength(0);
  });

  it("EN: “I live in Tucson” → “Where do I live?” quotes the fact", async () => {
    const engine = fakeEngine();
    const t1 = await send("I live in Tucson", "en", engine);
    expect(t1.route).toBe("agent");
    expect(store.facts).toHaveLength(1);

    const t2 = await send("Where do I live?", "en", engine);
    expect(t2.route).toBe("agent");
    expect(t2.response).toBe(quote(store.facts[0].content, "en"));
    expect(engine.calls).toHaveLength(0);
  });

  it("PT: «Minha cor favorita é verde» → «Qual é a minha cor favorita?» cita o fato", async () => {
    const engine = fakeEngine();
    const t1 = await send("Minha cor favorita é verde", "pt", engine);
    expect(t1.route).toBe("agent");
    expect(store.facts).toHaveLength(1);

    const t2 = await send("Qual é a minha cor favorita?", "pt", engine);
    expect(t2.route).toBe("agent");
    expect(t2.response).toBe(quote(store.facts[0].content, "pt"));
    expect(engine.calls).toHaveLength(0);
  });

  it("PT: «Moro em Tucson» → «Onde eu moro?» cita o fato", async () => {
    const engine = fakeEngine();
    const t1 = await send("Moro em Tucson", "pt", engine);
    expect(t1.route).toBe("agent");
    expect(store.facts).toHaveLength(1);

    const t2 = await send("Onde eu moro?", "pt", engine);
    expect(t2.route).toBe("agent");
    expect(t2.response).toBe(quote(store.facts[0].content, "pt"));
    expect(engine.calls).toHaveLength(0);
  });

  // Negativos obligados: con memoria señuelo cargada, ni la familia de
  // documentos ni la charla entran al loop — la sonda consulta y no
  // encuentra hit fuerte, y el turno sigue al conocimiento como hoy.
  const seedDecoy = () => {
    store.facts.push({ content: "Mi color favorito es el verde", category: "preference" });
  };

  it.each([
    // Las tres frases de documentos de la guía (locales:1407).
    ["¿qué dice mi documento sobre la renovación?", "es"],
    ["what does my document say about the renewal?", "en"],
    ["o que meu documento diz sobre a renovação?", "pt"],
    // Charla en primera persona, tres idiomas.
    ["¿qué tengo que hacer para aprender inglés?", "es"],
    ["What do I have to do to learn English?", "en"],
    ["O que eu tenho que fazer para aprender inglês?", "pt"],
  ] as Array<[string, Lang]>)("negativo con memoria señuelo: %s → conocimiento", async (text, lang) => {
    seedDecoy();
    const engine = fakeEngine();
    const t = await send(text, lang, engine);
    expect(t.route).toBe("knowledge");
    expect(t.response).toBeNull();
    expect(engine.calls).toHaveLength(0);
  });

  it("pregunta genérica con memoria vacía: la sonda consulta, no hay hit, sigue al conocimiento", async () => {
    const engine = fakeEngine();
    const t = await send("¿cuál es mi color favorito?", "es", engine);
    expect(t.route).toBe("knowledge");
    expect(probe.loads).toBe(1);
  });

  it("pregunta sin primera persona: la forma no caza y la sonda ni se ejecuta", async () => {
    seedDecoy();
    const engine = fakeEngine();
    const t = await send("¿Cuál es la capital de Francia?", "es", engine);
    expect(t.route).toBe("knowledge");
    expect(probe.loads).toBe(0);
  });

  it("en Deep Research la sonda se salta: ni con el hecho guardado ataja la respuesta", async () => {
    const engine = fakeEngine();
    const t1 = await send("Mi color favorito es el verde", "es", engine);
    expect(t1.route).toBe("agent");
    expect(store.facts).toHaveLength(1);

    const loadsBefore = probe.loads;
    const t2 = await send("¿cuál es mi color favorito?", "es", engine, { deepResearch: true });
    expect(t2.route).toBe("knowledge");
    expect(probe.loads).toBe(loadsBefore);
  });
});
