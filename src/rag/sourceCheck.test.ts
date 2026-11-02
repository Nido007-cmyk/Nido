/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { findDateConflicts, findNumberConflicts } from "./sourceCheck";
import type { RetrievedChunk } from "./retrieve";

const chunk = (body: string): RetrievedChunk =>
  ({ id: "c1", title: "Fuente", body, source: "test", score: 1 }) as unknown as RetrievedChunk;

describe("findNumberConflicts (la caja de comprobación)", () => {
  it("el caso Hubble de Field Atlas: 870 km en la respuesta contra 600 km en la fuente", () => {
    const conflicts = findNumberConflicts(
      "La órbita del Hubble está a 540 millas (870 km) de altura.",
      [chunk("El telescopio Hubble orbita a unos 600 km sobre la superficie de la Tierra.")]
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].unit).toBe("km");
    expect(conflicts[0].sourceSentence).toContain("600 km");
  });

  it("el caso del Gran Cañón: 8.000 pies contra 6.000 pies", () => {
    const conflicts = findNumberConflicts(
      "The Grand Canyon is over 8,000 feet deep at its deepest point.",
      [chunk("The Grand Canyon reaches about 6,000 feet deep in places.")]
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].unit).toBe("pies");
  });

  it("el redondeo honesto y la escala NO son contradicción (la regla de la tanda 1)", () => {
    expect(
      findNumberConflicts("La población del país es de 16,4 millones de habitantes.", [
        chunk("El país tiene 16.431.599 habitantes según el censo."),
      ])
    ).toEqual([]);
    expect(
      findNumberConflicts("El depósito guarda unos 600 litros de agua.", [
        chunk("El depósito guarda 598 litros de agua."),
      ])
    ).toEqual([]);
  });

  it("unidades distintas nunca se comparan (no se convierte)", () => {
    expect(
      findNumberConflicts("La ruta mide 5 km en total.", [chunk("La ruta mide 3 millas en total.")])
    ).toEqual([]);
  });

  it("sin tema compartido no hay aviso, aunque la unidad coincida", () => {
    expect(
      findNumberConflicts("El tanque de la granja guarda 600 litros de agua.", [
        chunk("La receta tradicional usa 200 litros de leche."),
      ])
    ).toEqual([]);
  });

  it("sin fuentes o sin cifras no hay nada que comprobar", () => {
    expect(findNumberConflicts("Una respuesta sin cifras.", [chunk("Tampoco hay cifras aquí.")])).toEqual([]);
    expect(findNumberConflicts("Hay 600 km de costa.", [])).toEqual([]);
  });

  // R-05: el caso inverso — la respuesta nombra el dato sin darlo y
  // la fuente sí lo trae. La frase enseñada es la del número, no la
  // primera que comparta una palabra.
  it("R-05 omisión: «el teléfono es el número de emergencia» contra la fuente que trae el teléfono", () => {
    const doc =
      "Su cita es el martes 10 de noviembre de 2026 a las 9:30 de la mañana, en la sala 214, segundo piso. " +
      "Para cambiar la cita llame al 520-555-0147.";
    const conflicts = findNumberConflicts("El teléfono para cambiar la cita es el número de emergencia.", [chunk(doc)]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].omission).toBe(true);
    expect(conflicts[0].sourceSentence).toContain("520-555-0147");
  });

  it("R-05 omisión: si la respuesta SÍ da el número, no hay aviso", () => {
    const doc = "Para cambiar la cita llame al 520-555-0147.";
    expect(findNumberConflicts("El teléfono para cambiar la cita es el 520-555-0147.", [chunk(doc)])).toEqual([]);
  });

  it("R-05 omisión: sin categoría de dato en la respuesta, o sin cifras del tema en la fuente, no hay aviso", () => {
    expect(
      findNumberConflicts("La respuesta es muy interesante y completa.", [chunk("El dato es 42 y nada más.")])
    ).toEqual([]);
    expect(
      findNumberConflicts("El teléfono es el número de emergencia.", [chunk("El teléfono de la oficina atiende de día.")])
    ).toEqual([]);
  });

  // Revisión adversaria de la cadena, H-03: la red de omisión
  // disparaba con UNA sola palabra compartida, y le colgaba a una
  // frase cualitativa correcta la cifra de otro tema. El suelo de
  // tema pasa a ser dos palabras sustantivas compartidas; los
  // genéricos (número, año, día y familia) no cuentan como tema.
  it("Adversaria H-03: «El número de visitantes creció mucho ese año» contra el museo NO es omisión", () => {
    expect(
      findNumberConflicts("El número de visitantes creció mucho ese año.", [
        chunk("En 2019 el museo recibió 250000 visitantes."),
      ])
    ).toEqual([]);
  });

  it("Adversaria H-03: compartir solo el genérico «número» tampoco es tema", () => {
    expect(
      findNumberConflicts("El número de alumnos creció mucho.", [
        chunk("El número de visitantes llegó a 250000 en 2019."),
      ])
    ).toEqual([]);
  });

  it("Adversaria H-03: con dos palabras sustantivas compartidas la omisión verdadera sigue avisando", () => {
    const conflicts = findNumberConflicts("El teléfono para reservar la mesa es el número del restaurante.", [
      chunk("Para reservar la mesa llame al 520-555-0147."),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].omission).toBe(true);
    expect(conflicts[0].sourceSentence).toContain("520-555-0147");
  });
});

