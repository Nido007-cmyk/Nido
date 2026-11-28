/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.121 (etapa 1; guía: PocketPal lee la frecuencia de los núcleos
 * grandes): agrupa los núcleos por su frecuencia máxima. En big.LITTLE
 * (la Tab A9+: 2 núcleos rápidos y 6 de ahorro) dice cuántos hay de cada
 * clase; Medidas lo enseña junto a los hilos que usa el motor.
 *
 * La política de hilos (defaultThreadsForCores) NO cambia con esto: qué
 * mezcla de núcleos rinde más depende del aparato y solo la curva de tok/s
 * medida en él puede decidirla. Lo que se añade es el dato exacto.
 *
 * Pura.
 */
export interface CpuCluster {
  /** Núcleos con esta frecuencia máxima. */
  count: number;
  /** Frecuencia máxima en GHz (redondeada a 0,1). */
  maxGHz: number;
}

/** Grupos de núcleos de mayor a menor frecuencia; [] sin lecturas válidas. */
export function cpuClusters(freqsKHz: readonly number[] | null): CpuCluster[] {
  if (!freqsKHz) return [];
  const byGHz = new Map<number, number>();
  for (const f of freqsKHz) {
    if (!Number.isFinite(f) || f <= 0) continue;
    const ghz = Math.round(f / 100_000) / 10;
    byGHz.set(ghz, (byGHz.get(ghz) ?? 0) + 1);
  }
  return [...byGHz.entries()].sort((a, b) => b[0] - a[0]).map(([maxGHz, count]) => ({ count, maxGHz }));
}

/** «2 × 2.2 GHz + 6 × 1.8 GHz» (separador decimal según `decimal`). */
export function formatCpuClusters(clusters: readonly CpuCluster[], decimal = "."): string {
  return clusters.map((c) => `${c.count} × ${c.maxGHz.toFixed(1).replace(".", decimal)} GHz`).join(" + ");
}
