/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { reconnectManager } from "./reconnectManager";

describe("reconnectManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reconnectManager.cancelAll();
    reconnectManager.setConnector(async () => false);
  });

  afterEach(() => {
    vi.useRealTimers();
    reconnectManager.cancelAll();
  });

  it("schedules with exponential backoff (5s, 10s, 20s, ...)", async () => {
    const calls: number[] = [];
    reconnectManager.setConnector(async () => {
      calls.push(Date.now());
      return false;
    });
    reconnectManager.schedule("AA", "peer");
    expect(reconnectManager.pendingCount()).toBe(1);

    // First attempt at ~5s.
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(1);

    // Second attempt at +10s.
    await vi.advanceTimersByTimeAsync(10000);
    expect(calls).toHaveLength(2);

    // Third at +20s.
    await vi.advanceTimersByTimeAsync(20000);
    expect(calls).toHaveLength(3);
  });

  it("stops after 5 attempts", async () => {
    let n = 0;
    reconnectManager.setConnector(async () => {
      n++;
      return false;
    });
    reconnectManager.schedule("BB", "peer");
    // 5s+10s+20s+40s+60s = 135s total for 5 attempts.
    await vi.advanceTimersByTimeAsync(200000);
    expect(n).toBe(5);
    expect(reconnectManager.pendingCount()).toBe(0);
  });

  it("does not duplicate timers for the same peer", () => {
    reconnectManager.schedule("CC", "peer");
    reconnectManager.schedule("CC", "peer");
    reconnectManager.schedule("CC", "peer");
    expect(reconnectManager.pendingCount()).toBe(1);
  });

  it("cancel stops pending retries", async () => {
    let n = 0;
    reconnectManager.setConnector(async () => {
      n++;
      return false;
    });
    reconnectManager.schedule("DD", "peer");
    reconnectManager.cancel("DD");
    await vi.advanceTimersByTimeAsync(120000);
    expect(n).toBe(0);
    expect(reconnectManager.pendingCount()).toBe(0);
  });

  it("successful connect stops the chain", async () => {
    let n = 0;
    reconnectManager.setConnector(async () => {
      n++;
      // Simulate handleConnectPaired cancelling on success.
      reconnectManager.cancel("EE");
      return true;
    });
    reconnectManager.schedule("EE", "peer");
    await vi.advanceTimersByTimeAsync(120000);
    expect(n).toBe(1);
  });

  it("connector throw is treated as failure and reschedules", async () => {
    let n = 0;
    reconnectManager.setConnector(async () => {
      n++;
      throw new Error("boom");
    });
    reconnectManager.schedule("FF", "peer");
    await vi.advanceTimersByTimeAsync(16000);
    expect(n).toBe(2); // 5s + 10s
  });

  it("tracks attempts per peer independently", () => {
    reconnectManager.schedule("G1", "peer1");
    reconnectManager.schedule("G2", "peer2");
    expect(reconnectManager.pendingCount()).toBe(2);
    reconnectManager.cancel("G1");
    expect(reconnectManager.pendingCount()).toBe(1);
    expect(reconnectManager.attemptsFor("G2")).toBe(1);
  });

  it("cancelAll clears everything", () => {
    reconnectManager.schedule("H1", "p1");
    reconnectManager.schedule("H2", "p2");
    reconnectManager.cancelAll();
    expect(reconnectManager.pendingCount()).toBe(0);
  });
});
