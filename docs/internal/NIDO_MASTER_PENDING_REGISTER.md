# NIDO MASTER PENDING REGISTER
Fuente de verdad para el GO de implementación completa local + push consolidado.
Creado: 2026-10-04. Directiva del owner: implementar todo lo técnicamente ejecutable en local.

## ESTADO GLOBAL
- HEAD: d9e85bf (frozen)
- Branch: master
- Push destino: PENDIENTE (owner indicará cuál GitHub)
- Estrategia: implementar todo local → probar todo local → gate final verde → UN push consolidado

---

## SECCIÓN A: ITEMS PROPIOS DE NIDO

### A1. GATE-1 — SQLCipher verificación física [BLOCKED: hardware]
- Estado: AUTHORIZED NOW (código/config), PHYSICAL VERIFICATION REQUIRED (dump)
- Acción: verificar código SQLCipher local; el dump físico de nido_memory.db queda pendiente de hardware real
- No fingir PASS sin dispositivo

### A2. Secuencia autorizada post-HOLD [AUTHORIZED NOW]
1. Re-verificar HEAD/tree + i18n hashes
2. Gate 3 en ambiente Android legítimo
3. Build release/Hermes APK + provenance
4. Registrar SHA-256 del APK
5. STOP para aceptación del owner (antes del push)
6. Plan de verificación física con ese APK exacto

### A3. Sistema de iconos interno v1 [AUTHORIZED NOW]
- 2 items de accesibilidad pendientes
- 6 mapeos de glifos pendientes
- Arquitectura pendiente de autorización del owner

### A4. V42 IDLE PoC [AUTHORIZED NOW]
- Autorizado en scratch surface únicamente
- STOP después de IDLE, sin más estados hasta revisión del owner

### A5. Nombre público [BLOCKED: decisión owner]
- NIDO es codename interno únicamente
- Requiere decisión del owner, no implementar

---

## SECCIÓN B: 37 ITEMS the upstream project (adopción técnica)

Directiva: no copiar a ciegas. Para cada item: ADOPT / ADAPT / ALREADY COVERED / REJECT WITH EVIDENCE / BLOCKED.

### Prioridad alta (1-7)
| # | Item | Estado inicial | Decisión | Evidencia |
|---|------|----------------|----------|-----------|
| 1 | Relevance gate for RAG | AUTHORIZED NOW | ALREADY COVERED | NIDO ya tiene filterByMinScore antes de fuseRetrievalResults con HONESTY CONTRACT. Threshold 0.45 es intencional (no copiar 0.7 de the upstream project sin datos de dispositivo). |
| 2 | Skip retrieval on chit-chat | AUTHORIZED NOW | ADAPT | Agregado tipo 'conversation' (jokes, about assistant, time). NIDO ya tenía el mecanismo, se extendió la categoría. 21 tests pasan. |
| 3 | 4 context chunks instead of 6 | AUTHORIZED NOW | PENDIENTE | Verificar en eval propio de NIDO |
| 4 | Storage budget check | AUTHORIZED NOW | PENDIENTE | Directamente portable |
| 5 | Gemma reasoning-format parsing | AUTHORIZED NOW | PENDIENTE | Si NIDO usa modelos Gemma |
| 6 | Embedding serialization | AUTHORIZED NOW | PENDIENTE | Si NIDO usa llama.rn para embeddings |
| 7 | RAM budget from total RAM | AUTHORIZED NOW | PENDIENTE | Recalibrar para dispositivos NIDO |

### Metodología y fixes (18-22)
| # | Item | Estado inicial | Decisión | Evidencia |
|---|------|----------------|----------|-----------|
| 18 | Reproducible offline proof (audit-apk.py) | AUTHORIZED NOW | ADOPT | Metodología adoptada. Estructura creada en scripts/offline-proof/. Scripts completos por portar de the upstream project (798 líneas). Documentado en README. |
| 19 | llama.rn unload crash fix | AUTHORIZED NOW | PENDIENTE | Verificar versión pineada de NIDO |
| 20 | Cross-library retrieval dedupe | AUTHORIZED NOW | ADOPT | Implementado: dedupe.ts con dedupeArticleCopies (word pairs, COPY_MIN_SHARE=0.6). Integrado en retrieve(). 10 tests pasan, tsc limpio. |
| 21 | RAM auto-pick cap 4GB | AUTHORIZED NOW | ALREADY COVERED | NIDO tiene RAM pre-flight (ramBudget.ts) que bloquea loads inseguros con mensaje claro. Default model Qwen2.5-1.5B Q4 (~0.9GB) está bajo el cap. El pre-flight es guardrail más fuerte que el cap del picker. |
| 22 | Eval resume with restore points | AUTHORIZED NOW | ADOPT | Diseño creado en src/eval/evalResume.design.ts adaptado al formato de NIDO. Incluye edge cases de the upstream project (blocked models, config mismatch, etc.). Implementación completa pendiente (prioridad media). |

