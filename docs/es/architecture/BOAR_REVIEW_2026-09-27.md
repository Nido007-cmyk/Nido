> **Idioma:** [English](../../architecture/BOAR_REVIEW_2026-09-27.md) · Español

# Revisión de BOAR — 2026-09-27

**Estado:** SOLO INVESTIGACIÓN. Sin cambios de código.
**Método:** clon local `~/workspace/boar-app` actualizado desde
`https://github.com/rferrari/boar-app` el 2026-09-27 — el HEAD remoto es
`9898b35`, idéntico al clon usado para `~/workspace/offline-muse/BOAR_DEEP_DIVE.md`
(2026-09-26). **BOAR no ha cambiado desde el deep-dive**; nada de ese
documento necesita revisión. Esta revisión es una *revisión delta*: diff a
nivel de archivo de BOAR vs NIDO (`~/workspace/nido-app`) para encontrar
adopciones concretas.
**Disciplina:** EXISTE (verificado en código) vs PROPUESTO (diseño) es estricta
en todo el documento. Nada de lo que hace BOAR se presenta como algo que hace NIDO.

## Resultado principal

El `src/` de NIDO es un **superconjunto estricto** del `src/` de BOAR menos
exactamente 4 archivos, todas funcionalidades de red descartadas deliberadamente:

| En BOAR, no en NIDO | Por qué falta (correcto) |
|---|---|
| `src/models/discoveredModels.ts` | persistencia del navegador HF — red |
| `src/services/modelBrowser.ts` | búsqueda en la API de Hugging Face — red |
| `src/ui/ModelBrowser.tsx` | UI del navegador HF — red |
| `src/ui/ModelCatalogScreen.tsx` | muerta/legada en el propio BOAR (cero referencias) |

NIDO añade 30 archivos que BOAR no tiene (bucle de agente, skills, herramientas,
cripto/stack P2P, privacidad, seguridad, notificaciones, rutinas, TTS,
diagnósticos) y 11 dependencias (incl. `expo-secure-store`,
`expo-local-authentication`, `expo-notifications`, `expo-speech`, `tweetnacl`,
`qrcode`). Archivos de test: **43 vs 19**. Todos los módulos, scripts y docs de
BOAR están presentes en NIDO (la mayoría byte-idénticos). La revisión, por tanto,
encuentra **huecos de proceso/documentación y adopciones de patrones, no
funcionalidades faltantes**.

---

## Hallazgos (ordenados por valor/esfuerzo)

### R1 — Reescribir AGENTS.md para NIDO (ADOPTAR patrón, REESCRIBIR contenido)
- **QUÉ (hace BOAR):** el `AGENTS.md` de BOAR es una guía de construcción/ejecución
  orientada a agentes: comandos exactos desde un checkout limpio hasta el
  dispositivo, más restricciones no obvias (`expo prebuild --clean` tras tocar
  `app.json`, arreglo del aislamiento Wi-Fi de Metro vía `adb reverse`, el
  señuelo `SplashScreenManager`, "no destruir `android/` para arreglar builds").
  Es el mejor artefacto de onboarding del repo.
- **DÓNDE:** `boar-app/AGENTS.md` (archivo completo).
- **HUECO (NIDO hoy):** `nido-app/AGENTS.md` es **byte-idéntico al de BOAR** —
  aún titulado *"compiling & installing BOAR from source"*. Documenta la ruta
  de build en la nube EAS (archivada por decisión del usuario — no usar),
  objetivos `make`, y no dice nada sobre la ruta real de build de NIDO (GitHub
  CI, timeout de 180 min, el polo largo nativo de `llama.rn`), el módulo nativo
  `nido-p2p`, la verificación en dispositivo de SQLCipher/Keystore, o la regla
  de "no debilitar la seguridad para obtener builds verdes".
- **RECOMENDACIÓN:** ADOPTAR. Reescribir como guía de build específica de NIDO
  manteniendo la estructura de BOAR (prerrequisitos → comandos desde checkout
  limpio → APK release → verificación sin dispositivo → eval en dispositivo →
  trampas). Esfuerzo: pequeño. Valor: alto — un AGENTS.md obsoleto terminará
  instruyendo a un agente a hacer lo incorrecto (EAS, `rm -rf android`, Expo Go).

### R2 — Extender COMPLIANCE.md con las garantías de privacidad de NIDO (ADAPTAR)
- **QUÉ:** el `docs/COMPLIANCE.md` de BOAR es una matriz de cumplimiento con una
  sección de auditoría de red verificada (§5 PASS).
- **DÓNDE:** `boar-app/docs/COMPLIANCE.md`.
- **HUECO:** `nido-app/docs/COMPLIANCE.md` es **byte-idéntico (0 líneas de diff)**.
  No documenta ninguna de las nuevas garantías de NIDO: SQLCipher en ambas DBs,
  DEK respaldada por Keystore + cableado fail-closed, puerta biométrica/PIN,
  `allowBackup=false`, cripto P2P E2E, el módulo de auditoría de red, cero SDKs
  de analítica.
