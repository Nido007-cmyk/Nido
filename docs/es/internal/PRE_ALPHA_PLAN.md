> **Idioma:** [English](../../internal/PRE_ALPHA_PLAN.md) · Español

# NEXT PHASE — NIDO PRE-ALPHA FOUNDATION

**Estado:** PLAN APROBADO (2026-09-27, usuario). Ejecutar solo después de que
termine la ejecución actual del Android CI.

La auditoría de arquitectura se acepta como línea base. Mantener los 6 documentos
y su distinción estricta entre EXISTS / PROPOSED / SPECIFICATION ONLY. Nunca
presentar algo diseñado como si ya estuviera implementado.

PRIORITY 1 sigue siendo ANDROID COMPILED. Seguir monitoreando el build de
180 minutos. No declarar éxito hasta que GitHub produzca un app-debug.apk real
como artifact.

Mientras ese build corre, preparar la siguiente fase, pero no hacer cambios que
interfieran con el build actual.

Cuando la ejecución actual termine, ejecutar las CORRECCIONES PRE-ALPHA en cambios
pequeños y auditables:

1. PRIVACY BLOCKER — Clear All Data
   Arreglar TD-1. Un factory reset debe borrar de verdad la memoria, el historial/datos
   P2P y los datos sensibles correspondientes, incluyendo el manejo correcto de las
   claves del Keystore. Definir primero la semántica exacta de lo que se destruye y las
   consecuencias de destruir la identidad NIDO. Añadir tests que prueben que los datos
   no sobreviven al reset. No se acepta un borrado parcial silencioso.
2. ENGLISH-FIRST
   El inglés se convierte en el idioma nativo/por defecto/fallback de NIDO. Mantener
   EN/ES/PT y la selección persistente del usuario. Migrar los strings hard-codeados
   restantes a i18n, empezando por NidoScreen y las notificaciones. Toda UI nueva debe
   escribirse primero en inglés y no debe introducir strings hard-codeados visibles al
   usuario.
3. P2P VALIDATION
   Cuando tengamos un APK, verificar si modules/nido-p2p está realmente
   compilado/enlazado. No marcar el P2P Bluetooth como funcional hasta que
   discovery/connect/send se prueben en un dispositivo real.
4. DEAD UI
   Investigar UsageStatsScreen y SystemMonitor. No conectarlos ni eliminarlos
   automáticamente. Determinar su intención original, si duplican UI existente, y
   recomendar KEEP/WIRE/REMOVE con evidencia.
5. 3D
   Mantener el trabajo visual totalmente separado. No integrar V1. BASE_MASTER V1 fue
   útil como validación técnica del pipeline pero NO fue aprobado visualmente.
   La fuente de verdad visual es ahora NIDO_3D_Character_Design_System_v2.pdf +
   NIDO_BASE_MASTER_V2_REFERENCE.jpg.
   Trabajar primero SOLO en BASE_MASTER V2 para acercarse fielmente a la referencia:
   cuerpo crema plush/felt, brote orgánico, manto de tela con pliegues suaves reales,
   ojos grandes oscuros expresivos, rubor sutil, y núcleo luminoso de anillo dorado
   integrado en el pecho/manto.
   Antes de rehacer variantes, estados o LODs, entregar Front / 3/4 / Side / Back
   del mismo BASE_MASTER V2 y STOP para aprobación visual.
6. NO ECONOMY IMPLEMENTATION YET
   ECONOMY_ARCHITECTURE.md sigue siendo SPECIFICATION ONLY. No implementar
   Spark/Core, balances, inventario, ledger, monetización, pagos, tokens ni
   blockchain todavía.
7. NO SCOPE DRIFT
   Sin refactors generales, upgrades de dependencias ni features nuevas no solicitadas.
   No cambiar la seguridad para que compile.

Orden de ejecución:
Android CI actual → APK/error causal → correcciones PRE-ALPHA → tests de
regresión → nuevo Android CI → validación en dispositivo.

Mantener 3D como línea paralela independiente.

Tras cada bloque reportar siempre:
STATE BEFORE → WORK PERFORMED → BUGS FOUND → FIXES → TESTS →
SECURITY/PRIVACY IMPACT → STATE AFTER → REMAINING UNVERIFIED → NEXT BLOCKER.

La meta no es que el proyecto "parezca terminado". La meta es que cada cosa
marcada como funcional tenga evidencia real detrás.

## ENMIENDAS DE LA REVISIÓN DE BOAR (2026-09-27)

Fuente: `docs/architecture/BOAR_REVIEW_2026-09-27.md`. Repo BOAR sin cambios
desde el deep-dive de 2026-09-26; `src/` de NIDO es un superconjunto estricto
del de BOAR menos 4 archivos de red descartados deliberadamente. Sin cambios de
prioridades.

1. La implementación de TD-1 (Clear All Data) debe seguir la plantilla de
   borrado ordenado de BOAR (`appReset.ts`: unload native → resetDatabase →
   files → settings, best-effort) extendida a las nuevas superficies (DB de
   memoria, claves de Keystore, identidad P2P). Extender la secuencia, no
   reinventarla.
2. Añadir dos tareas de docs sin código junto a las correcciones, antes de la
   próxima ejecución de CI: reescribir `AGENTS.md` para NIDO (actualmente
   byte-idéntico al de BOAR; aún documenta la ruta EAS aparcada, no dice nada
   sobre GitHub CI, nido-p2p ni verificación SQLCipher) y extender `COMPLIANCE.md`
   (también byte-idéntico al de BOAR; no documenta ninguna de las nuevas garantías
   de NIDO: SQLCipher, Keystore, gate biométrico, allowBackup=false, P2P E2E).
3. Nombrar `scripts/eval-device.mjs` + `DEVICE_EVALUATION.md` como el
   procedimiento de validación en dispositivo en el paso de validación en
   dispositivo del plan.
4. Adoptar la convención de nombres `.pure.ts` para código nuevo en adelante
   (sin retrofit del código existente).
5. Mejoras confirmadas de NIDO sobre BOAR — no hacer regresión: SQLCipher en
   ambas DBs + DEK en Keystore + fail-closed, allowBackup=false, gate
   biométrico/PIN, navegador HF eliminado, módulo de auditoría de red, stack
   P2P E2E, agent loop + 21 tools, notificaciones, TTS offline, infra de locale
   (326 keys × 3).
6. Dos gaps de privacidad de BOAR sin arreglar siguen trackeados: settings.json
   en plaintext (TD-4) y pinning de URLs de modelos.
