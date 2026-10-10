# First-Device Checklist — NIDO APK

> **Scope:** the first real `app-debug.apk` on a **physical Android phone** (arm64-v8a).
> This is a first-run QA pass, not a full regression suite. Work top to bottom;
> stop and file a bug on the first hard failure before continuing.
>
> Conventions: each item has **Steps**, **Expected**, and a **Result** box.
> Mark `[x]` pass, `[ ]` fail. Anything marked fail gets a one-line note with
> what was observed. "UNVERIFIED" means the code path exists but no UI or
> device evidence was obtainable in this pass — do not upgrade it to a pass.

**Preconditions**

- [ ] Physical Android device, arm64, Android 8+ (API 26+), USB debugging on
- [ ] `adb devices` shows exactly one device in `device` state
- [ ] APK file identified: record name, size, SHA-256 below
- [ ] Wi-Fi available for the one-time model download (Section 2), then OFF

```
APK: ______________________________
SHA-256: __________________________
Size: _____________________________
Device: ___________________________
Date: _____________________________
Tester: ___________________________
```

---

## 1. Install

**Steps**

1. `adb install <apk>` (fresh install — no previous NIDO/BOAR install on the device; if one exists, `adb uninstall` first and note it).
2. Observe installer output.

**Expected**

- `Success` from adb; launcher icon appears with the NIDO name.
- No install-time permission prompts beyond the standard set.

**Result:** [ ] pass / [ ] fail — notes: _______________

---

## 2. First launch — mandatory setup wizard

**Steps**

1. Tap the launcher icon (cold start, device online on Wi-Fi).
2. Walk through the setup wizard (`SetupWizardScreen` / `ModelSetupScreen mode="required"`).
3. Let the default model download finish: Qwen2.5-1.5B + embedding model (~1 GB total).

**Expected**

- The app does **not** reach chat before the wizard completes (`ModelManager.requiredModelsPresent()` gates it).
- Download shows progress; ~1 GB total.
- After completion, the chat screen appears and is usable.

**Result:** [ ] pass / [ ] fail — notes: _______________

> Note: this download is the app's **only required network access**. Everything
> after this point must work with the network off (Section 5).

---

## 3. Biometric lock gate

**Steps**

1. From chat, press Home (or lock the phone), then reopen NIDO from recents.
2. When prompted, cancel/dismiss the biometric prompt once.
3. Reopen and authenticate successfully.

**Expected**

- Reopening shows the lock screen (`LockScreen` in `App.tsx`) **before any chat
  content or data is visible** — backgrounding re-locks via the AppState listener.
- Cancelling shows an error state (`lockScreen.cancelled`); data stays hidden.
- Successful auth returns to chat with all state intact.

**Result:** [ ] pass / [ ] fail — notes: _______________

---

## 4. Cold start / process restart

**Steps**

1. In chat, send one message and wait for the reply.
2. Force-stop the app: `adb shell am force-stop <package>`.
3. Relaunch from the launcher.

**Expected**

- Biometric gate appears again (Section 3).
- Chat history from before the kill is present (persisted in the SQLite knowledge DB).
- No crash, no "database locked"/migration error on reopen.

**Result:** [ ] pass / [ ] fail — notes: _______________

---

## 5. Offline-first — airplane mode

**Steps**

1. With models downloaded and chat working, enable **airplane mode** (no Wi-Fi, no mobile data).
2. Send 3 chat messages: a greeting, a factual question, a follow-up referencing the earlier answer.
3. Open the drawer and visit: My Documents, Telemetry, About.

**Expected**

- All three messages generate answers locally with no network errors.
- Drawer screens open and render from local data only.
- No spinner that never resolves, no crash, no "offline" dead-end.

**Result:** [ ] pass / [ ] fail — notes: _______________

---

## 6. Chat / inference smoke test

**Steps** (online or offline — inference is local either way)

1. Send: "What is 12 * 12?" — expect a short correct answer.
2. Send a two-turn exchange: "My dog's name is Bruno." → "What is my dog's name?"
3. While a long answer is generating, tap Stop.

**Expected**

- Correct arithmetic; the model recalls "Bruno" from conversation memory.
- Stop halts generation promptly (no runaway tokens).
- No native crash during generation (llama.rn context stays alive).

**Result:** [ ] pass / [ ] fail — notes: _______________

