// Tanda T-38 (0.1.99) — regresión de la repetición de Z-02
// ronda 4 (ACTA-z02-r4.md, NO AGUANTA): H-Z4-5-R4, la dirección
// contraria a R3. La exención de ordinarias de T-36 medía solo
// las inserciones de primera letra con c/d/l/t («cuna», «duna»,
// «luna», «tuna»); el vecindario realista de una edición de
// «una» tras «a la» es {cuna, duna, luna, tuna, puna, urna}:
// «puna» es la misma inserción con otra letra y «urna» es
// inserción en el medio, la forma que la rejilla de T-36 no
// midió. Ambas avisaban en falso y bloqueaban recordatorios
// legítimos. La tanda re-midió el vecindario entero de una
// edición de las 28 palabras de reloj de ambos marcos
// (CLASIFICACION-vecindario.md en el área de la tanda): la
// membresía real de la clase suma «seta» y «sede» (de «sete»),
// «nieve» (de «nueve»), «leis» (de «seis») y «dunas» y «ruas»
// (de «duas»). La cerca no se mueve: la palabra real que la
// rejilla sistemática genera como distorsión sigue avisando
// («nave», «neve», como «cuarto» desde R4), y lo declarado
// (suelo de la dictada ≥4, dos ediciones, «at» sin vigilar,
// distancia 2 entre idiomas) queda como estaba.
// now = sábado 14 de noviembre de 2026, 10:00 local (el de las sondas).
import { describe, expect, it } from "vitest";
import {
  extractReminderAction,
  hasImpossibleWhen,
  reminderInvalidWhen,
} from "./actionRouter";

const now = new Date(2026, 10, 14, 10, 0);
const day = (iso: string | null | undefined) => (iso ? new Date(iso) : null);
const ymd = (iso: string | null | undefined) => {
  const d = day(iso);
  return d ? [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()] : null;
};

describe("H-Z4-5-R4 · el caso del acta: «urna» y «puna» son contenido, no dictado de la una", () => {
  it("caso mínimo: «ir a la urna a votar» no avisa y crea", () => {
    expect(hasImpossibleWhen("mañana a la urna")).toBe(false);
    const r = extractReminderAction("recuérdame mañana ir a la urna a votar", now);
    expect(r?.text).toBe("ir a la urna a votar");
    expect(ymd(r?.dueAt)).toEqual([2026, 10, 15, 9, 0]);
    expect(reminderInvalidWhen("recuérdame mañana ir a la urna a votar", now)).toBe(false);
  });
  it("«viajar a la puna» no avisa y crea (inserción de primera letra con «p»)", () => {
    expect(hasImpossibleWhen("mañana a la puna")).toBe(false);
    const r = extractReminderAction("recuérdame mañana viajar a la puna", now);
    expect(r?.text).toBe("viajar a la puna");
    expect(reminderInvalidWhen("recuérdame mañana viajar a la puna", now)).toBe(false);
  });
  it("alcance secundario del acta: PT «às seta» no avisa y crea", () => {
    expect(hasImpossibleWhen("amanhã às seta")).toBe(false);
    const r = extractReminderAction("lembre-me amanhã às seta de comprar pão", now);
    expect(r?.text).toBe("às seta de comprar pão");
    expect(reminderInvalidWhen("lembre-me amanhã às seta de comprar pão", now)).toBe(false);
  });
});

