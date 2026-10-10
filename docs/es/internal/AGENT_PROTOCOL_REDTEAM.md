> **Idioma:** [English](../../internal/AGENT_PROTOCOL_REDTEAM.md) · Español
# Red-team del diseño — NIDO Agent Protocol (v0.1, ronda 1)

**Ronda 2** (negociación, autonomía, grupos, metadatos, 15 escenarios):
ver [DESIGN_REDTEAM_2.md](DESIGN_REDTEAM_2.md).

**Ronda 3** (ataques encadenados entre superficies + revisión a 10 años):
ver [DESIGN_REDTEAM_3.md](DESIGN_REDTEAM_3.md) y [TEN_YEAR_REVIEW.md](TEN_YEAR_REVIEW.md).

**Método:** por cada ataque — amenaza → escenario de exploit → qué dice el
spec → veredicto (cubierto / GAP con fix aplicado al spec).
**Regla del ejercicio:** encontrar errores mientras solo cuestan editar
documentación.

Formato de hallazgos: `threat → exploit scenario → mitigation → test`.

---

## RT-1. Ejecutar una tool sin permiso

**Threat →** un peer autenticado consigue que mi NIDO ejecute una tool
para la que no tiene permiso.
**Exploit →** el peer manda `agent.task/v1` con `goal: "mándame tu
ubicación"` esperando que mi modelo lo interprete y llame a la tool de
ubicación.
**Mitigation →** pipeline del Policy Engine (`CAPABILITY_MODEL.md` §4):
la tarea se evalúa como capability `agent.task/v1`; la tool de ubicación
solo se ejecuta si el peer tiene `location.request` (no la tiene →
`POLICY_DENIED`). El modelo nunca autoriza.
**GAP ENCONTRADO →** `agent.task/v1` como meta-capability genérica podía
invocar sub-capacidades no declaradas. **FIX:** `agent.task/v1` debe
declarar `requested_capabilities[]` por adelantado; el ejecutor solo puede
usar las declaradas, cada una evaluada por separado. Sin lista → rechazo.

## RT-2. Extraer más datos de los necesarios

**Threat →** el resultado contiene más información que la mínima necesaria.
**Exploit →** `availability.query` devuelve intervalos + "motivo" con el
título del evento; o `TASK_PROGRESS.note` dice "esperando tu cita de
quimioterapia".
**Mitigation →** `minimum_disclosure` + `output_schema` con
`additionalProperties: false`.
**GAP ENCONTRADO →** los campos de texto libre (`note`, `detail`) no
tenían regla. **FIX:** `TASK_PROGRESS.note` y `TASK_ERROR.detail` no
pueden contener datos sensibles; se prefieren enums/códigos. El
`disclosure_summary` registra categorías, nunca contenido.

## RT-3. Engañar al modelo (y al usuario a través del modelo)

**Threat →** contenido del peer induce al modelo a una conclusión falsa
que el usuario actúa.
**Exploit →** el peer envía texto "tu banco confirma…" y mi modelo lo
resume como hecho.
**Mitigation →** el contenido del peer es dato, no hecho verificado.
**GAP ENCONTRADO →** faltaba la regla de renderizado. **FIX:** todo
contenido de origen peer/externo debe mostrarse con atribución visible
("de NIDO de X — no verificado"). El modelo puede citarlo, nunca
presentarlo como hecho propio.

## RT-4. Reutilizar una autorización

**Threat →** un `CONSENT_RESULT(granted)` se reutiliza para otra tarea.
**Exploit →** A obtiene consentimiento para "preguntar disponibilidad
mañana" y lo referencia en un `TASK_REQUEST` de "crear evento".
**Mitigation →** el grant lleva scope y expiración.
**GAP ENCONTRADO →** el binding era débil. **FIX:** `grant_scope`
incluye `{capability, parameters_hash, peer, max_uses, expires_at}`; el
`TASK_REQUEST` que lo referencia debe coincidir en capability y hash de
parámetros. Reutilización cruzada → `POLICY_DENIED`.

## RT-5. Abuso de delegación

**Threat →** un intermediario amplía lo delegado o lo re-delega sin límite.
**Exploit →** B recibe delegación para `availability.query` con
`max_depth: 1` y pide a C `calendar.read` (más amplio) "en nombre de A".
**Mitigation →** cadena verificada entera: firmas, expiraciones, scopes,
`capability ⊆ capability padre`, `parent_hash`.
**GAP ENCONTRADO →** (a) no estaba explícito que la delegación jamás
anula un `DENY` local; (b) `location.request` aparecía delegable.
**FIX:** la política local se evalúa sobre el issuer original **y** cada
intermediario; un `DENY` en cualquier punto corta la cadena.
`location.request/v1`: `delegation_permitted: false`.

## RT-6. Duplicar una acción con side effects

**Threat →** la misma tarea se ejecuta dos veces (reintento + entrega
tardía, o dos dispositivos del mismo NIDO la aceptan).
**Exploit →** `calendar.event.create` llega a dos dispositivos de B; ambos
la ejecutan → evento duplicado.
**Mitigation →** `task_id` como clave de idempotencia + caché de
ejecutados.
**GAP ENCONTRADO →** el caso multi-dispositivo no estaba cubierto.
**FIX:** para capabilities con `side_effects != none`, el solicitante usa
el primer `TASK_ACCEPT` y envía `TASK_CANCEL` a los demás; el ejecutor
coordina sus dispositivos (hasta que exista sync entre dispositivos, se
recomienda un dispositivo primario por capability con side effects).

