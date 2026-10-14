/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/** 0.1.32: cuenta atrás de fechas y recordatorio con fecha pero sin contenido. */
import { describe, expect, it } from "vitest";
import { countdownTarget, extractToolAction, notePendingReminderAsk, reminderRepeatWhen, routerMessage, runToolAction } from "./toolRouter";
import { extractCalcAction, extractReminderAction, extractWeeklyPlanAction, reminderMissingText } from "./actionRouter";
import { classifyIntent } from "./intent";

const NOW = new Date(2026, 9, 13, 10, 0); // martes 13-10-2026

describe("cuenta atrás", () => {
  it.each([
    ["cuánto falta para navidad", "es", "Navidad", 11, 25],
    ["cuántos días faltan para nochebuena", "es", "Nochebuena", 11, 24],
    ["how many days until christmas", "en", "Christmas", 11, 25],
    ["how long until new year", "en", "New Year's Day", 0, 1],
    ["quanto falta para o natal", "pt", "o Natal", 11, 25],
    ["quantos dias faltam para o ano novo", "pt", "o Ano Novo", 0, 1],
  ])("%s", (s, lang, label, month, day) => {
    const a = extractToolAction(s, NOW) as { kind: string; target: string; label: string; lang: string };
    expect(a).toMatchObject({ kind: "countdown", label, lang });
    const d = new Date(a.target);
    expect([d.getMonth(), d.getDate()]).toEqual([month, day]);
    expect(d.getTime()).toBeGreaterThanOrEqual(new Date(2026, 9, 13).getTime());
  });

  it("fechas sin nombre: sin etiqueta, la respuesta nombra el día", () => {
    const c = countdownTarget("25 de diciembre", NOW, "es");
    expect(c?.label).toBe("");
    expect([c!.target.getMonth(), c!.target.getDate()]).toEqual([11, 25]);
  });

  it("una fiesta que ya pasó este año es la del año que viene", () => {
    const c = countdownTarget("halloween", new Date(2026, 10, 2), "en");
    expect(c!.target.getFullYear()).toBe(2027);
  });

  it("calcula los días y responde en el idioma", async () => {
    const deps = {
      isDisabled: () => false,
      dispatch: async () => ({ status: "executed" as const, text: "" }),
      now: () => NOW,
    };
    const es = await runToolAction(extractToolAction("cuánto falta para navidad", NOW)!, deps as never);
    expect(es.response).toBe("Faltan 73 días para Navidad (viernes, 25 de diciembre).");
    const en = await runToolAction(extractToolAction("how many days until christmas", NOW)!, deps as never);
    expect(en.response).toBe("73 days until Christmas (Friday, December 25).");
    const today = await runToolAction(extractToolAction("cuánto falta para el 13 de octubre", NOW)!, deps as never);
    expect(today.response).toMatch(/^¡Es hoy!/);
  });

  it("lo que no se entiende no se inventa", () => {
    expect(extractToolAction("cuánto falta para que llegue mi hermano", NOW)?.kind).not.toBe("countdown");
  });
});

describe("recordatorio con fecha pero sin contenido: se pregunta qué", () => {
  it.each(["ponme un recordatorio para el lunes", "set a reminder for monday", "me põe um lembrete para segunda", "set a reminder for 5pm"])(
    "%s",
    (s) => {
      expect(extractReminderAction(s)).toBeNull();
      expect(reminderMissingText(s)).toBeTruthy();
      expect(classifyIntent(s)).toBe("actuar");
    },
  );
  it("con contenido sigue creando el recordatorio", () => {
    expect(reminderMissingText("ponme un recordatorio para el lunes de pagar la luz")).toBeNull();
    expect(extractReminderAction("ponme un recordatorio para el lunes de pagar la luz")?.text).toBe("pagar la luz");
  });
  it("las alarmas sin texto siguen siendo avisos", () => {
    expect(extractReminderAction("pon una alarma a las 7")?.dueAt).toBeTruthy();
  });
  it("el mensaje existe en los tres idiomas", () => {
    for (const l of ["es", "en", "pt"] as const) expect(routerMessage("reminderAskWhat", l, { when: " X" })).toContain(" X");
  });
});

