# BATCH3 Investigation — 2026-10-09

Engineering investigation (read-only, no code changes) for three NIDO issues.
All file paths relative to `~/workspace/nido-app`.

---

## 1. Reminder timing precision

**Symptom (physical evidence):** reminder set for 21:31 fired at 21:32 — 1 minute late.

### Code path

1. User text → `extractReminderAction()` → `parseReminderDateTime()` (`src/agent/loop/actionRouter.ts:77`)
   → `parseRelativeTime(t, now)` returns a full-precision `Date` (now + N seconds).
2. `runAgentLoop` (`src/agent/loop/agentLoop.ts:546-547`):
   `scheduleReminderNotification(reminder.id, reminder.text, new Date(reminderAction.dueAt))`.
3. `scheduleReminderNotification` (`src/notify/notifications.ts:113-137`) calls
   `Notifications.scheduleNotificationAsync` with a `DATE` trigger at that exact `Date`.
   No second-truncation anywhere in this path — the `Date` keeps full precision.

### Root cause (confirmed)

`expo-notifications@57.0.21`, `ExpoSchedulingDelegate.kt:104-117` (`setupAlarm`):

```kotlin
if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()) {
    AlarmManagerCompat.setExactAndAllowWhileIdle(...)   // exact
} else {
    AlarmManagerCompat.setAndAllowWhileIdle(...)        // INEXACT — Doze-batched, minutes late
}
```

NIDO declares `android.permission.SCHEDULE_EXACT_ALARM` in `app.json:26`, but
**never checks or requests it at runtime** — zero hits for
`canScheduleExactAlarms` / `ACTION_REQUEST_SCHEDULE_EXACT_ALARM` in `src/` and all
native modules (verified by grep).

On Android 12+ (Tab A9+ runs Android 13/14), `SCHEDULE_EXACT_ALARM` is a
*special app access*: manifest declaration alone does NOT grant it. The user must
enable "Alarms & reminders" for NIDO in system Settings (or be deep-linked there).
`canScheduleExactAlarms()` therefore returns `false` → expo-notifications silently
falls back to the inexact `setAndAllowWhileIdle` → the 21:31 alarm fires at 21:32.
This matches the observed symptom exactly (Doze batching typically delays by ~1 min
for near-term alarms).

### Fix plan (concrete)

