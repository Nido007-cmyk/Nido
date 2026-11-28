/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import {
  batchForRam,
  estimateContextBytes,
  KV_Q8_BYTES_PER_ELEMENT,
  type RamSnapshot,
} from "../inference/ramBudget";
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
 *
 * 0.1.108 (pasada de la 0.1.107): two surface corrections on that
 * live photo, formula untouched. The card now REFRESHES it when the
 * memory facts change (the active model changes; the app returns to
 * the foreground), instead of judging forever by the mount instant.
 * And the resident model's own card carries the same releasable
 * credit the load path applies (residentReleasableBytes below): the
 * badge no longer judges the active model as if it loaded on top of
 * itself.
 *
 * Tanda too-heavy (pasada de la 0.1.115): aquella corrección dejaba
 * el defecto a medias, y la tableta del dueño lo enseñó entero:
 * «Too heavy» en los cinco modelos, incluido el activo corriendo.
 * Tres piezas más, la fórmula de memoria intacta (ni la reserva de
 * 2 GiB ni la escalera se tocan): (1) el crédito del residente entra
 * en la foto de TODAS las tarjetas, no solo en la suya — es el
 * crédito de la sustitución real que la carga aplica — y lo trae la
 * pantalla calculado una vez (CatalogItemCard ya no lo reconstruye
 * por tarjeta); (2) la activa sin crédito probado tiene por suelo
 * su color canónico (computeCompatibilityDetail, canonicalFloor);
 * (3) el detalle dice de qué foto viene un rojo (redSource), para
 * que un momento ocupado no se lea como propiedad del aparato, y el
 * registro getLastMomentRedBadge guarda la foto del último rojo de
 * momento. El diagnóstico: DIAGNOSTICO-TOO-HEAVY.md en el papel de
 * la tanda.
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
/**
 * 0.1.119: el color con el contexto que el plan eligió de verdad, para que
 * el amarillo diga «va con N de M tokens» en lugar de «necesita mucha
 * memoria» (un 0,4 GB salía con esa letra).
 */
interface SnapshotVerdict {
  color: Compatibility;
  nCtx?: number;
  ceiling?: number;
  kvCompressed?: boolean;
}

function verdictOnSnapshot(model: CatalogModel, deviceRamBytes: number, snapshot: RamSnapshot): SnapshotVerdict {
  const ceiling = contextCeilingForDevice(model.defaultNCtx, deviceRamBytes);
  const { nCtx: _declaredCtx, ...specBase } = contextSpecForModel(model, deviceRamBytes);
  const plan = planContext(specBase, snapshot, { ceiling, safety: 1 });
  if (!plan) return { color: "unknown" };
  if (plan.verdict.fits && plan.nCtx === ceiling) return { color: "green", nCtx: plan.nCtx, ceiling };
  if (plan.verdict.fits) return { color: "yellow", nCtx: plan.nCtx, ceiling, kvCompressed: false };
  const q8Plan = planContext(
    { ...specBase, kvBytesPerElement: KV_Q8_BYTES_PER_ELEMENT },
    snapshot,
    { ceiling, safety: 1 },
  );
  return q8Plan?.verdict.fits
    ? { color: "yellow", nCtx: q8Plan.nCtx, ceiling, kvCompressed: true }
    : { color: "red" };
}

function colorOnSnapshot(model: CatalogModel, deviceRamBytes: number, snapshot: RamSnapshot): Compatibility {
  return verdictOnSnapshot(model, deviceRamBytes, snapshot).color;
}

/**
 * 0.1.108 (pasada de la 0.1.107): el crédito liberable del modelo
 * residente, para la foto viva de SU tarjeta.
 *
 * La carga real, cuando hay un modelo residente, suma a su foto el
 * crédito `releasableBytes` — la huella estimada completa del modelo
 * que va a salir — en los dos términos del presupuesto
 * (LlamaEngine.loadNow, con su comentario «crédito simétrico»). La
 * foto de la tarjeta nunca lo traía: la insignia juzgaba cada modelo
 * como si se cargara ENCIMA del residente, y al activo, encima de sí
 * mismo, así que la tableta del dueño enseñaba «Currently in use» y
 * «Needs a lot of memory» en la misma tarjeta.
 *
 * La cuenta es la de la carga, con sus mismas entradas: los pesos
 * del residente, SU contexto realmente cargado (no el techo: el
 * residente libera lo que ocupa, no lo que ocuparía), su arquitectura
 * y la KV de SU perfil aceptado; el lote es el del aparato
 * (batchForRam sin presión, el mismo con el que el spec propio de la
 * insignia se construye en contextSpecForModel). La fórmula de coste
 * no cambia: esto solo construye el crédito que checkRamBudget ya
 * sabe aplicar.
 */
export function residentReleasableBytes(
  model: CatalogModel,
  loadedNCtx: number,
  kvQ8: boolean,
  deviceRamBytes: number,
): number {
  if (deviceRamBytes <= 0 || loadedNCtx <= 0) return 0;
  return estimateContextBytes({
    fileSizeBytes: model.sizeBytes,
    nCtx: loadedNCtx,
    nLayer: model.arch?.nLayer,
    nKvHeads: model.arch?.nKvHeads,
    headDim: model.arch?.headDim,
    kvBytesPerElement: kvQ8 ? KV_Q8_BYTES_PER_ELEMENT : undefined,
    nUbatch: batchForRam(deviceRamBytes).nUbatch,
  }).totalBytes;
}

