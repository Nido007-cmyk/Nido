/**
 * stageError.test.ts — withStage etiqueta la etapa y conserva el mensaje.
 *
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
import { describe, it, expect } from "vitest";
import { withStage } from "./stageError";

describe("withStage", () => {
  it("devuelve el valor cuando no hay error", async () => {
    await expect(withStage("s", async () => 42)).resolves.toBe(42);
  });

  it("antepone la etiqueta de la etapa al mensaje", async () => {
    const err = await withStage("initLlama", async () => {
      throw new Error("undefined is not a function");
    }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/^\[initLlama\] undefined is not a function/);
  });

  it("maneja errores no-Error", async () => {
    const err = await withStage("trust-check", async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw "boom";
    }).catch((e) => e);
    expect(err.message).toMatch(/^\[trust-check\] boom/);
  });
});
