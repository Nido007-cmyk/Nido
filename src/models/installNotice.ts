/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import type { AssetStatus } from "./ModelManager";
import type { InstallRecord } from "./installState";

/**
 * installNotice.ts — 0.1.90 (familia 3): el motivo, en lenguaje claro,
 * por el que un modelo que se descargó (o se intentó descargar) NO
 * cuenta como descargado en su tarjeta.
 *
 * El defecto medido en la tableta del dueño (0.1.89): la secuencia
 * «sin red → interrumpida → reintentar con red» completó la
 * transferencia pero la tarjeta siguió ofreciendo «Descargar recurso»
 * sin decir por qué, y una segunda tocada arrancó una re-descarga
 * entera. Una de las raíces era EL SILENCIO: la pantalla componía la
 * fila solo con presencia y el estado en memoria del gestor de
 * descargas; el checksumOk de statusOf y el failureCode del diario de
 * instalación se calculaban y se descartaban antes de la tarjeta, y
 * tras un reinicio del proceso hasta el error en memoria se perdía.
 *
 * Esta función pura decide el aviso desde las dos fuentes durables:
 * el estado verificado (AssetStatus) y el diario (InstallRecord).
 * Prioridad:
 *   1. presente o desactualizado → sin aviso (la tarjeta ya lo dice).
 *   2. checksumOk === false → la integridad falló y el archivo se
 *      borró (statusOf lo devuelve una vez, al descubrirlo).
 *   3. diario «failed» → el motivo por su código (la huella mala y el
 *      tamaño malo tienen su texto; el resto, el genérico por clase).
 *   4. diario «paused» con bytes → hay una parte descargada que el
 *      reintento continuará.
 *   5. diario «installed» pero no presente → el archivo está en el
 *      dispositivo y no se pudo comprobar: no cuenta, y se dice.
 *
 * La pantalla traduce la clave con las variables ya formateadas.
 */
export type InstallNotice =
  | { kind: "integrity" }
  | { kind: "interrupted" | "sizeMismatch" | "storage" | "stalled" | "failed" }
  | { kind: "paused"; doneBytes: number; totalBytes: number }
  | { kind: "unverifiable" };

export function installNoticeFor(
  status: Pick<AssetStatus, "present" | "outdated" | "checksumOk">,
  record: InstallRecord | null | undefined
): InstallNotice | null {
  if (status.present || status.outdated) return null;
  if (status.checksumOk === false) return { kind: "integrity" };
  if (record?.status === "failed") {
    switch (record.failureCode) {
      case "checksumMismatch":
        return { kind: "integrity" };
      case "sizeMismatch":
        return { kind: "sizeMismatch" };
      case "interrupted":
        return { kind: "interrupted" };
      case "insufficientStorage":
        return { kind: "storage" };
      case "stalled":
        return { kind: "stalled" };
      default:
        return { kind: "failed" };
    }
  }
  if (record?.status === "paused" && (record.bytesWritten ?? 0) > 0) {
    return { kind: "paused", doneBytes: record.bytesWritten!, totalBytes: record.sizeBytes };
  }
  if (record?.status === "installed") return { kind: "unverifiable" };
  return null;
}
