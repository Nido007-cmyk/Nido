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
