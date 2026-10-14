/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * rememberRouter.ts — NIDO: pre-router determinístico para intents de memoria.
 *
 * BUG-4-2026-10-06 (root cause): el modelo 0.5B a veces responde "Listo"
 * sin generar el bloque ```tool para remember_fact. El research externo
 * confirmó que esto es un comportamiento documentado en modelos sub-1B
 * (no un misterio de NIDO) y que la solución más confiable es hacer la
 * persistencia de memoria system-driven, no agent-driven.
 *
 * Este módulo implementa el patrón `sheetmemory`/`guardian-agent`: antes
 * de invocar al LLM, se hace match determinístico de intents explícitos
 * de memoria ("recuerda que X") y se extrae el contenido directamente.
 * Si hay match, el caller guarda el hecho sin pasar por el modelo.
 *
 * Puro, sin dependencias, 100% testeable.
 */

import { INTERROGATIVE_START_RE, isOrderLead, stripDateWords } from "./actionRouter";

/** Resultado de la extracción determinística. */
export interface RememberExtraction {
  /** El contenido a guardar, en palabras del usuario. */
  content: string;
  /** Categoría sugerida basada en el contenido. */
  category: "general" | "preference" | "goal" | "event";
}

/**
 * Patrones de extracción: [regex, índice del grupo de captura].
 * Ordenados de más específico a más general.
 */
const EXTRACTION_PATTERNS: Array<{ re: RegExp; group: number }> = [
  // "recuerda que el cumpleaños de mi mamá es el 15 de marzo"
  { re: /recuerda( que|te que)?[:\s]+(.+)/i, group: 2 },
  // "recuérdame que X" / "recuerdame que X" (con pronombre "me")
  { re: /recu[eé]rdame( que)?[:\s]+(.+)/i, group: 2 },
  // "acuérdate de que X" / "acuérdate que X"
  { re: /acu[eé]rdate( de)?( que)?[:\s]+(.+)/i, group: 3 },
  // "no olvides que X" / "no te olvides de que X"
  { re: /no (te )?olvides( de)?( que)?[:\s]+(.+)/i, group: 4 },
  // "guarda en tu memoria que X" / "guarda en memoria: X"
  // NOTA: solo captura si hay "que" explícito después de "memoria",
  // para evitar capturar cláusulas de propósito como "para que me avises".
  { re: /gu[aá]rda\w*( esto| eso|lo|la)? en (tu |la )?memoria que[:\s]+(.+)/i, group: 3 },
  // "memoriza que X" / "memoriza: X"
  { re: /memoriza[:\s]+(.+)/i, group: 1 },
  // 0.1.20 (M3): "guarda que X" a secas — la sonda mostró que solo
  // funcionaba la forma larga "guarda en memoria que". No choca con
  // "guarda una nota…" (esa frase no empieza con "guarda que" y la
  // ruta de notas corre por toolRouter).
  { re: /gu[aá]rda(?:te)? que[:\s]+(.+)/i, group: 1 },
  // "apunta esto para siempre: X"
  { re: /apunta (esto|eso) para (siempre|despu[eé]s)[:\s]+(.+)/i, group: 3 },
  // Inglés: "remember that X" / "remember: X"
  // 0.1.37 (auditoría): solo como orden (al principio o con «please»);
  // «I can't remember the capital of Peru» guardaba «the capital of Peru».
  { re: /^(?:(?:please|hey|ok|okay|nido|also|and)[,!]?\s+)*remember( that)?[:\s]+(.+)/i, group: 2 },
  { re: /\bplease\s+remember( that)?[:\s]+(.+)/i, group: 2 },
  // Inglés: "don't forget that X"
  { re: /don't forget( that)?[:\s]+(.+)/i, group: 2 },
  // 0.1.14: portugués — "lembre que X", "me lembra que X", "lembre-se de que X".
  { re: /lembr[ae](?:-se)?(?: de)? que[:\s]+(.+)/i, group: 1 },
  // "não esqueça que X" / "não se esqueça de que X"
  { re: /n[aã]o (?:se )?esque[cç]a(?: de)? que[:\s]+(.+)/i, group: 1 },
];

/**
 * Detecta si el texto contiene un patrón de fecha (para sugerir categoría).
 * Reutiliza la lógica simple: busca patrones de fecha comunes.
 */
function detectCategory(content: string): RememberExtraction["category"] {
  const lower = content.toLowerCase();
  // Eventos: fechas, cumpleaños, aniversarios, citas.
  if (
    /cumplea[ñn]os|aniversario|\d{1,2} de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)|el \d{1,2}\/\d{1,2}|cita|reuni[óo]n|evento/i.test(
      content
    )
  ) {
    return "event";
  }
  // Preferencias: "me gusta", "prefiero", "no me gusta".
  if (/me gusta|prefiero|no me gusta|odio|amo|favorit/i.test(lower)) {
    return "preference";
  }
  // Metas: "quiero", "mi objetivo", "mi meta".
  if (/quiero|mi objetivo|mi meta|prop[óo]sito/i.test(lower)) {
    return "goal";
  }
  return "general";
}

/**
 * Patrones de CONSULTA (no guardar): el usuario PIDE información de memoria,
 * no está proporcionando un hecho nuevo. Ej: "recuérdame la fecha de
 * cumpleaños de mi mamá" — aquí no hay fecha que guardar, es una pregunta.
 * Si el pre-router extrajera esto como hecho, guardaría "la fecha de
 * cumpleaños de mi mamá" como texto sin fecha (el bug reportado 2026-10-07).
 */
const QUERY_PATTERNS: RegExp[] = [
  // "recuérdame la fecha de X" / "recuerdame cuando es X"
  /recu[eé]rdame (la fecha de|cu[áa]ndo es|cu[áa]l es)/i,
  // "dime la fecha de X" / "cuál es la fecha de X"
  /(dime|cu[áa]l es) la fecha de/i,
  // "¿cuándo es el cumpleaños de X?"
  /cu[áa]ndo es el cumplea[ñn]os de/i,
];

/**
 * Detecta si el texto es una CONSULTA de memoria (pedir info) en vez de
 * un guardado. Retorna true si es consulta.
 */
export function isMemoryQuery(userText: string): boolean {
  const trimmed = userText.trim();
  if (!trimmed) return false;
  return QUERY_PATTERNS.some((re) => re.test(trimmed));
}

/**
 * Limpia instrucciones trailing del contenido extraído.
 * Ej: "my mom's birthday is March 15th. Save it so you can remind me in time."
 * → "my mom's birthday is March 15th"
 */
function stripTrailingInstructions(content: string): string {
  // Patrones de instrucciones que no son parte del hecho.
  const patterns = [
    /\.?\s*save it so you can remind me in time\.?$/i,
    /\.?\s*guárdalo para que me avises con tiempo\.?$/i,
    /\.?\s*para que me avises con tiempo\.?$/i,
    /\.?\s*no lo olvides\.?$/i,
  ];
  let result = content.trim();
  for (const re of patterns) {
    result = result.replace(re, "").trim();
  }
  // 0.1.34 (ejemplo «Memoria privada» del carrusel, es/pt): la petición
  // final («Guárdalo en tu memoria…», «Guarde para me avisar com
  // antecedência») se guardaba dentro del hecho. Se quitan las frases
  // finales que son una ORDEN a NIDO, no parte de lo que hay que recordar.
  const ORDER_RE =
    /^(?:gu[aá]rd(?:a|alo|ala|e|ar)|save|keep|store|av[ií]sa(?:me)?|recu[eé]rd(?:a|amelo)|no\s+lo\s+olvides|don'?t\s+forget|lembr(?:e|a)|n[aã]o\s+esque[cç]a|me\s+avis[ae])\b/i;
  for (;;) {
    const cut = result.search(/[.!;]\s+[^.!;]+[.!;]?$/);
    if (cut < 0) break;
    const tail = result.slice(cut + 1).trim();
    if (!ORDER_RE.test(tail)) break;
    result = result.slice(0, cut).trim();
  }
  // «…es el 15 de marzo y que le gustan…»: el «que» repetido sobra.
  result = result.replace(/\by que\b/gi, "y").replace(/[.!;]+$/, "").trim();
  return result;
}

/**
 * 0.1.34: título corto del aviso que crea un hecho con fecha. «el
 * cumpleaños de mi mamá es el 15 de marzo y le gustan las orquídeas» →
 * «Cumpleaños de mi mamá». Si no hay forma clara, el hecho entero.
 */
export function reminderTitleForFact(content: string): string {
  const m = /^((?:el\s+|o\s+)?(?:cumplea[ñn]os|aniversario|anivers[aá]rio)\s+(?:de|da|do)\s+.+?|my\s+.+?(?:'s)?\s+birthday|.+?'s\s+birthday)\s+(?:es|is|é|será|will be)(?=\s|$)/i.exec(
    content.trim(),
  );
  if (!m) return content;
  const t = m[1].replace(/^(?:el|o)\s+/i, "").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const MESES: Record<string, number> = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
  // Portugués (batería trilingüe 0.1.20): sin estos nombres, «15 de
  // março» nunca parseaba y el cumpleaños PT no generaba recordatorio.
  janeiro: 0, fevereiro: 1, "março": 2, maio: 4, junho: 5, julho: 6,
  setembro: 8, outubro: 9, novembro: 10, dezembro: 11,
};

/**
 * Extrae una fecha de un texto en español (ej: "15 de marzo").
 * Retorna la fecha ISO (año actual, o el siguiente si ya pasó) o null.
 */
export function extractDateISO(text: string, lang: "es" | "en" | "pt" = "es"): string | null {
  // Español: "15 de marzo"
  const mEs = /(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|janeiro|fevereiro|março|maio|junho|julho|setembro|outubro|novembro|dezembro)/i.exec(text);
  if (mEs) {
    const day = parseInt(mEs[1], 10);
    const month = MESES[mEs[2].toLowerCase()];
    if (day >= 1 && day <= 31 && month !== undefined) {
      return nextOccurrence(month, day);
    }
  }
  // Inglés: "March 15th", "March 15"
  const mEn = /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?/i.exec(text);
  if (mEn) {
    const monthNames: Record<string, number> = {
      january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
      july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    };
    const month = monthNames[mEn[1].toLowerCase()];
    const day = parseInt(mEn[2], 10);
    if (day >= 1 && day <= 31 && month !== undefined) {
      return nextOccurrence(month, day);
    }
  }
  // 0.1.20 (M6): fechas numéricas "05/11", "11/05/2027". La sonda mostró
  // que solo servían con el mes en letras: un cumpleaños dictado con
  // números no generaba su recordatorio automático. Separadores / y -
  // únicamente (el punto es decimal en "cuesta 3.5": fail-closed).
  const mNum = /(?<!\d)(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}|\d{2}))?(?!\d)/.exec(text);
  if (mNum) {
    const a = parseInt(mNum[1], 10);
    const b = parseInt(mNum[2], 10);
    // Desambiguación: si un lado pasa de 12, ese lado es el día. Si
    // ambos ≤ 12, manda el idioma (ES/PT: D/M; EN: M/D).
    let day: number;
    let month: number;
    if (a > 12 && b >= 1 && b <= 12) {
      day = a;
      month = b;
    } else if (b > 12 && a >= 1 && a <= 12) {
      month = a;
      day = b;
    } else if (lang === "en") {
      month = a;
      day = b;
    } else {
      day = a;
      month = b;
    }
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      if (mNum[3]) {
        // Con año explícito: esa fecha concreta (09:00 local). Si ya
        // pasó, no hay recordatorio que crear: null.
        const year = mNum[3].length === 2 ? 2000 + parseInt(mNum[3], 10) : parseInt(mNum[3], 10);
        const d = new Date(year, month - 1, day, 9, 0, 0);
        if (d.getMonth() === month - 1 && d.getDate() === day && d.getTime() >= Date.now()) {
          return d.toISOString();
        }
        return null;
      }
      return nextOccurrence(month - 1, day);
    }
  }
  return null;
}

/** Calcula la próxima ocurrencia futura de un día/mes (para cumpleaños). */
/** M5 FIX 2026-10-07: valida que la fecha exista. "31 de febrero" retorna null
 * en vez de hacer rollover silencioso a marzo. */
function nextOccurrence(month: number, day: number): string | null {
  // Validar que el día existe en ese mes (usar año bisiesto 2024 para febrero 29).
  const testDate = new Date(2024, month, day);
  if (testDate.getMonth() !== month || testDate.getDate() !== day) {
    return null; // Fecha inexistente como "31 de febrero" o "32 de enero".
  }
  // Auditoría ofensiva (0.1.18): validar en el año en que cae. Un cumpleaños
  // el 29 de febrero, en un año no bisiesto, se convertía en el 1 de marzo.
  const now = new Date();
  for (let year = now.getFullYear(); year <= now.getFullYear() + 8; year++) {
    const candidate = new Date(year, month, day, 9, 0, 0);
    if (candidate.getMonth() !== month || candidate.getDate() !== day) continue;
    if (candidate.getTime() >= now.getTime()) return candidate.toISOString();
  }
  return null;
}

/** Resultado de la extracción de persona. */
export interface PersonExtraction {
  name: string;
  relationship?: string;
  notes?: string;
}

/**
 * 0.1.20 (evidencia Tab A9+): el extractor original exigía los parentescos
 * CON acento («mamá») y el nombre con mayúscula inicial. El usuario
 * escribió «Mi mama se llama Marta» (sin acento, como se escribe en un
 * teclado) y no hubo match: el mensaje cayó a la búsqueda de conocimiento
 * y la persona nunca se guardó. Ahora los parentescos aceptan la forma
 * con y sin acento, el nombre puede empezar en minúscula y hay patrones
 * en portugués. La relación se guarda en su forma canónica con acento.
 */
const ES_REL =
  "mamá|mama|papá|papa|madre|padre|hermano|hermana|esposo|esposa|hijo|hija|novio|novia|amigo|amiga|tío|tio|tía|tia|primo|prima|abuelo|abuela|sobrino|sobrina|cuñado|cuñada|cunado|cunada|suegro|suegra|yerno|nuera|nieto|nieta|compadre|comadre|pareja";
const PT_REL =
  "mãe|mae|pai|irmão|irmao|irmã|irma|esposa|marido|esposo|filho|filha|namorado|namorada|amigo|amiga|tio|tia|primo|prima|avô|avo|avó|sobrinho|sobrinha|cunhado|cunhada|sogro|sogra|genro|nora|neto|neta|compadre|comadre";
/**
 * Nombre: corrida de 1 a 3 palabras (la validación fina va en
 * validName, en código, porque con la bandera /i las clases de
 * mayúsculas también aceptan minúsculas y el regex solo no basta).
 * Las clases incluyen las letras del portugués (ã õ ç â ê ô à).
 */
const NAME_SRC = "[A-Za-zÁÉÍÓÚÑÜÀÂÊÔÃÕÇáéíóúñüàâêôãõç]+(?: [A-Za-zÁÉÍÓÚÑÜÀÂÊÔÃÕÇáéíóúñüàâêôãõç]+){0,2}";
/** Palabras que jamás son un nombre en estas posiciones («se llama como…»). */
const NOT_A_NAME = /^(como|así|asi|igual|también|tambien|bien|mal|todo|eso|esto|aquí|aqui|ahora|la|el|los|las|un|una|atención|atencion|se|me|te|le|que|de|en|y|e)$/i;
/** Segunda palabra que corta el nombre: verbos típicos tras un nombre. */
// 0.1.37 (auditoría): conjunciones y posesivos tampoco son apellido
// («Ana y su cumpleaños…» guardaba «Ana Y»; en/pt «Ana And», «Ana E»).
const NAME_STOP_SECOND =
  /^(cumple|vive|trabaja|estudia|tiene|es|está|esta|va|viene|llega|juega|come|duerme|y|e|o|u|ou|and|or|but|pero|mas|que|su|sus|seu|sua|his|her|their|who|is|lives|works|has)$/i;
const STARTS_UPPER = /^[A-ZÁÉÍÓÚÑÜÀÂÊÔÃÕÇ]/;

const CANON_REL: Record<string, string> = {
  mama: "mamá",
  papa: "papá",
  tio: "tío",
  tia: "tía",
  mae: "mãe",
  irmao: "irmão",
  irma: "irmã",
  avo: "avô",
  cunado: "cuñado",
  cunada: "cuñada",
};

function tidyName(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function validName(raw: string): string | null {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || NOT_A_NAME.test(words[0])) return null;
  // Cuántas palabras de la corrida son nombre de verdad:
  // - si la 2ª va capitalizada en el original, la cadena de palabras
  //   capitalizadas manda («Juan Pérez», «Mary Jane Watson»).
  // - si va en minúscula, máximo 2 (nombre compuesto: «ana maría»),
  //   y ninguna si es un verbo típico («juan cumple años» → «Juan»).
  let keep = 1;
  if (words.length > 1) {
    if (STARTS_UPPER.test(words[1])) {
      while (keep < words.length && keep < 3 && STARTS_UPPER.test(words[keep])) keep++;
    } else if (!NAME_STOP_SECOND.test(words[1])) {
      keep = 2;
    }
  }
  const name = tidyName(words.slice(0, keep).join(" "));
  return name.length >= 2 ? name : null;
}

/** Una pregunta no afirma nada: no crea personas ni guarda el nombre. */
function looksLikeQuestion(t: string): boolean {
  return /^\s*¿/.test(t) || /\?\s*$/.test(t);
}

function canonRel(raw: string): string {
  const rel = raw.toLowerCase();
  return CANON_REL[rel] ?? rel;
}

/**
 * PEOPLE-FIX 2026-10-07: extrae personas del texto de forma
 * determinística. Patrones: "mi mamá se llama María", "recuerda que mi
 * hermano Juan...", "mi esposa se llama Ana".
 *
 * 0.1.20 (M4/M5): los patrones de «se llama» van ANCLADOS al inicio del
 * mensaje (saludo o gatillo «recuerda que» opcionales). Sin anclar,
 * «la esposa de mi hermano se llama Laura» guardaba a Laura con la
 * relación «hermano». El plural («mis hijos se llaman Leo y Max»)
 * devuelve dos personas.
 */
/**
 * 0.1.34 (prueba física, Tab A9+): «Mi hermank se llama juan» — una tecla
 * vecina en el parentesco y la persona no se guardaba. Corrige SOLO la
 * palabra del parentesco en «mi X se llama» / «meu|minha X se chama»,
 * cuando está a UNA letra de un parentesco conocido y esa letra es una
 * tecla vecina en QWERTY (así «hermank» → «hermano» y no «hermana»). Si
 * hay empate o dudas, no toca nada.
 */
const QWERTY_ROWS = ["qwertyuiop", "asdfghjklñ", "zxcvbnm"];
function keyPos(c: string): [number, number] | null {
  for (let r = 0; r < QWERTY_ROWS.length; r++) {
    const i = QWERTY_ROWS[r].indexOf(c);
    if (i >= 0) return [r, i];
  }
  return null;
}
function neighborKeys(a: string, b: string): boolean {
  const pa = keyPos(a);
  const pb = keyPos(b);
  if (!pa || !pb) return false;
  return Math.abs(pa[0] - pb[0]) <= 1 && Math.abs(pa[1] - pb[1]) <= 1;
}
function fixRelationWord(word: string, relations: readonly string[]): string | null {
  const w = word.toLowerCase();
  if (w.length < 5 || relations.includes(w)) return null;
  const hits = relations.filter((r) => {
    if (r.length !== w.length) return false;
    let diff = -1;
    for (let i = 0; i < r.length; i++) {
      if (r[i] !== w[i]) {
        if (diff >= 0) return false;
        diff = i;
      }
    }
    return diff >= 0 && neighborKeys(w[diff], r[diff]);
  });
  return hits.length === 1 ? hits[0] : null;
}
export function fixRelationTypos(text: string): string {
  const es = ES_REL.split("|");
  const pt = PT_REL.split("|");
  return text
    .replace(/(\bmi\s+)(\p{L}+)(\s+se\s+llama\b)/iu, (all, a, w, b) => {
      const f = fixRelationWord(w, es);
      return f ? a + f + b : all;
    })
    .replace(/(\b(?:meu|minha)\s+)(\p{L}+)(\s+(?:se\s+chama|chama-se)\b)/iu, (all, a, w, b) => {
      const f = fixRelationWord(w, pt);
      return f ? a + f + b : all;
    });
}

export function extractPeople(userText: string): PersonExtraction[] {
  const trimmed = fixRelationTypos(userText.trim());
  if (!trimmed || looksLikeQuestion(trimmed)) return [];
  const out: PersonExtraction[] = [];
  const start = "^(?:(?:hola|buenas|oye)[,.\\s]+)?(?:recuerda(?:te)?(?:\\s+que)?[,\\s]+)?";

  // Plural: "mis hijos se llaman Leo y Max"
  const mp = new RegExp(
    `${start}mis (hijos|hijas|hermanos|hermanas) se llaman (${NAME_SRC}) y (${NAME_SRC})`,
    "i"
  ).exec(trimmed);
  if (mp) {
    const relBase = mp[1].toLowerCase().replace(/s$/, "");
    for (const raw of [mp[2], mp[3]]) {
      const name = validName(raw);
      if (name) out.push({ name, relationship: relBase, notes: trimmed });
    }
    if (out.length) return out;
  }

  // "mi mejor amigo se llama Diego"
  const mb = new RegExp(`${start}mi mejor (amigo|amiga) se llama (${NAME_SRC})`, "i").exec(trimmed);
  if (mb) {
    const name = validName(mb[2]);
    if (name) return [{ name, relationship: `mejor ${mb[1].toLowerCase()}` }];
  }

  // "mi [relación] se llama [Nombre]"
  const m1 = new RegExp(`${start}mi (${ES_REL}) se llama (${NAME_SRC})`, "i").exec(trimmed);
  if (m1) {
    const name = validName(m1[2]);
    if (name) return [{ name, relationship: canonRel(m1[1]) }];
  }

  // "recuerda que mi [relación] [Nombre]..." (sin «se llama»: si lo hay,
  // el patrón anterior ya lo capturó; «se» está vetado como nombre).
  const m2 = new RegExp(`recuerda( que)? mi (${ES_REL}) (${NAME_SRC})`, "i").exec(trimmed);
  if (m2) {
    const name = validName(m2[3]);
    if (name) return [{ name, relationship: canonRel(m2[2]), notes: trimmed }];
  }

  // "my mom's name is Mary", "my brother is called John"
  const m3 = new RegExp(
    `my (mom|dad|mother|father|brother|sister|husband|wife|son|daughter|boyfriend|girlfriend|friend)(?:'s name)? is (?:called )?(${NAME_SRC})`,
    "i"
  ).exec(trimmed);
  if (m3) {
    const name = validName(m3[2]);
    if (name) return [{ name, relationship: m3[1].toLowerCase() }];
  }

  // "se llama [Nombre], es mi [relación]"
  const m4 = new RegExp(`se llama (${NAME_SRC}),? es mi (${ES_REL})`, "i").exec(trimmed);
  if (m4) {
    const name = validName(m4[1]);
    if (name) return [{ name, relationship: canonRel(m4[2]) }];
  }

  // PT: "minha mãe se chama Maria", "meu irmão chama-se João"
  const m5 = new RegExp(
    `^(?:(?:olá|ola|oi)[,.\\s]+)?(?:lembr[ae](?:-se)?(?:\\s+de)?\\s+que\\s+)?(?:minha|meu) (${PT_REL}) (?:se chama|chama-se) (${NAME_SRC})`,
    "i"
  ).exec(trimmed);
  if (m5) {
    const name = validName(m5[2]);
    if (name) return [{ name, relationship: canonRel(m5[1]) }];
  }

  return out;
}

