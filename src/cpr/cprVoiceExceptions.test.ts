// Práctica de RCP (0.1.76) — F-2 (auditoría adversaria,
// 2026-11-06): la prueba de fidelidad (cprCoach.test.ts) compara
// el texto de la guía línea a línea, pero la pantalla también
// habla y pinta unas frases cortas que NO son líneas de la guía:
// las etiquetas de fase de la voz y las correcciones del medidor,
// escritas en los ficheros de idioma. Esta prueba las fija como
// LISTA DE EXCEPCIÓN REVISADA: cada cadena, en las tres lenguas,
// comparada contra la lista asentada aquí. Cambiar una de estas
// frases hace fallar esta prueba y fuerza una revisión con
// nombre, igual que la de fidelidad fuerza la de la guía. Una
// frase hablada NUEVA tampoco puede colarse sin nombre: el censo
// de claves de voz y corrección de la pantalla debe ser
// exactamente el de la lista.
//
// Qué es cada pieza y por qué es excepción y no guía:
// - cpr.voice.breaths / cpr.voice.compressions: etiquetas de fase
//   que la voz anuncia al cambiar de bloque. La guía describe la
//   fase; no trae una etiqueta de dos palabras para anunciarla.
// - cpr.cue.faster / cpr.cue.slower / cpr.cue.good: correcciones
//   del medidor de ritmo por cámara, texto de la función del
//   medidor, no de primeros auxilios.
// - cpr.notForBabies: PARÁFRASIS DECLARADA de la pantalla. La
//   nota «Importante» de la guía no contiene el aviso de alcance
//   (la práctica sigue la guía de adultos y niños mayores; bebés
//   y niños pequeños tienen otra guía), así que no se sustituye
//   por el texto de la guía: se queda como paráfrasis asentada,
//   bajo esta misma disciplina.
import { describe, expect, it } from "vitest";
import es from "../i18n/locales/es.json";
import en from "../i18n/locales/en.json";
import pt from "../i18n/locales/pt.json";
import { CPR_GUIDE, type CprLang } from "./cprCoach";

const LOCALES: Record<CprLang, unknown> = { es, en, pt };

function cprString(lang: CprLang, dottedKey: string): string {
  let node: unknown = (LOCALES[lang] as { cpr: unknown }).cpr;
  for (const part of dottedKey.replace(/^cpr\./, "").split(".")) {
    node = (node as Record<string, unknown>)[part];
  }
  return node as string;
}

function cprKeys(lang: CprLang, section: "voice" | "cue"): string[] {
  const block = (LOCALES[lang] as { cpr: Record<string, Record<string, unknown>> }).cpr[section];
  return Object.keys(block).map((k) => `cpr.${section}.${k}`).sort();
}

/** La lista de excepción revisada: clave → texto asentado por lengua. */
const EXCEPTIONS: Record<string, Record<CprLang, string>> = {
  "cpr.voice.breaths": {
    es: "Dos respiraciones.",
    en: "Two breaths.",
    pt: "Duas respirações.",
  },
  "cpr.voice.compressions": {
    es: "Compresiones.",
    en: "Compressions.",
    pt: "Compressões.",
  },
  "cpr.cue.faster": {
    es: "Más rápido.",
    en: "Faster.",
    pt: "Mais rápido.",
  },
  "cpr.cue.slower": {
    es: "Más despacio.",
    en: "Slower.",
    pt: "Mais devagar.",
  },
  "cpr.cue.good": {
    es: "Buen ritmo, sigue así.",
    en: "Good rate, keep going.",
    pt: "Bom ritmo, continue assim.",
  },
  "cpr.notForBabies": {
    es: "Esta práctica sigue la guía de adultos y niños mayores. Bebés y niños pequeños tienen otra guía: pregúntale a NIDO por la RCP en bebés. Aprende RCP en un curso práctico, y en una emergencia llama al número de emergencias.",
    en: "This practice follows the guide for adults and older children. Babies and small children have their own guide: ask NIDO about CPR for babies. Learn CPR in a hands-on course, and in an emergency call your emergency number.",
    pt: "Esta prática segue o guia de adultos e crianças maiores. Bebês e crianças pequenas têm outro guia: pergunte ao NIDO sobre RCP em bebês. Aprenda RCP em um curso prático e, numa emergência, ligue para o número de emergência.",
  },
};

describe("F-2: las frases que no son de la guía, fijadas como excepción revisada", () => {
  it("cada cadena de la excepción es exactamente la asentada, en las tres lenguas", () => {
    for (const [key, byLang] of Object.entries(EXCEPTIONS)) {
      for (const lang of ["es", "en", "pt"] as const) {
        expect(cprString(lang, key), `${key} (${lang})`).toBe(byLang[lang]);
      }
    }
  });

  it("el censo cierra: la pantalla no habla ninguna frase de voz o corrección fuera de la lista", () => {
    const listed = Object.keys(EXCEPTIONS)
      .filter((k) => k.startsWith("cpr.voice.") || k.startsWith("cpr.cue."))
      .sort();
    for (const lang of ["es", "en", "pt"] as const) {
      const spoken = [...cprKeys(lang, "voice"), ...cprKeys(lang, "cue")].sort();
      expect(spoken, lang).toEqual(listed);
    }
  });

  it("la excepción es excepción: ninguna de estas frases se disfraza de línea de la guía", () => {
    for (const lang of ["es", "en", "pt"] as const) {
      const g = CPR_GUIDE[lang];
      const guideLines = new Set([
        ...g.before,
        ...g.compressions,
        ...g.breaths,
        ...g.stop,
        g.switchLine,
      ]);
      for (const key of Object.keys(EXCEPTIONS)) {
        expect(guideLines.has(EXCEPTIONS[key][lang]), `${key} (${lang})`).toBe(false);
      }
    }
  });
});
