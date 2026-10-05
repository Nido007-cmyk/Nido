> **Idioma:** [English](../../release/BUG_REPORTING.md) · Español

# NIDO Bug Reporting — "Report a Problem"

**Estado:** diseño, NO implementar todavía (ni la plataforma/backend).
**Principio:** el usuario ve **exactamente** qué sale de su dispositivo
**antes** de que salga. Sin telemetría silenciosa. Sin "confía en nosotros".

---

## 1. Flujo "Report a Problem"

```
1. El usuario toca "Report a Problem"
2. La app genera el diagnóstico LOCALMENTE (en el dispositivo, sin red)
3. La app muestra el paquete COMPLETO al usuario: cada campo, cada valor
4. El usuario elige categoría + escribe su descripción (separada del diagnóstico)
5. El usuario decide qué adjuntos opcionales incluir (opt-in explícito, uno por uno)
6. Recién entonces: enviar / guardar local / descartar
```

> **FROZEN PRINCIPLE.** El paso 3 no es opcional ni "avanzado": es el flujo
> normal. Un reporte que el usuario no pudo inspeccionar antes de enviarse
> es un defecto de diseño, no una simplificación de UX.

### 1.1 Contenido por defecto (incluido siempre, visible en el paso 3)

- app version, build number, canal (INTERNAL/ALPHA/BETA/STABLE)
- OS version, device model, arquitectura (arm64-v8a, etc.)
- feature state: qué features/flags estaban activos (nombres, no valores sensibles)
- códigos de error sanitizados (del catálogo cerrado de PRIVACY_SAFE_DIAGNOSTICS.md)
- crash metadata: tipo de crash, stack trace **sanitizado** (sin rutas de
  usuario, sin valores de variables), hilo, timestamp
- performance metrics: memoria, tiempos de respuesta agregados — sin contenido
- transport state: qué transportes se usaron (nombres), contadores de
  errores por transporte — sin identificadores de peers
- security diagnostics: la lista PASS/FAIL/UNVERIFIED por ítem (ver
  PRIVACY_SAFE_DIAGNOSTICS.md §2) — **estados, no valores**

### 1.2 Excluido por defecto (NUNCA sin opt-in explícito)

Conversaciones · contenido de memoria · archivos · contenido del calendario ·
contactos · ubicación · claves privadas · session keys · secretos de identidad ·
prompts en crudo · contenido de mensajes NIDO↔NIDO · chain-of-thought del modelo.

> **FROZEN PRINCIPLE.** La lista de exclusión es cerrada por defecto y solo
> se abre por **opt-in explícito, granular y revocable**: el usuario activa
> cada adjunto adicional por separado, ve su contenido antes de enviar, y
> puede revocarlo después (el backend debe poder borrarlo — ver §5).

### 1.3 Opt-in explícito para información adicional

Cada adjunto opcional muestra: qué es, por qué ayudaría, cuánto tiempo se
conserva, quién puede verlo. Ejemplos: "incluir los últimos 50 eventos de
log estructurado (ya sanitizados)", "incluir captura de pantalla".
Ningún opt-in puede ser un "aceptar todo".

### 1.4 Separación descripción/diagnóstico

La descripción en texto libre del usuario viaja en un campo separado del
diagnóstico estructurado. Razones: (a) el usuario puede escribir datos
sensibles sin darse cuenta — el campo se marca como "no sanitizado,
revísalo"; (b) el diagnóstico estructurado sigue siendo parseable por
máquinas sin mezclar texto libre; (c) si el usuario pega una clave por
accidente, el daño está contenido en un campo visible y borrable.

---

## 2. Crash reporting por modo de NIDO

| Modo | Comportamiento |
|---|---|
| **OFFLINE ONLY** | El crash report **permanece local**. Se guarda cifrado en el dispositivo y es exportable manualmente (archivo que el usuario puede inspeccionar y compartir por el medio que elija). Cero red. |
| **LOCAL-FIRST** | El usuario decide **por reporte**: enviar, guardar local o descartar. Sin envío automático. El default es preguntar. |
| **ONLINE ENHANCED** | Puede existir envío automático **solo si** el usuario lo habilitó explícitamente **y** vio y entendió qué se comparte (el paquete del §1.1, mostrado una vez al habilitar, re-mostrado si cambia). Revocable en cualquier momento; revocar detiene futuros envíos. |

> **FROZEN PRINCIPLE.** No existe ningún modo, flag o actualización que
> habilite envío automático de crash reports sin consentimiento explícito e
> informado. "Mejorar el producto" no es consentimiento.

### 2.1 Opciones técnicas (a evaluar, no elegir aún)

- **OFFLINE ONLY:** archivo local exportable; el usuario lo adjunta donde quiera.
- **LOCAL-FIRST / ONLINE ENHANCED:** cola local de reportes pendientes con
  reintento; cada reporte lleva un ID aleatorio no correlacionable con la
  identidad NIDO (los reportes no deben permitir perfilar usuarios a través
  de múltiples envíos).
