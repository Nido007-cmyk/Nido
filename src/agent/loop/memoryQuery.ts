/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.20 (M1): respondedor determinista de CONSULTAS de memoria.
 *
 * Investigación 2026-10-12: preguntar de vuelta («¿cómo se llama mi
 * mamá?», «¿cómo me llamo?», «¿cuál es mi color favorito?») no tenía
 * ninguna ruta determinista — 10/10 consultas de la sonda caían al
 * modelo, que acertaba solo si el 0.5B leía bien el contexto, y si no,
 * inventaba o citaba la «fuente» que fuera (evidencia física: la
 * estación Lista del Metro de Madrid como respuesta a «mi mamá se
 * llama Marta»). Aquí la respuesta sale de lo guardado, y cuando el
 * dato no está, la respuesta honesta también es determinista:
 * «todavía no me has contado eso». Nunca una invención con cita falsa.
 *
 * Solo reclama preguntas SOBRE la memoria del usuario (su gente, sus
 * datos). Cualquier otra pregunta devuelve null y sigue el flujo normal.
 */

import { extractDateISO } from "./rememberRouter";
import { formatDay } from "./toolRouter";

export type MemoryQueryLang = "es" | "en" | "pt";

export interface MemoryQueryData {
  facts: { content: string; category: string }[];
  people: { name: string; relationship?: string; notes?: string }[];
}

const fold = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/** Grupos de sinónimos de parentesco entre idiomas y registros. */
const REL_GROUPS: string[][] = [
  ["mama", "madre", "mom", "mother", "mae"],
  ["papa", "padre", "dad", "father", "pai"],
  ["hermano", "brother", "irmao"],
  ["hermana", "sister", "irma"],
  ["esposa", "wife"],
  ["esposo", "marido", "husband"],
  ["hijo", "son", "filho"],
  ["hija", "daughter", "filha"],
  ["abuelo", "grandfather", "avo"],
  ["abuela", "grandmother", "avo"],
  ["tio", "uncle"],
  ["tia", "aunt"],
  ["primo", "cousin"],
  ["prima", "cousin"],
  ["amigo", "friend"],
  ["amiga", "friend"],
  ["novio", "boyfriend", "namorado"],
  ["novia", "girlfriend", "namorada"],
  ["cunado", "brother-in-law", "cunhado"],
  ["cunada", "sister-in-law", "cunhada"],
  ["suegro", "father-in-law", "sogro"],
  ["suegra", "mother-in-law", "sogra"],
  ["nieto", "grandson", "neto"],
  ["nieta", "granddaughter", "neta"],
  ["sobrino", "nephew", "sobrinho"],
  ["sobrina", "niece", "sobrinha"],
  ["pareja", "partner"],
];

function sameRel(a: string, b: string): boolean {
  const fa = fold(a);
  const fb = fold(b);
  if (fa === fb) return true;
  return REL_GROUPS.some((g) => g.includes(fa) && g.includes(fb));
}

function findPersonByRel(mem: MemoryQueryData, rel: string) {
  return mem.people.find((p) => p.relationship && sameRel(p.relationship, rel)) ?? null;
}

const STR: Record<string, Record<MemoryQueryLang, string>> = {
  personName: {
    es: "Tu {{rel}} se llama {{name}}.",
    en: "Your {{rel}}'s name is {{name}}.",
    pt: "Sua {{rel}} se chama {{name}}.",
  },
  selfName: { es: "Te llamas {{name}}.", en: "Your name is {{name}}.", pt: "Você se chama {{name}}." },
  birthday: {
    es: "El cumpleaños de {{who}} es el {{day}}.",
    en: "{{who}}'s birthday is on {{day}}.",
    pt: "O aniversário de {{who}} é em {{day}}.",
  },
  yourBirthday: {
    es: "Tu cumpleaños es el {{day}}.",
    en: "Your birthday is on {{day}}.",
    pt: "Seu aniversário é em {{day}}.",
  },
  factQuote: {
    es: "Según lo que me contaste: «{{fact}}».",
    en: "From what you told me: “{{fact}}”.",
    pt: "Pelo que você me contou: “{{fact}}”.",
  },
  notKnown: {
    es: "Todavía no me has contado eso. Cuando me lo digas, lo guardo.",
    en: "You haven't told me that yet. When you do, I'll save it.",
    pt: "Você ainda não me contou isso. Quando contar, eu guardo.",
  },
  aboutYou: {
    es: "Esto es lo que me has contado:",
    en: "Here's what you've told me:",
    pt: "Isto é o que você me contou:",
  },
};

