/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * actionLog.ts — registro de lo que el agente hizo o intentó hacer.
 *
 * Cada llamada a una herramienta deja una entrada: qué herramienta, cuándo
 * y cómo terminó. Nunca se guardan los argumentos ni el resultado (pueden
 * contener texto del usuario): solo el nombre de la herramienta y el
 * desenlace. Vive en memoria durante la sesión; se vacía al cerrar la app.
 */

export type ActionOutcome =
  /** La herramienta se ejecutó. */
  | "executed"
  /** La política de seguridad la bloqueó. */
  | "blocked"
  /** El usuario la desactivó en los permisos del agente. */
  | "disabled"
  /** Pedía confirmación y no se confirmó. */
  | "cancelled"
  /** Llamada mal formada o herramienta inexistente. */
  | "invalid"
  /** La herramienta falló al ejecutarse. */
  | "failed";

export interface ActionLogEntry {
  ts: string;
  tool: string;
  outcome: ActionOutcome;
  /** true si el usuario confirmó explícitamente antes de ejecutar. */
  confirmed: boolean;
}

const MAX_ENTRIES = 200;

class ActionLog {
  private entries: ActionLogEntry[] = [];
  private listeners = new Set<() => void>();

  record(tool: string, outcome: ActionOutcome, confirmed = false): void {
    this.entries.push({ ts: new Date().toISOString(), tool, outcome, confirmed });
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        // Un oyente nunca debe romper la acción registrada.
      }
    }
  }

  /** Más recientes primero. */
  list(): ActionLogEntry[] {
    return [...this.entries].reverse();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  clear(): void {
    this.entries = [];
  }
}

export const actionLog = new ActionLog();
