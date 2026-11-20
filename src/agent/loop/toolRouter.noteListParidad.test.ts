// Herencia de H-GUIA-1 (barrido ampliado del paquete de arreglos
// del móvil): la lista de notas rompía su anclaje con el adjetivo
// de guardado y le faltaba «as minhas» — «qué notas tengo
// guardadas», «what notes do i have saved», «as minhas notas» y
// «que notas eu tenho salvas» caían fuera de la ruta determinista
// teniendo las notas guardadas. Las formas de siempre no cambian.
import { describe, expect, it } from "vitest";
import { extractToolAction } from "./toolRouter";

const NOW = new Date(2026, 10, 3, 12, 0, 0);

describe("noteList: el adjetivo de guardado y «as minhas» (H-GUIA-1)", () => {
  it.each([
    ["¿qué notas tengo guardadas?", "es"],
    ["what notes do i have saved?", "en"],
    ["mostra as minhas notas", "pt"],
    ["que notas eu tenho salvas?", "pt"],
    ["que notas tenho salvas?", "pt"],
  ])("«%s» → noteList/%s", (text, lang) => {
    expect(extractToolAction(text, NOW)).toEqual({ kind: "noteList", lang });
  });
  it.each([
    ["¿qué notas tengo?", "es"],
    ["what notes do i have?", "en"],
    ["mostra minhas notas", "pt"],
    ["quais notas eu tenho?", "pt"],
  ])("control: «%s» → noteList/%s, como siempre", (text, lang) => {
    expect(extractToolAction(text, NOW)).toEqual({ kind: "noteList", lang });
  });
});
