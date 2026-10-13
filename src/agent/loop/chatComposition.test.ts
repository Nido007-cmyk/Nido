/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * chatComposition.test.ts — 0.1.24 (auditoría de alcanzabilidad, H-10):
 * las sondas de la auditoría convertidas en tests PERMANENTES.
 *
 * La auditoría mapeó 28 respondedores y encontró 21 con solo tests de
 * pieza: cada regex y cada handler verdes por separado, pero nadie
 * probaba el mensaje completo a través de la composición real de
 * ChatScreen — que es donde vivían todos los fallos (la puerta de la
 * 0.1.21, la frase de privacidad huérfana, el borrado EN desviado…).
 * Las 118 sondas vivían en /tmp: este archivo es su casa definitiva.
 *
 * Composición reproducida (send de ChatScreen, en orden):
 *   1. self-knowledge (answerKnowledgeQueryWithCategory)
 *   2. smalltalk (matchSmallTalk) si la KB no cazó
 *   3. puerta classifyIntent + sonda de memoria 0.1.23
 *   4. runAgentLoop con handlers grabadores, proveedores de notas y
 *      recordatorios en memoria, agenda de contactos doble y
 *      confirmación grabada (el usuario confirma: onConfirm → true)
 * Si nada abre, el turno va a «conocimiento» (aquí: ruta marcada, sin
 * motor — la ruta RAG/modelo no es el objeto de estos tests).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { classifyIntent } from "./intent";
import { isGenericMemoryQuestionShape, memoryGateHit } from "./memoryQuery";
import { runAgentLoop, type AgentEngine } from "./agentLoop";
import { answerKnowledgeQueryWithCategory } from "../../rag/selfKnowledge";
import { matchSmallTalk } from "./smallTalk";

type Lang = "es" | "en" | "pt";

const data = vi.hoisted(() => ({
  people: [] as Array<{ name: string; relationship?: string; notes?: string }>,
  facts: [] as Array<{ content: string; category: string }>,
  reminders: [] as Array<{ id: string; text: string; dueAt?: string }>,
  notes: [] as Array<{ id: string; title: string; body: string }>,
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  confirms: [] as Array<{ tool: string }>,
}));