// Segunda adversaria, ADV2-03/04: el suelo de dos sustantivas
// disparaba con palabras de función y pares de otro subtema, y a
// la vez dejaba escapar la omisión canónica de una sola palabra.
// La frase enseñada ha de traer la categoría del dato, las de
// función no son tema, y una sustantiva ajena a la categoría basta
// cuando la categoría misma se comparte.
describe("findNumberConflicts — segunda adversaria ADV2-03/04 (la omisión exige tema Y categoría)", () => {
  it("ADV2-03 FP-1: «sala»+«está» NO cuelga la sala 214 de la respuesta sobre la sala de espera", () => {
    expect(
      findNumberConflicts("La sala de espera está en la planta baja, junto a la entrada principal.", [
        chunk("La sala 214 está en el segundo piso."),
      ])
    ).toEqual([]);
  });

  it("ADV2-03 FP-2: «mercado»+«pueblo» NO cuelga los 300 puestos al día de mercado (la frase no trae ningún día)", () => {
    expect(
      findNumberConflicts("El día de mercado es el más animado del pueblo.", [
        chunk("El mercado del pueblo reúne 300 puestos cada semana y abre 12 horas."),
      ])
    ).toEqual([]);
  });

  it("ADV2-03 guarda: tema de dos sustantivas sin la categoría en la frase fuente tampoco avisa", () => {
    expect(
      findNumberConflicts("El día de la fiesta es el más alegre del pueblo.", [
        chunk("La fiesta del pueblo reúne 300 invitados cada año."),
      ])
    ).toEqual([]);
  });

  it("ADV2-03 guarda: compartir solo la palabra de la categoría (sin sustantiva ajena) no basta", () => {
    expect(
      findNumberConflicts("La sala es la de siempre.", [chunk("La sala 214 está en el segundo piso.")])
    ).toEqual([]);
  });

  it("ADV2-04: la omisión verdadera de una sola sustantiva («emergencia») SÍ enseña el 911", () => {
    const conflicts = findNumberConflicts("El teléfono es el número de emergencia, como siempre.", [
      chunk("El número de emergencia en México es el 911."),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].omission).toBe(true);
    expect(conflicts[0].sourceSentence).toContain("911");
  });

  it("ADV2-04 en portugués: «é o número de emergência» también enseña el 911", () => {
    const conflicts = findNumberConflicts("O telefone é o número de emergência, como sempre.", [
      chunk("O número de emergência no México é o 911."),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].omission).toBe(true);
    expect(conflicts[0].sourceSentence).toContain("911");
  });

  it("ADV2-04 en inglés: «the emergency number» también enseña el 911", () => {
    const conflicts = findNumberConflicts("The phone is the emergency number, as always.", [
      chunk("The emergency number in Mexico is 911."),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].omission).toBe(true);
    expect(conflicts[0].sourceSentence).toContain("911");
  });
});

