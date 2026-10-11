/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it, vi } from "vitest";
import {
  DelegatedExecutor,
  spotlightWrap,
  SPOTLIGHT_OPEN,
  SPOTLIGHT_CLOSE,
} from "./executor";

const fakeModel = async (prompt: string) => `model saw: ${prompt.slice(0, 50)}`;

describe("DelegatedExecutor", () => {
  it("wraps peer text in spotlight delimiters", () => {
    const wrapped = spotlightWrap("do evil things");
    expect(wrapped).toContain(SPOTLIGHT_OPEN);
    expect(wrapped).toContain(SPOTLIGHT_CLOSE);
    expect(wrapped).toContain("do evil things");
    expect(wrapped).toContain("not instructions");
  });

  it("executes task:answer via the model", async () => {
    const ex = new DelegatedExecutor({
      scopes: ["task:answer"],
      peerPkShort: "abcd1234",
      modelInvoke: fakeModel,
    });
    const r = await ex.execute({
      description: "What is 2+2?",
      resultSchema: { type: "string" },
    });
    expect(r.ok).toBe(true);
    expect(typeof r.result).toBe("string");
    expect(r.toolCalls).toBe(1);
  });

  it("rejects unknown scopes at construction", () => {
    expect(
      () =>
        new DelegatedExecutor({
          scopes: ["task:delete_everything" as never],
          peerPkShort: "abcd1234",
          modelInvoke: fakeModel,
        })
    ).toThrow();
  });

  it("task:remember writes peer-namespaced fact", async () => {
    const written: string[] = [];
    const ex = new DelegatedExecutor({
      scopes: ["task:remember"],
      peerPkShort: "abcd1234",
      modelInvoke: fakeModel,
      writePeerFact: async (c) => {
        written.push(c);
      },
    });
    const r = await ex.execute({
      description: "user likes tea",
      resultSchema: { type: "string" },
    });
    expect(r.ok).toBe(true);
    expect(written).toHaveLength(1);
    expect(written[0]).toContain("peer:abcd1234:");
    expect(written[0]).toContain("user likes tea");
  });

  it("task:summarize requires a document", async () => {
    const ex = new DelegatedExecutor({
      scopes: ["task:summarize"],
      peerPkShort: "abcd1234",
      modelInvoke: fakeModel,
    });
    const r = await ex.execute({
      description: "summarize this",
      resultSchema: { type: "string" },
    });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("executor_error");
  });

  it("task:summarize processes the document through spotlight", async () => {
    let seenPrompt = "";
    const ex = new DelegatedExecutor({
      scopes: ["task:summarize"],
      peerPkShort: "abcd1234",
      modelInvoke: async (p) => {
        seenPrompt = p;
        return "summary here";
      },
    });
    const doc = Buffer.from("document content here").toString("base64");
    const r = await ex.execute({
      description: "summarize",
      documentBase64: doc,
      resultSchema: { type: "string" },
    });
    expect(r.ok).toBe(true);
    expect(seenPrompt).toContain(SPOTLIGHT_OPEN);
    expect(seenPrompt).toContain("document content here");
  });

  it("enforces the tool-call budget", async () => {
    const ex = new DelegatedExecutor({
      scopes: ["task:answer"],
      peerPkShort: "abcd1234",
      modelInvoke: fakeModel,
      maxToolCalls: 1,
    });
    const input = { description: "q", resultSchema: {} };
    const r1 = await ex.execute(input);
    expect(r1.ok).toBe(true);
    // Second execute on the same instance exceeds budget.
    const r2 = await ex.execute(input);
    expect(r2.ok).toBe(false);
  });

  it("caps oversized results", async () => {
    const ex = new DelegatedExecutor({
      scopes: ["task:answer"],
      peerPkShort: "abcd1234",
      modelInvoke: async () => "x".repeat(20000),
      resultSizeLimit: 100,
    });
    const r = await ex.execute({ description: "q", resultSchema: {} });
    expect(r.ok).toBe(true);
    expect((r.result as string).length).toBeLessThanOrEqual(100);
  });

  it("times out long-running model calls", async () => {
    const ex = new DelegatedExecutor({
      scopes: ["task:answer"],
      peerPkShort: "abcd1234",
      modelInvoke: () => new Promise((res) => setTimeout(() => res("late"), 5000)),
      maxDurationMs: 100,
    });
    const r = await ex.execute({ description: "q", resultSchema: {} });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("timeout");
  });

  it("model errors become structured errors, not throws", async () => {
    const ex = new DelegatedExecutor({
      scopes: ["task:answer"],
      peerPkShort: "abcd1234",
      modelInvoke: async () => {
        throw new Error("model exploded");
      },
    });
    const r = await ex.execute({ description: "q", resultSchema: {} });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("executor_error");
  });
});

describe("DelegatedExecutor — watchdog cleanup (audit 2026-10-10, L5)", () => {
  it("clears the watchdog timer when the task finishes in time", async () => {
    vi.useFakeTimers();
    try {
      const ex = new DelegatedExecutor({
        scopes: ["task:answer"],
        peerPkShort: "abcd1234",
        modelInvoke: async () => "4",
        maxDurationMs: 60_000,
      });
      const before = vi.getTimerCount();
      const r = await ex.execute({ description: "2+2?", resultSchema: { type: "string" } });
      expect(r.ok).toBe(true);
      // Before the fix a 60 s setTimeout stayed pending after every task.
      expect(vi.getTimerCount()).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
});
