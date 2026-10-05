> **Language:** English · [Español](es/MODEL_ROUTER.md)

# NIDO Model Router — Specification (draft v0.1)

**Status:** design, NOT implemented yet.

**Principle:** the AI model is a **replaceable** component. NIDO is
identity, memory, policy, capabilities, protocol, transport,
audit and trust. The router decides *where* reasoning happens; never *who*
authorizes.

---

## 1. Provider interface

```typescript
interface ModelProvider {
  /** Identificador estable: "local-qwen2.5-1.5b", "remote-<proveedor>", … */
  readonly id: string;
  /** "local" | "remote" | "future" */
  readonly kind: ProviderKind;
  /** Capacidades declaradas: contexto, herramientas, multimodalidad… */
  capabilities(): ProviderCapabilities;
  /** Generación. El prompt ya viene minimizado por el router. */
  generate(req: GenerationRequest): Promise<GenerationResult>;
  /** ¿Disponible ahora? (modelo descargado, red, cuota…) */
  available(): Promise<boolean>;
}
```

- `LocalModelProvider` — runs on the device (today: llama.rn/llama.cpp).
- `RemoteModelProvider` — user-authorized external API.
- `FutureModelProvider` — reserved: dedicated NPU, personal hardware,
  future runtimes. The interface doesn't change.
- Providers are **interchangeable**: the agent asks "reason about X
  with policy P"; the router picks the provider. No component assumes a
  specific model, phone or provider.

---

## 2. Routing policies

Per task/capability, the local policy fixes one of:

| Policy | Meaning |
|---|---|
| `LOCAL_REQUIRED` | Local model only. If unavailable → the task waits or fails, **never** leaves the device. |
| `LOCAL_PREFERRED` | Local if it can; if not, asks the user before leaving (`ASK_USER` implied). |
| `REMOTE_ALLOWED` | May use an authorized remote without asking each time (the user authorized it per capability). |
| `ASK_USER` | Asks each time, showing the disclosure plan (§3). |

**Defaults by sensitivity** (the capability suggests them, the local policy
wins):

- `sensitivity: high` (location, identity, keys, health) → `LOCAL_REQUIRED`.
- Tasks from another NIDO that touch the user's data → `LOCAL_REQUIRED`
  unless explicitly authorized.
- Drafts, non-sensitive summaries, brainstorming → `LOCAL_PREFERRED`
  or `REMOTE_ALLOWED` per configuration.

A sensitive task may require `LOCAL_REQUIRED` even if the local model is
worse: privacy wins over quality.

---

## 3. Disclosure planning (mandatory before leaving the device)

Before sending **any** information to a remote model there is an
explicit stage:

```
¿qué datos?   → categorías e items concretos (no "el contexto")
¿por qué?     → qué parte de la tarea los necesita
¿a quién?     → provider id + operador + jurisdicción si se conoce
¿para qué?    → task_id y capability que lo origina
```

The Policy Engine may **reduce/redact** the context before sending:
field projection (like minimum_disclosure), identifier anonymization,
truncation. The disclosure plan is recorded in audit.

If the policy is `ASK_USER`, the user sees the plan and decides
("This task could benefit from online processing. Allow it this
time?" + what information would leave). Without approval → nothing leaves.

---

## 4. Remote model output is UNTRUSTED

Everything returned by a `RemoteModelProvider` enters the system at
trust level **EXTERNAL** (see `CAPABILITY_MODEL.md` §5):

- It can be displayed/summarized.
- It **cannot** authorize tools, grant permissions, or modify policy.
- If the agent wants to act on that output, the action goes through the
  Policy Engine pipeline like any other.

This also holds for compromised local models in the worst case: the
model reasons, the Policy Engine authorizes. **Reasoning ≠ Authority.**

---

## 5. Transparency: NIDO Privacy Activity

Screen/report where the user understands what their agent did. Examples:

```
Processed locally
Contacted NIDO: María
Sent 214 bytes over Bluetooth
No Internet used
Calendar availability disclosed: 18:00–19:00
Remote AI used: No
```

If Internet was used:

```
Remote AI used: Yes
Provider: <id>
Data categories sent: <lista del disclosure plan>
Reason: <tarea/capability>
Time: <ts>
```

Each event links to the audit record (see
`AGENT_PROTOCOL.md` §11). No silent telemetry: the log is local,
encrypted, and the user can view, export and delete it.

---

## 6. Graceful degradation

- No downloaded local model → `LOCAL_REQUIRED` tasks wait with an
  explanation, they don't silently degrade to remote.
- No network → remote providers report `available() = false`; the
  router doesn't even try them.
- A repeatedly failing provider is marked degraded (circuit
  breaker) and retried with backoff; never "try your luck" with an
  unauthorized provider.

---

## 7. Open questions

1. Should the disclosure plan be signed/kept as proof of
   consent, or is the audit event enough?
2. How do we measure "the local model can't handle this task" without sending
   the task out to check? (Local heuristics: length,
   declared complexity, prior failed attempts.)
3. Different default policies for `OFFLINE ONLY` / `LOCAL-FIRST` /
   `ONLINE ENHANCED`? (Likely: OFFLINE ONLY forces a global
   `LOCAL_REQUIRED`.)
4. Format of the "privacy nutrition label" per remote provider (who operates,
   declared retention, jurisdiction) — part of the spec or the UI?
