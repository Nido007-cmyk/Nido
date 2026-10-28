/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
import { describe, it, expect } from "vitest";
import { filterByTitle, foldSearch, matchesSearch } from "./search";

describe("búsqueda en historial y ajustes (0.1.55)", () => {
  it("ignora tildes, mayúsculas y espacios de más", () => {
    expect(foldSearch("  Investigación   PROFUNDA ")).toBe("investigacion profunda");
    expect(matchesSearch("investigacion", "Investigación profunda")).toBe(true);
  });

  it("cada palabra debe aparecer, en cualquier orden y en cualquiera de los textos", () => {
    expect(matchesSearch("voz lectura", "Apariencia, idioma y voz", "Lectura en voz alta")).toBe(true);
    expect(matchesSearch("voz tema", "Lectura en voz alta")).toBe(false);
  });

  it("sin búsqueda, todo coincide y la lista no cambia", () => {
    const chats = [{ title: "Quemaduras: qué hacer" }, { title: "Lista de la mochila" }];
    expect(matchesSearch("", "x")).toBe(true);
    expect(filterByTitle(chats, " ")).toBe(chats);
    expect(filterByTitle(chats, "MOCHILA").map((c) => c.title)).toEqual(["Lista de la mochila"]);
  });
});
