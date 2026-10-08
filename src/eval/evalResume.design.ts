/**
 * MIT License
 * Copyright (c) 2026 aoair contributors (original BOAR code)
 * Copyright (c) 2026 NIDO contributors (modifications)
 * See LICENSE file for details.
 */

/**
 * Eval Resume with Restore Points - Design for NIDO
 *
 * Adapted from BOAR's eval-resume feature (MIT). BOAR's implementation:
 * - src/eval/evalResume.pure.ts (new)
 * - src/eval/evalResume.test.ts (new)
 * - Modified: src/eval/evalHarness.ts, src/ui/EvaluationScreen.tsx
 *
 * NIDO's eval harness (src/eval/evalHarness.ts) runs long on-device sessions.
 * If interrupted (app killed, device reboot, user navigates away), the entire
 * run is lost. Resume avoids losing hours to an interruption.
 *
 * ## Design (NIDO-specific)
 *
 * ### Restore Point Format
 * ```typescript
 * interface EvalRestorePoint {
 *   runId: string;           // Unique ID for this eval run
 *   harnessVersion: number;  // Format version for compatibility
 *   startedAt: number;       // Timestamp when run started
 *   updatedAt: number;       // Timestamp of last restore point save
 *   completedIndices: number[]; // Indices of completed eval items
 *   results: EvalResult[];   // Results so far
 *   config: EvalConfig;      // The config used for this run
 * }
 * ```
 *
 * ### Storage
 * - Stored in the app's private files directory (not the encrypted DB -
 *   eval results aren't user-sensitive, and file I/O is simpler for
 *   large result sets)
 * - Filename: `eval-restore-{runId}.json`
 * - Saved after each completed item (or every N items for performance)
 * - Deleted on successful completion or explicit user discard
 *
 * ### Resume Flow
 * 1. User starts eval → check for existing restore points
 * 2. If found, offer "Resume" vs "Start fresh"
 * 3. On resume: load restore point, skip completedIndices, continue
 * 4. On fresh: delete old restore points, start new runId
 *
 * ### Edge Cases (from BOAR's self-review)
 * - **Blocked models**: If the model used in the restore point is no longer
 *   available (deleted, corrupted), fail with clear message, don't silently
 *   switch models (would invalidate comparison)
 * - **Config mismatch**: If current config differs from restore point's
 *   config (different eval set, different parameters), warn user - results
 *   may not be comparable
 * - **Corrupted restore point**: If JSON is invalid, offer to start fresh,
 *   don't crash
 * - **Version mismatch**: If harnessVersion differs, refuse to resume
 *   (format may have changed)
 * - **Concurrent runs**: Only one resumeable run at a time; new run
 *   archives or deletes the old restore point
 *
 * ### NIDO-specific considerations
 * - NIDO's harness uses `evalHarness.pure.ts` for testable logic - the
 *   resume logic should also be pure and testable
 * - Results include timing/memory metrics - these are still valid on resume
 * - The UI (EvaluationScreen) needs a "Resume" button when restore points exist
 *
 * ## Status
 * Design complete. Implementation pending - requires:
 * 1. `src/eval/evalResume.pure.ts` (pure logic, testable)
 * 2. `src/eval/evalResume.test.ts` (tests for edge cases)
 * 3. Integration into `src/eval/evalHarness.ts`
 * 4. UI updates in EvaluationScreen
 *
 * Priority: Medium. Valuable for long eval runs, but not blocking core
 * functionality. Implement after higher-priority items.
 */

export {};