const SEVERITY: Record<Compatibility, number> = { unknown: -1, green: 0, yellow: 1, red: 2 };

/**
 * Tanda too-heavy (pasada del dueño sobre la 0.1.115): de qué foto
 * viene un rojo. «device» = la canónica ya es roja: el modelo no
 * cabe en este aparato ni en vacío. «moment» = la canónica no es
 * roja y la foto viva de este momento lo impone: es una verdad del
 * momento (el proceso hinchado, otras apps), no del aparato, y la
 * letra de la tarjeta lo dice distinto.
 */
export type CompatibilityRedSource = "device" | "moment";

export interface CompatibilityDetail {
  color: Compatibility;
  /** Solo con color «red»: la foto que impuso el rojo. */
  redSource?: CompatibilityRedSource;
  /**
   * 0.1.119, solo con color «yellow»: el contexto con el que carga de
   * verdad (nCtx) frente a su techo, si la memoria de conversación va
   * comprimida (q8) y qué foto lo decidió («moment» = la memoria libre de
   * ahora; «device» = el aparato en vacío).
   */
  yellow?: { nCtx: number; ceiling: number; kvCompressed: boolean; source: CompatibilityRedSource };
}

/**
 * El registro del último rojo DE MOMENTO (instrumento mínimo de la
 * tanda): la foto que lo impuso, con sus tres números y el crédito
 * que llevaba (0 = ninguno). La foto del dueño de la 0.1.115 era
 * indiagnosticable desde fuera porque ninguna pieza guardaba la
 * foto que produjo la insignia; este registro es esa foto. Solo lo
 * escribe un rojo de momento: un rojo de aparato no lo pisa.
 */
export interface MomentRedBadge {
  modelId: string;
  rssBytes: number;
  availBytes: number;
  lowMemThresholdBytes: number;
  creditBytes: number;
}

let lastMomentRedBadge: MomentRedBadge | null = null;

export function getLastMomentRedBadge(): MomentRedBadge | null {
  return lastMomentRedBadge;
}

export function computeCompatibilityDetail(
  model: CatalogModel,
  deviceRamBytes: number,
  liveSnapshot?: RamSnapshot | null,
  opts?: { canonicalFloor?: boolean },
): CompatibilityDetail {
  if (deviceRamBytes <= 0) return { color: "unknown" };
  const canonicalV = verdictOnSnapshot(model, deviceRamBytes, canonicalSnapshot(deviceRamBytes));
  const canonical = canonicalV.color;
  const yellowOf = (v: SnapshotVerdict, source: CompatibilityRedSource): CompatibilityDetail["yellow"] =>
    v.color === "yellow" && v.nCtx && v.ceiling
      ? { nCtx: v.nCtx, ceiling: v.ceiling, kvCompressed: v.kvCompressed === true, source }
      : undefined;
  const canonicalDetail: CompatibilityDetail =
    canonical === "red"
      ? { color: canonical, redSource: "device" }
      : canonical === "yellow"
        ? { color: canonical, yellow: yellowOf(canonicalV, "device") }
        : { color: canonical };
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
    return canonicalDetail;
  }
  // El suelo de la activa (tanda too-heavy): quien llama con
  // canonicalFloor declara «esta tarjeta es la del modelo que el
  // ajuste marca activo». Si la foto no trae crédito probado del
  // residente, juzgarla con la foto viva sería juzgar al activo
  // cargándose encima de sí mismo — la carga que la app nunca hace
  // — y la degradación no se aplica: manda su canónica. Con el
  // crédito dentro de la foto, la viva juzga como siempre (con el
  // crédito aplicado, que es la forma de la 0.1.108).
  if (opts?.canonicalFloor && !(liveSnapshot.releasableBytes && liveSnapshot.releasableBytes > 0)) {
    return canonicalDetail;
  }
  const liveV = verdictOnSnapshot(model, deviceRamBytes, liveSnapshot);
  const live = liveV.color;
  if (live === "unknown") return canonicalDetail;
  const color = SEVERITY[live] > SEVERITY[canonical] ? live : canonical;
  if (color === "yellow") {
    // La foto más severa decide la cifra; a igualdad, la de ahora (con
    // menos contexto) es la que el chat usará al cargar.
    const pick = live === "yellow" ? liveV : canonicalV;
    const source: CompatibilityRedSource = live === "yellow" ? "moment" : "device";
    const lower =
      live === "yellow" && canonical === "yellow" && (canonicalV.nCtx ?? Infinity) < (liveV.nCtx ?? Infinity)
        ? { v: canonicalV, s: "device" as CompatibilityRedSource }
        : { v: pick, s: source };
    return { color, yellow: yellowOf(lower.v, lower.s) };
  }
  if (color !== "red") return { color };
  if (canonical === "red") return { color, redSource: "device" };
  lastMomentRedBadge = {
    modelId: model.id,
    rssBytes: liveSnapshot.rssBytes,
    availBytes: liveSnapshot.availBytes,
    lowMemThresholdBytes: liveSnapshot.lowMemThresholdBytes ?? 0,
    creditBytes: Math.max(liveSnapshot.releasableBytes ?? 0, 0),
  };
  return { color, redSource: "moment" };
}

export function computeCompatibility(
  model: CatalogModel,
  deviceRamBytes: number,
  liveSnapshot?: RamSnapshot | null,
): Compatibility {
  return computeCompatibilityDetail(model, deviceRamBytes, liveSnapshot).color;
}
