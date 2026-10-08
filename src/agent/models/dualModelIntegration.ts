/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * dualModelIntegration.ts - NIDO: Integración del router dual-model con el agent loop.
 *
 * Usa `routeToModel` para elegir entre el modelo tiny (rápido) y el
 * reasoner (capaz) antes de invocar `runAgentLoop`.
 *
 * La app inyecta los dos engines; este módulo elige cuál usar.
 */

import { routeToModel, type DualModelConfig } from "./dualModel.pure";
import { runAgentLoop, type AgentLoopOptions, type AgentLoopResult } from "../loop/agentLoop";

export interface DualModelEngines {
  tiny: AgentLoopOptions["engine"];
  reasoner: AgentLoopOptions["engine"];
}

export interface DualModelLoopOptions extends Omit<AgentLoopOptions, "engine"> {
  /** Los dos motores disponibles. */
  engines: DualModelEngines;
  /** Configuración del router. */
  modelConfig: DualModelConfig;
  /** Callback opcional: notifica qué modelo se eligió. */
  onModelSelected?: (tier: "tiny" | "reasoner", modelId: string) => void;
}

/**
 * Ejecuta el agent loop con el modelo apropiado según la complejidad.
 *
 * 1. Clasifica la tarea y elige tiny o reasoner.
 * 2. Invoca runAgentLoop con el engine correspondiente.
 * 3. Notifica la elección vía onModelSelected (para telemetría).
 */
export async function runDualModelLoop(
  userText: string,
  options: DualModelLoopOptions
): Promise<AgentLoopResult & { modelTier: "tiny" | "reasoner"; modelId: string }> {
  const { engines, modelConfig, onModelSelected, ...loopOptions } = options;

  // Elegir modelo según complejidad
  const routing = routeToModel(userText, modelConfig);
  const engine = routing.tier === "tiny" ? engines.tiny : engines.reasoner;

  onModelSelected?.(routing.tier, routing.modelId);

  const result = await runAgentLoop(userText, {
    ...loopOptions,
    engine,
  });

  return {
    ...result,
    modelTier: routing.tier,
    modelId: routing.modelId,
  };
}