describe("C-08: las unidades de Esencial y los rangos entran en la caja", () => {
  it("las gotas disparan en letra y en dígito, con y sin calificador de litro", () => {
    const conLitro = [chunk("Para desinfectar el agua clara usa 2 gotas por litro.")];
    const letra = findNumberConflicts("Échale ocho gotas de lejía por litro.", conLitro);
    expect(letra).toHaveLength(1);
    expect(letra[0].unit).toBe("gotas/l");
    const digito = findNumberConflicts("Échale 8 gotas de lejía por litro.", conLitro);
    expect(digito).toHaveLength(1);
    expect(digito[0].unit).toBe("gotas/l");
    const sinCalificador = findNumberConflicts("Échale doce gotas.", [chunk("Échale 2 gotas.")]);
    expect(sinCalificador).toHaveLength(1);
    expect(sinCalificador[0].unit).toBe("gotas");
  });

  it("las gotas se juzgan también de una cifra (1 gota contra 2 por litro es el conflicto que importa)", () => {
    const fuente = [chunk("Para desinfectar el agua clara usa 2 gotas por litro.")];
    const digito = findNumberConflicts("Échale 1 gota por litro.", fuente);
    expect(digito).toHaveLength(1);
    expect(digito[0].unit).toBe("gotas/l");
    const letra = findNumberConflicts("Échale una gota por litro.", fuente);
    expect(letra).toHaveLength(1);
    expect(letra[0].unit).toBe("gotas/l");
  });

  it("el % dispara fuera del rango de la guía y calla dentro", () => {
    const fuente = [chunk("El hipoclorito al 5–6 % desinfecta el suelo.")];
    const fuera = findNumberConflicts("Usa lejía al 20 % para desinfectar el suelo.", fuente);
    expect(fuera).toHaveLength(1);
    expect(fuera[0].unit).toBe("%");
    expect(findNumberConflicts("Usa lejía al 6 % para desinfectar el suelo.", fuente)).toEqual([]);
  });

  it("los días se juzgan contra el rango: 30 dispara, 12 calla dentro, 3 dispara por medidas y no por omisión", () => {
    const fuente = [chunk("El zinc se da durante 10 a 14 días.")];
    const fuera = findNumberConflicts("El zinc se da durante 30 días.", fuente);
    expect(fuera).toHaveLength(1);
    expect(fuera[0].unit).toBe("dias");
    expect(findNumberConflicts("El zinc se da durante 12 días.", fuente)).toEqual([]);
    // El rebote histórico: «3» no es cifra juzgable y la frase acertaba
    // por la rama de omisión. Con «días» en la tabla dispara por la vía
    // de medidas, sin nota de omisión.
    const tres = findNumberConflicts("El zinc se da durante 3 días.", fuente);
    expect(tres).toHaveLength(1);
    expect(tres[0].unit).toBe("dias");
    expect(tres[0].omission).toBeFalsy();
  });

  it("la frecuencia se juzga en veces/día: «tres veces al día» ES «cada 8 horas» y NO es «cada 6 horas»", () => {
    // La preparación §2.3 manda: 3 contra 24/8 = 3, misma cifra. (La
    // tabla de §2.2 pedía «conflicto» para este par; el diseño y los
    // controles de supervivencia mandan lo contrario: es el control.)
    expect(
      findNumberConflicts("El jarabe se da tres veces al día.", [chunk("El jarabe se da cada 8 horas.")])
    ).toEqual([]);
    const conflicto = findNumberConflicts("El jarabe se da tres veces al día.", [
      chunk("El jarabe se da cada 6 horas."),
    ]);
    expect(conflicto).toHaveLength(1);
    expect(conflicto[0].unit).toBe("veces/dia");
    const digito = findNumberConflicts("El jarabe se da 2 veces al día.", [
      chunk("El jarabe se da cada 8 horas."),
    ]);
    expect(digito).toHaveLength(1);
    expect(digito[0].unit).toBe("veces/dia");
  });

  it("las cucharas se convierten con la vara declarada (cucharadita 5 ml, cucharada 15 ml)", () => {
    const conflicto = findNumberConflicts("Ponle 12 cucharaditas de azúcar.", [
      chunk("Ponle 6 cucharaditas rasas de azúcar."),
    ]);
    expect(conflicto).toHaveLength(1);
    expect(conflicto[0].unit).toBe("ml");
    // En letra, por el portillo estrecho: «dos cucharadas» = 30 ml.
    const letra = findNumberConflicts("Échale dos cucharadas de azúcar.", [chunk("Échale 10 ml de azúcar.")]);
    expect(letra).toHaveLength(1);
    expect(letra[0].unit).toBe("ml");
    // «Media cucharadita» (la sal del suero) se vuelve visible: 2,5 ml.
    const media = findNumberConflicts("Ponle 2 cucharaditas de sal.", [
      chunk("Ponle media cucharadita de sal."),
    ]);
    expect(media).toHaveLength(1);
    expect(media[0].unit).toBe("ml");
  });

  it("la dosis correcta en sus tres ropas no se acusa (dígito = letra = la guía)", () => {
    expect(
      findNumberConflicts("Ponle 6 cucharaditas de azúcar.", [chunk("Ponle seis cucharaditas de azúcar.")])
    ).toEqual([]);
    expect(
      findNumberConflicts("Ponle seis cucharaditas de azúcar.", [chunk("Ponle 6 cucharaditas rasas de azúcar.")])
    ).toEqual([]);
  });

  it("los comprimidos se juzgan también de una cifra (1 contra 2 es el conflicto que importa)", () => {
    const letra = findNumberConflicts("Toma cuatro comprimidos.", [chunk("Toma 2 comprimidos.")]);
    expect(letra).toHaveLength(1);
    expect(letra[0].unit).toBe("comprimidos");
    const una = findNumberConflicts("Toma 1 comprimido.", [chunk("Toma 2 comprimidos.")]);
    expect(una).toHaveLength(1);
    expect(una[0].unit).toBe("comprimidos");
  });

  it("«veces» a secas no forma medida: es multiplicador, no frecuencia", () => {
    expect(
      findNumberConflicts("El faro está a 5 veces la distancia de la boya.", [
        chunk("El faro emite 3 veces al día su señal sobre la boya."),
      ])
    ).toEqual([]);
  });

  it("las gotas en un vaso y las gotas por litro no se comparan (unidades distintas = sin juicio)", () => {
    const fuente = [chunk("Pon 2 gotas por litro de agua.")];
    expect(findNumberConflicts("Ponle 2 gotas en el vaso.", fuente)).toEqual([]);
    expect(findNumberConflicts("Ponle 8 gotas en el vaso.", fuente)).toEqual([]);
  });

  it("el intervalo «cada N años» se compara consigo mismo", () => {
    const conflicto = findNumberConflicts("El refuerzo va cada 10 años.", [
      chunk("El refuerzo va cada 5 años."),
    ]);
    expect(conflicto).toHaveLength(1);
    expect(conflicto[0].unit).toBe("cada-años");
    expect(
      findNumberConflicts("El refuerzo va cada 10 años.", [chunk("El refuerzo va cada 10 años.")])
    ).toEqual([]);
  });

  it("la vara por kilo: «ml por kilo» se juzga como ml/kg", () => {
    const conflicto = findNumberConflicts("La dosis es de 5 ml por kilo de peso.", [
      chunk("La dosis es de 2 ml por kilo de peso."),
    ]);
    expect(conflicto).toHaveLength(1);
    expect(conflicto[0].unit).toBe("ml/kg");
  });

  it("la semana convertida (7 días exactos) hace comparables semanas y días", () => {
    const conflicto = findNumberConflicts("El tratamiento dura 2 semanas.", [
      chunk("El tratamiento dura 10 días."),
    ]);
    expect(conflicto).toHaveLength(1);
    expect(conflicto[0].unit).toBe("dias");
    expect(
      findNumberConflicts("El tratamiento dura 2 semanas.", [chunk("El tratamiento dura 14 días.")])
    ).toEqual([]);
  });

  it("el rango ya no acusa a su interior ni a un rango que lo solapa", () => {
    expect(
      findNumberConflicts("Calienta el agua a 39 °C.", [chunk("Calienta el agua tibia entre 37 y 40 °C.")])
    ).toEqual([]);
    expect(
      findNumberConflicts("Calienta el agua entre 38 y 42 °C.", [
        chunk("Calienta el agua tibia entre 37 y 40 °C."),
      ])
    ).toEqual([]);
  });

  it("los controles que ya disparaban siguen disparando idénticos (km, minutos)", () => {
    const km = findNumberConflicts("La ruta mide 5 km.", [chunk("La ruta mide 3 km.")]);
    expect(km).toHaveLength(1);
    expect(km[0].unit).toBe("km");
    const min = findNumberConflicts("Espera 30 min antes de salir.", [chunk("Espera 45 min antes de salir.")]);
    expect(min).toHaveLength(1);
    expect(min[0].unit).toBe("minutos");
  });

  it("el seto se juzga como valor llano (imperfección declarada, no se cura en silencio)", () => {
    // Decisión declarada de la preparación §2.3-D: sin maquinaria de
    // setos. «Más de 2 semanas» vale 14 días llanos y contra «10 días»
    // dispara en el borde; la fixture lo documenta tal cual.
    const conflicto = findNumberConflicts("El agua dura más de 2 semanas.", [
      chunk("El agua dura 10 días."),
    ]);
    expect(conflicto).toHaveLength(1);
    expect(conflicto[0].unit).toBe("dias");
  });
});

