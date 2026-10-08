import { describe, it, expect } from "vitest";
import { extractRememberFact, isMemoryQuery, extractDateISO, extractPerson } from "./rememberRouter";

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
