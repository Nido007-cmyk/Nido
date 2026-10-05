> **Idioma:** [English](../../release/UPDATE_AND_ROLLBACK.md) · Español

# NIDO Update & Rollback — diseño

**Estado:** diseño, NO implementar todavía.
**Principio:** una actualización es un cambio de código en el dispositivo del
usuario. Nunca puede ser un cambio silencioso de **autoridad**.

---

## 1. Superficies de actualización

Cada una versiona y migra por separado; un cambio en una no arrastra a las
demás salvo declaración explícita:

| Superficie | Qué cambia | Riesgo característico |
|---|---|---|
| App | binario, UI, lógica | nuevos permisos, nueva red |
| Protocol | `nido/x.y`, envelopes, state machines | incompatibilidad con peers antiguos |
| Database | schema SQLCipher, migraciones | pérdida/corrupción de datos |
| Models | pesos locales (GGUF) | comportamiento del razonamiento, tamaño, batería |
| Capabilities | catálogo, schemas, `human_approval` | ampliación silenciosa de lo ejecutable |
| Policy schema | formato de reglas de política | reglas viejas malinterpretadas |
| Avatar format | formato de avatar personal | corruptela visual (bajo riesgo, pero versionado igual) |

### 1.1 Regla de seguridad de updates

> **FROZEN PRINCIPLE.** Una actualización **nunca** amplía silenciosamente:
> permisos del SO · autonomía del agente · divulgación de datos · autoridad
> de gasto · acceso a red.
>
> Concretamente: después de actualizar, el conjunto efectivo de
> `(capability, peer, decisión)` permitido debe ser **subconjunto** del
> anterior, salvo decisiones explícitas nuevas del usuario. Cualquier
> ampliación requiere consentimiento explícito, presentado como tal
> ("esta actualización quiere X nuevo"), nunca enterrado en "mejoras".

Esto es INV-2 (AUTONOMY_NON_EXPANSION) aplicado al ciclo de vida del
producto: una capability nueva defaultea a DENY; una versión nueva de
capability (`v2`) no hereda la aprobación de `v1`; un campo nuevo en un
schema no se interpreta como permiso.

### 1.2 Pre-update checklist (diseño)

Antes de aplicar una actualización, el updater verifica localmente:

1. Firma del paquete válida (cuando exista infraestructura de firma).
2. `versionCode` mayor (sin downgrade accidental).
3. Diff de permisos declarados (AndroidManifest) — si hay permisos nuevos,
   se presentan al usuario **antes** de instalar, no después.
4. Diff de capabilities: lista de capabilities nuevas o con `human_approval`
   relajado → se presentan como "nuevas decisiones pendientes", en DENY
   hasta que el usuario decida.
5. Backup cifrado de DB + identidad **antes** de migrar (ver §3).

---

## 2. Feature flags

### 2.1 Propósito y forma

Flags **locales y versionados** para desactivar rápidamente sin nueva release:

- capabilities experimentales
- transportes específicos (p. ej. desactivar relay si se abusa)
- integraciones de modelo problemáticas
- nuevos comportamientos del agente

Forma (ilustrativa, no implementación):

```json
{
  "flags": {
    "transport.relay": { "state": "off", "since": "1.2.0", "reason": "abuse observed" },
    "capability.experimental.x": { "state": "deny", "since": "1.3.0" }
  },
  "version": 7
}
```

### 2.2 Regla dura

> **FROZEN PRINCIPLE.** Un feature flag **jamás** puede otorgar remotamente
> más autoridad al usuario. Ninguna actualización y ningún flag convierten
> `DENY → ASK` ni `ASK → AUTO` sin consentimiento explícito del usuario.
> **AUTONOMY MUST NEVER GROW SILENTLY.**
>
> Los flags solo pueden **reducir** autoridad/capacidad (apagar, degradar a
> DENY, exigir ASK). La dirección contraria exige una decisión de política
> del usuario en el dispositivo.

Corolarios:

- Los flags se evalúan **después** del Policy Engine, nunca antes: un flag
  no puede "pre-autorizar" lo que la política denegaría.
- Un flag recibido de red (si algún día existen flags remotos) es
  **UNTRUSTED DATA**: solo puede apagar, nunca encender. Un flag remoto que
  intente encender se ignora y se registra como evento de seguridad.
- El estado de flags es visible para el usuario (qué está apagado y por qué).

### 2.3 Clasificación

- **FROZEN:** dirección única de los flags (solo reducen); evaluación después
  de policy; flags remotos = untrusted, solo-apagan.
