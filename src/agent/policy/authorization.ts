/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * authorization.ts — NIDO: fuente canónica de decisiones de autorización.
 *
 * Unifica los dos sistemas paralelos:
 * - Policy Engine (`policyEngine.ts`): evaluateAction con allowed/requiresConfirmation
 * - withConfirmation (`confirm.ts`): wrapper que bloquea sin canal
 *
 * Modos canónicos:
 * - AUTO: la acción procede sin intervención humana
 * - ASK: requiere confirmación humana explícita
 * - DENY: bloqueada, no procede bajo ninguna circunstancia
 *
 * Reglas:
 * 1. Toda decisión de autorización pasa por `authorize()`.
 * 2. Las rutas legacy (evaluateAction, withConfirmation) DELEGAN aquí.
 * 3. Ninguna ruta puede tomar decisiones independientemente.
 * 4. Fail-closed: ante duda, DENY.
 *
 * Preserva invariantes:
 * - validateTask (BLOCKER corregido)
 * - IRREVERSIBLE_TOOLS siempre requieren ASK
 * - nido_pair, nido_approve_task requieren ASK
 */

import {
  evaluateAction as policyEvaluate,
  type PolicyDecision,
  type ToolAction,
} from "./policyEngine";

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
 * Fuente única de verdad (no duplicar en otros archivos).
 */
export const IRREVERSIBLE_TOOLS_CANONICAL = new Set([
  "send_sms",
  "nido_send_message",
  "place_call",
  "nido_pair",
  "nido_approve_task",
  "send_email",
  "purchase",
  "delete_file",
  "delete_memory",
  "factory_reset",
]);

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

  // Si authorize dice ASK, policy debe decir requiresConfirmation
  if (auth.decision === "ASK" && !policy.requiresConfirmation) {
    // Excepción: si la herramienta está en IRREVERSIBLE_TOOLS_CANONICAL
    // pero policyEngine tiene una lista desactualizada, authorize tiene razón.
    // Esto detecta la divergencia.
    if (IRREVERSIBLE_TOOLS_CANONICAL.has(action.tool)) {
      return {
        consistent: false,
        authDecision: auth.decision,
        policyDecision: policy,
        issue: `Tool '${action.tool}' in canonical irreversible list but policyEngine doesn't require confirmation. Lists diverged.`,
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
