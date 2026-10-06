/**
 * intent.ts — NIDO: clasificación determinista de intención del agente.
 *
 * Tres intenciones, en español (con respaldo en inglés):
 * - "recordar": el usuario quiere que algo quede en la memoria persistente.
 * - "actuar": el usuario pide una acción local (nota, recordatorio, abrir app, hora…).
 * - "conversar": todo lo demás (charla, preguntas, conocimiento).
 *
 * Puro, sin dependencias, testeable. Hereda el espíritu de
 * `src/routing/classify.ts` (regex deterministas, cero ML para decidir).
 */

export type AgentIntent = "conversar" | "recordar" | "actuar";

const REMEMBER_PATTERNS: RegExp[] = [
  /recuerda( que|te)?/i,
  /acu[eé]rdate/i,
  /no (olvides|te olvides)/i,
  // Tolerante a enclíticos y acentos: "guárdalo/guardala en tu memoria"
  /gu[aá]rda\w* (esto |eso )?en (tu |la )?memoria/i,
  /memoriza/i,
  /apunta (esto|eso) para (siempre|despu[eé]s)/i,
  /a partir de ahora/i,
  /ten en cuenta (que|siempre)/i,
  /\bremember\b/i,
  /\bdon't forget\b/i,
];

const ACT_PATTERNS: RegExp[] = [
  /crea (un |una )?recordatorio/i,
  /recu[eé]rdame/i,
  /\bpon (una )?alarma/i,
  /av[ií]same/i,
  /guarda (una )?nota/i,
  /anota/i,
  /toma (una )?nota/i,
  /lista (mis )?notas/i,
  /mu[eé]strame (mis )?notas/i,
  /lee la nota/i,
  /abre (la app|el)?/i,
  /\babrir\b/i,
  /qu[eé] hora es/i,
  /qu[eé] fecha es/i,
  /qu[eé] d[ií]a es hoy/i,
  // "Recuerda / no olvides / acuérdate de" + infinitivo = recordatorio (acción),
  // no memoria: "recuerda comprar pan" ≠ "recuerda que mi cumple es en mayo".
  /\brecuerda +[a-záéíóúñü]+(ar|er|ir)\b/i,
  /\bno (te )?olvides +[a-záéíóúñü]+(ar|er|ir)\b/i,
  /\bacu[eé]rdate de +[a-záéíóúñü]+(ar|er|ir)\b/i,
  /\bcreate a reminder\b/i,
  /\bremind me\b/i,
  /\btake a note\b/i,
  /\bopen the app\b/i,
  /\bwhat time is it\b/i,
  // Fase B: calculadora, conversiones, calendario, contactos, llamadas, archivos.
  /\bcalcula\b/i,
  /cu[áa]nto es/i,
  /\bconvierte\b/i,
  /\bagenda\b/i,
  /crea (un |una )?evento/i,
  /a[ñn]ade (un |una )?(evento|cita)/i,
  /qu[ée] tengo/i,
  /cu[áa]ndo tengo/i,
  /mis (eventos|citas)/i,
  /llama a\b/i,
  /ll[áa]mame/i,
  /m[áa]rcale/i,
  /env[íi]a(le)? (un )?(mensaje|sms)/i,
  /m[áa]ndale (un )?(mensaje|sms)/i,
  /escr[íi]bele/i,
  /busca (el )?contacto/i,
  /en mis contactos/i,
  /el (tel[ée]fono|n[úu]mero) de/i,
  /lee (el |este |mi )?archivo/i,
  /analiza (el |este )?archivo/i,
  /\bcalculate\b/i,
  /\bconvert\b/i,
  /\bcall\b/i,
  // Fase D: análisis de datos.
  /analiza (mis |los |estos )?datos/i,
  /analiza (el |este )?(csv|excel|archivo)/i,
  /\bestad[íi]sticas de/i,
  /cu[áa]nto (suma|suman)/i,
  // Fase E: mensajería NIDO a NIDO (cifrada, sin internet).
  /por nido/i,
  /\bnido\b.*(mensaje|empareja|c[óo]digo|contacto|bandeja)/i,
  /(mensaje|empareja|c[óo]digo|contacto|bandeja).*nido/i,
  /empar[ée]jame con/i,
  /escanea (el |este )?qr/i,
  /mi c[óo]digo (de emparejamiento|nido)/i,
];

/**
 * C5-2026-10-06: "recuérdame que [cláusula]" es petición de MEMORIA
 * ("recuerda que mi cumple es en mayo"), no de acción. Se evalúa ANTES
 * que el ACT genérico /recu[eé]rdame/ para no caer en la rama equivocada.
 */
const REMEMBER_BEFORE_ACT_PATTERNS: RegExp[] = [
  /recu[eé]rdame que\b/i,
];

/**
 * Orden: recordar-específico > actuar > recordar > conversar. Los patrones
 * de actuar con infinitivo ("recuerda comprar pan") se evalúan antes que
 * los de memoria genéricos ("recuerda que…"), resolviendo la ambigüedad
 * del español; pero "recuérdame que + cláusula" va primero (memoria).
 */
export function classifyIntent(text: string): AgentIntent {
  const t = (text ?? "").trim();
  if (!t) return "conversar";
  if (REMEMBER_BEFORE_ACT_PATTERNS.some((re) => re.test(t))) return "recordar";
  if (ACT_PATTERNS.some((re) => re.test(t))) return "actuar";
  if (REMEMBER_PATTERNS.some((re) => re.test(t))) return "recordar";
  return "conversar";
}
