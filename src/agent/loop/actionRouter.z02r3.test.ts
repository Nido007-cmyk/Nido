// Tanda T-36 (0.1.99) — regresión de la repetición de Z-02
// ronda 3 (ACTA-z02-r3.md, NO AGUANTA): H-Z4-5-R3. La guarda
// de una edición exigía que la gemela de reloj midiera ≥4, así
// que las palabras de reloj de 3 letras de cada marco («dez»
// y «uma» en PT, «una» y «dos» en ES) nunca eran gemelas
// elegibles: su distorsión a una edición, que ya mide 4,
// caía a las 09:00 en silencio — la forma de H-Z4-5 un anillo
// más adentro que «às onse». Las sondas de T-02, la regresión
// de T-28 y la de T-33 pasan enteras; estos casos son los que
// la repetición midió en rojo, con sus pares de control y el
// freno de falso aviso medido en la rejilla de la tanda.
// now = sábado 14 de noviembre de 2026, 10:00 local (el de las sondas).
import { describe, expect, it } from "vitest";
import {
  extractReminderAction,
  hasImpossibleWhen,
  parseReminderDateTime,
  reminderInvalidWhen,
} from "./actionRouter";

const now = new Date(2026, 10, 14, 10, 0);
const day = (iso: string | null | undefined) => (iso ? new Date(iso) : null);
const ymd = (iso: string | null | undefined) => {
  const d = day(iso);
  return d ? [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()] : null;
};

describe("H-Z4-5-R3 · la gemela de 3 letras también es elegible (la distorsionada mide ≥4)", () => {
  it("caso mínimo: «às dezz» (PT, «dez» distorsionado) no crea a las 09:00 en silencio: avisa", () => {
    expect(extractReminderAction("lembre-me amanhã às dezz de comprar pão", now)).toBeNull();
    expect(reminderInvalidWhen("lembre-me amanhã às dezz de comprar pão", now)).toBe(true);
    expect(hasImpossibleWhen("amanhã às dezz")).toBe(true);
  });
  it("«às umma» (PT, «uma» distorsionada) avisa igual", () => {
    expect(extractReminderAction("lembre-me amanhã às umma de comprar pão", now)).toBeNull();
    expect(reminderInvalidWhen("lembre-me amanhã às umma de comprar pão", now)).toBe(true);
    expect(hasImpossibleWhen("amanhã às umma")).toBe(true);
  });
  it("«a las unna» (ES, «una» distorsionada) avisa igual", () => {
    expect(extractReminderAction("recuérdame mañana a las unna comprar pan", now)).toBeNull();
    expect(reminderInvalidWhen("recuérdame mañana a las unna comprar pan", now)).toBe(true);
    expect(hasImpossibleWhen("mañana a las unna")).toBe(true);
  });
  it("la clase entera: toda distorsión a una edición de una corta, en su marco, avisa", () => {
    // «dos» no tiene vecina larga que la cubra («doss» ya avisaba por «dose»).
    expect(hasImpossibleWhen("mañana a las doos")).toBe(true);
    expect(extractReminderAction("recuérdame mañana a las doos comprar pan", now)).toBeNull();
    // Otra inserción sobre «dez».
    expect(hasImpossibleWhen("amanhã às dezs")).toBe(true);
    expect(extractReminderAction("lembre-me amanhã às dezs de comprar pão", now)).toBeNull();
  });
  it("la plural de la propia palabra de reloj en el slot del marco es intento de hora, no contenido", () => {
    // «a las unas» / «às umas» no son artículo gramatical tras el
    // marco («a las» ya trae el definido): es la palabra de reloj
    // en plural, que el parser no lee — aviso honesto.
    expect(hasImpossibleWhen("mañana a las unas")).toBe(true);
    expect(hasImpossibleWhen("amanhã às umas")).toBe(true);
    expect(extractReminderAction("recuérdame mañana a las unas comprar pan", now)).toBeNull();
    expect(extractReminderAction("lembre-me amanhã às umas de comprar pão", now)).toBeNull();
  });
  it("control: las gemelas de 4 letras siguen avisando («duaz», «tress», «doss»)", () => {
    expect(hasImpossibleWhen("amanhã às duaz")).toBe(true);
    expect(hasImpossibleWhen("mañana a las tress")).toBe(true);
    expect(hasImpossibleWhen("mañana a las doss")).toBe(true);
  });
  it("control sano: la palabra corta bien dicha crea a su hora, sin aviso", () => {
    const dez = extractReminderAction("lembre-me amanhã às dez de comprar pão", now);
    expect(dez?.text).toBe("comprar pão");
    expect(ymd(dez?.dueAt)).toEqual([2026, 10, 15, 10, 0]);
    expect(hasImpossibleWhen("amanhã às dez")).toBe(false);
    const dos = extractReminderAction("recuérdame mañana a las dos comprar pan", now);
    expect(dos?.text).toBe("comprar pan");
    expect(ymd(dos?.dueAt)).toEqual([2026, 10, 15, 14, 0]);
    const una = extractReminderAction("recuérdame mañana a la una comprar pan", now);
    expect(una?.text).toBe("comprar pan");
    expect(ymd(una?.dueAt)).toEqual([2026, 10, 15, 13, 0]);
    const uma = extractReminderAction("lembre-me amanhã à uma de comprar pão", now);
    expect(uma?.text).toBe("comprar pão");
    expect(ymd(uma?.dueAt)).toEqual([2026, 10, 15, 13, 0]);
    expect(ymd(parseReminderDateTime("amanhã às dez", now))).toEqual([2026, 10, 15, 10, 0]);
  });
});