- **RECOMENDACIÓN:** ADAPTAR. Añadir filas específicas de NIDO con punteros de
  evidencia (`docs/C1_SQLCIPHER.md`, `docs/NETWORK_AUDIT.md`,
  `docs/C1_CONFORMANCE_REPORT.md`, `src/diagnostics/security.ts`). Esfuerzo:
  pequeño–medio. Valor: alto — esta es la base probatoria de cada afirmación
  "privacy-first"; la meta del PRE_ALPHA_PLAN ("todo lo marcado como funcional
  tiene evidencia real") necesita que este documento sea verdadero, no heredado.

### R3 — Arreglo de TD-1: extender el patrón de borrado ordenado de BOAR (ADAPTAR)
- **QUÉ:** el `appReset.ts` de BOAR implementa borrado *ordenado*: descargar
  módulos nativos → `resetDatabase()` (rag) → borrar archivos/modelos/corpus →
  ajustes → limpiar modelos descubiertos. El propio `resetDatabase()` hace
  limpieza best-effort del marcador `.sqlcipher`.
- **DÓNDE:** `boar-app/src/services/appReset.ts`,
  `boar-app/src/rag/db.ts` (`resetDatabase`).
- **HUECO:** NIDO heredó el patrón casi literal (diff = solo la eliminación de
  modelos descubiertos, que es correcta) — pero no cubre las nuevas superficies
  de NIDO: `nido_memory.db` (`clearMemoryDb()` existe en
  `src/agent/memory/memoryStore.ts:295`, sin referencias), las 3 claves de
  SecureStore, identidad/contactos/historial P2P, artefactos `eval/`. Esto es TD-1
  (HIGH), ya el ítem 1 del PRE_ALPHA_PLAN.
- **RECOMENDACIÓN:** ADAPTAR. Al arreglar TD-1, mantener la estructura ordenada
  best-effort-con-logging de BOAR y extender la secuencia: descargar nativos →
  cerrar ambas DBs → borrar ambas DBs → borrar claves de SecureStore (lista
  explícita de claves, incl. claves P2P) → borrar modelos/corpus/eval → ajustes →
  resembrar estado. No se necesita un patrón nuevo — la plantilla está probada.
  (No cambia la prioridad del PRE_ALPHA_PLAN; ya es la #1.)

### R4 — Encaminar la validación en dispositivo por el flujo eval-device de BOAR (ADOPTAR)
- **QUÉ:** `scripts/eval-device.mjs` + `docs/DEVICE_EVALUATION.md` definen un
  flujo de evaluación en dispositivo desatendido vía adb con reglas de seguridad
  (nunca ejecutar durante descargas de modelos, mantener la pantalla encendida,
  `--dry-run` primero, JSONL como fuente de verdad, fallos registrados no omitidos).
- **DÓNDE:** `boar-app/scripts/eval-device.mjs`, `boar-app/docs/DEVICE_EVALUATION.md`.
- **HUECO:** NIDO mantuvo ambos byte-idénticos y `EvaluationScreen` está
  CONSTRUIDA — no falta nada. El hueco es *procedimental*: el paso de
  "validación en dispositivo" del PRE_ALPHA_PLAN no nombra el procedimiento.
- **RECOMENDACIÓN:** ADOPTAR como el procedimiento nombrado para el paso de
  validación en dispositivo del plan. Esfuerzo: cero (ya está en el repo).
  Valor: medio — evita reinventar la disciplina de pruebas en dispositivo bajo
  presión de tiempo.

### R5 — Extender la convención de testeabilidad `.pure.ts` al código nuevo (ADOPTAR, continuo)
- **QUÉ:** BOAR aísla la lógica pura en gemelos `.pure.ts` (`rag/pure.ts`,
  `eval/*.pure.ts`, `executionTelemetry.pure.ts`); todo lo que toca
  `expo-sqlite`/`llama.rn`/`expo-file-system` está explícitamente *no* cubierto
  por tests unitarios. El contrato está documentado en AGENTS.md.
- **DÓNDE:** `boar-app/src/rag/pure.ts`, `boar-app/src/eval/*.pure.ts`, etc.
- **HUECO:** NIDO mantuvo los 3 archivos `.pure.ts` heredados y creció de 19 → 43
  archivos de test (nueva cobertura: `agent/loop` ×2, `agent/tools` ×6,
  `p2p` ×7, `privacy` ×2, `security` ×3, `diagnostics`, `notify`) — el *espíritu*
  de la recomendación del deep-dive ("nueva capa de agente nace con gemelos
  puros testeables") se cumple sustancialmente. Pero el código nuevo no usa el
  *nombrado* `.pure.ts`, así que el contrato de "qué está unit-testeado y por
  qué" es implícito en vez de visible.
- **RECOMENDACIÓN:** ADOPTAR la convención de nombrado para la lógica pura nueva
  en adelante; sin retrofit de los tests existentes. Esfuerzo: despreciable.
  Valor: bajo–medio (legibilidad del contrato de tests).

### R6 — Pipeline de paquetes de conocimiento: mantener como está (MANTENER, sin acción)
- **QUÉ:** `build-knowledge-pack.mjs` + `src/rag/packs.ts` (FTS5→coseno-int8
  keyword-first, paquetes de solo lectura, disciplina SHA).
- **DÓNDE:** `boar-app/scripts/build-knowledge-pack.mjs`, `boar-app/src/rag/packs.ts`.
- **HUECO:** NIDO mantuvo los scripts idénticos; `packs.ts` limpio de URLs de
  BOAR (cero referencias a `rferrari`/`boar-app`). Los paquetes abren en texto
  plano por diseño (datos públicos) — ya registrado como TD-16 (LOW, deliberado).
- **RECOMENDACIÓN:** OMITIR acción. Mantener la pipeline para futuro trabajo de corpus.

---

## Dónde NIDO ya mejoró a BOAR (confirmado — no retroceder)

| Debilidad de BOAR (deep-dive §10) | Estado de NIDO (EXISTE, verificado) |
|---|---|
| `settings.json` en texto plano | Sigue en texto plano (TD-4, planificado) — **aún no arreglado** |
| SQLite en texto plano | **ARREGLADO:** ambas DBs cifradas con SQLCipher, DEK en Keystore, fail-closed (`src/security/secureDatabase.ts`, `src/privacy/keyManager.ts`) |
| Sin `allowBackup=false` | **ARREGLADO:** `app.json` tiene `allowBackup: false` |
| System SpeechRecognizer puede usar red | Sigue STT del sistema (ruta honesta no disponible); `docs/WHISPER_PLAN.md` sigue el reemplazo on-device |
| Model Browser filtra intereses a HF | **ELIMINADO:** 4 archivos de red fuera |
| Permiso INTERNET permanente | Mantenido para setup/P2P; **módulo de auditoría de red añadido** (`src/privacy/networkAudit.ts`, `docs/NETWORK_AUDIT.md`) — la mitigación recomendada por el deep-dive, implementada |
| URLs sin fijar (`resolve/main`) | Manifiesto mantenido; el fijado sigue abierto (anotado en deep-dive §5) |
| Sin bloqueo biométrico | **ARREGLADO:** puerta biométrica/PIN (`src/security/biometricGate.ts`, namespace i18n `lockScreen`) |
| `execution_telemetry` persistente | Mantenido; sigue solo local, sin texto de mensajes (deliberado) |
| `discovered_models.json` en texto plano | **ELIMINADO** con la funcionalidad |

Capacidades solo de NIDO sin equivalente en BOAR: stack P2P E2E
(X25519/Ed25519 vía `tweetnacl`, emparejamiento, cola, inbox — 8 archivos + 7
archivos de test), bucle de agente + 21 herramientas + registro de skills,
memoria de agente cifrada (hechos/notas/recordatorios), notificaciones del SO
(`expo-notifications`), TTS sin conexión (`expo-speech`), capacidades de agente
`expo-calendar`/`expo-contacts`, diagnósticos de seguridad
(`src/diagnostics/security.ts`), locale español (`es.json`; BOAR tenía solo
en/pt — NIDO: 326 claves hoja × 3 locales, cero faltantes), permisos Bluetooth +
andamio del módulo nativo `nido-p2p`.

## Omisiones explícitas (descartadas correctamente — no reintroducir)

- **Model Browser / discoveredModels / ModelCatalogScreen** — red hacia
  Hugging Face; incompatible con el principio de cero red.
- **Enrutamiento adaptativo** (`src/routing/`) — diferido según el deep-dive;
  NIDO mantuvo los archivos, sin acción ahora.
- **Módulos `bundled-assets` / `ram-monitor` / `download-wake-lock`** —
  ya portados; `downloadManager`/`chatHistory`/`personalities` son
  byte-idénticos a los de BOAR (0 diff). Sin divergencia que arreglar.

## Impacto en el PRE_ALPHA_PLAN

**Sin cambios de prioridad.** El orden del plan se mantiene. Enmiendas concretas:

1. **TD-1 (ítem 1):** implementar usando la plantilla de borrado ordenado de
   BOAR (R3 arriba) — la secuencia y la disciplina best-effort están probadas;
   solo hay que añadir las nuevas superficies (DB de memoria, claves de
   Keystore, identidad P2P, `eval/`).
2. **Nueva tarea pequeña de docs (cabe en "sin desvío de alcance" — cero código):**
   reescribir `AGENTS.md` para NIDO (R1) y extender `COMPLIANCE.md` (R2). Ambas
   apoyan la meta del plan de que cada afirmación funcional tenga evidencia real.
   Sugerencia: hacerlas junto con las correcciones, antes de la próxima corrida de CI.
3. **Paso de validación en dispositivo:** nombrar `scripts/eval-device.mjs` +
   `docs/DEVICE_EVALUATION.md` como el procedimiento (R4).
4. **Aún sin arreglar de los huecos de privacidad de BOAR:** `settings.json` en
   texto plano (TD-4) y fijado de URLs de modelos — ambos ya rastreados; sin
   ítems nuevos.

---

*Revisión completada el 2026-09-27. Todas las comparaciones de archivos hechas
vía diff en clones locales; BOAR remoto verificado sin cambios desde el 2026-09-26.*
