> **Language:** English · [Español](es/NETWORK_AUDIT.md)

# NIDO — Network audit (measured 2026-11-24)

Measured against the tree that ships as the next release
(`main` at `1fd99f95`, the mobile lot's final tree; the version
bump itself lands in the version PR). The previous census was
dated 2026-09-27, two months and sixteen versions ago; this one
re-runs every count against the live tree and replaces it.

Goal: verify the app doesn't use the Internet outside the
explicit downloads the user starts, and name every local route
for what it is: local.

## Methodology (repeatable, from the repo root)

```bash
# 1. Network calls in JS/TS (tests excluded):
grep -rln "fetch(\|globalThis.fetch\|new WebSocket\|EventSource\|XMLHttpRequest" src App.tsx --include="*.ts" --include="*.tsx" | grep -v "\.test\."
# 2. Uploads and over-the-air updates:
grep -rn "uploadAsync\|expo-updates" src App.tsx package.json | grep -v "\.test\."
# 3. Remote URLs declared in code (tests excluded):
grep -rln "http://\|https://" src --include="*.ts" --include="*.tsx" | grep -v "\.test\."
# 4. Network in the native modules:
grep -rln "HttpURLConnection\|OkHttp\|URLSession\|Socket" modules/*/android modules/*/ios
# 5. Telemetry/analytics SDKs in the package manifest:
grep -in "sentry\|amplitude\|mixpanel\|analytics\|segment\|posthog\|firebase" package.json
# 6. Download points:
grep -rn "createDownloadResumable" src --include="*.ts" | grep -v test
```

## Result — every route that leaves the phone

There is exactly **one download funnel**: `src/models/ModelManager.ts`
calls `createDownloadResumable` from expo-file-system (two call
sites), driven by `src/services/downloadManager.ts`. Every
download in the app goes through it, and every destination comes
from the signed catalog in `src/models/manifest.ts` — 33 SHA-256
pins and 11 pinned source revisions in that file today.

| Surface | Destination | Trigger | Verification |
|---|---|---|---|
| Chat models (LLM) | `huggingface.co` — the catalog's repos (bartowski, unsloth, LiquidAI, google) | The person's tap: the setup wizard's required downloads, or a model's download button in Settings | SHA-256 per file in the catalog; Hugging Face downloads resolve a **pinned commit revision**, never the mutable branch |
| Embedding models | `huggingface.co` (CompendiumLabs bge-small) and the project's GitHub releases (multilingual e5) | The person's tap: turning on a search feature, or its card in Settings | SHA-256 per file in the catalog; pinned revision where the source is Hugging Face |
| Knowledge packs | `github.com/Nido007-cmyk/Nido/releases` (knowledge-packs v17, v16, v6) | The person's tap on a pack in Settings | SHA-256 per file in the catalog |
| Corpus indexes | `raw.githubusercontent.com/Nido007-cmyk/Nido` (`corpus-standard.json`, `corpus-full.json`) | The person's tap on a corpus download in Settings | SHA-256 per entry in the catalog |
| A model the person adds from Hugging Face | `huggingface.co`, at the address the person supplies | The person's own add and download gestures | The trust gate: the download is checked against the SHA-256 the person confirms for that source before the model can load |
| Opening a link | The system browser, outside the app | The person's tap, after the confirmation card | Not an app call: the app hands one allow-listed scheme to the OS and fetches nothing itself |

Nothing downloads in the background, on a schedule, or on
launch. If the person never taps a download, the app makes no
Internet request at all.

## Result — the measured zero

| Surface | Finding |
|---|---|
| `fetch` / WebSocket / EventSource / XMLHttpRequest in `src/` and `App.tsx` | **None** (step 1 of the methodology returns no files) |
| Uploads (`uploadAsync`), over-the-air updates (`expo-updates`) | **None** — neither the calls nor the package exist |
| Telemetry / analytics / crash-reporting SDKs in `package.json` | **None** (step 5 returns no matches) |
| Network in the 14 native modules | Only `nido-p2p`, and only local (below). The other 13 modules open no socket |
| Web search (Deep Research, answers) | Local: decomposition and retrieval run against the on-device model and the downloaded corpora. No web search anywhere |

## Result — local routes, declared as local

| Surface | Route | Trigger |
|---|---|---|
| NIDO-to-NIDO relay | Bluetooth RFCOMM (`NidoP2PManager.kt`) or Wi-Fi on the same subnet: TCP + mDNS (`NidoLanManager.kt`), which accepts connections only from private addresses on the local network | The person's pairing and messaging gestures. End-to-end encrypted; nothing transits the Internet |

## The visible log

Every connection above is written down where the person can
read it: `src/privacy/networkAudit.ts` records download starts,
completions and failures, LAN and Bluetooth connections, and
P2P discovery in the app's encrypted database, and the
**Network audit** card in Settings shows the last 500 entries
(host and path only — never query strings). The recording sits
inside the funnel itself — `ModelManager` logs its downloads
and the P2P transport logs its connections — so a route cannot
leave the phone without passing the pen.

URLs that appear in code but are never called: the CDC and CPSC
source links printed at the foot of the safety answers, the
license texts in `src/legal/licenses.ts`, and the worked
examples inside the link validator and the tool catalog. They
are text the person can read, not requests the app makes.

## Conclusion

After the downloads the person chooses, NIDO is functionally
offline. The only Internet traffic is the funnel above: catalog
models, packs and corpora from two hosts, each byte checked
against its pin. No telemetry, no analytics, no sync, no hidden
calls — measured, not asserted.

Note: Expo adds `android.permission.INTERNET` to the manifest on
prebuild by default (the downloads need it). Once the downloads
finish, that permission is used by nothing else at runtime;
removing it would break the initial download, so it is kept
deliberately and documented here.
