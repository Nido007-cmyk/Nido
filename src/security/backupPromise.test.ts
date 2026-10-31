/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Auditoría completa 2026-10-31 (F3-06, decisión del dueño del mismo
// día): la confirmación de restaurar prometía «TODOS tus datos» y el
// respaldo guarda solo las dos bases (createBackup copia
// nido_memory.db y nido_knowledge.db). La banca eligió la opción que
// la orden del dueño permite y el diseño manda: corregir la promesa
// en las tres lenguas en vez de exportar lo que no debe salir. La
// alternativa descartada (meter las claves privadas P2P y los
// ajustes en el respaldo) rompe el diseño fail-closed de la
// identidad NIDO a NIDO, que pierde la identidad a propósito en un
// teléfono nuevo, y trasplantaría elecciones del dispositivo (el
// modelo activo) que no son seguras en otro teléfono.
//
// Esta prueba fija el texto honesto: cada lengua nombra el alcance
// real (chats, documentos, conocimiento) y las tres exclusiones
// (ajustes y herramientas apagadas, identidad, paquetes), y ninguna
// conserva la promesa de «todos».

import { describe, it, expect } from "vitest";
import es from "../i18n/locales/es.json";
import en from "../i18n/locales/en.json";
import pt from "../i18n/locales/pt.json";

type Locale = typeof es;
const locales: Array<[string, Locale]> = [
  ["es", es as Locale],
  ["en", en as Locale],
  ["pt", pt as Locale],
];

const EXCLUSIONS: Record<string, [RegExp, RegExp, RegExp]> = {
  // ajustes/herramientas · identidad · paquetes
  es: [/ajustes/, /identidad NIDO a NIDO/, /paquetes descargados/],
  en: [/settings/, /NIDO-to-NIDO identity/, /downloaded packs/],
  pt: [/configurações/, /identidade NIDO a NIDO/, /pacotes baixados/],
};
const SCOPE: Record<string, RegExp> = {
  es: /chats, notas, documentos y conocimiento/,
  en: /chats, notes, documents and knowledge/,
  pt: /conversas, notas, documentos e conhecimento/,
};
const ALL_CLAIM: Record<string, RegExp> = {
  es: /TODOS tus datos|TODOS os/,
  en: /ALL your current data|ALL your data/,
  pt: /TODOS os seus dados/,
};

describe("promesa del respaldo (F3-06)", () => {
  it.each(locales)("%s: la confirmación nombra el alcance real y lo que no viaja", (_name, loc) => {
    const lang = _name;
    for (const key of ["restoreConfirm", "restoreConfirmDated"] as const) {
      const text = (loc.backup as unknown as Record<string, string>)[key];
      expect(text, `${lang}.${key}`).toMatch(SCOPE[lang]);
      for (const re of EXCLUSIONS[lang]) expect(text, `${lang}.${key}`).toMatch(re);
      expect(text, `${lang}.${key}`).not.toMatch(ALL_CLAIM[lang]);
    }
  });

  it.each(locales)("%s: restaurar con clave ya no promete «todos» y declara las exclusiones", (_name, loc) => {
    const text = (loc.backup as unknown as Record<string, string>).restoreWithKeyBody;
    expect(text).toMatch(SCOPE[_name]);
    expect(text).not.toMatch(ALL_CLAIM[_name]);
  });

  it.each(locales)("%s: la versión con fecha conserva sus marcadores", (_name, loc) => {
    const text = (loc.backup as unknown as Record<string, string>).restoreConfirmDated;
    expect(text).toContain("{{date}}");
    expect(text).toContain("{{made}}");
  });
});
