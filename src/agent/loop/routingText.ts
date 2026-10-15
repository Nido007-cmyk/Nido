/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * routingText.ts — 0.1.42: el texto tal como lo lee el router.
 *
 * El barrido de 5 871 frases (src/eval/routerSweep.pure.ts) mostró que casi
 * ninguna orden sobrevivía a cómo se escribe de verdad en un teléfono: con
 * una muletilla delante («oye,», «por cierto,», «btw») o un espacio doble
 * fallaban recordatorios, notas, la hora, conversiones y cuentas, porque
 * cada patrón del router está anclado al inicio y espera un solo espacio.
 * En vez de parchear cientos de patrones, el texto se limpia UNA vez antes
 * de rutear:
 *
 *   - espacios repetidos → uno; sin espacio antes de «?», «!» o «.» finales;
 *   - muletillas y saludos de arranque («oye,», «por cierto,», «hey,»,
 *     «btw», «ei,», «aliás,»), aunque vengan sin espacio tras la coma.
 *
 * NO toca lo que significa: acentos, mayúsculas y signos de apertura «¿¡»
 * se quedan. «por favor» / «please» al principio también se quitan: son
 * cortesía, no parte de la orden. Si quitar la muletilla deja el mensaje
 * vacío («oye», «hey»), se devuelve el original: es un saludo, no una orden.
 */

// Muletillas que se quitan siempre (no son verbos ni contenido).
const ALWAYS = "oye|oiga|ey|hey|eh|ah|oh|porfa|por\\s+favor|please|por\\s+cierto|a\\s+prop[oó]sito|btw|by\\s+the\\s+way|ei|ali[aá]s|por\\s+falar\\s+nisso";
// Palabras que solo son muletilla con un signo detrás («mira, …», «ok, …»):
// «mira mis notas» o «hola nido» se quedan como están.
const WITH_PUNCT = "hola|buenas|bueno|mira|ok|okay|vale|nido|ol[aá]|oi|ent[aã]o|so|well";
const LEAD_FILLER_RE = new RegExp(
  `^(?:(?:(?:${ALWAYS})(?:\\s*[,.!:;]\\s*|\\s+))|(?:(?:${WITH_PUNCT})\\s*[,.!:;]\\s*))+`,
  "i",
);

export function normalizeForRouting(text: string): string {
  const original = text ?? "";
  const t = original
    .replace(/[ \t ]+/g, " ")
    .trim()
    .replace(/\s+([?!.]+)$/, "$1");
  const stripped = t.replace(LEAD_FILLER_RE, "").trim();
  // Una muletilla sola es un saludo: el texto se queda como estaba.
  if (!stripped || !/[\p{L}\p{N}]/u.test(stripped)) return t;
  return stripped;
}
