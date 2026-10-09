/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * delegationService.ts — wiring for delegated task execution (v1).
 *
 * TESTFIX-2026-10-08 (Fix 7): the pieces existed (validators, tokens,
 * sandboxed executor, approval gate, approval card) but NOTHING wired
 * them to the transport or the UI — the feature flag was unread and
 * there was no TASK_REQUEST handler ("Contract for the future
 * TASK_REQUEST handler" in approvalGate.ts). This service is that
 * handler, plus the send path.
 *
 * SECURITY MODEL (unchanged from the audited pieces):
 * - Flag-gated: every entry point checks `delegation.enabled` FIRST.
 *   Flag OFF (default) → requests refused, incoming messages dropped
 *   silently. The rest of the P2P stack never sees task traffic.
 * - Tokens: Ed25519 Biscuit-style, bound to issuer/audience/task/
 *   negotiation/expiry (see delegationToken.ts).
 * - Human approval: per-task, no "always allow"; approvalGate gives the
 *   card byte-identical bytes to what executes (anti-loopjacking).
 * - Executor: scope firewall (3 v1 scopes), watchdog, peer-namespaced
 *   memory. The model invocation is injected.
 * - Audit: every state change goes to p2p_task_audit (both sides).
 */

import nacl from "tweetnacl";
import { isFeatureEnabled } from "../../config/featureFlags";
import {
  validateTaskMessage,
  TASK_LIMITS,
  isValidScope,
  type TaskMessageType,
  type TaskMessageBody,
  type TaskRequestBody,
  type TaskScope,
} from "../../p2p/taskProtocol";
import {
  issueDelegationToken,
  verifyDelegationToken,
} from "../../p2p/delegationToken";
import { toHex } from "../../p2p/crypto";
import { ApprovalGate, type ShownRequest } from "./approvalGate";
import { DelegatedExecutor } from "./executor";

/** UUID v4 via nacl.randomBytes (same pattern as messenger newId). */
function newTaskId(): string {
  const b = nacl.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return (
    `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-` +
    `${h.slice(16, 20)}-${h.slice(20, 32)}`
  );
}

export type DelegationSendFn = (
  peerPkHex: string,
  taskType: TaskMessageType,
  body: TaskMessageBody
) => Promise<boolean>;

export type DelegationEvent =
  | { type: "approval-pending"; requestId: string; shown: ShownRequest; peerName: string }
  | { type: "approval-resolved"; requestId: string; decision: "approved" | "denied" }
  | { type: "task-result"; taskId: string; ok: boolean; result?: unknown; error?: { code: string; message: string } }
  | { type: "task-rejected"; taskId: string; reasonCode: string }
  | { type: "task-requested"; taskId: string };

export interface RequestTaskParams {
  peerPkHex: string;
  negotiationId: string;
  description: string;
  scope: TaskScope;
  documentBase64?: string;
}

export class DelegationService {
  private static instance: DelegationService | null = null;
  private sendFn: DelegationSendFn | null = null;
  private modelInvoke: ((prompt: string) => Promise<string>) | null = null;
  private readonly gate = new ApprovalGate();
  private readonly handlers = new Set<(e: DelegationEvent) => void>();
  /** Outbound tasks awaiting result/reject, by taskId. */
  private readonly outbound = new Map<string, { peerPkHex: string; negotiationId: string }>();
  // FIX 2026-10-08: último resultado de tarea, sobrevive a la navegación.
  // El singleton vive más que la pantalla, así al volver se muestra.
  private lastTaskResult: { ok: boolean; text: string; at: number } | null = null;

  static getInstance(): DelegationService {
    if (!DelegationService.instance) {
      DelegationService.instance = new DelegationService();
    }
    return DelegationService.instance;
  }

  /** FIX 2026-10-08: devuelve el último resultado para restaurar la UI. */
  getLastTaskResult(): { ok: boolean; text: string; at: number } | null {
    return this.lastTaskResult;
  }

  /** FIX 2026-10-08: limpia el resultado mostrado. */
  clearLastTaskResult(): void {
    this.lastTaskResult = null;
  }

  /**
   * R5 (approvalGate): wires the live negotiation-state source so
   * approve() re-checks that the negotiation is still ACCEPTED at
   * approval time (TOCTOU close). Call once at startup with a sync
   * lookup into the negotiation sessions.
   */
  setNegotiationStateLookup(
    fn: (negotiationId: string) => string | undefined
  ): void {
    this.gate.setNegotiationStateProvider((taskId: string) => {
      const negId = this.taskNegotiation.get(taskId);
      if (!negId) return undefined;
      try {
        return fn(negId) as never;
      } catch {
        return undefined;
      }
    });
  }

  /** Test helper: fresh instance state without touching the singleton. */
  static resetForTests(): void {
    DelegationService.instance = null;
  }

  setSendFunction(fn: DelegationSendFn): void {
    this.sendFn = fn;
  }

  setModelInvoke(fn: (prompt: string) => Promise<string>): void {
    this.modelInvoke = fn;
  }

  subscribe(fn: (e: DelegationEvent) => void): () => void {
    this.handlers.add(fn);
    return () => {
      this.handlers.delete(fn);
    };
  }

  private emit(e: DelegationEvent): void {
    for (const h of this.handlers) {
      try {
        h(e);
      } catch {
        /* subscriber errors never break the service */
      }
    }
  }

  get approvalGate(): ApprovalGate {
    return this.gate;
  }

  /** Outbound: ask a connected peer to run a task. */
  async requestTask(params: RequestTaskParams): Promise<
    { ok: true; taskId: string } | { ok: false; reason: string }
  > {
    if (!isFeatureEnabled("delegation.enabled")) {
      return { ok: false, reason: "disabled" };
    }
    if (!this.sendFn) {
      return { ok: false, reason: "no_send_fn" };
    }
    if (!isValidScope(params.scope)) {
      return { ok: false, reason: "unsupported_scope" };
    }
    const desc = params.description.trim();
    if (!desc || desc.length > TASK_LIMITS.descriptionMaxChars) {
      return { ok: false, reason: "bad_description" };
    }

    // Negotiation must be ACCEPTED (fail-closed).
    const { negotiationService } = await import("../../p2p/negotiationService");
    const session = negotiationService
      .listSessions()
      .find((s) => s.negotiationId === params.negotiationId);
    if (!session || session.state !== "ACCEPTED") {
      return { ok: false, reason: "negotiation_not_accepted" };
    }

    // Peer's signing key (token audience) from the paired contact.
    const { findContactByPk, getSigningKeypair } = await import("../../p2p/store");
    const contact = await findContactByPk(params.peerPkHex);
    const audienceHex = (contact as { sigPkHex?: string } | null)?.sigPkHex;
    if (!audienceHex) {
      return { ok: false, reason: "no_peer_signing_key" };
    }
    let issuerHex: string;
    let secretKey: Uint8Array;
    try {
      const kp = await getSigningKeypair();
      issuerHex = toHex(kp.publicKey);
      secretKey = kp.secretKey;
    } catch {
      return { ok: false, reason: "no_identity" };
    }

    const taskId = newTaskId();
    const expiresAt = Date.now() + TASK_LIMITS.tokenLifetimeMs;
    let token: string;
    try {
      token = issueDelegationToken(secretKey, {
        issuer: issuerHex,
        audience: audienceHex,
        negotiationId: params.negotiationId,
        taskId,
        scopes: [params.scope],
        issuedAt: Date.now(),
        expiresAt,
      });
    } catch (e) {
      // FIX 2026-10-08: no tragar el motivo específico. Sigue siendo
      // fail-closed (no se envía nada), pero el motivo llega a la UI para
      // diagnóstico. Solo contiene la validación que falló, ningún secreto.
      const detail = e instanceof Error ? e.message : String(e);
      return { ok: false, reason: `token_issue_failed:${detail}` };
    }

    const body: TaskRequestBody = {
      negotiationId: params.negotiationId,
      taskId,
      description: desc,
      resultSchema: { type: "string" },
      delegationToken: token,
      expiresAt,
      maxDurationMs: TASK_LIMITS.maxDurationMs,
      ...(params.documentBase64 !== undefined
        ? { documentBase64: params.documentBase64 }
        : {}),
    };
    const sent = await this.sendFn(params.peerPkHex.toLowerCase(), "TASK_REQUEST", body);
    if (!sent) {
      return { ok: false, reason: "send_failed" };
    }
    this.outbound.set(taskId, {
      peerPkHex: params.peerPkHex.toLowerCase(),
      negotiationId: params.negotiationId,
    });
    await this.audit({
      taskId,
      negotiationId: params.negotiationId,
      direction: "out",
      peerPkHex: params.peerPkHex,
      scopes: [params.scope],
      state: "requested",
    });
    this.emit({ type: "task-requested", taskId });
    return { ok: true, taskId };
  }

  /**
   * Inbound: dispatch a task message from the transport.
   * Flag OFF → dropped silently (fail-closed, no observable difference).
   */
  async handleTaskMessage(
    fromPkHex: string,
    taskType: TaskMessageType,
    rawBody: unknown
  ): Promise<void> {
    if (!isFeatureEnabled("delegation.enabled")) return;
    const body = validateTaskMessage(taskType, rawBody);
    if (!body) return; // malformed → drop

    if (taskType === "TASK_REQUEST") {
      await this.handleTaskRequest(fromPkHex.toLowerCase(), body as TaskRequestBody);
      return;
    }
    // FIX 2026-10-09 (I2): TASK_CANCEL puede ser para una tarea INBOUND
    // (el peer cancela lo que nos pidió). Manejarlo ANTES del check de
    // outbound, si no se dropea y el abort() nunca se llama.
    if (taskType === "TASK_CANCEL") {
      const cancelTaskId = (body as { taskId: string }).taskId.toLowerCase();
      // Cancelar aprobación pendiente si la hay.
      for (const [requestId, ctx] of this.inboundIndex) {
        if (ctx.taskId === cancelTaskId) {
          await this.denyTask(requestId);
        }
      }
      // Abortar executor en curso si lo hay (F-DELEG-3).
      const running = this.runningExecutors.get(cancelTaskId);
      if (running) {
        running.abort();
      }
      return;
    }
    // Responses reference an outbound task we track.
    const taskId = (body as { taskId: string }).taskId.toLowerCase();
    const tracked = this.outbound.get(taskId);
    if (!tracked) return; // unknown task → drop
    if (taskType === "TASK_RESULT") {
      const r = body as { ok: boolean; result?: unknown; error?: { code: string; message: string } };
      this.outbound.delete(taskId);
      await this.audit({
        taskId,
        negotiationId: tracked.negotiationId,
        direction: "out",
        peerPkHex: tracked.peerPkHex,
        scopes: [],
        state: r.ok ? "result_ok" : "result_error",
        errorCode: r.ok ? null : r.error?.code ?? "unknown",
      });
      this.emit({ type: "task-result", taskId, ok: r.ok, result: r.result, error: r.error });
      // FIX 2026-10-08: persistir para que sobreviva a la navegación.
      this.lastTaskResult = {
        ok: r.ok,
        text: r.ok ? String(r.result ?? "") : `Error: ${r.error?.code ?? "unknown"}`,
        at: Date.now(),
      };
    } else if (taskType === "TASK_REJECT") {
      const r = body as { reasonCode: string };
      this.outbound.delete(taskId);
      await this.audit({
        taskId,
        negotiationId: tracked.negotiationId,
        direction: "out",
        peerPkHex: tracked.peerPkHex,
        scopes: [],
        state: "rejected",
        errorCode: r.reasonCode,
      });
      this.emit({ type: "task-rejected", taskId, reasonCode: r.reasonCode });
    }
    // TASK_STATUS: informational; v1 UI does not surface progress.
  }

  private async handleTaskRequest(fromPkHex: string, body: TaskRequestBody): Promise<void> {
    // Verify the delegation token against the peer's known signing key.
    const { findContactByPk, getSigningKeypair } = await import("../../p2p/store");
    const contact = await findContactByPk(fromPkHex);
    const peerSigHex = (contact as { sigPkHex?: string } | null)?.sigPkHex;
    if (!peerSigHex) return; // unknown peer → drop
    let mySigHex: string;
    try {
      mySigHex = toHex((await getSigningKeypair()).publicKey);
    } catch {
      return;
    }
    const verified = verifyDelegationToken(
      body.delegationToken,
      peerSigHex,
      mySigHex
    );
    if (!verified) return; // bad token → drop
    if (verified.root.taskId !== body.taskId.toLowerCase()) return;
    if (verified.root.negotiationId !== body.negotiationId) return;

    // Negotiation must be ACCEPTED right now.
    const { negotiationService } = await import("../../p2p/negotiationService");
    const session = negotiationService
      .listSessions()
      .find((s) => s.negotiationId === body.negotiationId);
    const negState = session?.state ?? "UNKNOWN";

    let shown: ShownRequest;
    let requestId: string;
    try {
      const reg = this.gate.register({
        taskId: body.taskId,
        peerPkShort: fromPkHex.slice(0, 16),
        description: body.description,
        documentBase64: body.documentBase64,
        resultSchema: body.resultSchema,
        scopes: verified.root.scopes,
        negotiationState: negState as never,
        expiresAt: body.expiresAt,
      });
      requestId = reg.requestId;
      shown = reg.shown;
    } catch {
      // Gate rejected (bad state/scopes/cap) → tell the peer.
      await this.sendReject(fromPkHex, body.taskId, "denied");
      return;
    }

    const peerName = (contact as { name?: string } | null)?.name ?? fromPkHex.slice(0, 8);
    // Index for approve()/deny() and the R5 liveness re-check.
    this.inboundIndex.set(requestId, {
      taskId: body.taskId.toLowerCase(),
      peerPkHex: fromPkHex,
      negotiationId: body.negotiationId,
      scopes: verified.root.scopes,
      maxDurationMs: Math.min(body.maxDurationMs, TASK_LIMITS.maxDurationMs),
      // FIX 2026-10-09 (F-DELEG-1): pasar los límites del token al executor.
      // Antes se calculaban pero se ignoraban (security theater).
      maxToolCalls: verified.effective.maxToolCalls,
      resultSizeLimit: verified.effective.resultSizeLimit,
    });
    this.taskNegotiation.set(body.taskId.toLowerCase(), body.negotiationId);
    await this.audit({
      taskId: body.taskId,
      negotiationId: body.negotiationId,
      direction: "in",
      peerPkHex: fromPkHex,
      scopes: verified.root.scopes,
      state: "approval_pending",
      decidedBy: "human",
    });
    this.emit({ type: "approval-pending", requestId, shown, peerName });
  }

  /** Human approved on the card. Executes and returns the result. */
  async approveTask(requestId: string): Promise<boolean> {
    if (!isFeatureEnabled("delegation.enabled")) return false;
    const approved = this.gate.approve(requestId);
    // The gate does not reveal which taskId a requestId maps to after
    // deny/timeout; we track the mapping via the shown snapshot at
    // register time. For v1, find the outbound... (inbound path):
    // re-derive from pending approvals is unavailable post-consume, so
    // the UI must pass the task context. Simplify: look up via event
    // payloads is out of scope — instead we keep an index.
    const ctx = this.inboundIndex.get(requestId);
    if (!approved || !ctx) {
      if (ctx) {
        await this.sendReject(ctx.peerPkHex, ctx.taskId, "denied");
      }
      this.inboundIndex.delete(requestId);
      this.emit({ type: "approval-resolved", requestId, decision: "denied" });
      return false;
    }
    this.inboundIndex.delete(requestId);
    this.emit({ type: "approval-resolved", requestId, decision: "approved" });

    if (!this.modelInvoke) {
      await this.sendReject(ctx.peerPkHex, ctx.taskId, "denied");
      return false;
    }
    const executor = new DelegatedExecutor({
      scopes: ctx.scopes,
      peerPkShort: ctx.peerPkHex.slice(0, 16),
      maxDurationMs: ctx.maxDurationMs,
      // FIX 2026-10-09 (F-DELEG-1): respetar los límites del token.
      maxToolCalls: ctx.maxToolCalls,
      resultSizeLimit: ctx.resultSizeLimit,
      modelInvoke: this.modelInvoke,
    });
    // F-DELEG-3: registrar para poder abortar en TASK_CANCEL.
    this.runningExecutors.set(ctx.taskId, executor);
    let result;
    try {
      result = await executor.execute({
        description: approved.description,
        documentBase64: approved.documentBase64,
        resultSchema: approved.resultSchema,
      });
    } finally {
      this.runningExecutors.delete(ctx.taskId);
    }
    await this.audit({
      taskId: ctx.taskId,
      negotiationId: ctx.negotiationId,
      direction: "in",
      peerPkHex: ctx.peerPkHex,
      scopes: ctx.scopes,
      state: result.ok ? "executed_ok" : "executed_error",
      decision: "approved",
      decidedBy: "human",
      toolCalls: result.toolCalls,
      errorCode: result.ok ? null : result.error?.code ?? "unknown",
    });
    if (this.sendFn) {
      await this.sendFn(ctx.peerPkHex, "TASK_RESULT", {
        taskId: ctx.taskId,
        ok: result.ok,
        ...(result.ok
          ? { result: result.result ?? null }
          : { error: result.error ?? { code: "executor_error", message: "failed" } }),
      });
    }
    return result.ok;
  }

  /** Human denied on the card. */
  async denyTask(requestId: string): Promise<void> {
    if (!isFeatureEnabled("delegation.enabled")) return;
    this.gate.deny(requestId);
    const ctx = this.inboundIndex.get(requestId);
    this.inboundIndex.delete(requestId);
    if (ctx) {
      await this.sendReject(ctx.peerPkHex, ctx.taskId, "denied");
      await this.audit({
        taskId: ctx.taskId,
        negotiationId: ctx.negotiationId,
        direction: "in",
        peerPkHex: ctx.peerPkHex,
        scopes: ctx.scopes,
        state: "denied",
        decision: "denied",
        decidedBy: "human",
      });
    }
    this.emit({ type: "approval-resolved", requestId, decision: "denied" });
  }

  /** requestId -> inbound task context (populated at register time). */
  private readonly inboundIndex = new Map<
    string,
    {
      taskId: string;
      peerPkHex: string;
      negotiationId: string;
      scopes: TaskScope[];
      maxDurationMs: number;
      maxToolCalls?: number;
      resultSizeLimit?: number;
    }
  >();

  /** taskId -> negotiationId (R5 liveness re-check at approve time). */
  private readonly taskNegotiation = new Map<string, string>();
  // FIX 2026-10-09 (F-DELEG-3): executors en curso por taskId, para abortar en TASK_CANCEL.
  private readonly runningExecutors = new Map<string, DelegatedExecutor>();

  /** Test/introspection: pending approvals. */
  get pendingApprovals(): number {
    return this.gate.pendingCount;
  }

  private async sendReject(
    peerPkHex: string,
    taskId: string,
    reasonCode: "denied" | "timeout" | "expired" | "invalid_token" | "unsupported_scope" | "busy"
  ): Promise<void> {
    if (!this.sendFn) return;
    try {
      await this.sendFn(peerPkHex, "TASK_REJECT", { taskId, reasonCode });
    } catch {
      /* best-effort */
    }
  }

  private async audit(entry: {
    taskId: string;
    negotiationId: string;
    direction: "in" | "out";
    peerPkHex: string;
    scopes: string[];
    state: string;
    decision?: string | null;
    decidedBy?: string | null;
    toolCalls?: number;
    errorCode?: string | null;
  }): Promise<void> {
    try {
      const { logTaskAudit } = await import("../../p2p/store");
      await logTaskAudit({
        taskId: entry.taskId,
        negotiationId: entry.negotiationId,
        direction: entry.direction,
        peerPkHex: entry.peerPkHex,
        scopes: entry.scopes,
        state: entry.state,
        decidedBy: entry.decidedBy ?? null,
        decision: entry.decision ?? null,
        toolCalls: entry.toolCalls,
        errorCode: entry.errorCode ?? null,
      });
    } catch {
      /* audit is best-effort; the security decision never depends on it */
    }
  }

}

export const delegationService = DelegationService.getInstance();