describe("findDateConflicts (C-07: la caja aprende fechas)", () => {
  const NOTA =
    "La cita de seguimiento es el martes 10 de noviembre de 2026 a las 9:30 en la sala 214. Toma el jarabe dos veces al día.";
  const REF = new Date(2026, 10, 1); // domingo 1 de noviembre de 2026

  it("R4: «el miércoles 10» contra el martes de la nota — la nota enseña la frase de la fuente", () => {
    const conflicts = findDateConflicts("eso fue el miércoles 10", [chunk(NOTA)], REF);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].unit).toBe("fecha");
    expect(conflicts[0].sourceSentence).toContain("martes 10 de noviembre");
  });

  it("R5: «ayer» contra la absoluta dispara; la honesta en inglés no", () => {
    const conflicts = findDateConflicts("su cita es ayer", [chunk(NOTA)], REF);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].unit).toBe("fecha");
    expect(findDateConflicts("that's on Tuesday the 10th", [chunk(NOTA)], REF)).toEqual([]);
  });

  it("R1: el lunes con fecha completa, emparejado con la nota, enseña su frase", () => {
    const conflicts = findDateConflicts("La cita es el lunes 10 de noviembre de 2026.", [chunk(NOTA)], REF);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].unit).toBe("fecha");
    expect(conflicts[0].sourceSentence).toContain("martes 10 de noviembre");
  });
});

