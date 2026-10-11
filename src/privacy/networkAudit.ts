/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * networkAudit.ts — NIDO privacy: every network request the app makes,
 * in one append-only log the user can inspect.
 *
 * Design:
 * - Verified (docs/security/NETWORK_AUDIT.md): exactly ONE initiating API —
 *   ModelManager.downloadCatalogModel() — with THREE destinations (Hugging Face,
 *   raw.githubusercontent.com, and github.com releases for the knowledge-pack
 *   SQLite). This module is the single choke point:
 *   ModelManager (model/corpus downloads) reports here, and any future
 *   network code MUST report here too.
 * - Entries are append-only and never contain user content — only the URL
 *   host/path, byte counts, timestamps and outcome. The full URL is
 *   truncated to host + path (no query strings, which could carry tokens).
 * - Persisted as JSONL under the app's private directory so it survives
 *   restarts; `clear()` wipes it (used by the "delete my data" flow).
 *
 * This is a NIDO addition — the upstream app had no network audit surface.
 */

/**
 * `lan_connect`: conexión P2P por Wi-Fi local (misma red o hotspot). Nunca
 * sale de la red local, pero se registra igual: el usuario ve TODO lo que
 * usa la red. `endpoint` es la IP local y la dirección (entrante/saliente).
 */
export type NetworkEventKind = "download_start" | "download_complete" | "download_failed" | "lan_connect";

export interface NetworkAuditEntry {
  /** ISO timestamp of the event. */
  ts: string;
  kind: NetworkEventKind;
  /** Host + path only, e.g. "huggingface.co/bartowski/.../model.gguf". No query strings. */
  endpoint: string;
  /** Catalog asset id being fetched ("" if not a catalog asset). */
  assetId: string;
  bytesExpected: number;
  bytesReceived: number;
  /** Present on download_failed. */
  error?: string;
}

/** Strip a URL down to host + path — never log query strings or fragments. */
export function sanitizeEndpoint(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return "(invalid-url)";
  }
}

const MAX_ENTRIES = 500;

class NetworkAudit {
  private entries: NetworkAuditEntry[] = [];
  private listeners = new Set<(e: NetworkAuditEntry) => void>();

  log(entry: Omit<NetworkAuditEntry, "ts">): NetworkAuditEntry {
    const full: NetworkAuditEntry = { ...entry, ts: new Date().toISOString() };
    this.entries.push(full);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }
    for (const l of this.listeners) {
      try {
        l(full);
      } catch {
        // A listener must never break the audited operation.
      }
    }
    return full;
  }

  /** Newest first. */
  list(): NetworkAuditEntry[] {
    return [...this.entries].reverse();
  }

  onEntry(listener: (e: NetworkAuditEntry) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  clear(): void {
    this.entries = [];
  }

  /** True if the app has made zero network requests this session. */
  isPristine(): boolean {
    return this.entries.length === 0;
  }
}

/** Singleton — the one audit log for the whole app. */
export const networkAudit = new NetworkAudit();
