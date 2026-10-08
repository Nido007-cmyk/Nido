/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * F-3 UNIT A (2026-09-28): NidoScreen gesture guards.
 *
 * The N3 audit diagnosed the class: two rapid taps both saw a batched React
 * state as false and both persisted a message. NidoScreen.handleSend used
 * exactly that pattern (`sending` state) and handleRetry had no guard at
 * all. The fix applies the synchronous SendGuard protocol verbatim to both
 * gesture paths.
 *
 * NidoScreen has no renderer in this environment (same as N3), so these tests
 * cover: (A) structural wiring — the guard is acquired synchronously at tap
 * entry in the real handlers; (B) the gesture pattern the handlers now use —
 * one tap-pair collapses to one logical send; (C) messenger-level semantics
 * preserved — within-horizon concurrent retry of the same id stays allowed
 * and idempotent, beyond-horizon minting is unchanged (which is why the UI
 * guard exists); (D) guard release on error/early-return; (E) ChatScreen's
 * N3 guard untouched.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { SendGuard, runGuardedSend } from "./sendGuard";
import {
  createMemorySecureBackend,
  setTestSecureBackend,
} from "../privacy/keyManager";
import {
  resetP2PMem,
  useP2PMem,
  type P2PMem,
} from "../p2p/p2pMemoryMock";
import { NidoMessenger } from "../p2p/messenger";
import type { LoopbackTransport } from "../p2p/transport";
import { fromHex } from "../p2p/crypto";
import { encodePairingPayload } from "../p2p/pairing";
import { getSigningKeypair } from "../p2p/store";

vi.mock("../agent/memory/memoryStore", async () => {
  const { p2pMemoryStoreModuleRouted } = await import("../p2p/p2pMemoryMock");
  return p2pMemoryStoreModuleRouted();
});

