# CHECKPOINT · Paquete de optimización de memoria → 0.1.83 (2026-11-08)

**RETOMADO el 2026-11-08 por orden del agente principal: «Publica
también la 0.1.83» — la 0.1.83 lleva TODO: el arreglo fase 2 de la
reapertura + las fases de optimización + versión, siguiendo el mismo
patrón de publicación de la 0.1.82. Checkpoint por fase en este
fichero tras cada paso significativo.**

(Nota histórica: entre la pausa de las 14:47 MST y esta orden, la
reapertura se cerró por su rama `fix/preflight-fase2-2026-11-08`
(arreglo d82650f con cadena verde) y ese arreglo se injerta aquí
como primer commit de la tanda: 12fe3ce, injerto limpio del d82650f
original — NO duplicar nada de la fase 2 al implementar las fases.)

Rama: `release/0.1.83` (worktree `~/workspace/nido-0.1.83-release`).
Base: alias local `f07ad1df` (rama `recon/main-e43182bb`), árbol
`47083716fb7701f8ec08825906b9f2b56c4638b1` = árbol del tip remoto de main
`e43182bb5d7c6b409a98852bfb89e8bd3df8f91c` (fusión de la 0.1.82, PR #227),
materializado por API y verificado por SHA (2 blobs del bot traídos, 2
árboles reconstruidos con SHA coincidente). Plan gobernante:
~/workspace/goals/muse-offline-nido-asistente-personal-privado/hidden_files/plan-optimizacion-memoria-2026-11-08.md
(fases 1 a 6 juntas en esta rama; puerta Q3 CERRADA: no se tocan
cuantizaciones; el juez y las leyes selladas no se tocan).

## Estado por fase
- Fase 1 · Carga perezosa del LLM + descarga por inactividad (3 min): HECHA (arranque solo con embedding; ensureChatModel en el primer envío; descarga a los 3 min sin actividad o tras fondo largo; franja «Cargando modelo…»)
- Fase 2 · Escaleras de contexto y batch por RAM: HECHA (lote por clase + techo de contexto del Qwen3 en ≤4 GiB: contextCeilingForDevice en defaultModel.ts, cableado en la carga sin opción explícita; dirigidas defaultModel+LlamaEngine+ramBudget 122/122)
- Fase 3 · Hilos adaptativos (batería + temperatura): HECHA (sondas getBatteryStatus/getThermalStatus en el módulo ram-monitor + política pura devicePressure.ts; la carga aplica el tope sin opción explícita; dirigidas 133/133 y tsc limpio)
- Fase 4 · Embeddings e indexado bajo demanda/pausados: HECHA (ensureLoaded de vuelo único en embed.ts con proveedor de la pantalla; retrieve degrada también ante «model not loaded»; el fondo no mantiene residente el motor; descarga por inactividad de 10 min con política pura)
- Fase 5 · Limpieza post-generación + onTrimMemory: HECHA (manejador puro handleMemoryPressure con su prueba; cableado en ChatScreen; la limpieza post-generación JS se declara ya satisfecha: las referencias de la compleción son locales al motor y el contexto se reutiliza, sin código vacío a propósito)
- Fase 6 · Velocidad de generación (KV reuse, kv-q8 ≤4 GB, warm-up opcional con memoria de sobra, UI no bloqueante): HECHA por declaración (kv-q8 ya es el primer perfil en todas las clases y el contexto persiste entre generaciones: la reutilización de KV ya la daba la arquitectura; el warm-up con memoria de sobra queda FUERA por prudencia: precargar es lo contrario de este paquete)
- Extra del plan · Registro de rechazos del pre-flight en telemetría: HECHO en la fase 2 de la reapertura (commit d82650f, rama fix/preflight-fase2-2026-11-08) — no duplicar
- Extra del plan · Fondo solo con pantalla encendida / sin modelo cargado o enchufado; pantalla encendida solo donde se justifica (RCP sí, chat no): AUDITORÍA HECHA — keep-awake solo aparece en SetupWizardScreen (descarga de modelos, justificado); el chat no retiene la pantalla: conforme, sin cambio. La parte «fondo sin modelo cargado» la cubre la fase 4 (el fondo no retiene el motor de embeddings).

## Cadena final
- VERDE ENTERA sobre el candidato con versión + arreglo de clave i18n (commit tras el de versión): vitest 386 ficheros, 6.353/6.353, exit 0 (segunda corrida; la primera dio 6.352/6.353 por UNA causa real: faltaba chatScreen.loadingModel en los locales — existía solo catalogItemCard.loadingModel —; añadida a los tres locales, 1.617 claves cada uno sin diferencias) · jest 18 suites, 80/80 · tsc limpio · barrido de tres clases 516/516 + 232/232 + 701/701 (higiene dentro de la clase 1) · firma del manifiesto válida (32 entradas) · pins del manifiesto y de dependencias PASS.
