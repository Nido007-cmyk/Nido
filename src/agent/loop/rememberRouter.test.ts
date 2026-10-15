/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { extractRememberFact, extractImplicitFact, isMemoryQuery, extractDateISO, extractPerson, extractPeople, extractSelfName } from "./rememberRouter";
import { classifyIntent } from "./intent";

describe("rememberRouter: extracción determinística", () => {
  it("extrae 'recuerda que X'", () => {
    const r = extractRememberFact("recuerda que el cumpleaños de mi mamá es el 15 de marzo");
    expect(r).not.toBeNull();
    expect(r!.content).toBe("el cumpleaños de mi mamá es el 15 de marzo");
    expect(r!.category).toBe("event");
  });

  it("extrae 'recuérdame que X' (con pronombre me)", () => {
    const r = extractRememberFact(
      "Recuérdame que el cumpleaños de mi mamá es el 15 de marzo y que le gustan las orquídeas. Guárdalo en tu memoria para que me avises con tiempo."
    );
    expect(r).not.toBeNull();
    // Debe capturar el HECHO (cumpleaños/orquídeas), NO la cláusula de propósito.
    expect(r!.content).toContain("cumpleaños de mi mamá");
    expect(r!.content).toContain("orquídeas");
    expect(r!.content).not.toBe("para que me avises con tiempo.");
  });

  it("extrae 'acuérdate de que X'", () => {
    const r = extractRememberFact("acuérdate de que tengo cita con el doctor mañana");
    expect(r).not.toBeNull();
    expect(r!.content).toBe("tengo cita con el doctor mañana");
  });

  it("extrae 'no olvides que X'", () => {
    const r = extractRememberFact("no olvides que debo comprar leche");
    expect(r).not.toBeNull();
    expect(r!.content).toBe("debo comprar leche");
  });

  it("extrae 'guarda en tu memoria que X'", () => {
    const r = extractRememberFact("guarda en tu memoria que mi color favorito es el azul");
    expect(r).not.toBeNull();
    expect(r!.content).toBe("mi color favorito es el azul");
    expect(r!.category).toBe("preference");
  });

  it("extrae 'remember that X' (inglés)", () => {
    const r = extractRememberFact("remember that my dog's name is Max");
    expect(r).not.toBeNull();
    expect(r!.content).toBe("my dog's name is Max");
  });

  it("detecta categoría preference", () => {
    const r = extractRememberFact("recuerda que me gusta el café sin azúcar");
    expect(r!.category).toBe("preference");
  });

  it("detecta categoría goal", () => {
    const r = extractRememberFact("recuerda que quiero aprender piano este año");
    expect(r!.category).toBe("goal");
  });

  it("retorna null para texto sin patrón explícito", () => {
    expect(extractRememberFact("hola, ¿cómo estás?")).toBeNull();
    expect(extractRememberFact("¿qué hora es?")).toBeNull();
    expect(extractRememberFact("")).toBeNull();
  });

  it("retorna null para contenido muy corto", () => {
    // "recuerda que ok" — contenido de 2 chars, muy corto para ser útil.
    const r = extractRememberFact("recuerda que ok");
    expect(r).toBeNull();
  });

  it("es insensible a mayúsculas", () => {
    const r = extractRememberFact("RECUERDA QUE mi teléfono es 555-1234");
    expect(r).not.toBeNull();
    expect(r!.content).toBe("mi teléfono es 555-1234");
  });

  it("0.1.19: una fecha sola no es un hecho ('recuerda mañana')", () => {
    expect(extractRememberFact("recuerda mañana")).toBeNull();
    expect(extractRememberFact("recuerda hoy")).toBeNull();
    expect(extractRememberFact("recuerda el viernes")).toBeNull();
    // Con contenido real detrás de la fecha, el hecho sí se guarda.
    const r = extractRememberFact("recuerda que el cumpleaños de mi mamá es el 15 de marzo");
    expect(r).not.toBeNull();
  });

  it("0.1.19: una pregunta no es un hecho ('recuérdame cómo se llama…')", () => {
    expect(extractRememberFact("recuérdame cómo se llama la capital de Francia")).toBeNull();
    expect(extractRememberFact("recuerda qué es la fotosíntesis")).toBeNull();
  });
});

