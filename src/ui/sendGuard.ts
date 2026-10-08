/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * N3 (2026-09-28): synchronous in-flight guard for ChatScreen.send().
 *
 * The audit finding: two rapid taps could both persist a message and start a
 * generation, because the guard was closure-captured React state
 * (`generating`) — batched state updates mean the second tap still sees
 * `generating === false`. A ref set synchronously at send entry is observed
 * by every later tap in the same tick, so at most one send body runs.
 *
 * Protocol (used verbatim by ChatScreen.send):
 *   if (!guard.tryAcquire()) return;   // synchronous check-and-set
 *   try {
 *     ... entire send body, awaits and early returns included ...
 *   } finally {
 *     guard.release();                 // always released: error paths too
 *   }
 *
 * The `finally` is load-bearing: without it, an exception (e.g. session
 * creation or persistence failing mid-send) would wedge the send button
 * permanently blocked. Release-on-error keeps error/retry working.
 */
export class SendGuard {
  private active = false;

  /** Atomically check-and-set. Returns false if a send is already in flight. */
  tryAcquire(): boolean {
    if (this.active) return false;
    this.active = true;
    return true;
  }

  /** Release the guard. Idempotent — releasing an idle guard is a no-op. */
  release(): void {
    this.active = false;
  }

  get isActive(): boolean {
    return this.active;
  }
}

/**
 * Reference implementation of the guarded-send protocol, for tests and any
 * future send path. ChatScreen.send() inlines the same protocol (it cannot
 * delegate to this helper without re-indenting its ~500-line body).
 */
export async function runGuardedSend<T>(
  guard: SendGuard,
  work: () => Promise<T>
): Promise<{ ran: boolean; value?: T }> {
  if (!guard.tryAcquire()) return { ran: false };
  try {
    return { ran: true, value: await work() };
  } finally {
    guard.release();
  }
}