describe("H-Z4-5-R4 · la clase entera re-medida en ambos marcos (vecindario completo de una edición)", () => {
  it("PT: «ir à sede» es contenido (sustantivo ordinario a una edición de «sete»)", () => {
    expect(hasImpossibleWhen("amanhã à sede")).toBe(false);
    const r = extractReminderAction("lembre-me amanhã ir à sede da empresa", now);
    expect(r?.text).toBe("ir à sede da empresa");
    expect(reminderInvalidWhen("lembre-me amanhã ir à sede da empresa", now)).toBe(false);
  });
  it("ES: «ir a la nieve» es contenido (a una edición de «nueve», fuera del repertorio de la rejilla)", () => {
    expect(hasImpossibleWhen("mañana a la nieve")).toBe(false);
    const r = extractReminderAction("recuérdame mañana ir a la nieve", now);
    expect(r?.text).toBe("ir a la nieve");
    expect(reminderInvalidWhen("recuérdame mañana ir a la nieve", now)).toBe(false);
  });
  it("PT: «obedecer às leis» es contenido (a una edición de «seis»)", () => {
    expect(hasImpossibleWhen("amanhã às leis")).toBe(false);
    const r = extractReminderAction("lembre-me amanhã obedecer às leis de trânsito", now);
    expect(r?.text).toBe("obedecer às leis de trânsito");
    expect(reminderInvalidWhen("lembre-me amanhã obedecer às leis de trânsito", now)).toBe(false);
  });
  it("PT: «ir às dunas» e «ir às ruas» son destinos (a una edición de «duas»)", () => {
    expect(hasImpossibleWhen("amanhã às dunas")).toBe(false);
    expect(extractReminderAction("lembre-me amanhã ir às dunas", now)?.text).toBe("ir às dunas");
    expect(hasImpossibleWhen("amanhã às ruas")).toBe(false);
    expect(extractReminderAction("lembre-me amanhã ir às ruas", now)?.text).toBe("ir às ruas");
  });
  it("controles que ya pasaban: la clase de T-36 y las formas a distancia segura no se mueven", () => {
    for (const [frase, rec, texto] of [
      ["mañana a la cuna", "recuérdame mañana llevar al bebé a la cuna", "llevar al bebé a la cuna"],
      ["mañana a la duna", "recuérdame mañana subir a la duna", "subir a la duna"],
      ["mañana a la luna", "recuérdame mañana mirar a la luna", "mirar a la luna"],
      ["mañana a la tuna", "recuérdame mañana ir a ver a la tuna", "ir a ver a la tuna"],
      ["mañana a las urnas", "recuérdame mañana ir a las urnas a votar", "ir a las urnas a votar"],
      ["mañana a la seta", "recuérdame mañana ir a la seta con Ana", "ir a la seta con Ana"],
      ["mañana a la sede", "recuérdame mañana ir a la sede de la empresa", "ir a la sede de la empresa"],
    ] as const) {
      expect(hasImpossibleWhen(frase), frase).toBe(false);
      expect(extractReminderAction(rec, now)?.text, rec).toBe(texto);
    }
    for (const frase of ["amanhã à soma", "amanhã à nova", "amanhã às doces", "amanhã às setas", "amanhã à urna"]) {
      expect(hasImpossibleWhen(frase), frase).toBe(false);
    }
    expect(extractReminderAction("lembre-me amanhã ir à urna votar", now)?.text).toBe("ir à urna votar");
  });
});

