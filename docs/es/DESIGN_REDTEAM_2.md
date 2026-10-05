> **Idioma:** [English](../DESIGN_REDTEAM_2.md) · Español
# Red-team del diseño — ronda 2: negociación, autonomía, grupos, metadatos

**Método:** dos atacantes separados. Cada hallazgo:
`threat → exploit path → architectural mitigation → future conformance test`.

Cubre los documentos: `CAPABILITY_NEGOTIATION.md`, `AUTONOMY_MODEL.md`,
`GROUP_TASKS.md`, `METADATA_PRIVACY.md`, `AGENT_SCENARIOS.md`.

---

## Perspectiva 1 — PRIVACY ATTACKER

*Objetivo: obtener información que el usuario nunca pretendió revelar.*

### P-1. Reconstrucción por sondeo fino

**Threat →** 100 consultas individualmente permitidas reconstruyen el
calendario.
**Exploit path →** `availability.query` con slots de 15 min barriendo la
semana (escenario S2).
**Mitigation →** privacy budget en capas: rate limits, granularidad mínima
(redondeo que vuelve inútil el sondeo fino), disclosure budgets por
(peer, ventana), cooldowns y negativa por patrón de sondeo detectado.
**Conformance test →** secuencia de 50 queries de sondeo debe devolver
`BUDGET_EXHAUSTED` antes de la query N y el atacante no reconstruye más
allá de la granularidad mínima.

### P-2. Fingerprinting por discovery

**Threat →** "¿qué capabilities soportas?" revela apps, estilo de vida,
nivel socioeconómico.
**Exploit path →** barrido de `CAPABILITY_QUERY` contra muchos NIDO para
perfilar.
**Mitigation →** respuestas mínimas uniformes (`SUPPORTED/UNSUPPORTED/
SUPPORTED_WITH_CONSTRAINTS` sin detalles), rate limit por identidad,
política `answer_minimal` por defecto ante extraños, prohibición de
revelar proveedor/app/modelo/archivos. Discovery ≠ autorización.
**Conformance test →** dos NIDO con configuraciones internas distintas
deben producir respuestas de discovery indistinguibles en forma.

### P-3. Perfilado por el relay

**Threat →** el relay correlaciona frecuencia, horarios y tamaños.
**Exploit path →** hash de destino estable + timestamps durante un mes
(S10).
**Mitigation →** rendezvous IDs rotativos por época (fase 1), alias de
sesión efímeros; el contenido sigue siendo ciphertext. Residual honesto:
ritmos gruesos son irreducibles sin infraestructura pesada.
**Conformance test →** análisis de un log de relay simulado: ningún
identificador estable más allá de una época; el grafo de contacto no es
reconstruible entre épocas.

### P-4. Fuga en tareas grupales

**Threat →** el coordinador o un participante aprende más que la franja
elegida.
**Exploit path →** modo recolecta abusado, o coordinador que reenvía votos
individuales (S5/S6).
**Mitigation →** modo voto por defecto (solo se vota sobre franjas
propuestas), agregación mínima, y lo revelado no se puede des-revelar
(documentado como límite, no como bug).
**Conformance test →** el log del coordinador tras una tarea grupal
contiene únicamente la franja elegida, nunca intervalos individuales.

### P-5. Fuga por campos de texto libre

**Threat →** `note`/`detail`/`parameters_summary` filtran datos sensibles.
**Exploit path →** `TASK_PROGRESS.note: "esperando tu cita de oncología"`.
**Mitigation →** regla RT-2: sin datos sensibles en texto libre; enums
preferidos; `disclosure_summary` con categorías, no contenido.
**Conformance test →** fuzzing de campos libres con patrones sensibles:
el validador los rechaza o el emisor los sanea antes de firmar.

### P-6. Inferencia por resúmenes de consentimiento

**Threat →** `CONSENT_REQUEST.parameters_summary` revela de más.
**Exploit path →** resumen demasiado detallado ("cita con el Dr. X por Y").
**Mitigation →** los resúmenes son gruesos por spec (capability +
categorías, no contenido); el detalle fino solo lo ve el usuario local.
**Conformance test →** los vectores de `CONSENT_REQUEST` no contienen
PII en `parameters_summary`.

### P-7. Side-channels de tiempo (residual)

**Threat →** el tiempo de respuesta revela si hubo cache hit o cómputo
real (p. ej. "responde rápido = ya tenía ese dato").
**Exploit path →** medición de latencias de `TASK_RESULT`.
**Mitigation →** parcial: respuestas con jitter; no se promete
constant-time. Documentado como residual abierto.
**Conformance test →** (futuro) test estadístico de latencias; hoy:
ninguna decisión de política depende de ocultar este canal.

---

## Perspectiva 2 — AUTHORITY ATTACKER

*Objetivo: que NIDO haga algo que el usuario nunca autorizó.*