describe("rememberRouter: consultas vs guardados (FIX 2026-10-07)", () => {
  it("isMemoryQuery detecta 'recuérdame la fecha de X'", () => {
    expect(isMemoryQuery("recuérdame la fecha de cumpleaños de mi mamá")).toBe(true);
    expect(isMemoryQuery("Recuérdame cuándo es el cumpleaños de mi mamá")).toBe(true);
    expect(isMemoryQuery("¿cuándo es el cumpleaños de mi mamá?")).toBe(true);
    expect(isMemoryQuery("dime la fecha de la reunión")).toBe(true);
  });

  it("isMemoryQuery retorna false para guardados", () => {
    expect(isMemoryQuery("recuerda que mi mamá cumple el 15 de marzo")).toBe(false);
    expect(isMemoryQuery("mi mamá cumple el 15 de marzo")).toBe(false);
  });

  it("extractRememberFact retorna null para consultas (no guarda preguntas)", () => {
    // Bug 2026-10-07: guardaba "la fecha de cumpleaños de mi mamá" como hecho.
    expect(extractRememberFact("recuérdame la fecha de cumpleaños de mi mamá")).toBeNull();
    expect(extractRememberFact("¿cuándo es el cumpleaños de mi mamá?")).toBeNull();
  });

  it("extractDateISO parsea '15 de marzo'", () => {
    const iso = extractDateISO("el cumpleaños de mi mamá es el 15 de marzo");
    expect(iso).not.toBeNull();
    const d = new Date(iso!);
    expect(d.getMonth()).toBe(2); // marzo = 2
    expect(d.getDate()).toBe(15);
  });

  it("0.1.20 (M6): fechas numéricas D/M (ES) y M/D (EN), con y sin año", () => {
    const dm = extractDateISO("mi cumpleaños es el 05/11", "es");
    expect(dm).not.toBeNull();
    expect(new Date(dm!).getMonth()).toBe(10); // noviembre
    expect(new Date(dm!).getDate()).toBe(5);
    const md = extractDateISO("my birthday is 11/05", "en");
    expect(new Date(md!).getMonth()).toBe(10);
    expect(new Date(md!).getDate()).toBe(5);
    // Un lado > 12 desambigua solo, en cualquier idioma.
    const forced = extractDateISO("aniversario el 25/03", "en");
    expect(new Date(forced!).getMonth()).toBe(2);
    expect(new Date(forced!).getDate()).toBe(25);
    // Con año futuro explícito: esa fecha.
    const future = extractDateISO("la boda es el 11/05/2027", "es");
    expect(new Date(future!).getFullYear()).toBe(2027);
    expect(new Date(future!).getMonth()).toBe(4);
    // Con año pasado: sin recordatorio.
    expect(extractDateISO("nos casamos el 11/05/2020", "es")).toBeNull();
    // Un decimal no es una fecha.
    expect(extractDateISO("el coche cuesta 3.5 mil", "es")).toBeNull();
    // Fecha imposible.
    expect(extractDateISO("el 31/02", "es")).toBeNull();
  });

  it("extractDateISO retorna null sin fecha", () => {
    expect(extractDateISO("me gustan las orquídeas")).toBeNull();
  });
});

describe("rememberRouter: extracción de personas (PEOPLE-FIX 2026-10-07)", () => {
  it("extrae 'mi mamá se llama María'", () => {
    const r = extractPerson("mi mamá se llama María");
    expect(r).not.toBeNull();
    expect(r!.name).toBe("María");
    expect(r!.relationship).toBe("mamá");
  });

  it("extrae 'mi hermano se llama Juan Pérez'", () => {
    const r = extractPerson("mi hermano se llama Juan Pérez");
    expect(r).not.toBeNull();
    expect(r!.name).toBe("Juan Pérez");
    expect(r!.relationship).toBe("hermano");
  });

  it("retorna null sin patrón de persona", () => {
    expect(extractPerson("hola, ¿cómo estás?")).toBeNull();
    expect(extractPerson("recuerda que debo comprar leche")).toBeNull();
  });
});

