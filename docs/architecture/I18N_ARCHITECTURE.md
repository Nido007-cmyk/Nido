> **Language:** English · [Español](../es/architecture/I18N_ARCHITECTURE.md)

# I18N Architecture — NIDO

**Status:** SPECIFICATION + migration plan (2026-09-27).
**Standing directive:** `docs/NIDO_LANGUAGE_REQUIREMENT.md` — English is the
native/default/fallback language; full i18n from the start; no hard-coded
user-facing text; persisted selection; Settings → Language.

## 1. Current state (audited 2026-09-27)

The i18n **infrastructure already exists and is sound**:

| Piece | Location | State |
|---|---|---|
| i18next + react-i18next + expo-localization | `package.json`, `src/i18n/index.ts` | BUILT |
| `LanguageProvider` / `useLanguage()` + persisted selection | `src/i18n/LanguageContext.tsx`, `src/models/settings.ts` (`get/setLanguageId`, stored in `settings.json`) | BUILT |
| Locales `en`/`es`/`pt` | `src/i18n/locales/*.json` | BUILT — 326 keys each, **zero missing keys** in es/pt vs en |
| `fallbackLng: "en"` | `src/i18n/index.ts` | BUILT — partial translations never render blank |
| `useTranslation()` adoption | 24 of ~29 UI files | PARTIAL — 5 screens/components don't use it (see §3) |
| Language selector UI | `src/ui/components/LanguageSelector.tsx` | BUILT (verify placement in Settings — see `docs/architecture/FEATURE_MAP.md`) |

**Fully local:** no network calls anywhere in the i18n path (locale detection
via `expo-localization`, storage via local `settings.json`).

### Gaps vs. the standing directive

1. **Default language is Spanish-first, not English.** `deviceDefaultLanguage()`
   (`src/models/settings.ts:222`) returns `"es"` when the device locale is
   unrecognized, and `src/i18n/index.ts` documents a "Spanish-first default".
   The directive requires **English = native/default**. Migration: default
   becomes `"en"`; device locale may still *suggest* es/pt on first run, but
   the app default and fallback are English. (Whether first-run auto-suggests
   the device language or starts in English unconditionally is an OPEN
   product question — §5.)
2. **Hard-coded user-facing strings exist.** Adoption of `t()` is broad but
   not total; the per-screen inventory is in `docs/architecture/FEATURE_MAP.md`
   (i18n column). Rule going forward: any new user-facing string must be a
   locale key; PRs adding hard-coded strings fail review.
3. **5 components lack `useTranslation`**: `AccordionSection.tsx`,
   `ModelLoadErrorCard.tsx` (top-level), `Toast.tsx`, `UsageStatsContent.tsx`,
   `VoiceInputButton.tsx` — migrate or confirm they render no user-facing text.

## 2. Target architecture

### 2.1 String management

- **Single source:** `src/i18n/locales/en.json` is the canonical catalog.
  English strings are written first; es/pt are translations of it.
- **Key namespacing** (already in use, keep): top-level namespaces per
  screen/domain (`chatScreen.*`, `settings.*`, `notifications.*`, …).
  New features add keys under their own namespace — never reuse another
  screen's keys.
- **No string concatenation** for sentences: use i18next interpolation
  (`"hello": "Hello, {{name}}"`) and pluralization (`_one`/`_other`) so
  translators get whole sentences.
- **Locale file discipline:** `en.json` must always have every key
  (`fallbackLng: "en"` guarantees no blank UI). A CI check should fail if
  es/pt reference keys missing from en (add when CI covers JS checks).
- **Non-UI strings:** error codes, log messages, and diagnostic strings stay
  in English and are NOT locale keys — but anything shown to the user
  (error cards, toasts, notifications, accessibility labels) IS.

### 2.2 Coverage matrix (required by the directive)

| Surface | Mechanism | Status |
|---|---|---|
| Onboarding / setup wizard | `setupWizard.*` keys | keys exist; verify full coverage in FEATURE_MAP |
| Navigation (drawer/tabs) | `drawer.*` keys | keys exist |
| Buttons / common actions | `common.*` keys | keys exist |
| Settings (all tabs) | `*Settings.*`, `interfaceSettings.*` | keys exist |
| Notifications | notification copy must move to keys | AUDIT — verify no hard-coded copy in `src/notify/` |
| Errors / system messages | error cards, toasts → keys | PARTIAL — `Toast.tsx` has no `useTranslation` |
| Accessibility labels | `accessibilityLabel`/`accessibilityHint` props → keys | AUDIT — not yet inventoried; add to review checklist |
| Agent UI (thinking indicators, execution telemetry) | keys for agent-facing surfaces | `systemMonitor.*`, agent strings — verify in FEATURE_MAP |

### 2.3 Language selection & persistence

- Selection lives in `settings.json` (`languageId`), read on launch by
  `LanguageProvider`, applied via `i18n.changeLanguage()`. **Already built
  and correct** — survives app restart (file-backed, not memory-only).
- Settings → Language lists supported languages from a single registry
  (`LANGUAGES` in `LanguageContext.tsx`). Adding a language = add locale
  file + one registry entry + `LanguageId` union member. **No UI redesign,
  no logic changes** — this already holds by construction.
- `LanguageId` is currently `"en" | "pt" | "es"`. New languages extend the
  union; untranslated keys fall back to English automatically.

### 2.4 Pluralization, dates, numbers

- Use i18next plural rules per locale (do not hand-roll `n === 1 ? … : …`).
- Dates/relative time: `time.*` keys exist; prefer `Intl` APIs
  (`Intl.DateTimeFormat`, `Intl.NumberFormat`) with the active locale for
  device-correct formatting — no custom date math in components.
- RTL: no RTL language is supported yet. If one is added later, layout must
  use flexbox/start-end alignment (already the RN default) — flag as a
  pre-requisite in that language's acceptance checklist.

## 3. Migration plan (to full compliance)

| # | Action | Effort |
|---|---|---|
| 1 | Change default language to English: `deviceDefaultLanguage()` → `"en"` default; update the "Spanish-first" comment in `src/i18n/index.ts` | small |
| 2 | Audit `src/notify/` + notification scheduling code for hard-coded copy; move to keys | small–medium |
| 3 | Inventory `accessibilityLabel` props app-wide; convert to keys | small |
| 4 | Migrate the 5 components without `useTranslation` (or document why exempt) | small |
| 5 | Sweep remaining hard-coded strings per FEATURE_MAP i18n column | medium |
| 6 | Add locale-key completeness check (en = superset) to CI/test | small |
| 7 | Decide first-run behavior: start in English always vs. suggest device locale (product decision, §5) | decision |

## 4. Rules for all future work

1. **English first:** write the English string, add the key, then translate.
2. **No hard-coded user-facing text** in components — ever. (Comments and
   developer logs are exempt.)
3. **Whole sentences** in keys; interpolation over concatenation.
4. **New screens** ship with their namespace fully keyed in `en.json` before
   merge; es/pt may lag (fallback covers it) but must not reference
   non-existent keys.
5. **Visual mockups and UI work in English** unless explicitly requested
   otherwise (directive).

## 5. Open questions

1. First-run: unconditional English vs. device-locale suggestion (with
   English as the pre-selected default)?
2. Should `settings.json` store a `localeVersion` to detect stale translations
   after updates?
3. Formal review process for community-contributed translations (later).
