/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { KV_Q8_BYTES_PER_ELEMENT, type RamSnapshot } from "../inference/ramBudget";
import { planContext } from "../inference/memoryLadder";
import { contextCeilingForDevice, contextSpecForModel } from "./defaultModel";
import type { CatalogModel } from "./manifest";

/**
 * RAM-fit verdict for a GGUF model on this device — shared between the
 * catalog UI (CatalogItemCard) and the routing layer's ModelProfile
 * resolution, so both use the same verdict rather than drifting apart.
 *
 * 0.1.86 — the badge IS the load path's verdict, not a parallel estimate.
 * The 2026-11-09 census (research_notes/nido-censo-insignias-catalogo)
 * measured the old badge (declared spec, flat compute, fixed 65 %/90 %
 * gates) against LlamaEngine.loadNow over the whole catalog: 13 of 16
 * model×device pairs agreed and 3 were pessimistic (Qwen3-0.6B on the
 * owner's tablet; LFM2.5 and Gemma 4 on 8 GiB), because the badge judged
 * a spec the load never builds and gates the load never applies. Now
 * the color comes from planContext itself, run over the canonical photo
 * of the device (total RAM, the app baseline as RSS, no live term — the
 * badge is per device, not per moment) with the real spec (per-class
 * ceiling + the device's batch) and safety 1:
 *
 * - green: the plan fits AT THE CEILING with fp16 KV — the load the
 *   badge promises is the load the pre-flight accepts on this photo;
 * - yellow: it does not fit at the ceiling, but the ladder finds a rung
 *   (a lower context, the emergency rung, or the same plan with q8 KV):
 *   it loads degraded — exactly what yellow has always announced;
 * - red: no rung fits, not even the emergency rung with q8 KV.
 *
 * Invariant (the one the 2026-11-06 photo bought): green ⇒ the
 * pre-flight accepts. It now holds by construction, because green is
 * defined as planContext fitting at the ceiling on the canonical photo.
 * Heuristic still — the canonical photo is a policy snapshot, not a
 * measurement of this moment — but it is the load's own heuristic.
 *
 * F3-14 (auditoría 2026-11-13): that last caveat WAS the defect. The
 * badge judged only the device in an empty moment, so «verde en
 * vacío» promised loads the real pre-flight — judged on the live
 * photo of a busy phone — rejected, and the invariant read as a lie
 * exactly when it mattered. computeCompatibility now accepts the
 * caller's live snapshot and the badge is the WORSE of the two
 * photos: the canonical one caps optimism (a live photo can also be
 * rosier than policy), the live one can only degrade. The invariant,
 * stated honestly: green ⇒ the pre-flight accepts on the canonical
 * photo AND, when a live photo was supplied, on that one too.
 * CatalogItemCard passes the snapshot of its mount; a caller without
 * one (the routing profile) still gets the per-device verdict.
 */
export type Compatibility = "green" | "yellow" | "red" | "unknown";

/**
 * Lo que ocupa NIDO por sí mismo (la app, la base cifrada, el modelo de
 * búsqueda) antes de cargar un modelo de chat. Medido en la prueba física
 * de 2026-11-06 (tableta de 3,3 GB): el pre-flight vio unos 0,4 GB de RSS
 * sin modelo; se redondea hacia arriba.
 */
export const APP_BASELINE_BYTES = 512 * 1024 * 1024;

/** The canonical photo of a device: its total RAM, the app baseline as RSS, no live term. */
export function canonicalSnapshot(deviceRamBytes: number): RamSnapshot {
  return { totalRamBytes: deviceRamBytes, rssBytes: APP_BASELINE_BYTES };
}

/** El color de UNA foto: la escalera entera (fp16 y luego q8) sobre ese snapshot. */
function colorOnSnapshot(model: CatalogModel, deviceRamBytes: number, snapshot: RamSnapshot): Compatibility {
  const ceiling = contextCeilingForDevice(model.defaultNCtx, deviceRamBytes);
  const { nCtx: _declaredCtx, ...specBase } = contextSpecForModel(model, deviceRamBytes);
  const plan = planContext(specBase, snapshot, { ceiling, safety: 1 });
  if (!plan) return "unknown";
  if (plan.verdict.fits && plan.nCtx === ceiling) return "green";
  if (plan.verdict.fits) return "yellow";
  // The fp16 ladder found no rung: the load path's last word is the same
  // plan with q8 KV, whose emergency rung is judged with the emergency
  // budget (the symmetry LlamaEngine applies since 0.1.86). If even that
  // does not fit, the badge is red.
  const q8Plan = planContext(
    { ...specBase, kvBytesPerElement: KV_Q8_BYTES_PER_ELEMENT },
    snapshot,
    { ceiling, safety: 1 },
  );
  return q8Plan?.verdict.fits ? "yellow" : "red";
}

const SEVERITY: Record<Compatibility, number> = { unknown: -1, green: 0, yellow: 1, red: 2 };

export function computeCompatibility(
  model: CatalogModel,
  deviceRamBytes: number,
  liveSnapshot?: RamSnapshot | null,
): Compatibility {
  if (deviceRamBytes <= 0) return "unknown";
  const canonical = colorOnSnapshot(model, deviceRamBytes, canonicalSnapshot(deviceRamBytes));
  // La foto viva solo degrada, y solo si es DE ESTE aparato y trae
  // término en vivo (sin availBytes no es una foto del momento: es
  // otra foto canónica con otro RSS, y degradar por ella sería
  // castigar dos veces la misma política).
  if (
    !liveSnapshot ||
    liveSnapshot.totalRamBytes !== deviceRamBytes ||
    liveSnapshot.availBytes === undefined ||
    liveSnapshot.availBytes <= 0
  ) {
    return canonical;
  }
  const live = colorOnSnapshot(model, deviceRamBytes, liveSnapshot);
  if (live === "unknown") return canonical;
  return SEVERITY[live] > SEVERITY[canonical] ? live : canonical;
}
