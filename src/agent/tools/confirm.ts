/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * confirm.ts — NIDO: confirmación explícita antes de acciones sensibles.
 *
 * Regla: ninguna herramienta con efectos fuera de NIDO puede ejecutarse en
 * silencio. Las herramientas sensibles piden confirmación al usuario con un
 * resumen claro de lo que van a hacer; si el usuario cancela o no hay
 * canal de confirmación en producción, la acción NO se ejecuta.
 *
 * Herramientas sensibles hoy:
 * - create_calendar_event: escribe en el calendario del usuario.
 * - nido_send_message: envía (o encola) un mensaje a un contacto NIDO.
 * - nido_pair: empareja un contacto NIDO nuevo. El modelo de confianza del
 *   emparejamiento exige verificación humana en persona (el QR se escanea
 *   cara a cara); sin confirmación explícita, el agente podría emparejar
 *   un QR suministrado por un atacante y "verificarlo" sin que el usuario
 *   lo haya visto nunca.
 * - open_app (P-F1): entrega un enlace al SO (navegador, marcador,
 *   mensajería, correo) y cambia al usuario de app; solo esquemas
 *   explícitamente permitidos (https, http, tel, sms, mailto), todo lo
 *   demás falla cerrado antes de cualquier acción externa.
 * - nido_approve_task / nido_reject_task (M-6): decidir sobre una tarea
 *   remota encolada convierte trabajo pendiente en trabajo decidido; es
 *   una decisión del usuario, no del agente.
 * Ya seguras por diseño (el SO confirma): place_call (abre el marcador),
 * send_sms (abre la app de mensajes). read_picked_file pide el archivo con
 * el picker del sistema.
 *
 * Para añadir una futura herramienta sensible: añádela a SENSITIVE_TOOLS y
 * envuelve su handler con `withConfirmation`.
 */

export interface ConfirmRequest {
  /** Nombre de la herramienta (p. ej. "create_calendar_event"). */
  tool: string;
  /** Título corto del diálogo. */
  title: string;
  /** Resumen en lenguaje natural de lo que se va a hacer. */
  message: string;
}

/** Muestra el diálogo y resuelve true si el usuario confirma. */
export type RequestConfirm = (req: ConfirmRequest) => Promise<boolean>;

/** Describe la acción para el diálogo; puede consultar estado (p. ej. contactos). */
export type DescribeConfirm = (
  args: Record<string, unknown>,
) => ConfirmRequest | Promise<ConfirmRequest>;

/**
 * Mensaje de bloqueo explícito cuando la confirmación no puede obtenerse
 * (M-3). Se devuelve en lugar de ejecutar la herramienta.
 * Localizado vía i18n (inglés primero); si la resolución falla se usa el
 * inglés como respaldo para no mostrar nunca una clave cruda.
 */
type CoreT = (key: string, opts?: Record<string, string>) => string;
const EN_CONFIRM_CORE_FALLBACK: Record<string, string> = {
  "agentConfirm.confirmBlocked":
    "Blocked for security: “{{tool}}” requires explicit user confirmation, but the confirmation channel is not available. The action was NOT executed.",
  "agentConfirm.confirmCancelled": "Understood, I did nothing.",
  // N2: consentimiento ligado al payload descrito; si los args mutan entre
  // la confirmación y la ejecución, el consentimiento queda invalidado.
  "agentConfirm.confirmPayloadChanged":
    "Blocked for security: the payload of “{{tool}}” changed after confirmation. The action was NOT executed.",
};
function confirmCoreT(): CoreT {
  try {
    const i18n = require("../../i18n").default as {
      t(k: string, o?: unknown): string;
    };
    return (key, opts) => i18n.t(key, opts);
  } catch {
    return (key, opts) => {
      let s = EN_CONFIRM_CORE_FALLBACK[key] ?? key;
      for (const [k, v] of Object.entries(opts ?? {}))
        s = s.split(`{{${k}}}`).join(v);
      return s;
    };
  }
}

export function confirmBlockedMessage(tool: string): string {
  return confirmCoreT()("agentConfirm.confirmBlocked", { tool });
}