describe("recordatorios que se repiten", () => {
  const at = (r: { dueAt: string | null } | null) => new Date(r!.dueAt!);

  it.each([
    ["recuérdame tomar la pastilla cada día a las 8 de la mañana", "tomar la pastilla", 8],
    ["recuérdame todos los días beber agua", "beber agua", 9],
    ["remind me to take my pill every day at 8am", "take my pill", 8],
    ["remind me daily to stretch", "stretch", 9],
    ["me lembra de tomar o remédio todos os dias às 8 da manhã", "tomar o remédio", 8],
  ])("diario: %s", (s, text, hour) => {
    const r = extractReminderAction(s, NOW);
    expect(r).toMatchObject({ text, repeat: "day" });
    expect(r!.recurrenceRequested).toBeUndefined();
    expect(at(r).getHours()).toBe(hour);
    expect(at(r).getTime()).toBeGreaterThan(NOW.getTime());
    // La primera vez es la próxima: hoy si aún no pasó, si no mañana.
    expect(at(r).getTime() - NOW.getTime()).toBeLessThanOrEqual(24 * 3600_000);
  });

  it.each([
    ["recuérdame cada lunes sacar la basura", "sacar la basura", 1, 9],
    ["recuérdame todos los viernes a las 6 de la tarde llamar a mamá", "llamar a mamá", 5, 18],
    ["remind me every sunday to water the plants", "water the plants", 0, 9],
    ["remind me on mondays to send the report", "send the report", 1, 9],
    ["me lembra toda segunda de levar o lixo", "levar o lixo", 1, 9],
  ])("semanal: %s", (s, text, weekday, hour) => {
    const r = extractReminderAction(s, NOW);
    expect(r).toMatchObject({ text, repeat: "week" });
    expect(at(r).getDay()).toBe(weekday);
    expect(at(r).getHours()).toBe(hour);
    expect(at(r).getTime()).toBeGreaterThan(NOW.getTime());
    expect(at(r).getTime() - NOW.getTime()).toBeLessThanOrEqual(7 * 24 * 3600_000);
  });

  it("«cada martes» dicho un martes antes de la hora: hoy", () => {
    const r = extractReminderAction("recuérdame cada martes a las 11 ir al gimnasio", NOW);
    expect(at(r).getDate()).toBe(13);
    expect(at(r).getHours()).toBe(11);
  });

  it("«cada semana» sin día usa el de la fecha dicha", () => {
    const r = extractReminderAction("recuérdame cada semana el jueves revisar las cuentas", NOW);
    expect(r).toMatchObject({ text: "revisar las cuentas", repeat: "week" });
    expect(at(r).getDay()).toBe(4);
  });

  it("«cada noche a las 10» es a las 22:00", () => {
    const r = extractReminderAction("recuérdame cada noche a las 10 apagar el horno", NOW);
    expect(r).toMatchObject({ repeat: "day" });
    expect(at(r).getHours()).toBe(22);
  });

  it("«on monday» (singular) es una sola vez", () => {
    const r = extractReminderAction("remind me on monday to call the bank", NOW);
    expect(r).not.toBeNull();
    expect(r!.repeat).toBeUndefined();
  });

  it("sin repetición nada cambia", () => {
    const r = extractReminderAction("recuérdame mañana a las 9 llamar al médico", NOW);
    expect(r!.repeat).toBeUndefined();
  });

  it("respuestas: «cada lunes a las 9:00» en los 3 idiomas", () => {
    const iso = new Date(2026, 9, 19, 9, 0).toISOString();
    expect(reminderRepeatWhen(iso, "week", "es")).toBe(" cada lunes a las 9:00");
    expect(reminderRepeatWhen(iso, "day", "en")).toMatch(/^ every day at /);
    expect(reminderRepeatWhen(iso, "week", "pt")).toBe(" toda segunda-feira às 9:00");
    const sun = new Date(2026, 9, 18, 9, 0).toISOString();
    expect(reminderRepeatWhen(sun, "week", "pt")).toBe(" todo domingo às 9:00");
  });

  it("listar «mañana» incluye uno diario cuya próxima vez es hoy", async () => {
    const a = extractToolAction("qué recordatorios tengo mañana", NOW);
    expect(a).toMatchObject({ kind: "reminderList", range: "tomorrow" });
    const res = await runToolAction(a!, {
      now: () => NOW,
      isDisabled: () => false,
      dispatch: async () => ({ status: "executed" as const, text: "" }),
      listReminders: async () => [
        { id: "1", text: "pastilla", dueAt: new Date(2026, 9, 13, 21, 0).toISOString(), repeat: "day" },
        { id: "2", text: "dentista", dueAt: new Date(2026, 9, 13, 18, 0).toISOString(), repeat: null },
      ],
    } as never);
    expect(res.response).toContain("pastilla");
    expect(res.response).toContain("cada día");
    expect(res.response).not.toContain("dentista");
  });
});

