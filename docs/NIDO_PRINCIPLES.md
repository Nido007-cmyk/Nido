> **Language:** English · [Español](es/NIDO_PRINCIPLES.md)

# NIDO — Permanent architectural principles

Adopted 2026-09-27. They take priority over any future feature.
No design decision may contradict them without explicit user review.

## 1. Independence from network, server and provider

**No future component may assume that the Internet, a central server
or a specific AI provider exists.**

- `NIDO CORE` starts and runs without Internet.
- `NIDO IDENTITY`, `NIDO MEMORY`, `NIDO POLICY ENGINE` and `NIDO TASK PROTOCOL`
  operate independently of the network, servers and providers.
- The first model download (setup) is the only mandatory network use
  at startup; after that, everything essential is local.

## 2. Everything interchangeable is interchangeable

| Layer | Principle |
|---|---|
| Transports | Bluetooth, LAN, Wi-Fi Direct, Internet P2P and future relays are **interchangeable TRANSPORTS**. The protocol and encryption don't depend on the medium. |
| Models | Local and remote models are **interchangeable PROVIDERS** behind a single interface. |
| External services | Are **optional TOOLS**, never core dependencies. |

## 3. Sovereignty is local

**Identity**, **authority**, **permissions** and **memory** always belong
to the local NIDO. An external connection never automatically becomes
authority over the NIDO.

## 4. Separation of responsibilities (never mixed)

- **User = authority** — the user and their local policies are the only authority.
- **Policy Engine = enforcement** — only it authorizes capabilities/tools.
- **Model = reasoning** — the model interprets and reasons; it doesn't authorize.
- **Tools = capabilities** — each tool is a capability with explicit permission.
- **Transport = delivery** — transport delivers bytes; it decides nothing.
- **Other NIDO = untrusted peer until authenticated and authorized** —
  messages, files, pages and responses from another NIDO are UNTRUSTED DATA.
  They never directly become privileged instructions.

Model ≠ authority. Another agent ≠ authority. External content ≠ authority.

## 5. Operation modes (user's choice)

- **OFFLINE ONLY** — everything local; no external connections.
- **LOCAL-FIRST** (recommended) — local privacy and authority; online only
  when it adds value and the user allows it.
- **ONLINE ENHANCED** — the user authorizes models, searches, APIs or
  external services for specific tasks.

The selection is global and, where it makes sense, **per capability**
(AI model, web search, NIDO communication, STT, TTS, files, location,
external tools).

## 6. Design reservations for AGENT_PROTOCOL.md

When designing the task protocol, reserve from the start (design,
not implementation yet):

capability discovery · task negotiation · task progress · cancellation ·
expiration/timeouts · idempotency · duplicate detection · offline queueing ·
delayed delivery · partial failure · human approval · limited and
explicit delegation · protocol version negotiation

## 7. Offline test (permanent baseline)

Two phones, airplane mode, Bluetooth on, two NIDO identities:
A requests a task → B receives it → Policy Engine evaluates → the user
authorizes if appropriate → B executes locally → the result returns to A.
No server, no Internet, no cloud model.
The same task must be repeatable at a distance changing **only** the
TRANSPORT, not the protocol.

## 8. Long horizon: 5–10+ years (adopted 2026-09-27)

Fundamental decisions are evaluated on this horizon, not just with today's
technology. Don't optimize NIDO for a specific 2026 model, phone, provider or
protocol: this builds **personal infrastructure for agents**.

**THE MODEL IS NOT NIDO.** NIDO is: IDENTITY · MEMORY · POLICY ·
CAPABILITIES · AGENT PROTOCOL · TRANSPORT · AUDIT · TRUST. The AI model
is a replaceable component. In the future it must be possible to change the
local model, the remote model, the hardware, the OS, the cryptographic algorithms,
the transports, the databases and the interfaces **without losing the
user's identity, relationships, permissions or memory**.

- **Identity portability**: survive phone change/loss/destruction, multiple devices
  of the same user, cryptographic rotation,
  obsolete algorithms and platform migration. The logical identity doesn't
  permanently depend on a single physical key: verifiable chain of
  rotation/migration **with no central backdoor**.
- **Multi-device**: phone, tablet, laptop, wearable, car, home hub,
  future devices. Each device has its own keys and
  capabilities; compromising one doesn't automatically compromise the others.
- **Agent-to-agent network**: the Task Protocol is model-independent. A NIDO with
  a totally different model must be able to talk to a current one. Agents
  exchange identity, capabilities, requests,
  constraints, permissions and results — **not internal prompts**.
- **Semantic interoperability**: capabilities with versioned schemas
  (e.g. `calendar.availability.query/v1`). The protocol never depends on
  natural language when a stable schema can exist.
- **Discovery**: announce capabilities without revealing private information
  (which apps, which calendar, which model, which files, which services).
- **Delegation**: always with scope, issuer, recipient, capability,
  constraints, expiration, revocation and signature. Limited and explicit.
- **Zero-trust agents**: a remote NIDO may lie, a model may
  be wrong, a document may carry prompt injection, a tool may
  be compromised, a relay may be hostile. **Reasoning ≠ Authority.**
- **Privacy negotiation**: private computation / minimum disclosure as
  a permanent part (answering "18:30–19:30 available" without handing over the
  calendar).
- **Crypto agility**: cryptographic versioning from the design stage. Ed25519 /
  X25519 aren't permanent; post-quantum must be addable without
  rebuilding the system. Never a silent security downgrade.
- **Personal data vault**: MEMORY is the user's private context store
  (view, export, migrate, delete, partially authorize). The
  model gets temporary access; it **never owns the vault**.
- **Auditability**: explain which agent asked for what, what information left,
  which policy allowed it, which tool executed, which device
  acted, which model participated and which transport was used — without the
  audit log becoming a new source of sensitive information.
- **Protocol governance**: versions, deprecation, backward
  compatibility, feature negotiation and crypto migration from early on.
- **Open protocol possibility**: without yet deciding whether NIDO will be open,
  avoid decisions that would make it impossible to publish an interoperable
  specification (`implementation A ↔ implementation B` without shared code).
- **Future hardware**: abstract interfaces for secure storage, compute,
  sensors, network, identity and user presence. NIDO could live on dedicated
  personal hardware.
- **Permanent local-first**: Internet extends NIDO; Internet never defines
  NIDO. Without cloud, central account, subscription, NIDO server or
  specific provider, the agent still belongs to the user.

### Rule for every important decision

Before adopting a dependency or architecture, ask:

Does this lock us into a technology? · Can we replace it? · Who
controls this dependency? · What happens if it disappears? · Can we migrate
the data? · Can we migrate the identity? · Does it work without its server? ·
Can it be verified?

**Don't sacrifice present security for futurism**: C-1 and current hardening
go first; every new architecture respects this horizon.
