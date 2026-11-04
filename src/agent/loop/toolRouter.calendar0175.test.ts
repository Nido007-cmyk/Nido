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

describe("la semana que viene y el mes (antes caían al modelo)", () => {
  const list = (q: string) => extractToolAction(q, NOW) as Extract<ToolAction, { kind: "calendarList" }>;
  it("es/en/pt: del lunes que viene al siguiente", () => {
    for (const q of ["qué tengo la semana que viene", "what's on my calendar next week", "o que tenho na próxima semana"]) {
      const a = list(q);
      expect(a.kind).toBe("calendarList");
      expect(hm(a.from)?.slice(0, 2)).toEqual([11, 9]);
      expect(hm(a.to)?.slice(0, 2)).toEqual([11, 16]);
    }
  });
  it("este mes y el que viene", () => {
    expect(hm(list("qué tengo en la agenda este mes").to)?.slice(0, 2)).toEqual([12, 1]);
    expect(hm(list("what's on my calendar next month").from)?.slice(0, 2)).toEqual([12, 1]);
  });
  it("«¿tengo algo el sábado?» y «do I have anything on friday»", () => {
    expect(hm(list("tengo algo el sábado?").from)?.slice(0, 2)).toEqual([11, 7]);
    expect(hm(list("do I have anything on friday").from)?.slice(0, 2)).toEqual([11, 6]);
  });
  it("par: «tengo algo que contarte el sábado» no es la agenda", () => {
    expect(extractToolAction("tengo algo que contarte el sábado", NOW)?.kind).not.toBe("calendarList");
  });
});

describe("notas: el artículo no forma parte de lo que se busca (0.1.75)", () => {
  it("«lee la nota de la receta» encuentra «Receta de pan»", async () => {
    const a = extractToolAction("lee la nota de la receta", NOW) as Extract<ToolAction, { kind: "noteRead" }>;
    expect(a.query).toBe("receta");
    const read: string[] = [];
    const out = await runToolAction(a, {
      dispatch: async (_n: string, args: Record<string, unknown>) => { read.push(String(args.id)); return { status: "executed" as const, text: "Receta de pan: harina" }; },
      isDisabled: () => false,
      listNotes: async () => [{ id: "n1", title: "Receta de pan" }],
    } as never);
    expect(read).toEqual(["n1"]);
    expect(out.response).toContain("harina");
  });
});
