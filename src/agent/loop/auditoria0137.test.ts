/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.37: hallazgos de la auditoría independiente del loop (2026-10-14).
 * Cada bloque reproduce un fallo comprobado y fija el comportamiento bueno.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  beginUserTurn,
  choiceTurnKind,
  extractToolAction,
  notePendingReminderAsk,
  noteEmptyReminderList,
  resetConversationState,
  resolveChoiceReply,
  type PendingChoice,
} from "./toolRouter";

const T0 = new Date(2026, 9, 14, 10, 0);
const DUE = new Date(2026, 9, 19, 9, 0).toISOString();
const soon = (s: number) => new Date(T0.getTime() + s * 1000);

describe("0.1.37 «¿qué te recuerdo?»: solo la respuesta, no cualquier mensaje", () => {
  beforeEach(() => resetConversationState());

  it("una respuesta de verdad sigue creando el recordatorio", () => {
    notePendingReminderAsk(DUE, "es", T0);
    expect(extractToolAction("pagar la luz", soon(20))).toMatchObject({ kind: "reminderFill", text: "pagar la luz", dueAt: DUE });
  });

  it.each([
    "pon un temporizador de 5 minutos",
    "avísame en 10 minutos",
    "recuérdame mañana a las 9 llamar al médico",
    "mejor ponme un recordatorio para el martes",
    "recuerda que mi mamá se llama Marta",
    "mi color favorito es azul",
    "escribe un poema sobre el mar",
    "tell me a joke",
    "cuánto es 2 + 2",
    "sí",
    "ok",
    "espera",
    "gracias",
  ])("«%s» no se toma como el contenido", (s) => {
    notePendingReminderAsk(DUE, "es", T0);
    expect(extractToolAction(s, soon(20))?.kind).not.toBe("reminderFill");
  });

  it.each(["no", "no, gracias", "no quiero nada", "no thanks", "não, obrigado", "nada", "cancela"])(
    "«%s» anula la pregunta",
    (s) => {
      notePendingReminderAsk(DUE, "es", T0);
      expect(extractToolAction(s, soon(10))?.kind).not.toBe("reminderFill");
      // Ya anulada: una respuesta posterior no la revive.
      expect(extractToolAction("pagar la luz", soon(20))?.kind).not.toBe("reminderFill");
    },
  );

  it("«no olvides…» sí es contenido, no una negativa", () => {
    notePendingReminderAsk(DUE, "es", T0);
    expect(extractToolAction("no olvidar el paraguas", soon(10))?.kind).toBe("reminderFill");
  });

  it("solo vale para el turno siguiente", () => {
    beginUserTurn(); // turno en que NIDO pregunta
    notePendingReminderAsk(DUE, "es", T0);
    beginUserTurn(); // siguiente turno: es la respuesta
    expect(extractToolAction("pagar la luz", soon(20))?.kind).toBe("reminderFill");
    beginUserTurn(); // un turno más tarde: ya no
    expect(extractToolAction("pagar la luz", soon(40))?.kind).not.toBe("reminderFill");
  });

  it("«Nuevo chat» (resetConversationState) la olvida", () => {
    notePendingReminderAsk(DUE, "es", T0);
    resetConversationState();
    expect(extractToolAction("llamar al dentista", soon(10))?.kind).not.toBe("reminderFill");
  });

  it("conserva la repetición («cada lunes»)", () => {
    notePendingReminderAsk(DUE, "es", T0, "week");
    expect(extractToolAction("sacar la basura", soon(10))).toMatchObject({ kind: "reminderFill", repeat: "week" });
  });

  it("«Haz uno» tampoco sobrevive a un turno intermedio", () => {
    beginUserTurn();
    noteEmptyReminderList("tomorrow", "es", T0);
    beginUserTurn();
    beginUserTurn();
    expect(extractToolAction("haz uno", soon(30))?.kind).not.toBe("reminderOfferCreate");
  });
});