const SRC = readFileSync(new URL("./NidoScreen.tsx", import.meta.url), "utf8");
const CHAT_SRC = readFileSync(new URL("./ChatScreen.tsx", import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// (A) Structural wiring in the real component
// ---------------------------------------------------------------------------
describe("F-3 wiring: both NidoScreen gesture paths are guard-gated", () => {
  it("handleSend acquires sendGuardRef synchronously before sendChat", () => {
    const start = SRC.indexOf("const handleSend");
    const end = SRC.indexOf("}, [draft, peer, loadConversation]);");
    const body = SRC.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const acquire = body.indexOf("sendGuardRef.current.tryAcquire()");
    const send = body.indexOf("sendChat(");
    const release = body.indexOf("sendGuardRef.current.release()");
    expect(acquire).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(-1);
    // Acquisition precedes the messenger call — the synchronous gate.
    expect(acquire).toBeLessThan(send);
    // Release happens in the finally (always).
    expect(release).toBeGreaterThan(send);
    // The old batched-state gate is gone from the send path.
    expect(body).not.toContain("|| sending) return;");
  });

  it("handleRetry acquires retryGuardRef synchronously before retryOutboundMessage", () => {
    const start = SRC.indexOf("async (item: P2PStoredMessage)");
    const end = SRC.indexOf("[peer, loadConversation, t],");
    const body = SRC.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const acquire = body.indexOf("retryGuardRef.current.tryAcquire()");
    const retry = body.indexOf("mRef.current.retryOutboundMessage(");
    const release = body.indexOf("retryGuardRef.current.release()");
    expect(acquire).toBeGreaterThan(-1);
    expect(retry).toBeGreaterThan(-1);
    expect(acquire).toBeLessThan(retry);
    expect(release).toBeGreaterThan(retry);
  });

  it("send and retry use separate guard refs", () => {
    expect(SRC).toContain("const sendGuardRef = useRef<SendGuard>(new SendGuard());");
    expect(SRC).toContain("const retryGuardRef = useRef<SendGuard>(new SendGuard());");
    // Guards don't leak across paths: send never touches the retry guard.
    const sendStart = SRC.indexOf("const handleSend");
    const sendEnd = SRC.indexOf("}, [draft, peer, loadConversation]);");
    expect(SRC.slice(sendStart, sendEnd)).not.toContain("retryGuardRef");
  });
});

// ---------------------------------------------------------------------------
// (B) Gesture pattern: one tap-pair → one logical send
// ---------------------------------------------------------------------------
describe("F-3 gesture pattern (as wired in handleSend/handleRetry)", () => {
  it("two concurrent taps collapse to a single sendChat call", async () => {
    const guard = new SendGuard();
    const sendChat = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20)); // in-flight work
      return { id: "msg-1", queued: false };
    });
    // Mirror the handler structure: tryAcquire at tap entry, work, finally release.
    const tap = async () => {
      if (!guard.tryAcquire()) return null;
      try {
        return await sendChat();
      } finally {
        guard.release();
      }
    };
    const [r1, r2] = await Promise.all([tap(), tap()]);
    expect(sendChat).toHaveBeenCalledTimes(1);
    expect([r1, r2].filter(Boolean)).toHaveLength(1);
  });

  it("two concurrent taps collapse to a single retryOutboundMessage call", async () => {
    const guard = new SendGuard();
    const retry = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { id: "msg-1", freshId: false };
    });
    const tap = async () => {
      if (!guard.tryAcquire()) return null;
      try {
        return await retry();
      } finally {
        guard.release();
      }
    };
    const [r1, r2] = await Promise.all([tap(), tap()]);
    expect(retry).toHaveBeenCalledTimes(1);
    expect([r1, r2].filter(Boolean)).toHaveLength(1);
  });

  it("a tap after the first completes proceeds normally (no permanent lock)", async () => {
    const guard = new SendGuard();
    const work = vi.fn(async () => "ok");
    const first = await runGuardedSend(guard, work);
    const second = await runGuardedSend(guard, work);
    expect(first).toEqual({ ran: true, value: "ok" });
    expect(second).toEqual({ ran: true, value: "ok" });
    expect(work).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// (D) Guard release on error / early return
// ---------------------------------------------------------------------------
describe("F-3 guard release paths", () => {
  it("a throwing send releases the guard — error/retry keeps working", async () => {
    const guard = new SendGuard();
    const boom = vi.fn(async () => {
      throw new Error("send failed");
    });
    const attempt = async () => runGuardedSend(guard, boom);
    await expect(attempt()).rejects.toThrow("send failed");
    expect(guard.isActive).toBe(false);
    // Next tap works.
    const ok = await runGuardedSend(guard, async () => "ok");
    expect(ok).toEqual({ ran: true, value: "ok" });
  });
});

// ---------------------------------------------------------------------------
// (E) ChatScreen's N3 guard untouched
// ---------------------------------------------------------------------------
describe("F-3 ChatScreen N3 guard preserved", () => {
  it("ChatScreen still uses its own sendGuardRef around send", () => {
    expect(CHAT_SRC).toContain("sendGuardRef.current.tryAcquire()");
    expect(CHAT_SRC).toContain("sendGuardRef.current.release()");
  });
});

// ---------------------------------------------------------------------------
// (C) Messenger-level semantics preserved (real NidoMessenger)
// ---------------------------------------------------------------------------
function freshMem(): P2PMem {
  return {
    identity: [],
    contacts: [],
    messages: [],
    ackLog: [],
    lateAck: [],
    nonceCache: [],
    identityArchive: [],
  repairIntents: [],
  bootRepairLog: [],
  };
}
const memA = freshMem();
const backendA = createMemorySecureBackend();
const asA = async <T>(fn: () => Promise<T>): Promise<T> => {
  setTestSecureBackend(backendA);
  useP2PMem(memA);
  return fn();
};

function makeTx() {
  const transport = {
    available: true,
    sendFrame: async (_pk: string, _frame: Uint8Array) => {},
    startDiscovery: async () => {},
    stopDiscovery: async () => {},
    connect: async () => ({ pkHex: "", alias: "", transport: "bluetooth" as const }),
  };
  return transport;
}

beforeEach(() => {
  resetP2PMem(memA);
  useP2PMem(memA);
  setTestSecureBackend(backendA);
});

describe("F-3 messenger semantics preserved under the guard", () => {
  it("concurrent within-horizon retries of the same id stay allowed and share the id (benign by N6 design)", async () => {
    const m = new NidoMessenger(makeTx() as unknown as LoopbackTransport);
    const { pkHex } = await asA(() => m.ensureIdentity("Alice"));
    void pkHex;
    const aSign = await asA(() => getSigningKeypair());
    const { generateIdentity } = await import("../p2p/crypto");
    const peerId = generateIdentity();
    await asA(() =>
      m.pairWith(encodePairingPayload("Beto", peerId.publicKey, aSign.publicKey)),
    );
    const { id } = await asA(() => m.sendChat("Beto", "retry-me"));
    const row = memA.messages.find((mm) => mm.id === id)!;
    row.status = "failed";
    row.failure_reason = "timeout";
    row.ack_attempts = 3;
    // Within horizon (ts is fresh): concurrent retries reuse the SAME message_id.
    const [ra, rb] = await Promise.all([
      asA(() => m.retryOutboundMessage(id)),
      asA(() => m.retryOutboundMessage(id)),
    ]);
    for (const r of [ra, rb]) {
      if (!r || "refused" in r) throw new Error("expected a successful retry outcome");
      expect(r.freshId).toBe(false);
      expect(r.id).toBe(id);
    }
  });
});
