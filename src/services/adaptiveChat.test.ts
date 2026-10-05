import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RoutingPreset } from "../routing/types";

let mockResidentFilename: string | null = null;
const loadMock = vi.fn(async (filename: string) => {
  mockResidentFilename = filename;
});
const generateMock = vi.fn(async (_opts: any) => "mock answer");
const retrieveMock = vi.fn(async (_query: string) => [] as any[]);
const statusAllMock = vi.fn(async () => [] as any[]);
const getRoutingPresetMock = vi.fn(async (): Promise<RoutingPreset> => "balanced");
const getModelRoleAssignmentsMock = vi.fn(async () => ({}) as Record<string, string>);
const getActiveModelIdMock = vi.fn(async (_kind: string) => "phi-3.5-mini-instruct-q4km");
const getDeviceTotalRamBytesMock = vi.fn(() => 8 * 1024 * 1024 * 1024);

vi.mock("../inference/LlamaEngine", () => ({
  llamaEngine: {
    load: (filename: string) => loadMock(filename),
    generate: (opts: any) => generateMock(opts),
    getModelInfo: () =>
      mockResidentFilename ? { filename: mockResidentFilename, nCtx: 4096, nThreads: 4 } : null,
  },
}));

vi.mock("../rag/retrieve", () => ({
  retrieve: (query: string) => retrieveMock(query),
}));

vi.mock("../models/ModelManager", () => ({
  ModelManager: class {
    statusAll() {
      return statusAllMock();
    }
  },
}));

vi.mock("../models/settings", () => ({
  getRoutingPreset: () => getRoutingPresetMock(),
  getModelRoleAssignments: () => getModelRoleAssignmentsMock(),
  getActiveModelId: (kind: string) => getActiveModelIdMock(kind),
}));

vi.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => getDeviceTotalRamBytesMock(),
}));

import { runAdaptiveChat } from "./adaptiveChat";
import { MODEL_CATALOG } from "../models/manifest";

const PHI = MODEL_CATALOG.find((m) => m.id === "phi-3.5-mini-instruct-q4km")!;
const QWEN_FAST = MODEL_CATALOG.find((m) => m.id === "qwen2.5-1.5b-instruct-q4km")!;
const QWEN_7B = MODEL_CATALOG.find((m) => m.id === "qwen2.5-7b-instruct-q4km")!;

function statusOf(model: typeof PHI, present: boolean) {
  return { asset: model, present, sizeOnDiskBytes: present ? model.sizeBytes : 0, checksumOk: null };
}

beforeEach(() => {
  loadMock.mockClear();
  generateMock.mockClear();
  retrieveMock.mockClear();
  mockResidentFilename = null;
  statusAllMock.mockReset();
  getRoutingPresetMock.mockReset().mockResolvedValue("balanced");
  getModelRoleAssignmentsMock.mockReset().mockResolvedValue({});
  getActiveModelIdMock.mockReset().mockResolvedValue("phi-3.5-mini-instruct-q4km");
  getDeviceTotalRamBytesMock.mockReset().mockReturnValue(8 * 1024 * 1024 * 1024);
  generateMock.mockResolvedValue("mock answer");
  retrieveMock.mockResolvedValue([]);
});

