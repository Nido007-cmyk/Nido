/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.99 · Tanda T-31 (residuos de la repetición de Z-01,
 * ACTA-z01-r2 §5): la cura de T-27 aguantó en su centro, pero la
 * repetición entera encontró la misma clase viva en las
 * fronteras de su forma concreta. Esta regresión fija las dos
 * direcciones del freno para esos residuos:
 *
 * - H-Z4-1-R1: el artículo «unas» silenciaba verdaderos con
 *   instrumento («quiero cortarme con unas tijeras» no
 *   disparaba: «unas» es artículo y «uñas» plegado, y vetaba
 *   como objeto). El sintagma de instrumento es un adjunto y ya
 *   no decide el veto, en las cinco formas de la familia y en
 *   dictado pegado.
 * - H-Z4-1-R2: la conjunción escondía el objeto de daño («las
 *   uñas y las venas» no disparaba). Se leen todos los objetos
 *   coordinados: una cabeza de daño en cualquiera manda.
 * - H-Z4-1-R3: «uñas» + complemento volvía a disparar («las
 *   uñas de los pies», «unas uñas postizas»): el pelado de
 *   determinantes se lo comía como artículo. El token ambiguo
 *   no se pela; como cabeza es el objeto.
 * - Las decisiones que el acta asentó sin enumerar: la ropa
 *   (mangas, pantalón, camisa) es clase cotidiana y no dispara;
 *   «la barbilla» es un lugar del cuerpo, como «el mentón», y
 *   dispara (dejó de vetarse por la raíz «barb-» de la barba).
 * - H-Z4-2-R1: «qual é o número que ligo em Portugal?» devolvía
 *   null (la rama PT no admitía el «é», gemela de la «es el»
 *   que T-27 sí admitió en ES). Entran el «é», el relativo con
 *   modal («que devo ligar») y el «para ligar», medidos en null
 *   antes de tocar; por simetría declarada, las gemelas ES
 *   («que debo llamar», «para llamar»), medidas en el mismo
 *   null. La puerta no se mueve: «número de telefone …» sigue
 *   null aunque traiga el «para ligar» detrás.
 */
import { describe, expect, it } from "vitest";
import { isSelfHarmMessage, matchSafetyAnswer } from "./safetyAnswers";

