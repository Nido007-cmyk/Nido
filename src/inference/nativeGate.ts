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

/**
 * Fase 2 del arreglo del defecto de memoria (reapertura 2026-11-08):
 * la puerta de CARGA. La generación ya tenía su cerrojo (M1); la carga
 * de un motor nativo no tenía ninguno, y ChatScreen lanzaba el LLM y
 * el motor de embeddings en Promise.all: dos initLlama a la vez, justo
 * la tormenta que M1 describe (cargas en paralelo + re-indexado
 * flotante + primera generación = el crash B de la ronda).
 *
 * La carga de un motor la toma al empezar y la suelta al asentarse
 * (éxito o error): el segundo motor espera a que el primero resida.
 * Así los dos pre-flight dejan de correr contra la misma foto de RAM
 * (cada uno comparaba su coste contra el disponible sin ver al otro,
 * y la suma de ambos cabía en los dos «sí» por separado pero no en el
 * aparato), y el pico transitorio de la carga deja de duplicarse:
 * llama.cpp construye un contexto mientras el otro todavía no existe.
 * La generación NO toma esta puerta: su cerrojo es el de arriba, y un
 * unload() que tuviera que esperar a una carga quedaría detrás del
 * mismo trabajo que quiere detener.
 */

/** Operaciones de carga encoladas o en vuelo (contador, como la puerta de generación). */
let loadHolders = 0;
const loadWaiters: Array<() => void> = [];

/**
 * Ejecuta `task` con la puerta de carga tomada: si otra carga corre,
 * espera a que se asiente. Síncrono en el caso libre (sin espera, la
 * tarea arranca en el acto), igual que el begin de generación.
 */
export async function withNativeLoadGate<T>(task: () => Promise<T>): Promise<T> {
  while (loadHolders > 0) {
    await new Promise<void>((resolve) => {
      loadWaiters.push(resolve);
    });
  }
  loadHolders++;
  try {
    return await task();
  } finally {
    loadHolders--;
    if (loadHolders === 0) {
      const pending = loadWaiters.splice(0, loadWaiters.length);
      for (const wake of pending) wake();
    }
  }
}

/** ¿Hay una carga de motor en vuelo (o encolada) ahora mismo? */
export function isNativeLoadGateTaken(): boolean {
  return loadHolders > 0;
}
