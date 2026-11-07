/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Práctica de RCP (0.1.76) — el núcleo puro, sin React. Es una
 * herramienta para aprender y practicar sobre un cojín o un maniquí, no
 * para usarla sobre una persona (ver docs/CPR_PRACTICE.md).
 *
 * Qué hace: marca el ritmo de las compresiones con un pitido (110 por
 * minuto, dentro del 100–120 de la guía), cuenta 30 compresiones y la
 * pausa de 2 respiraciones si la persona eligió hacerlas, y avisa de
 * turnarse cada 2 minutos. Todo el texto de primeros auxilios que enseña
 * o lee en voz alta es el de la guía NIDO Esencial «RCP en adultos y niños
 * mayores», copiado palabra por palabra: cprCoach.test.ts comprueba cada
 * línea contra knowledge-packs/nido-esencial/<lengua>/02-*.md, así que si
 * la guía cambia y esto no, la prueba falla. Ningún modelo de IA escribe
 * nada aquí.
 *
 * Qué NO hace: no sigue la guía de bebés ni de niños pequeños (es otra),
 * y no mide la profundidad de las compresiones.
 */

export type CprLang = "es" | "en" | "pt";
export type CprMode = "continuous" | "30:2";

/** Compresiones por minuto. La guía: «100 a 120 por minuto». */
export const CPR_BPM = 110;
export const COMPRESSIONS_PER_CYCLE = 30;
/**
 * Pausa para las 2 respiraciones. La guía: «sopla 1 segundo» cada una e
 * «interrumpe lo menos posible»; las guías AHA piden menos de 10 s.
 */
export const BREATH_PAUSE_MS = 6000;
/** La guía: «turnaos cada 2 minutos». */
export const SWITCH_EVERY_MS = 120_000;
export const BEAT_MS = 60_000 / CPR_BPM;

export interface CprGuideText {
  title: string;
  guideId: string;
  verified: string;
  sources: string;
  headings: { before: string; compressions: string; breaths: string; stop: string };
  before: string[];
  compressions: string[];
  breaths: string[];
  stop: string[];
  /** Frase de la guía que se lee al pasar 2 minutos. */
  switchLine: string;
}

