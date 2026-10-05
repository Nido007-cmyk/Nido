import { describe, it, expect } from "vitest";
import { matchModels, parseEvalRequest, resolveEvalRequest } from "./deviceEvalRequest.pure";
import { EVAL_SET } from "./evalSet";
import { MODEL_CATALOG, CatalogModel } from "../models/manifest";

const PHI = MODEL_CATALOG.find((m) => m.id === "phi-3.5-mini-instruct-q4km")!;
const QWEN = MODEL_CATALOG.find((m) => m.id === "qwen2.5-1.5b-instruct-q4km")!;
const QWEN_7B = MODEL_CATALOG.find((m) => m.id === "qwen2.5-7b-instruct-q4km")!;
const INSTELLA: CatalogModel = { ...PHI, id: "hf-amd-instella-moe-16b-a3b-q2_k", label: "Instella-MoE-16B-A3B Q2_K", filename: "models/instella.gguf", capabilities: undefined };
const installed = [PHI, QWEN, QWEN_7B, INSTELLA];

describe("parseEvalRequest", () => {
  it("accepts a well-formed request", () => {
    expect(parseEvalRequest('{"requestId":"req-1","models":["phi-3.5"],"adaptive":true,"queries":["greeting-1"]}')).toEqual({
      requestId: "req-1",
      models: ["phi-3.5"],
      adaptive: true,
      queries: ["greeting-1"],
    });
  });

  it("rejects bad ids and bad field types", () => {
    expect(() => parseEvalRequest('{"requestId":"../x"}')).toThrow(/requestId/);
    expect(() => parseEvalRequest('{"requestId":"r","models":"phi"}')).toThrow(/models/);
    expect(() => parseEvalRequest('{"requestId":"r","models":[""]}')).toThrow(/models/);
    expect(() => parseEvalRequest('{"requestId":"r","adaptive":"yes"}')).toThrow(/adaptive/);
    expect(() => parseEvalRequest("not json")).toThrow();
  });
});

describe("matchModels", () => {
  it("prefers an exact id, otherwise matches id or label fragments ignoring punctuation", () => {
    expect(matchModels(QWEN.id, installed)).toEqual([QWEN]);
    expect(matchModels("phi-3.5", installed)).toEqual([PHI]);
    expect(matchModels("qwen2.5-1.5b", installed)).toEqual([QWEN]);
    expect(matchModels("instella-moe", installed)).toEqual([INSTELLA]);
    expect(matchModels("qwen2.5", installed)).toEqual([QWEN, QWEN_7B]);
    expect(matchModels("llama", installed)).toEqual([]);
  });
});

describe("resolveEvalRequest", () => {
  const resolve = (req: object) => resolveEvalRequest({ requestId: "r", ...req }, installed, EVAL_SET, "Adaptive");

  it("defaults to every installed model plus adaptive, all queries", () => {
    const r = resolve({});
    expect(r.ok && r.configs.map((c) => (c.kind === "model" ? c.modelId : "adaptive"))).toEqual([PHI.id, QWEN.id, QWEN_7B.id, INSTELLA.id, "adaptive"]);
    expect(r.ok && r.queries).toHaveLength(EVAL_SET.length);
  });

  it("runs only what was selected", () => {
    const models = resolve({ models: ["qwen2.5-1.5b", "phi-3.5"] });
    expect(models.ok && models.configs.map((c) => c.label)).toEqual([QWEN.label, PHI.label]);
    const adaptive = resolve({ adaptive: true });
    expect(adaptive.ok && adaptive.configs.map((c) => c.kind)).toEqual(["adaptive"]);
    const both = resolve({ models: ["instella"], adaptive: true });
    expect(both.ok && both.configs.map((c) => c.kind)).toEqual(["model", "adaptive"]);
  });

  it("fails loudly on unknown or ambiguous model selectors", () => {
    expect(resolve({ models: ["llama"] })).toEqual({ ok: false, error: 'model "llama" matches no installed model' });
    const amb = resolve({ models: ["qwen2.5"] });
    expect(!amb.ok && amb.error).toMatch(/ambiguous.*qwen2\.5-1\.5b.*qwen2\.5-7b/);
  });

  it("filters queries by id or category, rejecting unknown ones", () => {
    const r = resolve({ queries: ["greeting-1", "reasoning"] });
    expect(r.ok && r.queries.map((q) => q.id)).toEqual(["greeting-1", "reasoning-1", "reasoning-2", "reasoning-3"]);
    expect(resolve({ queries: ["nope"] })).toEqual({ ok: false, error: "unknown query id or category: nope" });
  });

  it("still runs adaptive when no model is installed, matching the Evaluation screen", () => {
    const r = resolveEvalRequest({ requestId: "r" }, [], EVAL_SET, "A");
    expect(r.ok && r.configs.map((c) => c.kind)).toEqual(["adaptive"]);
  });
});