### Features y diseño (8-17, 23-31)
| # | Item | Estado inicial | Decisión | Evidencia |
|---|------|----------------|----------|-----------|
| 8 | On-device MoE benchmark | AUTHORIZED NOW | BLOCKED | Requiere gate de licencia LFM antes de ship. No implementar hasta clearance legal. |
| 9 | On-device eval framework | AUTHORIZED NOW | ALREADY COVERED | NIDO ya tiene evalHarness.ts, evalHarness.pure.ts, evalSet.ts. Framework completo. |
| 10 | Knowledge packs | AUTHORIZED NOW | ALREADY COVERED | NIDO ya tiene src/rag/packs.ts con download, verificación y búsqueda. |
| 11 | SQLite transaction fixes | AUTHORIZED NOW | ALREADY COVERED | NIDO ya encola transacciones via writeChain (no anidamiento). Verificado en db.ts:188-213. |
| 12 | Adaptive routing | AUTHORIZED NOW | ALREADY COVERED | NIDO ya tiene src/routing/ completo (router, classify, executor, profiles). |
| 13 | Chipset/CPU reporting | AUTHORIZED NOW | ADOPT | Adoptar como instrumentación para el device gate (Tab A9+). Reportar chipset/CPU en evals. |
| 14 | Setup flow order | AUTHORIZED NOW | ADOPT | Usar como input de diseño para el wizard de setup de NIDO. No portar código, adaptar el orden. |
| 15 | Honest setup UX | AUTHORIZED NOW | ADOPT | Adoptar el patrón de UX honesto (progreso real, no fake). Aplicar a setup y descargas de NIDO. |
| 16 | Measurement conventions | AUTHORIZED NOW | ADOPT | Adoptar convenciones de medición de the upstream project (TTFT, tokens/s, memoria) como estándar para benchmarks de NIDO. Documentar en docs/. |
| 17 | Crowdsourced eval (Supabase) | AUTHORIZED NOW | REJECT | Requiere backend/Supabase. Conflicto directo con principio zero-network de NIDO. |
| 23 | In-app benchmark (PR #36) | AUTHORIZED NOW | ADAPT | NIDO tiene eval harness. Adaptar la idea de benchmark dentro de la app (UI) usando el harness existente. |
| 24 | Hardware-key attestation | AUTHORIZED NOW | ADAPT | Patrón de referencia para verificación de dispositivo. NO adoptar el módulo server-side (incompatible con zero-network). Usar el concepto para device-gate. |
| 25 | Quick vs full answer mode | AUTHORIZED NOW | ADOPT | Adoptar modo quick/full como opción UX. Rápido para respuestas cortas, completo para análisis. |
| 26 | Citation hygiene rules | AUTHORIZED NOW | ALREADY COVERED | NIDO ya tiene src/services/citations.ts con reglas de higiene. |
| 27 | Multi-pass citation-loss analysis | AUTHORIZED NOW | ADOPT | Adoptar como metodología de análisis para mejorar la calidad de citas en RAG. |
| 28 | Truthful voice privacy UX | AUTHORIZED NOW | ADOPT | Adoptar patrón de UX honesto para privacidad de voz (qué se procesa local vs no). |
| 29 | Live research timeline UI | AUTHORIZED NOW | ADAPT | Idea de UI para timeline de investigación. Adaptar al contexto de NIDO (no es research app, es asistente). |
| 30 | HF daily mirror | AUTHORIZED NOW | REJECT | Requiere HuggingFace/network. Incompatible con zero-network. Solo intel competitiva. |
| 31 | Reverted prompts listing | REJECT | Negativo | No adoptar (resultado negativo) |

### PRs recientes (37-39, 45-46, 51-52)
| # | Item | Estado inicial | Decisión | Evidencia |
|---|------|----------------|----------|-----------|
| 37 | Sentence-level RAG compression (PR #57) | AUTHORIZED NOW | ADOPT | Adoptar compresión a nivel de oración para RAG. Reduce contexto sin perder información clave. |
| 38 | "Answer anyway" bypass (PR #63) | AUTHORIZED NOW | ADOPT | Adoptar botón "responder de todos modos" cuando RAG no encuentra nada relevante. Mejora UX. |
| 39 | Health-instruction safety guard (PR #65) | AUTHORIZED NOW | ADOPT | CRÍTICO: Guard de seguridad para instrucciones médicas citadas. NIDO debe tener esto antes de cualquier uso con contenido de salud. |
| 45 | Android setup wizard RAM-gated (PR #67) | AUTHORIZED NOW | ADAPT | Adaptar wizard de setup con gate de RAM. NIDO ya tiene RAM pre-flight; integrar al flujo de setup. |
| 46 | Prompt ideas UI (PR #68) | AUTHORIZED NOW | ADOPT | Adoptar UI de ideas de prompts para ayudar a usuarios nuevos. |
| 51 | Four writing styles | AUTHORIZED NOW | ADAPT | NIDO tiene sistema de tonos. Evaluar si los 4 estilos de the upstream project aportan o si el sistema actual es suficiente. |
| 52 | Encrypted private memory (Branches) | AUTHORIZED NOW | ALREADY COVERED | NIDO YA TIENE memoria privada cifrada (SQLCipher). Es un diferenciador core de NIDO, the upstream project apenas lo está planeando. |

### Solo intel (no implementar)
32, 33, 34, 35, 36, 40, 41, 42, 43, 44, 47, 48, 49, 50, 53 — INTEL ONLY, documentados.

---

## SECCIÓN C: GATES ESPECIALES

- [ ] SQLCipher: código verde local; dump físico = PHYSICAL VERIFICATION REQUIRED
- [ ] Gate 3 Android: ejecutar en cierre técnico
- [ ] APK release/Hermes: solo después de gates locales verdes
- [ ] SHA-256: registrar hash exacto del APK final
- [ ] Physical device validation: no declarar PASS sin dispositivo

## SECCIÓN C2: GUÍA DE TONO HUMANO (directiva permanente 2026-10-04)

Todos los escritos de NIDO (documentación, UI strings, mensajes, README, docs)
deben seguir la guía de tono humano de `~/workspace/substack/style-guide.md`:
- Tono humano, primera persona, ritmo natural, lenguaje cotidiano
- Cero em-dashes
- Cero palabras prohibidas (delve, tapestry, realm, pivotal, etc.)
- Cero frases prohibidas ("it's worth noting", "at its core", etc.)
- Cero estructuras prohibidas ("It's not just X, it's Y", etc.)
- Aplicar a todo lo nuevo y revisar lo existente progresivamente

## SECCIÓN C3: OPORTUNIDADES DEEP RESEARCH (2026-10-05)

Basado en `~/workspace/research_notes/nido-improvement-opportunities-20261005-0116/report.md`.
Priorizadas por impacto en diferenciadores de NIDO.

### Prioridad Alta (proven, adoptar ahora)
| # | Oportunidad | Estado | Notas |
|---|-------------|--------|-------|
| DR-1 | Agency receipt por respuesta (modelo, TTFT, tok/s) | EN CURSO | Componente AgencyReceipt en UI redesign |
| DR-2 | Citations/sources bajo respuestas | EN CURSO | AgentMessage ahora soporta citations prop. Renderiza [n] con título y fuente. |
| DR-3 | Scheduled autonomous tasks | EN CURSO | Implementado: scheduledTasks.ts con validación, cron parsing, bloqueo de tools irreversibles. 11 tests pasan. |
| DR-4 | Skills system (procedimientos aprendidos) | EN CURSO | Implementado: learned.ts con LearnedSkillStore (learn, refine, suggest, tracking). 8 tests pasan. |
| DR-5 | Prompt-injection doctrine en policy engine | EN CURSO | Implementado: policyEngine.ts con content tagging, injection detection, human-in-loop para irreversibles, validación de args. 14 tests pasan. |

### Prioridad Media (emerging, pioneer)
| # | Oportunidad | Estado | Notas |
|---|-------------|--------|-------|
| DR-6 | Knowledge graph + hybrid retrieval | EN CURSO | Implementado: knowledgeGraph.ts (entidades, relaciones, decay, vecinos). 10 tests pasan. |
| DR-7 | P2P knowledge pack sharing (Bluetooth/Wi-Fi) | EN CURSO | Implementado: packSharing.ts con protocolo (advertise, chunk, verify, reassemble). 8 tests pasan. ¡the upstream project no lo tiene! |
| DR-8 | Dual-model architecture | PENDIENTE | Tiny specialist + reasoner grande |

### Prioridad Baja (research-stage, vigilar)
| # | Oportunidad | Estado | Notas |
|---|-------------|--------|-------|
| DR-9 | On-device LoRA personalization | VIGILAR | "El modelo aprende de ti, cifrado" |
| DR-10 | Differentially-private memory | VIGILAR | First-mover claim disponible |

## SECCIÓN D: STOP CONDITIONS
Detener solo si: credencial externa necesaria / hardware físico / decisión de privacidad / incompatibilidad arquitectónica / gate no verde sin ampliar alcance / cambio de invariante congelado / decisión de nombre público.

---
*Última actualización: 2026-10-04 — Item 1: ALREADY COVERED. Directiva de tono humano agregada.*
