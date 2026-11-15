/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * provenance.ts — 0.1.38: de dónde vino cada tramo del texto de la caja.
 *
 * La «cerca» del enrutado se apoya en CÓMO llegó el texto, no en marcas
 * dentro del propio texto: lo pegado y lo compartido desde otra app es
 * contenido citado y el router no lo mira (un «recuérdame…» dentro no es
 * ninguna evidencia de orden). Lo escrito, lo dictado con el micrófono del
 * chat y los ejemplos de la propia app sí son órdenes posibles.
 *
 * Puro, sin React: la pantalla llama a applyEdit en cada cambio del texto.
 */

export type InputSource = "typed" | "dictated" | "pasted" | "shared" | "example";

export interface Segment {
  text: string;
  source: InputSource;
}

/** Fuentes cercadas: su texto nunca llega al router. */
export const FENCED_SOURCES: ReadonlySet<InputSource> = new Set(["pasted", "shared"]);

/**
 * Un cambio que mete de golpe al menos esto (y con espacios: varias
 * palabras) sin venir del micrófono ni de la app se toma como pegado.
 * Android no avisa de un «pegar» en la caja de React Native; el teclado
 * predictivo mete una palabra cada vez, muy por debajo de este umbral.
 */
export const PASTE_MIN_CHARS = 24;

/**
 * T-11 (0.1.99, m-13a): un token SIN espacios de al menos esto, metido
 * de golpe, también es pegado. La regla clásica exigía espacios, así
 * que una URL, un base64 o un hash de cualquier longitud entraba como
 * «typed» y llegaba al router como si lo hubiera tecleado el dueño.
 * Teclear a mano nunca produce una inserción en bloque sin espacios de
 * este tamaño: las palabras más largas quedan muy por debajo.
 */
export const LONG_TOKEN_MIN_CHARS = 48;

/**
 * T-11 (0.1.99, m-13b): pegado EN TROZOS. Ni la regla clásica ni la del
 * token largo ven una orden pegada en inserciones pequeñas (pegar por
 * partes, o software que «tecela» el portapapeles). El rastreador de
 * ráfaga observa las inserciones puras sin fuente explícita: si llegan
 * al menos BURST_MIN_INSERTIONS inserciones de al menos
 * BURST_MIN_INSERTION_CHARS, con huecos de como mucho BURST_GAP_MS
 * entre ellas, y suman BURST_MIN_TOTAL_CHARS, el tramo entero se cerca
 * retroactivamente como pegado, y la ráfaga queda abierta: lo que siga
 * llegando pegado a su cola dentro de la ventana se cerca al llegar.
 *
 * Por qué no caza el uso humano: teclear mete inserciones de 1 carácter
 * (por debajo del mínimo contable) y el teclado predictivo mete
 * palabras sueltas que no suman 48 caracteres en 3+ inserciones
 * seguidas dentro de la ventana. Falso positivo declarado: si alguien
 * pega de verdad a trozos con pausas largas entre trozo y trozo
 * (huecos > 1,5 s), la ráfaga no se forma y el texto queda como
 * tecleado — es la ventana honesta de esta cura. Y cercar por error
 * solo degrada el enrutado: el chat sigue procesando el texto como
 * citado.
 */
export const BURST_MIN_INSERTION_CHARS = 4;
export const BURST_GAP_MS = 1500;
export const BURST_MIN_TOTAL_CHARS = 48;
export const BURST_MIN_INSERTIONS = 3;

interface BurstRecord {
  /** Posición de inicio en el texto unido, ya ajustada a cada edición. */
  start: number;
  text: string;
  at: number;
}

/**
 * Estado del rastreador de ráfaga. Lo guarda la pantalla (un ref) y lo
 * pasa a cada applyEdit; este módulo lo muta. Sin rastreador, applyEdit
 * se comporta exactamente como antes de m-13b.
 */