describe("runAdaptiveChat", () => {
  it("greeting: no retrieval, routes to the fast-role model when installed", async () => {
    statusAllMock.mockResolvedValue([statusOf(PHI, true), statusOf(QWEN_FAST, true)]);
    const result = await runAdaptiveChat({ query: "hey, what's up?" }, 512);

    expect(result.taskType).toBe("greeting");
    expect(retrieveMock).not.toHaveBeenCalled();
    expect(result.citations).toEqual([]);
    expect(result.plan.steps.find((s) => s.type === "generate")?.modelId).toBe(QWEN_FAST.id);
    expect(result.modelUsed?.id).toBe(QWEN_FAST.id);
    expect(loadMock).toHaveBeenCalledWith(QWEN_FAST.filename);
  });

  it("simple/chat request uses the fast-role model when installed, and does retrieve", async () => {
    statusAllMock.mockResolvedValue([statusOf(PHI, true), statusOf(QWEN_FAST, true)]);
    retrieveMock.mockResolvedValue([
      { chunkId: "c1", docId: "d1", title: "T", body: "B", score: 1, matchType: "hybrid" as const },
    ]);
    const result = await runAdaptiveChat({ query: "tell me a fun fact" }, 512);

    expect(result.taskType).toBe("chat");
    expect(retrieveMock).toHaveBeenCalled();
    expect(result.plan.steps.find((s) => s.type === "generate")?.modelId).toBe(QWEN_FAST.id);
  });

  it("complex/research request routes to the reasoning-role model (under the research preset — reasoning isn't a role balanced/simple even declare)", async () => {
    // Phi is curated for BOTH "general" and "reasoning" (manifest.ts), so
    // with Phi present resolveModelForRole's curated-match would pick it
    // for "reasoning" too (first match by catalog order) — this device
    // only has the dedicated reasoning-tier model installed, so the
    // resolution is unambiguous.
    statusAllMock.mockResolvedValue([statusOf(QWEN_FAST, true), statusOf(QWEN_7B, true)]);
    getRoutingPresetMock.mockResolvedValue("research");
    const result = await runAdaptiveChat(
      { query: "Research the long-term economic implications of large-scale nuclear power adoption over the next two decades" },
      512
    );

    expect(result.taskType).toBe("research");
    expect(result.plan.steps.find((s) => s.type === "generate")?.modelId).toBe(QWEN_7B.id);
    expect(result.modelUsed?.id).toBe(QWEN_7B.id);
  });

  it("falls back gracefully when the preferred role's model isn't installed, rather than producing no answer", async () => {
    // Only Phi present — no dedicated "fast" or "reasoning" model on disk.
    statusAllMock.mockResolvedValue([statusOf(PHI, true), statusOf(QWEN_FAST, false), statusOf(QWEN_7B, false)]);
    const result = await runAdaptiveChat({ query: "hey there" }, 512);

    expect(result.plan.steps.find((s) => s.type === "generate")?.modelId).toBe(PHI.id);
    expect(result.answer).toBe("mock answer");
    expect(result.warnings).not.toContain("generate-step-failed-no-model");
  });

  it("model switch across two requests releases/reloads via the same LlamaEngine.load, and modelSwitches reflects within-plan switches", async () => {
    statusAllMock.mockResolvedValue([statusOf(PHI, true), statusOf(QWEN_FAST, true)]);

    const greeting = await runAdaptiveChat({ query: "hey!" }, 512);
    expect(greeting.plan.steps.find((s) => s.type === "generate")?.modelId).toBe(QWEN_FAST.id);
    expect(loadMock).toHaveBeenLastCalledWith(QWEN_FAST.filename);

    const research = await runAdaptiveChat(
      { query: "Research the environmental and economic implications of nuclear power adoption over the next two decades" },
      512
    );
    // "balanced" preset (the default in this test) doesn't declare a
    // "reasoning" role slot at all (see profiles.ts's PRESET_DEFINITIONS —
    // only "research" preset does), so router.ts's role-fallback chain
    // resolves to "general" (Phi) here regardless of whether a dedicated
    // reasoning-tier model is installed. Still a genuine model switch from
    // the greeting's fast-role Qwen, exercising the real LlamaEngine.load()
    // switch path across two separate requests.
    expect(loadMock).toHaveBeenLastCalledWith(PHI.filename);
    // A single-generate-step plan never reports a within-plan switch —
    // that's a fresh executeRoutingPlan() call each time (see
    // adaptiveChat.ts's own doc comment on this), not "no switch happened."
    expect(research.modelSwitches).toBe(0);
    // crossMessageModelSwitch is the field that actually answers "did the
    // model change since the last request" — true here (Qwen -> Phi),
    // read from LlamaEngine's real resident state, not assumed.
    expect(research.crossMessageModelSwitch).toBe(true);
  });

  it("cancellation: shouldStop already true means the model is never even loaded", async () => {
    statusAllMock.mockResolvedValue([statusOf(PHI, true)]);
    const result = await runAdaptiveChat({ query: "hey!" }, 512, { shouldStop: () => true });

    expect(result.stopped).toBe(true);
    expect(loadMock).not.toHaveBeenCalled();
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("no models installed at all: no throw, empty answer, reasonCodes explain why (ChatScreen falls back on empty answer alone, not on `warnings` — see its own comment)", async () => {
    statusAllMock.mockResolvedValue([statusOf(PHI, false), statusOf(QWEN_FAST, false)]);
    getActiveModelIdMock.mockResolvedValue(null as any);
    const result = await runAdaptiveChat({ query: "hey!" }, 512);

    // planRoute never builds a generate step at all here (no model resolves
    // to any role), so there's nothing for the executor to warn about —
    // `warnings` legitimately stays empty. The router's own reasonCodes are
    // where "nothing was available" actually gets recorded.
    expect(result.answer).toBe("");
    expect(result.plan.reasonCodes).toContain("generate:no-model-available");
    expect(result.plan.steps.find((s) => s.type === "generate")).toBeUndefined();
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("propagates onToken/onStepStart callbacks through to the executor", async () => {
    statusAllMock.mockResolvedValue([statusOf(PHI, true)]);
    const onStepStart = vi.fn();
    const onToken = vi.fn();
    await runAdaptiveChat({ query: "hey!" }, 512, { onToken, onStepStart });
    expect(onStepStart).toHaveBeenCalled();
  });
});