- Queda **abierta** la elección de librería/servicio; cualquier opción debe
  evaluarse contra: ¿qué sale del dispositivo por defecto? ¿puede
  desactivarse por completo? ¿el SDK hace llamadas de red propias no
  declaradas?

---

## 3. Categorías de feedback del usuario

Simples, en lenguaje del usuario, elegidas **antes** de escribir:

1. Something crashed
2. NIDO did something unexpected
3. NIDO couldn't complete a task
4. Bluetooth / NIDO connection problem
5. Voice problem
6. Model problem
7. Battery / performance
8. Privacy / security concern
9. Other

La categoría 8 (privacy/security concern) **no** es la ruta de
vulnerabilidades (ver §4): es para "me preocupa que X haya salido de mi
teléfono", que se trata como feedback sensible con manejo prioritario pero
no como reporte de seguridad formal.

---

## 4. Ruta separada: REPORT SECURITY ISSUE

Las vulnerabilidades **nunca** se mezclan con el feedback normal. Razones:
distinto nivel de sensibilidad, distinto SLA, distinto manejo (un reporte de
vuln en la cola de "la app se ve lenta" es una vulnerabilidad ignorada).

### 4.1 Diseño conceptual (preparar, no operar aún)

- **security.txt:** publicado en el dominio/canales oficiales cuando exista
  presencia pública; indica contacto de seguridad, política y alcance. No se
  publica hasta que haya alguien capaz de responder en el SLA definido.
- **Responsible disclosure policy:** qué se considera reporte válido, qué
  se espera del reportero (no explotar más allá de lo necesario para
  demostrar, no exfiltrar datos de usuarios), qué puede esperar del proyecto
  (acuse, timeline, crédito si lo desea).
- **Severity classification:** Crítica / Alta / Media / Baja, definida por
  **impacto** (ver BETA_SECURITY_GATE.md §1): ¿permite pérdida silenciosa de
  datos, plaintext de información privada, fuga de claves, bypass de Policy
  Engine, ejecución/pagos no autorizados, corrupción de identidad, downgrade
  cripto? → Crítica/Alta. Sin CVSS obligatorio al inicio; la clasificación
  la hace un humano con la taxonomía de impacto del proyecto.
- **Acknowledgement process:** acuse en ≤48h (provisional); el reportero
  recibe un identificador de caso y un canal privado.
- **Fix/release process:** el fix se desarrolla en privado, se verifica
  contra las 8 clases bloqueantes, se publica como hotfix con gate reducido
  (ver RELEASE_MODEL.md §3), y se reconoce al reportero según su preferencia.

> **FROZEN PRINCIPLE.** No hay bug bounty económico todavía. Un bounty mal
> diseñado atrae reportes de bajo valor y crea incentivos perversos; se
> evaluará cuando el programa de disclosure funcione sin dinero de por medio.

---

## 5. Requisitos del backend (cuando exista; no implementarlo ahora)

Diseño, no implementación — pero el diseño del cliente asume este contrato:

- Los reportes se almacenan separados por categoría; los de seguridad, en un
  acceso aún más restringido.
- Todo adjunto opt-in tiene TTL y borrado efectivo (revocación del usuario =
  borrado real, no "marcado como borrado").
- Los reportes no se correlacionan con identidad NIDO salvo que el usuario
  lo pida explícitamente (p. ej. "contáctame sobre este reporte" con un
  canal que el usuario provee).
- El backend nunca solicita al cliente más datos de los que el cliente
  decidió enviar: sin "diagnóstico extendido automático" del lado servidor.

---

## 6. Clasificación de decisiones

- **FROZEN PRINCIPLES:** (a) el usuario inspecciona el paquete completo
  antes de enviar — flujo normal, no avanzado; (b) lista de exclusión cerrada
  por defecto, solo opt-in granular; (c) ruta de seguridad separada del
  feedback; (d) cero telemetría silenciosa en cualquier modo; (e) sin bug
  bounty económico por ahora.
- **PROVISIONAL:** las 9 categorías de feedback y el SLA de acuse de 48h.
- **EXPERIMENTAL:** IDs de reporte no correlacionables con identidad —
  la propiedad es deseable pero el mecanismo concreto está por diseñar.
- **OPEN QUESTIONS:** (1) ¿Cómo se verifica que un SDK de crash reporting de
  terceros no hace red propia no declarada — auditoría de tráfico en
  laboratorio por release? (2) ¿El paquete de diagnóstico debe firmarse
  localmente para detectar manipulación en tránsito, y con qué clave sin
  crear un identificador correlacionable? (3) ¿Qué canal de contacto de
  seguridad es creíble antes de tener dominio/presencia pública?
