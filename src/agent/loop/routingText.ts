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
 * Casi no toca lo que significa: acentos, mayúsculas y signos de apertura
 * «¿¡» se quedan. «por favor» / «please» al principio también se quitan:
 * son cortesía, no parte de la orden. Si quitar la muletilla deja el
 * mensaje vacío («oye», «hey»), se devuelve el original: es un saludo, no
 * una orden. La única excepción es acotada (N-04, al final del fichero):
 * un typo de dictado en el verbo gatillo de arranque se repara hacia su
 * forma canónica cuando es inconfundible — no es una palabra real, hay
 * un único candidato a distancia de edición 1 (la sustitución exige
 * teclas vecinas en QWERTY, la misma doctrina que fixRelationWord) y
 * detrás viene contexto de orden.
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
  return repairTriggerTypo(stripped);
}

// ————————————————————————————————————————————————————————————————————
// N-04: reparación acotada del verbo gatillo (typos de dictado).
//
// Medido: un typo en el verbo deja la frase fuera de TODO patrón y cae
// al modelo («Recueda que tengo sita el lunes» ni siquiera extraía, por
// el typo segundo en «sita»). La reparación vive aquí porque
// normalizeForRouting es el único paso que ven todos los consumidores
// del router. Candados, todos a la vez o no se toca nada:
//   · posición: primera palabra, o segunda tras negación (no/não);
//   · la palabra NO es una palabra real (recuerdo, acuerdo, olvido…)
//     ni ya canónica;
//   · un ÚNICO canónico a distancia de edición 1; la sustitución exige
//     teclas vecinas en QWERTY (inserciones y borrados, libres) — la
//     doctrina de fixRelationWord (rememberRouter);
//   · detrás viene contexto de orden: que | infinitivo | de | that |
//     to; si el canónico es «recuerdas» (forma de consulta), una
//     palabra interrogativa.
// El typo en mitad de frase no se toca: ahí repararlo sería adivinar.
/** Formas canónicas (plegadas) hacia las que se puede reparar. */
const TRIGGER_VERBS: readonly string[] = [
  "recuerda", "recuerdame", "recuerdas", "acuerdate",
  "olvida", "olvidate", "olvides",
  "guarda", "memoriza",
  "lembra", "lembre",
  "remember",
];
/** Palabras reales que jamás se «reparan»: son habla, no typos. */
const REAL_TRIGGER_WORDS: ReadonlySet<string> = new Set([
  "recuerdo", "recuerdos", "recordando", "recordar", "recordaba",
  "recuerde", "recuerden", "acuerdo", "acuerdos",
  "olvido", "olvidos", "olvidando", "olvidar", "olvidado", "olvidada",
  "guardando", "guardar", "guardado", "guardada",
  "memorizando", "memorizar", "lembrando", "lembrar",
]);
const ORDER_CONTEXT_TOKENS: ReadonlySet<string> = new Set(["que", "de", "that", "to"]);
const QUERY_CONTEXT_TOKENS: ReadonlySet<string> = new Set([
  "cuando", "como", "cual", "donde", "quien", "que",
  "when", "what", "how", "where", "who", "which",
  "quando", "qual", "quem",
]);
// Espejo local de las filas de fixRelationWord (rememberRouter).
const QWERTY_ROWS_N04 = ["qwertyuiop", "asdfghjklñ", "zxcvbnm"];

function foldLoose(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function areQwertyNeighborsN04(a: string, b: string): boolean {
  for (const row of QWERTY_ROWS_N04) {
    const ia = row.indexOf(a);
    const ib = row.indexOf(b);
    if (ia >= 0 && ib >= 0) return Math.abs(ia - ib) === 1;
  }
  return false;
}

/** Distancia de edición exactamente 1 con la doctrina de la casa. */
function isOneEditTypo(w: string, canonical: string): boolean {
  if (w === canonical) return false;
  const lw = w.length;
  const lc = canonical.length;
  if (Math.abs(lw - lc) > 1) return false;
  if (lw === lc) {
    let diffs = 0;
    for (let i = 0; i < lw; i++) {
      if (w[i] !== canonical[i]) {
        diffs++;
        if (diffs > 1) return false;
        if (!areQwertyNeighborsN04(w[i], canonical[i])) return false;
      }
    }
    return diffs === 1;
  }
  // Inserción o borrado: quitar un carácter de la larga da la corta.
  const longer = lw > lc ? w : canonical;
  const shorter = lw > lc ? canonical : w;
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < longer.length && j < shorter.length) {
    if (longer[i] === shorter[j]) {
      i++;
      j++;
    } else {
      if (skipped) return false;
      skipped = true;
      i++;
    }
  }
  return true;
}

export function repairTriggerTypo(text: string): string {
  const words = text.split(" ");
  if (words.length < 2) return text;
  let idx = 0;
  const firstFolded = foldLoose(words[0].replace(/^[¿¡]+/, "").replace(/[.,;:!?]+$/, ""));
  if (firstFolded === "no" || firstFolded === "nao") idx = 1;
  if (idx >= words.length - 1) return text; // sin contexto detrás no hay orden
  const raw = words[idx];
  const lead = /^[¿¡]*/.exec(raw)?.[0] ?? "";
  const body = raw.slice(lead.length);
  const suffix = /[.,;:!?]+$/.exec(body)?.[0] ?? "";
  const core = body.slice(0, body.length - suffix.length);
  const folded = foldLoose(core);
  if (folded.length < 4) return text;
  if (REAL_TRIGGER_WORDS.has(folded) || TRIGGER_VERBS.includes(folded)) return text;
  const next = foldLoose((words[idx + 1] ?? "").replace(/^[¿¡]+/, "").replace(/[.,;:!?]+$/, ""));
  const candidates = TRIGGER_VERBS.filter((v) => isOneEditTypo(folded, v));
  if (candidates.length !== 1) return text;
  const canonical = candidates[0];
  const contextOk =
    canonical === "recuerdas"
      ? QUERY_CONTEXT_TOKENS.has(next)
      : ORDER_CONTEXT_TOKENS.has(next) || /^[a-z]{4,}(?:ar|er|ir)$/.test(next);
  if (!contextOk) return text;
  const fixed = /^[A-ZÁÉÍÓÚÜÑ]/.test(core) ? canonical.charAt(0).toUpperCase() + canonical.slice(1) : canonical;
  words[idx] = lead + fixed + suffix;
  return words.join(" ");
}
