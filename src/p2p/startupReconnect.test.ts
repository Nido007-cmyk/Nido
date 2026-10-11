/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  reconnectKnownContactsOnce,
  __resetStartupReconnectForTests,
  type StartupReconnectDeps,
} from "./startupReconnect";

const A = "a".repeat(64);
const B = "b".repeat(64);
const MAC_A = "AA:AA:AA:AA:AA:AA";
const MAC_B = "BB:BB:BB:BB:BB:BB";

function deps(over: Partial<StartupReconnectDeps> = {}): StartupReconnectDeps {
  return {
    getKnownMacs: async () => new Map([[A, MAC_A], [B, MAC_B]]),
    connectedPeers: () => [],
    shouldDialPeer: async () => true,
    connectPeer: vi.fn(async (mac: string) => ({ pkHex: mac === MAC_A ? A : B })),
    disconnectPeer: vi.fn(async () => {}),
    gapMs: 0,
    ...over,
  };
}

describe("reconnectKnownContactsOnce (RECONNECT-AFTER-CRASH)", () => {
  beforeEach(() => __resetStartupReconnectForTests());

  it("re-dials known paired contacts after a restart", async () => {
    const d = deps();
    expect(await reconnectKnownContactsOnce(d)).toEqual([A, B]);
    expect(d.connectPeer).toHaveBeenCalledWith(MAC_A);
    expect(d.connectPeer).toHaveBeenCalledWith(MAC_B);
  });

  it("runs only once per process", async () => {
    const d = deps();
    await reconnectKnownContactsOnce(d);
    expect(await reconnectKnownContactsOnce(d)).toEqual([]);
    expect(d.connectPeer).toHaveBeenCalledTimes(2);
  });

  it("skips peers already connected", async () => {
    const d = deps({ connectedPeers: () => [A.toUpperCase()] });
    expect(await reconnectKnownContactsOnce(d)).toEqual([B]);
    expect(d.connectPeer).not.toHaveBeenCalledWith(MAC_A);
  });

  it("respects the deterministic dial role (listener does not dial)", async () => {
    const d = deps({ shouldDialPeer: async (pk) => pk !== A });
    expect(await reconnectKnownContactsOnce(d)).toEqual([B]);
    expect(d.connectPeer).not.toHaveBeenCalledWith(MAC_A);
  });

  it("disconnects when the MAC now answers with a different identity", async () => {
    const other = "c".repeat(64);
    const d = deps({
      getKnownMacs: async () => new Map([[A, MAC_A]]),
      connectPeer: vi.fn(async () => ({ pkHex: other })),
    });
    expect(await reconnectKnownContactsOnce(d)).toEqual([]);
    expect(d.disconnectPeer).toHaveBeenCalledWith(other);
  });

  it("is best-effort: a failing peer does not stop the others", async () => {
    const d = deps({
      connectPeer: vi.fn(async (mac: string) => {
        if (mac === MAC_A) throw new Error("read failed");
        return { pkHex: B };
      }),
    });
    expect(await reconnectKnownContactsOnce(d)).toEqual([B]);
  });

  it("swallows a store failure", async () => {
    const d = deps({ getKnownMacs: async () => { throw new Error("db locked"); } });
    expect(await reconnectKnownContactsOnce(d)).toEqual([]);
  });
});
