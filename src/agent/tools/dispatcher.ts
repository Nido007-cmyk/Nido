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
  onConfirm?: (
    decision: PolicyDecision,
    /**
     * TOOLS-AUDIT 2026-10-11: qué se va a ejecutar exactamente, para que el
     * diálogo muestre el número / texto en vez de un motivo genérico.
     * Opcional para no romper llamadores existentes.
     */
    action?: { tool: string; args: Record<string, unknown> }
  ) => Promise<boolean>;
  /**
   * T-10 (0.1.99, M-20): señal de aborto del turno. Si aborta mientras
   * el handler está en vuelo, el despacho se asienta como cancelado en
   * vez de esperar a que el handler termine. La espera humana de
   * confirmación NO se interrumpe: pensar no es un cuelgue.
   */
  signal?: AbortSignal;
  /**
   * T-10 (0.1.99, M-15): plazo máximo del handler, en ms. Al vencer, el
   * despacho se da por fallido con resultado DESCONOCIDO (la acción
   * puede completar tarde). Por defecto, DEFAULT_TOOL_TIMEOUT_MS.
   */
  toolTimeoutMs?: number;
}

/**
 * T-10 (0.1.99, M-15): plazo por defecto de un handler. Los handlers
 * tocan E/S real (Linking, SQLCipher, notificaciones): generoso para
 * no matar trabajo legítimo lento, finito para que un handler colgado
 * no deje el turno (y la batería) esperando para siempre.
 */
export const DEFAULT_TOOL_TIMEOUT_MS = 60_000;

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
  const rawArgs = call.arguments ?? {};
  if (typeof rawArgs !== "object" || Array.isArray(rawArgs)) {
    return { ok: false, error: `argumentos inválidos para "${call.name}"` };
  }
  // TOOLS-AUDIT 2026-10-11: el 0.5B suele mandar números entre comillas
  // ({"value": "5"}) y la validación estricta lo rechazaba. Se convierte
  // SOLO un string que sea un número decimal completo; cualquier otra
  // cosa sigue fallando igual que antes.
  const args: Record<string, unknown> = { ...(rawArgs as Record<string, unknown>) };
  for (const [paramName, def] of Object.entries(tool.parameters)) {
    const v = args[paramName];
    if (def.type === "number" && typeof v === "string" && NUMERIC_STRING_RE.test(v.trim())) {
      args[paramName] = Number(v.trim().replace(",", "."));
    }
  }

  for (const [paramName, def] of Object.entries(tool.parameters)) {
    const value = args[paramName];
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
    // T-10 (0.1.99, M-17): la validación central ya no mira solo tipos.
    // Un number debe ser FINITO: el JSON del modelo admite 1e999, que
    // parsea a Infinity, y una cadena numérica de cientos de dígitos
    // coercionada en el bucle anterior también. Y las restricciones
    // que la descripción del parámetro ya promete (enum, formato,
    // topes) se imponen aquí, en el centro, con un error que el modelo
    // puede corregir, en vez de degradar en silencio en cada handler.
    if (def.type === "number" && typeof value === "number" && !Number.isFinite(value)) {
      return { ok: false, error: `"${call.name}".${paramName} debe ser un número finito` };
    }
    if (def.enum && (typeof value !== "string" || !def.enum.includes(value))) {
      return {
        ok: false,
        error: `"${call.name}".${paramName} debe ser uno de: ${def.enum.join(", ")}`,
      };
    }
    if (def.maxLength !== undefined && typeof value === "string" && value.length > def.maxLength) {
      return {
        ok: false,
        error: `"${call.name}".${paramName} supera el máximo de ${def.maxLength} caracteres`,
      };
    }
    if (def.min !== undefined && typeof value === "number" && value < def.min) {
      return { ok: false, error: `"${call.name}".${paramName} debe ser ≥ ${def.min}` };
    }
    if (def.max !== undefined && typeof value === "number" && value > def.max) {
      return { ok: false, error: `"${call.name}".${paramName} debe ser ≤ ${def.max}` };
    }
    if (def.format === "iso-datetime" && (typeof value !== "string" || !isIsoDateTime(value))) {
      return {
        ok: false,
        error: `"${call.name}".${paramName} debe ser una fecha/hora ISO-8601 (p. ej. 2026-11-20T09:00)`,
      };
    }
  }

  for (const key of Object.keys(args)) {
    if (!(key in tool.parameters)) {
      return { ok: false, error: `"${call.name}" no acepta el parámetro "${key}"` };
    }
  }

  return { ok: true, tool, args };
}

/**
 * T-10 (0.1.99, M-17): ISO-8601 con fecha y hora (la «T» es obligatoria:
 * «2026-11-20 09:00» no lo es). Los rangos se comprueban a mano porque
 * Date.parse no es igual de estricto en todos los motores JS; el
 * Date.parse final es solo una segunda red.
 */
const ISO_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

function isIsoDateTime(value: string): boolean {
  const m = ISO_DATETIME_RE.exec(value);
  if (!m) return false;
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}

/** Número decimal completo: "5", "-2.5", "3,75". Nada de "5 km" ni "0x10". */
const NUMERIC_STRING_RE = /^-?\d+(?:[.,]\d+)?$/;

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
  return (await dispatchToolCallDetailed(call, handlers, options)).text;
}

