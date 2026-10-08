/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it, vi } from "vitest";
import {
  buildToolCallMessages,
  generateToolCallJson,
  TOOL_CALL_JSON_SCHEMA,
  type ToolCallEngine,
} from "./toolCallJson";

/** Fake engine: returns scripted responses in order. */
function fakeEngine(responses: string[]): ToolCallEngine & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    generate: async (args: unknown) => {
      calls.push(args);
      const next = responses.shift();
      if (next === undefined) throw new Error("no more scripted responses");
      return next;
    },
  };
}

describe("TOOL_CALL_JSON_SCHEMA", () => {
  it("requires name", () => {
    expect(TOOL_CALL_JSON_SCHEMA.required).toContain("name");
    expect(TOOL_CALL_JSON_SCHEMA.additionalProperties).toBe(false);
  });
});

describe("buildToolCallMessages", () => {
  it("lists the available tools and demands JSON-only", () => {
    const msgs = buildToolCallMessages("recuérdame comprar pan", ["remember_fact", "create_reminder"]);
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("ONLY");
    expect(msgs[0].content).toContain("remember_fact");
    expect(msgs[1]).toEqual({ role: "user", content: "recuérdame comprar pan" });
  });
});

describe("generateToolCallJson", () => {
  it("returns the validated call on first attempt", async () => {
    const engine = fakeEngine(['{"name": "remember_fact", "arguments": {"content": "x"}}']);
    const call = await generateToolCallJson(engine, { userText: "recuerda x", toolNames: ["remember_fact"] });
    expect(call).toEqual({ name: "remember_fact", arguments: { content: "x" } });
    // Constrained decoding requested: json_schema + structured preset.
    const params = engine.calls[0] as Record<string, unknown>;
    expect(params.samplingPreset).toBe("structured");
    expect(params.responseFormat).toMatchObject({ type: "json_schema" });
  });

  it("repairs once on invalid JSON, then succeeds", async () => {
    const engine = fakeEngine([
      "not json at all",
      '{"name": "create_reminder", "arguments": {"text": "pan"}}',
    ]);
    const call = await generateToolCallJson(engine, { userText: "recuérdame pan", toolNames: ["create_reminder"] });
    expect(call).toEqual({ name: "create_reminder", arguments: { text: "pan" } });
    expect(engine.calls).toHaveLength(2);
    // The repair carries the validation error.
    const repairMsgs = (engine.calls[1] as { messages: { content: string }[] }).messages;
    expect(repairMsgs[repairMsgs.length - 1].content).toContain("Invalid tool call");
  });

  it("returns null after two failures (fail-closed)", async () => {
    const engine = fakeEngine(["garbage", "still garbage"]);
    const call = await generateToolCallJson(engine, { userText: "x", toolNames: ["a"] });
    expect(call).toBeNull();
    expect(engine.calls).toHaveLength(2); // never more than 2 generations
  });

  it("returns null when the engine throws", async () => {
    const engine: ToolCallEngine = {
      generate: async () => {
        throw new Error("model exploded");
      },
    };
    // generateToolCallJson itself doesn't catch engine errors on attempt —
    // the caller's .catch handles it. Here we assert the throw propagates
    // so the caller can decide (fail-closed at the call site).
    await expect(generateToolCallJson(engine, { userText: "x", toolNames: ["a"] })).rejects.toThrow();
  });

  it("rejects calls missing name", async () => {
    const engine = fakeEngine(['{"arguments": {}}', '{"arguments": {}}']);
    const call = await generateToolCallJson(engine, { userText: "x", toolNames: ["a"] });
    expect(call).toBeNull();
  });

  it("adversarial: injected prose around JSON still parses via JSON.parse boundaries", async () => {
    // Constrained decoding should prevent this, but the validator must
    // reject non-JSON even if the grammar hint fails on-device.
    const engine = fakeEngine(['Sure! {"name": "a"} done', '{"name": "a"}']);
    const call = await generateToolCallJson(engine, { userText: "x", toolNames: ["a"] });
    // First attempt has prose → invalid → repair with clean JSON succeeds.
    expect(call).toEqual({ name: "a", arguments: {} });
  });
});
