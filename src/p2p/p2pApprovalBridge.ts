/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * p2pApprovalBridge.ts — NIDO P2P: Puente entre negociación y Approval Inbox.
 *
 * Cuando una propuesta P2P (PROPOSE) llega y la evaluación local da ASK,
 * se crea una entrada en el approval inbox para decisión humana.
 *
 * Flujo:
 * 1. PROPOSE recibido → verifyProposal() → evaluateProposalScopes()
 * 2. Si decision === "ASK" → queueForHumanApproval()
 * 3. Usuario ve ApprovalCard → aprueba/rechaza
 * 4. Si aprueba → se emite grant y se notifica ACCEPT al peer
 * 5. Si rechaza → se notifica DECLINE al peer
 *
 * La autoridad local siempre prevalece. Un peer remoto nunca puede
 * convertir DENY → ASK ni ASK → AUTO.
 */

import type { TaskProposal } from "./negotiation";
import { verifyProposal } from "./negotiation";
import { fromHex } from "./crypto";
import { evaluateProposalScopes } from "./p2pAuthorization";
import { globalReplayProtection } from "./replayProtection";

/**
 * Resultado de procesar una propuesta entrante.
 */
export type ProposalOutcome =
  | { action: "auto_accept"; reason: string }
  | { action: "queued_for_approval"; taskId: string; reason: string }
  | { action: "auto_reject"; reason: string };

/**
 * Procesa una propuesta P2P entrante.
 *
 * @param proposal La propuesta recibida
 * @param proposerPkBytes Clave pública del proponente (para verificar firma)
 * @param queueFn Función para encolar en approval inbox (inyectada para tests)
 * @returns El resultado del procesamiento
 */
export async function processIncomingProposal(
  proposal: TaskProposal,
  proposerPkBytes: Uint8Array,
  queueFn: (task: QueuedProposalTask) => Promise<string>
): Promise<ProposalOutcome> {
  // 1. Verificar firma
  if (!verifyProposal(proposal, proposerPkBytes)) {
    return { action: "auto_reject", reason: "invalid_signature" };
  }

  // 2. Anti-replay
  if (!globalReplayProtection.checkAndRecord(proposal.nonce)) {
    return { action: "auto_reject", reason: "replay_detected" };
  }

  // 3. Verificar expiración
  if (Date.now() > proposal.expiresAt) {
    return { action: "auto_reject", reason: "expired" };
  }

  // 4. Evaluar contra política local
  const evaluation = evaluateProposalScopes(
    proposal.requestedScopes,
    proposal.proposerPkHex
  );

  if (evaluation.decision === "DENY") {
    return { action: "auto_reject", reason: evaluation.reason };
  }

  if (evaluation.decision === "ASK") {
    // Encolar para aprobación humana
    const taskId = await queueFn({
      proposalId: proposal.proposalId,
      proposerPkHex: proposal.proposerPkHex,
      taskDescription: proposal.taskDescription,
      requestedScopes: proposal.requestedScopes,
      params: proposal.params,
      expiresAt: proposal.expiresAt,
      evaluation,
    });
    return {
      action: "queued_for_approval",
      taskId,
      reason: evaluation.reason,
    };
  }

  // AUTO: todos los scopes permitidos automáticamente
  // Nota: incluso en AUTO, no se emite grant automáticamente.
  // El llamante decide si acepta basándose en este resultado.
  return { action: "auto_accept", reason: evaluation.reason };
}

/**
 * Tarea encolada para aprobación humana.
 */
export interface QueuedProposalTask {
  proposalId: string;
  proposerPkHex: string;
  taskDescription: string;
  requestedScopes: string[];
  params: Record<string, unknown>;
  expiresAt: number;
  evaluation: ReturnType<typeof evaluateProposalScopes>;
}

/**
 * Convierte una tarea encolada al formato ApprovalCard.
 */
export function toApprovalRequest(task: QueuedProposalTask): {
  actionTitle: string;
  reason: string;
  details: Array<{ label: string; value: string }>;
  dataLeaving: string[];
  riskLevel: "low" | "medium" | "high";
} {
  // Determinar nivel de riesgo por scopes
  const hasHighRisk = task.requestedScopes.some(
    (s) => s.includes("send:") || s.includes("write:")
  );
  const hasMediumRisk = task.requestedScopes.some((s) => s.includes("read:"));

  return {
    actionTitle: task.taskDescription,
    reason: task.evaluation.reason,
    details: [
      { label: "Peer", value: task.proposerPkHex.slice(0, 16) + "…" },
      { label: "Scopes", value: task.requestedScopes.join(", ") },
      {
        label: "Expires",
        value: new Date(task.expiresAt).toLocaleString(),
      },
    ],
    dataLeaving: task.requestedScopes,
    riskLevel: hasHighRisk ? "high" : hasMediumRisk ? "medium" : "low",
  };
}