export interface BurstState {
  records: BurstRecord[];
  /** Fin del tramo ya cercado por una ráfaga abierta, y cuándo llegó su último trozo. */
  tailEnd: number | null;
  tailAt: number;
}

export function createBurstState(): BurstState {
  return { records: [], tailEnd: null, tailAt: 0 };
}

export function joinSegments(segments: Segment[]): string {
  return segments.map((s) => s.text).join("");
}

function normalize(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    if (!s.text) continue;
    const last = out[out.length - 1];
    if (last && last.source === s.source) last.text += s.text;
    else out.push({ text: s.text, source: s.source });
  }
  return out;
}

/** Los tramos de [start, end) del texto, con su fuente. */
export function sliceSegments(segments: Segment[], start: number, end: number): Segment[] {
  const out: Segment[] = [];
  let pos = 0;
  for (const s of segments) {
    const a = pos;
    const b = pos + s.text.length;
    pos = b;
    const from = Math.max(a, start);
    const to = Math.min(b, end);
    if (from < to) out.push({ text: s.text.slice(from - a, to - a), source: s.source });
  }
  return out;
}

/** Marca como «pasted» el tramo [start, end) de unos segmentos ya construidos. */
function fenceRange(segments: Segment[], start: number, end: number): Segment[] {
  if (end <= start) return segments;
  const total = joinSegments(segments).length;
  return normalize([
    ...sliceSegments(segments, 0, start),
    ...sliceSegments(segments, start, end).map((s) => ({ text: s.text, source: "pasted" as InputSource })),
    ...sliceSegments(segments, end, total),
  ]);
}

/**
 * Aplica un cambio de la caja (prev → next) a los tramos. `source` es la
 * fuente conocida del texto insertado (micrófono, compartir, ejemplo); sin
 * ella se deduce: escrito, o pegado si entra mucho texto de golpe.
 *
 * `burst` (opcional, T-11 m-13b): el rastreador de ráfaga de la pantalla.
 * `nowMs` es inyectable para tests; por defecto, el reloj real.
 */
