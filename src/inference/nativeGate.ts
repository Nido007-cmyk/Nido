/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * nativeGate.ts — M1 del diagnóstico del crash nativo (2026-10-31).
 *
 * En el proceso viven DOS contextos llama.cpp (el de generación y el de
 * embeddings) y la serialización nativa es solo POR contexto: nada
 * impedía que una completion y un embedding computaran a la vez en
 * nativo, y el índice de fondo (reembedMissing) es un bucle sin pausas
 * que nunca miraba si se estaba generando. El crash B de la ronda
 * (SIGSEGV en proceso frío) aterrizó exactamente en esa tormenta:
 * cargas en paralelo + re-indexado flotante + primera generación.
 *
 * Esta puerta es el cerrojo JS compartido que ordena ese trabajo:
 *
 * - La GENERACIÓN la toma al empezar (begin) y la suelta al asentarse
 *   (end). Tomarla es síncrono y nunca espera: la pregunta del usuario
 *   no aguarda a que el fondo vacíe la base; el fondo cede en ≤ 1
 *   embedding (milisegundos).
 * - El FONDO (re-indexado e índices de packs) la consulta: si está
 *   tomada al arrancar, no arranca; si se toma a mitad, se aparca en el
 *   siguiente chunk y reanuda al liberarse.
 *
 * Contador, no booleano: varias generate() encoladas (la cadena de
 * generaciones de LlamaEngine) mantienen la puerta tomada hasta que la
 * última se asienta. Módulo hoja, sin dependencias: lo conocen el motor
 * y los indexadores, sin ciclos.
 */

let holders = 0;
const waiters = new Set<() => void>();

/** Marca el inicio de una generación. Síncrono; jamás espera. */
export function nativeGateBegin(): void {
  holders++;
}

/** Marca el fin de una generación; al quedar libre, despierta a los aparcados. */
export function nativeGateEnd(): void {
  if (holders > 0) holders--;
  if (holders === 0 && waiters.size > 0) {
    const pending = [...waiters];
    waiters.clear();
    for (const wake of pending) wake();
  }
}

/** ¿Hay alguna generación en vuelo (o encolada) ahora mismo? */
export function isNativeGateTaken(): boolean {
  return holders > 0;
}

/**
 * Se resuelve cuando la puerta queda libre; si ya lo está, se resuelve
 * en el acto. Es la espera del fondo: aparcarse aquí no consume CPU ni
 * toca nativo, y la reanudación llega con el end() de la generación.
 */
export function waitForNativeGateFree(): Promise<void> {
  if (holders === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    waiters.add(resolve);
  });
}