describe("H-Z4-5-R3 · freno: las ordinarias a una edición de la gemela corta no avisan", () => {
  it("los sustantivos ordinarios tras «a la» son contenido («luna», «cuna», «duna», «tuna»)", () => {
    // Viven a una edición de «una» por inserción de la primera
    // letra, como «nueva» de «nueve»: «mirar a la luna» es un
    // destino, no un dictado de la una.
    expect(hasImpossibleWhen("mañana a la luna")).toBe(false);
    expect(hasImpossibleWhen("mañana a la cuna")).toBe(false);
    expect(hasImpossibleWhen("mañana a la duna")).toBe(false);
    expect(hasImpossibleWhen("mañana a la tuna")).toBe(false);
    const luna = extractReminderAction("recuérdame mañana mirar a la luna", now);
    expect(luna?.text).toBe("mirar a la luna");
    expect(reminderInvalidWhen("recuérdame mañana mirar a la luna", now)).toBe(false);
    const cuna = extractReminderAction("recuérdame mañana llevar al bebé a la cuna", now);
    expect(cuna?.text).toBe("llevar al bebé a la cuna");
    expect(reminderInvalidWhen("recuérdame mañana llevar al bebé a la cuna", now)).toBe(false);
  });
  it("la palabra de contenido PT real no es casi-gemela de «uma»: «à soma» no avisa", () => {
    expect(hasImpossibleWhen("amanhã à soma")).toBe(false);
    const r = extractReminderAction("lembre-me amanhã à soma de comprar pão", now);
    expect(r?.text).toBe("à soma de comprar pão");
  });
  it("el freno histórico no se mueve: contenido a distancia segura y ordinarias de T-28", () => {
    expect(hasImpossibleWhen("mañana a las madres")).toBe(false);
    expect(hasImpossibleWhen("mañana a las tantas")).toBe(false);
    expect(hasImpossibleWhen("amanhã às vezes")).toBe(false);
    expect(reminderInvalidWhen("recuérdame mañana presentarme a la nueva jefa", now)).toBe(false);
    expect(hasImpossibleWhen("amanhã à nova")).toBe(false);
  });
});

describe("H-Z4-5-R3 · lo declarado fuera de la doctrina no se mueve", () => {
  it("la distorsionada que mide 3 sigue fuera: «a las dez» no avisa (borde declarado de T-33)", () => {
    expect(hasImpossibleWhen("mañana a las dez")).toBe(false);
    const r = extractReminderAction("recuérdame mañana a las dez comprar pan", now);
    expect(r?.text).toBe("a las dez comprar pan");
    expect(ymd(r?.dueAt)).toEqual([2026, 10, 15, 9, 0]);
  });
  it("a dos ediciones la guarda no avisa: «a las nove» queda como se declaró", () => {
    expect(hasImpossibleWhen("mañana a las nove")).toBe(false);
    expect(hasImpossibleWhen("amanhã às nueve")).toBe(false);
  });
  it("el marco EN «at» sigue sin vigilarse: «at fiev» no avisa", () => {
    expect(hasImpossibleWhen("mañana at fiev")).toBe(false);
  });
});