describe("mensajes NIDO: mismas formas en es/en/pt", () => {
  it.each([
    ["escríbele a Ana que llego tarde", "es", "Ana", "llego tarde"],
    ["dile a Ana que llego tarde", "es", "Ana", "llego tarde"],
    ["write to Ana that I'm late", "en", "Ana", "I'm late"],
    ["send Ana a nido message saying hi", "en", "Ana", "hi"],
    ["send via nido to Ana: hi", "en", "Ana", "hi"],
    ["escreve para a Ana que chego tarde", "pt", "Ana", "chego tarde"],
    ["diz para a Ana que chego tarde", "pt", "Ana", "chego tarde"],
    ["fala pra Ana que chego tarde", "pt", "Ana", "chego tarde"],
    ["manda pelo nido para a Ana que oi", "pt", "Ana", "oi"],
  ])("%s", (s, lang, to, text) => {
    expect(extractToolAction(s, NOW)).toEqual({ kind: "nidoSend", to, text, lang });
  });

  it.each(["tell me that you can do it", "diz pra mim que horas são", "write to me that it's done"])(
    "«%s» habla conmigo, no es un envío",
    (s) => {
      const a = extractToolAction(s, NOW);
      expect(a?.kind).not.toBe("nidoSend");
    },
  );

  it("la cola de salida se explica igual en los tres idiomas (sin «Bluetooth» solo en español)", async () => {
    const deps = {
      isDisabled: () => false,
      now: () => NOW,
      dispatch: async () => ({
        status: "executed" as const,
        text: "Mensaje para «Ana» guardado cifrado en la cola de salida: se entregará cuando su NIDO esté al alcance.",
      }),
    };
    const es = await runToolAction({ kind: "nidoSend", to: "Ana", text: "hola", lang: "es" }, deps as never);
    const en = await runToolAction({ kind: "nidoSend", to: "Ana", text: "hi", lang: "en" }, deps as never);
    const pt = await runToolAction({ kind: "nidoSend", to: "Ana", text: "oi", lang: "pt" }, deps as never);
    expect(es.response).not.toContain("Bluetooth");
    expect(en.response).toContain("outbox");
    expect(pt.response).toContain("fila");
    expect(pt.response).not.toContain("dele");
  });
});

describe("0.1.34: cuenta atrás tolerante con días con nombre", () => {
  it.each([
    ["Canton falta Para navidad", "es", "Navidad"], // autocorrector (prueba física)
    ["cuanto falta pa navidad", "es", "Navidad"],
    ["falta mucho para navidad?", "es", "Navidad"],
    ["days till christmas", "en", "Christmas"],
    ["how long till new year", "en", "New Year's Day"],
    ["quanto falta pro natal", "pt", "o Natal"],
    ["falta pouco para o natal", "pt", "o Natal"],
  ])("%s", (s, lang, label) => {
    expect(extractToolAction(s, NOW)).toMatchObject({ kind: "countdown", label, lang });
  });

  it("con fechas sueltas sigue exigiendo la pregunta completa", () => {
    expect(extractToolAction("Canton falta para el 25 de diciembre", NOW)?.kind).not.toBe("countdown");
    expect(extractToolAction("falta para el lunes", NOW)?.kind).not.toBe("countdown");
  });

  it("no pisa otras rutas", () => {
    expect(extractToolAction("manda un mensaje a Ana que falta para navidad", NOW)?.kind).toBe("nidoSend");
    expect(extractToolAction("convert 5 km to miles", NOW)?.kind).toBe("convert");
  });
});

