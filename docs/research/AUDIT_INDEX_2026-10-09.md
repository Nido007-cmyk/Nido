# NIDO — Audit package executive summary — 2026-10-09

**Method:** four parallel read-only audits (no source modified). Full reports:
- [AUDIT_BUGS_2026-10-09.md](sandbox://workspace/nido-app/docs/research/AUDIT_BUGS_2026-10-09.md) — 21 findings (2 high, 9 medium, 10 low)
- [AUDIT_SECURITY_2026-10-09.md](sandbox://workspace/nido-app/docs/research/AUDIT_SECURITY_2026-10-09.md) — 8 findings (0 critical, 4 verified issues, 2 design gaps)
- [AUDIT_TECH_SCOUT_2026-10-09.md](sandbox://workspace/nido-app/docs/research/AUDIT_TECH_SCOUT_2026-10-09.md) — 16 projects evaluated, all licenses verified
- [AUDIT_ARCHITECTURE_2026-10-09.md](sandbox://workspace/nido-app/docs/research/AUDIT_ARCHITECTURE_2026-10-09.md) — 18 prioritized recommendations

**Headline:** no critical security issues; the security architecture is disciplined (fail-closed defaults, code matches threat models). The two highest-severity bugs are both in the P2P reconnect path shipped in the 2026-10-08/09 batches — they are live now and should be fixed first.

---

## Top 10 findings (ranked by severity × effort — high value, low cost first)

### 1. B1 — Two live auto-reconnect loops fire on every disconnect · HIGH · ~2h
`nativeTransport.ts:1223` (transport-level `scheduleReconnect`, added 2026-10-09) and the UI-level `reconnectManager` singleton (`NidoScreen.tsx:333-351`) both fire on every socket drop: duplicate HELLO storms, radio contention, and they race into `connect()`. Fix: retire one (keep the transport-level, state-driven loop). → AUDIT_BUGS §B1

### 2. B2 — `connect()` hijacks an in-flight handshake's promise · HIGH · ~2h
`nativeTransport.ts:665-670`: a second `connect()` for the same MAC overwrites the first caller's resolve/reject — the first promise never settles → "Connecting…" spinner stuck forever (double-tap, or the B1 race). Fix: multicast settle-all or reject-second. → AUDIT_BUGS §B2

### 3. F-DELEG-1 — Delegation token caveat limits computed but never enforced · MEDIUM (security) · ~half day
`verifyDelegationToken` folds `maxToolCalls`/`resultSizeLimit` into `effective`, but `handleTaskRequest` drops it and the executor falls back to looser defaults. The attenuation mechanism is security theater until wired. → AUDIT_SECURITY §F-DELEG-1

### 4. K1 — `restoreBackup` never opens the backup with the current DEK · HIGH · ~half day
`src/security/backup.ts:189-244`: the module header claims BK-3 validation (open with DEK before overwriting) but `validateBackup` only checks magic bytes. Restoring a backup from a different key bricks the DB with no UI recovery path. Fix: implement the documented check. → AUDIT_BUGS §K1

### 5. F-DELEG-2 — No inbound executed-taskId replay tracking · MEDIUM (security) · ~1 day
A valid token replayed within its 15-min window produces a second approval card after the first task completes (human-gated, but replay-amplification + user confusion). Also wire the dead `sessionTag` binding. → AUDIT_SECURITY §F-DELEG-2

### 6. A1 — System prompt injects the UTC date as "today" · MEDIUM · ~1h
`agentLoop.ts:338-343`: `toISOString()` (UTC) vs `toLocaleDateString` (local) disagree after ~17:00 local in UTC− zones; model and pre-router can ground dates a day apart. Fix: build ISO from local parts. → AUDIT_BUGS §A1

### 7. D3 — Missing `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` · value · ~half day
Zero hits repo-wide. NIDO distributes its APK directly (Play policy doesn't apply). Add to the battery-settings checklist alongside the exact-alarm grant flow (BATCH3). Direct P2P-service survival win on Samsung/Xiaomi-style OEMs. → AUDIT_TECH_SCOUT §D3

### 8. Token-batched `setMessages` · perf quick win · ~2h
`ChatScreen.tsx`: `onToken` calls `setMessages` on **every generated token**, re-rendering the full message list per token in a 1942-line component. Flush at ~100ms instead — the cheapest big UX win in the audit. → AUDIT_ARCHITECTURE §5

### 9. K2 — Manifest SHA-256 computed over wrong bytes, never verified · MEDIUM · ~half day
`sha256File` UTF-8-expands bytes ≥0x80 before hashing (stored hash matches nothing), and nothing on the restore path reads the manifest. Fix both together. → AUDIT_BUGS §K2

### 10. Dead code deletion · hygiene · ~2h
`dualModelIntegration.ts`, `knowledgeGraph*.ts`, `p2p/sessionManager.ts`, `p2p/capabilityDiscovery.ts` — zero production callers (verified). Dead security-adjacent code invites future misuse. One deletion commit after owner confirms intent. → AUDIT_ARCHITECTURE §2

---

## Recommended implementation roadmap (respects the single-lane rule)

**Lane 1 — P2P reconnect correctness (this week, highest urgency)**
B1 + B2 + B3 (disconnect-during-handshake ghost) + B5 (counter reset). All in `nativeTransport.ts` + one wiring change in `NidoScreen.tsx`. Gate: targeted tests + full suite + physical two-tablet session. Effort: 1–2 days.

**Lane 2 — Delegation hardening (next)**
F-DELEG-1 + F-DELEG-2 + F-DELEG-4 (fail-closed gate default) + F-DELEG-3 (cooperative cancel). Same subsystem, same tests. Effort: 2–3 days.

**Lane 3 — Backup/restore correctness**
K1 + K2 + K3 (restore knowledge DB) + K4/K5 (copyable key behind biometric). The backup flow the user is about to rely on. Effort: 2–3 days.

**Lane 4 — Quick wins batch**
A1 + A2 (past-date guard) + N1 (session alert flag) + D3 (battery exemption) + token-batched rendering + dead-code deletion + PT key parity (I1). Small, independent, one push. Effort: 2–3 days.

**Lane 5 — RAG architecture (dedicated)**
C1 interface-per-piece seams + numbered citeable blocks (Phase 3) + RRF fusion refinement. Gate: retrieval eval. Effort: ~1 week.

**Lane 6 — Structural refactors (planned, not urgent)**
God-component splits (`ChatScreen`, `p2p/store.ts`, `messenger.ts`), ToolCall unification, DEK rotation runbook. Each its own lane with physical-gate testing. Effort: weeks.

**Upstream watches (no code yet):** llama.rn param exposure (`n_threads_batch`, `ctx_shift`, prompt-cache), MediaPipe embedder privacy opt-out verification, MNN/bitnet.cpp as long-term runtime candidates.

---

## Honesty notes

- Security: **no criticals**. The 2 medium delegation findings are real but require a malicious/compromised paired peer; the handshake, key management, and component exposure all verified clean.
- The scariest bugs (B1, B2) came from the last 48h of batching — the audit caught what the test suite couldn't (wiring-level interactions).
- Tech scout: 16 projects, licenses verified 2026-10-09. Adaptable (permissive): MNN, bitnet.cpp, StreamingLLM, PowerInfer, ExecuTorch, android-BluetoothChat, Nordic BLE lib, Kable, on-device-rag-android, MediaPipe, sqlite-vec, Expo background APIs. Ideas-only (copyleft/unclear): Reticulum, Fossify Clock, background_downloader reference.
- Nothing in this package was copied without a clear license. All "ADAPTABLE" items still require attribution via ATTRIBUTION.md when patterns are reused.
