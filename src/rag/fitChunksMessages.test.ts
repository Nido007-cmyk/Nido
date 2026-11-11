/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * fitChunksMessages.test.ts — el ajuste de fuentes mide como su juez
 * (2026-11-11).
 *
 * Defecto probado: assembleChatMessages ajustaba los fragmentos midiendo
 * el texto concatenado (una sola plantilla de 50), pero applyContextBudget
 * juzga sistema y mensaje actual por separado (dos plantillas). Un
 * fragmento que caía en esos 50 tokens entraba en el ajuste y luego el
 * turno moría con «exceden nCtx … sin siquiera historial». Reproducido
 * con n_ctx 1024 (el peldaño de emergencia) y una guía en prosa.
 */
import { describe, it, expect } from "vitest";
import { assembleChatMessages, fitChunksToBudget } from "./pure";
import { defaultTokenCounter } from "../agent/loop/contextBudget";

const prose =
  "Para cambiar una llanta, estaciona en un lugar plano y seguro, enciende las luces de emergencia y pon el freno de mano. Afloja las tuercas antes de levantar el coche con el gato. ".repeat(
    12
  );
const chunk = (k: number) => ({
  chunkId: `p${k}`,
  docId: `g${k}`,
  title: "guia.md",
  body: prose.slice(0, 1900),
  score: 1 - k * 0.1,
  matchType: "hybrid" as const,
  sourceKind: "user" as never,
  collectionId: "u",
});

describe("assembleChatMessages — el fragmento que entra cabe de verdad", () => {
  it.each([
    [1024, 256],
    [1280, 256],
    [1536, 384],
    [2048, 512],
    [3072, 512],
  ])("nCtx %i, reserva %i: no lanza y prompt + reserva ≤ nCtx", (nCtx, reserve) => {
    const chunks = [0, 1, 2, 3].map(chunk);
    let fitted: unknown[] = [];
    const msgs = assembleChatMessages(
      "¿cómo cambio una llanta?",
      chunks as never,
      "You are Nido.",
      undefined,
      undefined,
      false,
      { nCtx, reserveGeneration: reserve },
      (f) => {
        fitted = f;
      }
    );
    const used = msgs.reduce((a, m) => a + defaultTokenCounter(m.content), 0);
    expect(used + reserve).toBeLessThanOrEqual(nCtx);
    expect(fitted.length).toBeGreaterThanOrEqual(0);
  });

  it("el caso exacto del defecto: n_ctx 1024 con la guía entra (como resto) y no rompe el turno", () => {
    let fitted: Array<{ truncated?: boolean }> = [];
    expect(() =>
      assembleChatMessages(
        "¿cómo cambio una llanta?",
        [0, 1, 2, 3].map(chunk) as never,
        "You are Nido.",
        undefined,
        undefined,
        false,
        { nCtx: 1024, reserveGeneration: 256 },
        (f) => {
          fitted = f as never;
        }
      )
    ).not.toThrow();
    expect(fitted.length).toBe(1);
  });
});

describe("fitChunksToBudget — sin medida propia, igual que antes", () => {
  it("assemblePrompt (un solo texto) sigue midiendo el texto concatenado", () => {
    const chunks = [0, 1, 2, 3].map(chunk);
    const a = fitChunksToBudget(chunks as never, "You are Nido.\n¿cómo cambio una llanta?", 2048, 512);
    const b = fitChunksToBudget(chunks as never, "You are Nido.\n¿cómo cambio una llanta?", 2048, 512, undefined);
    expect(a.map((c) => c.chunkId)).toEqual(b.map((c) => c.chunkId));
  });

  it("con medida propia, la medida manda", () => {
    const chunks = [0, 1].map(chunk);
    const none = fitChunksToBudget(chunks as never, "x", 4096, 0, () => 5000);
    expect(none).toEqual([]);
    const all = fitChunksToBudget(chunks as never, "x", 4096, 0, () => 10);
    expect(all.length).toBe(2);
  });
});