1. Add a small native bridge (new method on an existing custom module, e.g.
   `modules/nido-p2p` is wrong-domain; better a tiny new `modules/exact-alarm`
   or extend `modules/download-wake-lock` if it's generic):
   - `canScheduleExactAlarms(): Boolean` → `AlarmManager.canScheduleExactAlarms()`
   - `openExactAlarmSettings()` → start `Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM`
     intent with `package:` URI.
2. In `scheduleReminderNotification` (`src/notify/notifications.ts`), before scheduling:
   if Android ≥ 12 and `canScheduleExactAlarms()` is false, surface a one-time
   prompt (Alert) explaining reminders need "Alarms & reminders" permission, with a
   button that calls `openExactAlarmSettings()`. Still schedule (inexact fallback
   is better than nothing).
3. Add a unit test asserting the permission-check branch is invoked (mock the bridge).
4. Optional hardening: in `parseRelativeTime`, zero out seconds (`setSeconds(0,0)`)
   so "en 1 minuto" lands on a minute boundary — cosmetic, not the root cause.

**Risk:** LOW. Additive code path; worst case the prompt never shows and behavior
is unchanged from today.
**Effort:** ~half day (native method + JS prompt + test).
**Verdict:** YES — this is the confirmed root cause of the 1-minute-late reminder,
not a parsing bug.

---

## 2. P2P notification icon

**Symptom:** the "NIDO P2P activo" foreground-service notification renders as a
generic white Bluetooth glyph.

### Current state

`modules/nido-p2p/android/src/main/java/expo/modules/nidop2p/NidoP2PService.kt:188`:

```kotlin
.setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
```

This is a framework drawable — Android tints it white and it reads as a generic
system/BT icon. The user correctly identified it as looking "generic or the upstream project".

### Existing asset assessment

`assets/android-icon-monochrome.png` (432×432, grayscale+alpha) exists, but it is a
**detailed 3D boar render** (the upstream project legacy mascot), not a NIDO glyph. Android renders
notification small icons as an **alpha mask**: every non-transparent pixel becomes
solid white. A detailed grayscale render would collapse into an unrecognizable
white blob. It is also off-brand (NIDO's mascot is the kawaii phantom-thief, and
the boar is the upstream project's mark). **Verdict: unusable — do not adapt it.**

### What Android needs

- Format: **vector drawable** (preferred — one file, no density buckets) or
  white-on-transparent PNGs at 24dp (mdpi 24px / hdpi 36px / xhdpi 48px /
  xxhdpi 72px / xxxhdpi 96px).
- Content: a **simple silhouette** — e.g. an "N" lettermark or a minimal
  phantom-thief mask shape — drawn in solid white (`#FFFFFF`) on transparent.
  Fine detail below ~2dp will not survive; keep strokes ≥ 2dp at 24dp viewport.
- Placement: the nido-p2p module currently has **no** `res/` directory. Create
  `modules/nido-p2p/android/src/main/res/drawable/ic_stat_nido.xml`
  (vector). Expo modules are Android libraries — resources merge into the app
  automatically at build time.
- Wiring: in `NidoP2PService.kt`, add `import expo.modules.nidop2p.R` and change
  line 188 to `.setSmallIcon(R.drawable.ic_stat_nido)`.

### Concrete spec for the asset (no image generated — design task)

1. Canvas 24×24dp, `viewportWidth/Height = 24`.
2. Single `<path>` in `android:fillColor="#FFFFFF"`, e.g. a bold "N" or
   simplified mask silhouette; no gradients, no strokes thinner than 2dp.
3. Validate visually at 24px: must read as a distinct shape, not a blob.
4. File: `modules/nido-p2p/android/src/main/res/drawable/ic_stat_nido.xml`.
5. Code change: 2 lines in `NidoP2PService.kt` (import + setSmallIcon).
6. Rebuild via the normal CI APK pipeline (resource merge happens in
   `expo prebuild` + Gradle; nothing special needed).

**Risk:** LOW (purely cosmetic; fallback to current icon if the drawable is
missing is automatic via build failure — it will fail fast at compile time, not
silently).
**Effort:** ~half day (design the glyph + wire + CI build + visual check on device).
**Verdict:** YES — spec is clear; the actual glyph design is a small art task.

---

## 3. Language switch with open chat

**Question:** what breaks when the user switches UI language (ES/EN/PT) with a
chat open?

### How language switching works

`src/i18n/LanguageContext.tsx` (61 lines): `setLanguage(id)` → React state +
`i18n.changeLanguage(id)` + persist. UI strings re-render via react-i18next. That
part is clean.

### Findings — bug confirmed (model response language)

1. **System prompt is hardcoded Spanish.** `buildSystemPrompt()`
   (`src/agent/loop/agentLoop.ts:319`, line 348):
   `"Hablas español neutro, cálido y conciso."`
   `runAgentLoop(query, {...})` (`src/ui/ChatScreen.tsx:691`) passes **no language
   parameter**. Result: with the UI in English, the model is still instructed to
   answer in neutral Spanish. The chat will answer in Spanish regardless of the
   UI language — a real, user-visible bug.

2. **Deterministic pre-router responses are hardcoded Spanish.**
   `src/agent/loop/agentLoop.ts` lines 559 (`Listo, te recordaré…`), 617
   (`Listo, guardé a … en mis contactos`), 659 (`Listo, lo guardé en mi memoria`).
   With UI in English, a reminder confirmation still reads in Spanish.

3. **What already works:** canned responses (`src/agent/loop/cannedResponses.ts:122`)
   `detectLang()` reads the UI locale first via `getUiLocale()` (i18n chain), so
   greetings/identity/privacy/help templates follow the UI language correctly.
   Chat history messages keep the language they were written in (correct behavior).

4. **No state corruption:** switching language mid-chat does not break chat state,
   message list, or the model session — it only produces the wrong *language* in
   new model/deterministic responses. In-flight generations are unaffected (they
   already captured the old prompt).

### Fix plan (concrete)

1. Thread the UI language into the agent loop: add `lang?: "es" | "en" | "pt"` to
   `AgentLoopOptions` (`src/agent/loop/agentLoop.ts:457`), pass it from
   `ChatScreen.tsx:691` via `useLanguage()` (already available in the component
   tree).
2. In `buildSystemPrompt`, replace the hardcoded line with a per-language
   instruction:
   - es: `"Hablas español neutro, cálido y conciso."`
   - en: `"You speak clear, warm, concise English."`
   - pt: `"Você fala português claro, caloroso e conciso."`
   Also localize the date line (`todayLong` uses `"es-ES"` hardcoded at line ~336 —
   parameterize the locale).
3. Localize the deterministic responses (lines 559, 617, 659 and the 5 hits from
   grep): add `tasks`/`agent` i18n keys in `src/i18n/locales/{es,en,pt}.json` and
   use `i18n.t()` — or pass the `t` function into the loop options. (Note: agent
   loop is outside React; use the `i18next` singleton directly, as
   `cannedResponses.ts` already does.)
4. Tests: extend `agentLoop.test.ts` — assert the system prompt contains the
   English instruction when `lang: "en"`; assert Spanish default unchanged.

**Risk:** LOW-MEDIUM. Touches prompt construction (model behavior surface) but is
mechanical string selection; existing Spanish behavior must remain byte-identical
(guard with a test).
**Effort:** ~1 day (options threading + 3-language strings + tests).
**Verdict:** YES — confirmed bug with a clean fix. The model answering in Spanish
when the UI is English is exactly the kind of "more problems than before"
regression-class issue the user notices.

---

## Summary table

| # | Issue | Root cause | Fix | Risk | Effort | Verdict |
|---|-------|-----------|-----|------|--------|---------|
| 1 | Reminder 1 min late | `SCHEDULE_EXACT_ALARM` declared but never granted at runtime → expo-notifications falls back to inexact alarm (verified in `ExpoSchedulingDelegate.kt:106-117`) | Native `canScheduleExactAlarms()` check + Settings deep-link prompt | LOW | ½ day | YES |
| 2 | Generic P2P notification icon | `android.R.drawable.stat_sys_data_bluetooth` at `NidoP2PService.kt:188`; existing monochrome asset is a the upstream project boar render, unusable as alpha mask | New vector glyph `ic_stat_nido.xml` in module `res/drawable/`, 2-line wiring change | LOW | ½ day | YES |
| 3 | Language switch with open chat | System prompt hardcodes Spanish (`agentLoop.ts:348`); deterministic responses hardcoded Spanish (lines 559/617/659); no lang param in `runAgentLoop` | Thread `lang` through loop options, localize prompt + responses, tests | LOW-MED | 1 day | YES |

Total: ~2 days for all three, each independently shippable. None requires a
physical-device gate to *implement*, but #1's exact-alarm grant flow and #2's
glyph legibility both need on-device visual confirmation.
