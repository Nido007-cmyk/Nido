import { describe, it, expect } from "vitest";
import { extractRememberFact } from "./rememberRouter";

describe("rememberRouter: extracción determinística", () => {
  it("extrae 'recuerda que X'", () => {
    const r = extractRememberFact("recuerda que el cumpleaños de mi mamá es el 15 de marzo");
    expect(r).not.toBeNull();
    expect(r!.content).toBe("el cumpleaños de mi mamá es el 15 de marzo");
    expect(r!.category).toBe("event");
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