function msg(key: string, lang: MemoryQueryLang, vars: Record<string, string> = {}): string {
  let s = STR[key][lang];
  for (const [k, v] of Object.entries(vars)) s = s.split(`{{${k}}}`).join(v);
  return s;
}

const BIRTHDAY_RE = /cumplea[ñn]os|aniversario|birthday|aniversário/i;

/** Hecho de cumpleaños de una persona (por nombre o parentesco) o propio. */
function findBirthdayFact(
  mem: MemoryQueryData,
  opts: { personName?: string; rel?: string; self?: boolean }
): string | null {
  const candidates = mem.facts.filter((f) => BIRTHDAY_RE.test(f.content));
  if (opts.self) {
    return candidates.find((f) => /mi cumplea|my birthday|meu anivers/i.test(f.content))?.content ?? null;
  }
  if (opts.personName) {
    const hit = candidates.find((f) => fold(f.content).includes(fold(opts.personName!)));
    if (hit) return hit.content;
  }
  if (opts.rel) {
    const hit = candidates.find((f) => {
      const words = fold(f.content).split(/[^a-z0-9-]+/);
      return words.some((w) => w && sameRel(w, opts.rel!));
    });
    if (hit) return hit.content;
  }
  // Las notas de la ficha de la persona también pueden traer la frase.
  if (opts.personName) {
    const p = mem.people.find((x) => x.name === opts.personName);
    if (p?.notes && BIRTHDAY_RE.test(p.notes)) return p.notes;
  }
  return null;
}

function birthdayAnswer(fact: string, who: string | null, lang: MemoryQueryLang): string {
  const iso = extractDateISO(fact, lang);
  if (iso) {
    const day = formatDay(new Date(iso), lang);
    return who
      ? msg("birthday", lang, { who, day })
      : msg("yourBirthday", lang, { day });
  }
  return msg("factQuote", lang, { fact });
}

const STOPWORDS = new Set([
  "como", "cual", "cuales", "cuando", "donde", "que", "qué", "cuál", "cómo", "cuándo", "dónde",
  "tengo", "tiene", "sabes", "sabe", "llama", "llamo", "nombre", "name", "what", "when", "where",
  "which", "whats", "about", "qual", "quando", "onde", "chama", "chamo", "mein", "meu", "minha",
  "mine", "your", "yours", "sobre", "contado", "cuentame", "have", "does",
  // «favorito/favorite» NO son stopwords: son justo lo que se pregunta
  // («¿cuál es mi color favorito?»); con ellas en la lista la búsqueda
  // se quedaba sin términos (batería trilingüe 0.1.20).
]);

export interface MemoryFactScore {
  /** El hecho con mayor puntuación (su texto), o null si ninguno puntúa. */
  fact: string | null;
  /** Cuántos términos de contenido de la pregunta aparecen en el hecho. */
  score: number;
  /** Cuántos términos de contenido trae la pregunta. */
  tokenCount: number;
}

/**
 * Búsqueda genérica por palabras en los hechos guardados, con la
 * puntuación a la vista. Es la ÚNICA fuente de puntuación: la usa la
 * rama genérica de answerMemoryQuery para elegir el hecho a citar y
 * la sonda de la puerta (memoryGateHit) para decidir si la pregunta
 * entra al loop — puerta y respuesta nunca discrepan (0.1.23).
 */
export function scoreMemoryFacts(mem: MemoryQueryData, question: string): MemoryFactScore {
  const tokens = fold(question)
    .split(/[^a-z0-9]+/)
    // >= 3: «car» y «cor» son términos de búsqueda reales en EN/PT.
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  let best: { content: string; score: number } | null = null;
  for (const f of mem.facts) {
    const fc = fold(f.content);
    const score = tokens.reduce((n, t) => n + (fc.includes(t) ? 1 : 0), 0);
    if (score > 0 && (!best || score > best.score)) best = { content: f.content, score };
  }
  return { fact: best?.content ?? null, score: best?.score ?? 0, tokenCount: tokens.length };
}