// ---------------------------------------------------------------
// T-J4 (barrido «revisa todo», J4): las fracciones eran invisibles
// también en esta superficie («1/4 taza» contra «1/2 taza» no
// marcaba nada: R2-07). measuresIn gana la gramática de fracciones
// compartida con el juez y UNITS gana la taza — sin la unidad la
// fracción no tenía medida que juzgar, y los dígitos en tazas se
// miden con ella desde la misma tanda, por la misma razón.

describe("T-J4: las fracciones se juzgan en la caja", () => {
  const RECETA = "Receta de la abuela. Añade 1/2 taza de azúcar a la mezcla y remueve bien.";

  it("«1/4 taza» contra «1/2 taza» marca conflicto de tazas y enseña la fuente", () => {
    const conflicts = findNumberConflicts("Añade 1/4 taza de azúcar a la mezcla.", [chunk(RECETA)]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].unit).toBe("tazas");
    expect(conflicts[0].sourceSentence).toContain("1/2 taza");
  });

  it("la fracción fiel no marca nada", () => {
    expect(findNumberConflicts("Añade 1/2 taza de azúcar a la mezcla.", [chunk(RECETA)])).toEqual([]);
  });

  it("los dígitos en tazas también se miden desde esta tanda", () => {
    const conflicts = findNumberConflicts("Añade 2 tazas de azúcar a la mezcla.", [
      chunk("Receta de la abuela. Añade 3 tazas de azúcar a la mezcla y remueve bien."),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].unit).toBe("tazas");
  });

  it("«10/11» no es una fracción: no se funde ni marca por la vía de fracciones", () => {
    expect(findNumberConflicts("La cita es el 10/11 en la sala.", [chunk("La cita es el 11/10 en la sala.")])).toEqual([]);
  });
});

