/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import {
  calendarRange,
  extractToolAction,
  formatDay,
  formatTime,
  noteTitleFrom,
  runToolAction,
  toolForAction,
  type ToolAction,
  type ToolRouterDeps,
} from "./toolRouter";
import { extractReminderAction } from "./actionRouter";

const NOW = new Date(2026, 9, 11, 10, 30); // domingo 11 oct 2026, 10:30 local

describe("extractToolAction — hora y fecha", () => {
  it.each([
    ["¿Qué hora es?", "time", "es"],
    ["qué día es hoy", "date", "es"],
    ["What time is it?", "time", "en"],
    ["what's today's date", "date", "en"],
    ["Que horas são?", "time", "pt"],
    ["que dia é hoje", "date", "pt"],
  ])("%p", (text, what, lang) => {
    expect(extractToolAction(text as string, NOW)).toEqual({ kind: "time", what, lang });
  });
});

describe("extractToolAction — notas", () => {
  it("guardar (es/en/pt) con título corto", () => {
    expect(extractToolAction("anota que mañana hay junta con el equipo de ventas a las 9", NOW)).toEqual({
      kind: "noteSave",
      title: "mañana hay junta con el equipo",
      body: "mañana hay junta con el equipo de ventas a las 9",
      lang: "es",
    });
    expect(extractToolAction("take a note: buy milk and eggs", NOW)).toMatchObject({ kind: "noteSave", body: "buy milk and eggs", lang: "en" });
    expect(extractToolAction("anote que o carro precisa de óleo", NOW)).toMatchObject({ kind: "noteSave", lang: "pt" });
  });

  it('evidencia: "crea una nota…" era un RECORDATORIO; ahora es una nota', () => {
    // La regex de recordatorios acepta "crea …" sin exigir "recordatorio".
    expect(extractReminderAction("crea una nota que diga comprar pan")).not.toBeNull();
    expect(extractToolAction("crea una nota que diga comprar pan", NOW)).toMatchObject({ kind: "noteSave", body: "comprar pan" });
  });

  it("listar (es/en/pt)", () => {
    for (const [text, lang] of [
      ["mis notas", "es"],
      ["muéstrame mis notas", "es"],
      ["¿qué notas tengo?", "es"],
      ["show me my notes", "en"],
      ["minhas notas", "pt"],
    ]) {
      expect(extractToolAction(text, NOW)).toEqual({ kind: "noteList", lang });
    }
  });

  it("leer por título, no por id", () => {
    expect(extractToolAction("lee la nota de compras", NOW)).toEqual({ kind: "noteRead", query: "compras", lang: "es" });
    expect(extractToolAction("read the note about the trip", NOW)).toEqual({ kind: "noteRead", query: "the trip", lang: "en" });
    expect(extractToolAction("lê a nota do mercado", NOW)).toEqual({ kind: "noteRead", query: "mercado", lang: "pt" });
  });

  it("noteTitleFrom acorta y quita la puntuación final", () => {
    expect(noteTitleFrom("hola.")).toBe("hola");
    expect(noteTitleFrom("uno dos tres cuatro cinco seis siete ocho")).toBe("uno dos tres cuatro cinco seis");
  });
});

describe("extractToolAction — conversiones", () => {
  it.each([
    ["10 km a millas", 10, "km", "millas", "es"],
    ["convierte 3,5 kilos a libras", 3.5, "kilos", "libras", "es"],
    ["100 grados celsius a fahrenheit", 100, "celsius", "fahrenheit", "es"],
    ["convert 5 miles to km", 5, "miles", "km", "en"],
    ["10 quilômetros para milhas", 10, "quilômetros", "milhas", "pt"],
  ])("%p", (text, value, from, to, lang) => {
    expect(extractToolAction(text as string, NOW)).toEqual({ kind: "convert", value, from, to, lang });
  });

  it("unidades desconocidas o de distinta categoría → no se enruta", () => {
    expect(extractToolAction("10 km a libras", NOW)).toBeNull();
    expect(extractToolAction("5 manzanas a peras", NOW)).toBeNull();
  });
});

