> **Language:** English · [Español](es/NIDO_LANGUAGE_REQUIREMENT.md)

# LANGUAGE REQUIREMENT — NIDO

**Status:** STANDING DIRECTIVE (2026-09-27, user)
**Applies to:** all NIDO app UI work from this date forward.

The native/default language of the NIDO app must be **English**.

Build the app with proper internationalization (i18n) support from the start so
additional languages can be selected by the user later from Settings → Language.

Requirements:

* English = default/native language and fallback language.
* Do not hard-code user-facing text directly into components.
* Keep all UI strings translation-ready.
* Language selection must persist after closing/reopening the app.
* Onboarding, navigation, buttons, settings, notifications, errors, system
  messages, accessibility labels, and agent UI must all support localization.
* Future languages must be addable without redesigning the UI or changing
  application logic.
* Visual mockups and UI work from now on should use English unless specifically
  requested otherwise.

Do not change the current visual design because of this requirement. Just make
sure the architecture is prepared correctly for multilingual support.