/**
 * N2: mensaje de bloqueo cuando el payload muta entre la confirmación y la
 * ejecución (el consentimiento se dio sobre otros bytes).
 */
export function confirmPayloadChangedMessage(tool: string): string {
  return confirmCoreT()("agentConfirm.confirmPayloadChanged", { tool });
}

/**
 * N2 — invariante central describe/execute.
 *
 * El consentimiento del usuario se da sobre lo que `describe(args)` mostró.
 * Para que la ejecución no pueda divergir de lo descrito, se congela una
 * foto serializada de `args` antes de describir y se verifica byte-idéntica
 * justo antes de ejecutar el handler. Si algo mutó los args en el intervalo
 * (o la foto no pudo tomarse), el consentimiento queda invalidado y la
 * acción NO se ejecuta: fail closed.
 *
 * Aplica a TODAS las herramientas sensibles envueltas con withConfirmation,
 * no solo a nido_send_message: futuras herramientas heredan la garantía sin
 * código adicional.
 */
function snapshotArgs(args: Record<string, unknown>): string | null {
  try {
    return JSON.stringify(args);
  } catch {
    return null;
  }
}

/** Herramientas que requieren confirmación explícita. */
export const SENSITIVE_TOOLS: ReadonlySet<string> = new Set([
  "create_calendar_event",
  "nido_send_message",
  "nido_pair",
  // P-F1: abrir un enlace externo cambia de app; requiere confirmación.
  "open_app",
  // M-6: decidir sobre una tarea remota encolada es una acción sensible.
  "nido_approve_task",
  "nido_reject_task",
]);

/**
 * Envuelve un handler: pide confirmación explícita al usuario antes de
 * ejecutar. Si el usuario cancela → no se ejecuta y se devuelve un mensaje
 * de cancelación.
 *
 * M-3 (fail-closed): si NO hay canal de confirmación, si el canal lanza, o
 * si ni siquiera se puede describir la acción para pedir consentimiento
 * informado, la herramienta NO se ejecuta y se devuelve un error explícito.
 * Un canal ausente es un fallo de seguridad, nunca una licencia para actuar.
 * En producción ChatScreen siempre inyecta el diálogo nativo.
 *
 * N2 (paridad describe/execute): la ejecución queda ligada a los args que
 * se describieron. Se congela una foto serializada de los args antes de
 * describir y se verifica justo antes de ejecutar; si mutaron en el
 * intervalo, el consentimiento queda invalidado → fail closed.
 */
export function withConfirmation(
  tool: string,
  handler: (args: Record<string, unknown>) => Promise<string>,
  requestConfirm: RequestConfirm | undefined,
  describe: DescribeConfirm,
): (args: Record<string, unknown>) => Promise<string> {
  return async (args) => {
    if (!requestConfirm) {
      if (typeof __DEV__ !== "undefined" && __DEV__) {
        console.warn(
          `[confirm] M-3: ${tool} sin canal de confirmación — acción bloqueada (fail-closed).`,
        );
      }
      return confirmBlockedMessage(tool);
    }
    // N2: foto de los args descritos; la ejecución queda ligada a ella.
    const frozenArgs = snapshotArgs(args);
    let req: ConfirmRequest;
    try {
      req = await describe(args);
    } catch {
      // Sin descripción no hay consentimiento informado posible → fail closed.
      return confirmBlockedMessage(tool);
    }
    let ok = false;
    try {
      ok = await requestConfirm(req);
    } catch {
      ok = false; // ante la duda, no actuar
    }
    if (!ok) return confirmCoreT()("agentConfirm.confirmCancelled");
    // N2: paridad describe/execute. Si los args mutaron entre la
    // descripción y la ejecución, el usuario aprobó otros bytes → la
    // acción NO se ejecuta. Sin foto verificable tampoco se ejecuta.
    if (frozenArgs === null || snapshotArgs(args) !== frozenArgs) {
      if (typeof __DEV__ !== "undefined" && __DEV__) {
        console.warn(
          `[confirm] N2: ${tool} — los args mutaron tras la confirmación; acción bloqueada (fail-closed).`,
        );
      }
      return confirmPayloadChangedMessage(tool);
    }
    return handler(args);
  };
}
