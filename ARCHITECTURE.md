> **Language:** English · [Español](ARCHITECTURE.es.md)

# NIDO architecture

NIDO is a personal AI assistant for Android that runs entirely on the
phone. There is no account, no server and no cloud behind it: the
language model, the knowledge base, the memory and every safety answer
live on the device, and after a one-time setup the app works fully
offline. This document describes how the app is put together today
(version 0.1.117). For what the app does, read `README.md`; for how to
build it, read `AGENTS.md`.

## Design rules the code enforces

- **Offline is the normal state.** The only network requests the app
  ever starts are downloads the user begins (models and knowledge
  packs) and an optional update check. Every request goes through one
  initiating API and is written to an append-only network log the user
  can inspect in the app (`src/privacy/networkAudit.ts`).
- **The model is for conversation; the help is not.** Emergencies,
  crisis answers and a large share of everyday requests are answered
  by deterministic code with fixed, verified texts. They never wait
  for the model, and they work when the model cannot even load.
- **What is kept is what was checked.** A model answer that reaches
  the history, an export or the voice reader is the answer after the
  grounding judge has checked it against its sources, not the raw
  generation.
- **Private by construction.** Personal data lives in databases
  encrypted at rest. Nothing personal leaves the phone; the only
  exception is the encrypted phone-to-phone channel the user opens
  on purpose (see "Talking to another NIDO").
- **Modest hardware decides.** The app is built and tested for
  ordinary phones and tablets, not flagships: model choice, context
  size and memory budgets all degrade honestly on smaller devices
  instead of failing silently.

## Stack

- **App shell**: Expo (React Native 0.86, React 19) with TypeScript,
  built as a custom native app. It cannot run in Expo Go: the app
  ships fourteen local native modules (below) plus native inference.
- **Inference**: `llama.rn` (React Native bindings for llama.cpp)
  running GGUF models on the device, with memory-mapped weights and
  streaming output (`src/inference/LlamaEngine.ts`). A routing layer
  (`src/routing/`) plans each turn with plain rules, never with the
  model itself, so the same message always takes the same route.
- **Storage and retrieval**: SQLite through `expo-sqlite`, encrypted
  with SQLCipher for personal data, with FTS5 for lexical search and
  a bundled embedding model for vector search. A native module
  (`modules/nido-vectors`) does exact vector search over a pack's
  embeddings from a memory-mapped index.
- **Languages**: the interface, the fixed answers and the guide are
  fully written in Spanish, English and Portuguese
  (`src/i18n/locales/`), with automated parity tests between them.

## How a message gets its answer

1. **Safety and fixed routes first.** Deterministic detectors
   (`src/routing/emergencyGate.ts`, `src/agent/loop/safetyAnswers.ts`)
   recognise emergencies, self-harm, carbon monoxide and other urgent
   topics and answer at once with fixed texts and verified numbers,
   without loading the model. An emergency typed while another answer
   is still generating can still be sent.
2. **Deterministic tools.** Reminders, notes, memory, calendar,
   calculations, timers and similar requests are handled by the
   agent's routers and tools (`src/agent/`, `src/routing/`), which
   act on the encrypted store and answer in the user's language.
3. **Classification by meaning.** A semantic gate
   (`src/routing/semanticGate.ts`) adds meaning-based classification
   on top of the word lists for health and emergency topics, using
   the same search vectors as retrieval.
4. **Retrieval.** When a question needs knowledge, hybrid search
   (FTS5 plus vectors) looks in the bundled corpus, the installed
   knowledge packs and the user's own documents (`src/rag/`), and
   the best sources travel with the question into the model's
   context.
5. **The model answers.** Generation streams token by token, with
   budgets for context and output that the router sets per route
   (`src/routing/router.ts`).
6. **The judge checks it.** The grounding judge
   (`src/rag/grounding.ts`) compares the answer with the sources it
   was given: claims with no support are removed or the answer falls
   back to a safe text, and a source check (`src/rag/sourceCheck.ts`)
   flags numbers that contradict a source. Only the judged answer is
   shown, saved, exported or read aloud.

## Knowledge

- A starter corpus of 858 topics ships inside the app
  (`assets/corpus/corpus.json`) and is indexed on first launch, so
  the app answers knowledge questions offline from the first minute.
- **Knowledge packs** are SQLite files holding texts, an FTS5 index
  and embeddings. The setup offers four tiers (minimum, standard,
  full, encyclopedia). Two packs, NIDO Essentials and NIDO Local,
  travel inside the APK and are installed on first launch; the rest
  download on demand. Every pack is verified by SHA-256 against a
  signed catalog before it is accepted (`src/models/manifest.ts`,
  `src/models/manifestSignature.ts`).
- **The user's library**: documents the user imports (PDF text
  extraction and OCR run on the device,
  `src/services/documentImporter.ts`) are indexed the same way and
  answer only to their owner.

