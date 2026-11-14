/**
 * T-19 (0.1.99, núcleo del juez): las piernas léxicas V5b y V6.
 *
 * V5b — la cifra fiel lavada en un rol ajeno: la frase ata una cifra a
 * un rol («3000 mg por toma», «28 psi nos pneus da frente») y ese par
 * (cifra, rol) no existe en la evidencia, aunque la cifra suelta y el
 * rol emparejado con otra cifra sí. El emparejado es POR ORDEN dentro
 * de la frase: cada palabra de rol se ata a la cifra que la precede
 * (la forma medida en el diseño; la forma cartesiana, V5a, rompía los
 * conserva matriz-b-011 y matriz-b-114 y está muerta).
 *
 * V6 — la red léxica de la polisemia con el listón rebajado (rel ≥ 2,
 * margen 1): la frase se apoya sobre todo en un chunk que no es de los
 * relevantes para la pregunta y ningún chunk relevante la apoya ni a
 * medias. Es la red de polisemia-114 cuando la semántica no está.
 */
import { describe, expect, it } from "vitest";
import {
  VALUE_ROLE_FORMS,
  contentStems,
  valueRoleConflict,
  valueRolePairs,
  verifyGroundedAnswer,
  type GroundingChunk,
} from "./grounding";
import { evidenceNumberValues } from "./evidenceNumbers";

// ------------------------------------------------------------ tabla de roles

/**
 * La raíz que el stemmer de producción produce para cada forma de la
 * tabla, fijada a mano: si el stemmer cambia y una forma deja de
 * producir su raíz (entrada muerta), este test cae en vez de dejar la
 * pierna coja en silencio — es el fallo que invalidaba el borrador
 * cartesiano del diseño.
 */
const STEM_FIJADO: Record<string, string> = {
  frente: "frente",
  delantera: "delante",
  delantero: "delante",
  front: "front",
  dianteira: "diantei",
  dianteiro: "diantei",
  trasera: "trasera",
  trasero: "trasero",
  "detrás": "detra",
  "atrás": "atra",
  rear: "rear",
  traseira: "traseir",
  traseiro: "traseir",
  izquierda: "izquier",
  izquierdo: "izquier",
  left: "left",
  esquerda: "esquerd",
  esquerdo: "esquerd",
  derecha: "derecha",
  derecho: "derecho",
  right: "right",
  direita: "direita",
  direito: "direito",
  toma: "toma",
  dose: "dose",
  "día": "dia",
  dia: "dia",
  day: "day",
  primera: "primera",
  primero: "primero",
  primer: "primer",
  first: "first",
  primeira: "primeir",
  primeiro: "primeir",
  "última": "ultima",
  "último": "ultimo",
  ultima: "ultima",
  ultimo: "ultimo",
  last: "last",
};

describe("T-19 V5b · tabla de roles contra el stemmer de producción", () => {
  it("cada forma de la tabla produce exactamente su raíz fijada", () => {
    for (const [form] of VALUE_ROLE_FORMS) {
      expect(STEM_FIJADO[form], `falta el pin de la forma`).toBeDefined();
      expect(contentStems(form), `stem de la forma`).toEqual([STEM_FIJADO[form]]);
    }
    expect(Object.keys(STEM_FIJADO).length).toBe(VALUE_ROLE_FORMS.length);
  });

  it("cada forma de la tabla está viva en el paseo: «7 <forma>» empareja (7, su rol)", () => {
    for (const [form, role] of VALUE_ROLE_FORMS) {
      expect(valueRolePairs(`Son 7 ${form}.`), `forma viva`).toContain(`7|${role}`);
    }
  });
});

// ------------------------------------------------------------ valueRolePairs

describe("T-19 V5b · valueRolePairs (emparejado por la cifra precedente)", () => {
  it("la cifra manda sobre los roles que la siguen, y una segunda cifra reparte los suyos", () => {
    const pairs = valueRolePairs(
      "La dosis es de 500 mg por toma y el tope es de 3000 mg al día.",
    );
    expect(pairs).toEqual(new Set(["500|perdose", "3000|perday"]));
  });

  it("un rol sin cifra precedente en su frase no empareja", () => {
    expect(valueRolePairs("La toma es de 500 mg.")).toEqual(new Set());
  });

  it("el emparejado no cruza de frase: la cifra de la anterior no ata el rol de la siguiente", () => {
    expect(valueRolePairs("Son 500 mg. La toma es diaria.")).toEqual(new Set());
  });

  it("la guía de presión empareja la cifra de la delantera con su lado", () => {
    const pairs = valueRolePairs(
      "A pressão recomendada para este carro é de 32 psi nos pneus da frente e de 28 psi nos pneus de trás.",
    );
    expect(pairs.has("32|front")).toBe(true);
  });
});

// ------------------------------------------------------------ valueRoleConflict

/** Los conjuntos fuente tal como los construye verifyGroundedAnswer. */
function conjuntosFuente(sentences: string[]) {
  const pairs = new Set<string>();
  for (const s of sentences) for (const p of valueRolePairs(s)) pairs.add(p);
  const roles = new Set<string>();
  for (const key of pairs) roles.add(key.slice(key.lastIndexOf("|") + 1));
  return { pairs, roles, numbers: evidenceNumberValues(sentences) };
}

