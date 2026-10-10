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
 * contener texto del usuario): solo el nombre de la herramienta, el
 * desenlace y, si la acción creó algo que se puede deshacer (una nota o un
 * recordatorio), el identificador de lo creado.
 *
 * Este módulo es puro y vive en memoria. La persistencia en la base cifrada
 * se conecta desde fuera con setActionLogSink() (ver actionLogStore.ts),
 * para que el registro nunca dependa de que la base esté disponible.
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

/** Lo que una acción creó y se puede borrar para deshacerla. */
export interface UndoRef {
  kind: "note" | "reminder";
  id: string;
}

export interface ActionLogEntry {
  ts: string;
  tool: string;
  outcome: ActionOutcome;
  /** true si el usuario confirmó explícitamente antes de ejecutar. */
  confirmed: boolean;
  undo?: UndoRef;
}

export type ActionLogSink = (entry: ActionLogEntry) => void;

const MAX_ENTRIES = 200;

class ActionLog {
  private entries: ActionLogEntry[] = [];
  private listeners = new Set<() => void>();
  private pendingUndo = new Map<string, UndoRef>();
  private sink: ActionLogSink | null = null;

  /**
   * Un handler avisa de lo que acaba de crear. La siguiente entrada
   * "executed" de esa herramienta lo recoge. Las llamadas a herramientas son
   * secuenciales, así que no hay cruce entre acciones.
   */
  noteUndo(tool: string, undo: UndoRef): void {
    this.pendingUndo.set(tool, undo);
  }

  record(tool: string, outcome: ActionOutcome, confirmed = false, undo?: UndoRef): void {
    const pending = this.pendingUndo.get(tool);
    this.pendingUndo.delete(tool);
    const ref = outcome === "executed" ? (undo ?? pending) : undefined;
    const entry: ActionLogEntry = {
      ts: new Date().toISOString(),
      tool,
      outcome,
      confirmed,
      ...(ref ? { undo: ref } : {}),
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }
    if (this.sink) {
      try {
        this.sink(entry);
      } catch {
        // Guardar el historial nunca debe romper la acción registrada.
      }
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

  setSink(sink: ActionLogSink | null): void {
    this.sink = sink;
  }

  clear(): void {
    this.entries = [];
    this.pendingUndo.clear();
  }
}

export const actionLog = new ActionLog();

/** Conecta (o desconecta con null) la persistencia del historial. */
export function setActionLogSink(sink: ActionLogSink | null): void {
  actionLog.setSink(sink);
}
