/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Minería de acrónimos de las guías (bounty, tanda 8; método de
// minería de alias de Bivouac, MIT, implementado desde cero para
// las guías de NIDO). Las guías nombran las cosas por su acrónimo
// —RCP, DEA— y el usuario pregunta por el nombre entero
// («reanimación cardiopulmonar»): cada par acrónimo↔definición que
// el propio texto de la guía declara es una variante de búsqueda
// candidata (el mecanismo `<!-- preguntas: … -->` del constructor).
// Esta lib extrae los pares; la herramienta que la usa produce un
// INFORME para el carril de packs. No cambia la recuperación por
// sí sola y no pretende: minar no es registrar.
//
// Patrones (los dos que las guías usan de verdad):
//   1. «reanimación cardiopulmonar (RCP)» — definición y acrónimo.
//   2. «DEA (desfibrilador externo automático)» — al revés.
// Ruido fuera: años entre paréntesis, referencias («(ver guía de
// RCP)») y los propios comentarios de variantes (se pelan antes).

const ACRONYM = /^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9-]{1,5}$/;
const ROMAN = /^(I|II|III|IV|V|VI|VII|VIII|IX|X)$/;

const fold = (s) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

/** ¿Parece una definición y no una referencia, un año o un acrónimo suelto? */
function looksLikeDefinition(text) {
  const t = text.trim();
  if (t.length < 3 || t.length > 70) return false;
  if (/\d/.test(t)) return false;
  if (!/^[a-záéíóúñü][a-záéíóúñü ,-]*$/i.test(t)) return false;
  if (/^(ver|see|véase|ver guía|ver la|capítulo|chapter)\b/i.test(t)) return false;
  return true;
}

function cleanDefinition(text) {
  return text.trim().replace(/\s+/g, " ");
}

/**
 * Los pares {acronym, definition} que un texto declara, sin
 * duplicados (misma pareja plegada una sola vez).
 */
export function extractAcronymPairs(text) {
  // NFC primero: con acentos descompuestos (o + tilde combinante)
  // las clases de caracteres parten las palabras por la mitad.
  const noComments = String(text).normalize("NFC").replace(/<!--[\s\S]*?-->/g, " ");
  const found = new Map();
  const add = (acronym, definition) => {
    const acr = acronym.trim();
    if (!ACRONYM.test(acr) || ROMAN.test(acr)) return;
    const def = cleanDefinition(definition);
    if (!looksLikeDefinition(def)) return;
    // Una «definición» de una sola palabra corta es un fragmento de
    // URL o de frase («gov» de fema.gov), no un nombre.
    if (!def.includes(" ") && def.length < 4) return;
    const key = `${acr}|${fold(def)}`;
    if (!found.has(key)) found.set(key, { acronym: acr, definition: def });
  };

  // Patrón 1: hasta 6 palabras antes del paréntesis con el acrónimo.
  // La definición es la cola nominal de la captura: se pelan por la
  // izquierda los verbos y nexos que abren frase («empieza la
  // reanimación cardiopulmonar (RCP)» → la definición es el nombre,
  // no el verbo).
  const p1 = /([A-Za-zÁÉÍÓÚÑáéíóúñü][A-Za-zÁÉÍÓÚÑáéíóúñü-]*(?:\s+(?:[A-Za-zÁÉÍÓÚÑáéíóúñü][A-Za-zÁÉÍÓÚÑáéíóúñü-]*)){0,5})\s*\(([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9-]{1,5})\)/g;
  const STOP_LEAD = new Set([
    "empieza", "empiecen", "comienza", "comiencen", "es", "son", "era", "llama", "llaman", "llamen",
    "usa", "usan", "use", "uses", "busca", "busque", "busquen", "buscar", "pide", "pidan", "pedir",
    "trae", "traigan", "consigue", "encuentra", "aplica", "apliquen", "realiza", "realicen", "haz",
    "hagan", "ponte", "pongan", "sigue", "sigan", "called", "named", "que", "si", "no", "y", "o", "pero",
    "and", "or", "to", "find", "bring", "get", "call", "ask", "send", "another", "someone", "go",
    "otra", "otro", "alguien",
  ]);
  const ARTICLES = new Set(["el", "la", "los", "las", "un", "una", "unos", "unas", "the", "a", "an"]);
  for (const m of noComments.matchAll(p1)) {
    const words = m[1].trim().split(/\s+/);
    // Verbos, nexos y artículos se pelan entrelazados («otra que
    // busque un desfibrilador» → «desfibrilador»).
    while (words.length > 1 && (STOP_LEAD.has(fold(words[0])) || ARTICLES.has(fold(words[0])))) words.shift();
    add(m[2], words.join(" "));
  }

  // Patrón 2: acrónimo y su definición entre paréntesis.
  const p2 = /(?:^|[\s(>])([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9-]{1,5})\s*\(([^)]{3,70})\)/g;
  for (const m of noComments.matchAll(p2)) {
    if (m[2].trim().split(/\s+/).length >= 2) add(m[1], m[2]);
  }

  return [...found.values()].sort((a, b) => a.acronym.localeCompare(b.acronym) || a.definition.localeCompare(b.definition));
}

/**
 * Agrega los pares de muchas guías: por pareja, en cuántas guías
 * sale y un ejemplo; y si la definición ya vive en las variantes
 * registradas del pack (los comentarios preguntas/questions/
 * perguntas de todas sus guías).
 */
export function mineGuides(guides) {
  const variantsText = fold(
    guides
      .map((g) => [...String(g.text).matchAll(/<!--\s*(?:preguntas|questions|perguntas)\s*:\s*(.*?)-->/gi)].map((m) => m[1]).join("\n"))
      .join("\n")
  );
  const byKey = new Map();
  for (const guide of guides) {
    for (const pair of extractAcronymPairs(guide.text)) {
      const key = `${pair.acronym}|${fold(pair.definition)}`;
      const row = byKey.get(key) ?? { ...pair, guides: 0, example: guide.name, inVariants: variantsText.includes(fold(pair.definition)) };
      row.guides += 1;
      byKey.set(key, row);
    }
  }
  return [...byKey.values()].sort((a, b) => b.guides - a.guides || a.acronym.localeCompare(b.acronym));
}
