<!--
MIT License
Copyright (c) 2026 NIDO contributors
See LICENSE file for details.
-->

> **Language:** English · [Español](SECURITY.es.md)

# Security Policy — NIDO

NIDO is a privacy-first, offline personal AI assistant. Security is not a
feature here; it is the premise: encrypted on-device memory, hardware-backed
keys, no accounts, no cloud. If you find a vulnerability, we want to hear
about it — privately, so it can be fixed before anyone is harmed.

## Reporting a vulnerability

**Do NOT open a public issue for security vulnerabilities.**

Use [GitHub Private Vulnerability Reporting](https://github.com/Nido007-cmyk/Nido/security/advisories/new)
on this repository. It opens a private channel between you and the
maintainers; nothing is disclosed publicly until a fix is ready and its
disclosure is coordinated with you.

## Scope

In scope:

- The NIDO Android app: key management (Android Keystore / SecureStore),
  SQLCipher database encryption, biometric gate, "Clear All Data" semantics,
  backup / restore / wipe cryptography.
- P2P: pairing ceremony, handshake, session cryptography, identity keys.
- Policy engine: bypasses that let the agent exceed the user's authorization.
- Build and signing pipeline: anything that could ship a tampered APK.

Out of scope:

- Social engineering, phishing, or physical access to an unlocked device.
- Vulnerabilities in third-party dependencies — report them to the upstream
  project (a heads-up to us is still appreciated).
- The upstream the upstream project repository — report to its own maintainers.

## Supported versions

Security fixes go to the latest release and `main`. This is alpha software;
when reporting, please use the newest APK from the releases page and state
its version and commit SHA.

## What to include in a report

- NIDO version (APK version + commit SHA if you built it yourself), device
  model, Android version.
- A clear description of the vulnerability and its impact: what can an
  attacker do that they should not be able to do?
- Steps to reproduce, ideally minimal. Proof-of-concept code is welcome.
- Whether it requires physical access, a paired peer, or can be done
  remotely.
- Your assessment of severity, if you have one.

The more precise the report, the faster we can act.

## Response expectations

- We aim to acknowledge your report within 5 business days.
- We will keep you informed while we investigate and will coordinate
  disclosure with you: no public details until a fix is available.
- If we cannot reproduce the issue or do not consider it a vulnerability,
  we will explain why.

## Safe harbor

We will not take legal action against anyone who, in good faith:

- researches within the scope above,
- does not access, modify, or exfiltrate anyone else's data,
- does not disrupt the availability of any service,
- reports findings through the private channel and gives us reasonable time
  to fix them before any disclosure.

## Ground rules

- **Never post secrets in public issues**: no keystore material, encryption
  keys, credentials, tokens, or real user data — not even fragments that
  "look redacted". If you are unsure whether something is sensitive, treat
  it as sensitive and use the private channel.
- We do not run a bug bounty at this time; please do not condition reports
  on payment.
- If you run automated scanners, keep them gentle against any live
  infrastructure you do not own.
