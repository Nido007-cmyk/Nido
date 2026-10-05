# TRIAGE — hallazgos de validación en dispositivo físico

**Regla:** ningún bug se arregla en producción durante la fase de validación.
Primero se registra aquí con evidencia, se clasifica y se decide después.

**APK bajo prueba:** `app-release.apk` (run 36341581820)
**SHA-256:** `0ee2bc9f8ca3a6eb3694b4af2d674e9f06f341158bed40f18115d3f208b3ae57`
**Firma:** certificado Android Debug — **TEMPORAL**. No usar para distribución más amplia.

## Seguimientos conocidos (del análisis estático, previos a la prueba en tablet)

| ID | Hallazgo | Severidad | Estado |
|----|----------|-----------|--------|
| T-001 | Clases `DevLauncher*` muertas en el DEX: el paquete npm `expo-dev-client` sigue en `package.json` y se autovincula. Sin superficie en el manifest (inerte con `__DEV__=false`), pero es peso muerto y ruido. Acción propuesta: eliminar la dependencia npm. | Baja | Pendiente |
| T-002 | El APK está firmado con certificado **Android Debug** (los secrets `BOAR_UPLOAD_*` no están configurados). Funciona para sideload, pero **antes de cualquier distribución más amplia se necesita una clave release estable** — rotar la clave obliga a desinstalar/reinstalar. | Media | Pendiente |

## Bugs encontrados durante la validación en tablet

_(Registrar aquí cada fallo con: fecha/hora, prueba, qué se esperaba, qué pasó, pasos para reproducir, capturas.)_

| ID | Fecha | Prueba | Descripción | Severidad | Evidencia |
|----|-------|--------|-------------|-----------|-----------|
| T-003 | 2026-09-27 ~13:20 MST | P1 | **Crash al arrancar en Galaxy Tab A9+ 5G (SM-X218U).** El APK instala bien (PASS), pero al abrir NIDO se muestra brevemente la pantalla de carga/inicio y la app se cierra sola volviendo al launcher. Reproducido **2 veces**, incluyendo una vez desde Ajustes → Apps → NIDO → Abrir. Causa desconocida — pendiente captura de informe de errores (logcat). La app NO se desinstaló y sus datos NO se borraron: estado preservado para diagnóstico. | Alta | Instalación PASS; arranque FAIL ×2. Log pendiente (§2b de la guía). |
| T-004 | 2026-09-27 ~15:36 MST | Setup | **Branding residual "BOAR" en pantallas de setup** (múltiples instancias, misma causa): (1) wizard paso 1: título "BOAR" + `assets/boar.png` (`SetupWizardScreen.tsx:308`); (2) preview de personalización de interfaz: "🐗 BOAR" (`ThemeSelector.tsx:162`); (3) AboutScreen (ya documentado en auditoría licensing). Cosmético, no bloquea funcionalidad. Fix aprobado por el usuario 2026-09-27: renombrar texto visible a NIDO en el próximo build. **Decisión posterior del usuario (2026-09-27 ~15:52 MST):** usar su imagen de NIDO (peluche con brote y anillo dorado) como mascota **provisional** en la app — reemplaza `assets/boar.png` en SetupWizard/ChatHeader/Drawer/AboutScreen (`assets/nido-mascot-provisional.png`, fondo removido, 488x640). Esto sustituye la decisión anterior de slot neutral; BASE_MASTER V2 sigue pendiente para la identidad definitiva. | Baja | `tablet-setup-wizard-boar-branding.jpg` + foto 15:46 en `docs/ci-evidence/artifacts/run-36350095885/` |
| T-005 | 2026-09-27 ~15:40 MST | P3 descarga | **CONFIRMADO: bug de código — la verificación sha256 de assets pequeños siempre falla.** `ModelManager.verifyChecksum` lee el archivo como string Base64 y hashea *ese string* (`SHA256(base64(bytes))`) en vez de los bytes crudos (`SHA256(bytes)`), así que el digest nunca coincide con el del manifest. Afecta a todo asset ≤ `CHECKSUM_VERIFY_MAX_BYTES`: el embedding `bge-small-en-v1.5 (Q8_0)` y los corpus packs fallan determinísticamente incluso con reintentos; el LLM principal no se ve afectado (solo chequeo de tamaño). Verificado: los archivos en el servidor están intactos (hashes coinciden con el manifest). Demostración: `sha256(base64(bge)) = 2ec70d2f… ≠ ec38e8da…` del manifest. Fix: hashear los bytes crudos. | Alta | Descargas fallidas en tablet (foto paso 3); verificación local con curl+sha256sum+python |
| T-006 | 2026-09-27 ~17:55 MST | P1 setup wizard | **Logo/mascota cortado en el paso 1 del SetupWizard** (foto `tablet-setup-step1-logo-cropped.jpg`): la imagen de la mascota provisional (`nido-mascot-provisional.png`) aparece recortada por arriba en el hero del wizard. Cosmético, no bloquea. El usuario lo reportó y pidió ajustarlo **después** ("luego ajustamos todo eso") — queda como polish pendiente, no bloquea la validación T-005. | Baja | Foto del usuario 17:55 MST |
| T-007 | 2026-09-27 ~17:55 MST | P4 indexing → chat | **ESCALADO A BLOQUEADOR: "ENGINE INITIALIZATION HALTED" (`ERR_LOCAL_INIT`) en la pantalla de chat.** `Method getInfoAsync imported from "expo-file-system" is deprecated. You can migrate to the new filesystem API using "File" and "Directory" classes or import the legacy API from "expo-file-system/legacy".` El motor local (QWEN2.5-1.5B-INSTRUCT Q4_K_M, llama.rn) **no puede arrancar**: la inferencia local está bloqueada por completo. El error ya había aparecido como "Indexing error" en el paso 4. El modelo sí se descargó bien (Reasoning + Embedding COMPLETE) — es un problema de imports en código, no del modelo ni del dispositivo. Fix: importar la API legacy desde `expo-file-system/legacy` (o migrar a clases `File`/`Directory` de Expo SDK 54). Lane de fix local iniciado 2026-09-27 ~18:00 MST; sin nuevo build hasta autorización. | Alta | Foto del usuario 17:57 MST |

## Notas

- No se fusiona la rama `licensing/compliance-notices` como parte de esta validación.
- No se implementa UI de Tier 1.1/Tier 2 ni se inicia Tier 3.
- Ningún claim de seguridad sin probar se marca como verificado por esta lista.
