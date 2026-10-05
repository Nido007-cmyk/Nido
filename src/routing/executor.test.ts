import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock resident state actually mutates on load(), same as the real
// LlamaEngine — needed so getModelInfo() correctly reflects what a
// *previous* executeRoutingPlan() call (a separate, earlier "message")
// left loaded, which is exactly what crossMessageModelSwitch depends on.
let mockResidentFilename: string | null = null;
const loadMock = vi.fn(async (filename: string) => {
  mockResidentFilename = filename;
});
const generateMock = vi.fn(async (_opts: any) => "mock answer");
const retrieveMock = vi.fn(async (_query: string) => [] as any[]);
const getModelInfoMock = vi.fn(() =>
  mockResidentFilename ? { filename: mockResidentFilename, nCtx: 4096, nThreads: 4 } : null
);
let mockEmbeddedTemplate = false;
const hasEmbeddedChatTemplateMock = vi.fn(() => mockEmbeddedTemplate);

vi.mock("../inference/LlamaEngine", () => ({
  llamaEngine: {
    load: (filename: string) => loadMock(filename),
    generate: (opts: any) => generateMock(opts),
    getModelInfo: () => getModelInfoMock(),
    hasEmbeddedChatTemplate: () => hasEmbeddedChatTemplateMock(),
  },
}));

vi.mock("../rag/retrieve", () => ({
  retrieve: (query: string) => retrieveMock(query),
}));

import { executeRoutingPlan, ExecutableModel } from "./executor";
import { RoutingPlan } from "./router";

const MODELS: Record<string, ExecutableModel> = {
  phi: { id: "phi", filename: "models/primary-llm.gguf" },
  "qwen-1.5b": {
    id: "qwen-1.5b",
    filename: "models/qwen2.5-1.5b-instruct-q4km.gguf",
    usesChatTemplate: true,
  },
};
const resolveModel = (id: string) => MODELS[id];

function plan(overrides: Partial<RoutingPlan>): RoutingPlan {
  return {
    steps: [],
    selectedModelIds: [],
    estimatedCost: { modelSwitches: 0 },
    fallbackPolicy: "use-default",
    reasonCodes: [],
    ...overrides,
  };
}

beforeEach(() => {
  loadMock.mockClear();
  generateMock.mockClear();
  retrieveMock.mockClear();
  getModelInfoMock.mockClear();
  mockResidentFilename = null;
  generateMock.mockResolvedValue("mock answer");
  retrieveMock.mockResolvedValue([]);
});

