/**
 * Paridad numérica trilingüe en el móvil (paquete de arreglos,
 * §5): F-PC36 (onze/doze/quinze en las superficies del router),
 * F-PC37 (quinze y veintiuno en la evidencia), F-PC38 (once /
 * eleven / onze en el intervalo), F-PC41 (el «por» del verbo
 * dividir), F-PC42 (verbos pt de cálculo, resta con «from»,
 * «dúzias», «e» de suma), F-PC48 (la lectura de horas del plan
 * semanal), F-PC49 (gatillos del plan) y F-PC51 (el conteo de
 * ejercicio en palabras).
 */
import { describe, expect, it } from "vitest";
import {
  extractCalcAction,
  extractReminderAction,
  extractTimerAction,
  extractWeeklyPlanAction,
} from "./actionRouter.js";
import { quantitiesOf, wordNumberValue } from "../../rag/evidenceNumbers.js";

describe("F-PC41 · el verbo de división gobierna su «por»", () => {
  it("«divide 100 por 4» es 25, no 400", () => {
    expect(extractCalcAction("divide 100 por 4")?.result).toBe(25);
  });
  it("«divide 100 by 4» es 25", () => {
    expect(extractCalcAction("divide 100 by 4")?.result).toBe(25);
  });
  it("guarda: «multiplica 6 por 9» sigue siendo 54", () => {
    expect(extractCalcAction("multiplica 6 por 9")?.result).toBe(54);
  });
});

describe("F-PC42 · la fila portuguesa de cálculo y sus hermanas", () => {
  it("«soma 45 e 67» es 112", () => {
    expect(extractCalcAction("soma 45 e 67")?.result).toBe(112);
  });
  it("«subtrai 25 de 100» es 75", () => {
    expect(extractCalcAction("subtrai 25 de 100")?.result).toBe(75);
  });
  it("«subtract 25 from 100» es 75", () => {
    expect(extractCalcAction("subtract 25 from 100")?.result).toBe(75);
  });
  it("«quanto é 3 dúzias» es 36", () => {
    expect(extractCalcAction("quanto é 3 dúzias")?.result).toBe(36);
  });
});

describe("F-PC36 · onze/doze/quinze en las superficies del router", () => {
  it("temporizador de «doze minutos» en pt", () => {
    expect(extractTimerAction("pon un temporizador de doze minutos")?.durationMs).toBe(12 * 60_000);
  });
  it("temporizador de «onze minutos» en pt", () => {
    expect(extractTimerAction("pon un temporizador de onze minutos")?.durationMs).toBe(11 * 60_000);
  });
  it("recordatorio relativo «en quinze minutos»", () => {
    const before = Date.now();
    const r = extractReminderAction("recuérdame en quinze minutos comprar pan");
    expect(r).not.toBeNull();
    const due = new Date(r!.dueAt as unknown as string).getTime();
    expect(due).toBeGreaterThanOrEqual(before + 14 * 60_000);
    expect(due).toBeLessThan(before + 16 * 60_000);
  });
});

describe("F-PC38 · once/eleven/onze detectan el intervalo no soportado", () => {
  it("«cada once horas» se avisa, no se crea en silencio", () => {
    const r = extractReminderAction("recuérdame cada once horas tomar la pastilla");
    expect(r?.recurrenceRequested).toBe(true);
  });
  it("«every eleven hours» se avisa", () => {
    const r = extractReminderAction("remind me every eleven hours to take the pill");
    expect(r?.recurrenceRequested).toBe(true);
  });
  it("«a cada onze horas» se avisa", () => {
    const r = extractReminderAction("me lembra a cada onze horas de tomar o remédio");
    expect(r?.recurrenceRequested).toBe(true);
  });
  it("«cada doze horas» se avisa (F-PC36 en la misma cadena)", () => {
    const r = extractReminderAction("me lembra a cada doze horas de tomar o remédio");
    expect(r?.recurrenceRequested).toBe(true);
  });
});

describe("F-PC37 · quinze y veintiuno en la evidencia numérica", () => {
  it("wordNumberValue cobra «quinze» y «veintiuno»", () => {
    expect(wordNumberValue("quinze")).toBe(15);
    expect(wordNumberValue("veintiuno")).toBe(21);
  });
  it("las cantidades con marco de unidad cobran «quinze» y «quinze mil»", () => {
    expect(quantitiesOf("quinze miligramas").some((q) => q.canon === 15)).toBe(true);
    expect(quantitiesOf("quinze mil miligramas").some((q) => q.canon === 15000)).toBe(true);
  });
});

describe("F-PC48 · la lectura de horas del plan semanal", () => {
  it("«work 13 to 21» se mantiene en 24 h", () => {
    const p = extractWeeklyPlanAction("plan my week, work 13 to 21");
    expect(p?.workStart).toBe(13);
    expect(p?.workEnd).toBe(21);
  });
  it("«trabajo de 22 a 6» cruza medianoche y se sirve como se parseó", () => {
    const p = extractWeeklyPlanAction("planifica mi semana, trabajo de 22 a 6");
    expect(p?.workStart).toBe(22);
    expect(p?.workEnd).toBe(6);
  });
  it("«trabajo de 25 a 9» es null honesto, nunca la plantilla 9–18 en silencio", () => {
    expect(extractWeeklyPlanAction("planifica mi semana, trabajo de 25 a 9")).toBeNull();
  });
  it("guarda: «work 9 to 6» sigue siendo 9–18", () => {
    const p = extractWeeklyPlanAction("plan my week, work 9 to 6");
    expect(p?.workStart).toBe(9);
    expect(p?.workEnd).toBe(18);
  });
});

describe("F-PC49 · los gatillos del plan semanal", () => {
  it("«plan the week» dispara", () => {
    expect(extractWeeklyPlanAction("plan the week")).not.toBeNull();
  });
  it("«organize my week» dispara", () => {
    expect(extractWeeklyPlanAction("organize my week")).not.toBeNull();
  });
  it("«faz um plano para a minha semana» dispara", () => {
    expect(extractWeeklyPlanAction("faz um plano para a minha semana")).not.toBeNull();
  });
});

describe("F-PC51 · el conteo de ejercicio en palabras", () => {
  it("«ejercicio tres veces» da 3", () => {
    expect(extractWeeklyPlanAction("planifica mi semana, ejercicio tres veces")?.exerciseDays).toBe(3);
  });
  it("«exercise two times» da 2", () => {
    expect(extractWeeklyPlanAction("plan my week, exercise two times")?.exerciseDays).toBe(2);
  });
  it("«exercício três vezes» da 3", () => {
    expect(extractWeeklyPlanAction("faz um plano semanal, exercício três vezes")?.exerciseDays).toBe(3);
  });
  it("guarda: el dígito sigue mandando («ejercicio 5 veces» da 5)", () => {
    expect(extractWeeklyPlanAction("planifica mi semana, ejercicio 5 veces")?.exerciseDays).toBe(5);
  });
});
