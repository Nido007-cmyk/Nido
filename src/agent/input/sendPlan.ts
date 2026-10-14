/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * sendPlan.ts — 0.1.38: enrutado por tramo («span») y la cerca por fuente.
 *
 * Al pulsar enviar, antes de clasificar:
 *
 * - **Cerca.** Lo pegado o compartido no llega al router (ver provenance).
 *   Si fuera de la cerca no queda ninguna orden, el mensaje es solo
 *   conversación («inert»): nada de lo citado se ejecuta, aunque tenga
 *   forma de orden.
 * - **Directo.** Si el mensaje entero es UNA orden (escrita, dictada o de
 *   un ejemplo), se ejecuta como siempre: «recuérdame comprar pan mañana».
 * - **Preparar («stage»).** Si sobra texto alrededor de la orden, o la
 *   orden viene junto a texto pegado, la orden NO se ejecuta por coincidir:
 *   se prepara como chip y el toque es el commit. Con dos órdenes en la
 *   frase solo se prepara la primera; lo demás vuelve a la caja como
 *   borrador de texto plano (dos toques, dos acciones).
 *
 * Puro: `isAction` se inyecta (la app usa isStageableAction).
 */

import { classifyIntent } from "../loop/intent";
import { hasFenced, joinSegments, routableText, type Segment } from "./provenance";

export interface Clause {
  start: number;
  end: number;
  text: string;
  /**
   * La separa de la anterior un corte EXPLÍCITO (salto de línea, «; »,
   * «y luego», «and then»): señal clara de otra petición. Un punto normal
   * no lo es: «…orquídeas. Guárdalo en tu memoria…» es una sola petición.
   */
  hard: boolean;
}

export type SendPlan =
  | { kind: "direct" }
  | { kind: "inert" }
  | {
      kind: "stage";
      /** Lo que muestra el chip: la orden tal como se reconoció. */
      label: string;
      /** Lo que se envía al tocar el chip. */
      runText: string;
      /** Lo que vuelve a la caja como borrador tras el toque. */
      draft: string;
    };

// Abreviaturas tras las que un punto no cierra la frase.
const ABBREV_RE = /(?:^|\s)(?:dr|dra|sr|sra|srta|mr|mrs|ms|st|av|etc|vs|p\.ej|ej|núm|num|aprox|approx)\.$/iu;

// Conectores que encadenan otra orden: «… y luego …», «… and then …».
const CONNECTOR_RE = /,?\s+(?:y\s+luego|y\s+despu[eé]s|and\s+then|e\s+depois|e\s+ent[aã]o)\s+/giu;

/**
 * Corta el texto en frases: salto de línea, «; », «? », «! », «. » seguido
 * de mayúscula (y no tras una abreviatura), y los conectores «y luego» /
 * «and then» / «e depois». Conservador a propósito: «comprar pan y leche»
 * es UNA orden.
 */
export function splitClauses(text: string): Clause[] {
  const cuts: Array<{ at: number; resume: number; hard: boolean }> = [];
  const boundary = /(\n+|;\s+|[?!¿¡]+\s+|\.\s+(?=[A-ZÁÉÍÓÚÑÜ¿¡]))/gu;
  let m: RegExpExecArray | null;
  while ((m = boundary.exec(text))) {
    const at = m.index;
    if (m[0].startsWith(".") && ABBREV_RE.test(text.slice(Math.max(0, at - 8), at + 1))) continue;
    // El signo de cierre pertenece a la frase que termina.
    const keep = /^[?!.;]+/.exec(m[0])?.[0].length ?? 0;
    cuts.push({ at: at + keep, resume: at + m[0].length, hard: /\n|;/.test(m[0]) });
  }
  CONNECTOR_RE.lastIndex = 0;
  while ((m = CONNECTOR_RE.exec(text))) cuts.push({ at: m.index, resume: m.index + m[0].length, hard: true });
  cuts.sort((a, b) => a.at - b.at);
  const out: Clause[] = [];
  let start = 0;
  let hard = false;
  for (const c of cuts) {
    if (c.at < start) continue;
    push(out, text, start, c.at, hard);
    start = c.resume;
    hard = c.hard;
  }
  push(out, text, start, text.length, hard);
  return out;
}

