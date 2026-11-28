/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
import { describe, expect, it } from "vitest";
import { cpuClusters, formatCpuClusters } from "./cpuTopology";

describe("núcleos por frecuencia (0.1.121)", () => {
  it("la Tab A9+ (Snapdragon 695): 2 rápidos y 6 de ahorro", () => {
    const tab = [1804800, 1804800, 1804800, 1804800, 1804800, 1804800, 2208000, 2208000];
    const c = cpuClusters(tab);
    expect(c).toEqual([
      { count: 2, maxGHz: 2.2 },
      { count: 6, maxGHz: 1.8 },
    ]);
    expect(formatCpuClusters(c, ",")).toBe("2 × 2,2 GHz + 6 × 1,8 GHz");
  });
  it("núcleos sin lectura no cuentan; sin datos, nada", () => {
    expect(cpuClusters([0, 2000000, -1])).toEqual([{ count: 1, maxGHz: 2 }]);
    expect(cpuClusters(null)).toEqual([]);
  });
});