/**
 * 0.1.23: ¿la pregunta genérica tiene un hit FUERTE en la memoria?
 * Umbral aprobado por el dueño: score >= 2, o score == 1 cuando la
 * pregunta trae un único término de contenido («¿dónde vivo?» →
 * [vivo]). Con varios términos, un solo término compartido NO basta:
 * es justo el solape típico de las preguntas sobre documentos («¿qué
 * dice mi documento sobre…?») y de la charla, que deben seguir su ruta.
 */
export function memoryGateHit(userText: string, mem: MemoryQueryData): boolean {
  const t = (userText ?? "").trim();
  if (!t || !mem.facts.length) return false;
  const { score, tokenCount } = scoreMemoryFacts(mem, t);
  return score >= 2 || (score === 1 && tokenCount === 1);
}

/**
 * Formas de CONSULTA de memoria (las mismas que responde
 * answerMemoryQuery abajo). Viven como constantes compartidas porque
 * la puerta del chat (classifyIntent) necesita reconocerlas SIN tener
 * la memoria cargada: si la pregunta no entra al loop, la respuesta
 * determinista nunca ocurre (evidencia física 0.1.21: «¿cómo se llama
 * mi mamá?» caía al conocimiento y citaba el Metro de Madrid).
 */
const REL_NAME_Q_RES: RegExp[] = [
  /¿?c[oó]mo se llama mi ([a-záéíóúñü ]+?)\??$/i,
  /what'?s my ([a-z -]+?)'?s name\??$/i,
  // 0.1.34 (barrido de paridad): «what is my mom's name» (sin contraer) y
  // «what is the name of my mom» caían al modelo sin memoria guardada.
  /what is my ([a-z -]+?)'?s name\??$/i,
  /what is the name of my ([a-z -]+?)\??$/i,
  /como se chama (?:a )?minha? ([a-záéíóúãõç ]+?)\??$/i,
];
const SELF_NAME_Q_RES: RegExp[] = [
  /¿?c[oó]mo me llamo\??$/i,
  /what'?s my name\??$/i,
  /como (?:eu )?me chamo\??$/i,
  /qual (?:é|e) (?:o )?meu nome\??$/i,
];
const BDAY_PERSON_Q_RES: RegExp[] = [
  /cu[aá]ndo es el cumplea[ñn]os de mi ([a-záéíóúñü ]+?)\??$/i,
  /when is my ([a-z -]+?)'?s birthday\??$/i,
  /quando (?:é|e) o anivers[aá]rio d[aeo] minha? ([a-záéíóúãõç ]+?)\??$/i,
];
const BDAY_SELF_Q_RES: RegExp[] = [
  /cu[aá]ndo es mi cumplea[ñn]os\??$/i,
  /when is my birthday\??$/i,
  /quando (?:é|e) (?:o )?meu anivers[aá]rio\??$/i,
];
const ABOUT_ME_Q_RES: RegExp[] = [
  /qu[eé] (?:sabes|recuerdas|tienes guardado|has guardado) (?:de|sobre) m[ií]\??$/i,
  /what do you (?:know|remember) about me\??$/i,
  /o que (?:você|voce) sabe sobre mim\??$/i,
];
/** Primera persona (rama genérica de answerMemoryQuery, punto 5). */
const FIRST_PERSON_RE =
  /\bmi\b|\bmis\b|\bme\b|\bmy\b|\bmine\b|\bi\b|\bmeu\b|\bminha\b|\bmeus\b|\bminhas\b|\btengo\b|\bvivo\b|\btrabajo\b|\btenho\b|\bmoro\b|\bchamo\b/i;

/**
 * 0.1.23: la FORMA de la pregunta genérica (punto 5): interrogativa y
 * en primera persona. Es el guardia exacto de la rama 5, exportado
 * para que la sonda de ChatScreen pre-filtre con él sin duplicarlo.
 * La forma sola NO decide nada: también caza las preguntas sobre
 * documentos y la charla con primera persona. Lo que separa las
 * familias es el hit (memoryGateHit): ¿existe el dato guardado?
 * \bi\b: el «I» inglés («what car do I have?») — sin él la puerta de
 * primera persona no se abría en inglés (batería trilingüe 0.1.20).
 */
