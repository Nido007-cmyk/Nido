/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.93 — la puerta de salud y emergencia, por SIGNIFICADO.
 *
 * Desde la 0.1.90, lo que la puerta no reconoce como salud o emergencia
 * lo responde el modelo sin fuentes. La puerta era una lista de
 * palabras (emergencyGate.ts), y una lista solo reconoce lo que ya
 * tiene escrito: en una tanda de 45 preguntas de salud y emergencia
 * nunca vistas reconoció 4. Esta capa decide por el vector de la
 * pregunta, el mismo que la búsqueda ya calcula: un clasificador
 * lineal (una resta y un producto escalar) entrenado con 524 frases en
 * español, inglés y portugués.
 *
 * Medido en esa tanda (docs/ESTUDIO_PUERTA_SEMANTICA_0.1.93.md), con
 * los archivos exactos del catálogo:
 *   - modelo multilingüe (e5): reconoce 39 de 45; 0 de 50 preguntas
 *     corrientes cerradas por error;
 *   - modelo por defecto (bge, entrenado en inglés): 22 de 45; 0 de 50.
 *
 * Reglas:
 *   - SUMA a la lista de palabras, no la sustituye: cierra si cualquiera
 *     de las dos cierra.
 *   - Solo decide en el caso sin fuentes (el del modelo respondiendo de
 *     memoria). Con fuentes, el régimen de evidencia no se toca.
 *   - Los pesos valen para la huella exacta del modelo. Otro archivo:
 *     sin capa.
 *   - Paridad: los pesos se entrenaron fuera del teléfono. Antes de
 *     fiarse, la capa pide al motor del teléfono el vector de una frase
 *     conocida y lo compara con el esperado; si no coincide, se apaga
 *     (services/semanticDanger.ts).
 *
 * Puro: sin motor, sin red, probado con los vectores del examen.
 */
import { SEMANTIC_GATE_WEIGHTS } from "./semanticGateWeights";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** base64 → Float32Array (little-endian), sin depender de atob/Buffer. */
export function decodeFloat32(b64: string): Float32Array {
  const clean = b64.replace(/=+$/, "");
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = B64.indexOf(clean[i]);
    if (v < 0) throw new Error("semanticGate: base64 inválido");
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[o++] = (acc >> bits) & 0xff;
    }
  }
  const view = new DataView(bytes.buffer, 0, o - (o % 4));
  const out = new Float32Array(Math.floor(o / 4));
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}

interface Decoded {
  w: Float32Array;
  c: number;
  probe: Float32Array;
}

const decoded = new Map<string, Decoded | null>();

function weightsFor(modelSha256: string | null | undefined): Decoded | null {
  if (!modelSha256) return null;
  const key = modelSha256.toLowerCase();
  const hit = decoded.get(key);
  if (hit !== undefined) return hit;
  const raw = SEMANTIC_GATE_WEIGHTS[key];
  let d: Decoded | null = null;
  if (raw) {
    const w = decodeFloat32(raw.w);
    const probe = decodeFloat32(raw.probe);
    if (w.length === raw.dim && probe.length === raw.dim) d = { w, c: raw.c, probe };
  }
  decoded.set(key, d);
  return d;
}

/** ¿Hay capa para este modelo de búsqueda? */
export function hasSemanticGate(modelSha256: string | null | undefined): boolean {
  return weightsFor(modelSha256) !== null;
}

function normalized(v: ArrayLike<number>): Float32Array | null {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n);
  if (!Number.isFinite(n) || n === 0) return null;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

/**
 * Puntuación de peligro del vector de una pregunta (≥ 0 cierra la
 * puerta). null: no hay pesos para ese modelo o el vector no sirve.
 */
export function semanticDangerScore(queryVector: ArrayLike<number>, modelSha256: string | null | undefined): number | null {
  const m = weightsFor(modelSha256);
  if (!m || queryVector.length !== m.w.length) return null;
  const v = normalized(queryVector);
  if (!v) return null;
  let s = m.c;
  for (let i = 0; i < v.length; i++) s += v[i] * m.w[i];
  return s;
}

/** Similitud mínima con el vector esperado de la frase de paridad. */
export const PARITY_MIN_COSINE = 0.98;

/**
 * Paridad: ¿el motor de este teléfono da, para la frase conocida, el
 * vector con el que se entrenaron los pesos? Si no (otra agrupación,
 * otro prefijo, otro motor), la capa no es de fiar y no se usa.
 */
export function semanticGateParity(probeVector: ArrayLike<number>, modelSha256: string | null | undefined): boolean {
  const m = weightsFor(modelSha256);
  if (!m || probeVector.length !== m.probe.length) return false;
  const v = normalized(probeVector);
  if (!v) return false;
  let dot = 0;
  for (let i = 0; i < v.length; i++) dot += v[i] * m.probe[i];
  return dot >= PARITY_MIN_COSINE;
}