describe("0.1.34: calculadora con el gatillo cambiado por el autocorrector", () => {
  it.each([
    ["Canton es 15% de 200", 30],
    ["Canton es 245*38", 9310],
    ["Canton son 9 por 7", 63],
  ])("%s", (s, result) => {
    expect(extractCalcAction(s)?.result).toBe(result);
  });

  it.each(["mi edad es 30", "la clave es 1234", "Teléfono es 555-1234", "Canton es 1111111111111111111111"])(
    "«%s» no es una cuenta",
    (s) => {
      expect(extractCalcAction(s)).toBeNull();
    },
  );
});

describe("0.1.34: «ayúdame a planear mi semana» usa la plantilla", () => {
  it("con petición explícita", () => {
    expect(
      extractWeeklyPlanAction("Ayúdame a planear mi semana: trabajo de 9 a 6, quiero hacer ejercicio 3 veces y pasar tiempo con mi familia."),
    ).toMatchObject({ workStart: 9, workEnd: 18, exerciseDays: 3, wantsFamilyTime: true });
  });
  it("contarlo no es pedirlo", () => {
    expect(extractWeeklyPlanAction("voy a planear mi semana mañana, qué opinas")).toBeNull();
  });
});

describe("0.1.34: «Haz uno» tras una lista de recordatorios vacía", () => {
  it("dentro de la ventana explica cómo pedirlo; fuera, no se toca", async () => {
    const t0 = new Date(2026, 9, 13, 18, 25);
    const deps = { isDisabled: () => false, now: () => t0, dispatch: async () => ({ status: "executed" as const, text: "" }), listReminders: async () => [] };
    const list = extractToolAction("qué recordatorios tengo mañana", t0)!;
    await runToolAction(list, deps as never);
    const a = extractToolAction("Haz uno", new Date(t0.getTime() + 30_000));
    expect(a).toMatchObject({ kind: "reminderOfferCreate", range: "tomorrow", lang: "es" });
    const r = await runToolAction(a!, deps as never);
    expect(r.response).toContain("recuérdame mañana a las 9");
    expect(extractToolAction("make one", new Date(t0.getTime() + 60_000))).toMatchObject({ kind: "reminderOfferCreate", lang: "en" });
    expect(extractToolAction("Haz uno", new Date(t0.getTime() + 10 * 60_000))).toBeNull();
  });
});

describe("0.1.35: recordatorios cada mes y cada año", () => {
  const at = (r: { dueAt: string | null } | null) => new Date(r!.dueAt!);
  it.each([
    ["recuérdame pagar el alquiler el día 1 de cada mes", "pagar el alquiler", 1],
    ["recuérdame cada mes el día 5 pagar la luz", "pagar la luz", 5],
    ["remind me to pay rent on the 1st of every month", "pay rent", 1],
    ["me lembra de pagar o aluguel todo dia 5 de cada mês", "pagar o aluguel", 5],
  ])("mensual: %s", (s, text, day) => {
    const r = extractReminderAction(s, NOW);
    expect(r).toMatchObject({ text, repeat: "month" });
    expect(at(r).getDate()).toBe(day);
    expect(at(r).getTime()).toBeGreaterThan(NOW.getTime());
  });
  it.each([
    ["recuérdame cada año el 15 de marzo el cumpleaños de mamá", "el cumpleaños de mamá"],
    ["remind me every year on March 15 about mom's birthday", "mom's birthday"],
    ["me lembra todo ano em 15 de março do aniversário da mãe", "aniversário da mãe"],
  ])("anual: %s", (s, text) => {
    const r = extractReminderAction(s, NOW);
    expect(r).toMatchObject({ text, repeat: "year" });
    expect([at(r).getMonth(), at(r).getDate()]).toEqual([2, 15]);
  });
  it("respuestas en los tres idiomas", () => {
    const iso = new Date(2027, 2, 15, 9, 0).toISOString();
    expect(reminderRepeatWhen(iso, "year", "es")).toBe(" cada año el 15 de marzo a las 9:00");
    expect(reminderRepeatWhen(iso, "month", "en")).toMatch(/^ every month on the 15th at /);
    expect(reminderRepeatWhen(iso, "month", "pt")).toBe(" todo mês no dia 15 às 9:00");
  });
});