describe("0.1.37 «¿Cuál?»: una orden nueva no elige ni borra una nota", () => {
  const candidates = [
    { id: "1", label: "receta pan", match: "receta pan" },
    { id: "2", label: "receta pollo", match: "receta pollo" },
    { id: "3", label: "receta sopa", match: "receta sopa" },
    { id: "4", label: "receta tarta", match: "receta tarta" },
  ];
  const pending = (at = T0.getTime()): PendingChoice => ({ action: "noteDelete", candidates, lang: "es", at });

  it.each([
    "pon un temporizador de 2 minutos",
    "recuérdame a las 3 llamar a mamá",
    "recuérdame mañana limpiar el cuarto",
    "me lembra na quarta de pagar a luz",
  ])("«%s» no resuelve la elección", (s) => {
    expect(resolveChoiceReply(s, candidates)).toBeNull();
    expect(choiceTurnKind(s, pending(), soon(10))).toBe("none");
  });

  it("una orden corta («qué hora es») no repite la pregunta", () => {
    expect(choiceTurnKind("qué hora es", pending(), soon(10))).toBe("none");
  });

  it.each([
    ["2", 1],
    ["la segunda", 1],
    ["the first one", 0],
    ["a quarta", 3],
    ["receta sopa", 2],
  ])("«%s» sigue eligiendo", (s, idx) => {
    expect(resolveChoiceReply(s, candidates)).toEqual({ type: "pick", index: idx });
    expect(choiceTurnKind(s, pending(), soon(10))).toBe("resolve");
  });

  it("caduca a los 3 minutos", () => {
    expect(choiceTurnKind("2", pending(), soon(179))).toBe("resolve");
    expect(choiceTurnKind("2", pending(), soon(181))).toBe("none");
  });
});

import { extractCalcAction, extractReminderAction } from "./actionRouter";
import { extractPeople } from "./rememberRouter";
import { classifyIntent } from "./intent";

describe("0.1.37 peticiones creativas y frases citadas no crean recordatorios", () => {
  it.each([
    "crea una historia sobre un dragón",
    "crea un poema sobre el otoño",
    "crea una receta con pollo y arroz",
    "crea una lista de ideas para un cumpleaños",
    "ponme una canción triste",
    "ponme un ejemplo de verbo irregular",
    "escribe una canción que se llame recuérdame siempre",
    "traduce al inglés: recuérdame comprar pan",
    "how do I say remind me to call mom in Spanish",
    "let me know your thoughts on this plan",
    "avísame si llueve mañana",
    "let me know if it rains tomorrow",
  ])("«%s»", (s) => {
    expect(extractReminderAction(s, T0)).toBeNull();
  });

  it.each([
    ["crea un recordatorio para comprar leche mañana", "comprar leche"],
    ["ponme un recordatorio de pagar la luz mañana a las 9", "pagar la luz"],
    ["mañana recuérdame comprar pan", "comprar pan"],
    ["oye, recuérdame llamar a mamá a las 5", "llamar a mamá"],
    ["mejor recuérdame mañana llamar al banco", "llamar al banco"],
  ])("«%s» sigue creando el recordatorio", (s, text) => {
    expect(extractReminderAction(s, T0)?.text).toBe(text);
  });
});

describe("0.1.37 intervalos que NIDO no repite: una vez y aviso", () => {
  it.each([
    "recuérdame tomar la pastilla todos los días cada 8 horas",
    "remind me to take the pill daily every 6 hours",
    "remind me every 2 weeks on mondays to water the plants",
    "recuérdame regar las plantas cada dos días",
    "recuérdame pagar la tarjeta cada quince días",
    "remind me to stretch every other day",
    "remind me to call grandma biweekly",
    "recuérdame fichar de lunes a viernes a las 8",
    "me lembra de tomar o remédio a cada dois dias",
  ])("«%s»", (s) => {
    const a = extractReminderAction(s, T0);
    expect(a?.repeat).toBeUndefined();
    expect(a?.recurrenceRequested).toBe(true);
    expect(a?.text).not.toMatch(/cada|every|biweekly|a cada/i);
  });

  it("los ritmos soportados siguen repitiéndose", () => {
    expect(extractReminderAction("recuérdame tomar agua todos los días a las 6 de la tarde", T0)?.repeat).toBe("day");
    expect(extractReminderAction("remind me each day at 8 to read", T0)?.repeat).toBe("day");
    expect(extractReminderAction("recuérdame cada lunes sacar la basura", T0)?.repeat).toBe("week");
  });
});

