/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * startupReconnect — RECONNECT-AFTER-CRASH 2026-10-10.
 *
 * The auto-reconnect state (who we were connected to) lives in memory, so a
 * crash or restart erased it: when the link came back up, a known contact
 * nearby was treated like a fresh discovery and never auto-connected — the
 * user had to connect by hand.
 *
 * On the first link start of each app process, this dials the contacts we
 * have completed a handshake with before (their last MAC is persisted in
 * SQLCipher by saveKnownMac). Rules, so nothing new is opened up:
 *   - only live, already-paired contacts (getKnownMacs excludes superseded);
 *   - the full signed handshake still runs; revoked peers are still refused
 *     by the transport;
 *   - the deterministic dial role is respected: if the peer is the dialer we
 *     only listen (our server is already up) and its own retry reaches us;
 *   - a handshake that turns out to be a different peer is disconnected;
 *   - errors are swallowed (best-effort, never surfaces UI errors);
 *   - runs once per process.
 */

export interface StartupReconnectDeps {
  getKnownMacs(): Promise<Map<string, string>>;
  connectedPeers(): string[];
  shouldDialPeer(pkHex: string): Promise<boolean>;
  connectPeer(alias: string, opts?: { targetPkHex?: string }): Promise<{ pkHex: string }>;
  disconnectPeer(pkHex: string): Promise<void>;
  /** Called after each successful reconnect (e.g. refresh UI). */
  onReconnected?(pkHex: string): void;
  /** Pause between dials so the previous RFCOMM socket fully closes. */
  gapMs?: number;
}

let ranThisProcess = false;

/** For tests only. */
export function __resetStartupReconnectForTests(): void {
  ranThisProcess = false;
}

/** Returns the pkHex list that was reconnected (for tests/diagnostics). */
export async function reconnectKnownContactsOnce(deps: StartupReconnectDeps): Promise<string[]> {
  if (ranThisProcess) return [];
  ranThisProcess = true;
  const reconnected: string[] = [];
  let known: Map<string, string>;
  try {
    known = await deps.getKnownMacs();
  } catch {
    return reconnected;
  }
  const gapMs = deps.gapMs ?? 750;
  let first = true;
  for (const [pk, mac] of known) {
    const target = pk.toLowerCase();
    try {
      const live = new Set(deps.connectedPeers().map((p) => p.toLowerCase()));
      if (live.has(target)) continue;
      if (!(await deps.shouldDialPeer(target))) continue;
      if (!first && gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
      first = false;
      const info = await deps.connectPeer(mac, { targetPkHex: target });
      if (info.pkHex.toLowerCase() === target) {
        reconnected.push(target);
        deps.onReconnected?.(target);
      } else {
        await deps.disconnectPeer(info.pkHex).catch(() => {});
      }
    } catch {
      /* best-effort: el peer puede no estar cerca o no tener la app abierta */
    }
  }
  return reconnected;
}
