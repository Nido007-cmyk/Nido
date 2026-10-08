/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * reconnectManager — auto-reconnect lifecycle-independent (2026-10-08).
 *
 * Moved out of NidoScreen.tsx (Option A of the auto-reconnect diagnosis):
 * the retry state machine used to live in a React component, so
 * navigating away from the P2P screen cancelled all pending retries
 * (unmount cleanup). This module owns the same logic at module scope,
 * so retries survive screen navigation AND screen-off (once the
 * foreground service actually starts — see modules/nido-p2p manifest).
 *
 * Logic is IDENTICAL to the 2026-10-07 implementation that was verified
 * working while mounted: exponential backoff 5s/10s/20s/40s/60s, max 5
 * attempts, no duplicate timers per peer, cancel on manual connect.
 *
 * The connect function is injected (setConnector) to avoid a circular
 * dependency with the UI layer and to keep this unit-testable.
 */

export type ReconnectFn = (pkHex: string, name: string) => Promise<boolean>;

const MAX_ATTEMPTS = 5;

function backoffMs(attempts: number): number {
  return Math.min(5000 * 2 ** attempts, 60000);
}

interface Entry {
  attempts: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  name: string;
}

class ReconnectManager {
  private entries = new Map<string, Entry>();
  private connectFn: ReconnectFn = async () => false;

  /** Register/replace the connect implementation (called by the UI layer). */
  setConnector(fn: ReconnectFn): void {
    this.connectFn = fn;
  }

  /** For tests: inspect pending state. */
  pendingCount(): number {
    return this.entries.size;
  }

  /** For tests: attempts used so far for a peer. */
  attemptsFor(pkHex: string): number {
    return this.entries.get(pkHex.toLowerCase())?.attempts ?? 0;
  }

  schedule(pkHex: string, name: string): void {
    const key = pkHex.toLowerCase();
    const existing = this.entries.get(key);
    // No duplicar: si ya hay un timer activo, no hacer nada.
    if (existing?.timer) return;
    const attempts = existing?.attempts ?? 0;
    if (attempts >= MAX_ATTEMPTS) {
      this.entries.delete(key);
      return;
    }
    const delayMs = backoffMs(attempts);
    const timer = setTimeout(() => {
      const e = this.entries.get(key);
      if (e) e.timer = undefined;
      void this.connectFn(pkHex, name)
        .then((ok) => {
          if (!ok) this.schedule(pkHex, name);
        })
        .catch(() => {
          this.schedule(pkHex, name);
        });
    }, delayMs);
    this.entries.set(key, { attempts: attempts + 1, timer, name });
  }

  cancel(pkHex: string): void {
    const key = pkHex.toLowerCase();
    const entry = this.entries.get(key);
    if (entry) {
      if (entry.timer) clearTimeout(entry.timer);
      this.entries.delete(key);
    }
  }

  /** Cancel everything (logout / Clear All Data / P2P shutdown). */
  cancelAll(): void {
    for (const [, entry] of this.entries) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.entries.clear();
  }
}

/** Singleton: one retry state machine for the whole app. */
export const reconnectManager = new ReconnectManager();
