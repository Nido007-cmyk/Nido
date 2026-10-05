# Contributing to NIDO

Thank you for your interest in contributing to NIDO! We're building a
privacy-first, offline personal AI agent, and we welcome help.

## Ground Rules

NIDO has non-negotiable principles. All contributions must respect them:

1. **Zero-network by default.** No component may assume Internet access.
   No analytics, no telemetry, no cloud calls unless explicitly opt-in
   by the user for a specific feature.
2. **Privacy first.** User data stays on-device, encrypted. Never log
   sensitive data. Never send user content anywhere.
3. **Local-first.** Features must work fully offline. Network is an
   enhancement, never a requirement.
4. **User as authority.** The Policy Engine gates all agent actions.
   Never bypass it.

## How to Contribute

### Reporting Issues
- Use the issue templates (.github/ISSUE_TEMPLATE/)
- Include: NIDO version, device, Android version, steps to reproduce
- For security issues: see SECURITY.md (do NOT open a public issue)

### Submitting Pull Requests
1. Fork the repo and create a branch from `master`
2. Follow the PR template (.github/PULL_REQUEST_TEMPLATE.md)
3. Ensure `npm run typecheck` passes
4. Ensure `npm test` passes (all 1490+ tests)
5. Write tests for new functionality
6. Follow the human tone guide for user-facing text (see docs/)
7. Keep PRs focused — one feature/fix per PR

### Code Style
- TypeScript strict mode
- Pure functions where possible (testable without a device)
- No em-dashes in user-facing text (use commas or periods)
- Follow existing patterns in the codebase

### What We're Looking For
- Bug fixes (with regression tests)
- Performance improvements (with benchmarks)
- New local tools for the agent (see src/agent/tools/)
- UI/UX improvements (following the "Calm Agent" direction)
- Documentation improvements
- Translations (see src/i18n/)

### What We Won't Accept
- Features requiring network/cloud accounts
- Analytics or tracking code
- Changes that weaken encryption or privacy
- Breaking changes to the encrypted storage format without migration

## Development Setup

```bash
npm install
npx expo prebuild -p android --clean
npx expo run:android --device
```

See AGENTS.md for detailed build instructions.

## License

By contributing, you agree that your contributions will be licensed
under the MIT License (see LICENSE).

NIDO is a fork of BOAR (MIT). See ATTRIBUTION.md for details.