describe("executeRoutingPlan", () => {
  it("runs a single generate step against the right model", async () => {
    const p = plan({
      steps: [{ id: "generate-0", type: "generate", modelId: "qwen-1.5b", required: true, maxTokens: 100 }],
      selectedModelIds: ["qwen-1.5b"],
    });
    const result = await executeRoutingPlan(p, { query: "hi" }, resolveModel);
    expect(result.answer).toBe("mock answer");
    expect(loadMock).toHaveBeenCalledWith("models/qwen2.5-1.5b-instruct-q4km.gguf");
    expect(result.stepsExecuted).toBe(1);
    expect(result.modelSwitches).toBe(0);
  });

  it("calls retrieve for a retrieve step and threads its chunks into the prompt/citations", async () => {
    const chunks = [{ chunkId: "c1", docId: "d1", title: "T", body: "B", score: 1, matchType: "hybrid" as const }];
    retrieveMock.mockResolvedValue(chunks);
    const p = plan({
      steps: [
        { id: "retrieve-0", type: "retrieve", required: false },
        { id: "generate-1", type: "generate", modelId: "phi", required: true },
      ],
      selectedModelIds: ["phi"],
    });
    const result = await executeRoutingPlan(p, { query: "what is X" }, resolveModel);
    expect(retrieveMock).toHaveBeenCalledWith("what is X");
    expect(result.citations).toEqual(chunks);
    // assemblePrompt should have received the retrieved chunk's text
    const promptArg = generateMock.mock.calls[0][0].prompt as string;
    expect(promptArg).toContain("B");
  });

  it("reports retrievalAttempted:true when a retrieve step ran (honest no-result signal)", async () => {
    retrieveMock.mockResolvedValue([]);
    const p = plan({
      steps: [
        { id: "retrieve-0", type: "retrieve", required: false },
        { id: "generate-1", type: "generate", modelId: "phi", required: true },
      ],
      selectedModelIds: ["phi"],
    });
    const result = await executeRoutingPlan(p, { query: "what is X" }, resolveModel);
    expect(result.retrievalAttempted).toBe(true);
    // ...and the generate prompt carries the honest no-result nudge.
    const promptArg = generateMock.mock.calls[0][0].prompt as string;
    expect(promptArg).toContain("No relevant sources were found in the offline index");
  });

  it("reports retrievalAttempted:false when no retrieve step ran — no dishonest no-result note", async () => {
    const p = plan({
      steps: [{ id: "generate-0", type: "generate", modelId: "phi", required: true }],
      selectedModelIds: ["phi"],
    });
    const result = await executeRoutingPlan(p, { query: "hey!" }, resolveModel);
    expect(result.retrievalAttempted).toBe(false);
    const promptArg = generateMock.mock.calls[0][0].prompt as string;
    expect(promptArg).not.toContain("No relevant sources were found");
  });

  it("Phi (usesChatTemplate not set) still receives a plain prompt string, unchanged", async () => {
    const p = plan({
      steps: [{ id: "generate-0", type: "generate", modelId: "phi", required: true }],
      selectedModelIds: ["phi"],
    });
    await executeRoutingPlan(p, { query: "hey!" }, resolveModel);
    const call = generateMock.mock.calls[0][0];
    expect(typeof call.prompt).toBe("string");
    expect(call.prompt).toContain("Question: hey!");
    expect(call.messages).toBeUndefined();
  });

  it("Qwen (usesChatTemplate: true) receives a role-separated messages array instead of a prompt string", async () => {
    const p = plan({
      steps: [{ id: "generate-0", type: "generate", modelId: "qwen-1.5b", required: true }],
      selectedModelIds: ["qwen-1.5b"],
    });
    await executeRoutingPlan(p, { query: "hey!", systemPrompt: "Be concise." }, resolveModel);
    const call = generateMock.mock.calls[0][0];
    expect(call.prompt).toBeUndefined();
    expect(Array.isArray(call.messages)).toBe(true);
    expect(call.messages[0].role).toBe("system");
    expect(call.messages[0].content).toContain("Be concise.");
    expect(call.messages[call.messages.length - 1]).toEqual({ role: "user", content: "hey!" });
  });

  it("only switches models (and counts it) when the step's model differs from what's already loaded", async () => {
    const p = plan({
      steps: [
        { id: "verify-setup", type: "generate", modelId: "phi", required: true },
        { id: "verify-0", type: "generate", modelId: "phi", required: true },
        { id: "verify-1", type: "generate", modelId: "qwen-1.5b", required: true },
      ],
      selectedModelIds: ["phi", "qwen-1.5b"],
    });
    const result = await executeRoutingPlan(p, { query: "hi" }, resolveModel);
    // ensureModelLoaded skips calling load() at all when the requested model
    // is already the resident one — the repeated "phi" step costs nothing,
    // only the switch to "qwen-1.5b" actually calls load().
    expect(loadMock).toHaveBeenCalledTimes(2);
    expect(result.modelSwitches).toBe(1);
    // Nothing was resident before this call began (mockResidentFilename
    // reset to null in beforeEach) — a cold start, not a cross-message
    // transition, even though this plan's own execution did switch
    // models internally. modelSwitches and crossMessageModelSwitch are
    // deliberately answering different questions.
    expect(result.crossMessageModelSwitch).toBe(false);
  });

  it("stops immediately and reports stopped:true when shouldStop is already true", async () => {
    const p = plan({
      steps: [{ id: "generate-0", type: "generate", modelId: "phi", required: true }],
    });
    const result = await executeRoutingPlan(p, { query: "hi" }, resolveModel, { shouldStop: () => true });
    expect(result.stopped).toBe(true);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("aborts with a warning rather than throwing when a required step's model can't be resolved", async () => {
    const p = plan({
      steps: [{ id: "generate-0", type: "generate", modelId: "does-not-exist", required: true }],
    });
    const result = await executeRoutingPlan(p, { query: "hi" }, resolveModel);
    expect(result.warnings).toContain("generate-step-failed-no-model");
    expect(result.answer).toBe("");
  });

  it("skips (doesn't abort) when an optional step's model can't be resolved", async () => {
    const p = plan({
      steps: [
        { id: "verify-0", type: "verify", modelId: "does-not-exist", required: false },
        { id: "generate-1", type: "generate", modelId: "phi", required: true },
      ],
    });
    const result = await executeRoutingPlan(p, { query: "hi" }, resolveModel);
    expect(result.answer).toBe("mock answer");
    expect(result.verification.status).toBe("not_applicable");
  });

  it("verification is not_applicable when there's no retrieved evidence, even with a valid verifier model", async () => {
    const p = plan({
      steps: [
        { id: "generate-0", type: "generate", modelId: "phi", required: true },
        { id: "verify-1", type: "verify", modelId: "qwen-1.5b", required: false },
      ],
    });
    const result = await executeRoutingPlan(p, { query: "hi" }, resolveModel);
    expect(result.verification.status).toBe("not_applicable");
    // Only the generate step should have called generate(), not a verify call too.
    expect(generateMock).toHaveBeenCalledTimes(1);
  });

  it("parses a SUPPORTED verdict as passed", async () => {
    const chunks = [{ chunkId: "c1", docId: "d1", title: "T", body: "B", score: 1, matchType: "hybrid" as const }];
    retrieveMock.mockResolvedValue(chunks);
    generateMock.mockResolvedValueOnce("mock answer").mockResolvedValueOnce("SUPPORTED. The claim matches the evidence.");
    const p = plan({
      steps: [
        { id: "retrieve-0", type: "retrieve", required: false },
        { id: "generate-1", type: "generate", modelId: "phi", required: true },
        { id: "verify-2", type: "verify", modelId: "qwen-1.5b", required: false },
      ],
    });
    const result = await executeRoutingPlan(p, { query: "hi" }, resolveModel);
    expect(result.verification.status).toBe("passed");
  });

  it("parses an UNSUPPORTED verdict as failed, and an off-format response as uncertain", async () => {
    const chunks = [{ chunkId: "c1", docId: "d1", title: "T", body: "B", score: 1, matchType: "hybrid" as const }];
    retrieveMock.mockResolvedValue(chunks);
    const p = plan({
      steps: [
        { id: "retrieve-0", type: "retrieve", required: false },
        { id: "generate-1", type: "generate", modelId: "phi", required: true },
        { id: "verify-2", type: "verify", modelId: "qwen-1.5b", required: false },
      ],
    });

    generateMock.mockResolvedValueOnce("mock answer").mockResolvedValueOnce("UNSUPPORTED — no such claim in evidence.");
    let result = await executeRoutingPlan(p, { query: "hi" }, resolveModel);
    expect(result.verification.status).toBe("failed");

    generateMock.mockResolvedValueOnce("mock answer").mockResolvedValueOnce("I think it's probably fine.");
    result = await executeRoutingPlan(p, { query: "hi" }, resolveModel);
    expect(result.verification.status).toBe("uncertain");
  });
});

describe("crossMessageModelSwitch", () => {
  const genPlan = (modelId: string) =>
    plan({ steps: [{ id: "generate-0", type: "generate", modelId, required: true }] });

  it("first request with no resident model: cold start, not a cross-message switch", async () => {
    const result = await executeRoutingPlan(genPlan("phi"), { query: "hi" }, resolveModel);
    expect(result.crossMessageModelSwitch).toBe(false);
  });

  it("Qwen request followed by a Phi request: true", async () => {
    await executeRoutingPlan(genPlan("qwen-1.5b"), { query: "hi" }, resolveModel);
    const result = await executeRoutingPlan(genPlan("phi"), { query: "hi" }, resolveModel);
    expect(result.crossMessageModelSwitch).toBe(true);
  });

  it("Phi followed by Phi: false", async () => {
    await executeRoutingPlan(genPlan("phi"), { query: "hi" }, resolveModel);
    const result = await executeRoutingPlan(genPlan("phi"), { query: "hi" }, resolveModel);
    expect(result.crossMessageModelSwitch).toBe(false);
  });

  it("Phi followed by Qwen: true", async () => {
    await executeRoutingPlan(genPlan("phi"), { query: "hi" }, resolveModel);
    const result = await executeRoutingPlan(genPlan("qwen-1.5b"), { query: "hi" }, resolveModel);
    expect(result.crossMessageModelSwitch).toBe(true);
  });

  it("a failed model load leaves residency unchanged — no false-positive cross-message switch", async () => {
    // Phi is resident from a prior request; this one asks for a model
    // resolveModel can't find at all — ensureModelLoaded never calls
    // load(), so the real resident state (read fresh from
    // getModelInfo(), not assumed) is genuinely unchanged.
    await executeRoutingPlan(genPlan("phi"), { query: "hi" }, resolveModel);
    const result = await executeRoutingPlan(genPlan("does-not-exist"), { query: "hi" }, resolveModel);
    expect(result.warnings).toContain("generate-step-failed-no-model");
    expect(loadMock).toHaveBeenCalledTimes(1); // only the first (Phi) request actually loaded anything
    expect(result.crossMessageModelSwitch).toBe(false);
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Phase 7 timing/residency (modelResidency, modelLoadMs, ttftMs, generationLatencyMs)", () => {
  const genPlan = (modelId: string) =>
    plan({ steps: [{ id: "generate-0", type: "generate", modelId, required: true }] });

  it("cold model load: nothing resident before this request", async () => {
    const result = await executeRoutingPlan(genPlan("phi"), { query: "hi" }, resolveModel);
    expect(result.modelResidency).toBe("cold");
    expect(loadMock).toHaveBeenCalledTimes(1);
  });

  it("warm/resident model: already the resident model, no load() call at all", async () => {
    await executeRoutingPlan(genPlan("phi"), { query: "hi" }, resolveModel);
    loadMock.mockClear();
    const result = await executeRoutingPlan(genPlan("phi"), { query: "hi" }, resolveModel);
    expect(result.modelResidency).toBe("resident");
    expect(result.modelLoadMs).toBe(0);
    expect(loadMock).not.toHaveBeenCalled();
  });

  it("Qwen -> Phi: switched, with a real load() call", async () => {
    await executeRoutingPlan(genPlan("qwen-1.5b"), { query: "hi" }, resolveModel);
    const result = await executeRoutingPlan(genPlan("phi"), { query: "hi" }, resolveModel);
    expect(result.modelResidency).toBe("switched");
    expect(result.modelLoadMs).toBeGreaterThanOrEqual(0);
  });

  it("Phi -> Qwen: switched, with a real load() call", async () => {
    await executeRoutingPlan(genPlan("phi"), { query: "hi" }, resolveModel);
    const result = await executeRoutingPlan(genPlan("qwen-1.5b"), { query: "hi" }, resolveModel);
    expect(result.modelResidency).toBe("switched");
    expect(result.modelLoadMs).toBeGreaterThanOrEqual(0);
  });

  it("ttftMs no longer includes model-load time — a slow load() doesn't inflate it", async () => {
    // A deliberately slow load (simulating a real multi-GB mmap cold
    // start) followed by a fast, immediate first token. If ttftMs were
    // still measured from before load() (the old, conflated behavior),
    // it would be >= the load delay; measured correctly, it's tiny.
    loadMock.mockImplementationOnce(async (filename: string) => {
      await delay(60);
      mockResidentFilename = filename;
    });
    generateMock.mockImplementationOnce(async (opts: any) => {
      opts.onToken?.("hi");
      return "mock answer";
    });

    const result = await executeRoutingPlan(genPlan("phi"), { query: "hi" }, resolveModel);

    expect(result.modelLoadMs).toBeGreaterThanOrEqual(50);
    expect(result.ttftMs).toBeLessThan(30);
  });

  it("generationLatencyMs is the post-first-token portion of the generate() call, not the whole thing", async () => {
    generateMock.mockImplementationOnce(async (opts: any) => {
      opts.onToken?.("h");
      await delay(30);
      opts.onToken?.("i");
      return "mock answer";
    });

    const result = await executeRoutingPlan(genPlan("phi"), { query: "hi" }, resolveModel);

    expect(result.generationLatencyMs).toBeGreaterThanOrEqual(20);
  });

  it("no generate step ran at all: timing fields stay undefined, not zero (an honest 'not measured', not a fabricated fast time)", async () => {
    const result = await executeRoutingPlan(genPlan("does-not-exist"), { query: "hi" }, resolveModel);
    expect(result.modelResidency).toBeUndefined();
    expect(result.modelLoadMs).toBeUndefined();
    expect(result.ttftMs).toBeUndefined();
    expect(result.generationLatencyMs).toBeUndefined();
  });

  it("cancellation (shouldStop already true): no timing fields fabricated", async () => {
    const result = await executeRoutingPlan(genPlan("phi"), { query: "hi" }, resolveModel, { shouldStop: () => true });
    expect(result.stopped).toBe(true);
    expect(result.modelLoadMs).toBeUndefined();
    expect(result.ttftMs).toBeUndefined();
  });
});

describe("prompt format selection", () => {
  const generatePlan = (modelId: string) =>
    plan({ steps: [{ id: "generate-0", type: "generate", modelId, required: true, maxTokens: 64 }], selectedModelIds: [modelId] });

  beforeEach(() => {
    mockEmbeddedTemplate = false;
    hasEmbeddedChatTemplateMock.mockClear();
  });

  it('"if-embedded" uses the model\'s own chat template when its GGUF ships one', async () => {
    mockEmbeddedTemplate = true;
    const models = { phi: { id: "phi", filename: "models/primary-llm.gguf", usesChatTemplate: "if-embedded" as const } };
    const result = await executeRoutingPlan(generatePlan("phi"), { query: "How do vaccines work?" }, (id) => models[id as "phi"]);
    const opts = generateMock.mock.calls[0][0];
    expect(opts.messages).toBeDefined();
    expect(opts.prompt).toBeUndefined();
    expect(result.promptFormat).toBe("chat-template");
  });

  it('"if-embedded" falls back to the plain prompt when the GGUF has no template', async () => {
    mockEmbeddedTemplate = false;
    const models = { x: { id: "x", filename: "models/x.gguf", usesChatTemplate: "if-embedded" as const } };
    const result = await executeRoutingPlan(generatePlan("x"), { query: "How do vaccines work?" }, (id) => models[id as "x"]);
    expect(generateMock.mock.calls[0][0].prompt).toBeDefined();
    expect(result.promptFormat).toBe("plain");
  });

  it("explicit flags ignore the GGUF check, so live chat formatting is unchanged", async () => {
    mockEmbeddedTemplate = true;
    const phiResult = await executeRoutingPlan(generatePlan("phi"), { query: "hi" }, resolveModel);
    expect(generateMock.mock.calls[0][0].prompt).toBeDefined();
    expect(phiResult.promptFormat).toBe("plain");

    mockEmbeddedTemplate = false;
    const qwenResult = await executeRoutingPlan(generatePlan("qwen-1.5b"), { query: "hi" }, resolveModel);
    expect(generateMock.mock.calls[1][0].messages).toBeDefined();
    expect(qwenResult.promptFormat).toBe("chat-template");
    expect(hasEmbeddedChatTemplateMock).not.toHaveBeenCalled();
  });
});
