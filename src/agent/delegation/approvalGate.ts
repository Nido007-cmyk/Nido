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
 * 7. R5: liveness re-check on approve — if the peer sent TASK_CANCEL while
 *    the human stared at the card, approve() denies instead of executing a
 *    cancelled task (TOCTOU). Wired via setNegotiationStateProvider().
 * 8. R5: per-peer pending cap (TASK_LIMITS.maxPendingPerPeer) + lazy sweep
 *    of expired entries on register(). The pending map can no longer grow
 *    without bound (memory-exhaustion DoS via 512 KB documents).
 *
 * Contract for the future TASK_REQUEST handler (feature flag OFF in v1):
 * render the card from `register()`'s `shown`, and pass `approve()`'s
 * output — never a re-fetched object — to the executor. The handler MUST
 * call setNegotiationStateProvider() so approve() can re-check liveness.
 */

import nacl from "tweetnacl";
import { toHex, utf8Encode, utf8Decode } from "../../p2p/crypto";
import { decodeBase64 } from "../../p2p/base64";
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
  /**
   * R4: el documento adjunto (task:summarize) es la carga útil real que el
   * modelo procesará. El humano debe ver al menos su huella, su tamaño y un
   * extracto antes de aprobar: aprobar sin verlo es aprobar a ciegas.
   * Ausente cuando la tarea no trae documento.
   */
  document?: {
    /** SHA-512 hex de los bytes decodificados. */
    sha512Hex: string;
    /** Tamaño en bytes decodificados. */
    sizeBytes: number;
    /** Primeros caracteres del texto decodificado (no confiable). */
    preview: string;
  };
}

/** What the executor receives on approval (frozen). */
export interface ApprovedTask {
  description: string;
  documentBase64?: string;
  resultSchema: Record<string, unknown>;
}

/**
 * R5: live negotiation-state lookup, wired by the TASK_REQUEST handler.
 * Returns the CURRENT state for a taskId, or undefined if unknown.
 */
export type NegotiationStateProvider = (
  taskId: string
) => NegotiationState | undefined;

interface StoredEntry {
  peerPkShort: string;
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

/** Caracteres del documento visibles en la tarjeta de aprobación. */
const DOCUMENT_PREVIEW_CHARS = 500;

/**
 * R4: describe el documento adjunto para que el humano lo revise antes de
 * aprobar. La huella liga lo mostrado con lo que ejecutará el executor:
 * cualquier sustitución del documento entre la tarjeta y la ejecución se
 * detectaría comparando huellas.
 */
function describeDocument(
  documentBase64: string
): NonNullable<ShownRequest["document"]> {
  const bytes = decodeBase64(documentBase64);
  return {
    sha512Hex: toHex(nacl.hash(bytes)),
    sizeBytes: bytes.length,
    preview: utf8Decode(bytes).slice(0, DOCUMENT_PREVIEW_CHARS),
  };
}

export class ApprovalGate {
  private readonly pending = new Map<string, StoredEntry>();
  private readonly byTaskId = new Map<string, string>();
  private readonly pendingByPeer = new Map<string, number>();
  /**
   * FIX 2026-10-09 (F-DELEG-2): taskIds ya ejecutados. Un token rejugado
   * (mismo taskId después de completar) se rechaza aquí en vez de generar
   * una segunda tarjeta de aprobación.
   * FIX 2026-10-09 (H-4): acotado a 1000 entradas (LRU). Sin límite, un
   * atacante podría llenar memoria con taskIds falsos.
   */
  private readonly executed = new Set<string>();
  private static readonly MAX_EXECUTED = 1000;
  private stateProvider: NegotiationStateProvider | null = null;
  private seq = 0;
  /**
   * FIX 2026-10-09: protección contra fatiga de aprobación. Si un peer
   * malicioso inunda con solicitudes, el humano termina aprobando sin leer.
   * Máximo 10 aprobaciones por hora (ventana deslizante).
   */
  private readonly approvalTimestamps: number[] = [];
  private static readonly MAX_APPROVALS_PER_HOUR = 10;

  /**
   * R5: wires the live negotiation-state source. The future TASK_REQUEST
   * handler MUST set this so approve() can re-check that the negotiation
   * is still ACCEPTED at approval time (TOCTOU close).
   */
  setNegotiationStateProvider(fn: NegotiationStateProvider): void {
    this.stateProvider = fn;
  }

  /**
   * R5: lazy sweep of expired-but-undecided entries. Runs on register()
   * so the pending map cannot accumulate dead entries (and their 512 KB
   * documents) when the human never acts.
   */
  private sweepExpired(): void {
    const now = Date.now();
    for (const [requestId, entry] of this.pending) {
      if (now > entry.deadline) {
        this.releaseSlot(requestId, entry);
      }
    }
  }

  /** Removes an entry from all indexes and frees its per-peer slot. */
  private releaseSlot(requestId: string, entry: StoredEntry): void {
    this.pending.delete(requestId);
    this.byTaskId.delete(entry.snapshot.taskId);
    const n = (this.pendingByPeer.get(entry.peerPkShort) ?? 1) - 1;
    if (n <= 0) this.pendingByPeer.delete(entry.peerPkShort);
    else this.pendingByPeer.set(entry.peerPkShort, n);
  }

