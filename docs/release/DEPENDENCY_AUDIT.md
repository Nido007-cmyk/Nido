# Dependency vulnerability audit (2026-10-14)

**Trigger:** GitHub reported 9 Dependabot alerts on `main` (3 critical, 4 high,
2 moderate). The alerts page is not readable from the maintainers' automation, so
the same data was produced with `npm audit` in Actions
(`.github/workflows/npm-audit.yml`, runs on `security/**` branches or by hand,
read-only, results as annotations). `npm audit` counts 63 entries, but they
come from **9 root advisories**; the other entries are packages that only
depend on an affected one. The 9 match Dependabot's count.

**Key question for each one: does the vulnerable code ship in the APK and run
on the phone?** `npm audit` marks a package "production" when it is outside
`devDependencies`. That includes all of Expo's build tooling (CLI, prebuild,
Metro), which runs on the build machine and is not part of the app.

| # | Severity | Package (version in lockfile) | Advisory | Who pulls it in | In the APK? | Action |
|---|---|---|---|---|---|---|
| 1 | critical | shell-quote 1.10.0 | [GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv) — `quote()` command injection | react-devtools-core (React Native dev tools) | No: DevTools only connect in development builds (`__DEV__`) | **Fixed:** lockfile bumped to 1.12.0, inside the `^1.6.1` range react-devtools-core already asks for |
| 2 | critical | simple-git 3.36.0 | [GHSA-x6jw-m9v5-85vh](https://github.com/advisories/GHSA-x6jw-m9v5-85vh) | node-llama-cpp (devDependency, PC-side evaluation scripts) | No | Open: fixed only in simple-git 4.0.1, outside node-llama-cpp's `^3.36.0` range. Risk only when running those scripts on a PC with attacker-controlled git options; NIDO's scripts don't pass user input to git |
| 3 | critical | @simple-git/argv-parser | [GHSA-v5rq-49vh-5v5c](https://github.com/advisories/GHSA-v5rq-49vh-5v5c) | same (simple-git) | No | Same as #2 |
| 4 | high | simple-git 3.36.0 | [GHSA-g4wm-2vf7-vfgr](https://github.com/advisories/GHSA-g4wm-2vf7-vfgr) | same | No | Same as #2 |
| 5 | high | simple-git 3.36.0 | [GHSA-858h-whjf-mvg5](https://github.com/advisories/GHSA-858h-whjf-mvg5) | same | No | Same as #2 |
| 6 | high | node-forge 1.4.0 | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) — RSA PKCS#1 v1.5 signature verification | @expo/code-signing-certificates, @expo/cli (Expo Updates code signing, build side) | No: NIDO's code does not import node-forge, and NIDO does not use Expo Updates code signing | Open: no patched version published (≤1.4.0 affected) |
| 7 | high | braces 3.0.3 | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) — stack exhaustion with nested patterns | micromatch (Metro / Jest file globbing) | No: build and test tooling | Open: no patched version published (≤3.0.3 affected) |
| 8 | moderate | sprintf-js 1.0.3 | [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) — DoS via precision specifiers | argparse ← @istanbuljs/load-nyc-config (Babel coverage tooling) | No | Open: needs an upstream change in the istanbul chain |
| 9 | moderate | uuid 7.0.3 | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) — missing bounds check when `buf` is passed | xcode (iOS project tooling used by Expo prebuild) | No: Android-only app, and NIDO does not import `uuid` | Open: needs an upstream change in `xcode` |

**Result:** the only critical issue that could be fixed without leaving the
dependency ranges (#1) is fixed. None of the remaining eight run on the
phone; they live in build, test or PC-side tooling. They stay open until upstream releases
a fix, and are re-checked with the same workflow. The suggestions `npm audit`
prints for them (downgrade to `react-native@0.72.17`, `node-llama-cpp@2.0.0`)
are major *downgrades* and are not applied.

**Rule kept:** no React Native / React upgrade outside an Expo SDK upgrade;
these advisories are re-evaluated with the next SDK (58).
