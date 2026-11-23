/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import {
  checkRamBudget,
  KV_ACCEL_BYTES_PER_ELEMENT,
  type ContextSpec,
  type RamSnapshot,
} from "./ramBudget";
import type { DevicePressureCaps } from "./devicePressure";

/**
 * VEL-5 (candidato 0.1.110, acto 2): la puerta de aceleración y el
 * presupuesto de capas del perfil «accel» de LlamaEngine. Política
 * pura, sin nativo: la lista de dispositivos la lee el motor y aquí
 * solo se juzga.
 *
 * La puerta decide sobre la lista REAL de dispositivos que devuelve
 * llama.rn (getBackendDevicesInfo), no sobre un mapa de chipsets:
 * - GPU: un dispositivo de tipo 'gpu' cuyo nombre declara un Adreno
 *   de gama 700 o superior. Sin número de Adreno legible no hay
 *   puerta: no se afirma una gama que no se pudo leer.
 * - NPU: un nombre que empieza por 'HTP' sin caracteres comodín
 *   [patrón PP-MIT: selectHexagonDevice de PocketPal]. El suelo real
 *   (Hexagon v73) lo ponen los assets HTP del APK, no esta lista: lo
 *   que el binario enumera es lo que hay. En este acto el NPU se
 *   DETECTA pero no se auto-elige: encenderlo es la opción de
 *   Ajustes del acto 3, apagada por defecto.
 * - Presión: con calor severo o batería baja (los topes de
 *   devicePressure activos) la puerta se cierra para ESA carga —
 *   ni GPU ni NPU se intentan con el aparato ya apretado.
 *
 * Declarado y no negociable: en la Tab A9+ del dueño (Adreno 619,
 * Hexagon v66) esta puerta NO abre — su GPU queda bajo la gama y su
 * Hexagon no trae assets — y la ganancia de velocidad queda NO
 * MEDIDA hasta que un aparato capaz la mida. Esta política no
 * afirma ni un tok/s de acelerador.
 */

/** Lo que la puerta necesita de cada dispositivo de llama.rn. */
export interface BackendDeviceLike {
  backend: string;
  type: string;
  deviceName: string;
}

/** Gama mínima de Adreno que abre la puerta de GPU (VEL-5, sellado). */
export const ADRENO_MIN_MODEL = 700;

/**
 * El número de modelo Adreno que un nombre de dispositivo declara
 * («Adreno (TM) 730» → 730), o null si el nombre no trae un Adreno
 * con número legible. Solo se lee el primer número tras la palabra
 * Adreno: el resto del nombre es marca y adorno del fabricante.
 */
export function adrenoModelOf(deviceName: string): number | null {
  const at = deviceName.toLowerCase().indexOf("adreno");
  if (at < 0) return null;
  const m = deviceName.slice(at + "adreno".length).match(/\d{3,4}/);
  if (!m) return null;
  const n = Number.parseInt(m[0], 10);
  return Number.isFinite(n) ? n : null;
}

/** El dispositivo GPU que pasa la puerta (Adreno 700+), o null. */
export function selectGpuDevice(devices: readonly BackendDeviceLike[]): BackendDeviceLike | null {
  for (const d of devices) {
    if (d.type !== "gpu") continue;
    const model = adrenoModelOf(d.deviceName);
    if (model !== null && model >= ADRENO_MIN_MODEL) return d;
  }
  return null;
}

/**
 * El dispositivo Hexagon que la lista ofrece, o null [PP-MIT:
 * selectHexagonDevice, deviceSelection.ts de PocketPal — el nombre
 * empieza por 'HTP' y no contiene comodines: 'HTP*' como nombre
 * sería la petición de «todos», no un dispositivo].
 */
export function selectHexagonDevice(
  devices: readonly BackendDeviceLike[],
): BackendDeviceLike | null {
  for (const d of devices) {
    if (d.deviceName.startsWith("HTP") && !/[*?]/.test(d.deviceName)) return d;
  }
  return null;
}