describe("0.1.37 nombres, «remember» y fechas", () => {
  it.each([
    ["mi hermana se llama Ana y su cumpleaños es el 3 de mayo", "Ana"],
    ["my sister is called Ana and her birthday is May 3", "Ana"],
    ["minha irmã se chama Ana e o aniversário dela é 3 de maio", "Ana"],
  ])("«%s» → %s", (s, name) => {
    expect(extractPeople(s)[0]?.name).toBe(name);
  });

  it("los nombres compuestos siguen enteros", () => {
    expect(extractPeople("mi prima se llama ana maría")[0]?.name).toMatch(/^Ana Mar[ií]a$/i);
  });

  it.each(["I can't remember the capital of Peru", "do you remember what Titanic is about?"])(
    "«%s» no es una orden de guardar",
    (s) => {
      expect(classifyIntent(s)).not.toBe("recordar");
    },
  );

  it("«remember that…» sigue siendo memoria", () => {
    expect(classifyIntent("remember that my car is blue")).toBe("recordar");
    expect(classifyIntent("please remember my sister's name is Ana")).toBe("recordar");
  });

  it.each(["hoy es 14/10", "today is 10/14", "mañana es 15/10"])("«%s» no es una división", (s) => {
    expect(extractCalcAction(s)).toBeNull();
  });

  it("«cuánto es 14/10» sigue siendo una cuenta", () => {
    expect(extractCalcAction("cuánto es 14/10")).not.toBeNull();
  });
});

import { findRepetitionLoop, trimRepetitionLoop } from "../../inference/repetitionGuard";
import { nextOccurrence } from "../memory/reminderRepeat";

describe("0.1.37 recordatorios mensuales/anuales con días que no existen", () => {
  it("«cada mes el día 31» dicho en noviembre: el 31 de diciembre, no el 1", () => {
    const a = extractReminderAction("recuérdame pagar el alquiler cada mes el día 31", new Date(2026, 10, 5, 10, 0));
    const d = new Date(a!.dueAt!);
    expect(a?.repeat).toBe("month");
    expect([d.getMonth(), d.getDate()]).toEqual([11, 31]);
    // Y la siguiente salta febrero… hasta el próximo mes con 31.
    const n = nextOccurrence(d, "month", d);
    expect([n.getMonth(), n.getDate()]).toEqual([0, 31]);
  });

  it("«cada mes el día 30» dicho en febrero: el 30 de marzo", () => {
    const a = extractReminderAction("recuérdame regar cada mes el día 30", new Date(2027, 1, 10, 10, 0));
    const d = new Date(a!.dueAt!);
    expect([d.getMonth(), d.getDate()]).toEqual([2, 30]);
  });

  it("«cada año el 30 de febrero» no se guarda con la fecha de hoy", () => {
    expect(extractReminderAction("recuérdame cada año el 30 de febrero la fiesta", T0)).toBeNull();
  });
});

describe("0.1.37 el filtro anti-bucles no corta código ni tablas", () => {
  it("un tablero de ceros dentro de un bloque de código", () => {
    const board = "```python\nboard = [\n" + "    [0, 0, 0, 0, 0, 0, 0, 0, 0],\n".repeat(9) + "]\n";
    expect(findRepetitionLoop(board)).toBeNull();
  });
  it("filas de tabla vacías y separadores", () => {
    expect(findRepetitionLoop("| Día | Tarea |\n|---|---|\n" + "|  |  |\n".repeat(10))).toBeNull();
    expect(findRepetitionLoop("Título\n" + "=".repeat(90))).toBeNull();
  });
  it("el bucle real del modelo se sigue cortando", () => {
    const loop = "Los minerales son " + "las aluminosas, ".repeat(12);
    expect(findRepetitionLoop(loop)).not.toBeNull();
    expect(trimRepetitionLoop(loop)).toBe("Los minerales son las aluminosas…");
  });
});

describe("0.1.37 clasificar una tira de signos no es cuadrático", () => {
  it("4000 «?!» en menos de 60 ms", () => {
    const s = "hola" + "?!".repeat(2000) + "a";
    const t0 = performance.now();
    classifyIntent(s);
    expect(performance.now() - t0).toBeLessThan(60);
  });
});
