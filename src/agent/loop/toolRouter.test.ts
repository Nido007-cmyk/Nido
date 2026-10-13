/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import {
  localizeHandlerText,
  calendarRange,
  extractToolAction,
  formatDay,
  formatTime,
  noteTitleFrom,
  reminderWhen,
  routerMessage,
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

  // 0.1.19: la forma de pregunta ("cuántos pies son 2 metros") caía al modelo.
  it.each([
    ["cuántos pies son 2 metros", 2, "metros", "pies", "es"],
    ["cuántos pies hay en 2 metros", 2, "metros", "pies", "es"],
    ["cuánto es 70 kg en libras", 70, "kg", "libras", "es"],
    ["cuánto es 70 kilos en libras", 70, "kilos", "libras", "es"],
    ["cuántos gramos hay en 2 kilos", 2, "kilos", "gramos", "es"],
    ["how many feet are in 2 meters", 2, "meters", "feet", "en"],
    ["how many feet is 2 meters", 2, "meters", "feet", "en"],
    ["quantos pés são 2 metros", 2, "metros", "pés", "pt"],
  ])("pregunta: %p", (text, value, from, to, lang) => {
    expect(extractToolAction(text as string, NOW)).toEqual({ kind: "convert", value, from, to, lang });
  });

  it("la moneda va a la respuesta honesta offline (0.1.20, P3-15)", () => {
    // Antes no se enrutaba y el MODELO inventaba un tipo de cambio.
    // Ahora la ruta determinista responde que sin conexión no hay tasas.
    expect(extractToolAction("cuántos dólares son 100 pesos", NOW)).toMatchObject({ kind: "currencyInfo" });
    expect(extractToolAction("cuánto es 100 pesos en dólares", NOW)).toMatchObject({ kind: "currencyInfo" });
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

describe("localizeHandlerText — salidas en español traducidas para en/pt", () => {
  it("bandeja, código, envío y archivos", () => {
    expect(localizeHandlerText("No tienes mensajes NIDO sin leer.", "en")).toBe("You have no unread NIDO messages.");
    expect(
      localizeHandlerText(
        "Tu código de emparejamiento NIDO (muéstralo como QR para que el otro teléfono lo escanee):\nNIDO1:abc\nHuella para verificar en persona: 1234",
        "pt",
      ),
    ).toBe("Seu código de pareamento NIDO (mostre como QR para o outro telefone escanear):\nNIDO1:abc\nImpressão digital para conferir pessoalmente: 1234");
    expect(localizeHandlerText("Mensaje enviado a «Ana» por NIDO (cifrado de extremo a extremo).", "en")).toBe(
      "Message sent to “Ana” via NIDO (end-to-end encrypted).",
    );
    expect(localizeHandlerText("Archivo «v.csv» (2 KB):\na,b", "en")).toBe("File “v.csv” (2 KB):\na,b");
  });
  it("en español no cambia nada y los datos del usuario se conservan", () => {
    const t = "• Ana (dom): Huella para verificar en persona: no";
    expect(localizeHandlerText(t, "es")).toBe(t);
    expect(localizeHandlerText("• Ana (dom): hola", "en")).toBe("• Ana (dom): hola");
  });
});

describe("0.1.14 — qué recordatorios tengo", () => {
  it.each([
    ["qué recordatorios tengo", "es"],
    ["¿Qué recordatorios tengo?", "es"],
    ["mis recordatorios", "es"],
    ["muéstrame mis recordatorios", "es"],
    ["cuáles son mis recordatorios", "es"],
    ["what reminders do I have", "en"],
    ["show me my reminders", "en"],
    ["my reminders", "en"],
    ["quais lembretes eu tenho", "pt"],
    ["meus lembretes", "pt"],
  ])("%p → reminderList (%s)", (text, lang) => {
    expect(extractToolAction(text as string, NOW)).toEqual({ kind: "reminderList", lang });
  });

  it("creating a reminder is NOT a listing", () => {
    expect(extractToolAction("recuérdame comprar leche en 2 horas", NOW)).toBeNull();
    expect(extractToolAction("crea un recordatorio para mañana", NOW)?.kind).not.toBe("reminderList");
  });

  it("lists pending reminders in the user's language, with dates or 'no date'", async () => {
    const due = new Date(2026, 9, 12, 17, 0).toISOString();
    const deps = {
      dispatch: async () => ({ status: "executed" as const, text: "" }),
      isDisabled: () => false,
      listReminders: async () => [
        { id: "rx1", text: "llamar a mamá", dueAt: due },
        { id: "rx2", text: "comprar pan", dueAt: null },
      ],
    };
    const es = await runToolAction({ kind: "reminderList", lang: "es" }, deps);
    expect(es.response).toContain("Tus recordatorios pendientes:");
    expect(es.response).toContain("• llamar a mamá (el lunes, 12 de octubre a las 17:00)");
    expect(es.response).toContain("• comprar pan (sin fecha)");
    const en = await runToolAction({ kind: "reminderList", lang: "en" }, deps);
    expect(en.response).toContain("Your pending reminders:");
    expect(en.response).toContain("on Monday, October 12 at 5:00 PM");
    const none = await runToolAction({ kind: "reminderList", lang: "pt" }, { ...deps, listReminders: async () => [] });
    expect(none.response).toBe("Você não tem lembretes pendentes.");
  });

  it("respects the reminders switch", async () => {
    const out = await runToolAction(
      { kind: "reminderList", lang: "es" },
      { dispatch: async () => ({ status: "executed", text: "" }), isDisabled: (t) => t === "create_reminder", listReminders: async () => [] }
    );
    expect(out.response).toMatch(/desactivada/);
  });
});

describe("0.1.19 — recordatorios con alcance (hoy/mañana)", () => {
  it.each([
    ["qué recordatorios tengo hoy", "es", "today"],
    ["¿Qué recordatorios tengo hoy?", "es", "today"],
    ["qué recordatorios tengo mañana", "es", "tomorrow"],
    ["qué recordatorios tengo para hoy", "es", "today"],
    ["qué recordatorios tengo para mañana", "es", "tomorrow"],
    ["mis recordatorios de hoy", "es", "today"],
    ["mis recordatorios de mañana", "es", "tomorrow"],
    ["tengo algún recordatorio hoy", "es", "today"],
    ["tengo algún recordatorio", "es", undefined],
    ["lista de recordatorios", "es", undefined],
    ["what reminders do I have today", "en", "today"],
    ["what reminders do I have tomorrow", "en", "tomorrow"],
    ["do I have any reminders today", "en", "today"],
    ["quais lembretes tenho hoje", "pt", "today"],
    ["quais lembretes eu tenho amanhã", "pt", "tomorrow"],
    // Batería trilingüe 0.1.20: «que» sin «quais» también es forma natural PT.
    ["que lembretes tenho hoje", "pt", "today"],
    ["que lembretes tenho amanhã", "pt", "tomorrow"],
    ["tenho algum lembrete", "pt", undefined],
  ])("%p → reminderList (%s, range=%s)", (text, lang, range) => {
    const action = extractToolAction(text as string, NOW);
    expect(action?.kind).toBe("reminderList");
    expect((action as { lang: string }).lang).toBe(lang);
    expect((action as { range?: string }).range).toBe(range);
  });

  it("scoped listing does not steal other routes", () => {
    // El calendario sigue siendo del calendario, no de recordatorios.
    expect(extractToolAction("qué tengo hoy", NOW)?.kind).toBe("calendarList");
    expect(extractToolAction("qué tengo mañana", NOW)?.kind).toBe("calendarList");
    // Crear con "hoy" no es listar.
    expect(extractToolAction("recuérdame hoy comprar pan", NOW)).toBeNull();
  });

  it("filters by local day and speaks of that day", async () => {
    const todayDue = new Date(2026, 9, 11, 17, 0).toISOString(); // domingo 11 (NOW)
    const tomorrowDue = new Date(2026, 9, 12, 9, 0).toISOString();
    const deps = {
      dispatch: async () => ({ status: "executed" as const, text: "" }),
      isDisabled: () => false,
      now: () => NOW,
      listReminders: async () => [
        { id: "rx3", text: "llamar a mamá", dueAt: todayDue },
        { id: "rx4", text: "comprar pan", dueAt: tomorrowDue },
        { id: "rx5", text: "sin fecha", dueAt: null },
      ],
    };
    const today = await runToolAction({ kind: "reminderList", lang: "es", range: "today" }, deps);
    expect(today.response).toContain("Tus recordatorios de hoy:");
    expect(today.response).toContain("llamar a mamá");
    expect(today.response).not.toContain("comprar pan");
    expect(today.response).not.toContain("sin fecha");
    const tomorrow = await runToolAction({ kind: "reminderList", lang: "es", range: "tomorrow" }, deps);
    expect(tomorrow.response).toContain("Tus recordatorios de mañana:");
    expect(tomorrow.response).toContain("comprar pan");
    expect(tomorrow.response).not.toContain("llamar a mamá");
    const empty = await runToolAction(
      { kind: "reminderList", lang: "en", range: "tomorrow" },
      { ...deps, listReminders: async () => [{ id: "rx6", text: "hoy", dueAt: todayDue }] },
    );
    expect(empty.response).toBe("You have no reminders for tomorrow.");
  });
});

describe("0.1.19 — aviso de recordatorio de una sola vez", () => {
  it("existe en los tres idiomas y dice que no se repite", () => {
    expect(routerMessage("reminderOneTimeOnly", "es")).toContain("una sola vez");
    expect(routerMessage("reminderOneTimeOnly", "en")).toContain("one-time");
    expect(routerMessage("reminderOneTimeOnly", "pt")).toContain("único");
  });
});

describe("0.1.14 — reminderWhen localized", () => {
  it("es / en / pt", () => {
    const iso = new Date(2026, 9, 16, 10, 0).toISOString();
    expect(reminderWhen(iso, "es")).toBe(" el viernes, 16 de octubre a las 10:00");
    expect(reminderWhen(iso, "en")).toBe(" on Friday, October 16 at 10:00 AM");
    expect(reminderWhen(iso, "pt")).toBe(" em sexta-feira, 16 de outubro às 10:00");
    expect(reminderWhen("nope", "es")).toBe("");
  });
});

describe("0.1.20 (P3-9) — extractToolAction: borrados", () => {
  it("por título, en los tres idiomas", () => {
    expect(extractToolAction("borra la nota de la receta")).toMatchObject({ kind: "noteDelete", target: { type: "one", query: "receta" }, lang: "es" });
    expect(extractToolAction("elimina la nota del súper")).toMatchObject({ kind: "noteDelete", target: { type: "one", query: "súper" } });
    expect(extractToolAction("borra el recordatorio de comprar pan")).toMatchObject({ kind: "reminderDelete", target: { type: "one", query: "comprar pan" } });
    expect(extractToolAction("cancela el recordatorio de la farmacia")).toMatchObject({ kind: "reminderDelete", target: { type: "one", query: "farmacia" } });
    expect(extractToolAction("delete the note about taxes")).toMatchObject({ kind: "noteDelete", target: { type: "one", query: "taxes" }, lang: "en" });
    expect(extractToolAction("cancel my reminder to call mom")).toMatchObject({ kind: "reminderDelete", target: { type: "one", query: "call mom" }, lang: "en" });
    expect(extractToolAction("apaga a nota da receita")).toMatchObject({ kind: "noteDelete", target: { type: "one", query: "receita" }, lang: "pt" });
    expect(extractToolAction("exclui o lembrete de comprar pão")).toMatchObject({ kind: "reminderDelete", target: { type: "one", query: "comprar pão" }, lang: "pt" });
  });

  it("conjuntos completos y con alcance de día", () => {
    expect(extractToolAction("borra todos mis recordatorios")).toMatchObject({ kind: "reminderDelete", target: { type: "all" } });
    expect(extractToolAction("borra todas mis notas")).toMatchObject({ kind: "noteDelete", target: { type: "all" } });
    expect(extractToolAction("delete all my notes")).toMatchObject({ kind: "noteDelete", target: { type: "all" }, lang: "en" });
    expect(extractToolAction("cancela el recordatorio de mañana")).toMatchObject({ kind: "reminderDelete", target: { type: "ask" }, range: "tomorrow" });
    expect(extractToolAction("borra los recordatorios de hoy")).toMatchObject({ kind: "reminderDelete", target: { type: "all" }, range: "today" });
    expect(extractToolAction("borra el recordatorio de comprar pan de mañana")).toMatchObject({ kind: "reminderDelete", target: { type: "one", query: "comprar pan" } });
  });

  it("pelados: preguntar cuál (o el único que haya)", () => {
    expect(extractToolAction("borra la nota")).toMatchObject({ kind: "noteDelete", target: { type: "ask" } });
    expect(extractToolAction("borra el recordatorio")).toMatchObject({ kind: "reminderDelete", target: { type: "ask" } });
  });

  it("trampas: sin el sustantivo no hay ruta de borrado", () => {
    expect(extractToolAction("borra el mensaje")).toBeNull();
    expect(extractToolAction("cancela el evento de mañana")).toBeNull();
    expect(extractToolAction("elimina la aplicación")).toBeNull();
    expect(extractToolAction("borra eso")).toBeNull();
  });
});

describe("0.1.24 (auditoría de alcanzabilidad) — H-2/H-3/H-5", () => {
  it("H-2: el inglés pone el adjetivo antes del sustantivo («delete the birthday note»)", () => {
    // Antes: ninguna regla casaba y el turno se desviaba a
    // conocimiento sin pedir confirmación (sonda P2, caso 12d).
    expect(extractToolAction("delete the birthday note", NOW)).toMatchObject({
      kind: "noteDelete",
      target: { type: "one", query: "birthday" },
      lang: "en",
    });
    expect(extractToolAction("delete the dentist reminder", NOW)).toMatchObject({
      kind: "reminderDelete",
      target: { type: "one", query: "dentist" },
      lang: "en",
    });
    expect(extractToolAction("remove my shopping list note", NOW)).toMatchObject({
      kind: "noteDelete",
      target: { type: "one", query: "shopping list" },
    });
    // Las formas que ya funcionaban no cambian, y el pelado sigue pelado.
    expect(extractToolAction("delete the note about taxes", NOW)).toMatchObject({
      kind: "noteDelete",
      target: { type: "one", query: "taxes" },
    });
    expect(extractToolAction("delete the note", NOW)).toMatchObject({ kind: "noteDelete", target: { type: "ask" } });
  });

  it("H-3: «schedule dentist on Friday at 10» crea el evento con título limpio", () => {
    // El ejemplo exacto de la guía EN (locales/en.json) guardaba el
    // título corrupto «dentist on»: stripDateWords quitaba día y hora
    // pero no la preposición «on» (sonda P2, caso 7e).
    const a = extractToolAction("schedule dentist on Friday at 10", NOW) as Extract<ToolAction, { kind: "calendarCreate" }>;
    expect(a.kind).toBe("calendarCreate");
    expect(a.title).toBe("dentist");
    expect(new Date(a.start!).getDay()).toBe(5);
    expect(new Date(a.start!).getHours()).toBe(10);
  });

  it("H-5: la marca de canal al final no se traga en el destinatario", () => {
    // Sonda P2/P3: «…a Juan por nido: …» despachaba a «Juan por nido».
    expect(extractToolAction("Manda un mensaje a Juan por nido: ya llegué", NOW)).toMatchObject({
      kind: "nidoSend",
      to: "Juan",
      text: "ya llegué",
      lang: "es",
    });
    expect(extractToolAction("manda uma mensagem para o Juan pelo nido: já cheguei", NOW)).toMatchObject({
      kind: "nidoSend",
      to: "Juan",
      text: "já cheguei",
      lang: "pt",
    });
    // «vía nido» ni siquiera tenía regla con marca: devolvía null.
    expect(extractToolAction("manda un mensaje vía nido a Juan: ya llegué", NOW)).toMatchObject({
      kind: "nidoSend",
      to: "Juan",
      text: "ya llegué",
    });
    expect(extractToolAction("dile a Juan vía nido que ya llegué", NOW)).toMatchObject({
      kind: "nidoSend",
      to: "Juan",
      text: "ya llegué",
    });
  });
});

describe("0.1.20 (P3-9) — runToolAction: borrados", () => {
  const TODAY = new Date(2026, 9, 11, 9, 0).toISOString(); // domingo 11, hoy
  const TOMORROW = new Date(2026, 9, 12, 9, 0).toISOString();
  function delHarness(results: Record<string, { status: "executed" | "cancelled"; text: string }> = {}) {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const deps: ToolRouterDeps = {
      dispatch: async (name, args) => {
        calls.push({ name, args });
        return results[name] ?? { status: "executed", text: "Borrado." };
      },
      isDisabled: () => false,
      listNotes: async () => [
        { id: "n1", title: "Receta de pan" },
        { id: "n2", title: "Receta de sopa" },
        { id: "n3", title: "Lista de compras" },
      ],
      listReminders: async () => [
        { id: "r1", text: "comprar pan", dueAt: TODAY },
        { id: "r2", text: "comprar leche", dueAt: TODAY },
        { id: "r3", text: "llamar al banco", dueAt: TOMORROW },
      ],
      now: () => NOW,
    };
    return { deps, calls };
  }

  it("nota por título: la confirmación lleva id y título (el diálogo nombra el ítem)", async () => {
    const { deps, calls } = delHarness();
    const action = extractToolAction("borra la nota de la receta de pan")!;
    const out = await runToolAction(action, deps);
    expect(calls).toEqual([{ name: "delete_note", args: { id: "n1", title: "Receta de pan" } }]);
    expect(out.response).toBe("Listo, borré la nota «Receta de pan».");
  });

  it("nota ambigua: pregunta cuál y no borra nada", async () => {
    const { deps, calls } = delHarness();
    const out = await runToolAction(extractToolAction("borra la nota de la receta")!, deps);
    expect(calls).toHaveLength(0);
    expect(out.response).toContain("Receta de pan");
    expect(out.response).toContain("Receta de sopa");
  });

  it("recordatorio por texto + alcance: solo los del día, uno por confirmación", async () => {
    const { deps, calls } = delHarness();
    const out = await runToolAction(extractToolAction("borra los recordatorios de hoy")!, deps);
    expect(calls.map((c) => c.args.id)).toEqual(["r1", "r2"]);
    expect(calls[0].args).toMatchObject({ text: "comprar pan" });
    expect(out.response).toBe("Listo, borré 2 recordatorios.");
  });

  it("si el usuario cancela el segundo, se para y reporta el parcial", async () => {
    const calls: string[] = [];
    const deps: ToolRouterDeps = {
      dispatch: async (name, args) => {
        calls.push(String(args.id));
        return calls.length === 1
          ? { status: "executed", text: "Borrado." }
          : { status: "cancelled", text: "Entendido, no hice nada." };
      },
      isDisabled: () => false,
      listReminders: async () => [
        { id: "r1", text: "comprar pan", dueAt: TODAY },
        { id: "r2", text: "comprar leche", dueAt: TODAY },
      ],
      now: () => NOW,
    };
    const out = await runToolAction({ kind: "reminderDelete", target: { type: "all" }, lang: "es" }, deps);
    expect(calls).toEqual(["r1", "r2"]);
    expect(out.response).toBe("Me detuve: borré 1 de 2.");
  });

  it("pelado con un solo candidato: lo borra (la confirmación protege)", async () => {
    const { deps, calls } = delHarness();
    const out = await runToolAction(extractToolAction("cancela el recordatorio de mañana")!, deps);
    expect(calls).toEqual([{ name: "delete_reminder", args: { id: "r3", text: "llamar al banco" } }]);
    expect(out.response).toContain("llamar al banco");
  });

  it("sin coincidencias: honesto", async () => {
    const { deps, calls } = delHarness();
    const out = await runToolAction(extractToolAction("borra el recordatorio de regar las plantas")!, deps);
    expect(calls).toHaveLength(0);
    expect(out.response).toContain("No encontré ningún recordatorio");
  });

  it("herramienta apagada: delete_note desactivada se respeta", async () => {
    const { deps, calls } = delHarness();
    deps.isDisabled = (t) => t === "delete_note";
    const out = await runToolAction(extractToolAction("borra la nota de la receta de pan")!, deps);
    expect(calls).toHaveLength(0);
    expect(out.response).toContain("desactivada");
  });
});

describe("0.1.20 (P3-10) — buscar en notas", () => {
  it("extractToolAction en los tres idiomas y en las dos órdenes", () => {
    expect(extractToolAction("busca en mis notas la receta")).toMatchObject({ kind: "noteSearch", query: "receta", lang: "es" });
    expect(extractToolAction("busca la receta en mis notas")).toMatchObject({ kind: "noteSearch", query: "receta" });
    expect(extractToolAction("search my notes for the recipe")).toMatchObject({ kind: "noteSearch", query: "recipe", lang: "en" });
    expect(extractToolAction("find wifi password in my notes")).toMatchObject({ kind: "noteSearch", query: "wifi password", lang: "en" });
    expect(extractToolAction("procura nas minhas notas a receita")).toMatchObject({ kind: "noteSearch", query: "receita", lang: "pt" });
  });

  it("runToolAction busca en título Y cuerpo (sin acentos también)", async () => {
    const deps: ToolRouterDeps = {
      dispatch: async () => ({ status: "executed", text: "ok" }),
      isDisabled: () => false,
      listNotesFull: async () => [
        { id: "n1", title: "Compras", body: "pan, leche y aguacate" },
        { id: "n2", title: "Receta de la abuela", body: "hornear a 180 grados" },
      ],
      now: () => NOW,
    };
    const hit = await runToolAction({ kind: "noteSearch", query: "aguacate", lang: "es" }, deps);
    expect(hit.response).toContain("Compras");
    expect(hit.response).toContain("aguacate");
    const termsHit = await runToolAction({ kind: "noteSearch", query: "receta abuela", lang: "es" }, deps);
    expect(termsHit.response).toContain("Receta de la abuela");
    const none = await runToolAction({ kind: "noteSearch", query: "contraseña", lang: "es" }, deps);
    expect(none.response).toBe("No encontré nada en tus notas sobre «contraseña».");
  });
});

describe("0.1.20 (P3-12) — mensajes a contactos sin decir «por NIDO»", () => {
  it("extractToolAction: formas naturales en los tres idiomas", () => {
    expect(extractToolAction("manda un mensaje a Juan")).toMatchObject({ kind: "nidoSend", to: "Juan", text: null, lang: "es" });
    expect(extractToolAction("manda un mensaje a Juan que diga llego a las 5")).toMatchObject({ kind: "nidoSend", to: "Juan", text: "llego a las 5" });
    expect(extractToolAction("envía a María un mensaje: ya salí")).toMatchObject({ kind: "nidoSend", to: "María", text: "ya salí" });
    expect(extractToolAction("dile a Juan que ya llegué")).toMatchObject({ kind: "nidoSend", to: "Juan", text: "ya llegué" });
    expect(extractToolAction("send a message to Juan")).toMatchObject({ kind: "nidoSend", to: "Juan", text: null, lang: "en" });
    expect(extractToolAction("send Juan a message saying I'm on my way")).toMatchObject({ kind: "nidoSend", to: "Juan", text: "I'm on my way", lang: "en" });
    expect(extractToolAction("tell Juan that dinner is ready")).toMatchObject({ kind: "nidoSend", to: "Juan", text: "dinner is ready", lang: "en" });
    expect(extractToolAction("manda uma mensagem para o João")).toMatchObject({ kind: "nidoSend", to: "João", text: null, lang: "pt" });
  });

  it("las formas con «por NIDO» siguen ganando (sin cambios)", () => {
    expect(extractToolAction("manda un mensaje por nido a Juan que diga hola")).toMatchObject({ kind: "nidoSend", to: "Juan", text: "hola" });
  });

  it("sin la palabra mensaje (ni dile/tell), no hay envío", () => {
    expect(extractToolAction("manda a Juan por las tortillas")).toBeNull();
    expect(extractToolAction("escríbele una carta a Juan")).toBeNull();
  });

  it("sin texto: pregunta qué decir (nidoAskText), no envía nada", async () => {
    const calls: string[] = [];
    const deps: ToolRouterDeps = {
      dispatch: async (name) => {
        calls.push(name);
        return { status: "executed", text: "ok" };
      },
      isDisabled: () => false,
    };
    const out = await runToolAction(extractToolAction("manda un mensaje a Juan")!, deps);
    expect(calls).toHaveLength(0);
    expect(out.response).toContain("Juan");
  });
});

describe("0.1.20 (P3-15) — moneda: respuesta honesta offline", () => {
  it("extractToolAction detecta las preguntas de cambio", () => {
    expect(extractToolAction("¿cuántos dólares son 100 pesos?")).toMatchObject({ kind: "currencyInfo", lang: "es" });
    expect(extractToolAction("cuánto es 100 pesos en dólares")).toMatchObject({ kind: "currencyInfo" });
    expect(extractToolAction("¿cuánto vale un dólar?")).toMatchObject({ kind: "currencyInfo" });
    expect(extractToolAction("convierte 50 euros a pesos")).toMatchObject({ kind: "currencyInfo" });
    expect(extractToolAction("how many dollars is 100 pesos")).toMatchObject({ kind: "currencyInfo", lang: "en" });
    expect(extractToolAction("convert 50 euros to dollars")).toMatchObject({ kind: "currencyInfo", lang: "en" });
    expect(extractToolAction("quantos reais são 100 dólares")).toMatchObject({ kind: "currencyInfo", lang: "pt" });
  });

  it("no secuestra otras preguntas con «cuántos» ni conversiones de unidades", () => {
    expect(extractToolAction("¿cuántos pesos son 5 kilos de tortillas?")).toBeNull();
    expect(extractToolAction("¿cuánto es 70 kg en libras?")?.kind).toBe("convert");
  });

  it("runToolAction responde honesto, sin dispatch ni cifras inventadas", async () => {
    const calls: string[] = [];
    const deps: ToolRouterDeps = {
      dispatch: async (name) => {
        calls.push(name);
        return { status: "executed", text: "ok" };
      },
      isDisabled: () => false,
    };
    const out = await runToolAction({ kind: "currencyInfo", lang: "es" }, deps);
    expect(calls).toHaveLength(0);
    expect(out.response).toContain("no tengo tipos de cambio");
    expect(out.response).toContain("no te voy a inventar una cifra");
  });
});

describe("0.1.24 (auditoría de alcanzabilidad, H-4) — notas entre idiomas", () => {
  // El dueño guarda en un idioma y pregunta en otro: el matching
  // literal respondía «I couldn't find a note called "birthday"»
  // teniendo la nota «cumpleaños de Ana» delante (sonda P2, 14a/14b).
  const NOTES = [{ id: "n1", title: "cumpleaños de Ana", body: "ideas para el cumpleaños de Ana: flores y pastel" }];
  const deps: ToolRouterDeps = {
    dispatch: async (name, args) => ({
      status: "executed",
      text: name === "read_note" ? NOTES.find((n) => n.id === args.id)!.body : "ok",
    }),
    isDisabled: () => false,
    listNotes: async () => NOTES.map((n) => ({ id: n.id, title: n.title })),
    listNotesFull: async () => NOTES,
    now: () => NOW,
  };

  it("leer: «read the note about birthday» encuentra la nota en español", async () => {
    const out = await runToolAction(extractToolAction("read the note about birthday", NOW)!, deps);
    expect(out.response).toContain("flores y pastel");
  });

  it("buscar: «search flowers in my notes» la encuentra por el cuerpo", async () => {
    const out = await runToolAction(extractToolAction("search flowers in my notes", NOW)!, deps);
    expect(out.response).toContain("cumpleaños de Ana");
  });

  it("buscar en PT: «procura flores nas minhas notas» también", async () => {
    const out = await runToolAction(extractToolAction("procura flores nas minhas notas", NOW)!, deps);
    expect(out.response).toContain("cumpleaños de Ana");
  });

  it("borrar: «delete the birthday note» llega a la nota en español (pide confirmación)", async () => {
    const out = await runToolAction(extractToolAction("delete the birthday note", NOW)!, deps);
    expect(out.response).toContain("cumpleaños de Ana");
    expect(out.toolUses.map((u) => u.name)).toContain("delete_note");
  });

  it("el matching normal no se rompe: una consulta sin equivalente sigue sin encontrar", async () => {
    const out = await runToolAction(extractToolAction("read the note about quantum", NOW)!, deps);
    expect(out.response).toContain("couldn't find");
  });
});
