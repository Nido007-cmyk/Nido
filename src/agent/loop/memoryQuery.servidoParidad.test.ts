/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Tanda M de la serie de curas · lo servido por
 * `answerMemoryQuery` cuando el hecho guarda a más de una
 * persona o la pregunta cuenta fichas (F-PC56, F-PC57,
 * F-PC60 y F-PC61), sobre la superficie pública
 * `answerMemoryQuery` con `isMemoryStyleQuery` como segunda
 * aserción en los casos de espejo de M4.
 *
 * La raíz de M1 y M2 es una sola: las ramas 1 y 2 nunca
 * recibieron la disciplina de segmento que la rama de
 * cumpleaños sí tiene, y sirven la primera cláusula del
 * hecho (el nombre de otra persona, o la cola entera tras
 * el nombre propio). M3 cobra la fecha servida, no la forma
 * de la frase: la cuenta atrás depende del día de la
 * corrida. Los huecos son del móvil, heredados en copia
 * fiel; la tanda los cura en PC como mejora declarada.
 *
 * Nacimiento (contra el árbol sin curar): 34 rojos
 * (M1 11, M2 5, M3 7, M4 8, M5 3). Los 11 verdes de
 * nacimiento son los controles que la cura no puede romper.
 */
import { describe, expect, it } from "vitest";
import {
  answerMemoryQuery,
  isMemoryStyleQuery,
  type MemoryQueryData,
} from "./memoryQuery";

const F = (content: string) => ({ content, category: "family" });
const P = (name: string, relationship: string) => ({ name, relationship });
const mem = (
  facts: { content: string; category: string }[],
  people: { name: string; relationship: string }[] = []
): MemoryQueryData => ({ facts, people });
const NOT_ES =
  "No lo encuentro en lo que me has contado. Si me lo dices, lo guardo.";

// ---------------------------------------------------------------- M1
// El nombre del parentesco preguntado (F-PC56 rama 1): el
// hecho combinado sirve el nombre de la cláusula del
// parentesco, no el de la primera cláusula; sin cláusula
// propia con nombre, el desenlace es el notKnown honesto.
describe("M1 · el nombre del parentesco preguntado (F-PC56 rama 1)", () => {
  const COMBINADO = mem([F("Mi mamá se llama Marta y mi papá se llama José")]);
  it("control: mamá en el combinado sirve Marta (como hoy)", () => {
    expect(answerMemoryQuery("¿cómo se llama mi mamá?", COMBINADO, "es")).toBe(
      "Tu mamá se llama Marta."
    );
  });
  it("papá en el combinado sirve José, no Marta", () => {
    expect(answerMemoryQuery("¿cómo se llama mi papá?", COMBINADO, "es")).toBe(
      "Tu papá se llama José."
    );
  });
  const INVERTIDO = mem([F("Mi papá se llama José y mi mamá se llama Marta")]);
  it("orden invertido: mamá sirve Marta, no José", () => {
    expect(answerMemoryQuery("¿cómo se llama mi mamá?", INVERTIDO, "es")).toBe(
      "Tu mamá se llama Marta."
    );
  });
  const COMA = mem([F("Mi mamá se llama Marta, mi papá se llama José")]);
  it("unidos por coma: papá sirve José", () => {
    expect(answerMemoryQuery("¿cómo se llama mi papá?", COMA, "es")).toBe(
      "Tu papá se llama José."
    );
  });
  const PUNTO = mem([F("Mi mamá se llama Marta. Mi papá se llama José")]);
  it("unidos por punto: papá sirve José", () => {
    expect(answerMemoryQuery("¿cómo se llama mi papá?", PUNTO, "es")).toBe(
      "Tu papá se llama José."
    );
  });
  const TRES = mem([
    F("Mi mamá se llama Marta, mi papá se llama José y mi hermano cumple años en mayo"),
  ]);
  it("combinado de tres: hermano sin cláusula de nombre → notKnown", () => {
    expect(answerMemoryQuery("¿cómo se llama mi hermano?", TRES, "es")).toBe(NOT_ES);
  });
  it("combinado de tres: papá sirve José", () => {
    expect(answerMemoryQuery("¿cómo se llama mi papá?", TRES, "es")).toBe(
      "Tu papá se llama José."
    );
  });
  const SIN_CLAUSULA = mem([F("Mi mamá se llama Marta y mi papá cumple años en mayo")]);
  it("papá sin cláusula propia → notKnown, nunca el nombre de mamá", () => {
    expect(answerMemoryQuery("¿cómo se llama mi papá?", SIN_CLAUSULA, "es")).toBe(NOT_ES);
  });
  const EN = mem([F("My mom is called Mary and my dad is called John")]);
  it("en: dad sirve John, no Mary", () => {
    expect(answerMemoryQuery("what is my dad called?", EN, "en")).toBe(
      "Your dad's name is John."
    );
  });
  const PT_CHAMA = mem([F("A minha mãe chama-se Maria e o meu pai chama-se João")]);
  it("pt chama-se: pai sirve João, no Maria", () => {
    expect(answerMemoryQuery("como se chama o meu pai?", PT_CHAMA, "pt")).toBe(
      "Seu pai se chama João."
    );
  });
  const PT_NOME = mem([F("O nome da minha mãe é Maria e o nome do meu pai é João")]);
  it("pt marco «o nome»: pai sirve João", () => {
    expect(answerMemoryQuery("qual é o nome do meu pai?", PT_NOME, "pt")).toBe(
      "Seu pai se chama João."
    );
  });
  const ES_NOMBRE = mem([F("El nombre de mi madre es Marta y el de mi padre es José")]);
  it("es marco elíptico «el de mi padre»: sin nombre extraíble en su segmento → notKnown", () => {
    expect(answerMemoryQuery("¿cuál es el nombre de mi padre?", ES_NOMBRE, "es")).toBe(
      NOT_ES
    );
  });
  const SEPARADOS = mem([F("Mi mamá se llama Marta"), F("Mi papá se llama José")]);
  it("control: hechos separados sirven papá (como hoy)", () => {
    expect(answerMemoryQuery("¿cómo se llama mi papá?", SEPARADOS, "es")).toBe(
      "Tu papá se llama José."
    );
  });
});

