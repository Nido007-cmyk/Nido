// Arreglos «todo es todo», segunda tanda (2026-11-03): avisos.
// Pares en cada caso: la forma válida vecina sigue igual.
import { describe, expect, it } from "vitest";
import { extractReminderAction, hasImpossibleWhen, reminderInvalidWhen } from "./actionRouter";

const NOW = new Date(2026, 10, 4, 10, 0, 0);
const at = (q: string) => extractReminderAction(q, NOW);
const local = (iso: string | null) => {
  const d = new Date(iso as string);
  return [d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];
};

describe("hora o fecha imposible: no se guarda un aviso sin hora", () => {
  for (const q of [
    "recuérdame a las 25:00 algo",
    "recuérdame a las 24:00 algo",
    "recuérdame a las 7:75 algo",
    "recuérdame el 31 de febrero pagar",
    "remind me on february 30 to pay",
    "lembre-me dia 31 de abril de pagar",
    "recuérdame el 32 pagar",
  ]) {
    it(q, () => {
      expect(at(q)).toBeNull();
      expect(reminderInvalidWhen(q, NOW)).toBe(true);
    });
  }
  it("par: fechas y horas que sí existen", () => {
    expect(local(at("recuérdame el 29 de febrero pagar")!.dueAt)).toEqual([2, 29, 9, 0]);
    expect(local(at("recuérdame el 30 de abril pagar")!.dueAt)).toEqual([4, 30, 9, 0]);
    expect(local(at("recuérdame a las 23:59 cerrar")!.dueAt)).toEqual([11, 4, 23, 59]);
    expect(hasImpossibleWhen("comprar 25 huevos a las 3")).toBe(false);
    expect(reminderInvalidWhen("recuérdame a las 3 comprar 25 huevos", NOW)).toBe(false);
  });
});

describe("despertador: el título es lo que es", () => {
  it("es/en/pt, también «me acorda» y «acorde-me»", () => {
    expect(at("despiértame a las 7")).toMatchObject({ text: "Despertar" });
    expect(at("despiértame mañana a las 6:30")).toMatchObject({ text: "Despertar" });
    expect(at("wake me up at 6")).toMatchObject({ text: "Wake up" });
    expect(at("me acorda às 7")).toMatchObject({ text: "Acordar" });
    expect(local(at("acorde-me às 6")!.dueAt)).toEqual([11, 5, 6, 0]);
  });
  it("par: con tarea, la tarea manda", () => {
    expect(at("despiértame a las 7 para ir al médico")).toMatchObject({ text: "ir al médico" });
  });
});

describe("pt «dia N de <tarea>» y relativos «dentro de» / «in half an hour»", () => {
  it("dia N", () => {
    expect(at("lembre-me dia 20 de pagar o aluguel")).toMatchObject({ text: "pagar o aluguel" });
    expect(local(at("lembre-me dia 20 de pagar o aluguel")!.dueAt)).toEqual([11, 20, 9, 0]);
    expect(at("lembre-me no dia 3 de ligar")).toMatchObject({ text: "ligar" });
  });
  it("par: «dia 20 de março» sigue siendo fecha con mes", () => {
    const a = at("lembre-me dia 20 de março de pagar")!;
    expect(a.text).toBe("pagar");
    expect(local(a.dueAt)).toEqual([3, 20, 9, 0]);
  });
  it("dentro de / within", () => {
    const a = at("recuérdame dentro de 10 minutos apagar el horno")!;
    expect(a.text).toBe("apagar el horno");
    expect(local(a.dueAt)).toEqual([11, 4, 10, 10]);
    expect(at("remind me within 10 minutes to stir")).toMatchObject({ text: "stir" });
  });
  it("«remind me in half an hour» sin tarea no crea un aviso titulado «in half an hour»", () => {
    expect(at("remind me in half an hour")).toBeNull();
  });
});
