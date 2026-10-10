/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * dispatcher.ts - NIDO: validación y despacho puros de llamadas a herramientas.
 *
 * Un modelo pequeño (1.5B–8B) alucina argumentos: tipos mal, parámetros
 * inventados, herramientas que no existen. Este módulo es la compuerta
 * determinista entre lo que el modelo *dice* y lo que la app *hace*:
 *
 * 1. La herramienta debe existir en LOCAL_TOOLS.
 * 2. Los parámetros requeridos deben estar presentes.
 * 3. Cada parámetro debe coincidir en tipo con el manifiesto.
 * 4. Sin parámetros desconocidos (estricto: el modelo no inventa flags).
 *
 * Todo puro y testeable - los handlers reales (notas, alarmas, intents)
 * los inyecta la app, así esta capa no toca nada nativo.
 */

import { LOCAL_TOOLS, type ToolDefinition } from "./manifest";
import {
  evaluateAction,
  type LabeledContent,
  type PolicyDecision,
} from "../policy/policyEngine";

import { actionLog } from "../actionLog";
import { isToolDisabled } from "./toolPermissions";

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

export type ValidationResult =
  | { ok: true; tool: ToolDefinition; args: Record<string, unknown> }
  | { ok: false; error: string };

export interface DispatchOptions {
  /**
   * Untrusted context that influenced this call (tool results, retrieval,
   * file contents). Used by the Policy Engine to detect prompt injection.
   * If omitted, the call is evaluated with empty context.
   */
  policyContext?: LabeledContent[];
  /**
   * Callback invoked when the Policy Engine requires human confirmation
   * for an irreversible action. Should return true if the user confirmed.
   * If omitted and confirmation is required, the call is blocked.
   */
  onConfirm?: (decision: PolicyDecision) => Promise<boolean>;
}

export function validateToolCall(call: {
  name: string;
  arguments?: Record<string, unknown> | null;
}): ValidationResult {
  if (!call || typeof call.name !== "string" || !call.name) {
    return { ok: false, error: "llamada sin nombre de herramienta" };
  }
  const tool = LOCAL_TOOLS.find((t) => t.name === call.name);
  if (!tool) {
    return { ok: false, error: `herramienta desconocida: "${call.name}"` };
  }
  const args = call.arguments ?? {};
  if (typeof args !== "object" || Array.isArray(args)) {
    return { ok: false, error: `argumentos inválidos para "${call.name}"` };
  }

  for (const [paramName, def] of Object.entries(tool.parameters)) {
    const value = (args as Record<string, unknown>)[paramName];
    if (value === undefined || value === null) {
      if (def.required) {
        return { ok: false, error: `"${call.name}" requiere el parámetro "${paramName}"` };
      }
      continue;
    }
    const actual = typeof value;
    if (actual !== def.type) {
      return {
        ok: false,
        error: `"${call.name}".${paramName} debe ser ${def.type}, llegó ${actual}`,
      };
    }
  }

  for (const key of Object.keys(args)) {
    if (!(key in tool.parameters)) {
      return { ok: false, error: `"${call.name}" no acepta el parámetro "${key}"` };
    }
  }

  return { ok: true, tool, args: args as Record<string, unknown> };
}

/**
 * Valida, aplica la política de seguridad y ejecuta. Si la validación falla,
 * devuelve el error como observación de texto (el modelo lo ve y puede
 * corregirse) en vez de lanzar - el loop nunca muere por una herramienta
 * mal formada. Si el Policy Engine bloquea la acción, se devuelve el
 * motivo del bloqueo. Si requiere confirmación humana y no se confirma,
 * se devuelve un mensaje de cancelación.
 */
export async function dispatchToolCall(
  call: { name: string; arguments?: Record<string, unknown> | null },
  handlers: Record<string, ToolHandler>,
  options: DispatchOptions = {}
): Promise<string> {
  const validated = validateToolCall(call);
  if (!validated.ok) {
    actionLog.record(typeof call?.name === "string" && call.name ? call.name : "?", "invalid");
    return `Error de herramienta: ${validated.error}.`;
  }

  // Permisos del usuario: una herramienta apagada no se ejecuta nunca.
  if (isToolDisabled(validated.tool.name)) {
    actionLog.record(validated.tool.name, "disabled");
    return `La herramienta "${validated.tool.name}" está desactivada por el usuario en los permisos del agente. No la uses; dile al usuario que puede activarla en Acerca de.`;
  }

  // Policy Engine: evaluar antes de ejecutar.
  const decision = evaluateAction({
    tool: validated.tool.name,
    args: validated.args,
    context: options.policyContext ?? [],
  });

  if (!decision.allowed) {
    actionLog.record(validated.tool.name, "blocked");
    return `Bloqueado por política de seguridad: ${decision.reason}`;
  }

  if (decision.requiresConfirmation) {
    const confirmed = options.onConfirm
      ? await options.onConfirm(decision).catch(() => false)
      : false;
    if (!confirmed) {
      actionLog.record(validated.tool.name, "cancelled");
      return `Acción "${validated.tool.name}" cancelada: requiere confirmación del usuario.`;
    }
  }

  const handler = handlers[validated.tool.name];
  if (!handler) {
    actionLog.record(validated.tool.name, "invalid");
    return `Error de herramienta: "${validated.tool.name}" no está implementada en este dispositivo.`;
  }
  try {
    const result = await handler(validated.args);
    actionLog.record(validated.tool.name, "executed", decision.requiresConfirmation);
    return typeof result === "string" ? result : JSON.stringify(result);
  } catch (e: any) {
    actionLog.record(validated.tool.name, "failed");
    return `Error ejecutando "${validated.tool.name}": ${e?.message ?? String(e)}`;
  }
}