// ---------------------------------------------------------------- M2
// El nombre propio sin cola (F-PC56 rama 2): la captura va
// sobre el segmento de la frase, no sobre la cola entera
// del hecho.
describe("M2 · el nombre propio sin cola (F-PC56 rama 2)", () => {
  it("con «y»: «Me llamo Ana y mi esposo…» sirve Ana", () => {
    expect(
      answerMemoryQuery("¿cómo me llamo?", mem([F("Me llamo Ana y mi esposo se llama Luis")]), "es")
    ).toBe("Te llamas Ana.");
  });
  it("con punto: «Me llamo Ana. Mi esposo…» sirve Ana", () => {
    expect(
      answerMemoryQuery("¿cómo me llamo?", mem([F("Me llamo Ana. Mi esposo se llama Luis")]), "es")
    ).toBe("Te llamas Ana.");
  });
  it("nombre compuesto: «Me llamo Ana María y…» sirve Ana María entera", () => {
    expect(
      answerMemoryQuery("¿cómo me llamo?", mem([F("Me llamo Ana María y mi esposo se llama Luis")]), "es")
    ).toBe("Te llamas Ana María.");
  });
  it("en: «My name is Ana and…» sirve Ana", () => {
    expect(
      answerMemoryQuery("what's my name?", mem([F("My name is Ana and my husband is called Luis")]), "en")
    ).toBe("Your name is Ana.");
  });
  it("pt: «Meu nome é Ana e…» sirve Ana", () => {
    expect(
      answerMemoryQuery("como eu me chamo?", mem([F("Meu nome é Ana e meu marido se chama Luis")]), "pt")
    ).toBe("Você se chama Ana.");
  });
  it("control: «Me llamo Ana» a secas sirve Ana (como hoy)", () => {
    expect(answerMemoryQuery("¿cómo me llamo?", mem([F("Me llamo Ana")]), "es")).toBe(
      "Te llamas Ana."
    );
  });
});

