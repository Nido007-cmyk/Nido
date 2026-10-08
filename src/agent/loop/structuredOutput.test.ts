/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi } from "vitest";
import { validateStructuredOutput, withBoundedRepair } from "./structuredOutput";

describe("validateStructuredOutput", () => {
  const schema = { required: ["verdict"], properties: { verdict: "string" as const } };

  it("acepta JSON válido que cumple el schema", () => {
    const r = validateStructuredOutput<{ verdict: string }>(schema, '{"verdict":"SUPPORTED"}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.verdict).toBe("SUPPORTED");
  });

  it("rechaza texto que no es JSON", () => {
    const r = validateStructuredOutput(schema, "SUPPORTED. The claim matches.");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not valid JSON/);
  });

  it("rechaza JSON que no es objeto", () => {
    expect(validateStructuredOutput(schema, "[1,2]").ok).toBe(false);
    expect(validateStructuredOutput(schema, "null").ok).toBe(false);
  });

  it("rechaza clave requerida faltante", () => {
    const r = validateStructuredOutput(schema, '{"reason":"x"}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/missing required key "verdict"/);
  });

  it("rechaza tipo incorrecto", () => {
    const r = validateStructuredOutput(schema, '{"verdict":42}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/must be string/);
  });
});

describe("withBoundedRepair", () => {
  const ok = (value: string) => ({ ok: true as const, value });
  const bad = (error: string) => ({ ok: false as const, error });

  it("devuelve el primer intento si valida", async () => {
    const attempt = vi.fn().mockResolvedValue("good");
    const repair = vi.fn();
    const result = await withBoundedRepair({
      attempt,
      repair,
      validate: () => ok("v"),
      fallback: "fb",
    });
    expect(result).toBe("v");
    expect(repair).not.toHaveBeenCalled();
  });

  it("reintenta UNA vez con el error específico y devuelve el reparo si valida", async () => {
    const attempt = vi.fn().mockResolvedValue("bad1");
    const repair = vi.fn().mockResolvedValue("fixed");
    let calls = 0;
    const result = await withBoundedRepair({
      attempt,
      repair: (badOutput, error) => {
        expect(badOutput).toBe("bad1");
        expect(error).toMatch(/missing required key/);
        return repair(badOutput, error);
      },
      validate: () => (++calls === 1 ? bad('missing required key "x"') : ok("v2")),
      fallback: "fb",
    });
    expect(result).toBe("v2");
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(repair).toHaveBeenCalledTimes(1);
  });

  it("fail closed: devuelve fallback si ambos intentos fallan (nunca más de 2 generaciones)", async () => {
    const attempt = vi.fn().mockResolvedValue("bad1");
    const repair = vi.fn().mockResolvedValue("bad2");
    const onFailure = vi.fn();
    const result = await withBoundedRepair({
      attempt,
      repair,
      validate: () => bad("still bad"),
      fallback: "fb",
      onValidationFailure: onFailure,
    });
    expect(result).toBe("fb");
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(repair).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledTimes(2);
    expect(onFailure).toHaveBeenNthCalledWith(1, 0, "still bad");
    expect(onFailure).toHaveBeenNthCalledWith(2, 1, "still bad");
  });
});