export function extractPerson(userText: string): PersonExtraction | null {
  return extractPeople(userText)[0] ?? null;
}

/**
 * 0.1.20 (evidencia Tab A9+): la presentación del PROPIO usuario no
 * tenía ningún patrón — «Yo me llamo Ruben» caía al modelo, que lo
 * repetía como loro y no guardaba nada. Devuelve el nombre propio o
 * null. Solo mensajes que SON la presentación (con saludo opcional),
 * no frases que la mencionan de paso.
 */
export function extractSelfName(userText: string): string | null {
  if (looksLikeQuestion(userText.trim())) return null;
  const t = userText
    .trim()
    .replace(/[.!]+$/, "")
    // "you": el autocorrector de un teclado en inglés convierte «yo» en
    // «you» — le pasó al usuario en la tablet («You me llamo Ruben»).
    .replace(/^(hola|buenas|hi|hello|olá|ola|you)[,.\s]+/i, "");
  if (!t || t.length > 80) return null;
  const patterns = [
    new RegExp(`^(?:yo\\s+)?me\\s+llamo\\s+(${NAME_SRC})$`, "i"),
    new RegExp(`^mi\\s+nombre\\s+es\\s+(${NAME_SRC})$`, "i"),
    new RegExp(`^my\\s+name\\s+is\\s+(${NAME_SRC})$`, "i"),
    new RegExp(`^meu\\s+nome\\s+(?:é|e)\\s+(${NAME_SRC})$`, "i"),
    new RegExp(`^eu\\s+me\\s+chamo\\s+(${NAME_SRC})$`, "i"),
  ];
  for (const re of patterns) {
    const m = re.exec(t);
    if (m) {
      const name = validName(m[1]);
      if (name) return name;
    }
  }
  return null;
}

