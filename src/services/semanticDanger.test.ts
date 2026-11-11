// 0.1.93 — la capa por significado con el motor del teléfono: nunca lanza, nunca abre.
import { describe, expect, it, vi } from "vitest";

vi.mock("../rag/embed", () => ({ embeddingEngine: { embedQueryTagged: async () => ({ vector: new Float32Array(0), modelSha256: null }) } }));

import exam from "../routing/__fixtures__/semanticGateExam.json";
import { decodeFloat32 } from "../routing/semanticGate";
import { SEMANTIC_GATE_PROBE_TEXT, SEMANTIC_GATE_WEIGHTS } from "../routing/semanticGateWeights";
import { createSemanticDangerChecker } from "./semanticDanger";

type Row = { text: string; danger: boolean; score: number; vec: string };
const E5 = "802c868f57ccddd2e0c80645c3db1cb96a1aa50986a057cbaee2526f6e474cde";
const rows = (exam as Record<string, Row[]>)[E5];
const closing = rows.find((r) => r.danger && r.score > 0.5)!;
const open = rows.find((r) => !r.danger && r.score < -0.5)!;

function engine(opts: { probe?: Float32Array; sha?: string | null; fail?: boolean } = {}) {
  const calls: string[] = [];
  return {
    calls,
    embedQueryTagged: async (text: string) => {
      calls.push(text);
      if (opts.fail) throw new Error("motor sin cargar");
      const sha = opts.sha === undefined ? E5 : opts.sha;
      if (text === SEMANTIC_GATE_PROBE_TEXT) return { vector: opts.probe ?? decodeFloat32(SEMANTIC_GATE_WEIGHTS[E5].probe), modelSha256: sha };
      const row = rows.find((r) => r.text === text)!;
      return { vector: decodeFloat32(row.vec), modelSha256: sha };
    },
  };
}

describe("capa por significado con el motor", () => {
  it("con paridad: cierra lo que es de salud y deja pasar lo corriente", async () => {
    const e = engine();
    const c = createSemanticDangerChecker(e);
    expect(await c.check(closing.text)).toBe(true);
    expect(await c.check(open.text)).toBe(false);
    // La frase de paridad se pide una sola vez por modelo.
    expect(e.calls.filter((t) => t === SEMANTIC_GATE_PROBE_TEXT)).toHaveLength(1);
  });

  it("la misma pregunta dos veces en el turno no vuelve al motor", async () => {
    const e = engine();
    const c = createSemanticDangerChecker(e);
    await c.check(closing.text);
    const n = e.calls.length;
    expect(await c.check(closing.text)).toBe(true);
    expect(e.calls.length).toBe(n);
  });

  it("sin paridad (el motor da otro vector para la frase conocida): la capa se apaga", async () => {
    const c = createSemanticDangerChecker(engine({ probe: decodeFloat32(open.vec) }));
    expect(await c.check(closing.text)).toBe(false);
  });

  it("modelo sin pesos, motor sin modelo o motor que falla: «no lo sé», sin lanzar", async () => {
    expect(await createSemanticDangerChecker(engine({ sha: "f".repeat(64) })).check(closing.text)).toBe(false);
    expect(await createSemanticDangerChecker(engine({ sha: null })).check(closing.text)).toBe(false);
    expect(await createSemanticDangerChecker(engine({ fail: true })).check(closing.text)).toBe(false);
    expect(await createSemanticDangerChecker(engine()).check("   ")).toBe(false);
  });
});
