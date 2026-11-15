// Tanda T-28 (0.1.99) — regresión de la re-auditoría de la zona 4
// (ACTA-zona4.md §2, Z-02 NO AGUANTA): H-Z4-3, H-Z4-4, H-Z4-5 y
// H-Z4-6. Las sondas originales de T-02 pasan enteras; estos casos
// son las variantes de la re-auditoría que abrían huecos de las
// mismas clases, con sus pares de control.
// now = sábado 14 de noviembre de 2026, 10:00 local (el de las sondas).
import { describe, expect, it } from "vitest";
import {
  extractReminderAction,
  hasImpossibleWhen,
  parseReminderDateTime,
  reminderInvalidWhen,
} from "./actionRouter";
import { extractToolAction, weekdayAction } from "./toolRouter";

const now = new Date(2026, 10, 14, 10, 0);
const day = (iso: string | null | undefined) => (iso ? new Date(iso) : null);
const ymd = (iso: string | null | undefined) => {
  const d = day(iso);
  return d ? [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()] : null;
};

describe("H-Z4-3 · la abreviatura EN con punto en orden mes-primero existe", () => {
  it.each([
    ["remind me Jan. 15 to buy bread", [2027, 0, 15, 9, 0]],
    ["remind me Sept. 15 to buy bread", [2027, 8, 15, 9, 0]],
    ["remind me Sep. 15 to buy bread", [2027, 8, 15, 9, 0]],
  ])("%s", (t, want) => {
    const r = extractReminderAction(t, now);
    expect(r?.text).toBe("buy bread");
    expect(ymd(r?.dueAt)).toEqual(want);
  });
  it("con año escrito tras coma: «Jan. 15, 2027» es ese año", () => {
    expect(ymd(parseReminderDateTime("Jan. 15, 2027", now))).toEqual([2027, 0, 15, 9, 0]);
  });
  it("«qué día cae» en inglés también la lee: what day is Sept. 15", () => {
    const a = weekdayAction("what day is Sept. 15", now);
    expect(a?.kind).toBe("weekday");
    if (a?.kind === "weekday") {
      expect(a.month).toBe(9);
      expect(a.day).toBe(15);
    }
  });
  it("y la imposible con punto avisa: «Sept. 31» no existe", () => {
    expect(hasImpossibleWhen("sept. 31")).toBe(true);
  });
  it("pulido: las formas ES/PT con punto no dejan el «.» en el título", () => {
    const es = extractReminderAction("recuérdame el 15 de ene. comprar pan", now);
    expect(es?.text).toBe("comprar pan");
    expect(ymd(es?.dueAt)).toEqual([2027, 0, 15, 9, 0]);
    const esMay = extractReminderAction("recuérdame el 15 de ENE. comprar pan", now);
    expect(esMay?.text).toBe("comprar pan");
    const pt = extractReminderAction("lembre-me 15 de fev. de comprar pão", now);
    expect(pt?.text).toBe("comprar pão");
    expect(ymd(pt?.dueAt)).toEqual([2027, 1, 15, 9, 0]);
  });
  it("pulido en calendario: «cita el 15 de ene.» no titula «cita .»", () => {
    const a = extractToolAction("agenda una cita el 15 de ene. a las 10", now);
    expect(a?.kind).toBe("calendarCreate");
    if (a?.kind === "calendarCreate") {
      expect(a.title).toBe("cita");
      expect(ymd(a.start)).toEqual([2027, 0, 15, 10, 0]);
    }
  });
});