---

## 7. Memory persistence across restart

**Steps**

1. In chat, tell the assistant a durable fact (e.g. "Remember: my favorite color is green.").
2. Force-stop and relaunch the app (as in Section 4).
3. Ask: "What is my favorite color?"

**Expected**

- The fact survives the restart (agent memory store persists to its SQLite DB).
- If the answer is wrong or missing, note it — memory write/read path is under test.

**Result:** [ ] pass / [ ] fail — notes: _______________

---

## 8. Language selection — English-first

**Steps**

1. Fresh install: launch the app and walk the setup wizard. Record the UI
   language **before touching any setting** — it must be **English** with no
   user intervention.
2. Open Settings (drawer → ⚙️) and find the language selector.
3. Cycle: **English → Español → Português → English**. At each step, spot-check
   drawer labels, settings, and chat chrome.
4. Force-stop (`adb shell am force-stop <package>`) and relaunch; confirm the
   selected language persisted.
5. At every step, scan for blank/empty labels or strings falling back to the
   wrong language.

**Expected**

- English is the **native/default language**: a clean install starts in English.
- English is the **fallback** (`fallbackLng: "en"`).
- Español and Português are **user-selectable** and persist across restart.
- Switching is immediate; no empty strings anywhere; no unexpected fallback
  to Spanish.

**Result:** [ ] pass / [ ] fail — notes: _______________

---

## 9. Drawer — every reachable screen opens

**Steps**

Open each drawer item and confirm it renders (no blank screen, no crash):

| Drawer item | Screen | Result |
|---|---|---|
| 💡 Prompts | `PromptIdeasCarousel` | [ ] pass / [ ] fail |
| 📚 My Documents | `KnowledgeBaseScreen` | [ ] pass / [ ] fail |
| ⚙️ Settings | `ModelSetupScreen` (optional mode) | [ ] pass / [ ] fail |
| 📊 Telemetry | `ExecutionTelemetryScreen` | [ ] pass / [ ] fail |
| 📡 NIDO | `NidoScreen` (P2P) | [ ] pass / [ ] fail |
| ℹ️ About | `AboutScreen` | [ ] pass / [ ] fail |
| 🖥️ Usage Stats | `UsageStatsScreen` | [ ] pass / [ ] fail |

**Expected**

- All seven open and render content; each has a working back/close affordance
  returning to chat.
- Settings shows: Tone, Model Catalog, Offline Knowledge Base, Telemetry, and the
  **System Recovery & Danger Zone** card.