// ---------------------------------------------------------------
// T-J5 (barrido «revisa todo», J5): el juicio de fechas numéricas
// vive en dates.ts (R6) y es compartido — la caja lo convierte en
// aviso con la frase de la fuente, como con las demás fechas.

describe("T-J5: la caja enseña la fecha numérica transpuesta cuando el contexto decide", () => {
  const NOTA_NUM =
    "Nota de la clínica. La cita con el dentista es el 10/11/2026 en la sala de espera. La receta caduca el 25/12/2026.";
  const REF_NUM = new Date(2026, 10, 2);

  it("con un inequívoco d/m en la fuente, la nota enseña la frase verdadera", () => {
    const conflicts = findDateConflicts("La cita con el dentista es el 11/10/2026.", [chunk(NOTA_NUM)], REF_NUM);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].unit).toBe("fecha");
    expect(conflicts[0].sourceSentence).toContain("10/11/2026");
  });

  it("la misma fecha que la fuente no enseña nada", () => {
    expect(findDateConflicts("La cita con el dentista es el 10/11/2026.", [chunk(NOTA_NUM)], REF_NUM)).toEqual([]);
  });
});

// ---------------------------------------------------------------
// ADV-J-C1 (adversaria del bloque del juez): «puffs» y «sprays»
// entran también en las UNITS de esta caja — sin ellas la medida
// no se parseaba y la dosis cambiada no enseñaba conflicto. (La
// caja exige tema compartido, como con toda unidad: las frases
// comparten inhalador y pauta, no solo la unidad.)

describe("ADV-J-C1: la caja enseña la dosis de inhalador cambiada", () => {
  it("3 puffs contra 2: un conflicto con la unidad y la frase de la fuente", () => {
    const conflicts = findNumberConflicts("The inhaler dose is 3 puffs twice a day.", [
      chunk("Inhaler guide. Take 2 puffs twice a day."),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].unit).toBe("puffs");
    expect(conflicts[0].sourceSentence).toContain("2 puffs");
  });

  it("la fiel (2 puffs) no enseña nada", () => {
    expect(
      findNumberConflicts("The inhaler dose is 2 puffs twice a day.", [chunk("Inhaler guide. Take 2 puffs twice a day.")]),
    ).toEqual([]);
  });

  it("4 sprays contra 2: un conflicto con su unidad", () => {
    const conflicts = findNumberConflicts("The nasal spray dose is 4 sprays once a day.", [
      chunk("Nasal spray guide. Use 2 sprays once a day."),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].unit).toBe("sprays");
  });
});

// ---------------------------------------------------------------
// ADV-J-C2 (adversaria del bloque del juez): la caja callaba ante
// la transpuesta cuando la fuente escribía la fecha con nombre y
// con número — la gemela con nombre no declaraba la convención
// del turno y la respuesta conservaba la lectura que la absolvía.
// El juicio vive en dates.ts (R6); aquí se convierte en aviso.

