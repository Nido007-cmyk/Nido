/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { PROVEN_LOADS_MAX, parseProvenLoads, provenContextFor, recordProvenLoad } from "./provenLoads";

describe("0.1.122 — cargas probadas en este aparato", () => {
  it("anota el mayor contexto con que respondió cada modelo", () => {
    let loads = recordProvenLoad({}, "qwen.gguf", 1024);
    expect(loads).toEqual({ "qwen.gguf": 1024 });
    loads = recordProvenLoad(loads, "qwen.gguf", 2048);
    expect(loads["qwen.gguf"]).toBe(2048);
    // Un contexto menor no baja la marca, y devuelve el MISMO objeto (no se escribe).
    expect(recordProvenLoad(loads, "qwen.gguf", 1024)).toBe(loads);
    expect(recordProvenLoad(loads, "qwen.gguf", 2048)).toBe(loads);
  });

  it("la clave es el nombre base: «models/<fichero>» y el fichero son el mismo", () => {
    const loads = recordProvenLoad({}, "models/lfm.gguf", 4096);
    expect(provenContextFor(loads, "lfm.gguf")).toBe(4096);
    expect(provenContextFor(loads, "models/lfm.gguf")).toBe(4096);
    expect(provenContextFor(loads, "otro.gguf")).toBeNull();
  });

  it("ignora entradas inválidas", () => {
    const loads = { "a.gguf": 512 };
    expect(recordProvenLoad(loads, "", 1024)).toBe(loads);
    expect(recordProvenLoad(loads, "a.gguf", Number.NaN)).toBe(loads);
    expect(recordProvenLoad(loads, "a.gguf", 0)).toBe(loads);
  });

  it("la lectura es tolerante: lo roto o raro se descarta", () => {
    expect(parseProvenLoads(null)).toEqual({});
    expect(parseProvenLoads("no es json")).toEqual({});
    expect(parseProvenLoads("[1,2]")).toEqual({});
    expect(parseProvenLoads(JSON.stringify({ "a.gguf": 2048.7, "b.gguf": -1, "c.gguf": "x", "models/d.gguf": 1024 }))).toEqual({
      "a.gguf": 2048,
      "d.gguf": 1024,
    });
  });

  it("tiene un tope de modelos recordados", () => {
    let loads = {};
    for (let i = 0; i < PROVEN_LOADS_MAX + 5; i++) loads = recordProvenLoad(loads, `m${i}.gguf`, 1024);
    expect(Object.keys(loads)).toHaveLength(PROVEN_LOADS_MAX);
    // Un modelo ya conocido sí puede subir su marca con el tope lleno.
    expect(recordProvenLoad(loads, "m0.gguf", 2048)).not.toBe(loads);
  });
});
