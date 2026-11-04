// Calendario (0.1.75): franjas horarias, varios días, fechas imposibles,
// cena de noche. Pares: lo que ya funcionaba sigue igual.
import { describe, expect, it } from "vitest";
import { extractToolAction, runToolAction, type ToolAction } from "./toolRouter";

const NOW = new Date(2026, 10, 4, 10, 0);
const ev = (q: string) => extractToolAction(q, NOW) as Extract<ToolAction, { kind: "calendarCreate" }>;
const hm = (iso?: string | null) => (iso ? [new Date(iso).getMonth() + 1, new Date(iso).getDate(), new Date(iso).getHours(), new Date(iso).getMinutes()] : null);

describe("franja «de 3 a 5»", () => {
  it("es/en/pt: inicio, fin y título limpio", () => {
    const a = ev("agenda una reunión de 3 a 5 mañana");
    expect(a.title).toBe("reunión");
    expect(hm(a.start)).toEqual([11, 5, 15, 0]);
    expect(hm(a.end)).toEqual([11, 5, 17, 0]);
    expect(hm(ev("schedule a meeting from 3 to 5 tomorrow").end)).toEqual([11, 5, 17, 0]);
    expect(hm(ev("marca reunião amanhã das 14 às 16").start)).toEqual([11, 5, 14, 0]);
    expect(hm(ev("agenda una reunión de 10:30 a 12 el lunes").start)).toEqual([11, 9, 10, 30]);
  });
  it("par: «de 2 a 4 personas» no es una franja", () => {
    expect(ev("agenda cena de 2 a 4 personas el sábado a las 9").title).toBe("cena de 2 a 4 personas");
  });
});

describe("varios días", () => {
  it("«del 3 al 5 de diciembre» empieza el 3 y acaba el 5", () => {
    const a = ev("agenda vacaciones del 3 al 5 de diciembre");
    expect(a.title).toBe("vacaciones");
    expect(hm(a.start)?.slice(0, 2)).toEqual([12, 3]);
    expect(hm(a.end)?.slice(0, 2)).toEqual([12, 5]);
  });
});

describe("fecha u hora imposible: no se crea", () => {
  it("«el 31 de febrero a las 10» ya no es hoy a las 10", async () => {
    const a = ev("agenda dentista el 31 de febrero a las 10");
    expect(a.invalidWhen).toBe(true);
    expect(a.start).toBeNull();
    const calls: unknown[] = [];
    const out = await runToolAction(a, { dispatch: async (...x: unknown[]) => { calls.push(x); return { status: "executed" as const, text: "" }; }, isDisabled: () => false });
    expect(calls).toEqual([]);
    expect(out.response).toContain("no he creado el evento");
    expect(ev("agenda una reunión mañana a las 25").invalidWhen).toBe(true);
  });
  it("par: fechas reales", () => {
    expect(ev("agenda el cumpleaños de Ana el 15 de diciembre").invalidWhen).toBeUndefined();
  });
});

describe("cena sin parte del día es de noche", () => {
  it("es/en", () => {
    expect(hm(ev("agenda cena el sábado a las 9").start)).toEqual([11, 7, 21, 0]);
    expect(hm(ev("schedule dinner friday at 8").start)).toEqual([11, 6, 20, 0]);
  });
  it("par: desayuno y «de la mañana» no se mueven", () => {
    expect(hm(ev("agenda desayuno el sábado a las 9").start)).toEqual([11, 7, 9, 0]);
    expect(hm(ev("agenda cena el sábado a las 9 de la mañana").start)).toEqual([11, 7, 9, 0]);
  });
});
