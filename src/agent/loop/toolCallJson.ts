/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * toolCallJson.ts — grammar-constrained pseudo-tool-calls (P2.5).
 *
 * The 0.5B model must currently emit tool calls as ```tool JSON markdown
 * blocks parsed by regex (BUG-4: it often fails to). This module adds a
 * constrained alternative: ask for ONLY the JSON tool call with
 * response_format=json_schema (P1.1 wiring) at the structured preset
 * (P1.2), then validate in code (P1.5) and dispatch.
 *
 * Per the 2024-2026 research: do NOT use llama.rn's native Jinja
 * tool-calling templates at 0.5B (BFCL ~10-25% reliability sub-1B).
 * Grammar-constrained pseudo-calls + code dispatch + validators instead.
 *
 * HONESTY NOTE (P1.1): whether the vendored llama.rn build actually
 * enforces the grammar is unverified on-device. The code validator is
 * the enforcement layer; the grammar is a hint that makes valid output
 * likely. Callers must treat null as "fall back to the legacy path".
 *
 * Migration status: the regex parser (parseToolCalls) remains the primary
 * extraction AND the backstop. This constrained path is used on the
 * BUG-4 recovery path (model failed to emit any tool call but intent
 * needs tools). Full replacement of the regex protocol awaits on-device
 * proof that grammar enforcement works.
 *
 * Pure except generateToolCallJson (needs an engine). Fully unit-tested.
 */

import type { ChatMessageInput } from "../../inference/LlamaEngine";
import { validateStructuredOutput, withBoundedRepair } from "./structuredOutput";
import type { ParsedToolCall } from "./agentLoop";

/** Minimal engine surface needed: generate with responseFormat. */
export interface ToolCallEngine {
  generate(args: {
    messages: ChatMessageInput[];
    nPredict?: number;
    samplingPreset?: "structured" | "factual" | "chat";
    responseFormat?: { type: "json_object" | "json_schema"; json_schema?: { schema: object } };
    telemetryContext?: { taskType?: string };
  }): Promise<string>;
}

export const TOOL_CALL_JSON_SCHEMA = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", description: "Tool name, exactly as listed" },
    arguments: { type: "object", description: "Tool arguments object" },
  },
  additionalProperties: false,
} as const;

/**
 * Builds the minimal prompt for a tool-call-only generation. Terse by
 * design: the 0.5B follows short contracts better than prose (P1.3).
 * Pure.
 */
export function buildToolCallMessages(userText: string, toolNames: string[]): ChatMessageInput[] {
  return [
    {
      role: "system",
      content:
        "Emit ONLY a JSON object with the tool call, no prose, no markdown. " +
        `Schema: {"name": "<tool>", "arguments": {}}. Available tools: ${toolNames.join(", ")}.`,
    },
    { role: "user", content: userText },
  ];
}

function toParsedToolCall(value: { name: string; arguments?: unknown }): ParsedToolCall {
  return {
    name: value.name,
    arguments:
      value.arguments && typeof value.arguments === "object"
        ? (value.arguments as Record<string, unknown>)
        : {},
  };
}

/**
 * Generates a single tool call via constrained decoding. Returns the
 * validated call, or null when the model couldn't produce one
 * (caller falls back to the legacy regex path). At most 2 generations.
 */
export async function generateToolCallJson(
  engine: ToolCallEngine,
  args: { userText: string; toolNames: string[]; nPredict?: number }
): Promise<ParsedToolCall | null> {
  const messages = buildToolCallMessages(args.userText, args.toolNames);
  const nPredict = args.nPredict ?? 256;

  const attempt = () =>
    engine.generate({
      messages,
      nPredict,
      samplingPreset: "structured",
      responseFormat: { type: "json_schema", json_schema: { schema: TOOL_CALL_JSON_SCHEMA } },
      telemetryContext: { taskType: "tool-call-json" },
    });

  const validate = (text: string) => {
    const v = validateStructuredOutput<{ name: string; arguments?: unknown }>(
      { required: ["name"], properties: { name: "string" } },
      text.trim()
    );
    if (!v.ok || !v.value || typeof v.value.name !== "string") {
      return { ok: false as const, error: v.ok ? "missing/invalid 'name'" : v.error };
    }
    return { ok: true as const, value: toParsedToolCall(v.value) };
  };

  return withBoundedRepair({
    attempt,
    validate,
    repair: (first, error) =>
      engine.generate({
        messages: [
          ...messages,
          { role: "assistant", content: first },
          {
            role: "user",
            content: `Invalid tool call (${error}). Emit ONLY the corrected JSON object, no prose.`,
          },
        ],
        nPredict,
        samplingPreset: "structured",
        responseFormat: { type: "json_schema", json_schema: { schema: TOOL_CALL_JSON_SCHEMA } },
        telemetryContext: { taskType: "tool-call-json-repair" },
      }),
    fallback: null,
  });
}
