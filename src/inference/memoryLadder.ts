/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Escalera de memoria y CrashGuard (programa «Lo mejor de la bounty»,
 * tanda 3; pieza 07 de la colección: el MemoryPlanner de Bivouac,
 * Wolverr, MIT — ver ATTRIBUTION.md; su CrashGuard descrito en su
 * NOTA. Implementación propia sobre el estimador de la casa).
 *
 * Lo que NIDO ya tenía: ramBudget.ts estima el coste exacto de un
 * contexto (pesos + KV + cómputo + logits) y la carga RECHAZABA si el
 * contexto fijo del catálogo no cabía («prueba un modelo más
 * pequeño»). En un teléfono justo eso dejaba sin modelo a quien sí
 * podía con el mismo modelo y menos contexto, y una muerte por
 * memoria al cargar se reintentaba idéntica al día siguiente.
 *
 * Lo que trae esta pieza:
 *
 *  - LA ESCALERA: peldaños de contexto [8192, 6144, 4096, 3072,
 *    2048] bajo el TECHO pedido (el defaultNCtx del catálogo o 4096;
 *    nunca se sube por encima de lo declarado para el modelo). Se
 *    elige el peldaño mayor cuyo coste estimado cabe en el
 *    presupuesto; el rechazo honesto queda solo para cuando ni el
 *    peldaño menor cabe. La opción explícita de contexto no pasa por
 *    la escalera: manda, como siempre.
 *
 *  - EL CRASHGUARD: cada intento de carga deja un «pendiente»
 *    persistido antes de crear el contexto. Si el proceso muere
 *    durante la carga o con el modelo cargado (la muerte por memoria
 *    no deja traza en JS), al siguiente arranque el pendiente sigue
 *    ahí: cuenta como un choque y el presupuesto se multiplica por
 *    un factor de seguridad (1 → 0,8 → 0,65 → 0,5). Una carga que se
 *    confirma (el modelo genera, o se descarga con orden) limpia el
 *    contador. Falso positivo conocido y aceptado, como en Bivouac:
 *    si Android mata la app en segundo plano con el modelo cargado y
 *    sano, también cuenta; cuesta una carga conservadora y se cura
 *    solo en cuanto una generación confirma.
 *
 * Lo que NO viaja de Bivouac: el reempaquetado de pesos (interno de
 * su llama.cpp, no existe en llama.rn) y su fracción de RAM usable
 * (0,6 del total): el presupuesto disponible es el de ramBudget.ts
 * (total − RSS − reserva del sistema), la política de la casa, que
 * esta pieza no afloja.
 *
 * Puro, sin dependencias, 100% testeable. La persistencia del registro
 * vive en LlamaEngine (fichero JSON junto a los modelos), a prueba de
 * fallos: si no se puede leer o escribir, el motor sigue como antes.
 */

import {
  checkRamBudget,
  estimateContextBytes,
  type BudgetVerdict,
  type ContextSpec,
  type RamSnapshot,
} from "./ramBudget";

/** Peldaños de la escalera, de mayor a menor. */
export const CONTEXT_LADDER: readonly number[] = [8192, 6144, 4096, 3072, 2048];

/** El peldaño menor: por debajo de 2048 un chat con fuentes no respira. */
export const MIN_CONTEXT = 2048;

export interface LadderPlan {
  /** El contexto elegido. */
  nCtx: number;
  /** El veredicto en el peldaño elegido (fits=false si ni el menor cabe). */
  verdict: BudgetVerdict;
  /** El techo pedido: el plan nunca lo supera. */
  ceiling: number;
  /** Factor de seguridad aplicado al presupuesto (CrashGuard). */
  safety: number;
  /** Qué se degradó y por qué, en una frase; "" si el plan es el pedido. */
  note: string;
}

/**
 * El plan de contexto para una carga. null cuando la lectura de RAM
 * es ciega (totalRamBytes ≤ 0): el llamador sigue como antes de la
 * escalera, sin rechazar a ciegas.
 */
