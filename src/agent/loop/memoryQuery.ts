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
  ["abuelo", "grandfather", "avo", "avô"],
  ["abuela", "grandmother", "avo", "avó"],
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

/** Coincidencia de parentesco SIN plegar acentos (solo minúsculas):
 *  «avô» y «avó» se distinguen solo por el acento y el pliegue los
 *  funde en «avo»; los grupos llevan las dos formas acentuadas para
 *  que esta pasada las mantenga separadas. */
function exactSameRel(a: string, b: string): boolean {
  const la = a.trim().toLowerCase();
  const lb = b.trim().toLowerCase();
  if (la === lb) return true;
  return REL_GROUPS.some((g) => g.includes(la) && g.includes(lb));
}

function findPersonByRel(mem: MemoryQueryData, rel: string) {
  // B9 (barrido «revisa todo», clase 1): con el abuelo (avô) guardado
  // antes que la abuela (avó), «minha avó» servía el nombre del abuelo
  // como si fuera la abuela — los dos grupos contienen «avo» plegado
  // y find devolvía el primer match. Primera pasada EXACTA, sin
  // plegar: si la forma dictada distingue (avô ≠ avó, sinónimos con
  // su grafía), manda ella. La pasada plegada queda para lo demás
  // (sinónimos entre idiomas, dictado sin acentos) con un solo
  // guardia: si pregunta y ficha traen las dos formas acentuadas del
  // par avô/avó y no son la misma, no hay match — sin abuela
  // guardada, la respuesta es la honesta, no el abuelo.
  const exact = mem.people.find((p) => p.relationship && exactSameRel(p.relationship, rel));
  if (exact) return exact;
  const relLow = rel.trim().toLowerCase();
  return (
    mem.people.find((p) => {
      if (!p.relationship) return false;
      const pLow = p.relationship.trim().toLowerCase();
      if ((relLow === "avô" || relLow === "avó") && (pLow === "avô" || pLow === "avó") && pLow !== relLow) {
        return false;
      }
      return sameRel(p.relationship, rel);
    }) ?? null
  );
}