describe("H-Z4-5-R4 · el freno: la rejilla sistemática y las asentadas siguen avisando", () => {
  it("ES: las distorsiones sistemáticas de la rejilla avisan (duplicación, borrado, sustitución, transposición)", () => {
    for (const w of ["diezz", "cuato", "cinca", "seiss", "docee", "trez", "diéz", "cuarto", "cuatros"]) {
      expect(hasImpossibleWhen(`mañana a las ${w}`), w).toBe(true);
      expect(extractReminderAction(`recuérdame mañana a las ${w} comprar pan`, now), w).toBeNull();
    }
  });
  it("PT: las mismas formas sobre el conjunto PT avisan", () => {
    for (const w of ["setee", "oitoo", "novee", "onzee", "dozee", "trêz", "daus", "otio", "séte"]) {
      expect(hasImpossibleWhen(`amanhã às ${w}`), w).toBe(true);
      expect(extractReminderAction(`lembre-me amanhã às ${w} de comprar pão`, now), w).toBeNull();
    }
  });
  it("la palabra real que la rejilla genera como distorsión queda en el lado de la cerca: «nave» y «neve» avisan", () => {
    // «nave» es sust-vocal de «nove» en la rejilla y «neve» es
    // borra-media de «nueve» y sust-vocal de «nove»: la rejilla
    // es la cerca (el precedente es «cuarto», palabra real que
    // avisa desde R4). La nieve española, «nieve», no la genera
    // la rejilla y sí es contenido (describe de la clase).
    expect(hasImpossibleWhen("amanhã à nave")).toBe(true);
    expect(extractReminderAction("lembre-me amanhã às nave de comprar pão", now)).toBeNull();
    expect(hasImpossibleWhen("mañana a las neve")).toBe(true);
    expect(hasImpossibleWhen("amanhã às neve")).toBe(true);
  });
  it("las asentadas de las rondas avisan: la plural de la palabra de reloj, la verbal, la de marco cruzado", () => {
    expect(hasImpossibleWhen("mañana a las unas")).toBe(true);
    expect(hasImpossibleWhen("amanhã às umas")).toBe(true);
    expect(hasImpossibleWhen("amanhã à suma")).toBe(true);
    expect(hasImpossibleWhen("mañana a las funa")).toBe(true);
    expect(hasImpossibleWhen("mañana a las tras")).toBe(true);
    expect(hasImpossibleWhen("mañana a las tren")).toBe(true);
    expect(hasImpossibleWhen("amanhã às dose")).toBe(true);
    expect(hasImpossibleWhen("mañana a las dios")).toBe(true);
    expect(hasImpossibleWhen("amanhã às dias")).toBe(true);
    expect(hasImpossibleWhen("mañana a las mueve")).toBe(true);
    expect(hasImpossibleWhen("amanhã às nome")).toBe(true);
  });
  it("la frontera deliberada de la clasificación avisa: palabra real sin frase de contenido tras el marco", () => {
    // «dote» y «pose» son palabras reales, pero «a la dote» y
    // «a la pose» no son frases de contenido de un recordatorio;
    // «luas» no es destino («ir às luas») y «suas» es determinante
    // (la cabeza es el nombre que sigue, como «umas»).
    expect(hasImpossibleWhen("mañana a la dote")).toBe(true);
    expect(hasImpossibleWhen("mañana a la pose")).toBe(true);
    expect(hasImpossibleWhen("amanhã às luas")).toBe(true);
    expect(hasImpossibleWhen("amanhã às suas")).toBe(true);
  });
});

describe("H-Z4-5-R4 · lo declarado y las rondas anteriores no se mueven", () => {
  it("R3 sigue curado: la distorsión de la gemela corta avisa («às dezz», «às umma», «a las unna»)", () => {
    expect(hasImpossibleWhen("amanhã às dezz")).toBe(true);
    expect(extractReminderAction("lembre-me amanhã às dezz de comprar pão", now)).toBeNull();
    expect(hasImpossibleWhen("amanhã às umma")).toBe(true);
    expect(hasImpossibleWhen("mañana a las unna")).toBe(true);
  });
  it("R2 sigue curado: «às onse» avisa y «a las onse» crea a las 11:00", () => {
    expect(hasImpossibleWhen("amanhã às onse")).toBe(true);
    expect(extractReminderAction("lembre-me amanhã às onse de comprar pão", now)).toBeNull();
    const r = extractReminderAction("recuérdame mañana a las onse comprar pan", now);
    expect(r?.text).toBe("comprar pan");
    expect(ymd(r?.dueAt)).toEqual([2026, 10, 15, 11, 0]);
    expect(hasImpossibleWhen("mañana a las onse")).toBe(false);
  });
  it("el suelo de la dictada (mide 3) sigue fuera: «a las dez» no avisa y crea a las 09:00", () => {
    expect(hasImpossibleWhen("mañana a las dez")).toBe(false);
    const r = extractReminderAction("recuérdame mañana a las dez comprar pan", now);
    expect(r?.text).toBe("a las dez comprar pan");
    expect(ymd(r?.dueAt)).toEqual([2026, 10, 15, 9, 0]);
  });
  it("a dos ediciones la guarda no avisa, y la distorsión PT tras marco ES queda a distancia 2", () => {
    expect(hasImpossibleWhen("mañana a las nove")).toBe(false);
    expect(hasImpossibleWhen("amanhã às nueve")).toBe(false);
    expect(hasImpossibleWhen("mañana a las dezz")).toBe(false);
    expect(extractReminderAction("recuérdame mañana a las dezz comprar pan", now)?.text).toBe("a las dezz comprar pan");
  });
  it("el marco EN «at» sigue sin vigilarse: «at fiev» no avisa", () => {
    expect(hasImpossibleWhen("mañana at fiev")).toBe(false);
  });
});
