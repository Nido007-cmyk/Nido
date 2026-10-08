/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Tests para la fuente canónica de autorización.
 *
 * Verifica:
 * 1. authorize() toma decisiones correctas (AUTO/ASK/DENY)
 * 2. No hay decisiones contradictorias entre authorize() y evaluateAction()
 * 3. Las listas de herramientas irreversibles no divergen
 * 4. nido_pair y nido_approve_task requieren confirmación
 */

import { describe, it, expect } from "vitest";
import {
  authorize,
  checkAuthConsistency,
  isIrreversibleTool,
  IRREVERSIBLE_TOOLS_CANONICAL,
} from "./authorization";
import type { ToolAction } from "./policyEngine";

function makeAction(tool: string): ToolAction {
  return {
    tool,
    args: {},
    context: [],
  };
}

describe("authorize - decisiones canónicas", () => {
  it("AUTO para herramientas seguras", () => {
    const result = authorize(makeAction("device_time"));
    expect(result.decision).toBe("AUTO");
    expect(result.allowed).toBe(true);
    expect(result.requiresConfirmation).toBe(false);
  });

  it("ASK para herramientas irreversibles", () => {
    const irreversibles = [
      "send_sms",
      "nido_send_message",
      "place_call",
      "send_email",
      "purchase",
      "delete_file",
      "delete_memory",
      "factory_reset",
    ];
    for (const tool of irreversibles) {
      const result = authorize(makeAction(tool));
      expect(result.decision).toBe("ASK");
      expect(result.requiresConfirmation).toBe(true);
      // allowed=true BUT requires confirmation (compat con PolicyDecision)
      expect(result.allowed).toBe(true);
    }
  });

  it("ASK para nido_pair y nido_approve_task", () => {
    // MEDIUM corregido: estos requieren confirmación humana
    for (const tool of ["nido_pair", "nido_approve_task"]) {
      const result = authorize(makeAction(tool));
      expect(result.decision).toBe("ASK");
      expect(result.requiresConfirmation).toBe(true);
    }
  });

  it("isIrreversibleTool coincide con la lista canónica", () => {
    expect(isIrreversibleTool("send_sms")).toBe(true);
    expect(isIrreversibleTool("nido_pair")).toBe(true);
    expect(isIrreversibleTool("device_time")).toBe(false);
    expect(isIrreversibleTool("nonexistent_tool")).toBe(false);
  });
});

describe("checkAuthConsistency - sin decisiones contradictorias", () => {
  it("consistente para herramientas seguras", () => {
    const result = checkAuthConsistency(makeAction("device_time"));
    expect(result.consistent).toBe(true);
  });

  it("consistente para todas las herramientas irreversibles canónicas", () => {
    // Este test FALLA si las listas divergen (detecta H-1)
    for (const tool of IRREVERSIBLE_TOOLS_CANONICAL) {
      const result = checkAuthConsistency(makeAction(tool));
      expect(
        result.consistent,
        `Inconsistencia para '${tool}': ${result.issue}`
      ).toBe(true);
      expect(result.authDecision).toBe("ASK");
    }
  });

  it("detecta divergencia si policyEngine no marca irreversible", () => {
    // Test de regresión: si alguien quita una herramienta de policyEngine
    // pero no de la lista canónica, este mecanismo lo detecta.
    // (No podemos simular la divergencia sin modificar el código,
    // pero verificamos que el checker existe y funciona.)
    const result = checkAuthConsistency(makeAction("send_sms"));
    expect(result.consistent).toBe(true);
    expect(result.authDecision).toBe("ASK");
    expect(result.policyDecision.requiresConfirmation).toBe(true);
  });
});

describe("preservación de invariantes de seguridad", () => {
  it("validateTask sigue bloqueando herramientas irreversibles", async () => {
    // Import dinámico para evitar ciclos
    const { validateTask } = await import("../scheduled/scheduledTasks");
    for (const tool of IRREVERSIBLE_TOOLS_CANONICAL) {
      const result = validateTask({
        id: "test",
        name: "test",
        schedule: "0 7 * * *",
        instruction: "test",
        enabled: true,
        createdAt: Date.now(),
        allowedTools: [tool],
      } as any);
      expect(
        result.valid,
        `validateTask debe bloquear '${tool}' en scheduled tasks`
      ).toBe(false);
    }
  });
});
