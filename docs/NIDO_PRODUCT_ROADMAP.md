# NIDO — PRODUCT INDEPENDENCE & MATURITY ROADMAP

**Status: REFERENCE ONLY — not authorization to implement.** Saved 2026-09-27
per owner directive. Existing freezes, lanes, gates and sequencing remain in
force. Use this document to evaluate future work and prevent us from losing
the long-term direction.

## Product goal

NIDO should mature from a fork-derived application into an independently
operated product built partly on properly attributed open-source software.

Independence does not mean rewriting good upstream/open-source components
merely to remove their origin. It means NIDO controls its product identity,
runtime infrastructure, distribution, security decisions, UX, release process
and original feature direction while preserving all legally required licenses
and provenance.

The user-level target is simple:

Install NIDO → download a model once → disconnect from the internet → open
NIDO and use it normally without needing to understand the underlying
technology.

## Priority 1 — Prove the core on physical hardware

Resolve the current model-installation issue that stopped around 96%.

On the physical Galaxy Tab A9+, demonstrate:

clean/update install → model download 100% → SHA-256 verification →
initialization/indexing → force close → airplane mode → cold launch →
successful local response

Then validate local memory, documents/RAG, restart behavior and recovery
paths.

CI success alone does not satisfy this gate.

## Priority 2 — Protect user data

Prioritize SECURITY M-1/M-2: a transient Keystore read failure must fail
closed and must never silently generate a replacement key that makes existing
encrypted databases or P2P identity inaccessible.

Then address the remaining medium P2P/security findings, including fail-open
confirmation behavior, ambiguous contact resolution, pairing confirmation and
key-rotation/history handling.

Keep GATE-1 open until effective encryption at rest is demonstrated
reproducibly on physical hardware.

## Priority 3 — Complete operational independence

NIDO runtime should not depend operationally on BOAR infrastructure.

Corpus migration to NIDO-controlled immutable releases is part of this
objective.

Perform a final residual audit covering runtime URLs, package metadata,
Android resources, assets, prompts, documentation and visible strings.

Do not remove legally required upstream copyright, license, attribution or
provenance.

Operational independence must never be confused with erasing open-source
history.

## Priority 4 — Make the product visually NIDO

Implement the already approved visual direction in controlled phases:

* Daylight as primary theme
* Night Garden
* NIDO app icon
* unified AppBar
* clean chat/empty state
* simplified drawer
* normal-language Settings
* Activity instead of ambient engineering telemetry
* remove remaining terminal/hacker/bounty vocabulary from normal UX
* integrate BASE_MASTER V2 mascot only after visual approval

Technical information can remain accessible under appropriate
advanced/technical-detail surfaces.

## Priority 5 — Make model installation resilient

Model management must tolerate real-world failures.

Design for:

* interrupted downloads
* resume/retry
* insufficient storage
* corrupted downloads
* SHA mismatch
* app termination during installation
* safe atomic replacement
* recovery without restarting everything unnecessarily

Never bypass integrity verification merely to make installation succeed.

A user should never be permanently stranded at something like 96% without a
clear recovery path.

## Priority 6 — Own distribution

Before broader distribution:

* establish a stable NIDO release signing key
* protect and back up that key appropriately
* stop relying on Android Debug signing
* define versioning/update policy
* preserve release artifacts, hashes and provenance
* maintain reproducible CI gates
* establish private alpha/beta distribution before public release

## Priority 7 — Close legal/compliance gates

Before public distribution, resolve all remaining model/corpus licensing
questions, including the already identified LFM, Gemma and CC BY-SA issues
where applicable.

Maintain final THIRD_PARTY_NOTICES / LICENSE / attribution material.

Complete public-name/trademark review before treating the provisional NIDO
identity as permanently cleared.

Do not describe the project as "legally cleared" unless appropriate counsel
actually establishes that.

## Priority 8 — Build NIDO's own release qualification suite

Every meaningful release should eventually exercise:

* clean install
* update from previous version
* cold launch
* offline launch
* offline inference
* interrupted model download/resume
* corrupted model/hash rejection
* low-storage behavior
* encrypted storage
* Keystore failure behavior
* Clear All Data
* documents/RAG
* memory
* P2P/pairing
* network-audit expectations
* crash/restart recovery

Physical-device evidence remains necessary for behaviors that static
inspection or unit tests cannot establish.

## Guiding principle

Do not rewrite mature open-source components solely to increase the percentage
of original NIDO code.

Replace or redesign something when doing so improves security, reliability,
maintainability, UX, independence or NIDO's actual product capabilities.

The objective is not "100% code written by NIDO."

The objective is:

NIDO is an independently operated, trustworthy product with its own identity
and experience, built responsibly on open-source foundations.

---

*Saved as a roadmap reference. Do not open new implementation lanes solely
because of this roadmap. Continue the currently authorized work and existing
sequencing.*
