/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Approval gate for delegated tasks — anti-loopjacking boundary.
 *
 * Loopjacking (2025/2026 literature): the human-in-the-loop approval is
 * decoupled from execution — the operation shown on the approval card is
 * swapped afterwards via mutable state, so the user approves X but Y
 * executes. This gate makes that swap structurally impossible:
 *
 * 1. Deep-copy at registration: the bytes shown on the card are a frozen
 *    snapshot. Later mutations of the caller's request object have zero
 *    effect on what executes.
 * 2. No update API: there is deliberately no `update()`/`refresh()`.
 *    A second TASK_REQUEST for an already-pending taskId is rejected
 *    while the first is undecided (fail-closed), so a re-fetch cannot
 *    replace the approved bytes.
 * 3. Integrity check on approve: the snapshot hash is recomputed; any
 *    internal corruption aborts (returns null) instead of executing.
 * 4. Timeout = deny: approving after the deadline returns null and the
 *    entry is discarded. Screen sleep during approval never auto-approves.
 * 5. Single consume: an approval can be redeemed exactly once.
 * 6. Negotiation state: registration requires ACCEPTED. The delegation
 *    token binds the negotiationId but not its *state*; the state check
 *    lives here, at the human gate (security review 2026-10-08 §3.2).
 *
 * Contract for the future TASK_REQUEST handler (feature flag OFF in v1):
 * render the card from `register()`'s `shown`, and pass `approve()`'s
 * output — never a re-fetched object — to the executor.
 */

import nacl from "tweetnacl";
import { toHex, utf8Encode } from "../../p2p/crypto";
import {
  TASK_LIMITS,
  allScopesValid,
  type TaskScope,
} from "../../p2p/taskProtocol";
import type { NegotiationState } from "../../p2p/negotiation";

export interface ApprovalRequest {
  taskId: string;
  peerPkShort: string;
  description: string;
  documentBase64?: string;
  resultSchema: Record<string, unknown>;
  scopes: TaskScope[];
  negotiationState: NegotiationState;
  expiresAt: number;
  /** Approval window in ms; defaults to TASK_LIMITS.approvalTimeoutMs. */
  timeoutMs?: number;
}

/** What the card shows (frozen) — byte-identical to what may execute. */
export interface ShownRequest {
  taskId: string;
  peerPkShort: string;
  description: string;
  scopes: TaskScope[];
  expiresAt: number;
}

/** What the executor receives on approval (frozen). */
export interface ApprovedTask {
  description: string;
  documentBase64?: string;
  resultSchema: Record<string, unknown>;
}

interface StoredEntry {
  snapshot: {
    taskId: string;
    description: string;
    documentBase64?: string;
    resultSchema: Record<string, unknown>;
  };
  hash: string;
  deadline: number;
}

function snapshotHash(s: StoredEntry["snapshot"]): string {
  return toHex(nacl.hash(utf8Encode(JSON.stringify(s))));
}

export class ApprovalGate {
  private readonly pending = new Map<string, StoredEntry>();
  private readonly byTaskId = new Map<string, string>();
  private seq = 0;

  /**
   * Register a task request for human approval. Returns the request id
   * and the frozen bytes to render on the card. Throws (fail-closed) on
   * any invalid input, a non-ACCEPTED negotiation, or a duplicate
   * pending taskId.
   */
  register(req: ApprovalRequest): { requestId: string; shown: ShownRequest } {
    if (req.negotiationState !== "ACCEPTED") {
      throw new Error("approval gate: negotiation is not ACCEPTED");
    }
    if (!Array.isArray(req.scopes) || req.scopes.length === 0 || !allScopesValid(req.scopes)) {
      throw new Error("approval gate: bad scopes");
    }
    if (
      typeof req.description !== "string" ||
      req.description.length === 0 ||
      req.description.length > TASK_LIMITS.descriptionMaxChars
    ) {
      throw new Error("approval gate: bad description");
    }
    if (
      req.documentBase64 !== undefined &&
      (typeof req.documentBase64 !== "string" ||
        req.documentBase64.length > Math.ceil((TASK_LIMITS.documentMaxBytes * 4) / 3) + 8)
    ) {
      throw new Error("approval gate: bad document");
    }
    if (typeof req.taskId !== "string" || req.taskId.length === 0) {
      throw new Error("approval gate: bad taskId");
    }
    const timeoutMs = req.timeoutMs ?? TASK_LIMITS.approvalTimeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error("approval gate: bad timeout");
    }
    // Anti-loopjacking: a second request for an already-pending taskId
    // cannot replace the bytes the user is looking at.
    const existing = this.byTaskId.get(req.taskId);
    if (existing !== undefined && this.pending.has(existing)) {
      throw new Error("approval gate: task already pending approval");
    }

    // Deep snapshot: later mutations of the caller's object cannot reach
    // the stored bytes.
    const snapshot: StoredEntry["snapshot"] = {
      taskId: req.taskId,
      description: req.description,
      resultSchema: JSON.parse(JSON.stringify(req.resultSchema ?? {})) as Record<
        string,
        unknown
      >,
    };
    if (req.documentBase64 !== undefined) snapshot.documentBase64 = req.documentBase64;
    // Nota: el snapshot interno NO se congela a propósito: la guarda es
    // el hash de integridad verificado en approve(). (Congelarlo
    // impediría simular la mutación en tests.)

    const requestId = `apr-${Date.now().toString(36)}-${(this.seq++).toString(36)}`;
    this.pending.set(requestId, {
      snapshot,
      hash: snapshotHash(snapshot),
      deadline: Date.now() + timeoutMs,
    });
    this.byTaskId.set(req.taskId, requestId);

    const shown: ShownRequest = Object.freeze({
      taskId: req.taskId,
      peerPkShort: req.peerPkShort,
      description: req.description,
      scopes: [...req.scopes],
      expiresAt: req.expiresAt,
    });
    return { requestId, shown };
  }

  /**
   * Approve a pending request. Returns the frozen task bytes for the
   * executor, or null (deny) when: unknown id, deadline passed
   * (timeout = deny), snapshot integrity check fails, or the approval
   * was already consumed. Never throws for these cases.
   */
  approve(requestId: string): ApprovedTask | null {
    const entry = this.pending.get(requestId);
    if (!entry) return null;
    this.pending.delete(requestId);
    this.byTaskId.delete(entry.snapshot.taskId);
    if (Date.now() > entry.deadline) return null; // timeout = deny
    if (snapshotHash(entry.snapshot) !== entry.hash) return null; // tamper = abort
    const out: ApprovedTask = {
      description: entry.snapshot.description,
      resultSchema: JSON.parse(JSON.stringify(entry.snapshot.resultSchema)) as Record<
        string,
        unknown
      >,
    };
    if (entry.snapshot.documentBase64 !== undefined) {
      out.documentBase64 = entry.snapshot.documentBase64;
    }
    return Object.freeze(out);
  }

  /** Deny (discard) a pending request. No-op for unknown ids. */
  deny(requestId: string): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    this.pending.delete(requestId);
    this.byTaskId.delete(entry.snapshot.taskId);
  }

  /** Number of undecided requests (test/introspection helper). */
  get pendingCount(): number {
    return this.pending.size;
  }
}
