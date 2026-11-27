/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
import { describe, expect, it } from "vitest";
import { advertisedRamGb } from "./deviceRamLabel";

describe("advertisedRamGb (0.1.118)", () => {
  it("lee la cifra de la caja en base decimal o binaria", () => {
    expect(advertisedRamGb(4_000_000_000)).toBe(4);
    expect(advertisedRamGb(4 * 1024 ** 3)).toBe(4);
    expect(advertisedRamGb(8 * 1024 ** 3)).toBe(8);
    expect(advertisedRamGb(12_000_000_000)).toBe(12);
    expect(advertisedRamGb(1.5 * 1024 ** 3)).toBe(1.5);
  });
  it("sin dato devuelve null", () => {
    expect(advertisedRamGb(0)).toBeNull();
    expect(advertisedRamGb(-1)).toBeNull();
    expect(advertisedRamGb(Number.NaN)).toBeNull();
  });
});
