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
  // "acuérdate de que X" / "acuérdate que X"
  { re: /acu[eé]rdate( de)?( que)?[:\s]+(.+)/i, group: 3 },
  // "no olvides que X" / "no te olvides de que X"
  { re: /no (te )?olvides( de)?( que)?[:\s]+(.+)/i, group: 4 },
  // "guarda en tu memoria que X" / "guarda en memoria: X"
  { re: /gu[aá]rda\w*( esto| eso)? en (tu |la )?memoria( que)?[:\s]+(.+)/i, group: 4 },
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
 * Intenta extraer un hecho de memoria del texto del usuario de forma
 * determinística. Retorna null si no hay un patrón explícito.
 *
 * Solo maneja casos claros y explícitos. Si el texto es ambiguo o no
 * coincide con ningún patrón, retorna null y el flujo normal del agente
 * (con el LLM) toma el control.
 */
export function extractRememberFact(userText: string): RememberExtraction | null {
  const trimmed = userText.trim();
  if (!trimmed) return null;

  for (const { re, group } of EXTRACTION_PATTERNS) {
    const match = re.exec(trimmed);
    if (match && match[group]) {
      const content = match[group].trim();
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