- **PROVISIONAL:** el formato del manifiesto de flags.
- **OPEN QUESTIONS:** (1) ¿Deben existir flags remotos alguna vez, o solo
  locales empaquetados con la release? (2) ¿Quién firma el manifiesto de
  flags y cómo se distribuye sin un servidor central?

---

## 3. Safe rollback

### 3.1 Qué debe sobrevivir a un rollback

Volver a la versión anterior **sin**: romper la DB · perder la identidad ·
corromper la memoria · romper los pairings · causar crypto downgrade.

### 3.2 Diseño

- **Migraciones declaradas reversibles o no.** Cada migración de DB lleva un
  campo `reversible: true/false`. Si `false`, la release lo **declara
  explícitamente** en sus notas ("a partir de 1.4.0 no hay rollback seguro
  a 1.3.x") — prohibidas las puertas de una sola vía silenciosas.
- **Backup pre-migración:** antes de migrar, snapshot cifrado de DB +
  identidad + pairings. El rollback restaura el snapshot; no intenta
  "migrar hacia atrás" lógica de negocio.
- **Identidad separada de la app:** las claves de identidad viven en
  Keystore/almacén versionado independiente del schema de la app; un
  rollback de app nunca toca el almacén de identidad salvo migración
  declarada de ese almacén.
- **Pairings:** los secretos de pairing se conservan fuera de la DB de la
  app o en tabla no migrada destructivamente; el rollback no invalida
  relaciones salvo que la migración lo declare.
- **Crypto downgrade:** el rollback nunca restaura suites criptográficas
  retiradas por inseguridad. Si la versión anterior usaba una suite hoy
  prohibida, el rollback a esa versión se **bloquea** con explicación, no se
  permite en silencio. Volver atrás en features ≠ volver atrás en seguridad.

### 3.3 Downgrade declarado imposible

Si después de cierta migración el rollback seguro no es posible, debe
declararse explícitamente **antes** de que el usuario actualice:

```
"Esta actualización migra el formato de identidad a v2.
 No será posible volver a 1.x sin re-hacer el pairing.
 ¿Continuar? [Ver qué cambia] [Cancelar]"
```

> **FROZEN PRINCIPLE.** Ninguna migración one-way silenciosa. El usuario
> decide con la información completa, o no hay migración.

---

## 4. Actualización segura por superficie

- **Protocol:** negociación de versiones (AGENT_PROTOCOL.md §6); un peer
  antiguo sigue hablando `nido/1.0` mientras la política local lo permita;
  deprecación con fecha de sunset anunciada, sin auto-degradar seguridad.
- **Database:** migraciones transaccionales (todo o nada); verificación de
  integridad post-migración (`cipher_integrity_check`); ante fallo,
  restaurar snapshot y reportar — nunca arrancar con DB a medias.
- **Models:** los pesos se versionan por hash; un modelo nuevo no cambia
  policy, capabilities ni flags; el Model Router puede hacer A/B pero la
  **autoridad** no cambia con el modelo (EL MODELO NO ES NIDO).
- **Capabilities:** catálogo versionado; capability nueva = DENY por
  defecto; cambio de `human_approval: always → conditional` se trata como
  ampliación de autoridad → requiere consentimiento explícito.
- **Policy schema:** versionado; reglas en schema antiguo se interpretan
  con el parser antiguo o se migran con confirmación del usuario; jamás se
  reinterpretan silenciosamente con semántica nueva.
- **Avatar format:** versionado; un formato desconocido no rompe la app
  (fallback a silueta), nunca bloquea funcionalidad.

---

## 5. Clasificación de decisiones

- **FROZEN PRINCIPLES:** (a) ningún update amplía silenciosamente
  permisos/autonomía/divulgación/gasto/red; (b) flags solo reducen autoridad,
  nunca la otorgan, y se evalúan después de policy; (c) ninguna migración
  one-way silenciosa — se declara antes; (d) rollback nunca restaura crypto
  retirada por insegura.
- **PROVISIONAL:** formato del manifiesto de flags, campos de la migración
  (`reversible`), contenido del pre-update checklist.
- **EXPERIMENTAL:** backup pre-migración automático con snapshot cifrado —
  el mecanismo concreto (qué se snapshotea, dónde vive, cuánto se conserva)
  está por diseñar.
- **OPEN QUESTIONS:** (1) Infraestructura de firma de paquetes sin servidor
  central — ¿llaves del proyecto distribuidas con la app inicial + rotación
  declarada? (2) ¿Cómo se presenta el "diff de autoridad" de un update sin
  fatiga de diálogos — agrupación por impacto, solo expansiones? (3) ¿El
  snapshot pre-migración debe cifrarse con clave distinta a la operativa?