describe("extractToolAction — calendario", () => {
  it("consultar hoy / mañana / semana", () => {
    expect(extractToolAction("¿qué tengo mañana?", NOW)).toMatchObject({ kind: "calendarList", label: "tomorrow", lang: "es" });
    expect(extractToolAction("mi agenda de hoy", NOW)).toMatchObject({ kind: "calendarList", label: "today" });
    expect(extractToolAction("what do I have this week", NOW)).toMatchObject({ kind: "calendarList", label: "week", lang: "en" });
    expect(extractToolAction("o que tenho amanhã", NOW)).toMatchObject({ kind: "calendarList", label: "tomorrow", lang: "pt" });
    expect(extractToolAction("mi agenda", NOW)).toMatchObject({ kind: "calendarList", label: "week" });
  });

  it("rango: mañana = de 00:00 a 00:00 del día siguiente", () => {
    const r = calendarRange("tomorrow", NOW);
    expect(new Date(r.from).getDate()).toBe(12);
    expect(new Date(r.from).getHours()).toBe(0);
    expect(new Date(r.to).getDate()).toBe(13);
    expect(new Date(calendarRange("today", NOW).from).getTime()).toBe(NOW.getTime());
  });

  it('crear: "agenda dentista el viernes a las 10" → evento (antes caía en recordatorio)', () => {
    const a = extractToolAction("agenda dentista el viernes a las 10", NOW) as Extract<ToolAction, { kind: "calendarCreate" }>;
    expect(a.kind).toBe("calendarCreate");
    expect(a.title).toBe("dentista");
    const d = new Date(a.start!);
    expect(d.getDay()).toBe(5);
    expect(d.getHours()).toBe(10);
  });

  it("crear con 'una cita con …' y en inglés/portugués", () => {
    expect(extractToolAction("añade una cita con el doctor mañana a las 9", NOW)).toMatchObject({
      kind: "calendarCreate",
      title: "el doctor",
    });
    expect(extractToolAction("schedule team meeting tomorrow at 3pm", NOW)).toMatchObject({
      kind: "calendarCreate",
      title: "team meeting",
      lang: "en",
    });
    const pt = extractToolAction("agende dentista amanhã às 10", NOW) as Extract<ToolAction, { kind: "calendarCreate" }>;
    expect(pt).toMatchObject({ kind: "calendarCreate", title: "dentista", lang: "pt" });
    expect(new Date(pt.start!).getDate()).toBe(12);
    expect(new Date(pt.start!).getHours()).toBe(10);
  });

  it("sin fecha → se pide la fecha (start null), no se inventa", () => {
    expect(extractToolAction("agenda la revisión del coche", NOW)).toMatchObject({ kind: "calendarCreate", start: null });
  });

  it('"agenda de hoy" es consulta, no un evento llamado "de"', () => {
    expect(extractToolAction("mi agenda de hoy", NOW)?.kind).toBe("calendarList");
    expect(extractToolAction("agenda de hoy", NOW)).toBeNull();
  });
});

describe("extractToolAction — mensajería NIDO", () => {
  it("enviar (es/en/pt)", () => {
    expect(extractToolAction("manda un mensaje por nido a Ana que ya voy", NOW)).toEqual({
      kind: "nidoSend",
      to: "Ana",
      text: "ya voy",
      lang: "es",
    });
    expect(extractToolAction("dile a Beto por nido que llego en 5", NOW)).toMatchObject({ kind: "nidoSend", to: "Beto", text: "llego en 5" });
    expect(extractToolAction("send a nido message to Ana saying hi", NOW)).toMatchObject({ kind: "nidoSend", to: "Ana", text: "hi", lang: "en" });
    expect(extractToolAction("manda uma mensagem pelo nido para a Ana dizendo oi", NOW)).toMatchObject({ kind: "nidoSend", to: "Ana", text: "oi", lang: "pt" });
    expect(extractToolAction("mándale un mensaje por nido a Ana", NOW)).toMatchObject({ kind: "nidoSend", to: "Ana", text: null });
  });

  it("bandeja, código y tareas", () => {
    expect(extractToolAction("lee mis mensajes", NOW)?.kind).toBe("nidoInbox");
    expect(extractToolAction("¿tengo mensajes nuevos?", NOW)?.kind).toBe("nidoInbox");
    expect(extractToolAction("check my inbox", NOW)?.kind).toBe("nidoInbox");
    expect(extractToolAction("muéstrame mi código de emparejamiento", NOW)?.kind).toBe("nidoCode");
    expect(extractToolAction("my pairing code", NOW)?.kind).toBe("nidoCode");
    expect(extractToolAction("meu código", NOW)?.kind).toBe("nidoCode");
    expect(extractToolAction("tareas pendientes", NOW)?.kind).toBe("nidoTasks");
  });
});

describe("extractToolAction — enlaces y archivos", () => {
  it("abrir enlace explícito", () => {
    expect(extractToolAction("abre https://example.com/a?b=1", NOW)).toEqual({ kind: "openLink", url: "https://example.com/a?b=1", lang: "es" });
    expect(extractToolAction("open www.wikipedia.org", NOW)).toEqual({ kind: "openLink", url: "https://www.wikipedia.org", lang: "en" });
  });
  it("leer / analizar archivo", () => {
    expect(extractToolAction("lee un archivo", NOW)).toEqual({ kind: "pickFile", analyze: false, lang: "es" });
    expect(extractToolAction("analiza un csv", NOW)).toEqual({ kind: "pickFile", analyze: true, lang: "es" });
    expect(extractToolAction("analyze a file", NOW)).toEqual({ kind: "pickFile", analyze: true, lang: "en" });
  });
});