/** Texto de la guía NIDO Esencial, palabra por palabra (ver la prueba). */
export const CPR_GUIDE: Record<CprLang, CprGuideText> = {
  es: {
    title: "RCP (reanimación) en adultos y niños mayores",
    guideId: "esencial-rcp-adultos",
    verified: "2026-11-07",
    sources: "AHA, Guías de RCP y atención cardiovascular de emergencia 2025; Cruz Roja Americana; IFRC, Directrices internacionales de primeros auxilios 2025",
    headings: { before: "Antes de empezar", compressions: "Compresiones en el pecho", breaths: "Respiraciones (solo si sabes hacerlas)", stop: "Cuándo parar" },
    before: [
      "Comprueba que el lugar es seguro.",
      "Toca sus hombros y háblale fuerte. Si no responde, mira si respira normal (no más de 10 segundos).",
      "Pide a alguien que llame al número de emergencias y que traiga un desfibrilador (DEA). Si estás solo, llama tú con el altavoz y empieza.",
    ],
    compressions: [
      "Tumba a la persona boca arriba sobre una superficie dura (el suelo).",
      "Arrodíllate a su lado. Pon el talón de una mano en el centro del pecho (mitad inferior del esternón) y la otra mano encima.",
      "Brazos rectos y hombros justo encima de las manos. Empuja hacia abajo con el peso del cuerpo.",
      "Profundidad: unos 5 cm (no más de 6 cm) en adultos.",
      "Ritmo: 100 a 120 por minuto (el ritmo de la canción \"Stayin' Alive\").",
      "Deja que el pecho suba del todo entre compresión y compresión, sin despegar las manos.",
      "Interrumpe lo menos posible.",
    ],
    breaths: [
      "Si estás entrenado y dispuesto: 30 compresiones y 2 respiraciones, y repite.",
      "Para respirar: inclina la cabeza hacia atrás y eleva el mentón, tapa la nariz, sella tu boca sobre la suya y sopla 1 segundo hasta ver que el pecho sube.",
      "Si no sabes o no quieres, haz solo compresiones sin parar: en adultos funciona bien.",
    ],
    stop: [
      "Cuando llegue un desfibrilador (úsalo de inmediato, ver guía del DEA).",
      "Cuando la persona empiece a respirar normal o se mueva.",
      "Cuando lleguen los servicios de emergencia y te releven.",
      "Si estás agotado o el lugar se vuelve peligroso. Si hay otra persona, turnaos cada 2 minutos.",
    ],
    switchLine: "Si hay otra persona, turnaos cada 2 minutos.",
  },
  en: {
    title: "CPR for adults and older children",
    guideId: "esencial-rcp-adultos",
    verified: "2026-11-07",
    sources: "AHA Guidelines for CPR and Emergency Cardiovascular Care 2025; American Red Cross; IFRC International First Aid Guidelines 2025",
    headings: { before: "Before you start", compressions: "Chest compressions", breaths: "Rescue breaths (only if you know how)", stop: "When to stop" },
    before: [
      "Check that the scene is safe.",
      "Tap their shoulders and speak loudly. If they do not respond, check whether they breathe normally (no more than 10 seconds).",
      "Ask someone to call the emergency number and bring a defibrillator (AED). If you are alone, call on speakerphone and start.",
    ],
    compressions: [
      "Lay the person on their back on a firm surface (the floor).",
      "Kneel beside them. Put the heel of one hand on the center of the chest (lower half of the breastbone) and the other hand on top.",
      "Arms straight, shoulders right above your hands. Push down using your body weight.",
      "Depth: about 5 cm (2 inches), no more than 6 cm, in adults.",
      "Rate: 100 to 120 per minute (the beat of \"Stayin' Alive\").",
      "Let the chest come all the way back up between compressions, without lifting your hands.",
      "Keep pauses as short as possible.",
    ],
    breaths: [
      "If you are trained and willing: 30 compressions and 2 breaths, and repeat.",
      "To give a breath: tilt the head back and lift the chin, pinch the nose, seal your mouth over theirs and blow for 1 second until you see the chest rise.",
      "If you don't know how or don't want to, do continuous compressions only: in adults this works well.",
    ],
    stop: [
      "When a defibrillator arrives (use it at once, see the AED guide).",
      "When the person starts breathing normally or moves.",
      "When emergency services arrive and take over.",
      "If you are exhausted or the scene becomes dangerous. If someone else can help, switch every 2 minutes.",
    ],
    switchLine: "If someone else can help, switch every 2 minutes.",
  },
  pt: {
    title: "RCP em adultos e crianças maiores",
    guideId: "esencial-rcp-adultos",
    verified: "2026-11-07",
    sources: "AHA, Guias de RCP e atendimento cardiovascular de emergência 2025; Cruz Vermelha Americana; IFRC, Diretrizes internacionais de primeiros socorros 2025",
    headings: { before: "Antes de começar", compressions: "Compressões no peito", breaths: "Respirações (só se você souber fazer)", stop: "Quando parar" },
    before: [
      "Confira se o local é seguro.",
      "Toque nos ombros dela e fale alto. Se não responder, olhe se ela respira normalmente (no máximo 10 segundos).",
      "Peça a alguém que ligue para o número de emergência e traga um desfibrilador (DEA). Se estiver sozinho, ligue você no viva-voz e comece.",
    ],
    compressions: [
      "Deite a pessoa de costas sobre uma superfície dura (o chão).",
      "Ajoelhe-se ao lado dela. Coloque a base de uma mão no centro do peito (metade inferior do esterno) e a outra mão por cima.",
      "Braços retos e ombros bem acima das mãos. Empurre para baixo com o peso do corpo.",
      "Profundidade: cerca de 5 cm (não mais de 6 cm) em adultos.",
      "Ritmo: 100 a 120 por minuto (o ritmo da música \"Stayin' Alive\").",
      "Deixe o peito voltar por completo entre uma compressão e outra, sem tirar as mãos.",
      "Interrompa o mínimo possível.",
    ],
    breaths: [
      "Se você tiver treinamento e estiver disposto: 30 compressões e 2 respirações, e repita.",
      "Para respirar: incline a cabeça para trás e levante o queixo, tape o nariz, sele sua boca sobre a dela e sopre por 1 segundo até ver o peito subir.",
      "Se não souber ou não quiser, faça só compressões sem parar: em adultos funciona bem.",
    ],
    stop: [
      "Quando chegar um desfibrilador (use-o de imediato, ver o guia do DEA).",
      "Quando a pessoa começar a respirar normalmente ou se mexer.",
      "Quando o serviço de emergência chegar e assumir.",
      "Se você estiver exausto ou o local ficar perigoso. Se houver outra pessoa, revezem a cada 2 minutos.",
    ],
    switchLine: "Se houver outra pessoa, revezem a cada 2 minutos.",
  },
};