/**
 * ¿La presión del aparato cierra la puerta en esta carga? Los topes
 * de devicePressure nacen de batería baja/modo de ahorro o de calor
 * severo; cualquiera de los dos basta para no intentar acelerador.
 */
export function pressureClosesAccel(caps: DevicePressureCaps): boolean {
  return caps.threadCap !== null || caps.ubatchCap !== null;
}

export interface AccelGateResult {
  /** GPU elegible (Adreno 700+); null si la puerta no abre. */
  gpu: BackendDeviceLike | null;
  /** NPU presente (HTP); se detecta, no se auto-elige en este acto. */
  npu: BackendDeviceLike | null;
  /** La presión cerró la puerta para esta carga. */
  pressureClosed: boolean;
}

/** El veredicto entero de la puerta sobre una lista y una presión. */
export function evaluateAccelGate(
  devices: readonly BackendDeviceLike[],
  caps: DevicePressureCaps,
): AccelGateResult {
  if (pressureClosesAccel(caps)) return { gpu: null, npu: null, pressureClosed: true };
  return {
    gpu: selectGpuDevice(devices),
    npu: selectHexagonDevice(devices),
    pressureClosed: false,
  };
}

/**
 * Saneamiento de la selección acelerada [patrón PP-MIT:
 * resolveDeviceSelection, deviceSelection.ts de PocketPal]: una
 * selección — la de la puerta en esta carga, mañana la persistida
 * de Ajustes — solo vale si el dispositivo SIGUE en la lista actual
 * y SIGUE pasando su puerta. Si ya no está o ya no califica, se cae
 * a CPU en silencio: una selección que envejece no puede dejar la
 * carga rota ni mintiendo sobre dónde corre.
 */
export function resolveAccelSelection(
  candidate: string | null,
  devices: readonly BackendDeviceLike[],
): string | null {
  if (!candidate) return null;
  if (selectGpuDevice(devices)?.deviceName === candidate) return candidate;
  if (selectHexagonDevice(devices)?.deviceName === candidate) return candidate;
  return null;
}

/**
 * Presupuesto de capas para el acelerador: cuántas capas del modelo
 * puede descargar el dispositivo sin comerse la memoria que el
 * pre-flight ya juzgó. Guarda hermana de checkRamBudget — la misma
 * foto, el mismo veredicto — con la KV cobrada al tipo del perfil
 * acelerado (K q8_0, V f16):
 *
 * - Si el modelo no cabe ni en CPU con esa KV, no hay presupuesto.
 * - Lo que sobra tras el conjunto de trabajo entero (el margen
 *   entre lo disponible y lo estimado) paga las copias en el
 *   dispositivo: cada capa descargada cuesta su parte de los pesos
 *   (fileSize / nLayer) una segunda vez en la memoria unificada.
 * - Ni el 99 a ciegas de PocketPal ni «todas o ninguna»: el número
 *   sale de la RAM real del aparato y del peso real del modelo.
 *
 * Sin foto de RAM, sin tamaño de fichero o sin capas conocidas no
 * hay presupuesto (0): a ciegas no se acelera.
 */
export function accelLayerBudget(spec: ContextSpec, snapshot: RamSnapshot | null): number {
  if (!snapshot) return 0;
  if (spec.fileSizeBytes <= 0) return 0;
  // La arquitectura por defecto es la de estimateContextBytes
  // (ramBudget.ts, DEFAULT_ARCH): sin ella no hay capas que contar.
  const nLayer = spec.nLayer ?? 28;
  if (nLayer <= 0) return 0;
  const verdict = checkRamBudget(
    { ...spec, kvBytesPerElement: KV_ACCEL_BYTES_PER_ELEMENT },
    snapshot,
  );
  if (!verdict || !verdict.fits) return 0;
  const headroom = verdict.availableBytes - verdict.totalBytes;
  if (headroom <= 0) return 0;
  const perLayerBytes = spec.fileSizeBytes / nLayer;
  if (perLayerBytes <= 0) return 0;
  return Math.min(nLayer, Math.floor(headroom / perLayerBytes));
}
