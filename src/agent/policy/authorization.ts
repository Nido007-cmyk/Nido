/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * authorization.ts — NIDO: decisiones de autorización de alto nivel.
 *
 * Cómo se reparte el trabajo en realidad (T-11, 0.1.99, m-12; la
 * cabecera anterior afirmaba que «toda decisión pasa por authorize()»
 * y que las demás rutas «delegan aquí», y no era cierto):
 *
 * - `authorize()` (este módulo) sirve a la delegación y al P2P: su
 *   llamador real es `src/p2p/p2pAuthorization.ts`. Traduce la política
 *   a los modos canónicos AUTO / ASK / DENY.
 * - El dispatcher de herramientas del agente NO pasa por authorize():
 *   usa `evaluateAction` (policyEngine.ts) directamente, porque es la
 *   única vía que devuelve el aviso de procedencia (`injectionOrigin`)
 *   en la decisión de confirmación, y rutear el dispatcher por
 *   authorize() perdería ese aviso en las acciones más peligrosas.
 * - `withConfirmation` (confirm.ts) es la puerta del handler: sin canal
 *   de confirmación, bloquea (fail-closed).
 *
 * Lo que SÍ comparten todas las rutas, por construcción y no por
 * vigilancia, es la LISTA de irreversibles: vive una sola vez en
 * ./irreversibleTools.ts y las dos rutas la importan (antes había dos
 * copias literales que coincidían porque un test las comparaba).
 *
 * Modos canónicos:
 * - AUTO: la acción procede sin intervención humana
 * - ASK: requiere confirmación humana explícita
 * - DENY: bloqueada, no procede bajo ninguna circunstancia
 *
 * Preserva invariantes:
 * - validateTask (BLOCKER corregido)
 * - Las irreversibles siempre requieren ASK / confirmación
 * - nido_pair, nido_approve_task requieren ASK
 */

import {
  evaluateAction as policyEvaluate,
  type PolicyDecision,
  type ToolAction,
} from "./policyEngine";
import { IRREVERSIBLE_TOOLS } from "./irreversibleTools";

/** Decisión canónica de autorización. */
export type AuthDecision = "AUTO" | "ASK" | "DENY";

/** Resultado completo de autorización. */
export interface AuthResult {
  decision: AuthDecision;
  reason: string;
  /** Para compatibilidad con PolicyDecision */
  requiresConfirmation: boolean;
  allowed: boolean;
}

/**
 * Herramientas irreversibles: SIEMPRE requieren confirmación humana.
 * Nombre histórico de la lista única de ./irreversibleTools.ts (T-11,
 * m-12): se re-exporta para no romper a los consumidores existentes
 * (authorization.test.ts, externalEffects.test.ts, p2pAuthorization).
 */
export const IRREVERSIBLE_TOOLS_CANONICAL: ReadonlySet<string> = IRREVERSIBLE_TOOLS;

/**
 * Herramientas denegadas siempre (ni siquiera con confirmación).
 * Actualmente vacío; reservado para futuras restricciones.
 */
export const DENIED_TOOLS_CANONICAL = new Set<string>([
  // Ejemplo futuro: "factory_reset" podría moverse aquí
]);

/**
 * Función canónica de autorización.
 * TODA decisión de autorización debe pasar por aquí.
 */
export function authorize(action: ToolAction): AuthResult {
  // 1. Denegadas explícitamente → DENY
  if (DENIED_TOOLS_CANONICAL.has(action.tool)) {
    return {
      decision: "DENY",
      reason: `Tool '${action.tool}' is denied by policy.`,
      requiresConfirmation: false,
      allowed: false,
    };
  }

  // 2. Irreversibles → ASK (requieren confirmación humana)
  if (IRREVERSIBLE_TOOLS_CANONICAL.has(action.tool)) {
    return {
      decision: "ASK",
      reason: `Tool '${action.tool}' is irreversible and requires human confirmation.`,
      requiresConfirmation: true,
      allowed: true, // allowed BUT requires confirmation (compat con PolicyDecision)
    };
  }

  // 3. Delegar al Policy Engine para inyección y otras políticas
  const policyResult: PolicyDecision = policyEvaluate(action);
  
  // Si el Policy Engine dice requiresConfirmation, es ASK
  if (policyResult.requiresConfirmation) {
    return {
      decision: "ASK",
      reason: policyResult.reason,
      requiresConfirmation: true,
      allowed: policyResult.allowed,
    };
  }
  
  // Si el Policy Engine deniega, es DENY
  if (!policyResult.allowed) {
    return {
      decision: "DENY",
      reason: policyResult.reason,
      requiresConfirmation: false,
      allowed: false,
    };
  }

  // 4. Por defecto → AUTO
  return {
    decision: "AUTO",
    reason: policyResult.reason || "Allowed by policy.",
    requiresConfirmation: false,
    allowed: true,
  };
}

/**
 * Verifica que una herramienta esté en la lista canónica de irreversibles.
 * Usar esto en vez de duplicar la lista.
 */
export function isIrreversibleTool(toolName: string): boolean {
  return IRREVERSIBLE_TOOLS_CANONICAL.has(toolName);
}

/**
 * Verifica que dos rutas de autorización no produzcan decisiones contradictorias.
 * Para tests: compara authorize() vs evaluateAction().
 */
export function checkAuthConsistency(action: ToolAction): {
  consistent: boolean;
  authDecision: AuthDecision;
  policyDecision: PolicyDecision;
  issue?: string;
} {
  const auth = authorize(action);
  const policy = policyEvaluate(action);

  // Si authorize dice ASK, policy debe decir requiresConfirmation.
  // Desde T-11 (m-12) ambas rutas leen la MISMA lista importada, así
  // que una divergencia aquí ya no puede venir de listas duplicadas:
  // sería una divergencia de lógica, que es lo que este chequeo caza.
  if (auth.decision === "ASK" && !policy.requiresConfirmation) {
    if (IRREVERSIBLE_TOOLS_CANONICAL.has(action.tool)) {
      return {
        consistent: false,
        authDecision: auth.decision,
        policyDecision: policy,
        issue: `Tool '${action.tool}' in canonical irreversible list but policyEngine doesn't require confirmation.`,
      };
    }
  }

  // Si authorize dice DENY, policy debe decir allowed=false
  if (auth.decision === "DENY" && policy.allowed) {
    return {
      consistent: false,
      authDecision: auth.decision,
      policyDecision: policy,
      issue: `authorize() DENY but policyEngine allowed=true for '${action.tool}'.`,
    };
  }

  return {
    consistent: true,
    authDecision: auth.decision,
    policyDecision: policy,
  };
}
