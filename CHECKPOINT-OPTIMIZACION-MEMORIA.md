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
- Fase 1 · Carga perezosa del LLM + descarga por inactividad (3 min): EN CURSO (commit tras el de lote)
- Fase 2 · Escaleras de contexto y batch por RAM: lote HECHO (commit de lote: batchForRam en ramBudget.ts + llmInitParamsForProfile con lote por clase; dirigidas ramBudget+LlamaEngine 104/104) · techo de contexto del Qwen3 en ≤4 GiB: EN CURSO (commit siguiente)
- Fase 3 · Hilos adaptativos (batería + temperatura): PENDIENTE
- Fase 4 · Embeddings e indexado bajo demanda/pausados: PENDIENTE
- Fase 5 · Limpieza post-generación + onTrimMemory: PENDIENTE
- Fase 6 · Velocidad de generación (KV reuse, kv-q8 ≤4 GB, warm-up opcional con memoria de sobra, UI no bloqueante): PENDIENTE
- Extra del plan · Registro de rechazos del pre-flight en telemetría: HECHO en la fase 2 de la reapertura (commit d82650f, rama fix/preflight-fase2-2026-11-08) — no duplicar
- Extra del plan · Fondo solo con pantalla encendida / sin modelo cargado o enchufado; pantalla encendida solo donde se justifica (RCP sí, chat no): PENDIENTE (auditar al implementar)

## Cadena final
- PENDIENTE (dirigidas por fase + tsc + suite entera + jest + barrido de tres clases con cobertura).
