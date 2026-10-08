/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * stageError.ts — diagnósticos accionables para fallos en el dispositivo.
 *
 * En release (Hermes minificado) un "undefined is not a function" sin
 * contexto no dice QUÉ llamada falló. withStage envuelve cada etapa del
 * arranque del motor y antepone la etiqueta de la etapa + las primeras
 * líneas del stack al mensaje, para que la tarjeta de error en el
 * dispositivo identifique la llamada exacta.
 *
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/** Ejecuta fn; si falla, re-lanza con la etapa y el stack antepuestos. */
export async function withStage<T>(stage: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const stackLines =
      e instanceof Error && e.stack
        ? e.stack
            .split("\n")
            .slice(0, 8)
            .join("\n")
        : "";
    const tagged = new Error(
      `[${stage}] ${msg}${stackLines ? `\n${stackLines}` : ""}`
    );
    throw tagged;
  }
}