const STR: Record<string, Record<MemoryQueryLang, string>> = {
  personName: {
    es: "Tu {{rel}} se llama {{name}}.",
    en: "Your {{rel}}'s name is {{name}}.",
    pt: "{{poss}} {{rel}} se chama {{name}}.",
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

/** Posesivo pt según el género del parentesco (B10 = ADV-GM1-C1):
 *  la plantilla usaba «Sua» invariante y, abierto «meu» por B3,
 *  servía «Sua pai». La forma acentuada manda en el par avô/avó; el
 *  resto va por la lista masculina; lo no listado conserva «Sua»,
 *  que es el suelo de hoy. es «Tu» y en «Your» son neutros. */
const PT_MASC_REL = new Set([
  "pai", "irmao", "tio", "filho", "esposo", "marido", "sogro",
  "neto", "sobrinho", "primo", "cunhado", "namorado", "amigo",
]);
function ptPossessive(rel: string): "Seu" | "Sua" {
  const low = rel.trim().toLowerCase();
  if (low === "avô") return "Seu";
  if (low === "avó") return "Sua";
  return PT_MASC_REL.has(fold(rel)) ? "Seu" : "Sua";
}

/** Forma pt canónica de cada grupo de REL_GROUPS, en su mismo orden:
 *  el parentesco de un registro servido (ficha o hecho), dicho en la
 *  lengua de la plantilla. «pareja» no trae forma pt en su grupo. */
const REL_PT_CANON: (string | null)[] = [
  "mãe", "pai", "irmão", "irmã", "esposa", "marido", "filho", "filha",
  "avô", "avó", "tio", "tia", "primo", "prima", "amigo", "amiga",
  "namorado", "namorada", "cunhado", "cunhada", "sogro", "sogra",
  "neto", "neta", "sobrinho", "sobrinha", null,
];

/** ADV-F-C2 (adversaria de formas): el posesivo pt se calculaba del
 *  token de la PREGUNTA, y con el dictado sin acento («minha avo») la
 *  respuesta servía «Sua avo se chama José.» — posesivo femenino para
 *  el abuelo, contra la propia ficha («avô»), que la app sí conoce.
 *  El género sale ahora del registro SERVIDO: si su parentesco, en su
 *  grafía exacta, pertenece a un solo grupo, manda la forma canónica
 *  pt de ese grupo. Si la grafía es ambigua entre grupos («avo»
 *  plegado, «cousin», «friend») o no hay registro, manda el token
 *  preguntado: ese es el suelo declarado por la tanda B9. */
function ptServingRel(servedRel: string | undefined, askedRel: string): string {
  if (servedRel) {
    const low = servedRel.trim().toLowerCase();
    let hit = -1;
    let hits = 0;
    REL_GROUPS.forEach((g, i) => {
      if (g.includes(low)) {
        hit = i;
        hits += 1;
      }
    });
    if (hits === 1 && REL_PT_CANON[hit]) return REL_PT_CANON[hit]!;
  }
  return askedRel;
}

const BIRTHDAY_RE = /cumplea[ñn]os|aniversario|birthday|aniversário/i;

/** La cláusula que trae un nombre dentro de un hecho, por lengua del
 *  hecho (B8): «se llama» (es), «se chama» (pt), «name is» /
 *  «is called» (en). ADV-F-C1 (adversaria de formas): dos redacciones
 *  pt comunes quedaban fuera — el reflexivo «chama-se» («a minha mãe
 *  chama-se Maria») y el marco «o nome d… é» («o nome do meu pai é
 *  João») — y la app decía «no me lo has contado» teniéndolo. La
 *  alternativa del marco exige la cópula «é» como palabra suelta
 *  (miradas con \p{L}: \b no ve las letras acentuadas). */
const NAME_CLAUSE_RE = /se llama|se chama|chama-se|name is|is called|^o nome\b[^.!?]*?(?<![\p{L}])é(?![\p{L}])/iu;

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
  // Pieza 4 (resto de ADV-M1): la pregunta se des-fusiona antes de
  // puntuar («mima» → «mi mamá»), como ya hacía la vía de respuesta.
  // Esta función es la ÚNICA fuente de puntuación (puerta, respuesta y
  // testigo de ADV2): sin el plegado aquí, la sonda de la puerta no ve
  // el término «mamá» y la forma fusionada no entra pese a tener el
  // hecho guardado. Idempotente sobre texto ya des-fusionado.
  const tokens = fold(unfuseMi(question))
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
  // B4 (barrido «revisa todo», clase 1): las formas clásicas ganan la
  // cola de cortesía que los patrones nuevos de G-M1-R1 ya traían —
  // el dictado con «por favor»/«please» es habla común en los tres
  // idiomas y caía a notKnown con la ficha guardada.
  /¿?c[oó]mo se llama mi ([a-záéíóúñü ]+?)(?:[,\s]+(?:por favor|porfa))?\??$/i,
  /what'?s my ([a-z -]+?)'?s name(?:[,\s]+please)?\??$/i,
  // 0.1.34 (barrido de paridad): «what is my mom's name» (sin contraer) y
  // «what is the name of my mom» caían al modelo sin memoria guardada.
  /what is my ([a-z -]+?)'?s name(?:[,\s]+please)?\??$/i,
  /what is the name of my ([a-z -]+?)(?:[,\s]+please)?\??$/i,
  // B5 (barrido «revisa todo», clase 1): la forma «called» de REL en.
  /what(?:'s| is) my ([a-z -]+?) called(?:[,\s]+please)?\??$/i,
  /como se chama (?:a )?(?:minha?|meu) ([a-záéíóúãõçô ]+?)(?:[,\s]+por favor)?\??$/i,
  // G-M1-R1 (post-0.1.69, cruce de Grok): la forma española «¿cuál es
  // el nombre de mi X?» y su espejo portugués no estaban — la inglesa
  // entró en el barrido de paridad de la 0.1.34 y estas no. Sin patrón,
  // la pregunta caía a la rama genérica (punto 5), que solo puntúa
  // hechos: con el nombre guardado SOLO como ficha de persona, la
  // respuesta era «no me lo has contado» teniéndolo. Con el patrón, la
  // forma entra en la rama 1, donde la ficha se sirve por
  // findPersonByRel con la misma respuesta que da el hecho — el
  // asiento equivalente que la ficha 12 de la estantería nombra.
  // scoreMemoryFacts NO se toca: es la única fuente de puntuación de
  // la puerta y del testigo de ADV2, y moverla movería otras rutas.
  // Cola de cortesía («…, por favor») como en las formas de hora y
  // fecha de intent.ts; el dictado sin acentos ni signos casa por las
  // clases (cu[aá]l, (?:é|e)) y la des-fusión previa (unfuseMi).
  /¿?cu[aá]l es el nombre de mi ([a-záéíóúñü ]+?)(?:[,\s]+(?:por favor|porfa))?\??$/i,
  /qual (?:é|e) o nome d[aeo] (?:minha?|meu) ([a-záéíóúãõçô ]+?)(?:[,\s]+por favor)?\??$/i,
];
const SELF_NAME_Q_RES: RegExp[] = [
  /¿?c[oó]mo me llamo\??$/i,
  /what'?s my name\??$/i,
  /como (?:eu )?me chamo\??$/i,
  /qual (?:é|e) (?:o )?meu nome\??$/i,
  // B1+B2 (barrido «revisa todo», clase 1): SELF se quedó sin la
  // forma que G-M1-R1 dio a REL y que REL en ganó en la 0.1.34 —
  // «¿cuál es mi nombre?» y «what is my name?» caían al modelo
  // (puerta false, classifyIntent «conversar») teniendo el hecho.
  /¿?cu[aá]l es mi nombre\??$/i,
  /what is my name\??$/i,
];
const BDAY_PERSON_Q_RES: RegExp[] = [
  /cu[aá]ndo es el cumplea[ñn]os de mi ([a-záéíóúñü ]+?)\??$/i,
  // B6 (barrido «revisa todo», clase 1): la contraída «when's» entra
  // junto a «when is», como SELF y REL ya traían la suya.
  /when(?:'s| is) my ([a-z -]+?)'?s birthday\??$/i,
  /quando (?:é|e) o anivers[aá]rio d[aeo] (?:minha?|meu) ([a-záéíóúãõç ]+?)\??$/i,
];
const BDAY_SELF_Q_RES: RegExp[] = [
  /cu[aá]ndo es mi cumplea[ñn]os\??$/i,
  /when is my birthday\??$/i,
  /quando (?:é|e) (?:o )?meu anivers[aá]rio\??$/i,
];
const ABOUT_ME_Q_RES: RegExp[] = [
  /qu[eé] (?:sabes|recuerdas|tienes guardado|has guardado) (?:de|sobre) m[ií]\??$/i,
  // B7 (barrido «revisa todo», clase 1): en gana «have saved/stored»
  // y pt los verbos que le faltaban (solo traía «sabe»): «lembra»,
  // «guardou» y «salvou» daban null — salían de la ruta de memoria.
  /what do you (?:know|remember|have saved|have stored) about me\??$/i,
  /o que (?:você|voce) (?:sabe|lembra|guardou|salvou) sobre mim\??$/i,
];
/**
 * Primera persona (rama genérica de answerMemoryQuery, punto 5).
 * 0.1.42 (barrido): también un pasado en primera persona («¿dónde dejé el
 * coche?», «¿dónde estacioné?»). Con «u» y límites por letra: con \b, la
 * «é» final de «dejé» no cerraba la palabra y la forma nunca casaba.
 */
const FIRST_PERSON_RE =
  /(?<![\p{L}])(?:mi|mis|me|my|mine|i|meu|minha|meus|minhas|tengo|vivo|trabajo|tenho|moro|chamo|dej[eé]|puse|guard[eé]|estacion[eé]|aparqu[eé]|deixei|estacionei)(?![\p{L}])/iu;

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
/**
 * 0.1.42 (barrido): «¿dónde está la clave del wifi?» no está en primera
 * persona, pero si TODOS sus términos de contenido están en un mismo hecho
 * guardado (y son al menos dos), la pregunta es sobre ese hecho. Pregunta +
 * cobertura total: un documento o la charla rara vez comparten todos los
 * términos con una frase que el usuario guardó.
 */
export function memoryFullCoverageHit(userText: string, mem: MemoryQueryData): boolean {
  const t = (userText ?? "").trim();
  if (!t || !mem.facts.length) return false;
  const isQuestion = /^\s*¿/.test(t) || /\?\s*$/.test(t);
  if (!isQuestion) return false;
  const { score, tokenCount } = scoreMemoryFacts(mem, t);
  return tokenCount >= 2 && score === tokenCount;
}

// ---------------------------------- ADV2-09: el testigo exige el dato

/**
 * Segunda adversaria, ADV2-09: el testigo de H-06 se gana por la
 * FORMA del turno, y dos de las puertas que lo otorgan (la sonda:
 * hit fuerte y cobertura total) deciden por solape de tokens con un
 * hecho — sin mirar si el dato preguntado vive en ese hecho. Con la
 * herramienta de memoria desactivada (un estado que el producto
 * ofrece), la capa determinista no corre y la prosa inventada sobre
 * un dato que NO está en la memoria salía exenta de la red: el
 * hecho del cajón dice «horario» y no contiene ninguna hora.
 *
 * Diseño (a), el medido en la preparación contra el (b): cuando la
 * promoción viene de la sonda, el testigo exige además que el hecho
 * que promueve contenga una INSTANCIA de la clase de dato pedida —
 * la instancia es el dato, no la palabra de la clase. Sin clase
 * reconocida en la pregunta, el testigo no cambia: la exención de
 * H-06 queda intacta. (El diseño (b) — sin testigo cuando la
 * herramienta está apagada — se midió y se rechazó: volteaba la
 * fixture asentada del propio H-06 en ese mismo estado.)
 *
 * Alcance declarado: solo las promociones de la sonda. Los turnos
 * que el clasificador ruta «recordar» conservan el testigo de
 * siempre; esa puerta es otra familia (Núcleo 3). La clase
 * «lugar/dirección» no entra: no es comprobable con una instancia
 * cerrada (los lugares son vocabulario abierto).
 */
export type MemoryDatumClass = "time" | "number" | "date";

/** Palabras-gatillo por clase, cerradas y trilingües (tokens de la
 *  pregunta plegada; las formas son la palabra y sus plurales o
 *  flexiones del mismo concepto, nada más). */
const DATUM_TRIGGER_WORDS: Record<MemoryDatumClass, readonly string[]> = {
  time: [
    "horario", "horarios", "hora", "horas", "hour", "hours",
    "abre", "abren", "cierra", "cierran", "opening", "schedule",
  ],
  number: [
    "numero", "numeros", "telefono", "telefone", "tarjeta", "cartao",
    "clave", "codigo", "number", "numbers", "phone", "card", "code", "senha",
  ],
  date: [
    "cuando", "fecha", "cumpleanos", "aniversario",
    "when", "date", "birthday", "quando",
  ],
};

/** Meses (tokens plegados, es/en/pt): una fecha nombrada ES una
 *  instancia de fecha; un año suelto no lo es. */
const MONTH_TOKENS = new Set([
  "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
  "septiembre", "setiembre", "octubre", "noviembre", "diciembre",
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
  "janeiro", "fevereiro", "marco", "maio", "junho", "julho",
  "setembro", "outubro", "novembro", "dezembro",
]);

/** La instancia de cada clase dentro del hecho (texto plegado):
 *  hora = H:MM, «12 am/pm» o un rango («de 8 a 18», «from 9 to 5»,
 *  «das 8 às 18»); número = corrida de ≥3 dígitos con separadores;
 *  fecha = ISO, d/m o un mes nombrado (este último se prueba por
 *  token en factHasDatumInstance). */
const DATUM_INSTANCE_RES: Record<MemoryDatumClass, readonly RegExp[]> = {
  time: [
    /\b\d{1,2}:\d{2}\b/,
    /\b\d{1,2}\s*(?:am|pm)\b/,
    /\bde\s+\d{1,2}\s+a\s+\d{1,2}\b/,
    /\bdas\s+\d{1,2}\s+as\s+\d{1,2}\b/,
    /\bfrom\s+\d{1,2}\s+to\s+\d{1,2}\b/,
  ],
  number: [/\d(?:[\s.\-]?\d){2,}/],
  date: [/\b\d{4}-\d{2}-\d{2}\b/, /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/],
};

/** ¿Contiene el hecho una instancia de la clase pedida? */
export function factHasDatumInstance(fact: string, cls: MemoryDatumClass): boolean {
  const f = fold(fact);
  if (DATUM_INSTANCE_RES[cls].some((re) => re.test(f))) return true;
  if (cls === "date") return f.split(/[^a-z0-9]+/).some((w) => MONTH_TOKENS.has(w));
  return false;
}

/** Las clases de dato que la pregunta pide (vacío = ninguna). */
export function questionDatumClasses(question: string): MemoryDatumClass[] {
  const tokens = new Set(fold(question).split(/[^a-z0-9]+/).filter((w) => w.length > 0));
  return (Object.keys(DATUM_TRIGGER_WORDS) as MemoryDatumClass[]).filter((cls) =>
    DATUM_TRIGGER_WORDS[cls].some((w) => tokens.has(w)),
  );
}

/**
 * El testigo de una promoción de la sonda: ¿puede este turno
 * eximirse de la red como «respondido desde la memoria»? La misma
 * fuente de puntuación que la puerta y la respuesta
 * (scoreMemoryFacts): el hecho que promueve es su mejor hecho. Si
 * la pregunta no pide ninguna clase cerrada, el testigo es el de
 * siempre (true). Si la pide, el hecho debe contener TODAS las
 * clases pedidas (ADV3, A3-05): la exención cubre el turno entero,
 * y con el SOME de antes una sola clase presente dejaba la
 * ausente sin red. Con una sola clase, every ≡ some: el
 * desenlace de las preguntas de una clase no cambia.
 */
export function memoryProbeWitness(question: string, mem: MemoryQueryData): boolean {
  const classes = questionDatumClasses(question);
  if (classes.length === 0) return true;
  const { fact } = scoreMemoryFacts(mem, question);
  if (!fact) return true;
  return classes.every((cls) => factHasDatumInstance(fact, cls));
}

export function isGenericMemoryQuestionShape(userText: string): boolean {
  // Pieza 4 (resto de ADV-M1): paridad con la puerta real — la forma se
  // juzga sobre el texto des-fusionado («¿cómo se llama mima?» trae
  // «mi» tras des-fusionar), igual que isMemoryStyleQuery.
  const t = unfuseMi((userText ?? "").trim());
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

export function unfuseMi(text: string): string {
  return text.replace(MI_FUSION_RE, (_m, pre: string, w: string) => pre + (MI_FUSIONS[w.toLowerCase()] ?? w));
}

export function isMemoryStyleQuery(userText: string): boolean {
  const t = unfuseMi((userText ?? "").trim()).replace(/\s+([?!.]+)$/, "$1").replace(/[.!]+$/, "");
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
  const t = unfuseMi(userText.trim()).replace(/\s+([?!.]+)$/, "$1").replace(/[.!]+$/, "");
  if (!t) return null;

  // 1) «¿cómo se llama mi REL?» — nombre de una persona guardada.
  const relNameQ = REL_NAME_Q_RES.map((re) => re.exec(t)).find((m) => m !== null) ?? null;
  if (relNameQ) {
    const rel = relNameQ[1].trim();
    const person = findPersonByRel(mem, rel);
    if (person) return msg("personName", lang, { rel, name: person.name, poss: ptPossessive(ptServingRel(person.relationship, rel)) });
    // Puede estar como hecho («mi mamá se llama Marta» con gatillo).
    // B8 (barrido «revisa todo», clase 1; semilla 2 de la adversaria
    // de G-M1-R1): la cláusula que trae el nombre se reconoce en la
    // lengua del HECHO, no solo en español — «se chama» (pt) y
    // «name is» / «is called» (en) guardan el mismo dato y la app
    // decía «no me lo has contado» en ninguna dirección. La
    // canónica es el suelo: el hecho es sirve como hasta hoy.
    const fact = mem.facts.find(
      (f) => BIRTHDAY_RE.test(f.content) === false && NAME_CLAUSE_RE.test(f.content)
        && fold(f.content).split(/[^a-z0-9-]+/).some((w) => w && sameRel(w, rel))
    );
    if (fact) {
      // ADV-F-C1: la extracción espeja las cláusulas del selector —
      // «chama-se» trae el nombre tras el reflexivo, y en el marco
      // «o nome d… é» el nombre va tras la cópula, al final.
      const m =
        /(?:se llama|se chama|chama-se|name is|is called)\s+([A-ZÁÉÍÓÚÑÜÀÂÊÔÃÕÇ][\p{L}]+(?: [\p{L}]+)?)/iu.exec(fact.content) ??
        /^o nome\b[^.!?]*?(?<![\p{L}])é\s+([A-ZÁÉÍÓÚÑÜÀÂÊÔÃÕÇ][\p{L}]+(?: [\p{L}]+)?)/iu.exec(fact.content);
      // ADV-F-C2, asiento del hecho: la palabra de parentesco tal
      // como está escrita en el hecho (con su acento) es el registro
      // servido en este asiento; de ella sale el género del posesivo.
      const factRel = fact.content.split(/[^\p{L}]+/u).find((w) => w && sameRel(w, rel));
      if (m) return msg("personName", lang, { rel, name: m[1], poss: ptPossessive(ptServingRel(factRel, rel)) });
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
    if (fact) return birthdayAnswer(fact, lang === "en" ? `Your ${rel}` : lang === "pt" ? `${ptPossessive(rel).toLowerCase()} ${rel}` : `tu ${rel}`, lang);
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
  // 0.1.42: la otra puerta de la sonda (memoryFullCoverageHit), con la
  // misma regla, para que puerta y respuesta tampoco discrepen aquí.
  if (memoryFullCoverageHit(t, mem)) {
    const { fact } = scoreMemoryFacts(mem, t);
    if (fact) return msg("factQuote", lang, { fact });
  }

  return null;
}
