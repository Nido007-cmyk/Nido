/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { estimateContextBytes, SYSTEM_HEADROOM_BYTES } from "../inference/ramBudget";
import { contextSpecForModel } from "./defaultModel";
import type { CatalogModel } from "./manifest";

/**
 * Rough RAM-fit estimate for a GGUF model on this device — shared between
 * the catalog UI (CatalogItemCard) and the routing layer's ModelProfile
 * resolution, so both use the same formula rather than drifting apart.
 *
 * The estimate itself lives in src/inference/ramBudget.ts (weights + computed
 * KV cache + compute buffers — the same formula the engine's load-time
 * pre-flight uses), so a "green" badge and a successful pre-flight agree.
 * Heuristic, not a measurement; the green/yellow/red cutoffs are UI policy.
 */
export type Compatibility = "green" | "yellow" | "red" | "unknown";

/**
 * Lo que ocupa NIDO por sí mismo (la app, la base cifrada, el modelo de
 * búsqueda) antes de cargar un modelo de chat. Medido en la prueba física
 * de 2026-11-06 (tableta de 3,3 GB): el pre-flight vio unos 0,4 GB de RSS
 * sin modelo; se redondea hacia arriba.
 */
export const APP_BASELINE_BYTES = 512 * 1024 * 1024;

/**
 * 2026-11-06 (prueba física, tableta de 3,3 GB): la etiqueta decía
 * «Funciona bien en este dispositivo» para un modelo de ~1,0 GB que el
 * pre-flight rechazaba al cargar. La etiqueta solo miraba la RAM total;
 * el pre-flight reserva además 2 GB para el sistema y resta lo que ya usa
 * la app. Ahora la etiqueta aplica la misma reserva:
 * - verde: cabe con la reserva del sistema y lo que ocupa la app, y no
 *   pasa del 65 % de la RAM;
 * - amarillo: solo cabe con la reserva del sistema (justo: cerrar otras
 *   apps, puede no cargar);
 * - rojo: ni eso.
 */
export function computeCompatibility(model: CatalogModel, deviceRamBytes: number): Compatibility {
  if (deviceRamBytes <= 0) return "unknown";
  const estimatedRamBytes = estimateContextBytes(contextSpecForModel(model)).totalBytes;
  const withSystem = estimatedRamBytes + SYSTEM_HEADROOM_BYTES;
  if (estimatedRamBytes <= deviceRamBytes * 0.65 && withSystem + APP_BASELINE_BYTES <= deviceRamBytes) return "green";
  if (estimatedRamBytes <= deviceRamBytes * 0.9 && withSystem <= deviceRamBytes) return "yellow";
  return "red";
}