## Memory, the vault and backups

- Chats, memory, notes, reminders and contacts are stored in
  SQLCipher-encrypted databases (`src/security/databaseManager.ts`).
  The database key is wrapped with a hardware key kept in the
  Android Keystore; after a restart, using it asks for the user's
  PIN, pattern or strong biometric (`src/security/keyVault.ts`,
  `modules/nido-keyvault`).
- A backup copies the database while it is still encrypted, with a
  checksum manifest; the user keeps the key separately, on paper or
  wherever they choose. Neither half is useful without the other,
  and no server ever sees either (`src/security/backup.ts`).
- The panic erase destroys the database, the vault and the P2P keys
  before deleting anything else.

## The agent and its permissions

The agent (`src/agent/`) works through tools: it can set reminders,
keep notes and memory, read the calendar, do calculations, manage
scheduled tasks and more. Each tool has a permission the user
controls, every action is written to an action log the user can
review, and destructive actions ask first through a native
confirmation dialog whose window is protected from screenshots
(`modules/nido-secure-dialog`). Reminders fire with exact alarms
(`modules/exact-alarm`, `modules/nido-notify`), with no Firebase and
no Google services involved.

The built-in guide ("Learn to use NIDO", `src/guide/`) teaches each
feature with examples the user can send. Its lessons live in the
locale files like the rest of the text, and tests send every example
of every lesson, in the three languages, through the real routers:
a lesson cannot promise something the app no longer does.

## Talking to another NIDO

Two phones with NIDO can exchange messages and delegated tasks over
local Wi-Fi or Bluetooth (`src/p2p/`, `modules/nido-p2p`). The
channel is end-to-end encrypted with NaCl: an X25519 identity key
pair, an Ed25519-signed handshake, ephemeral session keys per
connection and XSalsa20-Poly1305 for the messages
(`src/p2p/crypto.ts`), with a post-quantum component in the key
exchange (`src/p2p/pq.ts`). Pairing is confirmed by comparing a
fingerprint in a native dialog, and incoming delegations land in an
approval inbox: nothing from another phone runs unapproved.

## Native modules

Fourteen local modules under `modules/` cover what React Native
cannot: `bundled-assets` (copies the packs baked into the APK to
disk), `download-wake-lock`, `exact-alarm`, `nido-cpr` (the CPR
practice metronome and camera rate meter), `nido-keyvault`,
`nido-launch` (shortcuts, share target and the Quick Settings tile),
`nido-notify`, `nido-ocr`, `nido-p2p` (Bluetooth transport; the
cryptography lives in `src/p2p/`), `nido-pdf-text`,
`nido-secure-dialog`, `nido-vectors`, `ram-monitor` (the real process
memory the system monitor shows) and `voice-input` (offline speech
recognition through the device's own recogniser).

## Testing and verification

Every pull request runs the type checker and the full automated
suite in CI, plus secret scanning and the CPR motion parity check.
The run that built 0.1.117 passed 9,975 automated tests: 9,808 in
vitest across 559 files and 167 component tests in jest, with no
failures. Behaviour rules that must never change quietly are written
in the constitution (`docs/NIDO_CONSTITUTION.md`) and checked by
script; `conformance/` and `formal/` hold the conformance and formal
material. Automated tests do not replace a real phone: versions
0.1.114 and 0.1.115 were also exercised on a physical Galaxy Tab A9+
in the owner's hands.

## Directory layout

```
App.tsx / index.ts        entry points; setup gate, then the chat UI
src/
  routing/                route planning, emergency gate, semantic gate
  agent/                  tools, action log, fixed safety answers
  rag/                    retrieval, grounding judge, source check
  inference/              llama.rn wrapper, memory and pressure budgets
  models/                 model and pack catalogs, signed manifest, downloads
  security/               encrypted databases, key vault, backup and restore
  privacy/                key manager, the network audit log
  p2p/                    phone-to-phone crypto, handshake, delegation
  guide/                  the built-in guide's structure and promises
  i18n/                   Spanish, English and Portuguese locale files
  ui/                     screens and components
  services/               chat history, document import, citations, research
  voice/ cpr/ notify/     voice in and out, CPR practice, notifications
modules/                  the fourteen local native modules
knowledge-packs/          pack sources and the release ledger
assets/corpus/            the bundled starter corpus
docs/                     design, security and product documents
scripts/                  build, pack and verification tooling
.github/workflows/        CI, release and pack pipelines
```

## Origin and license

NIDO began as a fork of BOAR, an offline AI research app, and has
been heavily extended since: the safety routes, the grounding judge,
the encrypted memory, the knowledge packs, the guide and the
phone-to-phone channel are NIDO's own. The project is released under
the MIT license (see `LICENSE`); `ATTRIBUTION.md` keeps the credit
for BOAR and for every third-party piece the app builds on.