// ---------------------------------------------------------------- M3
// El cumpleaños de la persona nombrada (F-PC57): la pasada
// de nombre casa por tokens enteros y consecutivos, no por
// subcadena («Ana» no casa dentro de «Anabel» ni de
// «Mariana»; «Juan» no en «Juana»; «Luis» no en «Luisa»).
// Los casos cobran la fecha servida.
describe("M3 · el cumpleaños de la persona nombrada (F-PC57)", () => {
  const ANA = [P("Ana", "hija")];
  const Q = "¿cuándo es el cumpleaños de mi hija?";
  it("Anabel antes que la hija: sirve el 5 de junio, no el 3 de mayo", () => {
    const r = answerMemoryQuery(
      Q,
      mem([F("El cumpleaños de Anabel es el 3 de mayo"), F("El cumpleaños de mi hija es el 5 de junio")], ANA),
      "es"
    );
    expect(r).toContain("5 de junio");
  });
  it("la hija antes que Anabel: sirve el 5 de junio igual", () => {
    const r = answerMemoryQuery(
      Q,
      mem([F("El cumpleaños de mi hija es el 5 de junio"), F("El cumpleaños de Anabel es el 3 de mayo")], ANA),
      "es"
    );
    expect(r).toContain("5 de junio");
  });
  it("control: Ana nombrada antes que Anabel sirve el 5 de junio (hoy por orden)", () => {
    const r = answerMemoryQuery(
      Q,
      mem([F("El cumpleaños de Ana es el 5 de junio"), F("El cumpleaños de Anabel es el 3 de mayo")], ANA),
      "es"
    );
    expect(r).toContain("5 de junio");
  });
  it("Anabel antes que Ana nombrada: sirve el 5 de junio, no el de Anabel", () => {
    const r = answerMemoryQuery(
      Q,
      mem([F("El cumpleaños de Anabel es el 3 de mayo"), F("El cumpleaños de Ana es el 5 de junio")], ANA),
      "es"
    );
    expect(r).toContain("5 de junio");
  });
  it("solo Mariana: preguntado por Ana → notKnown", () => {
    expect(
      answerMemoryQuery(Q, mem([F("El cumpleaños de Mariana es el 3 de mayo")], ANA), "es")
    ).toBe(NOT_ES);
  });
  it("solo Anabel: preguntado por Ana → notKnown", () => {
    expect(
      answerMemoryQuery(Q, mem([F("El cumpleaños de Anabel es el 3 de mayo")], ANA), "es")
    ).toBe(NOT_ES);
  });
  it("solo Juana: preguntado por Juan → notKnown", () => {
    expect(
      answerMemoryQuery(
        "¿cuándo es el cumpleaños de mi hijo?",
        mem([F("El cumpleaños de Juana es el 8 de abril")], [P("Juan", "hijo")]),
        "es"
      )
    ).toBe(NOT_ES);
  });
  it("solo Luisa: preguntado por Luis → notKnown", () => {
    expect(
      answerMemoryQuery(
        "¿cuándo es el cumpleaños de mi hijo?",
        mem([F("El cumpleaños de Luisa es el 9 de abril")], [P("Luis", "hijo")]),
        "es"
      )
    ).toBe(NOT_ES);
  });
  it("control: solo Ana sirve el 5 de junio (como hoy)", () => {
    const r = answerMemoryQuery(
      Q,
      mem([F("El cumpleaños de Ana es el 5 de junio")], ANA),
      "es"
    );
    expect(r).toContain("5 de junio");
  });
  it("control: «Ana María» nombrada sirve el 5 de junio (secuencia de dos tokens)", () => {
    const r = answerMemoryQuery(
      Q,
      mem([F("El cumpleaños de Ana María es el 5 de junio")], [P("Ana María", "hija")]),
      "es"
    );
    expect(r).toContain("5 de junio");
  });
});