### A-1. Contrabando en el task graph

**Threat →** el modelo propone un grafo con un nodo privilegiado oculto.
**Exploit path →** "organiza una cena" con n4 = `location.request`
disfrazado en `data_inputs` (S7/S8).
**Mitigation →** validación nodo por nodo; ningún permiso global al grafo;
`required_authority` nunca ampliable más allá del solicitante.
**Conformance test →** grafo con capability no declarada en ningún nodo →
`GRAPH_MALFORMED`; nodo con capability denegada → `NODE_DENIED` sin
afectar ramas independientes.

### A-2. Confusión negociación → autorización

**Threat →** un `NEGOTIATION_ACCEPT` se interpreta como permiso para
ejecutar.
**Exploit path →** A acepta términos y B ejecuta `event.create` sin pasar
por política, "porque ya aceptaron".
**Mitigation →** ACCEPT = acuerdo sobre términos, **no** autorización. El
pipeline completo corre después del ACCEPT, siempre.
**Conformance test →** tras `NEGOTIATION_ACCEPT`, un `TASK_REQUEST` con
capability denegada debe devolver `POLICY_DENIED` aunque la negociación
haya sido aceptada.

### A-3. Coordinador que se otorga autoridad

**Threat →** el coordinador grupal forja un `GROUP_ACCEPT` para imponer
una acción.
**Exploit path →** coordinador malicioso envía aceptación falsa (S5).
**Mitigation →** el coordinador no es autoridad; la aceptación final es
local por Policy Engine; las firmas impiden forjar votos.
**Conformance test →** `GROUP_ACCEPT` sin votos firmados válidos →
`COORDINATOR_FAULT`; ningún side effect ocurre sin decisión local
`ALLOW`.

### A-4. Economy hint como autoridad

**Threat →** `economy_hint{cost: 0, conditions: none}` auto-reportado para
influir la política.
**Exploit path →** un servicio malicioso declara costo cero para que el
usuario lo apruebe sin pensar.
**Mitigation →** los hints son descriptivos y auto-reportados, **nunca**
autoritativos; la política local decide si los cree.
**Conformance test →** un hint que contradice los límites locales se
ignora; la decisión de política no cambia por ningún campo de
`economy_hint`.

### A-5. Carrera contra la revocación

**Threat →** la revocación llega cuando el paso ya empezó.
**Exploit path →** el usuario revoca durante una tarea larga (S12).
**Mitigation →** revalidación en cada frontera de nodo; pasos atómicos con
semántica declarada; lo pendiente → `AUTONOMY_REVOKED`; lo irreversible
completado se reporta honestamente.
**Conformance test →** revocar a mitad de grafo: ningún nodo pendiente se
ejecuta después; el reporte final distingue `done` de `cancelled`.

### A-6. Extensión que reclama privilegios

**Threat →** un `message_type` nuevo intenta saltarse el Policy Engine.
**Exploit path →** extensión con payload que "ordena" ejecutar una tool.
**Mitigation →** tipo desconocido → `UNKNOWN_MESSAGE_TYPE` fail-closed;
las extensiones no declaran privilegios de tool ni modifican el pipeline.
**Conformance test →** envelope con tipo inventado y firma válida debe
rechazarse antes de cualquier evaluación de política.

### A-7. Scope creep del consentimiento

**Threat →** reutilizar un consentimiento para otra acción (variante de
RT-4 en negociación).
**Exploit path →** consentimiento para "proponer evento" usado para
"crear evento".
**Mitigation →** `grant_scope{capability, parameters_hash, peer,
max_uses, expires_at}`; divergencia → `POLICY_DENIED`.
**Conformance test →** `TASK_REQUEST` que referencia un consentimiento
con distinto hash de parámetros → denegado.

### A-8. Downgrade por versión antigua

**Threat →** atacante finge ser NIDO antiguo para obtener semántica de
disclosure más débil.
**Exploit path →** pedir `v1` cuando existe `v3` con mejor minimum
disclosure (S15 inverso).
**Mitigation →** el solicitante elige versión explícitamente; el ejecutor
nunca degrada solo; cada versión declara su propio disclosure.
**Conformance test →** pedir versión no soportada → `UNSUPPORTED_VERSION`
explícito; pedir versión soportada antigua → se sirve esa versión con su
disclosure declarado, sin sorpresas.

---

## Veredicto ronda 2

15 hallazgos (7 privacy + 8 authority). Ninguno rompe los principios; la
mayoría ya estaban mitigados por el diseño y aquí quedan atados a tests
de conformance futuros. Dos residuales honestos: **P-7** (side-channels de
tiempo) y el perfilado grueso por el relay (**P-3** parcial). Ningún
hallazgo exige cambiar FROZEN CORE; dos aclaran redacción (P-5/P-6 ya
cubiertos por RT-2; A-2 ya cubierto por "ACCEPT ≠ autorización").
