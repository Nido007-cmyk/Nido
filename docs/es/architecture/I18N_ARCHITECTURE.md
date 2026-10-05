> **Idioma:** [English](../../architecture/I18N_ARCHITECTURE.md) · Español

# Arquitectura I18N — NIDO

**Estado:** ESPECIFICACIÓN + plan de migración (2026-09-27).
**Directiva vigente:** `docs/NIDO_LANGUAGE_REQUIREMENT.md` — el inglés es el
idioma nativo/por defecto/de respaldo; i18n completa desde el inicio; sin texto
orientado al usuario codificado; selección persistida; Ajustes → Idioma.

## 1. Estado actual (auditado el 2026-09-27)

La **infraestructura i18n ya existe y es sólida**:

| Pieza | Ubicación | Estado |
|---|---|---|
| i18next + react-i18next + expo-localization | `package.json`, `src/i18n/index.ts` | BUILT |
| `LanguageProvider` / `useLanguage()` + selección persistida | `src/i18n/LanguageContext.tsx`, `src/models/settings.ts` (`get/setLanguageId`, guardado en `settings.json`) | BUILT |
| Locales `en`/`es`/`pt` | `src/i18n/locales/*.json` | BUILT — 326 claves cada uno, **cero claves faltantes** en es/pt vs en |
| `fallbackLng: "en"` | `src/i18n/index.ts` | BUILT — las traducciones parciales nunca renderizan en blanco |
| Adopción de `useTranslation()` | 24 de ~29 archivos UI | PARTIAL — 5 pantallas/componentes no lo usan (ver §3) |
| UI del selector de idioma | `src/ui/components/LanguageSelector.tsx` | BUILT (verificar ubicación en Ajustes — ver `docs/architecture/FEATURE_MAP.md`) |

**Totalmente local:** ninguna llamada de red en ningún punto de la ruta i18n
(detección de locale vía `expo-localization`, almacenamiento vía `settings.json`
local).

### Huecos vs. la directiva vigente

1. **El idioma por defecto es español-primero, no inglés.** `deviceDefaultLanguage()`
   (`src/models/settings.ts:222`) devuelve `"es"` cuando el locale del dispositivo
   no se reconoce, y `src/i18n/index.ts` documenta un "default español-primero".
   La directiva exige **inglés = nativo/por defecto**. Migración: el default pasa
   a ser `"en"`; el locale del dispositivo aún puede *sugerir* es/pt en el primer
   arranque, pero el default de la app y el respaldo son inglés. (Si el primer
   arranque auto-sugiere el idioma del dispositivo o arranca en inglés
   incondicionalmente es una pregunta de producto ABIERTA — §5.)
2. **Existen cadenas orientadas al usuario codificadas.** La adopción de `t()` es
   amplia pero no total; el inventario por pantalla está en
   `docs/architecture/FEATURE_MAP.md` (columna i18n). Regla en adelante: cualquier
   cadena nueva orientada al usuario debe ser una clave de locale; los PRs que
   añadan cadenas codificadas fallan la revisión.
3. **5 componentes sin `useTranslation`**: `AccordionSection.tsx`,
   `ModelLoadErrorCard.tsx` (nivel superior), `Toast.tsx`, `UsageStatsContent.tsx`,
   `VoiceInputButton.tsx` — migrarlos o confirmar que no renderizan texto
   orientado al usuario.

## 2. Arquitectura objetivo

### 2.1 Gestión de cadenas

- **Fuente única:** `src/i18n/locales/en.json` es el catálogo canónico. Las
  cadenas en inglés se escriben primero; es/pt son traducciones de él.
- **Espacios de nombres de claves** (ya en uso, mantener): namespaces de nivel
  superior por pantalla/dominio (`chatScreen.*`, `settings.*`, `notifications.*`,
  …). Las funcionalidades nuevas añaden claves bajo su propio namespace — nunca
  reutilizar las claves de otra pantalla.
- **Sin concatenación de cadenas** para oraciones: usar interpolación de i18next
  (`"hello": "Hello, {{name}}"`) y pluralización (`_one`/`_other`) para que los
  traductores reciban oraciones completas.
- **Disciplina de archivos de locale:** `en.json` debe tener siempre todas las
  claves (`fallbackLng: "en"` garantiza que la UI nunca quede en blanco). Un
  chequeo de CI debería fallar si es/pt referencian claves ausentes en en
  (añadir cuando CI cubra chequeos JS).
- **Cadenas no-UI:** códigos de error, mensajes de log y cadenas de diagnóstico
  quedan en inglés y NO son claves de locale — pero todo lo mostrado al usuario
  (tarjetas de error, toasts, notificaciones, etiquetas de accesibilidad) SÍ lo es.