function push(out: Clause[], text: string, start: number, end: number, hard: boolean): void {
  const raw = text.slice(start, end);
  const lead = raw.length - raw.trimStart().length;
  const t = raw.trim();
  if (t) out.push({ start: start + lead, end: start + lead + t.length, text: t, hard: out.length > 0 && hard });
}

// La segunda frase continúa la primera («Guárdalo…», «Save it…», «Hazlo
// mañana»): no es otra petición.
const CONTINUATION_RE =
  /^(?:\p{L}+(?:lo|la|los|las|le|les|selo|sela)(?![\p{L}])|(?:\S+\s+){0,2}(?:it|that|this|them|esto|eso|isso|isto|lo|la)(?![\p{L}]))/iu;

// Saludos, gracias y acuses: no son «texto de más» que obligue a preparar.
const FILLER_RE =
  /^(?:hola|hey|hi|hello|buenas|buenos\s+d[ií]as|buenas\s+(?:tardes|noches)|oye|gracias|muchas\s+gracias|thanks|thank\s+you|ok|okay|vale|porfa|por\s+favor|please|ol[aá]|oi|bom\s+dia|boa\s+(?:tarde|noite)|obrigad[oa]|perfecto|perfect|genial|great)(?:\s+nido)?[\s!.,]*$/iu;

export function isFiller(clause: string): boolean {
  return FILLER_RE.test(clause.trim());
}

const QUESTION_RE =
  /\?|^\s*¿|^(?:qu[eé]|c[oó]mo|cu[aá]nto|cu[aá]ndo|d[oó]nde|por\s+qu[eé]|qui[eé]n|cu[aá]l|what|how|when|where|why|who|which|o\s+que|quanto|quando|onde|quem|qual)(?![\p{L}])/iu;

/**
 * ¿Es una orden con efecto (crear, guardar, borrar, programar…)? Las
 * preguntas («¿cómo se llama mi mamá?») son lecturas: no se preparan.
 */
export function isStageableAction(text: string): boolean {
  const t = text.trim();
  if (!t || QUESTION_RE.test(t)) return false;
  const intent = classifyIntent(t);
  return intent === "actuar" || intent === "recordar";
}

export function planSend(text: string, segments: Segment[], isAction: (t: string) => boolean = isStageableAction): SendPlan {
  const query = text.trim();
  if (!query) return { kind: "direct" };
  // Tramos que no cuadran con el texto (p. ej. el reenvío de un mensaje):
  // sin cerca, como siempre.
  const known = segments.length > 0 && joinSegments(segments).trim() === query;
  if (known && hasFenced(segments)) {
    const routable = routableText(segments);
    if (!routable || !isAction(routable)) return { kind: "inert" };
    // Orden escrita junto a texto citado («guarda esto como nota: …»): se
    // prepara; el toque envía el mensaje completo.
    return { kind: "stage", label: routable, runText: query, draft: "" };
  }
  const clauses = splitClauses(query);
  const meaningful = clauses.filter((c) => !isFiller(c.text));
  if (meaningful.length <= 1) return { kind: "direct" };
  const first = meaningful.find((c) => isAction(c.text));
  if (!first) return { kind: "direct" };
  const others = meaningful.filter((c) => c !== first);
  // Corte explícito → otra petición. Solo puntos → hace falta otra ORDEN
  // independiente (dos órdenes = dos toques); si no, es una sola petición.
  const separate = others.some(
    (c) => c.hard || (isAction(c.text) && !CONTINUATION_RE.test(c.text)),
  );
  if (!separate) return { kind: "direct" };
  const draft = (query.slice(0, first.start) + " " + query.slice(first.end))
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,;.]+|[\s,;]+$/g, "")
    .replace(/^(?:y\s+luego|y\s+despu[eé]s|and\s+then|e\s+depois|e\s+ent[aã]o)\s+/iu, "")
    .trim();
  return { kind: "stage", label: first.text, runText: first.text, draft: isFiller(draft) ? "" : draft };
}