describe("extractToolAction — adversarial: NO debe disparar", () => {
  it.each([
    "¿qué hora es en Tokio?",
    "explícame cómo funciona una agenda",
    "¿qué tengo que hacer para aprender inglés?",
    "las notas musicales son siete",
    "anota",
    "recuérdame comprar pan mañana",
    "¿cuántos km hay de aquí a Madrid?",
    "abre la app de cámara",
    "¿qué es un archivo csv?",
    "mándale un sms a Ana que llego tarde",
    "",
  ])("%p", (text) => {
    expect(extractToolAction(text, NOW)).toBeNull();
  });
});

describe("toolForAction — cada acción usa una herramienta del manifiesto", () => {
  it("mapa completo", async () => {
    const { LOCAL_TOOLS } = await import("../tools/manifest");
    const names = new Set(LOCAL_TOOLS.map((t) => t.name));
    const samples: ToolAction[] = [
      { kind: "time", what: "time", lang: "es" },
      { kind: "noteSave", title: "a", body: "a", lang: "es" },
      { kind: "noteList", lang: "es" },
      { kind: "noteRead", query: "a", lang: "es" },
      { kind: "convert", value: 1, from: "km", to: "m", lang: "es" },
      { kind: "calendarList", from: "", to: "", label: "today", lang: "es" },
      { kind: "calendarCreate", title: "a", start: null, lang: "es" },
      { kind: "nidoSend", to: "a", text: "b", lang: "es" },
      { kind: "nidoInbox", lang: "es" },
      { kind: "nidoCode", lang: "es" },
      { kind: "nidoTasks", lang: "es" },
      { kind: "openLink", url: "https://a.b", lang: "es" },
      { kind: "pickFile", analyze: false, lang: "es" },
    ];
    for (const a of samples) expect(names.has(toolForAction(a))).toBe(true);
  });
});

// ------------------------------------------------------------ ejecución

function harness(results: Record<string, { status: "executed" | "cancelled" | "disabled" | "failed" | "invalid" | "blocked"; text: string }> = {}, disabled: string[] = []) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const deps: ToolRouterDeps = {
    dispatch: async (name, args) => {
      calls.push({ name, args });
      return results[name] ?? { status: "executed", text: "ok" };
    },
    isDisabled: (t) => disabled.includes(t),
    listNotes: async () => [
      { id: "n1", title: "Lista de compras" },
      { id: "n2", title: "Viaje a Madrid" },
      { id: "n3", title: "Viaje a Lisboa" },
    ],
    now: () => NOW,
  };
  return { deps, calls };
}