export function isGenericMemoryQuestionShape(userText: string): boolean {
  const t = (userText ?? "").trim();
  if (!t) return false;
  const isQuestion = /^\s*¿/.test(t) || /\?\s*$/.test(t);
  return isQuestion && FIRST_PERSON_RE.test(t);
}

/**
 * ¿Es esto una consulta SOBRE la memoria del usuario? Espejo de las
 * formas que answerMemoryQuery reclama (puntos 1–4). La usa la puerta
 * de intenciones para dejar pasar la pregunta al loop, que es quien
 * puede responderla desde lo guardado.
 *
 * El punto 5 (pregunta genérica en primera persona) NO se espeja a
 * propósito: esa forma es ambigua con las preguntas sobre documentos
 * («¿qué dice mi documento sobre…?», ejemplos de la guía que deben ir
 * al conocimiento) y con charla («¿qué tengo que hacer para…?»). La
 * rama 5 sigue viva dentro del loop para los turnos que entran por
 * otra vía; en la puerta mandan las formas inequívocas. Desde la
 * 0.1.23, esa familia entra por la sonda con hit de ChatScreen
 * (isGenericMemoryQuestionShape + memoryGateHit), no por el
 * clasificador, que se queda puro y sin memoria.
 */
// 0.1.25 (hallazgo físico, Tab A9+ 2026-10-12): el autocorrector o el
// dictado fusionan «mi mamá» en «mima» («mi papá» → «mipa», «mi hijo»
// → «mihijo»). Las formas de consulta exigen «mi» + parentesco como
// palabras separadas y la pregunta fusionada caía al modelo, que
// respondía en primera persona («Mi mamá se llama Marta») y con el
// banner de «sin fuentes». Se reescribe la fusión a su forma canónica
// SOLO para casar las formas de consulta: los dos consumidores de
// este módulo (la puerta vía isMemoryStyleQuery y la respuesta vía
// answerMemoryQuery) normalizan su copia antes de probar las formas.
const MI_FUSIONS: Record<string, string> = {
  mima: "mi mamá",
  mimama: "mi mamá",
  "mimamá": "mi mamá",
  mipa: "mi papá",
  mipapa: "mi papá",
  "mipapá": "mi papá",
  mimadre: "mi madre",
  mipadre: "mi padre",
  mihijo: "mi hijo",
  mihija: "mi hija",
  mihermano: "mi hermano",
  mihermana: "mi hermana",
  miesposo: "mi esposo",
  miesposa: "mi esposa",
  miabuelo: "mi abuelo",
  miabuela: "mi abuela",
};
const MI_FUSION_RE =
  /(^|\s)(mimam[aá]|mima|mipap[aá]|mipa|mimadre|mipadre|mihijo|mihija|mihermano|mihermana|miesposo|miesposa|miabuelo|miabuela)(?=\s|$|[?.,!])/gi;

function unfuseMi(text: string): string {
  return text.replace(MI_FUSION_RE, (_m, pre: string, w: string) => pre + (MI_FUSIONS[w.toLowerCase()] ?? w));
}

export function isMemoryStyleQuery(userText: string): boolean {
  const t = unfuseMi((userText ?? "").trim()).replace(/\s+([?!.]+)$/, "$1");
  if (!t) return false;
  if (REL_NAME_Q_RES.some((re) => re.test(t))) return true;
  if (SELF_NAME_Q_RES.some((re) => re.test(t))) return true;
  if (BDAY_PERSON_Q_RES.some((re) => re.test(t))) return true;
  if (BDAY_SELF_Q_RES.some((re) => re.test(t))) return true;
  if (ABOUT_ME_Q_RES.some((re) => re.test(t))) return true;
  return false;
}