export function cprLangOf(code: string | undefined | null): CprLang {
  const c = (code ?? "").slice(0, 2).toLowerCase();
  return c === "es" || c === "pt" ? c : "en";
}

export interface CprPhase {
  phase: "compressions" | "breaths";
  /** Compresión en curso dentro del ciclo (1..30), o el total si es continuo. */
  count: number;
  /** Ciclo de 30:2 (desde 1); 1 en continuo. */
  cycle: number;
  /** Compresiones hechas en total hasta este instante. */
  total: number;
  /** ms que faltan para que acabe esta fase (Infinity en continuo). */
  phaseEndsInMs: number;
}

const COMPRESSION_BLOCK_MS = COMPRESSIONS_PER_CYCLE * BEAT_MS;
const CYCLE_MS = COMPRESSION_BLOCK_MS + BREATH_PAUSE_MS;

/**
 * Dónde está la reanimación `elapsedMs` después de empezar. La compresión
 * k (desde 0) suena en k × BEAT_MS: en el instante 0 ya cuenta 1.
 */
export function cprPhaseAt(elapsedMs: number, mode: CprMode): CprPhase {
  const t = Math.max(0, elapsedMs);
  if (mode === "continuous") {
    const total = Math.floor(t / BEAT_MS) + 1;
    return { phase: "compressions", count: total, cycle: 1, total, phaseEndsInMs: Infinity };
  }
  const cycleIdx = Math.floor(t / CYCLE_MS);
  const inCycle = t - cycleIdx * CYCLE_MS;
  const done = cycleIdx * COMPRESSIONS_PER_CYCLE;
  if (inCycle < COMPRESSION_BLOCK_MS) {
    const count = Math.min(COMPRESSIONS_PER_CYCLE, Math.floor(inCycle / BEAT_MS) + 1);
    return { phase: "compressions", count, cycle: cycleIdx + 1, total: done + count, phaseEndsInMs: COMPRESSION_BLOCK_MS - inCycle };
  }
  return {
    phase: "breaths",
    count: COMPRESSIONS_PER_CYCLE,
    cycle: cycleIdx + 1,
    total: done + COMPRESSIONS_PER_CYCLE,
    phaseEndsInMs: CYCLE_MS - inCycle,
  };
}

/** Inicio (ms desde el comienzo) del bloque de compresiones del ciclo n (desde 1). */
export function compressionBlockStartMs(cycle: number): number {
  return (cycle - 1) * CYCLE_MS;
}

/**
 * ¿Toca avisar de turnarse? Devuelve el tramo de 2 min a anunciar (1, 2…)
 * o null. En continuo, nada más cruzarlo. En 30:2, en la primera pausa de
 * respiraciones tras cruzarlo: no se habla encima de las compresiones.
 */
export function switchReminderDue(nowMs: number, mode: CprMode, lastAnnouncedSlot: number): number | null {
  const slot = Math.floor(nowMs / SWITCH_EVERY_MS);
  if (slot < 1 || slot <= lastAnnouncedSlot) return null;
  if (mode === "continuous") return slot;
  return cprPhaseAt(nowMs, mode).phase === "breaths" ? slot : null;
}

/** «03:07». */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
