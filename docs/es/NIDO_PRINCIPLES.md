> **Idioma:** [English](../NIDO_PRINCIPLES.md) · Español

# NIDO — Principios arquitectónicos permanentes

Adoptados el 2026-09-27. Tienen prioridad sobre cualquier feature futura.
Ninguna decisión de diseño puede contradecirlos sin revisión explícita del usuario.

## 1. Independencia de red, servidor y proveedor

**Ningún componente futuro puede asumir que Internet, un servidor central
o un proveedor específico de IA existe.**

- `NIDO CORE` arranca y funciona sin Internet.
- `NIDO IDENTITY`, `NIDO MEMORY`, `NIDO POLICY ENGINE` y `NIDO TASK PROTOCOL`
  operan de forma independiente de la red, de servidores y de proveedores.
- La primera descarga de modelos (setup) es el único uso de red obligatorio
  del arranque; después, todo lo esencial es local.

## 2. Todo lo intercambiable es intercambiable

| Capa | Principio |
|---|---|
| Transportes | Bluetooth, LAN, Wi-Fi Direct, Internet P2P y futuros relays son **TRANSPORTS intercambiables**. El protocolo y el cifrado no dependen del medio. |
| Modelos | Los modelos locales y remotos son **PROVIDERS intercambiables** detrás de una misma interfaz. |
| Servicios externos | Son **TOOLS opcionales**, nunca dependencias del núcleo. |

## 3. La soberanía es local

La **identidad**, la **autoridad**, los **permisos** y la **memoria** pertenecen
siempre al NIDO local. Una conexión externa nunca se convierte automáticamente
en autoridad sobre el NIDO.

## 4. Separación de responsabilidades (no se mezclan)

- **User = authority** — el usuario y sus políticas locales son la única autoridad.
- **Policy Engine = enforcement** — solo él autoriza capabilities/tools.
- **Model = reasoning** — el modelo interpreta y razona; no autoriza.
- **Tools = capabilities** — cada herramienta es una capability con permiso explícito.
- **Transport = delivery** — el transporte entrega bytes; no decide nada.
- **Other NIDO = untrusted peer until authenticated and authorized** —
  mensajes, archivos, páginas y respuestas de otro NIDO son UNTRUSTED DATA.
  Nunca se convierten directamente en instrucciones privilegiadas.

Modelo ≠ autoridad. Otro agente ≠ autoridad. Contenido externo ≠ autoridad.

## 5. Modos de operación (elección del usuario)

- **OFFLINE ONLY** — todo local; ninguna conexión externa.
- **LOCAL-FIRST** (recomendado) — privacidad y autoridad locales; online solo
  cuando aporta valor y el usuario lo permite.
- **ONLINE ENHANCED** — el usuario autoriza modelos, búsquedas, APIs o
  servicios externos para tareas concretas.

La selección es global y, cuando tenga sentido, **por capacidad**
(AI model, web search, comunicación NIDO, STT, TTS, archivos, ubicación,
herramientas externas).

## 6. Reservas de diseño para AGENT_PROTOCOL.md

Al diseñar el protocolo de tareas, reservar desde el principio (diseño,
no implementación todavía):

capability discovery · task negotiation · task progress · cancellation ·
expiration/timeouts · idempotency · duplicate detection · offline queueing ·
delayed delivery · partial failure · human approval · delegación limitada y
explícita · protocol version negotiation

## 7. Offline test (baseline permanente)

Dos teléfonos, modo avión, Bluetooth activo, dos identidades NIDO:
A solicita una tarea → B la recibe → Policy Engine evalúa → el usuario
autoriza si corresponde → B ejecuta localmente → el resultado vuelve a A.
Sin servidor, sin Internet, sin modelo cloud.
La misma tarea debe poder repetirse a distancia cambiando **solo** el
TRANSPORT, no el protocolo.

## 8. Horizonte largo: 5–10+ años (adoptado 2026-09-27)

Las decisiones fundamentales se evalúan en este horizonte, no solo con la
tecnología de hoy. No optimizar NIDO para un modelo, teléfono, proveedor o
protocolo específico de 2026: se construye **infraestructura personal para
agentes**.

