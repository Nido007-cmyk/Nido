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
  // "apunta esto para siempre: X"
  { re: /apunta (esto|eso) para (siempre|despu[eé]s)[:\s]+(.+)/i, group: 3 },
  // Inglés: "remember that X" / "remember: X"
  { re: /remember( that)?[:\s]+(.+)/i, group: 2 },
  // Inglés: "don't forget that X"
  { re: /don't forget( that)?[:\s]+(.+)/i, group: 2 },
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
  return result;
}

const MESES: Record<string, number> = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
};

/**
 * Extrae una fecha de un texto en español (ej: "15 de marzo").
 * Retorna la fecha ISO (año actual, o el siguiente si ya pasó) o null.
 */
export function extractDateISO(text: string): string | null {
  // Español: "15 de marzo"
  const mEs = /(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/i.exec(text);
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
  return null;
}

/** Calcula la próxima ocurrencia futura de un día/mes (para cumpleaños). */
function nextOccurrence(month: number, day: number): string {
  const now = new Date();
  let year = now.getFullYear();
  const candidate = new Date(year, month, day, 9, 0, 0);
  if (candidate.getTime() < now.getTime()) {
    year += 1;
  }
  return new Date(year, month, day, 9, 0, 0).toISOString();
}

/** Resultado de la extracción de persona. */
export interface PersonExtraction {
  name: string;
  relationship?: string;
  notes?: string;
}

/**
 * PEOPLE-FIX 2026-10-07: extrae una persona del texto de forma determinística.
 * Patrones: "mi mamá se llama María", "recuerda que mi hermano Juan...",
 * "mi esposa se llama Ana".
 */
export function extractPerson(userText: string): PersonExtraction | null {
  const trimmed = userText.trim();
  if (!trimmed) return null;

  // "mi [relación] se llama [Nombre]"
  const m1 = /mi (mamá|papá|madre|padre|hermano|hermana|esposo|esposa|hijo|hija|novio|novia|amigo|amiga|tío|tía|primo|prima|abuelo|abuela|sobrino|sobrina) se llama ([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?: [A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)/i.exec(trimmed);
  if (m1) {
    return {
      name: m1[2].trim(),
      relationship: m1[1].toLowerCase(),
    };
  }

  // "recuerda que mi [relación] [Nombre]..."
  const m2 = /recuerda( que)? mi (mamá|papá|madre|padre|hermano|hermana|esposo|esposa|hijo|hija) ([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/i.exec(trimmed);
  if (m2) {
    return {
      name: m2[3].trim(),
      relationship: m2[2].toLowerCase(),
      notes: trimmed,
    };
  }

  // PEOPLE-FIX 2026-10-07: más patrones.
  // "my mom's name is Mary", "my brother is called John"
  const m3 = /my (mom|dad|mother|father|brother|sister|husband|wife|son|daughter|boyfriend|girlfriend|friend)(?:'s name)? is (?:called )?([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i.exec(trimmed);
  if (m3) {
    return {
      name: m3[2].trim(),
      relationship: m3[1].toLowerCase(),
    };
  }

  // "se llama [Nombre], es mi [relación]"
  const m4 = /se llama ([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?: [A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*),? es mi (mamá|papá|hermano|hermana|esposo|esposa|hijo|hija)/i.exec(trimmed);
  if (m4) {
    return {
      name: m4[1].trim(),
      relationship: m4[2].toLowerCase(),
    };
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
    if (match && match[group]) {
      // FIX 2026-10-07: limpiar instrucciones trailing ("Save it so you can
      // remind me in time") que no son parte del hecho.
      const content = stripTrailingInstructions(match[group].trim());
      // Validación mínima: el contenido debe ser sustancial.
      if (content.length >= 3) {
        return {
          content,
          category: detectCategory(content),
        };
      }
    }
  }
  return null;
}