describe("H-Z4-4 · los relativos componen con la hora escrita", () => {
  it.each([
    // La fecha del relativo y la hora escrita, leída con la misma
    // lectura de reloj del resto del parser (sin am/pm, de 1 a 7 es
    // tarde; «a las cinco» = 17:00, como fijó el plan).
    ["en una quincena a las cinco", [2026, 10, 28, 17, 0]],
    ["in a fortnight at five", [2026, 10, 28, 17, 0]],
    ["daqui a uma quinzena às cinco", [2026, 10, 28, 17, 0]],
    ["en una quincena a las cinco y media", [2026, 10, 28, 17, 30]],
    ["en 3 días a las 8", [2026, 10, 17, 8, 0]],
    ["en 3 días a las 17", [2026, 10, 17, 17, 0]],
    ["in 8 days at 5", [2026, 10, 22, 17, 0]],
    ["dentro de dos semanas a las 9", [2026, 10, 28, 9, 0]],
    ["daqui a 3 dias às 8", [2026, 10, 17, 8, 0]],
  ])("%s", (t, want) => {
    expect(ymd(parseReminderDateTime(t, now))).toEqual(want);
  });
  it("a nivel de creación: el aviso nace con las dos piezas", () => {
    const r = extractReminderAction("recuérdame en una quincena a las cinco comprar pan", now);
    expect(r?.text).toBe("comprar pan");
    expect(ymd(r?.dueAt)).toEqual([2026, 10, 28, 17, 0]);
  });
  it("control: sin hora escrita, el relativo conserva la hora actual", () => {
    expect(ymd(parseReminderDateTime("en una quincena", now))).toEqual([2026, 10, 28, 10, 0]);
    expect(ymd(parseReminderDateTime("en 3 días", now))).toEqual([2026, 10, 17, 10, 0]);
  });
  it("control: los relativos de minutos/horas no cambian (su hora ES el desplazamiento)", () => {
    expect(ymd(parseReminderDateTime("en 20 minutos", now))).toEqual([2026, 10, 14, 10, 20]);
    expect(ymd(parseReminderDateTime("en 2 horas", now))).toEqual([2026, 10, 14, 12, 0]);
    expect(ymd(parseReminderDateTime("en 2 horas a las 5", now))).toEqual([2026, 10, 14, 12, 0]);
  });
});

describe("H-Z4-5 · el dictado de la hora fuera de la tabla: parsea o avisa", () => {
  it("«a las onse» (dictado de «once») suena a las 11, con el título limpio", () => {
    const r = extractReminderAction("recuérdame mañana a las onse comprar pan", now);
    expect(r?.text).toBe("comprar pan");
    expect(ymd(r?.dueAt)).toEqual([2026, 10, 15, 11, 0]);
  });
  it("«a las dose» (dictado de «doce») suena a las 12", () => {
    const r = extractReminderAction("recuérdame mañana a las dose comprar pan", now);
    expect(r?.text).toBe("comprar pan");
    expect(ymd(r?.dueAt)).toEqual([2026, 10, 15, 12, 0]);
  });
  it("el portugués «às onze» entra en la tabla (faltaba: caía a las 09:00)", () => {
    const r = extractReminderAction("lembre-me amanhã às onze de comprar pão", now);
    expect(r?.text).toBe("comprar pão");
    expect(ymd(r?.dueAt)).toEqual([2026, 10, 15, 11, 0]);
  });
  it("la casi-gemela no listada («nuebe», «ciete») no crea en silencio: avisa", () => {
    expect(extractReminderAction("recuérdame mañana a las nuebe comprar pan", now)).toBeNull();
    expect(reminderInvalidWhen("recuérdame mañana a las nuebe comprar pan", now)).toBe(true);
    expect(hasImpossibleWhen("mañana a las ciete")).toBe(true);
  });
  it("control: «a las once» bien dicha no cambia", () => {
    expect(ymd(parseReminderDateTime("mañana a las once", now))).toEqual([2026, 10, 15, 11, 0]);
  });
  it("control: «a las» de contenido no es una hora («a las madres», «às vezes», «a las tantas»)", () => {
    const madres = extractReminderAction("recuérdame mañana felicitar a las madres del grupo", now);
    expect(madres?.text).toBe("felicitar a las madres del grupo");
    expect(ymd(madres?.dueAt)).toEqual([2026, 10, 15, 9, 0]);
    expect(reminderInvalidWhen("recuérdame mañana felicitar a las madres del grupo", now)).toBe(false);
    const vezes = extractReminderAction("lembre-me amanhã às vezes de tomar o remédio", now);
    expect(ymd(vezes?.dueAt)).toEqual([2026, 10, 15, 9, 0]);
    expect(reminderInvalidWhen("lembre-me amanhã às vezes de tomar o remédio", now)).toBe(false);
    expect(reminderInvalidWhen("recuérdame mañana a las tantas comprar pan", now)).toBe(false);
    // «nueva» vive a una edición de «nueve» pero es un adjetivo:
    // «a la nueva jefa» es contenido y crea como siempre.
    const nueva = extractReminderAction("recuérdame mañana presentarme a la nueva jefa", now);
    expect(ymd(nueva?.dueAt)).toEqual([2026, 10, 15, 9, 0]);
    expect(reminderInvalidWhen("recuérdame mañana presentarme a la nueva jefa", now)).toBe(false);
  });
  it("control: el marco inglés «at» no se vigila («at home» es contenido)", () => {
    const r = extractReminderAction("remind me tomorrow at home to buy milk", now);
    expect(ymd(r?.dueAt)).toEqual([2026, 10, 15, 9, 0]);
    expect(reminderInvalidWhen("remind me tomorrow at home to buy milk", now)).toBe(false);
  });
});