describe("0.1.20 — personas como se escribe de verdad (evidencia Tab A9+)", () => {
  it("extrae 'Mi mama se llama Marta' SIN acento (la frase exacta de la tablet)", () => {
    const r = extractPerson("Mi mama se llama Marta");
    expect(r).not.toBeNull();
    expect(r!.name).toBe("Marta");
    expect(r!.relationship).toBe("mamá");
  });

  it("acepta parentescos sin acento y nombre en minúscula", () => {
    expect(extractPerson("mi papa se llama jose")?.name).toBe("Jose");
    expect(extractPerson("mi papa se llama jose")?.relationship).toBe("papá");
    expect(extractPerson("mi tio se llama raul")?.relationship).toBe("tío");
    expect(extractPerson("mi hermana se llama ana maría")?.name).toBe("Ana María");
    expect(extractPerson("recuerda que mi hermano juan cumple años en mayo")?.name).toBe("Juan");
  });

  it("no captura palabras que no son nombre", () => {
    expect(extractPerson("mi mamá se llama como su abuela")).toBeNull();
    expect(extractPerson("mi mamá se llama bien")).toBeNull();
  });

  it("una pregunta sobre la persona no crea la ficha", () => {
    expect(extractPerson("¿cómo se llama mi mamá?")).toBeNull();
    expect(extractPerson("¿mi mamá se llama Marta?")).toBeNull();
  });

  it("inglés con nombre en minúscula", () => {
    expect(extractPerson("my mom is called mary")?.name).toBe("Mary");
  });

  it("portugués: 'minha mae se chama Maria' sin acentos", () => {
    const r = extractPerson("minha mae se chama maria");
    expect(r).not.toBeNull();
    expect(r!.name).toBe("Maria");
    expect(r!.relationship).toBe("mãe");
    expect(extractPerson("meu irmão se chama João")?.name).toBe("João");
  });
});

describe("0.1.20 — M4/M5/M3: anclaje, parentescos, plural, «guarda que»", () => {
  it("M4: la cadena posesiva no roba la relación", () => {
    expect(extractPerson("la esposa de mi hermano se llama Laura")).toBeNull();
  });

  it("M4: «recuerda que mi mamá se llama Marta» sí guarda (y no captura «se»)", () => {
    const r = extractPerson("recuerda que mi mamá se llama Marta");
    expect(r?.name).toBe("Marta");
    expect(r?.relationship).toBe("mamá");
  });

  it("M5: parentescos que faltaban", () => {
    expect(extractPerson("mi cuñado se llama Pedro")?.relationship).toBe("cuñado");
    expect(extractPerson("mi cunada se llama Lucia")?.relationship).toBe("cuñada");
    expect(extractPerson("mi suegra se llama Carmen")?.relationship).toBe("suegra");
    expect(extractPerson("mi nieto se llama Leo")?.relationship).toBe("nieto");
    expect(extractPerson("mi mejor amigo se llama Diego")?.relationship).toBe("mejor amigo");
  });

  it("M5: plural «mis hijos se llaman Leo y Max» crea dos fichas", () => {
    const people = extractPeople("mis hijos se llaman Leo y Max");
    expect(people.map((p) => p.name)).toEqual(["Leo", "Max"]);
    expect(people[0].relationship).toBe("hijo");
  });

  it("M3: «guarda que X» guarda el hecho", () => {
    expect(extractRememberFact("guarda que mi coche es un Toyota")?.content).toBe("mi coche es un Toyota");
    expect(extractRememberFact("guardate que vivo en Tucson")?.content).toBe("vivo en Tucson");
  });
});

describe("0.1.20 — M2: hechos implícitos acotados", () => {
  it("guarda las afirmaciones de la sonda", () => {
    expect(extractImplicitFact("mi cumpleaños es el 3 de mayo")?.category).toBe("event");
    expect(extractImplicitFact("mi coche es un Toyota")?.content).toBe("mi coche es un Toyota");
    expect(extractImplicitFact("vivo en Tucson")?.content).toBe("vivo en Tucson");
    expect(extractImplicitFact("mi color favorito es el azul")?.category).toBe("preference");
    expect(extractImplicitFact("el cumpleaños de mi mamá es el 15 de marzo")?.category).toBe("event");
    expect(extractImplicitFact("trabajo de noche")?.content).toBe("trabajo de noche");
    expect(extractImplicitFact("my car is a Toyota")?.content).toBe("my car is a Toyota");
    expect(extractImplicitFact("meu carro é um Toyota")?.content).toBe("meu carro é um Toyota");
  });

  it("fail-closed: sensibles, preguntas y charla no se guardan", () => {
    expect(extractImplicitFact("mi número de cuenta es 4521")).toBeNull();
    expect(extractImplicitFact("mi teléfono es 5551234567")).toBeNull();
    expect(extractImplicitFact("¿mi coche es un Toyota?")).toBeNull();
    expect(extractImplicitFact("el coche es un Toyota")).toBeNull();
    expect(extractImplicitFact("mi perro es muy bonito y juega mucho en el parque")).toBeNull();
    expect(extractImplicitFact("qué bonito día hace hoy")).toBeNull();
  });
});