/**
 * 0.1.20 (M2): hechos IMPLÍCITOS — afirmaciones sobre el usuario sin la
 * palabra «recuerda». La sonda mostró 7/7 cayendo al modelo («mi
 * cumpleaños es el 3 de mayo», «mi coche es un Toyota», «vivo en
 * Tucson»). Patrones anclados y de alta precisión; corre DESPUÉS del
 * extractor con gatillo y de personas/nombre propio, y en agentLoop
 * llega cuando notas/recordatorios/calculadora ya pasaron, así que no
 * roba frases de otras rutas.
 *
 * Fail-closed con datos sensibles: un valor con 7+ dígitos seguidos o
 * un sustantivo tipo cuenta/tarjeta/clave NO se auto-guarda; eso solo
 * entra con gatillo explícito («recuerda que…»), decisión del usuario.
 */
const SENSITIVE_NOUN = /cuenta|tarjeta|clave|contraseña|contrasena|password|pin|seguro|card|account|senha/i;
const LONG_DIGITS = /\d{7,}/;

export function extractImplicitFact(userText: string): RememberExtraction | null {
  const t = userText.trim().replace(/[.!]+$/, "");
  if (!t || t.length > 200 || looksLikeQuestion(t) || isMemoryQuery(t)) return null;
  const done = (content: string): RememberExtraction | null => {
    const c = content.trim();
    if (c.length < 3 || LONG_DIGITS.test(c)) return null;
    return { content: c, category: detectCategory(c) };
  };

  // Cumpleaños / aniversario (propio o de una relación): categoría event
  // vía detectCategory; agentLoop crea el recordatorio por la fecha.
  if (
    /^(?:mi|el|la)\s+(?:cumpleaños|cumpleanos|aniversario)\b/i.test(t) ||
    /^(?:el|la)\s+(?:cumpleaños|cumpleanos|aniversario)\s+de\b/i.test(t) ||
    /^(?:my|meu|minha|o|a)\s+(?:birthday|aniversário|aniversario)\b/i.test(t) ||
    /^(?:the|o)\s+(?:birthday|aniversário)\s+(?:of|de|da|do)\b/i.test(t) ||
    // 0.1.31 (auditoría del loop): «my mom's birthday is March 15» caía
    // al conocimiento; el español y el portugués ya se guardaban.
    /^my\s+[\p{L}' -]{1,30}'s\s+(?:birthday|anniversary)\b/iu.test(t)
  ) {
    return done(t);
  }
  // "vivo en X" / "I live in X" / "moro em X" (1-4 palabras de lugar).
  const home = /^(?:vivo en|i live in|moro em|eu moro em)\s+([\p{L}][\p{L}\s.'-]{1,40})$/iu.exec(t);
  if (home && home[1].trim().split(/\s+/).length <= 4) return done(t);
  // Favoritos: "mi X favorito/a es Y", "my favorite X is Y", PT.
  if (
    /^mi\s+.+\s+favorit[oa]\s+es\s+.+/i.test(t) ||
    /^my\s+favorite\s+.+\s+is\s+.+/i.test(t) ||
    /^meu\s+.+\s+favorito\s+(?:é|e)\s+.+/i.test(t) ||
    /^minha\s+.+\s+favorita\s+(?:é|e)\s+.+/i.test(t)
  ) {
    return done(t);
  }
  // "trabajo en/de X" (ocupación o turno, valor corto).
  const job = /^trabajo\s+(?:en|de)\s+(.{2,40})$/i.exec(t);
  if (job && job[1].trim().split(/\s+/).length <= 4) return done(t);
  // "mi <sustantivo curado> es/se llama <valor>": posesiones e identidad
  // cotidiana. Lista cerrada a propósito: fuera de ella, sin gatillo
  // no se guarda (precisión > cobertura en memoria automática).
  const noun =
    /^(mi)\s+(coche|carro|auto|teléfono|telefono|celular|banco|correo|dirección|direccion|equipo|perro|gato|mascota|ciudad|pueblo|trabajo)\s+(?:es|se llama)\s+(.+)$/i.exec(t) ||
    /^(my)\s+(car|phone|bank|email|dog|cat|team|city|job)\s+is\s+(.+)$/i.exec(t) ||
    /^(meu|minha)\s+(carro|telefone|celular|banco|correio|time|cachorro|gato|cidade|trabalho)\s+(?:é|e|se chama)\s+(.+)$/i.exec(t);
  if (noun) {
    if (SENSITIVE_NOUN.test(noun[2])) return null;
    // El valor debe ser un dato (nombre/marca/lugar), no una descripción:
    // «mi perro es un pastor alemán» sí; «mi perro es muy bonito y
    // juega mucho en el parque» es charla, no un hecho durable.
    if (noun[3].trim().split(/\s+/).length > 4) return null;
    return done(t);
  }
  return null;
}

/**
 * Intenta extraer un hecho de memoria del texto del usuario de forma
 * determinística. Retorna null si no hay un patrón explícito.
 *
 * Solo maneja casos claros y explícitos. Si el texto es ambiguo o no
 * coincide con ningún patrón, retorna null y el flujo normal del agente
 * (con el LLM) toma el control.
 *
 * FIX 2026-10-07: si es una consulta (isMemoryQuery), retorna null para
 * no guardar la pregunta como hecho.
 */
export function extractRememberFact(userText: string): RememberExtraction | null {
  const trimmed = userText.trim();
  if (!trimmed) return null;
  // No guardar consultas como hechos.
  if (isMemoryQuery(trimmed)) return null;

  for (const { re, group } of EXTRACTION_PATTERNS) {
    const match = re.exec(trimmed);
    // 0.1.37 (auditoría): «traduce al inglés: recuérdame comprar pan» o
    // «una canción que se llame recuérdame siempre» guardaban un hecho: el
    // verbo tiene que abrir la orden (delante, solo fecha o cortesía).
    if (match && match[group] && isOrderLead(trimmed.slice(0, match.index))) {
      // FIX 2026-10-07: limpiar instrucciones trailing ("Save it so you can
      // remind me in time") que no son parte del hecho.
      const content = stripTrailingInstructions(match[group].trim());
      // Validación mínima: el contenido debe ser sustancial.
      // 0.1.19 (sonda de routing): "recuerda mañana" guardaba el hecho
      // basura "mañana". Si al quitar las palabras de fecha/hora no queda
      // contenido, no hay hecho que guardar.
      // 0.1.19 (segunda pasada de la sonda): "recuérdame cómo se llama la
      // capital de Francia" — al dejar de ser recordatorio (guardia
      // interrogativa) caía aquí y la PREGUNTA se guardaba como hecho.
      // Una pregunta no es un hecho: mismo corte que en recordatorios.
      if (content.length >= 3 && !INTERROGATIVE_START_RE.test(content) && stripDateWords(content).trim().length >= 3) {
        return {
          content,
          category: detectCategory(content),
        };
      }
    }
  }
  return null;
}