describe("ADV-J-C2: la caja enseña la transpuesta cuando la fuente trae la gemela con nombre", () => {
  const NOTA_GEMELA = "Nota de la clínica. La cita es el 10 de noviembre de 2026. El control es el 10/11/2026.";
  const REF_GEMELA = new Date(2026, 10, 2);

  it("la transpuesta enseña la frase de la fuente con la fecha verdadera", () => {
    const conflicts = findDateConflicts("El control es el 11/10/2026.", [chunk(NOTA_GEMELA)], REF_GEMELA);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].unit).toBe("fecha");
    expect(conflicts[0].sourceSentence).toContain("10 de noviembre");
  });

  it("la misma fecha que la fuente no enseña nada", () => {
    expect(findDateConflicts("El control es el 10/11/2026.", [chunk(NOTA_GEMELA)], REF_GEMELA)).toEqual([]);
  });
});

// ---------------------------------------------------------------
// ADV-J-C3 (adversaria del bloque del juez): la caja no enseñaba
// el conflicto cuando la fecha difería SOLO en el año, en forma
// numérica (la puerta de compatibilidad de R6) ni con nombre
// (fuera de R6). El juicio nuevo vive en dates.ts (R7); aquí se
// convierte en aviso en las dos formas.

describe("ADV-J-C3: la caja enseña el conflicto de año en las dos formas", () => {
  const REF_ANIO = new Date(2026, 10, 2);

  it("numérico: «25/12/2027» contra «25/12/2026» enseña la frase verdadera", () => {
    const conflicts = findDateConflicts("El control es el 25/12/2027.", [chunk("El control es el 25/12/2026.")], REF_ANIO);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].unit).toBe("fecha");
    expect(conflicts[0].sourceSentence).toContain("25/12/2026");
  });

  it("con nombre: «25 de diciembre de 2027» contra «…de 2026» enseña la frase verdadera", () => {
    const conflicts = findDateConflicts(
      "El control es el 25 de diciembre de 2027.",
      [chunk("El control es el 25 de diciembre de 2026.")],
      REF_ANIO,
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].unit).toBe("fecha");
    expect(conflicts[0].sourceSentence).toContain("25 de diciembre de 2026");
  });

  it("la fiel del mismo año no enseña nada", () => {
    expect(findDateConflicts("El control es el 25/12/2026.", [chunk("El control es el 25/12/2026.")], REF_ANIO)).toEqual([]);
  });
});

// ---------------------------------------------------------------
// T1 (barrido «revisa todo», clase 3, C3-T01): la caja enseñaba la
// TARJETA como el teléfono omitido — la guarda isCardCluster de
// ADV2-01 nunca llegó a esta gemela: hasPhoneCluster contaba la
// ristra-tarjeta como forma de teléfono y la palabra genérica
// «número» la rescataba en sourceCarriesCategory. El par medido
// del barrido, tal cual.

describe("T1: la tarjeta no se enseña como teléfono omitido", () => {
  const RESPUESTA = "El teléfono de la clínica es el número de emergencias.";
  const TARJETA = "El número de la tarjeta de la clínica es 4111 1111 1111 1111.";
  const TELEFONO = "El teléfono de la clínica es 612 345 678.";

  it("el par del barrido: la fuente de la tarjeta sola ya no enseña teléfono omitido", () => {
    expect(findNumberConflicts(RESPUESTA, [chunk(TARJETA)])).toEqual([]);
  });

  it("el suelo: el teléfono verdadero sí se enseña como omisión", () => {
    const conflicts = findNumberConflicts(RESPUESTA, [chunk(TELEFONO)]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].unit).toBe("telefono");
    expect(conflicts[0].omission).toBe(true);
    expect(conflicts[0].sourceSentence).toContain("612 345 678");
  });

  it("con las dos frases en la fuente, la que se enseña es la del teléfono, no la de la tarjeta", () => {
    const conflicts = findNumberConflicts(RESPUESTA, [chunk(`${TARJETA} ${TELEFONO}`)]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].sourceSentence).toContain("612 345 678");
    expect(conflicts[0].sourceSentence).not.toContain("4111");
  });
});