describe("0.1.20 — presentación del propio usuario (evidencia Tab A9+)", () => {
  it("extrae 'Yo me llamo Ruben'", () => {
    expect(extractSelfName("Yo me llamo Ruben")).toBe("Ruben");
    expect(extractSelfName("yo me llamo ruben")).toBe("Ruben");
    expect(extractSelfName("me llamo Ruben")).toBe("Ruben");
    expect(extractSelfName("mi nombre es Ruben")).toBe("Ruben");
  });

  it("tolera el autocorrector: 'You me llamo Ruben' y saludos", () => {
    expect(extractSelfName("You me llamo Ruben")).toBe("Ruben");
    expect(extractSelfName("hola, me llamo Ruben")).toBe("Ruben");
  });

  it("inglés y portugués", () => {
    expect(extractSelfName("my name is Ruben")).toBe("Ruben");
    expect(extractSelfName("meu nome é Ruben")).toBe("Ruben");
    expect(extractSelfName("eu me chamo Ruben")).toBe("Ruben");
  });

  it("no confunde frases que mencionan un nombre de paso", () => {
    expect(extractSelfName("me llamo la atención ese anuncio")).toBeNull();
    expect(extractSelfName("¿cómo me llamo?")).toBeNull();
    expect(extractSelfName("mi mamá se llama Marta")).toBeNull();
    expect(extractSelfName("hola")).toBeNull();
  });
});

describe("0.1.14 — memoria en portugués", () => {
  it("lembre que / me lembra que / não esqueça que", () => {
    expect(extractRememberFact("lembre que minha cor favorita é azul")?.content).toBe("minha cor favorita é azul");
    expect(extractRememberFact("lembre que o aniversário da minha mãe é 15 de março")?.content).toBe(
      "o aniversário da minha mãe é 15 de março"
    );
    expect(extractRememberFact("não esqueça que tenho dentista na sexta")?.content).toBe("tenho dentista na sexta");
  });
});

// Batería trilingüe 0.1.20: el cumpleaños implícito PT («meu aniversário»)
// no se guardaba y los meses PT con letras no parseaban («15 de março»
// devolvía null → sin recordatorio automático de cumpleaños en PT).
describe("batería trilingüe: cumpleaños y fechas PT", () => {
  it("el cumpleaños implícito PT se guarda", () => {
    expect(extractImplicitFact("meu aniversário é 3 de maio")?.content).toBe("meu aniversário é 3 de maio");
    expect(extractImplicitFact("o aniversário da minha mãe é 15 de março")).not.toBeNull();
  });
  it("los meses PT con letras parsean", () => {
    expect(extractDateISO("15 de março")).not.toBeNull();
    expect(extractDateISO("3 de maio")).not.toBeNull();
    expect(extractDateISO("meu aniversário é 10 de janeiro")).not.toBeNull();
    expect(extractDateISO("o aniversário é 25 de dezembro")).not.toBeNull();
  });
});

