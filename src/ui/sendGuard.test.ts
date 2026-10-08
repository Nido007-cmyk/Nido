/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi } from "vitest";
import { SendGuard, runGuardedSend } from "./sendGuard";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("SendGuard — synchronous in-flight guard for ChatScreen.send()", () => {
  it("first acquire wins; idle guard releases cleanly", () => {
    const guard = new SendGuard();
    expect(guard.isActive).toBe(false);
    expect(guard.tryAcquire()).toBe(true);
    expect(guard.isActive).toBe(true);
    guard.release();
    expect(guard.isActive).toBe(false);
  });

  it("second acquire while in flight is rejected — the double-tap case", () => {
    const guard = new SendGuard();
    expect(guard.tryAcquire()).toBe(true);
    // Second tap in the same tick (before any await yields): rejected.
    expect(guard.tryAcquire()).toBe(false);
    guard.release();
  });

  it("release is idempotent — releasing an idle guard is a no-op", () => {
    const guard = new SendGuard();
    guard.release();
    expect(guard.tryAcquire()).toBe(true);
  });

  it("runGuardedSend: error inside work still releases the guard (no permanent block)", async () => {
    const guard = new SendGuard();
    // The error propagates to the caller (ChatScreen's own catch handles it),
    // but the finally must have released the guard first.
    await expect(
      runGuardedSend(guard, async () => {
        throw new Error("session creation failed");
      })
    ).rejects.toThrow("session creation failed");
    expect(guard.isActive).toBe(false);
    // Retry must be allowed after the error.
    const r2 = await runGuardedSend(guard, async () => "ok");
    expect(r2).toEqual({ ran: true, value: "ok" });
    expect(guard.isActive).toBe(false);
  });

  it("runGuardedSend: early return inside work still releases the guard", async () => {
    const guard = new SendGuard();
    // Mirrors the self-knowledge early-return branch of ChatScreen.send():
    // it returns before the general finally would run.
    const r = await runGuardedSend(guard, async () => {
      return; // eslint-disable-line no-useless-return
    });
    expect(r.ran).toBe(true);
    expect(guard.isActive).toBe(false);
  });
});

/**
 * Integration assertion through the real send path protocol.
 *
 * ChatScreen.tsx cannot be rendered in this suite (no React Native renderer),
 * so this mirrors its send() entry exactly — the three-line protocol it runs
 * verbatim (stale `generating` closure check → synchronous tryAcquire → outer
 * try/finally release) — with a realistic send body (persist user message,
 * run generation, early-return branch like the self-knowledge path).
 * The counters stand in for persistMessage + the LLM generation: one human
 * send action must produce at most one persisted message and one generation.
 */
describe("send path — double-submit invariant (mirrors ChatScreen.send protocol)", () => {
  interface SendHarness {
    guard: SendGuard;
    /** Simulates closure-captured `generating` React state (stale between taps). */
    generating: boolean;
    persisted: number;
    generations: number;
    /** send body that mirrors ChatScreen.send: persists, generates, releases. */
    send: (input: string) => Promise<void>;
  }

  function makeHarness(): SendHarness {
    const guard = new SendGuard();
    const h: SendHarness = {
      guard,
      generating: false,
      persisted: 0,
      generations: 0,
      send: async (input: string) => {
        const query = input.trim();
        // Exact protocol line 1 from ChatScreen.send (stale-closure state check).
        if (!query || h.generating) return;
        // Exact protocol line 2: synchronous guard consulted before any await.
        if (!guard.tryAcquire()) return;
        // Exact protocol line 3: outer try/finally release.
        try {
          // Body mirrors send(): clear input, mark generating, awaits.
          h.generating = true; // would be setGenerating(true) — batched, invisible to the other tap
          await flush(); // await createSession / persistMessage
          h.persisted += 1;
          if (query.startsWith("!kb")) {
            return; // self-knowledge early-return branch
          }
          await flush(); // await generation
          h.generations += 1;
        } finally {
          h.generating = false;
          guard.release();
        }
      },
    };
    return h;
  }

  it("double-tap in the same tick → one persisted message, one generation", async () => {
    const h = makeHarness();
    // Both taps fire before either body reaches its first await: with the old
    // closure-state guard both would proceed; the ref guard admits only one.
    const t1 = h.send("hello");
    const t2 = h.send("hello");
    await Promise.all([t1, t2]);
    expect(h.persisted).toBe(1);
    expect(h.generations).toBe(1);
  });

  it("rapid taps during an active generation → one persisted message, one generation", async () => {
    const h = makeHarness();
    const t1 = h.send("hello");
    // Generation is in flight (guard held); later taps must bail.
    await flush();
    const t2 = h.send("hello");
    const t3 = h.send("hello");
    await Promise.all([t1, t2, t3]);
    expect(h.persisted).toBe(1);
    expect(h.generations).toBe(1);
  });

  it("self-knowledge early-return branch also respects the guard", async () => {
    const h = makeHarness();
    const t1 = h.send("!kb what is nido");
    const t2 = h.send("!kb what is nido");
    await Promise.all([t1, t2]);
    expect(h.persisted).toBe(1);
    expect(h.generations).toBe(0); // KB path answers without the model
  });

  it("error mid-send → guard released, retry allowed, button not permanently blocked", async () => {
    const guard = new SendGuard();
    const failOnce = vi.fn().mockRejectedValueOnce(new Error("createSession failed"));
    const sendOnce = async () => {
      if (!guard.tryAcquire()) return false;
      try {
        await failOnce();
        return true;
      } finally {
        guard.release();
      }
    };
    await expect(sendOnce()).rejects.toThrow("createSession failed");
    expect(guard.isActive).toBe(false);
    // Retry after the error must be able to acquire the guard.
    const sendOk = async () => {
      if (!guard.tryAcquire()) return false;
      try {
        await Promise.resolve();
        return true;
      } finally {
        guard.release();
      }
    };
    await expect(sendOk()).resolves.toBe(true);
  });

  it("normal single send → unchanged behavior (persists once, generates once, releases)", async () => {
    const h = makeHarness();
    await h.send("hello");
    expect(h.persisted).toBe(1);
    expect(h.generations).toBe(1);
    expect(h.guard.isActive).toBe(false);
    expect(h.generating).toBe(false);
    // A subsequent normal send works — no lingering block.
    await h.send("again");
    expect(h.persisted).toBe(2);
    expect(h.generations).toBe(2);
  });

  it("guard consult is synchronous: second tap is rejected even before the first yields", async () => {
    const guard = new SendGuard();
    const order: string[] = [];
    const work = () => {
      order.push("work-start");
      return Promise.resolve().then(() => order.push("work-end"));
    };
    // No await between the two calls — same tick, like a double tap.
    const r1 = runGuardedSend(guard, work);
    const r2 = runGuardedSend(guard, work);
    const [a, b] = await Promise.all([r1, r2]);
    expect(a.ran).toBe(true);
    expect(b.ran).toBe(false);
    expect(order).toEqual(["work-start", "work-end"]);
  });
});