describe("runToolAction", () => {
  it("hora determinista, sin Intl, en el idioma del usuario", async () => {
    const { deps, calls } = harness();
    expect((await runToolAction({ kind: "time", what: "time", lang: "es" }, deps)).response).toBe("Son las 10:30 (domingo, 11 de octubre).");
    expect((await runToolAction({ kind: "time", what: "date", lang: "en" }, deps)).response).toBe("Today is Sunday, October 11, 2026.");
    expect((await runToolAction({ kind: "time", what: "time", lang: "pt" }, deps)).response).toBe("São 10:30 (domingo, 11 de outubro).");
    expect(calls).toHaveLength(0);
  });

  it("guardar nota → save_note por la compuerta, confirmación localizada", async () => {
    const { deps, calls } = harness({ save_note: { status: "executed", text: "Nota guardada: «x» (id 9)." } });
    const out = await runToolAction({ kind: "noteSave", title: "comprar pan", body: "comprar pan", lang: "en" }, deps);
    expect(calls).toEqual([{ name: "save_note", args: { title: "comprar pan", body: "comprar pan" } }]);
    expect(out.response).toBe("Done, I saved the note “comprar pan”.");
  });

  it("leer nota por título: una coincidencia → read_note con su id", async () => {
    const { deps, calls } = harness({ read_note: { status: "executed", text: "«Lista de compras»: pan" } });
    const out = await runToolAction({ kind: "noteRead", query: "compras", lang: "es" }, deps);
    expect(calls).toEqual([{ name: "read_note", args: { id: "n1" } }]);
    expect(out.response).toBe("«Lista de compras»: pan");
  });

  it("leer nota ambigua → pregunta cuál, no abre ninguna", async () => {
    const { deps, calls } = harness();
    const out = await runToolAction({ kind: "noteRead", query: "viaje", lang: "es" }, deps);
    expect(calls).toHaveLength(0);
    expect(out.response).toContain("Viaje a Madrid");
    expect(out.response).toContain("Viaje a Lisboa");
  });

  it("leer nota inexistente → mensaje honesto", async () => {
    const { deps } = harness();
    expect((await runToolAction({ kind: "noteRead", query: "recetas", lang: "pt" }, deps)).response).toBe(
      "Não encontrei nenhuma nota chamada “recetas”.",
    );
  });

  it("listar notas sin abrir el contenido", async () => {
    const { deps, calls } = harness();
    const out = await runToolAction({ kind: "noteList", lang: "es" }, deps);
    expect(calls).toHaveLength(0);
    expect(out.response).toContain("• Lista de compras");
  });

  it("calendario: traduce la salida del handler al idioma del usuario", async () => {
    const { deps } = harness({ list_calendar_events: { status: "executed", text: "No hay eventos en ese rango." } });
    const out = await runToolAction({ kind: "calendarList", from: "a", to: "b", label: "tomorrow", lang: "en" }, deps);
    expect(out.response).toBe("You have no events tomorrow.");
  });

  it("crear evento sin fecha → pregunta cuándo, no crea nada", async () => {
    const { deps, calls } = harness();
    const out = await runToolAction({ kind: "calendarCreate", title: "dentista", start: null, lang: "es" }, deps);
    expect(calls).toHaveLength(0);
    expect(out.response).toContain("¿Para cuándo?");
  });

  it("crear evento: confirmación cancelada → no se finge", async () => {
    const { deps } = harness({ create_calendar_event: { status: "executed", text: "Entendido, no hice nada." } });
    const start = new Date(2026, 9, 16, 10, 0).toISOString();
    const out = await runToolAction({ kind: "calendarCreate", title: "dentista", start, lang: "es" }, deps);
    expect(out.response).toBe("Entendido, no hice nada.");
  });

  it("crear evento ok → fecha legible sin Intl", async () => {
    const { deps } = harness({ create_calendar_event: { status: "executed", text: "Evento creado" } });
    const start = new Date(2026, 9, 16, 10, 0).toISOString();
    const out = await runToolAction({ kind: "calendarCreate", title: "dentista", start, lang: "es" }, deps);
    expect(out.response).toBe("Listo, agendé «dentista» para el viernes, 16 de octubre a las 10:00.");
  });

  it("mensaje NIDO sin texto → pregunta qué escribir", async () => {
    const { deps, calls } = harness();
    const out = await runToolAction({ kind: "nidoSend", to: "Ana", text: null, lang: "es" }, deps);
    expect(calls).toHaveLength(0);
    expect(out.response).toContain("¿Qué le escribo a Ana?");
  });

  it("herramienta apagada → mensaje claro, sin despachar", async () => {
    const { deps, calls } = harness({}, ["save_note"]);
    const out = await runToolAction({ kind: "noteSave", title: "a", body: "a", lang: "es" }, deps);
    expect(calls).toHaveLength(0);
    expect(out.response).toContain("«save_note» está desactivada");
  });

  it("archivo CSV + 'analiza' → read_picked_file y luego analyze_table", async () => {
    const { deps, calls } = harness({
      read_picked_file: { status: "executed", text: "Archivo «ventas.csv» (1 KB):\nproducto,importe\npan,10\nleche,20" },
      analyze_table: { status: "executed", text: "2 filas · importe: suma 30" },
    });
    const out = await runToolAction({ kind: "pickFile", analyze: true, lang: "es" }, deps);
    expect(calls.map((c) => c.name)).toEqual(["read_picked_file", "analyze_table"]);
    expect(calls[1].args).toEqual({ text: "producto,importe\npan,10\nleche,20" });
    expect(out.response).toContain("suma 30");
  });

  it("errores del handler no se presentan como éxito", async () => {
    const { deps } = harness({ save_note: { status: "executed", text: "Error: falta el título de la nota." } });
    const out = await runToolAction({ kind: "noteSave", title: "a", body: "a", lang: "es" }, deps);
    expect(out.response).toContain("No pude completar la acción");
  });

  it("una excepción nunca sale del router", async () => {
    const { deps } = harness();
    deps.dispatch = async () => {
      throw new Error("boom");
    };
    const out = await runToolAction({ kind: "nidoInbox", lang: "es" }, deps);
    expect(out.response).toContain("boom");
  });
});

describe("formateo de fechas sin Intl", () => {
  it("es / en / pt", () => {
    const d = new Date(2026, 2, 15, 21, 5);
    expect(formatDay(d, "es")).toBe("domingo, 15 de marzo");
    expect(formatDay(d, "en")).toBe("Sunday, March 15");
    expect(formatDay(d, "pt")).toBe("domingo, 15 de março");
    expect(formatTime(d, "es")).toBe("21:05");
    expect(formatTime(d, "en")).toBe("9:05 PM");
  });
});