- **Usage Stats** (approved: `UsageStatsScreen` WIRED, `SystemMonitor` REMOVED):
  reachable from the drawer; renders real RAM/storage/model/token metrics (not
  placeholders); back/close returns to chat; no duplicate native polling
  introduced (the content's poll loop runs only while mounted); `SystemMonitor`
  is gone — no drawer entry, no route, no import remains.
- `DrawerFooterStats` keeps working after the `SystemMonitor` removal: mini
  RAM/storage bars render and update in the drawer footer.

**Result notes:** _______________

---

## 10. Clear All Data verification — PRE-ALPHA BLOCKER

> This section is a **private-alpha gate**. It is no longer a permitted
> known-gap: anything the reset contract says must be destroyed that survives
> the wipe is a **FAIL** and a **PRIVATE ALPHA NO-GO**.

**Steps**

1. In chat, create identifiable state: send 2 messages; add one document to the
   knowledge base if the flow allows; change Tone and Language in Settings.
2. Create a **known durable memory**: tell the assistant a unique fact
   (e.g. "Remember: my vault code word is ZAFIRO-7."). Verify recall in the
   same session — ask for it back and confirm the answer.
3. If P2P identity/contact material exists on the device (personal code shown,
   contacts paired), note it.
4. Go to Settings → **System Recovery & Danger Zone** → **Clear All Data**; confirm.
5. After the wipe completes, observe where the app lands.
6. Walk the setup wizard again (fresh setup), then ask the assistant for the old
   memory ("What is my vault code word?") and check whether any P2P identity,
   contact, or conversation data reappears.

**Expected — full reset contract**

The wipe must destroy everything that contractually belongs to the full reset:

- chat/history;
- documents/knowledge (`models/`, `corpus/`, knowledge SQLite DB);
- settings;
- agent memory DB (the separate SQLite file owned by the agent memory store);
- P2P identity / contact / conversation data, where the reset contract covers it;
- NIDO-owned Keystore keys that must be destroyed per the ownership/lifecycle
  defined by the Clear All Data fix (Lane B) — **not** an indiscriminate wipe of
  every key in the Keystore; follow the documented ownership contract.

Also expected:

- Native llama/embedding contexts unload first.
- App returns to the **setup wizard** (required-models check fails) — NOT to an
  empty chat.
- The old durable memory is **not recoverable** after re-setup.
- A destroyed identity/key **does not silently reappear** after the reset.

**Result:** [ ] pass / [ ] **FAIL → PRIVATE ALPHA NO-GO** — notes: _______________

---

## 11. Encrypted storage spot checks

**Steps**

1. With the app installed and used (chat history exists), run:
   `adb exec-out run-as <package> ls -l files/`
2. Note the database filenames present.

**Expected**

- App functions normally (open/migrate path in `secureDatabase.ts` works with SQLCipher).
- `settings.json` is **plaintext** (known) — confirm no secrets/keys are stored in it.

**UNVERIFIED on device in this pass** (code-level only, no on-device crypto proof):

- SQLCipher actually encrypting the DB files (needs a hexdump check against the
  `SQLite format 3` header — do not claim from "app works").
- Keystore key availability / hardware-backed status — **no UI in the app
  exposes this** (verified: no keystore/StrongBox references in `src/ui/`).

**Result:** [ ] pass / [ ] fail — notes: _______________

---

## 12. P2P screen presence (NIDO)

**Steps**

1. Drawer → 📡 **NIDO** (`NidoScreen`).
2. Read the on-screen text about Bluetooth discovery; check for a personal code / pairing affordance.

**Expected**

- Screen opens, explains phone-to-phone via Bluetooth classic, no internet.
- Presence only: pairing, discovery, and send/receive against a **second physical
  phone** are NOT covered by this checklist (separate two-device protocol test).

**Result:** [ ] pass / [ ] fail — notes: _______________

---

## 13. Graceful degradation — no network after setup

**Steps**

1. Airplane mode ON (from Section 5 state, or re-enable).
2. In Settings, open Model Catalog (expect: shows downloaded models; remote catalog may be empty/unavailable — must not crash).
3. Trigger a model switch to a non-downloaded model if the UI allows attempting it.

**Expected**

- Local-first behavior everywhere; missing-network states show a clear message,
  never an infinite spinner or a crash.
- Downloaded models remain fully usable.

**Result:** [ ] pass / [ ] fail — notes: _______________

---

## 14. Drawer footer stats sanity

**Steps**

1. Open the drawer; look at the footer stats (`DrawerFooterStats`).
2. Compare the storage figure roughly against device reality (e.g. models ~1 GB+).

**Expected**

- Mini RAM/storage bars render with plausible numbers; last-query stats appear
  after a chat turn. No `NaN`, no negative values.

**Result:** [ ] pass / [ ] fail — notes: _______________

---

## Sign-off — state semantics

Keep these states separate at all times:

- **COMPILED** — a real `app-debug.apk` artifact exists (SHA-256 recorded above).
- **INSTALLED** — the APK installed on the physical device and launched.
- **TESTED** — checklist sections were executed on the device, with results recorded.
- **VERIFIED** — a claim backed by direct device evidence.

Rules:

- A generated APK alone proves **COMPILED** and nothing else.
- Never auto-convert a device test into PASS. **UNVERIFIED stays UNVERIFIED**
  until real evidence exists.
- The final verdict must be **NO-GO for private alpha** if any privacy/security
  blocker fails — including Section 10 (Clear All Data).

```
Sections failed: ____ / 14
Privacy/security blocker failed: [ ] yes → automatic NO-GO   [ ] no

Verdict: [ ] GO for private alpha   [ ] NO-GO (blocking fails: _______________)
```

---

*Checklist version: 2026-09-27 rev2. Grounded in repo HEAD `e80de5c` source
plus approved corrections: English-first i18n decision, Clear All Data as a
pre-alpha blocker, `UsageStatsScreen` wired into the drawer (`ChatScreen.tsx`),
`SystemMonitor` removed. Amend the version/HEAD again when the pre-alpha lanes
(A: English-first, B: Clear All Data fix) land in code.*
