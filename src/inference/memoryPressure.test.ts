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
  it("generando sin gancho de parada no se toca nada", async () => {
    const { engines, calls } = fakeEngines(true, true);
    await handleMemoryPressure({ generating: true }, engines);
    expect(calls).toEqual([]);
  });

  it("generando CON gancho de parada: se pide la parada limpia y NO se descarga (F3-04)", async () => {
    // La política «generando no se hace nada» dejaba la sesión a
    // merced del LMK y el parcial se perdía entero. Ahora se acorta
    // la respuesta: stop() resuelve generate() con lo ya generado y
    // la residencia se cede en el siguiente evento, ya sin vuelo.
    const { engines, calls } = fakeEngines(true, true);
    const stop = vi.fn(async () => {
      calls.push("stop");
    });
    engines.llm.stop = stop;
    await handleMemoryPressure({ generating: true }, engines);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["stop"]);
  });

  it("una parada que falla no lanza ni provoca la descarga en el mismo evento", async () => {
    const { engines, calls } = fakeEngines(true, true);
    engines.llm.stop = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(handleMemoryPressure({ generating: true }, engines)).resolves.toBeUndefined();
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

describe("P-36 (auditoría 2026-11-13, F3-18): el nivel del evento manda", () => {
  it("nivel de fondo (40/60/80) sin generar: no se descarga nada", async () => {
    for (const level of [40, 60, 80]) {
      const { engines, calls } = fakeEngines(true, true);
      await handleMemoryPressure({ generating: false }, engines, level);
      expect(calls).toEqual([]);
    }
  });

  it("nivel UI_HIDDEN (20) generando: no se pide ni la parada — la respuesta sigue en segundo plano", async () => {
    const { engines, calls } = fakeEngines(true, true);
    const stop = vi.fn(async () => {
      calls.push("stop");
    });
    engines.llm.stop = stop;
    await handleMemoryPressure({ generating: true }, engines, 20);
    expect(stop).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("nivel RUNNING_CRITICAL (15): la política actúa como siempre", async () => {
    const { engines, calls } = fakeEngines(true, true);
    await handleMemoryPressure({ generating: false }, engines, 15);
    expect(calls).toEqual(["llm", "embedding"]);
  });

  it("sin nivel (llamantes viejos): la política actúa como siempre", async () => {
    const { engines, calls } = fakeEngines(true, true);
    await handleMemoryPressure({ generating: false }, engines, undefined);
    expect(calls).toEqual(["llm", "embedding"]);
  });
});