/** Resultado de un despacho con su estado (para rutas deterministas). */
export interface DispatchOutcome {
  status: "executed" | "invalid" | "disabled" | "blocked" | "cancelled" | "failed";
  text: string;
}

/**
 * Igual que dispatchToolCall (misma compuerta, mismo orden: validación →
 * interruptor del usuario → política → confirmación → handler), pero
 * devuelve también el estado, para que los pre-routers deterministas
 * respondan al usuario en su idioma sin interpretar el texto.
 */
export async function dispatchToolCallDetailed(
  call: { name: string; arguments?: Record<string, unknown> | null },
  handlers: Record<string, ToolHandler>,
  options: DispatchOptions = {}
): Promise<DispatchOutcome> {
  const validated = validateToolCall(call);
  if (!validated.ok) {
    actionLog.record(typeof call?.name === "string" && call.name ? call.name : "?", "invalid");
    return { status: "invalid", text: `Error de herramienta: ${validated.error}.` };
  }

  // Permisos del usuario: una herramienta apagada no se ejecuta nunca.
  if (isToolDisabled(validated.tool.name)) {
    actionLog.record(validated.tool.name, "disabled");
    return {
      status: "disabled",
      text: `La herramienta "${validated.tool.name}" está desactivada por el usuario en los permisos del agente. No la uses; dile al usuario que puede activarla en Acerca de.`,
    };
  }

  // Policy Engine: evaluar antes de ejecutar.
  const decision = evaluateAction({
    tool: validated.tool.name,
    args: validated.args,
    context: options.policyContext ?? [],
  });

  if (!decision.allowed) {
    actionLog.record(validated.tool.name, "blocked", false, undefined, decision.injectionOrigin);
    return { status: "blocked", text: `Bloqueado por política de seguridad: ${decision.reason}` };
  }

  if (decision.requiresConfirmation) {
    const confirmed = options.onConfirm
      ? await options
          .onConfirm(decision, { tool: validated.tool.name, args: validated.args })
          .catch(() => false)
      : false;
    if (!confirmed) {
      actionLog.record(validated.tool.name, "cancelled", false, undefined, decision.injectionOrigin);
      return {
        status: "cancelled",
        text: `Acción "${validated.tool.name}" cancelada: requiere confirmación del usuario.`,
      };
    }
  }

  const handler = handlers[validated.tool.name];
  if (!handler) {
    actionLog.record(validated.tool.name, "invalid");
    return {
      status: "invalid",
      text: `Error de herramienta: "${validated.tool.name}" no está implementada en este dispositivo.`,
    };
  }
  // T-10 (0.1.99, M-15 + M-20): el handler corre con plazo y con la
  // señal del turno, en la ÚNICA costura por la que pasa todo despacho
  // (modelo, rutas deterministas y tareas programadas). La espera
  // humana de confirmación de arriba queda FUERA de la carrera a
  // propósito. Si el plazo vence, el resultado es DESCONOCIDO — la
  // acción puede completar tarde — y el rechazo tardío del handler
  // queda atrapado para que no flote una promesa sin manejar.
  const timeoutMs = options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  const handlerPromise = (async () => handler(validated.args))();
  void handlerPromise.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const racers: Array<Promise<{ kind: "done"; result: string } | { kind: "error"; error: unknown } | { kind: "timeout" } | { kind: "aborted" }>> = [
    handlerPromise.then(
      (result) => ({ kind: "done" as const, result }),
      (error: unknown) => ({ kind: "error" as const, error })
    ),
    new Promise<{ kind: "timeout" }>((resolve) => {
      timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
    }),
  ];
  if (options.signal) {
    const signal = options.signal;
    racers.push(
      new Promise<{ kind: "aborted" }>((resolve) => {
        if (signal.aborted) {
          resolve({ kind: "aborted" });
          return;
        }
        onAbort = () => resolve({ kind: "aborted" });
        signal.addEventListener("abort", onAbort, { once: true });
      })
    );
  }
  const outcome = await Promise.race(racers);
  if (timer) clearTimeout(timer);
  if (options.signal && onAbort) options.signal.removeEventListener("abort", onAbort);

  if (outcome.kind === "timeout") {
    actionLog.record(validated.tool.name, "failed", false, undefined, decision.injectionOrigin);
    return {
      status: "failed",
      text: `Error ejecutando "${validated.tool.name}": tardó más de ${Math.round(timeoutMs / 1000)} s y se dio por fallida. Su resultado es DESCONOCIDO: puede haber completado tarde. No la reintentes a ciegas.`,
    };
  }
  if (outcome.kind === "aborted") {
    actionLog.record(validated.tool.name, "cancelled", false, undefined, decision.injectionOrigin);
    return {
      status: "cancelled",
      text: `Ejecución de "${validated.tool.name}" interrumpida: el usuario detuvo el turno.`,
    };
  }
  if (outcome.kind === "error") {
    const e = outcome.error as { message?: string } | undefined;
    actionLog.record(validated.tool.name, "failed", false, undefined, decision.injectionOrigin);
    return { status: "failed", text: `Error ejecutando "${validated.tool.name}": ${e?.message ?? String(outcome.error)}` };
  }
  actionLog.record(validated.tool.name, "executed", decision.requiresConfirmation, undefined, decision.injectionOrigin);
  return { status: "executed", text: typeof outcome.result === "string" ? outcome.result : JSON.stringify(outcome.result) };
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