describe("0.1.41 — «ten en cuenta que…» (prueba física: caía al modelo y fallaba)", () => {
  it.each([
    ["ten en cuenta que llueve mañana", "llueve mañana"],
    ["Ten en cuenta que mi perro se llama Toby", "mi perro se llama Toby"],
    ["tenga en cuenta que soy alérgico a las nueces", "soy alérgico a las nueces"],
    ["ten muy en cuenta que el lunes cierro tarde", "el lunes cierro tarde"],
    ["ten en cuenta esto: la clave del wifi está en la nevera", "la clave del wifi está en la nevera"],
    ["keep in mind that my sister lives in Lima", "my sister lives in Lima"],
    ["please keep in mind I don't eat pork", "I don't eat pork"],
    ["tenha em mente que eu trabalho de noite", "eu trabalho de noite"],
    ["leve em conta que minha mãe faz anos em maio", "minha mãe faz anos em maio"],
  ])("%s → guarda «%s»", (input, content) => {
    expect(extractRememberFact(input)?.content).toBe(content);
    expect(classifyIntent(input)).toBe("recordar");
  });

  it.each([
    "hay que tener en cuenta que el clima cambia", // no es una orden
    "no tuvieron en cuenta que llovía",
    "si tienes en cuenta que es tarde, ¿vale la pena ir?",
    "I can't keep in mind so many things",
    "anota que mañana hay reunión", // es una nota (toolRouter), no un recuerdo
  ])("«%s» no se guarda como recuerdo", (input) => {
    expect(extractRememberFact(input)).toBeNull();
  });
});

describe("0.1.41 — «a partir de ahora…» se guarda como preferencia (caía al modelo y daba la hora)", () => {
  it.each([
    ["A partir de Ahora hablame de usted", "A partir de Ahora hablame de usted"],
    ["a partir de ahora, respóndeme corto", "a partir de ahora, respóndeme corto"],
    ["de ahora en adelante llámame Aldo", "de ahora en adelante llámame Aldo"],
    ["from now on answer in English", "from now on answer in English"],
    ["a partir de agora me chama de você", "a partir de agora me chama de você"],
  ])("%s", (input, content) => {
    const r = extractRememberFact(input);
    expect(r?.content).toBe(content);
    expect(r?.category).toBe("preference");
    // Entra al asistente (recordar o actuar: «llámame» suena a acción); la
    // extracción corre igual en los dos casos.
    expect(["recordar", "actuar"]).toContain(classifyIntent(input));
  });

  it.each(["a partir de ahora", "¿qué pasa a partir de ahora?", "el precio sube a partir de ahora"])("«%s» no", (input) => {
    expect(extractRememberFact(input)).toBeNull();
  });
});

describe("0.1.41 — «que no se te olvide que…» (iba a conversación)", () => {
  it.each([
    ["Que no se te olvide  que el martes pago la renta", "el martes pago la renta"],
    ["no se te olvide que mi hija sale a las 3", "mi hija sale a las 3"],
    ["que no se te pase que el gas se paga el 5", "el gas se paga el 5"],
  ])("%s", (input, content) => {
    expect(extractRememberFact(input)?.content).toBe(content);
    expect(classifyIntent(input)).toBe("recordar");
  });
});
it("dos espacios no rompen «ten en cuenta que»", () => { expect(extractRememberFact("ten en cuenta  que llueve")?.content).toBe("llueve"); });

describe("0.1.41 — dieta y alergias propias, también con muletilla delante", () => {
  it.each([
    ["Por cierto,soy vegetariano", "Soy vegetariano"],
    ["soy vegana", "Soy vegana"],
    ["oye, soy alérgico a las nueces", "Soy alérgico a las nueces"],
    ["tengo alergia al polen", "Tengo alergia al polen"],
    ["no como cerdo", "No como cerdo"],
    ["btw I'm vegetarian", "I'm vegetarian"],
    ["I am allergic to peanuts", "I am allergic to peanuts"],
    ["sou vegetariano", "Sou vegetariano"],
    ["tenho alergia a camarão", "Tenho alergia a camarão"],
  ])("%s → «%s»", (input, content) => {
    expect(extractImplicitFact(input)).toEqual({ content, category: "preference" });
    expect(classifyIntent(input)).toBe("recordar");
  });

  it("la muletilla tampoco estorba a los datos que ya se guardaban", () => {
    expect(extractImplicitFact("Por cierto, mi perro se llama Toby")?.content).toBe("mi perro se llama Toby");
  });

  it.each(["soy vegetariano?", "¿eres vegetariano?", "soy muy feliz", "no como nada hoy", "soy alérgico a que me griten todo el día en el trabajo y luego"])(
    "«%s» no",
    (input) => {
      expect(extractImplicitFact(input)).toBeNull();
    },
  );
});
