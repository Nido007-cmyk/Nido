# Spec — Network Audit screen (advance work, not yet implemented)

**Status:** SPECIFICATION ONLY. Do not implement until the Tier 2 UI lane reaches
Settings screens.
**Why:** "Que el usuario *vea* que no hay red." A static audit (`../NETWORK_AUDIT.md`)
proves the code paths; this screen proves it **at runtime, on the user's device**.
Aligns with R-4 (E2E by default, minimal metadata, user knows beforehand).

## 1. Data model

Single choke point: **all** network traffic in the app goes through
`src/models/ModelManager.ts` (the only module that calls `createDownloadResumable`).
The audit log is written there — nowhere else can emit network, so nowhere else
needs instrumentation.

```ts
type NetworkAuditEvent = {
  id: string;                 // uuid
  ts: number;                 // epoch ms
  kind: 'download_start' | 'download_progress' | 'download_complete' |
        'download_failed' | 'download_cancelled' | 'integrity_verified';
  host: string;               // e.g. "huggingface.co" — host only, no tokens/queries
  assetId: string;            // manifest asset id, e.g. "qwen2.5-1.5b-q4_k_m"
  bytesTotal?: number;
  bytesDone?: number;
  sha256Match?: boolean;      // set on integrity_verified
  userInitiated: true;        // invariant: every event is user-initiated
};
```

- Append-only ring buffer, cap 500 events, persisted in the app DB (SQLCipher).
- Included in **Clear All Data** destruction semantics.
- No payload content, no full URLs, no headers — the log proves *that* traffic
  happened and *what for*, never *what was said* (nothing is said; these are file downloads).

## 2. Screen layout (Tier 2 Daylight tokens)

Settings → Privacy → **Network activity**.

- Header: "Network activity" + subtitle "Every connection this app has ever made."
- Status card (always visible):
  - If log is empty: calm empty state — "No network activity recorded. NIDO has never connected to the internet on this device."
  - Else: "N connections · all user-initiated downloads" + lifetime bytes total.
- Event list, newest first. Each row: status icon + text (never color alone),
  asset name (sentence case), host, relative time ("2 days ago"), bytes.
- Row tap → detail: started/finished timestamps, total bytes, duration,
  SHA-256 verified ✓/✗, "Started by you" line.
- No filters needed at v1. No export at v1 (add only with explicit user request).

## 3. Copy (English, frozen-style; i18n keys from day one)

- Title: "Network activity"
- Empty state: "No network activity recorded." / "NIDO works fully offline. The only connections it will ever make are downloads you start yourself."
- Row kinds: "Download started" · "Download finished" · "Download failed" · "Integrity verified"
- Detail: "Started by you" · "SHA-256 verified" / "SHA-256 mismatch — file discarded"

## 4. Non-goals

- Not a firewall: it records, it does not block (blocking is architectural — there
  is simply no other network code path).
- Not a packet inspector: no payloads, no DPI, no VPN tricks.
- Must never phone home to "check" anything. The screen works in airplane mode.

## 5. Implementation notes (for later)

- Write events synchronously in ModelManager before/after each download state change.
- `integrity_verified` is emitted by the same `verifyChecksum()` fixed in T-005.
- Screen reads from the DB; zero network to render.
- Tests: unit tests for the log writer (cap, ordering, Clear All Data inclusion);
  the screen itself is covered by the device protocol G4.