describe("H-Z4-6 · la numérica imposible sin año también avisa", () => {
  it.each(["el 31/4", "el 31/6", "el 30/2", "el 4/31"])("%s", (t) => {
    expect(hasImpossibleWhen(t)).toBe(true);
  });
  it("a nivel de orden: no se crea y reminderInvalidWhen lo dice", () => {
    expect(extractReminderAction("recuérdame el 31/4 comprar pan", now)).toBeNull();
    expect(reminderInvalidWhen("recuérdame el 31/4 comprar pan", now)).toBe(true);
    expect(reminderInvalidWhen("recuérdame el 30/2 comprar pan", now)).toBe(true);
  });
  it("control: «el 29/2» sin año no es imposible (rueda al 2028 real)", () => {
    expect(hasImpossibleWhen("el 29/2")).toBe(false);
    expect(ymd(parseReminderDateTime("el 29/2 a las 10", now))).toEqual([2028, 1, 29, 10, 0]);
  });
  it("control: meses de 31 no se marcan («el 31/5», «el 31/1»)", () => {
    expect(hasImpossibleWhen("el 31/5")).toBe(false);
    expect(hasImpossibleWhen("el 31/1")).toBe(false);
    expect(ymd(parseReminderDateTime("el 31/5", now))).toEqual([2027, 4, 31, 9, 0]);
  });
  it("control: la fracción de cocina sigue sin ser fecha ni aviso («el 1/2»)", () => {
    expect(hasImpossibleWhen("el 1/2")).toBe(false);
  });
});

describe("Declaración T-28 · el router NO comparte el defecto de Date.parse (hallazgo hermano de la zona 5)", () => {
  // La zona 5 cazó en el dispatcher del agente una validación que
  // acepta días inexistentes fiándose de Date.parse (V8 normaliza
  // 2027-02-30 y la fecha corre en silencio). Este parser no usa
  // Date.parse en ninguna vía (grep limpio en actionRouter.ts y
  // toolRouter.ts): cada construcción por componentes se comprueba
  // contra sus propios componentes (probe de readNumericDate, build
  // de la fecha nombrada, bucles de años/meses), y la imposible se
  // rechaza o avisa — nunca se crea corrida al día siguiente.
  it.each([
    "recuérdame el 30/2/2027 comprar pan",
    "remind me 2/30/2027 to buy bread",
    "recuérdame el 31/4/2027 comprar pan",
    "recuérdame el 30 de febrero de 2027 comprar pan",
    "remind me february 30, 2027 to buy bread",
  ])("no se crea corrida y avisa: %s", (t) => {
    expect(extractReminderAction(t, now)).toBeNull();
    expect(reminderInvalidWhen(t, now)).toBe(true);
  });
  it("«el 29 de febrero de 2027» tampoco se crea corrido al 1 de marzo (sin aviso: es el m-18 declarado, fuera del encargo)", () => {
    expect(parseReminderDateTime("el 29 de febrero de 2027", now)).toBeNull();
    // Sin aviso (m-18, declarado fuera del encargo de T-02 e idéntico
    // a la 0.1.98), pero la fecha NO se inventa: el aviso nace sin
    // fecha (dueAt null, se pregunta para cuándo), nunca el 1 de
    // marzo normalizado.
    const r = extractReminderAction("recuérdame el 29 de febrero de 2027 comprar pan", now);
    expect(r?.dueAt).toBeNull();
  });
  it("en calendario: la imposible con año no crea el evento en la fecha corrida", () => {
    const a = extractToolAction("agenda una cita el 30/2/2027 a las 10", now);
    if (a?.kind === "calendarCreate") {
      expect(a.invalidWhen).toBe(true);
      expect(a.start).toBeNull();
    } else {
      expect(a).toBeNull();
    }
  });
});