export function applyEdit(
  segments: Segment[],
  prev: string,
  next: string,
  source?: InputSource,
  burst?: BurstState,
  nowMs?: number,
): Segment[] {
  if (next === "") {
    if (burst) {
      burst.records = [];
      burst.tailEnd = null;
    }
    return [];
  }
  // Tramos desincronizados (no debería pasar): conservador, si había algo
  // cercado todo queda cercado; si no, todo es escrito.
  if (joinSegments(segments) !== prev) {
    if (burst) {
      burst.records = [];
      burst.tailEnd = null;
    }
    const fenced = segments.some((s) => FENCED_SOURCES.has(s.source));
    return [{ text: next, source: source ?? (fenced ? "pasted" : "typed") }];
  }
  let p = 0;
  const maxP = Math.min(prev.length, next.length);
  while (p < maxP && prev[p] === next[p]) p++;
  let s = 0;
  const maxS = Math.min(prev.length, next.length) - p;
  while (s < maxS && prev[prev.length - 1 - s] === next[next.length - 1 - s]) s++;
  const inserted = next.slice(p, next.length - s);
  const removedLen = prev.length - s - p;
  const pureInsertion = removedLen === 0 && inserted.length > 0;
  const now = nowMs ?? Date.now();

  let insertedSource: InputSource =
    source ??
    (inserted.length >= PASTE_MIN_CHARS && /\s/.test(inserted.trim())
      ? "pasted"
      : // m-13a: token largo sin espacios, metido de golpe = pegado.
        inserted.length >= LONG_TOKEN_MIN_CHARS && !/\s/.test(inserted)
        ? "pasted"
        : "typed");

  // --- Ráfaga (m-13b): ajustar el estado a esta edición ---
  let burstContinuation = false;
  if (burst) {
    const delta = inserted.length - removedLen;
    // Los registros que la edición toca se caen; los posteriores se
    // desplazan; los anteriores quedan. La cola de la ráfaga abierta
    // sigue la misma regla.
    burst.records = burst.records.filter((r) => {
      const rEnd = r.start + r.text.length;
      if (rEnd <= p) return true;
      if (r.start >= p + removedLen) {
        r.start += delta;
        return true;
      }
      return false;
    });
    if (burst.tailEnd !== null) {
      if (burst.tailEnd <= p) {
        // queda donde estaba
      } else if (burst.tailEnd >= p + removedLen) {
        burst.tailEnd += delta;
      } else {
        burst.tailEnd = null;
      }
    }
    // Defensa: un registro cuyo texto ya no coincide con el texto unido
    // no puede sostener una ráfaga.
    burst.records = burst.records.filter(
      (r) => next.slice(r.start, r.start + r.text.length) === r.text,
    );

    if (
      pureInsertion &&
      !source &&
      burst.tailEnd !== null &&
      p === burst.tailEnd &&
      now - burst.tailAt <= BURST_GAP_MS
    ) {
      // La ráfaga sigue abierta: este trozo es parte del mismo pegado.
      burstContinuation = true;
      insertedSource = "pasted";
      burst.tailEnd = p + inserted.length;
      burst.tailAt = now;
    } else if (!pureInsertion || source) {
      // Cualquier edición que no sea una inserción pura sin fuente
      // rompe la ráfaga: lo acumulado ya no describe un solo pegado.
      burst.records = [];
      burst.tailEnd = null;
    }
  }

  let out = normalize([
    ...sliceSegments(segments, 0, p),
    { text: inserted, source: insertedSource },
    ...sliceSegments(segments, prev.length - s, prev.length),
  ]);

  // --- Ráfaga (m-13b): contar esta inserción y cercar si se forma ---
  if (burst && pureInsertion && !source && !burstContinuation) {
    if (insertedSource === "pasted") {
      // Un pegado clásico o un token largo ya cercaron este trozo; la
      // acumulación anterior no describe un pegado en trozos.
      burst.records = [];
    } else if (inserted.length >= BURST_MIN_INSERTION_CHARS) {
      burst.records.push({ start: p, text: inserted, at: now });
      // La ráfaga dispara a los 48 caracteres: conservar más de 64
      // registros no cambia ningún veredicto y acota el estado.
      if (burst.records.length > 64) {
        burst.records = burst.records.slice(burst.records.length - 64);
      }
      // Cadenas de registros contiguos con huecos dentro de la ventana.
      const sorted = [...burst.records].sort((a, b) => a.start - b.start);
      let runStart = 0;
      for (let i = 1; i <= sorted.length; i++) {
        const prevRec = sorted[i - 1];
        const cur = sorted[i];
        const contiguous =
          cur !== undefined &&
          cur.start === prevRec.start + prevRec.text.length &&
          cur.at - prevRec.at <= BURST_GAP_MS;
        if (!contiguous) {
          const run = sorted.slice(runStart, i);
          const totalChars = run.reduce((acc, r) => acc + r.text.length, 0);
          if (run.length >= BURST_MIN_INSERTIONS && totalChars >= BURST_MIN_TOTAL_CHARS) {
            const from = run[0].start;
            const to = run[run.length - 1].start + run[run.length - 1].text.length;
            out = fenceRange(out, from, to);
            burst.tailEnd = to;
            burst.tailAt = run[run.length - 1].at;
            burst.records = [];
            break;
          }
          runStart = i;
        }
      }
    }
  }
  return out;
}

export function hasFenced(segments: Segment[]): boolean {
  return segments.some((s) => FENCED_SOURCES.has(s.source) && s.text.trim().length > 0);
}

/** Solo lo que el router puede mirar: lo escrito, dictado o de un ejemplo. */
export function routableText(segments: Segment[]): string {
  return segments
    .filter((s) => !FENCED_SOURCES.has(s.source))
    .map((s) => s.text)
    .join("")
    .replace(/\s{2,}/g, " ")
    .trim();
}