/** Describe las herramientas para el system prompt (compacto, en español).
 *
 * Formato por herramienta: `- nombre: descripción (param*:tipo: hint; ...)`.
 * El `*` marca parámetros requeridos. Se conserva TODA la información
 * necesaria para construir llamadas correctas (nombre, descripción,
 * parámetros, tipos, requeridos y hints de formato); solo se comprime la
 * estructura (sin la etiqueta "Parámetros:" ni "(requerido)" verboso).
 * El prompt del sistema con las 24 herramientas debe mantenerse acotado:
 * con n_ctx pequeños el prompt desbordaba antes de generar
 * ("Context is full", T-contexto-2026-10-06).
 *
 * P1.3-2026-10-08: intent-gated lists. The full list costs ~360 tokens
 * every turn; most intents need only a few. Pass the agent intent to get
 * the trimmed list; omit it for the full list (backwards compatible).
 */
export function describeToolsForPrompt(intent?: "recordar" | "actuar" | "conversar"): string {
  const tools = intent ? LOCAL_TOOLS.filter((t) => TOOLS_BY_INTENT[intent].includes(t.name)) : LOCAL_TOOLS;
  return tools.map(describeToolCompact).join("\n");
}

/**
 * P1.3-2026-10-08: compact one-line tool rendering for the system prompt.
 * Keeps the full description (the model needs it to choose) plus param
 * names, types and required markers (the T-contexto-2026-10-06 contract:
 * "conserva la información necesaria para llamadas correctas") — but
 * drops the verbose per-param prose descriptions, which were the bulk of
 * the ~1,790-token old prompt. The dispatcher still validates full args
 * at call time.
 */
function describeToolCompact(t: ToolDefinition): string {
  const params = Object.entries(t.parameters)
    .map(([n, p]) => `${n}${p.required ? "*" : ""}:${p.type}`)
    .join(", ");
  return `- ${t.name}${params ? `(${params})` : ""}: ${t.description}`;
}

/** Full rendering (with per-param docs) — kept for debugging/inspection, not the prompt. */
export function describeToolsForPromptVerbose(): string {
  return LOCAL_TOOLS.map((t) => {
    const params = Object.entries(t.parameters)
      .map(([n, p]) => `${n}${p.required ? "*" : ""}:${p.type}: ${p.description}`)
      .join("; ");
    return `- ${t.name}: ${t.description}${params ? ` (${params})` : ""}`;
  }).join("\n");
}

/**
 * P1.3-2026-10-08: which tools each intent may use. Explicit allowlists
 * (not denylists) so a new tool never leaks into a trimmed prompt by
 * accident. If LOCAL_TOOLS gains a tool, add it here deliberately.
 */
const TOOLS_BY_INTENT: Record<"recordar" | "actuar" | "conversar", string[]> = {
  // Memory intent: the hint already says "usa remember_fact".
  recordar: ["remember_fact"],
  // Action intent: everything that does something in the world or reads
  // local data. remember_fact is reachable via conversar if needed.
  actuar: [
    "create_reminder",
    "device_time",
    "open_app",
    "calculate",
    "convert_units",
    "create_calendar_event",
    "list_calendar_events",
    "find_contact",
    "place_call",
    "send_sms",
    "read_picked_file",
    "use_skill",
    "analyze_table",
    "save_note",
    "list_notes",
    "read_note",
    "nido_send_message",
    "nido_read_inbox",
    "nido_my_code",
    "nido_pair",
    "nido_review_tasks",
    "nido_approve_task",
    "nido_reject_task",
  ],
  // Chat intent: the 3 most common tools; the hint says tools only "si
  // aportan algo concreto".
  conversar: ["device_time", "calculate", "remember_fact"],
};
