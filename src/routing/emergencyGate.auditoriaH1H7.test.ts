/**
 * Auditoría 2026-11-25, hallazgos H-1 y H-7.
 *
 * H-1: los sinónimos de caída viva que ninguna ruta reconocía.
 * La misma frase con «se cayó» disparaba y con su paráfrasis
 * no: lo que faltaba era la cola de inmovilidad en presente
 * («no se puede parar», «sin poder levantarse», «can't get
 * back up», «unable to get up», «não consegue ficar de pé»…)
 * leída con su contexto, y la caída contada en su forma nueva
 * («tuvo una caída», «had a fall», «sofreu uma queda»…) como
 * contexto de esa inmovilidad, en la disciplina de siempre:
 * la paráfrasis de caída a secas no declara sola.
 *
 * H-7: la falta de aire antepuesta. Con el sujeto primero
 * («un hombre no puede respirar») la capa disparaba; con el
 * predicado antepuesto, forma natural de alarma en los tres
 * idiomas, caía al modelo: faltaban los signos «sin poder
 * respirar», «unable to breathe» y «sem conseguir respirar».
 */
import { describe, it, expect } from "vitest";
import { deterministicAnswer } from "../eval/blindCore";

type Lang = "es" | "en" | "pt";
function route(t: string, lang: Lang): string {
  return deterministicAnswer({ id: "h1h7", type: "emergencia", lang, expected: "fixed-text", query: t }).route;
}
const modelSide = (t: string, lang: Lang): boolean => {
  const r = route(t, lang);
  return r === "model" || r === "factual-refusal";
};

describe("auditoría 2026-11-25 · H-1: sinónimos de caída viva", () => {
  it("las once frases de la auditoría reciben la situación de emergencia", () => {
    for (const [q, lang] of [
      ["Mi abuelo se fue al suelo en el baño y no se puede parar", "es"],
      ["Mi madre tuvo una caída y quedó sin poder levantarse", "es"],
      ["La abuela se resbaló y no hay manera de que se levante", "es"],
      ["My grandfather took a tumble in the bathroom and can't get back up", "en"],
      ["My uncle is lying on the floor and can't get himself up", "en"],
      ["My mother had a fall and was left unable to get up", "en"],
      ["Grandma slipped and there is no way she can get up", "en"],
      ["Meu avô foi ao chão no banheiro e não consegue ficar de pé", "pt"],
      ["Meu tio está caído no chão e não consegue se erguer", "pt"],
      ["Minha mãe sofreu uma queda e ficou sem conseguir se levantar", "pt"],
      ["A avó escorregou e não há jeito de ela se levantar", "pt"],
    ] as const) {
      expect(route(q, lang), q).toBe("emergency-situation");
    }
  });

  it("la familia de colas de inmovilidad declara con su contexto", () => {
    for (const [q, lang] of [
      ["Mi padre se cayó en la cocina y no se puede parar", "es"],
      ["She fell in the hallway and can't get herself up", "en"],
      ["Ele caiu no banheiro e não consegue se erguer", "pt"],
    ] as const) {
      expect(route(q, lang), q).toBe("emergency-situation");
    }
  });

  it("la paráfrasis de caída a secas, sin inmovilidad, no declara sola", () => {
    for (const [q, lang] of [
      ["El precio tuvo una caída esta semana", "es"],
      ["Grandma slipped on the ice last winter and laughed about it", "en"],
    ] as const) {
      expect(modelSide(q, lang), q).toBe(true);
    }
  });
});

describe("auditoría 2026-11-25 · H-7: falta de aire antepuesta", () => {
  it("las tres frases de la auditoría reciben la situación de emergencia", () => {
    for (const [q, lang] of [
      ["Sin poder respirar está un hombre en la calle", "es"],
      ["Unable to breathe is a man on the street", "en"],
      ["Sem conseguir respirar está um homem na rua", "pt"],
    ] as const) {
      expect(route(q, lang), q).toBe("emergency-situation");
    }
  });

  it("la gemela con el sujeto primero que ya disparaba sigue disparando", () => {
    expect(route("Un hombre no puede respirar en la calle", "es")).toBe("emergency-situation");
  });
});