const GUIA_012 =
  "The usual dose of paracetamol for an adult is 500 mg per dose, every 6 hours. " +
  "Do not exceed 3000 mg in 24 hours and never give paracetamol to a baby without asking a doctor.";

describe("T-19 V5b · valueRoleConflict", () => {
  const src = conjuntosFuente([GUIA_012]);

  it("dispara con la cifra del tope lavada a por-toma (el fixture de matriz-a-012)", () => {
    expect(
      valueRoleConflict(
        "La dosis habitual de paracetamol para un adulto es de 3000 mg por toma, cada 6 horas.",
        src.pairs,
        src.roles,
        src.numbers,
      ),
    ).toBe(true);
  });

  it("conserva el par fiel (500, perdose)", () => {
    expect(
      valueRoleConflict(
        "La dosis habitual de paracetamol para un adulto es de 500 mg por toma, cada 6 horas.",
        src.pairs,
        src.roles,
        src.numbers,
      ),
    ).toBe(false);
  });

  it("conserva la frase fiel con la cifra y sin rol (el tope en 24 horas)", () => {
    expect(
      valueRoleConflict("No excedas 3000 mg en 24 horas.", src.pairs, src.roles, src.numbers),
    ).toBe(false);
  });

  it("una cifra ausente de las fuentes no dispara (eso es terreno de otras puertas)", () => {
    expect(
      valueRoleConflict(
        "La dosis habitual es de 4000 mg por toma, cada 6 horas.",
        src.pairs,
        src.roles,
        src.numbers,
      ),
    ).toBe(false);
  });

  it("dispara con el rol cruzado de la guía de presión (el fixture de matriz-a-297) y conserva el fiel", () => {
    const presion = conjuntosFuente([
      "The recommended pressure for this car is 32 psi in the front tyres and 28 psi in the rear tyres.",
    ]);
    expect(
      valueRoleConflict(
        "A pressão recomendada para este carro é de 28 psi nos pneus da frente.",
        presion.pairs,
        presion.roles,
        presion.numbers,
      ),
    ).toBe(true);
    expect(
      valueRoleConflict(
        "A pressão recomendada para este carro é de 32 psi nos pneus da frente.",
        presion.pairs,
        presion.roles,
        presion.numbers,
      ),
    ).toBe(false);
  });
});

// ------------------------------------------------------------ V6 (integración)

describe("T-19 V6 · relevancia léxica rebajada (integración)", () => {
  const guiaBarco: GroundingChunk = {
    title: "Navegación",
    body: "La vela del barco se mueve con el viento y la marea.",
  };
  const guiaCera: GroundingChunk = {
    title: "Iluminación",
    body: "La vela de cera alumbra la mesa y se derrite con la llama.",
  };
  const Q_VELA = "¿Iza la vela del barco?";
  const FRASE_CERA = "La vela de cera se derrite con la llama y alumbra la mesa.";

  it("relevancia 2/1 y apoyos 1,0/<0,5: la frase del sentido competidor se retira", () => {
    const r = verifyGroundedAnswer(FRASE_CERA, [guiaBarco, guiaCera], "es", Q_VELA);
    expect(r.removed).toBe(1);
    expect(r.text).not.toContain("se derrite con la llama");
  });

  it("relevancia 2/2: la misma frase se conserva (el mejor chunk también es relevante)", () => {
    const guiaCeraConBarco: GroundingChunk = {
      title: "Iluminación",
      body: "La vela de cera alumbra la mesa del barco y se derrite con la llama.",
    };
    const r = verifyGroundedAnswer(FRASE_CERA, [guiaBarco, guiaCeraConBarco], "es", Q_VELA);
    expect(r.removed).toBe(0);
    expect(r.text).toContain("se derrite con la llama");
  });

  it("apoyo en el chunk relevante = 0,5: no dispara (ningún relevante la apoya «ni a medias» es < 0,5)", () => {
    const mixta = "La vela con viento y marea, de cera, se derrite con la llama.";
    const r = verifyGroundedAnswer(mixta, [guiaBarco, guiaCera], "es", Q_VELA);
    expect(r.removed).toBe(0);
    expect(r.text).toContain("viento y marea");
  });

  it("excepción de jurisdicción del dato: la afirmación de identidad del teléfono no la retira V6", () => {
    // La guía relevante (teléfono + museo, presencia 2) no apoya la
    // frase; su único apoyo es la guía de información (presencia 1):
    // el patrón de V6 se cumple y solo la jurisdicción del dato la
    // salva, porque su desenlace sellado es el de la regla del dato.
    const guiaMuseo: GroundingChunk = {
      title: "El museo",
      body: "El museo guarda el teléfono antiguo de la centralita en una vitrina.",
    };
    const guiaInfo: GroundingChunk = {
      title: "Información",
      body: "El teléfono de información general atiende consultas de horarios y precios.",
    };
    const frase =
      "El teléfono de información general es el que atiende las consultas de horarios y precios.";
    const r = verifyGroundedAnswer(frase, [guiaMuseo, guiaInfo], "es", "¿Cuál es el teléfono del museo?");
    expect(r.removed).toBe(0);
    expect(r.text).toContain("teléfono de información general");
  });
});
