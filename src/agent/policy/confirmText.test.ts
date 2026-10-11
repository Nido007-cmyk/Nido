/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { describePolicyConfirmation } from "./confirmText";
import { evaluateAction } from "./policyEngine";

const critical = { risk: "critical" as const, reason: "Tool 'place_call' is irreversible and requires human confirmation." };

describe("describePolicyConfirmation — el diálogo dice QUÉ se va a hacer", () => {
  it("llamada: muestra el número exacto, en el idioma del usuario (antes: texto genérico en inglés)", () => {
    const es = describePolicyConfirmation(critical, { tool: "place_call", args: { phone: "+52 55 1234 5678" } }, "es");
    expect(es.title).toBe("Llamar");
    expect(es.message).toContain("+52 55 1234 5678");
    expect(es.message).not.toContain("irreversible");
    expect(describePolicyConfirmation(critical, { tool: "place_call", args: { phone: "1" } }, "pt").title).toBe("Ligar");
  });

  it("SMS: número y texto COMPLETOS (sin recortar)", () => {
    const long = "x".repeat(500) + " FIN";
    const d = describePolicyConfirmation(critical, { tool: "send_sms", args: { phone: "555", message: long } }, "en");
    expect(d.message).toContain("555");
    expect(d.message).toContain(long);
  });

  it("guardar con contenido externo: muestra lo que se va a guardar", () => {
    const d = describePolicyConfirmation(
      { risk: "medium", reason: "..." },
      { tool: "remember_fact", args: { content: "mi PIN es 1234" } },
      "es",
    );
    expect(d.message).toContain("mi PIN es 1234");
  });

  it("herramienta sin texto propio: genérico localizado, avisa si no se puede deshacer", () => {
    const d = describePolicyConfirmation(critical, { tool: "nido_pair", args: {} }, "es");
    expect(d.message).toContain("«nido_pair»");
    expect(d.message).toContain("No se puede deshacer.");
    expect(describePolicyConfirmation({ risk: "low", reason: "" }, undefined, "en").message).toContain("“?”");
  });

  it("las acciones que hoy piden confirmación a la política tienen texto claro", () => {
    for (const tool of ["place_call", "send_sms"]) {
      const decision = evaluateAction({ tool, args: {}, context: [] });
      expect(decision.requiresConfirmation).toBe(true);
      const d = describePolicyConfirmation(decision, { tool, args: { phone: "555", message: "hola" } }, "es");
      expect(d.message).toContain("555");
    }
  });
});