export function answerMemoryQuery(
  userText: string,
  mem: MemoryQueryData,
  lang: MemoryQueryLang
): string | null {
  // 0.1.41 (prueba física): «Que sabes de mi ?» — el espacio antes del
  // signo dejaba fuera todos los patrones anclados con «\??$».
  const t = unfuseMi(userText.trim()).replace(/\s+([?!.]+)$/, "$1");
  if (!t) return null;

  // 1) «¿cómo se llama mi REL?» — nombre de una persona guardada.
  const relNameQ = REL_NAME_Q_RES.map((re) => re.exec(t)).find((m) => m !== null) ?? null;
  if (relNameQ) {
    const rel = relNameQ[1].trim();
    const person = findPersonByRel(mem, rel);
    if (person) return msg("personName", lang, { rel, name: person.name });
    // Puede estar como hecho («mi mamá se llama Marta» con gatillo).
    const fact = mem.facts.find(
      (f) => BIRTHDAY_RE.test(f.content) === false && fold(f.content).includes("se llama")
        && fold(f.content).split(/[^a-z0-9-]+/).some((w) => w && sameRel(w, rel))
    );
    if (fact) {
      const m = /se llama\s+([A-ZÁÉÍÓÚÑÜÀÂÊÔÃÕÇ][\p{L}]+(?: [\p{L}]+)?)/u.exec(fact.content);
      if (m) return msg("personName", lang, { rel, name: m[1] });
    }
    return msg("notKnown", lang);
  }

  // 2) «¿cómo me llamo?» — el nombre del propio usuario.
  if (SELF_NAME_Q_RES.some((re) => re.test(t))) {
    const fact = mem.facts.find((f) => /me llamo|my name is|meu nome é/i.test(f.content));
    if (fact) {
      const m = /(?:me llamo|my name is|meu nome é)\s+(.+)$/i.exec(fact.content);
      if (m) return msg("selfName", lang, { name: m[1].replace(/[.!]+$/, "") });
    }
    return msg("notKnown", lang);
  }

  // 3) Cumpleaños: de una persona o el propio.
  const bdayPersonQ = BDAY_PERSON_Q_RES.map((re) => re.exec(t)).find((m) => m !== null) ?? null;
  if (bdayPersonQ) {
    const rel = bdayPersonQ[1].trim();
    const person = findPersonByRel(mem, rel);
    const fact = findBirthdayFact(mem, { rel, personName: person?.name });
    // 0.1.24 (auditoría, H-13): en EN el «who» abre la frase
    // («{{who}}'s birthday is on…») y salía en minúscula («your
    // mom's birthday…»); en ES/PT va tras «de», en minúscula bien.
    if (fact) return birthdayAnswer(fact, lang === "en" ? `Your ${rel}` : lang === "pt" ? `sua ${rel}` : `tu ${rel}`, lang);
    return msg("notKnown", lang);
  }
  if (BDAY_SELF_Q_RES.some((re) => re.test(t))) {
    const fact = findBirthdayFact(mem, { self: true });
    if (fact) return birthdayAnswer(fact, null, lang);
    return msg("notKnown", lang);
  }

  // 4) «¿qué sabes de mí?» — resumen de lo guardado.
  if (ABOUT_ME_Q_RES.some((re) => re.test(t))) {
    const lines: string[] = [];
    for (const f of mem.facts.slice(0, 6)) lines.push(`• ${f.content}`);
    for (const p of mem.people.slice(0, 4))
      lines.push(`• ${p.name}${p.relationship ? ` (${p.relationship})` : ""}`);
    if (!lines.length) return msg("notKnown", lang);
    return `${msg("aboutYou", lang)}\n${lines.join("\n")}`;
  }

  // 5) Genérica sobre datos propios: «¿qué coche tengo?», «¿dónde vivo?»,
  // «¿cuál es mi color favorito?» — solo si la pregunta es interrogativa
  // y menciona algo en primera persona; si no, no es para esta ruta.
  // La forma es isGenericMemoryQuestionShape y la cita sale de
  // scoreMemoryFacts: las mismas piezas que usa la sonda de la puerta
  // (0.1.23), para que puerta y respuesta nunca discrepen.
  if (isGenericMemoryQuestionShape(t)) {
    const { fact } = scoreMemoryFacts(mem, t);
    if (fact) return msg("factQuote", lang, { fact });
    return msg("notKnown", lang);
  }

  return null;
}