### 2.2 Matriz de cobertura (exigida por la directiva)

| Superficie | Mecanismo | Estado |
|---|---|---|
| Onboarding / asistente de setup | claves `setupWizard.*` | las claves existen; verificar cobertura total en FEATURE_MAP |
| Navegación (drawer/tabs) | claves `drawer.*` | las claves existen |
| Botones / acciones comunes | claves `common.*` | las claves existen |
| Ajustes (todas las tabs) | `*Settings.*`, `interfaceSettings.*` | las claves existen |
| Notificaciones | el copy de notificaciones debe pasar a claves | AUDIT — verificar que no haya copy codificado en `src/notify/` |
| Errores / mensajes del sistema | tarjetas de error, toasts → claves | PARTIAL — `Toast.tsx` no tiene `useTranslation` |
| Etiquetas de accesibilidad | props `accessibilityLabel`/`accessibilityHint` → claves | AUDIT — aún no inventariado; añadir a la checklist de revisión |
| UI del agente (indicadores de pensamiento, telemetría de ejecución) | claves para superficies orientadas al agente | `systemMonitor.*`, cadenas del agente — verificar en FEATURE_MAP |

### 2.3 Selección e idioma y persistencia

- La selección vive en `settings.json` (`languageId`), leída al arrancar por
  `LanguageProvider`, aplicada vía `i18n.changeLanguage()`. **Ya construido y
  correcto** — sobrevive al reinicio de la app (respaldado por archivo, no solo
  memoria).
- Ajustes → Idioma lista los idiomas soportados desde un único registro
  (`LANGUAGES` en `LanguageContext.tsx`). Añadir un idioma = añadir archivo de
  locale + una entrada de registro + miembro de la unión `LanguageId`. **Sin
  rediseño de UI, sin cambios de lógica** — esto ya se cumple por construcción.
- `LanguageId` es actualmente `"en" | "pt" | "es"`. Los idiomas nuevos extienden
  la unión; las claves no traducidas caen al inglés automáticamente.

### 2.4 Pluralización, fechas, números

- Usar las reglas de plural de i18next por locale (no hacer a mano
  `n === 1 ? … : …`).
- Fechas/tiempo relativo: existen claves `time.*`; preferir las APIs `Intl`
  (`Intl.DateTimeFormat`, `Intl.NumberFormat`) con el locale activo para un
  formateo correcto según el dispositivo — sin matemática de fechas propia en
  los componentes.
- RTL: aún no se soporta ningún idioma RTL. Si se añade uno después, el layout
  debe usar alineación flexbox/start-end (ya el default de RN) — marcarlo como
  prerrequisito en la checklist de aceptación de ese idioma.

## 3. Plan de migración (hacia cumplimiento total)

| # | Acción | Esfuerzo |
|---|---|---|
| 1 | Cambiar el idioma por defecto a inglés: `deviceDefaultLanguage()` → default `"en"`; actualizar el comentario "español-primero" en `src/i18n/index.ts` | pequeño |
| 2 | Auditar `src/notify/` + código de programación de notificaciones por copy codificado; pasar a claves | pequeño–medio |
| 3 | Inventariar props `accessibilityLabel` en toda la app; convertir a claves | pequeño |
| 4 | Migrar los 5 componentes sin `useTranslation` (o documentar por qué están exentos) | pequeño |
| 5 | Barrer las cadenas codificadas restantes según la columna i18n de FEATURE_MAP | medio |
| 6 | Añadir chequeo de completitud de claves de locale (en = superconjunto) a CI/test | pequeño |
| 7 | Decidir comportamiento de primer arranque: arrancar siempre en inglés vs. sugerir el locale del dispositivo (decisión de producto, §5) | decisión |

## 4. Reglas para todo trabajo futuro

1. **Inglés primero:** escribir la cadena en inglés, añadir la clave, luego traducir.
2. **Sin texto orientado al usuario codificado** en los componentes — jamás. (Los
   comentarios y logs de desarrollo están exentos.)
3. **Oraciones completas** en las claves; interpolación antes que concatenación.
4. **Las pantallas nuevas** se fusionan con su namespace totalmente con claves en
   `en.json` antes del merge; es/pt pueden ir rezagados (el fallback lo cubre)
   pero no deben referenciar claves inexistentes.
5. **Mockups visuales y trabajo de UI en inglés** a menos que se pida
   explícitamente lo contrario (directiva).

## 5. Preguntas abiertas

1. Primer arranque: ¿inglés incondicional vs. sugerencia del locale del
   dispositivo (con inglés como default preseleccionado)?
2. ¿Debería `settings.json` guardar un `localeVersion` para detectar
   traducciones obsoletas tras actualizaciones?
3. Proceso formal de revisión para traducciones contribuidas por la comunidad
   (después).