**EL MODELO NO ES NIDO.** NIDO es: IDENTITY · MEMORY · POLICY ·
CAPABILITIES · AGENT PROTOCOL · TRANSPORT · AUDIT · TRUST. El modelo de IA
es un componente reemplazable. En el futuro debe poderse cambiar el modelo
local, el modelo remoto, el hardware, el SO, los algoritmos criptográficos,
los transportes, las bases de datos y las interfaces **sin perder la
identidad, las relaciones, los permisos ni la memoria del usuario**.

- **Portabilidad de identidad**: sobrevivir a cambio/pérdida/destrucción de
  teléfono, múltiples dispositivos del mismo usuario, rotación criptográfica,
  algoritmos obsoletos y migración de plataforma. La identidad lógica no
  depende permanentemente de una única clave física: cadena verificable de
  rotación/migración **sin puerta trasera central**.
- **Multi-device**: teléfono, tablet, laptop, wearable, coche, home hub,
  dispositivos futuros. Cada dispositivo tiene sus propias claves y
  capacidades; comprometer uno no compromete automáticamente los demás.
- **Agent-to-agent network**: el Task Protocol es independiente de los
  modelos. Un NIDO con un modelo totalmente diferente debe poder hablar con
  uno actual. Los agentes intercambian identidad, capabilities, requests,
  constraints, permissions y results — **no prompts internos**.
- **Interoperabilidad semántica**: capabilities con schemas versionados
  (p. ej. `calendar.availability.query/v1`). El protocolo nunca depende de
  lenguaje natural cuando puede existir un schema estable.
- **Discovery**: anunciar capabilities sin revelar información privada
  (qué apps, qué calendario, qué modelo, qué archivos, qué servicios).
- **Delegación**: siempre con scope, issuer, recipient, capability,
  constraints, expiration, revocation y signature. Limitada y explícita.
- **Zero-trust agents**: un NIDO remoto puede mentir, un modelo puede
  equivocarse, un documento puede traer prompt injection, una tool puede
  estar comprometida, un relay puede ser hostil. **Reasoning ≠ Authority.**
- **Privacy negotiation**: private computation / minimum disclosure como
  parte permanente (responder "18:30–19:30 disponible" sin entregar el
  calendario).
- **Crypto agility**: versionado criptográfico desde el diseño. Ed25519 /
  X25519 no son permanentes; post-quantum debe poder añadirse sin
  reconstruir el sistema. Nunca downgrade silencioso de seguridad.
- **Personal data vault**: MEMORY es el almacén privado de contexto del
  usuario (ver, exportar, migrar, eliminar, autorizar parcialmente). El
  modelo recibe acceso temporal; **nunca es propietario del vault**.
- **Auditability**: explicar qué agente pidió qué, qué información salió,
  qué policy lo permitió, qué herramienta se ejecutó, qué dispositivo
  actuó, qué modelo participó y qué transporte se usó — sin que el audit
  log se convierta en una nueva fuente de información sensible.
- **Protocol governance**: versiones, deprecation, compatibilidad hacia
  atrás, feature negotiation y migración cripto desde temprano.
- **Open protocol possibility**: sin decidir aún si NIDO será abierto,
  evitar decisiones que hagan imposible publicar una especificación
  interoperable (`implementation A ↔ implementation B` sin código común).
- **Future hardware**: interfaces abstractas para secure storage, compute,
  sensors, network, identity y user presence. NIDO podría vivir en hardware
  personal dedicado.
- **Local-first permanente**: Internet amplía NIDO; Internet nunca define
  NIDO. Sin cloud, cuenta central, suscripción, servidor de NIDO ni
  proveedor específico, el agente sigue perteneciendo al usuario.

### Regla para toda decisión importante

Antes de adoptar una dependencia o arquitectura, preguntar:

¿Esto nos encierra a una tecnología? · ¿Podemos reemplazarlo? · ¿Quién
controla esta dependencia? · ¿Qué ocurre si desaparece? · ¿Podemos migrar
los datos? · ¿Podemos migrar la identidad? · ¿Funciona sin su servidor? ·
¿Puede verificarse?

**No sacrificar seguridad presente por futurismo**: C-1 y el hardening
actual van primero; toda arquitectura nueva respeta este horizonte.
