> **Language:** English · [Español](../es/internal/SUBMISSION_CHECKLIST.md)

# Submission checklist

Tracks the bounty's actual requirements against repo state. Code-reachable work
is done (see `ARCHITECTURE.md` for the detailed status list); everything below
needs your device/accounts and can't be done from within an agent session.

- [ ] `make setup` (or `npm install`)
- [ ] `make run-android` (or `npx expo prebuild -p android --clean && npx expo run:android`)
      on a connected device — the real unverified step, needs an actual Gradle/NDK compile.
      Models are NOT bundled into the APK by default (that's `scripts/setup-models.sh` +
      the `withBundledModels` plugin — an alternate path that isn't active in `app.json`'s
      plugin list right now); the app instead shows a first-run setup wizard that
      downloads the two default LLMs (primary + fast/secondary) + embedding model
      (~3.2GB) once you launch it.
- [ ] Confirm the first-run wizard downloads and loads all three default models, and
      the app answers a query end-to-end
- [ ] Try the queries in `docs/EVAL_QUERIES.md` and capture the responses
- [ ] Spot-check RAM via the in-app monitor (Settings > Stats & System) stays under 12GB,
      and storage stays under 50GB
- [ ] Turn off networking entirely (airplane mode) and re-verify the app still works —
      the real test of the "zero connectivity" requirement
- [ ] Post a public demo (X or Farcaster): offline proof, example queries incl. ones
      a 1B model would fail on, repo link, brief approach explanation
- [ ] Submit a screenshot + links to poidh
- [ ] Make sure the GitHub repo's current state matches what's in the demo/claim
