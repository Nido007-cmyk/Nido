/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi } from "vitest";
import { handleMemoryPressure, type MemoryPressureEngines } from "./memoryPressure";

function fakeEngines(llmLoaded: boolean, embLoaded: boolean) {
  const calls: string[] = [];
  const engines: MemoryPressureEngines = {
    llm: {
      isLoaded: llmLoaded,
      unload: vi.fn(async () => {
        calls.push("llm");
      }),
    },
    embedding: {
      isLoaded: embLoaded,
      unload: vi.fn(async () => {
        calls.push("embedding");
      }),
    },
  };
  return { engines, calls };
}

describe("handleMemoryPressure (optimización 2026-11-08, fase 5)", () => {
  it("generando no se toca nada", async () => {
    const { engines, calls } = fakeEngines(true, true);
    await handleMemoryPressure({ generating: true }, engines);
    expect(calls).toEqual([]);
  });

  it("sin generar descarga el LLM primero y el embedding después", async () => {
    const { engines, calls } = fakeEngines(true, true);
    await handleMemoryPressure({ generating: false }, engines);
    expect(calls).toEqual(["llm", "embedding"]);
  });

  it("solo descarga lo que está residente", async () => {
    const { engines, calls } = fakeEngines(false, true);
    await handleMemoryPressure({ generating: false }, engines);
    expect(calls).toEqual(["embedding"]);
  });

  it("un fallo al descargar el LLM no impide descargar el embedding ni lanza", async () => {
    const { engines, calls } = fakeEngines(true, true);
    (engines.llm.unload as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
    await expect(handleMemoryPressure({ generating: false }, engines)).resolves.toBeUndefined();
    expect(calls).toEqual(["embedding"]);
  });
});
