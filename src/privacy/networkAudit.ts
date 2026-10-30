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
 * - Persisted in the app's encrypted database (SQLCipher, table
 *   `network_audit`, newest 500 rows) so it survives restarts. The audit of
 *   2026-10-29 found the earlier comment promised a JSONL file that was never
 *   written: entries lived only in memory. Writes are fire-and-forget and
 *   never block or break the audited operation; `hydrate()` loads earlier
 *   sessions' entries; `clear()` wipes both. Erasing all data deletes the
 *   database, and the log with it.
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

/**
 * Where entries are kept between sessions. The default store is the
 * encrypted database; tests inject their own.
 */
export interface NetworkAuditStore {
  append(entry: NetworkAuditEntry): Promise<void>;
  /** Entries with ts strictly before `beforeIso`, oldest first, at most `limit`. */
  loadBefore(beforeIso: string, limit: number): Promise<NetworkAuditEntry[]>;
  clear(): Promise<void>;
}

const NETWORK_AUDIT_DDL = `
CREATE TABLE IF NOT EXISTS network_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  entry TEXT NOT NULL
);`;

const KINDS: ReadonlySet<string> = new Set(["download_start", "download_complete", "download_failed", "lan_connect"]);

/** A stored row is shown only if it still has the shape of an entry. */
export function parseStoredEntry(raw: string): NetworkAuditEntry | null {
  try {
    const e = JSON.parse(raw);
    if (!e || typeof e !== "object") return null;
    if (typeof e.ts !== "string" || !KINDS.has(e.kind) || typeof e.endpoint !== "string") return null;
    return {
      ts: e.ts,
      kind: e.kind,
      endpoint: e.endpoint,
      assetId: typeof e.assetId === "string" ? e.assetId : "",
      bytesExpected: Number.isFinite(e.bytesExpected) ? e.bytesExpected : 0,
      bytesReceived: Number.isFinite(e.bytesReceived) ? e.bytesReceived : 0,
      ...(typeof e.error === "string" ? { error: e.error } : {}),
    };
  } catch {
    return null;
  }
}

/** The encrypted database (lazy import: no native code at module load). */
export const databaseNetworkAuditStore: NetworkAuditStore = {
  async append(entry) {
    const { getDatabase } = await import("../security/databaseManager");
    const db = await getDatabase();
    await db.execAsync(NETWORK_AUDIT_DDL);
    await db.runAsync("INSERT INTO network_audit (ts, entry) VALUES (?, ?)", [entry.ts, JSON.stringify(entry)]);
    await db.execAsync(
      `DELETE FROM network_audit WHERE id NOT IN (SELECT id FROM network_audit ORDER BY id DESC LIMIT ${MAX_ENTRIES})`,
    );
  },
  async loadBefore(beforeIso, limit) {
    const { getDatabase } = await import("../security/databaseManager");
    const db = await getDatabase();
    await db.execAsync(NETWORK_AUDIT_DDL);
    const rows = await db.getAllAsync<{ entry: string }>(
      "SELECT entry FROM network_audit WHERE ts < ? ORDER BY id DESC LIMIT ?",
      [beforeIso, limit],
    );
    return rows
      .map((r) => parseStoredEntry(r.entry))
      .filter((e): e is NetworkAuditEntry => e !== null)
      .reverse();
  },
  async clear() {
    const { getDatabase } = await import("../security/databaseManager");
    const db = await getDatabase();
    await db.execAsync(NETWORK_AUDIT_DDL);
    await db.execAsync("DELETE FROM network_audit");
  },
};

class NetworkAudit {
  private entries: NetworkAuditEntry[] = [];
  private listeners = new Set<(e: NetworkAuditEntry) => void>();
  private store: NetworkAuditStore = databaseNetworkAuditStore;
  /** Everything logged in this process has ts >= sessionStart. */
  private sessionStart = new Date().toISOString();
  private hydrated: Promise<void> | null = null;
  /** Writes go one after another, in order. */
  private writes: Promise<void> = Promise.resolve();
  /** While erasing all data nothing is written (it would land in the new database). */
  private wiping = false;

  log(entry: Omit<NetworkAuditEntry, "ts">): NetworkAuditEntry {
    const full: NetworkAuditEntry = { ...entry, ts: new Date().toISOString() };
    this.entries.push(full);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }
    const store = this.store;
    const loggedWhileWiping = this.wiping;
    this.writes = this.writes
      .then(() => (loggedWhileWiping || this.wiping ? undefined : store.append(full)))
      .catch(() => {
      // Best-effort: the in-memory log still shows it this session.
    });
    this.notify(full);
    return full;
  }

  private notify(full: NetworkAuditEntry): void {
    for (const l of this.listeners) {
      try {
        l(full);
      } catch {
        // A listener must never break the audited operation.
      }
    }
  }

  /**
   * Loads the entries of earlier sessions (once). Safe to call many times;
   * never throws. Listeners are told when older entries arrive.
   */
  hydrate(): Promise<void> {
    if (!this.hydrated) {
      const store = this.store;
      this.hydrated = store
        .loadBefore(this.sessionStart, MAX_ENTRIES)
        .then((older) => {
          if (older.length === 0) return;
          this.entries = [...older, ...this.entries].slice(-MAX_ENTRIES);
          const newest = this.entries[this.entries.length - 1];
          if (newest) this.notify(newest);
        })
        .catch(() => {
          // No database (early start, tests): this session's entries still show.
        });
    }
    return this.hydrated;
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

  /** Wipes the log in memory and in the database. */
  clear(): Promise<void> {
    this.entries = [];
    const store = this.store;
    this.writes = this.writes.then(() => store.clear()).catch(() => {});
    return this.writes;
  }

  /**
   * «Borrar todos los datos»: el registro va en la base que se borra. Desde
   * aquí no se escribe nada (lo pendiente acabaría en la base nueva) y la
   * memoria se vacía. endWipe lo vuelve a dejar como recién instalado.
   */
  beginWipe(): void {
    this.wiping = true;
    this.entries = [];
  }

  endWipe(): void {
    this.entries = [];
    this.sessionStart = new Date().toISOString();
    this.hydrated = null;
    this.wiping = false;
  }

  /** Waits for pending writes (tests and the wipe flow). */
  flush(): Promise<void> {
    return this.writes;
  }

  /** Tests only: a fresh log over the given store. */
  _resetForTests(store: NetworkAuditStore, sessionStartIso?: string): void {
    this.entries = [];
    this.listeners.clear();
    this.store = store;
    this.sessionStart = sessionStartIso ?? new Date().toISOString();
    this.hydrated = null;
    this.writes = Promise.resolve();
    this.wiping = false;
  }

  /** True if the app has made zero network requests this session. */
  isPristine(): boolean {
    return this.entries.length === 0;
  }
}

/** Singleton — the one audit log for the whole app. */
export const networkAudit = new NetworkAudit();