describe("H-Z4-1-R1 · el instrumento con «unas» no silencia un verdadero", () => {
  it("los casos del acta: el adjunto no veta, en las formas de la familia", () => {
    for (const q of [
      "quiero cortarme con unas tijeras",
      "quiero cortarme con unas tijeras las venas",
      "quiero cortarme usando unas tijeras",
      "quiero cortarme con unas pinzas",
      "voy a cortarme con unas tijeras",
      "tengo ganas de cortarme con unas tijeras",
      "me quiero cortar con unas tijeras",
      "pienso en cortarme con unas tijeras",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("dictado pegado: el adjunto tampoco veta sin espacios", () => {
    expect(isSelfHarmMessage("quierocortarmeconunastijeras")).toBe(true);
  });

  it("la frontera medida del acta se queda donde estaba", () => {
    for (const q of [
      "quiero cortarme con las tijeras",
      "quiero cortarme con una tijera",
      "quiero cortarme con un par de tijeras",
      "quiero cortarme con un cuchillo",
      "quero me cortar com uma tesoura",
      "quiero cortarme las venas con unas tijeras",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("el inocente con instrumento sigue sin disparar: el objeto manda", () => {
    for (const q of [
      "quiero cortarme el pelo con unas tijeras",
      "quiero cortarme las uñas con unas tijeras",
      "quiero cortarme con unas tijeras el pelo",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });
});

describe("H-Z4-1-R2 · la conjunción no esconde el objeto de daño", () => {
  it("un lugar de daño en el segundo objeto coordinado manda", () => {
    for (const q of [
      "quiero cortarme las uñas y las venas",
      "quiero cortarme el pelo y las venas",
      "quiero cortarme las cutículas y las venas",
      "quiero cortarme las venas y las uñas",
      "quiero cortarme las venas, no el pelo",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("dos objetos cotidianos coordinados siguen sin disparar", () => {
    for (const q of [
      "quiero cortarme el pelo y las uñas",
      "quiero cortarme las uñas y el flequillo",
      "quero me cortar as unhas e o cabelo",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });
});

describe("H-Z4-1-R3 · «uñas» con complemento no vuelve a disparar", () => {
  it("el inocente canónico de la clase, con algo detrás", () => {
    for (const q of [
      "quiero cortarme las uñas de los pies",
      "quiero cortarme las uñas de las manos",
      "quiero cortarme unas uñas postizas",
      "quiero cortarme las uñas",
      "quero me cortar as unhas dos pés",
      "quierocortarmelasunasdelospies",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });

  it("y «uñas» como artículo cede ante una cabeza reconocida", () => {
    expect(isSelfHarmMessage("quiero cortarme unas venas")).toBe(true);
    expect(isSelfHarmMessage("quiero cortarme unas pestañas")).toBe(false);
  });
});

describe("H-Z4-1 · las decisiones del acta: ropa y barbilla", () => {
  it("la ropa es clase cotidiana: no dispara", () => {
    for (const q of [
      "quiero cortarme las mangas",
      "quiero cortarme el pantalón",
      "quiero cortarme la camisa",
      "quiero cortarme el vestido",
      "quero me cortar as mangas",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });

  it("la barbilla es un lugar del cuerpo, como el mentón: dispara", () => {
    expect(isSelfHarmMessage("quiero cortarme la barbilla")).toBe(true);
    expect(isSelfHarmMessage("quiero cortarme el mentón")).toBe(true);
    expect(isSelfHarmMessage("quiero cortarme la barba")).toBe(false);
  });
});

describe("H-Z4-2-R1 · la forma PT con «é», el modal y el «para ligar»", () => {
  it("el caso del acta, palabra por palabra: «qual é o número que ligo»", () => {
    const h = matchSafetyAnswer("qual é o número que ligo em Portugal?", "pt")!;
    expect(h.kind).toBe("emergency-number");
    expect(h.country).toBe("Portugal");
    expect(h.text).toMatch(/112/);
  });

  it("las formas medidas en null: modal y «para» en PT, con sus gemelas ES", () => {
    expect(matchSafetyAnswer("qual o número que devo ligar em Portugal?", "pt")?.country).toBe("Portugal");
    expect(matchSafetyAnswer("qual o número que eu devo ligar em Portugal?", "pt")?.country).toBe("Portugal");
    expect(matchSafetyAnswer("qual o número que devo discar em Portugal?", "pt")?.country).toBe("Portugal");
    expect(matchSafetyAnswer("qual o número para ligar em Portugal?", "pt")?.country).toBe("Portugal");
    expect(matchSafetyAnswer("qual é o número para ligar em Portugal?", "pt")?.country).toBe("Portugal");
    expect(matchSafetyAnswer("¿cuál es el número que debo llamar en España?", "es")?.country).toBe("Spain");
    expect(matchSafetyAnswer("¿qué número debo llamar en España?", "es")?.country).toBe("Spain");
    expect(matchSafetyAnswer("¿cuál es el número para llamar en España?", "es")?.country).toBe("Spain");
  });

  it("la puerta no se mueve: «de telefone» sigue null, traiga o no el «para»", () => {
    expect(matchSafetyAnswer("qual o número de telefone da farmácia?", "pt")).toBeNull();
    expect(matchSafetyAnswer("qual o número de telefone para ligar em Portugal?", "pt")).toBeNull();
    expect(matchSafetyAnswer("¿qué número de teléfono tiene la farmacia?", "es")).toBeNull();
  });
});
