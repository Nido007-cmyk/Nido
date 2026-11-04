// Temporizadores (0.1.75): fracciones detrás o delante de la unidad, y
// duraciones fuera de rango que antes caían a la charla.
import { describe, expect, it } from "vitest";
import { extractTimerAction, timerOutOfRange } from "./actionRouter";

const min = (q: string) => (extractTimerAction(q)?.durationMs ?? NaN) / 60000;

describe("fracciones", () => {
  it("es/en/pt", () => {
    expect(min("pon un temporizador de 1 hora y media")).toBe(90);
    expect(min("pon un temporizador de una hora y cuarto")).toBe(75);
    expect(min("pon un temporizador de dos minutos y medio")).toBe(2.5);
    expect(min("set a timer for 2 and a half minutes")).toBe(2.5);
    expect(min("set a timer for an hour and a half")).toBe(90);
    expect(min("coloca um temporizador de uma hora e meia")).toBe(90);
  });
  it("par: lo que ya funcionaba sigue igual", () => {
    expect(min("set a timer for half an hour")).toBe(30);
    expect(min("pon un temporizador de media hora")).toBe(30);
    expect(min("set a timer for 1 hour 30 minutes")).toBe(90);
    expect(extractTimerAction("temporizador de 3 minutos para los huevos")).toMatchObject({ label: "los huevos" });
  });
});

describe("fuera de rango: se dice, no se pasa a la charla", () => {
  it("cero, negativo, más de 24 h", () => {
    expect(timerOutOfRange("temporizador de 0 minutos")).toBe("zero");
    expect(timerOutOfRange("pon un temporizador de -5 minutos")).toBe("zero");
    expect(timerOutOfRange("pon un temporizador de 25 horas")).toBe("tooLong");
    expect(timerOutOfRange("set a timer for 100 days")).toBe("tooLong");
    expect(timerOutOfRange("pon un temporizador de 24 horas y media")).toBe("tooLong");
  });
  it("par: válidos y preguntas no", () => {
    expect(timerOutOfRange("pon un temporizador de 10 minutos")).toBeNull();
    expect(timerOutOfRange("¿cuánto dura un temporizador de 25 horas?")).toBeNull();
    expect(min("set a timer for 1 day")).toBe(1440);
  });
});