// ---------------------------------------------------------------- M4
// El conteo sobre fichas (F-PC60): rama nueva con su espejo
// en isMemoryStyleQuery (segunda aserción de los casos de
// conteo). Con cero fichas del parentesco la rama no
// responde: cae a la cita del hecho o al notKnown de hoy.
describe("M4 · el conteo sobre fichas (F-PC60)", () => {
  const DOS_HIJOS = mem([], [P("Leo", "hijo"), P("Max", "hijo")]);
  it("es: «¿cuántos hijos tengo?» cuenta las fichas y las nombra", () => {
    expect(answerMemoryQuery("¿cuántos hijos tengo?", DOS_HIJOS, "es")).toBe(
      "Tienes 2 hijos guardados: Leo, Max."
    );
    expect(isMemoryStyleQuery("¿cuántos hijos tengo?")).toBe(true);
  });
  it("en: «how many kids do I have?» cuenta igual", () => {
    expect(answerMemoryQuery("how many kids do I have?", DOS_HIJOS, "en")).toBe(
      "You have 2 kids saved: Leo, Max."
    );
    expect(isMemoryStyleQuery("how many kids do I have?")).toBe(true);
  });
  it("pt: «quantos filhos eu tenho?» cuenta igual", () => {
    const m = mem([], [P("Leo", "filho"), P("Max", "filho")]);
    expect(answerMemoryQuery("quantos filhos eu tenho?", m, "pt")).toBe(
      "Você tem 2 filhos guardados: Leo, Max."
    );
    expect(isMemoryStyleQuery("quantos filhos eu tenho?")).toBe(true);
  });
  it("la unión genérica: hijo e hija cuentan como «hijos»", () => {
    const m = mem([], [P("Leo", "hijo"), P("Ana", "hija")]);
    expect(answerMemoryQuery("¿cuántos hijos tengo?", m, "es")).toBe(
      "Tienes 2 hijos guardados: Leo, Ana."
    );
    expect(isMemoryStyleQuery("¿cuántos hijos tengo?")).toBe(true);
  });
  it("«¿cuántos hermanos tengo?» con una ficha sirve 1 con la palabra preguntada", () => {
    const m = mem([], [P("Pedro", "hermano")]);
    expect(answerMemoryQuery("¿cuántos hermanos tengo?", m, "es")).toBe(
      "Tienes 1 hermanos guardados: Pedro."
    );
    expect(isMemoryStyleQuery("¿cuántos hermanos tengo?")).toBe(true);
  });
  it("la forma total es: «¿cuántas personas tienes guardadas?» cuenta todas las fichas", () => {
    expect(answerMemoryQuery("¿cuántas personas tienes guardadas?", DOS_HIJOS, "es")).toBe(
      "Tienes 2 personas guardadas: Leo, Max."
    );
    expect(isMemoryStyleQuery("¿cuántas personas tienes guardadas?")).toBe(true);
  });
  it("la forma total en: «how many people do you have saved?»", () => {
    expect(answerMemoryQuery("how many people do you have saved?", DOS_HIJOS, "en")).toBe(
      "You have 2 people saved: Leo, Max."
    );
    expect(isMemoryStyleQuery("how many people do you have saved?")).toBe(true);
  });
  it("la forma total pt: «quantas pessoas você guardou?»", () => {
    expect(answerMemoryQuery("quantas pessoas você guardou?", DOS_HIJOS, "pt")).toBe(
      "Você tem 2 pessoas guardados: Leo, Max."
    );
    expect(isMemoryStyleQuery("quantas pessoas você guardou?")).toBe(true);
  });
  it("control: el conteo como hecho se sigue citando (como hoy)", () => {
    const m = mem([F("Tengo cuatro hijos")]);
    expect(answerMemoryQuery("¿cuántos hijos tengo?", m, "es")).toBe(
      "Según lo que me contaste: «Tengo cuatro hijos»."
    );
  });
  it("control: «¿cuántos perros tengo?» cita su hecho (como hoy)", () => {
    const m = mem([F("Tengo dos perros")]);
    expect(answerMemoryQuery("¿cuántos perros tengo?", m, "es")).toBe(
      "Según lo que me contaste: «Tengo dos perros»."
    );
  });
  it("control: memoria vacía → la negación honesta (como hoy)", () => {
    expect(answerMemoryQuery("¿cuántos hijos tengo?", mem([]), "es")).toBe(NOT_ES);
  });
});

// ---------------------------------------------------------------- M5
// El resto anunciado (F-PC61): los topes del resumen (6
// hechos, 4 personas) se quedan; lo que entra es la línea
// final que anuncia cuántos quedan fuera. Con todo
// enseñado no se añade ni una letra.
describe("M5 · el resto anunciado (F-PC61)", () => {
  const FACTS8 = [
    "Dato uno", "Dato dos", "Dato tres", "Dato cuatro",
    "Dato cinco", "Dato seis", "Dato siete", "Dato ocho",
  ].map(F);
  const PEOPLE5 = [
    P("Ana", "hija"), P("Leo", "hijo"), P("Max", "hijo"), P("Eva", "hija"), P("Sam", "hijo"),
  ];
  it("8 hechos y 5 personas: anuncia los 3 que quedan fuera", () => {
    const r = answerMemoryQuery("¿qué sabes de mí?", mem(FACTS8, PEOPLE5), "es");
    expect(r).toContain("…y 3 más.");
  });
  it("7 hechos y 1 persona: anuncia el único hecho fuera", () => {
    const r = answerMemoryQuery("¿qué sabes de mí?", mem(FACTS8.slice(0, 7), [P("Ana", "hija")]), "es");
    expect(r).toContain("…y 1 más.");
  });
  it("en: el anuncio sale en inglés", () => {
    const r = answerMemoryQuery("what do you know about me?", mem(FACTS8, PEOPLE5), "en");
    expect(r).toContain("…and 3 more.");
  });
  it("control: exactamente 6 hechos y 4 personas salen como hoy, sin anuncio", () => {
    const r = answerMemoryQuery("¿qué sabes de mí?", mem(FACTS8.slice(0, 6), PEOPLE5.slice(0, 4)), "es");
    expect(r).not.toContain("más.");
    expect(r).toContain("Esto es lo que me has contado:");
  });
  it("control: bajo el tope tampoco hay anuncio", () => {
    const r = answerMemoryQuery("¿qué sabes de mí?", mem(FACTS8.slice(0, 2), [P("Ana", "hija")]), "es");
    expect(r).not.toContain("más.");
  });
});