  /**
   * Register a task request for human approval. Returns the request id
   * and the frozen bytes to render on the card. Throws (fail-closed) on
   * any invalid input, a non-ACCEPTED negotiation, a duplicate
   * pending taskId, or a per-peer pending cap breach.
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
        req.documentBase64.length >
          Math.ceil((TASK_LIMITS.documentMaxBytes * 4) / 3) + 8 ||
        // R4: alinear con validateTaskRequest (taskProtocol.ts): el charset
        // debe ser base64 estricto. Sin esto, un decodificador que descarta
        // caracteres inválidos en silencio decodificaría bytes distintos de
        // los que el humano "aprobó".
        !/^[A-Za-z0-9+/=]*$/.test(req.documentBase64))
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
    // R5: primero barrer expirados para liberar slots, luego aplicar el
    // tope por peer. Sin el tope, un peer malicioso llena el mapa con
    // documentos de 512 KB (memory-exhaustion DoS).
    this.sweepExpired();
    const peerPending = this.pendingByPeer.get(req.peerPkShort) ?? 0;
    if (peerPending >= TASK_LIMITS.maxPendingPerPeer) {
      throw new Error("approval gate: too many pending requests for this peer");
    }
    // Anti-loopjacking: a second request for an already-pending taskId
    // cannot replace the bytes the user is looking at.
    const existing = this.byTaskId.get(req.taskId);
    if (existing !== undefined && this.pending.has(existing)) {
      throw new Error("approval gate: task already pending approval");
    }
    // FIX 2026-10-09 (F-DELEG-2): anti-replay. Un taskId ya ejecutado no
    // puede volver a pedir aprobación (el token rejugado se rechaza).
    if (this.executed.has(req.taskId)) {
      throw new Error("approval gate: task already executed (replay rejected)");
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
      peerPkShort: req.peerPkShort,
      snapshot,
      hash: snapshotHash(snapshot),
      deadline: Date.now() + timeoutMs,
    });
    this.byTaskId.set(req.taskId, requestId);
    this.pendingByPeer.set(req.peerPkShort, peerPending + 1);

    const shown: ShownRequest = Object.freeze({
      taskId: req.taskId,
      peerPkShort: req.peerPkShort,
      description: req.description,
      scopes: [...req.scopes],
      expiresAt: req.expiresAt,
      // R4: el humano ve la huella, el tamaño y un extracto del documento
      // que el modelo procesará. Sin esto, la garantía "aprueba lo que ve"
      // era vacua para task:summarize (el payload real es el documento).
      ...(req.documentBase64 !== undefined
        ? { document: describeDocument(req.documentBase64) }
        : {}),
    });
    return { requestId, shown };
  }

  /**
   * Approve a pending request. Returns the frozen task bytes for the
   * executor, or null (deny) when: unknown id, deadline passed
   * (timeout = deny), snapshot integrity check fails, the approval
   * was already consumed, or (R5) the negotiation is no longer ACCEPTED
   * at approval time (TASK_CANCEL during the human's dwell time).
   * Never throws for these cases.
   */
  approve(requestId: string): ApprovedTask | null {
    const entry = this.pending.get(requestId);
    if (!entry) return null;
    // FIX 2026-10-09: rate limit contra fatiga de aprobación.
    const now = Date.now();
    const hourAgo = now - 3600_000;
    while (this.approvalTimestamps.length > 0 && this.approvalTimestamps[0] < hourAgo) {
      this.approvalTimestamps.shift();
    }
    if (this.approvalTimestamps.length >= ApprovalGate.MAX_APPROVALS_PER_HOUR) {
      return null; // demasiadas aprobaciones recientes → fail-closed
    }
    this.releaseSlot(requestId, entry);
    if (Date.now() > entry.deadline) return null; // timeout = deny
    if (snapshotHash(entry.snapshot) !== entry.hash) return null; // tamper = abort
    // R5 TOCTOU close: re-verificar que la negociación sigue ACCEPTED.
    // Sin esto, un TASK_CANCEL del peer mientras el humano mira la tarjeta
    // se ignoraba y se ejecutaba una tarea cancelada.
    // FIX 2026-10-09 (F-DELEG-4): fail-closed si no hay provider. Antes era
    // fail-open silencioso.
    if (!this.stateProvider) {
      return null; // sin provider no se puede verificar → no se aprueba
    }
    let current: NegotiationState | undefined;
    try {
      current = this.stateProvider(entry.snapshot.taskId);
    } catch {
      return null; // fail-closed: si no se puede verificar, no se aprueba
    }
    if (current !== "ACCEPTED") return null;
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
    // FIX 2026-10-09 (F-DELEG-2): marcar como ejecutado para anti-replay.
    // FIX 2026-10-09 (H-4): acotar el set (evict oldest si excede).
    if (this.executed.size >= ApprovalGate.MAX_EXECUTED) {
      const oldest = this.executed.values().next().value;
      if (oldest) this.executed.delete(oldest);
    }
    this.executed.add(entry.snapshot.taskId);
    // FIX 2026-10-09: registrar timestamp para rate limit.
    this.approvalTimestamps.push(Date.now());
    return Object.freeze(out);
  }

  /** Deny (discard) a pending request. No-op for unknown ids. */
  deny(requestId: string): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    this.releaseSlot(requestId, entry);
  }

  /** Number of undecided requests (test/introspection helper). */
  get pendingCount(): number {
    return this.pending.size;
  }
}
