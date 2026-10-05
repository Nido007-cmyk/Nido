/**
 * p2pAuthorization.ts — NIDO P2P: Integración con AUTO/ASK/DENY.
 *
 * Un peer remoto NUNCA otorga autoridad por sí mismo.
 * La autoridad local siempre prevalece:
 * - Un PROPOSE no convierte DENY → ASK ni ASK → AUTO
 * - Los scopes solicitados se evalúan contra la política local
 * - ACCEPT de una propuesta con scopes sensibles requiere ASK humano
 *
 * Modelo:
 * 1. Peer propone tarea con scopes solicitados
 * 2. Cada scope se evalúa con authorize() local
 * 3. Si algún scope es DENY → propuesta rechazada automáticamente
 * 4. Si algún scope es ASK → requiere aprobación humana (Approval Inbox)
 * 5. Si todos son AUTO → puede aceptarse automáticamente (según política)
 */

import { authorize, type AuthDecision } from "../agent/policy/authorization";
import type { ToolAction } from "../agent/policy/policyEngine";
import type { CapabilityGrant } from "./negotiation";
import { verifyGrant } from "./negotiation";
import { fromHex } from "./crypto";
import { globalRevocationRegistry } from "./replayProtection";

/**
 * Mapeo de scopes P2P a herramientas locales para evaluación.
 * Un scope como "read:notes" se mapea a la herramienta correspondiente.
 */
const SCOPE_TO_TOOL: Record<string, string> = {
  "read:notes": "read_notes",
  "write:notes": "write_notes",
  "read:reminders": "read_reminders",
  "write:reminders": "write_reminders",
  "send:message": "nido_send_message", // Irreversible → ASK
  "place:call": "place_call", // Irreversible → ASK
  "read:contacts": "read_contacts",
};

/**
 * Resultado de evaluar una propuesta contra la política local.
 */
export interface ProposalEvaluation {
  /** Decisión agregada: el más restrictivo de todos los scopes. */
  decision: AuthDecision;
  /** Detalle por scope. */
  scopeDecisions: Array<{
    scope: string;
    decision: AuthDecision;
    reason: string;
  }>;
  /** Si requiere aprobación humana. */
  requiresHumanApproval: boolean;
  /** Razón agregada. */
  reason: string;
}

/**
 * Evalúa los scopes solicitados en una propuesta contra la política local.
 *
 * CRÍTICO: Un peer remoto no puede elevar privilegios.
 * Si la política local dice DENY para un scope, la propuesta se rechaza
 * aunque el peer lo solicite.
 */
export function evaluateProposalScopes(
  requestedScopes: string[],
  peerPkHex: string
): ProposalEvaluation {
  const scopeDecisions: ProposalEvaluation["scopeDecisions"] = [];
  let aggregate: AuthDecision = "AUTO";
  let requiresHumanApproval = false;

  // Peer revocado → DENY total
  if (globalRevocationRegistry.isPeerRevoked(peerPkHex)) {
    return {
      decision: "DENY",
      scopeDecisions: requestedScopes.map((scope) => ({
        scope,
        decision: "DENY" as AuthDecision,
        reason: "Peer revoked",
      })),
      requiresHumanApproval: false,
      reason: "Peer is revoked",
    };
  }

  for (const scope of requestedScopes) {
    const tool = SCOPE_TO_TOOL[scope];
    if (!tool) {
      // Scope desconocido → DENY (fail-closed)
      scopeDecisions.push({
        scope,
        decision: "DENY",
        reason: `Unknown scope: ${scope}`,
      });
      aggregate = "DENY";
      continue;
    }

    const action: ToolAction = {
      tool,
      args: {},
      context: [],
    };

    const result = authorize(action);
    scopeDecisions.push({
      scope,
      decision: result.decision,
      reason: result.reason,
    });

    // Agregación: DENY > ASK > AUTO (el más restrictivo gana)
    if (result.decision === "DENY") {
      aggregate = "DENY";
    } else if (result.decision === "ASK" && aggregate !== "DENY") {
      aggregate = "ASK";
      requiresHumanApproval = true;
    }
  }

  const reason =
    aggregate === "DENY"
      ? "One or more requested scopes are denied by local policy"
      : aggregate === "ASK"
        ? "One or more requested scopes require human approval"
        : "All requested scopes are auto-approved by local policy";

  return {
    decision: aggregate,
    scopeDecisions,
    requiresHumanApproval,
    reason,
  };
}

/**
 * Valida un grant para ejecución: firma, expiración, usos, revocación.
 */
export function validateGrantForExecution(
  grant: CapabilityGrant,
  issuerPkHex: string,
  requiredScope: string,
  now: number = Date.now()
): { valid: boolean; reason?: string } {
  // 1. Verificar firma, expiración y usos (usesConsumed del grant)
  const issuerBytes = fromHex(issuerPkHex);
  const grantCheck = verifyGrant(grant, issuerBytes, grant.usesConsumed, now);
  if (!grantCheck.valid) {
    return { valid: false, reason: grantCheck.reason };
  }

  // 2. Verificar revocación
  if (!globalRevocationRegistry.isGrantUsable(grant.grantId, grant.granteePkHex)) {
    return { valid: false, reason: "revoked" };
  }

  // 3. Verificar que el grant incluye el scope requerido
  if (!grant.scopes.includes(requiredScope)) {
    return { valid: false, reason: "scope_not_granted" };
  }

  // 4. Verificar que el scope sigue permitido por política local
  // (la política puede haber cambiado desde la emisión del grant)
  const evalResult = evaluateProposalScopes([requiredScope], grant.granteePkHex);
  if (evalResult.decision === "DENY") {
    return { valid: false, reason: "scope_now_denied_by_policy" };
  }

  return { valid: true };
}

/**
 * Registra el uso de un grant (incrementa contador).
 * Retorna false si el grant ya no es válido.
 */
export function consumeGrantUse(
  grant: CapabilityGrant,
  issuerPkHex: string,
  requiredScope: string,
  now: number = Date.now()
): boolean {
  const validation = validateGrantForExecution(grant, issuerPkHex, requiredScope, now);
  if (!validation.valid) return false;
  grant.usesConsumed += 1;
  return true;
}