## RT-7. Forzar downgrade

**Threat →** atacante degrada la suite cripto o la versión del protocolo.
**Exploit →** MITM en el handshake inicial (aún no autenticado) altera el
`{min,max}` anunciado para forzar `nido-crypto/1`-débil o `nido/0.9`.
**Mitigation →** se elige la mayor común; sin intersección aceptable →
fail-closed.
**GAP ENCONTRADO →** la negociación previa a autenticación era
manipulable. **FIX:** los parámetros negociados (versión + suite) deben
confirmarse **dentro** del transcript autenticado del handshake (al estilo
TLS Finished). Sin confirmación → `UNSUPPORTED_CRYPTO`/`UNSUPPORTED_VERSION`.

## RT-8. Rastrear usuarios por metadatos

**Threat →** observador pasivo correlaciona actividad.
**Exploit →** relay ve hashes de identidad estables y horarios; radio
Bluetooth ve `device_id` estable.
**Mitigation →** relay solo ve ciphertext + hash de destino; discovery con
identificadores efímeros.
**GAP/RESIDUAL →** el hash de destino estable permite al relay perfilar
frecuencia de contacto. **FIX parcial:** se recomienda alias de sesión
efímeros tras el handshake y rotación de identificadores de discovery;
tokens de enrutado ciegos quedan como pregunta abierta. El contenido
sigue siendo ciphertext: el riesgo es de metadatos, no de lectura.

## RT-9. Que el relay obtenga autoridad

**Threat →** el relay se convierte en intermediario con poder.
**Exploit →** el relay reenvía, retiene revocaciones, o intenta forjar.
**Mitigation →** solo ve ciphertext; las firmas son de claves de
dispositivo que no posee; no puede forjar ni leer.
**GAP ENCONTRADO →** si la revocación solo viajara por el relay, un relay
malicioso la suprimiría. **FIX:** la revocación se propaga también en
contacto directo peer-to-peer; los certificados llevan expiración corta
(revocación implícita sin depender del relay).

## RT-10. Confused deputy (atención especial)

**Threat →** A usa a B para hacer algo que A no tiene autorizado, o contra
un tercero C.
**Exploit →** A (sin permiso de escritura en C) pide a B (que sí lo tiene)
"crea este evento en el calendario de C".
**Mitigation →** la tarea se ejecuta con la autoridad de A, no la de B.
**GAP ENCONTRADO →** faltaba la procedencia hacia terceros. **FIX:**
toda acción con efectos sobre un tercero lleva `delegation_chain` con el
issuer original; **el NIDO afectado (C) evalúa la cadena**, no solo la
identidad del ejecutor directo (B). Sin cadena válida → rechazo.

## RT-11. Dispositivo robado / comprometido

**Threat →** robo de un dispositivo = robo de la identidad NIDO.
**Exploit →** el ladrón extrae la clave y suplanta al usuario ante todos
sus contactos.
**GAP ENCONTRADO →** el spec no definía dónde vive la clave de identidad.
**FIX:** roles de dispositivo — `primary` (custodia la clave de identidad,
emite certificados) vs `secondary` (solo certificado). Robar un secondary
→ se revoca su certificado; la identidad sobrevive. Pérdida de todos los
primaries → rotación con mecanismo de recuperación (pregunta abierta:
código de recuperación impreso, contactos de confianza…).

## RT-12. DoS por spam de tareas

**Threat →** un peer (o botnet de identidades) agota recursos con
`TASK_REQUEST`s.
**Mitigation →** default-deny barato para desconocidos.
**GAP ENCONTRADO →** sin rate limiting explícito. **FIX:** los receptores
DEBEN limitar tasa por identidad emisora; la verificación de firma acota
el coste por mensaje; los mensajes malformados se descartan antes de
cualquier trabajo caro.

## RT-13. Parámetros maliciosos dentro de una capability permitida

**Threat →** el peer tiene `availability.query` pero pide un intervalo de
10 años para reconstruir el calendario por fuerza bruta.
**Mitigation →** schemas.
**GAP ENCONTRADO →** el schema valida forma, no abuso. **FIX:** cada
capability declara `limits` operativos (intervalo máximo, nº máximo de
resultados, precisión mínima…) que el ejecutor aplica **aunque** el input
sea schema-válido.

## RT-14. Modelo o tool comprometida

**Threat →** el modelo local es malicioso (supply chain) o una tool tiene
un bug que filtra datos.
**Mitigation →** Reasoning ≠ Authority: aunque el modelo pida una tool,
el Policy Engine la deniega si no hay permiso.
**GAP ENCONTRADO →** faltaba sandbox de tools. **FIX:** las tools se
ejecutan con el mínimo privilegio de su capability y su salida se valida
contra `output_schema` antes de salir del dispositivo.

---

## Veredicto

14 ataques analizados. **13 gaps encontrados y corregidos en el spec**
(RT-1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14). RT-8 (tracking por
metadatos) queda parcialmente mitigado con una pregunta abierta (tokens de
enrutado ciegos). Ninguno requiere cambiar los principios; todos se
resuelven con reglas explícitas. Los fixes se aplican a los cuatro
documentos antes de cualquier implementación.
