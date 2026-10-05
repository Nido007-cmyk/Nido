> **Language:** English · [Español](es/NETWORK_AUDIT.md)

# NIDO — Network audit (2026-09-27)

Goal: verify the app doesn't use the Internet outside the explicit
model/corpus downloads the user starts in Settings.

## Methodology (repeatable)

```bash
cd ~/workspace/nido-app
# 1. Llamadas de red en JS/TS (excluye tests):
grep -rln "fetch(\|globalThis.fetch" src App.tsx --include="*.ts" --include="*.tsx" | grep -v "\.test\."
# 2. URLs remotas:
grep -rln "http://\|https://" src --include="*.ts" | grep -v "\.test\."
# 3. Red en código nativo de los módulos:
grep -rn "HttpURLConnection\|OkHttp\|URL(" modules/*/android --include="*.kt"
# 4. SDKs de telemetría/analítica en package.json:
grep -in "sentry\|amplitude\|mixpanel\|analytics" package.json
# 5. Descargas de archivos:
grep -rn "createDownloadResumable\|downloadAsync" src --include="*.ts" | grep -v test
```

## Result

| Surface | Finding |
|---|---|
| `fetch` / axios / WebSocket / EventSource in `src/` | **None** |
| `http(s)` URLs in `src/` | Only `src/models/manifest.ts`: model download URLs (HuggingFace) and corpus (raw.githubusercontent.com). They're configuration data, not calls. |
| Network in `modules/*` Kotlin | **None** (`nido-p2p` only uses Bluetooth; the other modules don't touch the network) |
| Analytics/telemetry SDKs | **None** |
| File downloads | A single point: `src/models/ModelManager.ts` → `expo-file-system` `createDownloadResumable`, only with the manifest URLs and **only when the user taps download** in the initial setup |
| Deep Research | Local: decomposes with the phone's LLM and retrieves from the local corpus (RAG). No web search. |
| NIDO P2P | Zero network by design: Bluetooth RFCOMM between devices; the handshake and messages never leave the local link |

## Conclusion

The app is functionally offline after initial setup. The only possible network
traffic is what the user deliberately triggers to download models. No telemetry,
no analytics, no hidden calls.

Note: Expo adds `android.permission.INTERNET` to the manifest on prebuild
by default (the model downloads need it). Once the models are
downloaded, that permission isn't used at runtime; removing it
from the manifest would break the initial download, so it's kept
deliberately and documented here.