vi.mock("../memory/memoryStore", () => ({
  savePerson: vi.fn(async (p: { name: string; relationship?: string; notes?: string }) => {
    data.people.push(p);
    return p;
  }),
  saveFact: vi.fn(async (f: { content: string; category: string }) => {
    data.facts.push(f);
    return f;
  }),
  saveReminder: vi.fn(async (r: { text: string; dueAt?: string }) => {
    const saved = { id: `r${data.reminders.length + 1}`, ...r };
    data.reminders.push(saved);
    return saved;
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

const BOOK = [
  { name: "Ana", phones: ["+1 555 0100"] },
  { name: "Juan", phones: ["+1 555 0200"] },
];

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function makeHandlers() {
  const rec = (name: string, fn: (args: Record<string, unknown>) => Promise<string>) =>
    async (args: Record<string, unknown>) => {
      data.calls.push({ name, args });
      return fn(args);
    };
  return {
    device_time: rec("device_time", async () => "martes, 13 de octubre de 2026, 9:41"),
    calculate: rec("calculate", async () => "84"),
    convert_units: rec("convert_units", async (a) => `${a.value} ${a.from} = 154.32 ${a.to}`),
    save_note: rec("save_note", async (a) => {
      data.notes.push({ id: `n${data.notes.length + 1}`, title: String(a.title), body: String(a.body) });
      return `Nota guardada: «${a.title}»`;
    }),
    list_notes: rec("list_notes", async () =>
      data.notes.length ? data.notes.map((n) => `• ${n.title}`).join("\n") : "No hay notas guardadas.",
    ),
    read_note: rec("read_note", async (a) => data.notes.find((n) => n.id === a.id)?.body ?? "Nota no encontrada"),
    delete_note: rec("delete_note", async (a) => {
      const i = data.notes.findIndex((n) => n.id === a.id);
      if (i >= 0) data.notes.splice(i, 1);
      return "Nota borrada.";
    }),
    delete_reminder: rec("delete_reminder", async (a) => {
      const i = data.reminders.findIndex((r) => r.id === a.id);
      if (i >= 0) data.reminders.splice(i, 1);
      return "Recordatorio borrado.";
    }),
    create_reminder: rec("create_reminder", async (a) => {
      data.reminders.push({ id: `r${data.reminders.length + 1}`, text: String(a.text), dueAt: String(a.at) });
      return "Recordatorio creado.";
    }),
    create_calendar_event: rec("create_calendar_event", async (a) => `Evento creado: ${a.title}`),
    list_calendar_events: rec("list_calendar_events", async () => "• Dentista — viernes, 10:00"),
    place_call: rec("place_call", async (a) => `Abriendo el marcador con ${a.phone}…`),
    send_sms: rec("send_sms", async () => "Abriendo la app de mensajes…"),
    nido_send_message: rec("nido_send_message", async () => "Mensaje enviado."),
    nido_read_inbox: rec("nido_read_inbox", async () => "No tienes mensajes nuevos."),
    nido_my_code: rec("nido_my_code", async () => "Tu código de emparejamiento: NIDO-TEST"),
    nido_review_tasks: rec("nido_review_tasks", async () => "No hay tareas pendientes."),
  };
}

function snapshotFromStore() {
  return {
    facts: data.facts.map((f) => ({ ...f })),
    preferences: [] as Array<{ key: string; value: string }>,
    people: data.people.map((p) => ({ ...p })),
    recentLog: [] as Array<{ day: string; entry: string }>,
  };
}

type Route = "knowledge" | "smalltalk" | "agent";

/** Un turno del chat, tal como lo compone ChatScreen. */
async function send(text: string, lang: Lang, engine: AgentEngine, opts: { deepResearch?: boolean } = {}) {
  const kb = answerKnowledgeQueryWithCategory(text, lang);
  if (kb) return { route: "knowledge" as Route, response: kb.answer, toolUses: [] as Array<{ name: string }> };
  const st = matchSmallTalk(text, lang);
  if (st) return { route: "smalltalk" as Route, response: st.text, toolUses: [] as Array<{ name: string }> };

  let intent = classifyIntent(text);
  let probedSnapshot: ReturnType<typeof snapshotFromStore> | null = null;
  if (intent === "conversar" && !opts.deepResearch && isGenericMemoryQuestionShape(text)) {
    const snap = snapshotFromStore();
    if (memoryGateHit(text, snap)) {
      intent = "recordar";
      probedSnapshot = snap;
    }
  }
  if (intent !== "recordar" && intent !== "actuar") {
    return { route: "knowledge" as Route, response: null, toolUses: [] as Array<{ name: string }> };
  }
  const result = await runAgentLoop(text, {
    engine,
    handlers: makeHandlers(),
    lang,
    loadMemory: async () => probedSnapshot ?? snapshotFromStore(),
    listNoteTitles: async () => data.notes.map((n) => ({ id: n.id, title: n.title })),
    listNotesFull: async () => data.notes.map((n) => ({ ...n })),
    listReminders: async () => data.reminders.map((r) => ({ id: r.id, text: r.text, dueAt: r.dueAt ?? null })),
    contactSearch: async (q: string) => ({
      ok: true as const,
      matches: BOOK.filter((c) => fold(c.name).includes(fold(q))),
    }),
    onConfirmTool: async (_d, action) => {
      if (action) data.confirms.push({ tool: action.tool });
      return true;
    },
  });
  return { route: "agent" as Route, response: result.response, toolUses: result.toolUses };
}

const callsOf = (name: string) => data.calls.filter((c) => c.name === name);

beforeEach(() => {
  data.people.length = 0;
  data.facts.length = 0;
  data.reminders.length = 0;
  data.notes.length = 0;
  data.calls.length = 0;
  data.confirms.length = 0;
});

describe("composición — conocimiento y charla (las capas previas a la puerta)", () => {
  it("H-1: «¿Dónde guardas mis datos?» y sus formas EN/PT reciben la respuesta de privacidad", async () => {
    const engine = fakeEngine();
    const es = await send("¿Dónde guardas mis datos?", "es", engine);
    expect(es.route).toBe("knowledge");
    expect(es.response).toContain("este dispositivo");
    const en = await send("Where do you store my data?", "en", engine);
    expect(en.response).toContain("this device");
    const pt = await send("Onde você guarda meus dados?", "pt", engine);
    expect(pt.response).toContain("neste dispositivo");
    expect(engine.calls).toHaveLength(0);
  });

  it("capacidades e identidad por la KB, en los tres idiomas", async () => {
    const engine = fakeEngine();
    for (const [text, lang] of [
      ["¿qué puedes hacer?", "es"],
      ["what can you do", "en"],
      ["o que você pode fazer?", "pt"],
    ] as Array<[string, Lang]>) {
      const t = await send(text, lang, engine);
      expect(t.route).toBe("knowledge");
      expect(t.response).toBeTruthy();
    }
    expect(engine.calls).toHaveLength(0);
  });

  it("smalltalk no secuestra mensajes compuestos", async () => {
    const engine = fakeEngine();
    const hola = await send("hola", "es", engine);
    expect(hola.route).toBe("smalltalk");
    const compuesto = await send("hola, recuérdame comprar pan mañana a las 9", "es", engine);
    expect(compuesto.route).toBe("agent");
    expect(data.reminders).toHaveLength(1);
    expect(engine.calls).toHaveLength(0);
  });

  it("negativo: una pregunta general no entra al loop ni escribe nada", async () => {
    const engine = fakeEngine();
    const t = await send("¿cuál es la capital de España?", "es", engine);
    expect(t.route).toBe("knowledge");
    expect(t.response).toBeNull();
    expect(data.facts).toHaveLength(0);
    expect(data.reminders).toHaveLength(0);
    expect(engine.calls).toHaveLength(0);
  });
});

describe("composición — recordatorios y temporizadores de la guía", () => {
  it.each([
    ["Recuérdame mañana a las 9 comprar pan", "es", "comprar pan"],
    ["Remind me tomorrow at 9 to buy bread", "en", "buy bread"],
    ["Lembra-me amanhã às 9 de comprar pão", "pt", "comprar pão"],
  ] as Array<[string, Lang, string]>)("recordatorio completo: %s", async (text, lang, expected) => {
    const engine = fakeEngine();
    const t = await send(text, lang, engine);
    expect(t.route).toBe("agent");
    expect(data.reminders).toHaveLength(1);
    expect(data.reminders[0].text).toContain(expected);
    expect(engine.calls).toHaveLength(0);
  });

  it.each([
    ["Pon un temporizador de 2 minutos", "es"],
    ["Set a timer for 5 minutes", "en"],
    ["Põe um temporizador de 3 minutos", "pt"],
  ] as Array<[string, Lang]>)("temporizador: %s", async (text, lang) => {
    const engine = fakeEngine();
    const before = Date.now();
    const t = await send(text, lang, engine);
    expect(t.route).toBe("agent");
    expect(data.reminders).toHaveLength(1);
    const due = new Date(data.reminders[0].dueAt!).getTime();
    expect(due).toBeGreaterThan(before);
    expect(due).toBeLessThan(before + 6 * 60 * 1000);
    expect(engine.calls).toHaveLength(0);
  });

  it("«¿qué recordatorios tengo?» lista el que hay (proveedor real)", async () => {
    data.reminders.push({ id: "r1", text: "comprar pan", dueAt: new Date(Date.now() + 3600e3).toISOString() });
    const engine = fakeEngine();
    const t = await send("¿qué recordatorios tengo?", "es", engine);
    expect(t.route).toBe("agent");
    expect(t.response).toContain("comprar pan");
    expect(engine.calls).toHaveLength(0);
  });
});

describe("composición — notas: guardar, listar, leer, buscar, borrar", () => {
  it("guardar una nota y leerla por título, sin el modelo", async () => {
    const engine = fakeEngine();
    const t1 = await send("guarda una nota: comprar filtros para el acuario", "es", engine);
    expect(t1.route).toBe("agent");
    expect(callsOf("save_note")).toHaveLength(1);
    expect(data.notes).toHaveLength(1);

    const t2 = await send("lee la nota de filtros", "es", engine);
    expect(t2.route).toBe("agent");
    expect(t2.response).toContain("comprar filtros");
    expect(callsOf("read_note")).toHaveLength(1);
    expect(engine.calls).toHaveLength(0);
  });

  it("«¿qué notas tengo?» y «busca en mis notas» (ES/PT)", async () => {
    data.notes.push({ id: "n1", title: "cumpleaños de Ana", body: "ideas: flores y pastel" });
    const engine = fakeEngine();
    const list = await send("¿qué notas tengo?", "es", engine);
    expect(list.response).toContain("cumpleaños de Ana");
    const search = await send("busca en mis notas algo sobre flores", "es", engine);
    expect(search.response).toContain("cumpleaños de Ana");
    const searchPt = await send("procura flores nas minhas notas", "pt", engine);
    expect(searchPt.response).toContain("cumpleaños de Ana");
    expect(engine.calls).toHaveLength(0);
  });

  it("H-2: «delete the birthday note» borra con confirmación; ES/PT de control", async () => {
    data.notes.push({ id: "n1", title: "birthday", body: "party ideas" });
    const engine = fakeEngine();
    const t = await send("delete the birthday note", "en", engine);
    expect(t.route).toBe("agent");
    expect(callsOf("delete_note")).toHaveLength(1);
    expect(data.confirms.map((c) => c.tool)).toContain("delete_note");
    expect(data.notes).toHaveLength(0);
    expect(t.response).toContain("birthday");
    expect(engine.calls).toHaveLength(0);
  });

  it("borrar todas las notas y un recordatorio por texto", async () => {
    data.notes.push(
      { id: "n1", title: "impuestos", body: "papeles" },
      { id: "n2", title: "viaje", body: "vuelos" },
    );
    data.reminders.push({ id: "r1", text: "comprar pan" });
    const engine = fakeEngine();
    const t1 = await send("borra todas mis notas", "es", engine);
    expect(t1.route).toBe("agent");
    expect(callsOf("delete_note")).toHaveLength(2);
    expect(data.notes).toHaveLength(0);

    const t2 = await send("borra el recordatorio de comprar pan", "es", engine);
    expect(t2.route).toBe("agent");
    expect(callsOf("delete_reminder")).toHaveLength(1);
    expect(data.reminders).toHaveLength(0);
    expect(engine.calls).toHaveLength(0);
  });
});

describe("composición — calendario", () => {
  it("H-3: «schedule dentist on Friday at 10» crea el evento «dentist»", async () => {
    const engine = fakeEngine();
    const t = await send("schedule dentist on Friday at 10", "en", engine);
    expect(t.route).toBe("agent");
    const created = callsOf("create_calendar_event");
    expect(created).toHaveLength(1);
    expect(created[0].args.title).toBe("dentist");
    expect(engine.calls).toHaveLength(0);
  });

  it("crear en ES/PT y consultar la agenda", async () => {
    const engine = fakeEngine();
    const es = await send("agenda dentista el viernes a las 10", "es", engine);
    expect(callsOf("create_calendar_event")[0].args.title).toBe("dentista");
    expect(es.response).toContain("dentista");
    const pt = await send("agende dentista amanhã às 10", "pt", engine);
    expect(pt.route).toBe("agent");
    expect(callsOf("create_calendar_event")).toHaveLength(2);

    const list = await send("¿qué tengo mañana?", "es", engine);
    expect(list.response).toContain("Dentista");
    expect(callsOf("list_calendar_events").length).toBeGreaterThan(0);
    expect(engine.calls).toHaveLength(0);
  });
});

describe("composición — contactos, SMS y mensajería NIDO", () => {
  it("buscar contacto, llamar y SMS con la agenda doble", async () => {
    const engine = fakeEngine();
    const find = await send("busca el contacto Ana", "es", engine);
    expect(find.route).toBe("agent");
    expect(find.response).toContain("+1 555 0100");
    expect(callsOf("place_call")).toHaveLength(0);

    const call = await send("llama a Ana", "es", engine);
    expect(call.route).toBe("agent");
    expect(callsOf("place_call")).toEqual([{ name: "place_call", args: { phone: "+1 555 0100" } }]);

    const sms = await send("manda un SMS a Ana que ya voy", "es", engine);
    expect(sms.route).toBe("agent");
    expect(callsOf("send_sms")).toHaveLength(1);
    expect(callsOf("send_sms")[0].args).toMatchObject({ phone: "+1 555 0100", message: "ya voy" });
    expect(engine.calls).toHaveLength(0);
  });

  it("H-5: «manda un mensaje a Juan por nido: ya llegué» despacha a «Juan» limpio", async () => {
    const engine = fakeEngine();
    const t = await send("Manda un mensaje a Juan por nido: ya llegué", "es", engine);
    expect(t.route).toBe("agent");
    const sent = callsOf("nido_send_message");
    expect(sent).toHaveLength(1);
    expect(sent[0].args).toMatchObject({ to: "Juan", text: "ya llegué" });
    expect(engine.calls).toHaveLength(0);
  });

  it("bandeja NIDO y código de emparejamiento", async () => {
    const engine = fakeEngine();
    const inbox = await send("lee mis mensajes", "es", engine);
    expect(inbox.route).toBe("agent");
    expect(inbox.toolUses.map((u) => u.name)).toContain("nido_read_inbox");
    const code = await send("muéstrame mi código de emparejamiento", "es", engine);
    expect(code.toolUses.map((u) => u.name)).toContain("nido_my_code");
    expect(code.response).toContain("NIDO-TEST");
    expect(engine.calls).toHaveLength(0);
  });
});

describe("composición — cálculo, conversiones, hora y plan semanal", () => {
  it.each([
    ["¿cuánto es 12 por 7?", "es", "84"],
    ["what is 12 times 7", "en", "84"],
    ["quanto é 12 vezes 7", "pt", "84"],
  ] as Array<[string, Lang, string]>)("cálculo determinista: %s", async (text, lang, expected) => {
    const engine = fakeEngine();
    const t = await send(text, lang, engine);
    expect(t.route).toBe("agent");
    expect(t.response).toContain(expected);
    expect(engine.calls).toHaveLength(0);
  });

  it("conversión de unidades por la herramienta", async () => {
    const engine = fakeEngine();
    const t = await send("¿cuánto es 70 kg en libras?", "es", engine);
    expect(t.route).toBe("agent");
    expect(t.toolUses.map((u) => u.name)).toContain("convert_units");
    expect(t.response).toContain("154");
    expect(engine.calls).toHaveLength(0);
  });

  it.each([
    ["¿qué hora es?", "es"],
    ["what time is it", "en"],
    ["que horas são", "pt"],
  ] as Array<[string, Lang]>)("hora del dispositivo: %s", async (text, lang) => {
    const engine = fakeEngine();
    const t = await send(text, lang, engine);
    expect(t.route).toBe("agent");
    expect(t.toolUses.map((u) => u.name)).toContain("device_time");
    expect(engine.calls).toHaveLength(0);
  });

  it("plan semanal en los tres idiomas (H-6 en composición)", async () => {
    const engine = fakeEngine();
    const es = await send("planifica mi semana", "es", engine);
    expect(es.response).toContain("Horario semanal");
    const en = await send("plan my week", "en", engine);
    expect(en.response).toContain("Weekly Schedule");
    const pt = await send("planeja minha semana", "pt", engine);
    expect(pt.response).toContain("Horário semanal");
    expect(engine.calls).toHaveLength(0);
  });
});

describe("composición — personas y decisiones de diseño fijadas", () => {
  it("«Mi hermano se llama Pedro» se guarda y se responde por parentesco", async () => {
    const engine = fakeEngine();
    const t1 = await send("Mi hermano se llama Pedro", "es", engine);
    expect(t1.route).toBe("agent");
    expect(data.people).toEqual([{ name: "Pedro", relationship: "hermano" }]);
    const t2 = await send("¿cómo se llama mi hermano?", "es", engine);
    expect(t2.response).toBe("Tu hermano se llama Pedro.");
    expect(engine.calls).toHaveLength(0);
  });

  it("un respondedor por turno: el mensaje compuesto solo ejecuta la primera acción", async () => {
    // Diseño vigente (un fast-path por turno): «…y guarda una nota»
    // no se pierde en silencio — el recordatorio se crea y el turno
    // termina; la nota no aparece. Fijado aquí para que un cambio
    // futuro sea una decisión, no un accidente.
    const engine = fakeEngine();
    const t = await send("Recuérdame mañana a las 9 comprar pan y guarda una nota: llamar al banco", "es", engine);
    expect(t.route).toBe("agent");
    expect(data.reminders).toHaveLength(1);
    expect(data.notes).toHaveLength(0);
    expect(engine.calls).toHaveLength(0);
  });

  it("H-19 (diseño documentado): en Deep Research una consulta «recordar» directa SÍ entra al loop", async () => {
    // La sonda 0.1.23 se salta en Deep Research, pero una frase que
    // la puerta ya clasifica «recordar» no depende de la sonda: la
    // asimetría es el comportamiento vigente y queda fijada.
    const engine = fakeEngine();
    await send("Mi mama se llama Marta", "es", engine);
    const t = await send("¿Cómo se llama mi mamá?", "es", engine, { deepResearch: true });
    expect(t.route).toBe("agent");
    expect(t.response).toBe("Tu mamá se llama Marta.");
    expect(engine.calls).toHaveLength(0);
  });
});
