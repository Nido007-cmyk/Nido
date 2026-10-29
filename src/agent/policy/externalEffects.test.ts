/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Regla R4 de la constitución (docs/NIDO_CONSTITUTION.md): ninguna acción
 * con efecto fuera de la app se ejecuta sin confirmación de la persona.
 *
 * Cada herramienta del manifiesto tiene que estar clasificada aquí. Una
 * herramienta nueva hace fallar este test hasta que alguien decida, a
 * propósito, si tiene efecto fuera de la app y cómo se confirma.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LOCAL_TOOLS } from "../tools/manifest";
import { IRREVERSIBLE_TOOLS_CANONICAL } from "./authorization";

/** Efecto fuera de la app (o irreversible): siempre con confirmación. */
const EXTERNAL = [
  "open_app",
  "create_calendar_event",
  "place_call",
  "send_sms",
  "nido_send_message",
  "nido_pair",
  "nido_approve_task",
  "nido_reject_task",
  "delete_note",
  "delete_reminder",
] as const;

/**
 * Sin efecto fuera de la app: leen, calculan o guardan dentro de NIDO.
 * (Guardar notas, recordatorios o datos con contenido no confiable en el
 * turno también pide confirmación: lo cubre untrustedContent.test.ts.)
 */
const INTERNAL = [
  "save_note",
  "list_notes",
  "read_note",
  "create_reminder",
  "remember_fact",
  "device_time",
  "calculate",
  "convert_units",
  "list_calendar_events",
  "find_contact",
  "read_picked_file",
  "use_skill",
  "analyze_table",
  "nido_read_inbox",
  "nido_my_code",
  "nido_review_tasks",
] as const;

const handlersSrc = readFileSync(fileURLToPath(new URL("../tools/handlers.ts", import.meta.url)), "utf8");
const confirmedInHandler = (tool: string) => new RegExp(`\\b${tool}:\\s*withConfirmation\\(`).test(handlersSrc);

describe("R4: confirmación antes de cualquier efecto fuera de la app", () => {
  const names = LOCAL_TOOLS.map((t) => t.name);

  it("cada herramienta del manifiesto está clasificada (y solo una vez)", () => {
    const classified = [...EXTERNAL, ...INTERNAL] as string[];
    expect(new Set(classified).size).toBe(classified.length);
    expect([...names].sort()).toEqual([...classified].sort());
  });

  it.each(EXTERNAL)("%s pide confirmación (política o diálogo propio)", (tool) => {
    expect(IRREVERSIBLE_TOOLS_CANONICAL.has(tool) || confirmedInHandler(tool)).toBe(true);
  });
});
