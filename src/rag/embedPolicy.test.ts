/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { embeddingIdleUnloadDue } from "./embedPolicy";

const MIN = 60_000;

describe("embeddingIdleUnloadDue (optimización 2026-11-08, fase 4)", () => {
  it("sin uso registrado nunca se descarga", () => {
    expect(embeddingIdleUnloadDue(100 * MIN, null, null, 10 * MIN)).toBe(false);
  });

  it("con uso reciente no se descarga", () => {
    expect(embeddingIdleUnloadDue(20 * MIN, 15 * MIN, null, 10 * MIN)).toBe(false);
  });

  it("inactivo más que el umbral y sin fondo reciente: se descarga", () => {
    expect(embeddingIdleUnloadDue(30 * MIN, 15 * MIN, null, 10 * MIN)).toBe(true);
    expect(embeddingIdleUnloadDue(30 * MIN, 15 * MIN, 5 * MIN, 10 * MIN)).toBe(true);
  });

  it("el fondo reciente protege la ventana aunque el uso sea viejo", () => {
    expect(embeddingIdleUnloadDue(30 * MIN, 5 * MIN, 25 * MIN, 10 * MIN)).toBe(false);
  });

  it("el borde exacto cuenta como vencido", () => {
    expect(embeddingIdleUnloadDue(25 * MIN, 15 * MIN, null, 10 * MIN)).toBe(true);
  });
});
