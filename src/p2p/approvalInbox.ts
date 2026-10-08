/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * approvalInbox.ts — M-6: bandeja de aprobación para tareas remotas.
 *
 * Modelo de seguridad: una `agent_task` entrante NUNCA se auto-ejecuta.
 * Queda con estado "queued" hasta que un humano la aprueba o la rechaza
 * de forma explícita. El único camino fuera de "queued" es decideAgentTask()
 * (store.ts); no existe ningún camino que convierta trabajo encolado en
 * trabajo ejecutable sin decisión humana.
 *
 * La superficie de aprobación hoy es:
 * - listPendingAgentTasks() / approveAgentTask() / rejectAgentTask() (aquí),
 * - las herramientas de agente nido_review_tasks / nido_approve_task /
 *   nido_reject_task (las dos últimas, sensibles: con confirmación explícita),
 * - nido_read_inbox muestra las tareas pendientes sin sacarlas de la cola.
 * Una futura pantalla de UI puede enlazarse directamente a este módulo.
 *
 * Nota: "approved" registra la decisión humana; no dispara ejecución
 * automática. Ejecutar una tarea aprobada requeriría un paso explícito
 * futuro, nunca silencioso.
 */

import {
  decideAgentTask,
  findContactByPk,
  getAgentTask,
  getPendingAgentTasks,
} from "./store";

export interface AgentTaskRequest {
  /** Id del mensaje (para aprobar/rechazar). */
  id: string;
  /** Clave pública del NIDO que la envió. */
  peerPkHex: string;
  /** Identidad del remitente (resuelta por clave exacta). */
  senderName: string;
  /** Prefijo de la clave del remitente, para cotejo. */
  senderPkShort: string;
  /** Acción solicitada + contexto (kind, texto, args resumidos). */
  actionText: string;
  /** Cuándo llegó (epoch ms). */
  receivedAt: number;
}

/** English-first fallback (mirrors en.json) if i18n resolution fails. */
const EN_APPROVAL_FALLBACK: Record<string, string> = {
  "agentTasks.unknownSender": "Unknown NIDO contact",
};

/** Nombre visible del remitente cuando no hay contacto guardado (i18n). */
function approvalT(key: string): string {
  try {
    const i18n = require("../i18n").default as { t(k: string): string };
    const s = i18n.t(key);
    if (s && s !== key) return s;
  } catch {
    // respaldo en inglés
  }
  return EN_APPROVAL_FALLBACK[key] ?? key;
}

async function toRequest(
  m: { id: string; peerPk: string; text: string; ts: number },
): Promise<AgentTaskRequest> {
  let senderName = approvalT("agentTasks.unknownSender");
  try {
    const contact = await findContactByPk(m.peerPk);
    if (contact) senderName = contact.name;
  } catch {
    // Sin contactos disponibles: se muestra igual, sin nombre.
  }
  return {
    id: m.id,
    peerPkHex: m.peerPk,
    senderName,
    senderPkShort: m.peerPk.slice(0, 8),
    actionText: m.text,
    receivedAt: m.ts,
  };
}

/** Tareas remotas pendientes de decisión humana, ordenadas por llegada. */
export async function listPendingAgentTasks(): Promise<AgentTaskRequest[]> {
  const pending = await getPendingAgentTasks();
  return Promise.all(pending.map(toRequest));
}

/** Una tarea pendiente concreta (para el diálogo de decisión). Null si no existe o ya se decidió. */
export async function getPendingAgentTask(id: string): Promise<AgentTaskRequest | null> {
  const m = await getAgentTask(id);
  if (!m || m.status !== "queued") return null;
  return toRequest(m);
}

/**
 * Aprueba una tarea encolada. Devuelve true si la decisión quedó
 * registrada; false si el id no existe o ya se había decidido.
 */
export async function approveAgentTask(id: string): Promise<boolean> {
  return decideAgentTask(id, "approved");
}

/**
 * Rechaza una tarea encolada. Devuelve true si la decisión quedó
 * registrada; false si el id no existe o ya se había decidido.
 */
export async function rejectAgentTask(id: string): Promise<boolean> {
  return decideAgentTask(id, "rejected");
}

/** Cuántas tareas esperan decisión humana. */
export async function pendingAgentTaskCount(): Promise<number> {
  return (await getPendingAgentTasks()).length;
}
