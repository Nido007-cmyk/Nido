> **Idioma:** [English](../MODEL_ROUTER.md) · Español

# NIDO Model Router — Especificación (borrador v0.1)

**Estado:** diseño, NO implementar todavía.

**Principio:** el modelo de IA es un componente **reemplazable**. NIDO es
identidad, memoria, política, capabilities, protocolo, transporte,
auditoría y confianza. El router decide *dónde* se razona; nunca *quién*
autoriza.

---

## 1. Interfaz de provider

```typescript
interface ModelProvider {
  /** Identificador estable: "local-qwen2.5-1.5b", "remote-<proveedor>", … */
  readonly id: string;
  /** "local" | "remote" | "future" */
  readonly kind: ProviderKind;
  /** Capacidades declaradas: contexto, herramientas, multimodalidad… */
  capabilities(): ProviderCapabilities;
  /** Generación. El prompt ya viene minimizado por el router. */
  generate(req: GenerationRequest): Promise<GenerationResult>;
  /** ¿Disponible ahora? (modelo descargado, red, cuota…) */
  available(): Promise<boolean>;
}
```

- `LocalModelProvider` — corre en el dispositivo (hoy: llama.rn/llama.cpp).
- `RemoteModelProvider` — API externa autorizada por el usuario.
- `FutureModelProvider` — reservado: NPU dedicada, hardware personal,
  futuros runtimes. La interfaz no cambia.
- Los providers son **intercambiables**: el agente pide "razona sobre X
  con política P"; el router elige el provider. Ningún componente asume un
  modelo, teléfono o proveedor específico.

---

## 2. Políticas de enrutado

Por tarea/capability, la política local fija uno de:

| Política | Significado |
|---|---|
| `LOCAL_REQUIRED` | Solo modelo local. Si no está disponible → la tarea espera o falla, **nunca** sale del dispositivo. |
| `LOCAL_PREFERRED` | Local si puede; si no, pide al usuario antes de salir (`ASK_USER` implícito). |
| `REMOTE_ALLOWED` | Puede usar remoto autorizado sin preguntar cada vez (el usuario lo autorizó por capability). |
| `ASK_USER` | Pregunta cada vez, mostrando el disclosure plan (§3). |

**Defaults por sensibilidad** (la capability los sugiere, la política local
manda):

- `sensitivity: high` (ubicación, identidad, claves, salud) → `LOCAL_REQUIRED`.
- Tareas de otro NIDO que toquen datos del usuario → `LOCAL_REQUIRED`
  salvo autorización explícita.
- Borradores, resúmenes no sensibles, lluvia de ideas → `LOCAL_PREFERRED`
  o `REMOTE_ALLOWED` según configuración.

Una tarea sensible puede exigir `LOCAL_REQUIRED` aunque el modelo local sea
peor: la privacidad manda sobre la calidad.

---

## 3. Disclosure planning (obligatorio antes de salir del dispositivo)

Antes de enviar **cualquier** información a un modelo remoto existe una
etapa explícita:

```
¿qué datos?   → categorías e items concretos (no "el contexto")
¿por qué?     → qué parte de la tarea los necesita
¿a quién?     → provider id + operador + jurisdicción si se conoce
¿para qué?    → task_id y capability que lo origina
```

El Policy Engine puede **reducir/redactar** el contexto antes del envío:
proyección por campos (como minimum_disclosure), anonimización de
identificadores, truncado. El plan de disclosure se registra en auditoría.

Si la política es `ASK_USER`, el usuario ve el plan y decide
("Esta tarea puede beneficiarse de procesamiento online. ¿Permitirlo esta
vez?" + qué información saldría). Sin aprobación → no sale nada.

---

## 4. La salida del modelo remoto es UNTRUSTED

Todo lo que devuelve un `RemoteModelProvider` entra al sistema con nivel
de confianza **EXTERNAL** (ver `CAPABILITY_MODEL.md` §5):

- Puede mostrarse/resumirse.
- **No puede** autorizar tools, conceder permisos ni modificar política.
- Si el agente quiere actuar sobre esa salida, la acción pasa por el
  pipeline del Policy Engine como cualquier otra.

Esto vale también para modelos locales comprometidos en el peor caso: el
modelo razona, el Policy Engine autoriza. **Reasoning ≠ Authority.**

---

## 5. Transparencia: NIDO Privacy Activity

Pantalla/informe donde el usuario entiende qué hizo su agente. Ejemplos:

```
Processed locally
Contacted NIDO: María
Sent 214 bytes over Bluetooth
No Internet used
Calendar availability disclosed: 18:00–19:00
Remote AI used: No
```

Si se usó Internet:

```
Remote AI used: Yes
Provider: <id>
Data categories sent: <lista del disclosure plan>
Reason: <tarea/capability>
Time: <ts>
```

Cada evento enlaza con el registro de auditoría (ver
`AGENT_PROTOCOL.md` §11). Sin telemetría silenciosa: el log es local,
cifrado, y el usuario puede verlo, exportarlo y borrarlo.

---

## 6. Degradación elegante

- Sin modelo local descargado → las tareas `LOCAL_REQUIRED` quedan en
  espera con explicación, no se degradan a remoto en silencio.
- Sin red → los providers remotos reportan `available() = false`; el
  router ni los intenta.
- Un provider que falla repetidamente se marca degradado (circuit
  breaker) y se reintenta con backoff; nunca se "prueba suerte" con un
  provider no autorizado.

---

## 7. Preguntas abiertas

1. ¿El disclosure plan debe firmarse/guardarse como prueba de
   consentimiento, o basta el evento de auditoría?
2. ¿Cómo se mide "el modelo local no puede con esta tarea" sin enviar la
   tarea fuera para comprobarlo? (Heurísticas locales: longitud,
   complejidad declarada, intentos fallidos previos.)
3. ¿Políticas por defecto distintas para `OFFLINE ONLY` / `LOCAL-FIRST` /
   `ONLINE ENHANCED`? (Probablemente: OFFLINE ONLY fuerza
   `LOCAL_REQUIRED` global.)
4. Formato del "privacy nutrition label" por provider remoto (quién opera,
   retención declarada, jurisdicción) — ¿parte del spec o de la UI?