export function planContext(
  spec: Omit<ContextSpec, "nCtx">,
  snapshot: RamSnapshot,
  opts: { ceiling: number; safety?: number },
): LadderPlan | null {
  const safety = opts.safety ?? 1;
  const base = checkRamBudget({ ...spec, nCtx: opts.ceiling }, snapshot);
  if (!base) return null;
  const budget = Math.floor(base.availableBytes * safety);
  // El techo primero; debajo, los peldaños menores que él.
  const rungs = [opts.ceiling, ...CONTEXT_LADDER.filter((c) => c < opts.ceiling)];
  let floor: LadderPlan | null = null;
  for (const nCtx of rungs) {
    const estimate = estimateContextBytes({ ...spec, nCtx });
    const verdict: BudgetVerdict = {
      ...estimate,
      fits: estimate.totalBytes <= budget,
      availableBytes: base.availableBytes,
      totalRamBytes: base.totalRamBytes,
    };
    const plan: LadderPlan = { nCtx, verdict, ceiling: opts.ceiling, safety, note: "" };
    if (verdict.fits) {
      plan.note = planNote(plan);
      return plan;
    }
    floor = plan;
  }
  // Ni el peldaño menor cabe: el plan es el menor, con fits=false, y
  // el llamador rechaza con sus cifras (las del menor coste posible).
  if (floor) floor.note = planNote(floor);
  return floor;
}

function planNote(plan: LadderPlan): string {
  const parts: string[] = [];
  if (plan.nCtx < plan.ceiling) {
    parts.push(`context stepped down from ${plan.ceiling} to ${plan.nCtx} to fit this device's RAM`);
  }
  if (plan.safety < 1) {
    parts.push(`budget at ${Math.round(plan.safety * 100)}% after a memory crash`);
  }
  return parts.join("; ");
}

// ------------------------------------------------------------ CrashGuard

/** Factores por número de choques sin confirmar: 0, 1, 2, 3 o más. */
export const CRASH_SAFETY_STEPS: readonly number[] = [1, 0.8, 0.65, 0.5];

export function safetyForCrashes(crashes: number): number {
  const i = Math.min(Math.max(Math.floor(crashes) || 0, 0), CRASH_SAFETY_STEPS.length - 1);
  return CRASH_SAFETY_STEPS[i];
}

export interface CrashGuardRecord {
  /** Choques contados sin una carga confirmada entre ellos. */
  crashes: number;
  /** El intento en vuelo cuando el proceso murió, si lo había. */
  pending: { model: string; nCtx: number; at: number } | null;
}

export const EMPTY_CRASH_RECORD: CrashGuardRecord = { crashes: 0, pending: null };

/** Lectura tolerante del registro persistido: lo ilegible es un registro vacío. */
export function parseCrashGuardRecord(raw: string | null | undefined): CrashGuardRecord {
  if (!raw) return { ...EMPTY_CRASH_RECORD };
  try {
    const parsed = JSON.parse(raw) as Partial<CrashGuardRecord>;
    const crashes =
      typeof parsed.crashes === "number" && Number.isFinite(parsed.crashes) && parsed.crashes > 0
        ? Math.min(Math.floor(parsed.crashes), 10)
        : 0;
    const p = parsed.pending;
    const pending =
      p && typeof p.model === "string" && typeof p.nCtx === "number" && typeof p.at === "number"
        ? { model: p.model, nCtx: p.nCtx, at: p.at }
        : null;
    return { crashes, pending };
  } catch {
    return { ...EMPTY_CRASH_RECORD };
  }
}

/**
 * Al arrancar una carga, el registro se asienta: un pendiente sin
 * confirmar cuenta como choque — SALVO si hay un modelo vivo en el
 * motor (ese pendiente ES el modelo cargado, que sobrevivió: se
 * confirma, no se castiga). Devuelve el registro ya asentado, sin
 * pendiente, y el factor que manda en esta carga.
 */
export function settleCrashGuardRecord(
  record: CrashGuardRecord,
  opts: { modelAlive: boolean },
): { record: CrashGuardRecord; safety: number; countedCrash: boolean } {
  if (!record.pending) {
    return { record, safety: safetyForCrashes(record.crashes), countedCrash: false };
  }
  if (opts.modelAlive) {
    const settled: CrashGuardRecord = { crashes: 0, pending: null };
    return { record: settled, safety: 1, countedCrash: false };
  }
  const crashes = Math.min(record.crashes + 1, 10);
  const settled: CrashGuardRecord = { crashes, pending: null };
  return { record: settled, safety: safetyForCrashes(crashes), countedCrash: true };
}

/** Una carga confirmada (generó o se descargó con orden): contador a cero. */
export function confirmCrashGuardRecord(record: CrashGuardRecord): CrashGuardRecord {
  return { crashes: 0, pending: null };
}