describe("0.1.35: la respuesta a «¿qué te recuerdo?» crea el recordatorio", () => {
  it("«ponme un recordatorio para el lunes» → «pagar la luz» → recordatorio del lunes", async () => {
    const t0 = new Date(2026, 9, 13, 20, 0);
    const created: Array<Record<string, unknown>> = [];
    const deps = {
      isDisabled: () => false,
      now: () => t0,
      dispatch: async (_n: string, args: Record<string, unknown>) => {
        created.push(args);
        return { status: "executed" as const, text: "Recordatorio guardado: «pagar la luz». Te llegará un aviso del sistema a esa hora, aunque NIDO esté cerrado." };
      },
    };
    const due = new Date(2026, 9, 19, 9, 0).toISOString();
    notePendingReminderAsk(due, "es", t0);
    const a = extractToolAction("pagar la luz", new Date(t0.getTime() + 20_000));
    expect(a).toMatchObject({ kind: "reminderFill", text: "pagar la luz", dueAt: due });
    // La puerta y el loop lo consultan los dos: no se consume al detectar.
    expect(extractToolAction("pagar la luz", new Date(t0.getTime() + 21_000))?.kind).toBe("reminderFill");
    const r = await runToolAction(a!, deps as never);
    expect(created[0]).toMatchObject({ text: "pagar la luz", at: due });
    expect(r.response).toContain("pagar la luz");
    // Ya usado: un mensaje corto después no crea otro.
    expect(extractToolAction("sacar la basura", new Date(t0.getTime() + 40_000))).toBeNull();
  });

  it("«no» lo anula; una pregunta o un mensaje largo no se toman como contenido", () => {
    const t0 = new Date(2026, 9, 13, 20, 0);
    notePendingReminderAsk(new Date(2026, 9, 19, 9, 0).toISOString(), "es", t0);
    expect(extractToolAction("¿qué es la inflación?", t0)).toBeNull();
    expect(extractToolAction("uno dos tres cuatro cinco seis siete ocho nueve diez once", t0)).toBeNull();
    expect(extractToolAction("no", t0)).toBeNull();
    expect(extractToolAction("pagar la luz", t0)).toBeNull();
  });

  it("fuera de la ventana de 3 minutos no hace nada", () => {
    const t0 = new Date(2026, 9, 13, 20, 0);
    notePendingReminderAsk(new Date(2026, 9, 19, 9, 0).toISOString(), "es", t0);
    expect(extractToolAction("pagar la luz", new Date(t0.getTime() + 5 * 60_000))).toBeNull();
  });
});

describe("0.1.35: una alarma sin parte del día es de mañana", () => {
  it.each(["pon una alarma a las 7", "set an alarm for 7", "coloca um alarme às 7"])("%s → 7:00", (s) => {
    const r = extractReminderAction(s, new Date(2026, 9, 13, 20, 0));
    expect(new Date(r!.dueAt!).getHours()).toBe(7);
  });
  it("con «de la tarde» respeta la tarde", () => {
    const r = extractReminderAction("pon una alarma a las 5 de la tarde", new Date(2026, 9, 13, 10, 0));
    expect(new Date(r!.dueAt!).getHours()).toBe(17);
  });
});
