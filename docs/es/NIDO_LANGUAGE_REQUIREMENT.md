> **Idioma:** [English](../NIDO_LANGUAGE_REQUIREMENT.md) · Español

# REQUISITO DE IDIOMA — NIDO

**Estado:** DIRECTIVA VIGENTE (2026-09-27, usuario)
**Aplica a:** todo el trabajo de UI de la app NIDO desde esta fecha.

El idioma nativo/por defecto de la app NIDO debe ser **inglés**.

Construye la app con soporte de internacionalización (i18n) adecuado desde el
inicio para que el usuario pueda seleccionar idiomas adicionales después desde
Ajustes → Idioma.

Requisitos:

* Inglés = idioma por defecto/nativo e idioma de fallback.
* No hard-codear texto visible al usuario directamente en los componentes.
* Mantener todos los strings de UI listos para traducción.
* La selección de idioma debe persistir al cerrar/reabrir la app.
* Onboarding, navegación, botones, ajustes, notificaciones, errores, mensajes
  del sistema, etiquetas de accesibilidad y la UI del agente deben soportar
  localización.
* Los idiomas futuros deben poder añadirse sin rediseñar la UI ni cambiar la
  lógica de la aplicación.
* Los mockups visuales y el trabajo de UI desde ahora deben usar inglés salvo
  que se pida específicamente otra cosa.

No cambiar el diseño visual actual por este requisito. Solo asegurarse de que
la arquitectura esté correctamente preparada para el soporte multilingüe.
