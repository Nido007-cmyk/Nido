// Tanda de variantes de la casa, Familia 5 (errata): el estudio
// de la causa como mecanismo. La errata regular (la primera
// vocal de la palabra más larga cae) dejaba fuera de su puerta
// 341 de las 512 variantes de errata del corpus; la reparación
// conservadora (la palabra rota se repone solo si es la forma
// rota de UNA sola palabra del vocabulario de la puerta y no
// es otra palabra) las recupera sin tocar ninguna guarda. Las
// frases de «declara» son formas medidas en falso en el estudio
// previo a la cura, una por puerta e idioma; las guardas son
// palabras cotidianas que se parecen a una forma rota y no
// deben moverse.
import { describe, expect, it } from "vitest";
import { isEmergencySituation, isHealthQuestion } from "./emergencyGate";
import { isSelfHarmMessage, matchSafetyAnswer } from "../agent/loop/safetyAnswers";
import { crisisQuestionKind } from "../rag/packFacts";

describe("variantes F5 · la errata en la puerta de salud", () => {
  it("declara salud con la palabra rota repuesta", () => {
    for (const q of [
      "me duele la cbeza",
      "tengo darrea desde ayer",
      "estou com darreia e febre",
      "minha prssao esta alta",
      "tengo fbre y tos",
    ]) {
      expect(isHealthQuestion(q), q).toBe(true);
    }
  });
});

describe("variantes F5 · la errata en la puerta de emergencia", () => {
  it("declara situación con la palabra rota repuesta", () => {
    for (const q of [
      "hay una persona nconsciente en la calle",
      "esta sngrando mucho",
      "my son is having sizures",
      "ele esta ngasgando",
      "there is a woman nconscious on the street",
    ]) {
      expect(isEmergencySituation(q), q).toBe(true);
    }
  });
});

describe("variantes F5 · la errata en crisis y en monóxido", () => {
  it("declara crisis con la palabra rota repuesta", () => {
    for (const q of ["ya no qiero vivir", "quiero mtarme", "i want to kill myslf", "quero mrrer"]) {
      expect(isSelfHarmMessage(q) || crisisQuestionKind(q), q).toBe(true);
    }
  });
  it("declara monóxido con la palabra rota repuesta", () => {
    expect(matchSafetyAnswer("suena la alarma de mnoxido", "es")?.kind).toBe("co-symptoms");
  });
});

describe("variantes F5 · guardas: la palabra cotidiana parecida no se mueve", () => {
  it("no declara nada que no declarara sin la reparación", () => {
    for (const q of ["dele la carta a su hermano", "la casa esta en la esquina", "quiero cortar el pan"]) {
      expect(isHealthQuestion(q), q).toBe(false);
      expect(isEmergencySituation(q), q).toBe(false);
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
    expect(matchSafetyAnswer("el detector de humo esta pitando", "es")?.kind).not.toBe("co-symptoms");
  });
});
