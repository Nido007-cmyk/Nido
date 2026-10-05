> **Idioma:** [English](../../release/BETA_SECURITY_GATE.md) · Español

# NIDO Beta Security Gate

**Estado:** diseño, NO implementar todavía.
**Principio:** una beta puede descubrir bugs. Nunca puede descubrir
fallos básicos de seguridad. Esos **bloquean la release**.

---

## 1. Clasificación por impacto (no por número de bugs)

Cuatro clases. La pregunta no es "¿cuántos bugs hay?" sino "¿qué puede
romper este bug?".

### 1.1 MUST FIX BEFORE ALPHA

Cualquier fallo en las 8 clases bloqueantes (§2) detectado en INTERNAL.
Nada con datos reales del usuario sale del laboratorio con una de estas
abierta. Además: secretos en logs, DB que abre sin clave, Keystore no
exigido en validation build.

### 1.2 MUST FIX BEFORE BETA

Todo lo de ALPHA, más: cualquier bypass conocido del consentimiento
(`ASK_USER` que no pregunta), cualquier divulgación por encima del
`minimum_disclosure` declarado, cualquier crash que corrompa DB/memoria/
identidad de forma irreversible, cualquier migración no probada en las dos
direcciones declaradas.

### 1.3 MUST FIX BEFORE STABLE

Todo lo de BETA, más: cero issues abiertas de severidad crítica/alta;
ventana mínima en BETA (provisional: 2 semanas) sin regresiones de
seguridad; revisión completa del diff de autoridad desde la Stable anterior
(permisos, autonomía, divulgación, gasto, red) sin expansiones silenciosas.

### 1.4 ACCEPTABLE BETA BUG

Lo que los usuarios **sí** pueden ayudarnos a descubrir:

- crashes (que no corrompan datos — ver §2)
- device compatibility (modelos, versiones de Android, skins de fabricante)
- Bluetooth edge cases (reconexiones, interferencia, stacks BT raros)
- performance problems (jank, memoria, tiempos de carga de modelo)
- UI problems (layouts, textos, accesibilidad)
- model compatibility (un GGUF que no carga en cierto SoC)
- battery issues (drenaje en background, wakelocks)
- unexpected workflows (el usuario hace algo que el diseño no previó)

> **FROZEN PRINCIPLE.** La línea entre "acceptable beta bug" y "bloqueante"
> la define el **impacto**, y ante duda se clasifica hacia arriba. Un crash
> que *además* deja la DB a medio escribir no es "un crash": es pérdida
> potencial de datos → bloqueante.

---

## 2. Las 8 clases que BLOQUEAN release

Estas **nunca** deben descubrirse vía usuarios. Si aparecen en ALPHA/BETA,
la release se detiene.

1. **Pérdida silenciosa de datos** — datos que desaparecen sin error
   visible ni forma de recuperación (mensajes, memoria, DB corrupta que se
   "autorrepara" borrando).
2. **Plaintext de información privada** — información del usuario en claro
   donde debería estar cifrada: DB sin SQLCipher, logs con contenido,
   backups sin cifrar, exports accidentales.
3. **Filtración de claves** — claves privadas, seeds, session keys o
   material de identidad que sale del dispositivo o queda en logs, dumps,
   backups o reportes.
4. **Bypass de Policy Engine** — cualquier camino que ejecute una capability
   sin pasar por la evaluación de política: contenido remoto → modelo →
   tool, flags que pre-autorizan, versiones que heredan aprobaciones.
5. **Ejecución no autorizada** — una tool/capability que corre sin el
   consentimiento requerido (`ASK_USER`/`human_approval: always` saltado).
6. **Pagos no autorizados** — (futura capa económica) cualquier movimiento
   de valor sin autorización explícita; hoy: cualquier expansión silenciosa
   de autoridad de gasto en el diseño.
7. **Corrupción irreversible de identidad** — pérdida o corruptela de la
   identidad NIDO sin camino de recuperación declarado y probado.
8. **Downgrade criptográfico silencioso** — negociar o aceptar una suite
   más débil sin que el usuario lo sepa y lo apruebe; rollback que restaura
   crypto retirada.

Cada clase tiene que tener al menos un **test o check determinista** que la
cubra antes de cada gate (vectores de conformance, checks de validation
build, revisión de diff de autoridad). "Lo revisamos a ojo" no es cobertura.

---

## 3. Device matrix

NIDO debe probarse eventualmente en:

- **Android** (primero: es la plataforma inicial)
- **iPhone** (después)
- y en pares: **Android ↔ Android**, **iPhone ↔ iPhone**, **Android ↔ iPhone**

> **FROZEN PRINCIPLE.** Transport ≠ Protocol. El protocolo NIDO **nunca**
> depende de una API exclusiva de una plataforma. Si una feature solo
> funciona con una API de Android (o de iOS), es una feature de plataforma,
> no del protocolo, y se diseña como tal — con fallback declarado o
> indisponibilidad explícita, nunca como dependencia silenciosa del
> protocolo.

Cobertura mínima por canal (provisional, ver RELEASE_MODEL.md §2):
ALPHA ≥2 Android físicos distintos con NIDO↔NIDO por Bluetooth; BETA matriz
de 3+ modelos Android (gama baja/media/alta) + iPhones cuando existan;
STABLE matriz completa incluyendo la gama baja más débil soportada.

---

## 4. RELEASE GATE: `nido release-check` (conceptual)

Un checklist **determinista**. Cada línea la verifica un script/test o un
humano con evidencia — **nunca la opinión del modelo**.

```
BUILD:        PASS   # el artefacto se construyó del source declarado, firma válida
TESTS:        PASS   # suite completa en verde (unit + integración existentes)
CONFORMANCE:  PASS   # vectores oficiales + differential TS/Rust en verde
MIGRATIONS:   PASS   # migraciones probadas en las direcciones declaradas + rollback declarado
SECURITY:      PASS   # 0 fallos en las 8 clases bloqueantes; red-team de la release hecho
PRIVACY:       PASS   # revisión de minimum disclosure; sin PII en logs/diagnósticos de la build
ANDROID:       PASS   # matriz Android del canal, en dispositivos físicos
IOS:           PASS   # matriz iOS del canal, o N/A declarado con justificación
KNOWN CRITICALS: 0
KNOWN HIGHS:     0

RELEASE CANDIDATE: YES / NO
```

Qué evidencia exige cada check:

| Check | Evidencia |
|---|---|
| BUILD | log de build reproducible, hash del artefacto, firma verificada |
| TESTS | reporte de la suite con 0 fallos (no "casi verde") |
| CONFORMANCE | `passed=N failed=0` del harness + differential-results archivados |
| MIGRATIONS | prueba automatizada de migración desde las 2 releases anteriores + prueba del rollback declarado |
| SECURITY | checklist de las 8 clases con su test/evidencia cada una + notas del red-team |
| PRIVACY | barrido automatizado de logs/diagnósticos contra la lista de redacción + revisión humana de nuevos campos de log |
| ANDROID / IOS | resultados por dispositivo de la matriz (modelo, OS, PASS/FAIL por área) |
| KNOWN CRITICALS/HIGHS | conteo desde el tracker de issues con severidad por impacto (§1) |

`RELEASE CANDIDATE: YES` exige **todo** en PASS y ceros en críticas/altas.
Un solo FAIL → NO, sin ponderaciones ni "es solo un warning".

> **FROZEN PRINCIPLE.** Ningún PASS depende de la opinión del modelo. El
> modelo puede *ayudar a generar* la evidencia; la evidencia la verifica
> código determinista o un humano.

---

## 5. RELEASE RED-TEAM

Para cada amenaza: **THREAT → EXPLOIT → MITIGATION → FUTURE TEST**.
El red-team se ejecuta por release (BETA en adelante) y sus hallazgos
alimentan las 8 clases bloqueantes.

### RT-1 · Logs que filtran secretos

- **THREAT.** Un log estructurado o un stack trace incluye una clave,
  token, seed o contenido privado.
- **EXPLOIT.** Un crash en `keystore.get` vuelca la excepción cruda con el
  alias y material de la clave; el reporte "Report a Problem" lo adjunta; el
  secreto viaja al backend y vive en backups.
- **MITIGATION.** Sanitizado en emisión (PRIVACY_SAFE_DIAGNOSTICS.md §1):
  solo enums y claves allow-listed; redacción automática de
  `*key*/*token*/*secret*/*seed*/*auth*`; stack traces sin valores de
  variables; barrido automatizado pre-release contra la lista de redacción.
- **FUTURE TEST.** Test que inyecta valores canario con forma de secreto en
  cada punto de log y verifica que el output contiene `[REDACTED:*]` y nunca
  el valor.

### RT-2 · Crash reports que filtran conversaciones

- **THREAT.** El heap o el estado de la UI en el momento del crash contiene
  texto de conversaciones, memoria o contenido de mensajes.
- **EXPLOIT.** Crash durante el render del chat: el reporte incluye
  screenshot automático o dump de estado con los últimos mensajes; el
  usuario lo envía sin mirar (o con "mirar" que no muestra el adjunto
  binario).
- **MITIGATION.** Los crash reports nunca incluyen screenshots ni dumps de
  estado por defecto; el usuario inspecciona el paquete completo antes de
  enviar (BUG_REPORTING.md §1); el contenido de mensajes está en la lista
  de exclusión cerrada.
- **FUTURE TEST.** Fuzzing de crashes en pantallas con datos sensibles:
  generar N crashes y verificar automáticamente que ningún reporte contiene
  strings del fixture de datos privados.

### RT-3 · Updates que amplían autoridad

- **THREAT.** Una actualización convierte `ASK → AUTO`, añade una capability
  con `human_approval` relajado, o pide un permiso nuevo del SO sin
  presentarlo como decisión.
- **EXPLOIT.** La release 1.5 cambia `location.request/v1` de
  `human_approval: always` a `conditional` "por UX"; los peers con regla
  antigua obtienen ubicación sin que el usuario re-consienta.
- **MITIGATION.** Regla de update (UPDATE_AND_ROLLBACK.md §1.1): el conjunto
  permitido post-update debe ser subconjunto del anterior salvo
  consentimiento explícito; diff de capabilities/permisos presentado al
  usuario antes de instalar; capability nueva = DENY.
- **FUTURE TEST.** Test de "diff de autoridad": comparar el conjunto
  efectivo `(capability, peer, decisión)` entre releases; cualquier
  ampliación sin flag de consentimiento explícito = FAIL del gate.

### RT-4 · Rollback que rompe crypto

- **THREAT.** Volver a una versión anterior restaura una suite
  criptográfica retirada por insegura, o invalida pairings/identidad.
- **EXPLOIT.** Tras el anuncio de debilidad en `nido-crypto/1`, un usuario
  hace rollback a 1.2 que solo habla `nido-crypto/1`; sus sesiones vuelven a
  ser vulnerables sin advertencia.
- **MITIGATION.** El rollback nunca restaura crypto retirada
  (UPDATE_AND_ROLLBACK.md §3.2): se bloquea con explicación; migraciones
  one-way declaradas antes de actualizar; identidad y pairings en almacén
  versionado independiente.
- **FUTURE TEST.** Matriz de rollback: por cada par (versión_nueva,
  versión_vieja) verificar que el downgrade cripto se bloquea y que la
  identidad sobrevive.

### RT-5 · Feature flags que evaden policy

- **THREAT.** Un flag (local corrupto o remoto malicioso) pre-autoriza lo
  que la política denegaría, o convierte `DENY → ASK`.
- **EXPLOIT.** Un manifiesto de flags manipulado en disco pone
  `policy.strict_mode: off`; el Policy Engine lo lee antes de evaluar y
  relaja decisiones.
- **MITIGATION.** Los flags se evalúan **después** del Policy Engine y solo
  pueden reducir (UPDATE_AND_ROLLBACK.md §2.2); flags remotos = UNTRUSTED,
  solo-apagan; el estado de flags es visible al usuario.
- **FUTURE TEST.** Test de orden de evaluación: con flags adversariales
  (todos "on/permissive"), verificar que las decisiones de política no
  cambian respecto a flags ausentes.

### RT-6 · Diagnostics que se convierten en telemetría

- **THREAT.** Los security diagnostics, diseñados como locales, empiezan a
  enviarse "para mejorar el producto" sin consentimiento nuevo.
- **EXPLOIT.** La 1.6 añade "enviar diagnósticos automáticamente en
  ONLINE ENHANCED" con el consentimiento viejo de crash reporting; los
  PASS/FAIL por ítem permiten fingerprinting de dispositivos y
  correlación de usuarios.
- **MITIGATION.** Ejecutar diagnostics nunca envía nada
  (PRIVACY_SAFE_DIAGNOSTICS.md §2.2); cualquier envío es un acto separado
  con su propio consentimiento informado; IDs de reporte no
  correlacionables con identidad.
- **FUTURE TEST.** Auditoría de red por release en laboratorio: ejecutar
  todos los diagnostics con el modo en cada valor y verificar cero paquetes
  hacia fuera; test de que habilitar crash reporting no habilita envío de
  diagnostics.

### RT-7 · Atacante que falsifica reports

- **THREAT.** Un tercero envía reportes falsos ("soy el usuario X, mi app
  hace Y") para contaminar el triage, extraer información del proceso de
  respuesta, o hacer doxxing por "contáctame".
- **EXPLOIT.** Spam masivo de "security issues" falsas para enterrar un
  reporte real; o un reporte con descripción que contiene un payload de
  prompt injection contra el sistema de triage (si el triage usa un modelo).
- **MITIGATION.** Ruta de seguridad separada con acuse pero sin
  auto-confianza; el triage nunca ejecuta instrucciones contenidas en un
  reporte (los reportes son UNTRUSTED DATA, como cualquier contenido
  externo); rate limiting por origen; sin correlación automática con
  identidad.
- **FUTURE TEST.** Ejercicio de triage adversarial por release: N reportes
  falsos + 1 real; medir que el real se identifica y que ningún payload en
  reportes se ejecuta.

### RT-8 · Usuario malicioso que abusa del backend de reporting

- **THREAT.** Uso del backend de reportes como canal de exfiltración,
  almacenamiento gratuito, o ataque (subir contenido ilegal como
  "adjunto", DoS por volumen).
- **EXPLOIT.** Adjuntos opt-in usados para subir gigabytes; el campo de
  descripción libre usado para acosar al equipo; reportes automatizados
  como botnet de baja intensidad.
- **MITIGATION.** Límites de tamaño/número por adjunto y por origen;
  moderación del canal; los adjuntos se conservan con TTL y borrado
  efectivo; el backend nunca ejecuta ni renderiza adjuntos como código;
  la descripción libre se muestra como texto citado, nunca interpretado.
- **FUTURE TEST.** Pruebas de abuso por release: subida de archivos
  gigantes/malformados, volumen anómalo desde un origen, contenido
  malicioso en descripción — verificar límites, rechazo y que nada se
  ejecuta.

---

## 6. Clasificación de decisiones

- **FROZEN PRINCIPLES:** (a) clasificación por impacto, no por conteo;
  ante duda se clasifica hacia arriba; (b) las 8 clases bloqueantes nunca se
  descubren vía usuarios; (c) Transport ≠ Protocol — ninguna dependencia de
  API exclusiva de plataforma en el protocolo; (d) `release-check` es
  determinista: ningún PASS por opinión del modelo; (e) un solo FAIL →
  `RELEASE CANDIDATE: NO`.
- **PROVISIONAL:** la ventana de 2 semanas en BETA, los números de la device
  matrix, el SLA de acuse de 48h (en BUG_REPORTING.md).
- **EXPERIMENTAL:** el `nido release-check` como comando ejecutable real;
  el test canario de secretos en logs (RT-1); el test de diff de autoridad
  (RT-3).
- **OPEN QUESTIONS:** (1) ¿Cómo se mide "2 semanas en BETA" con pocos
  testers — tiempo calendario o sesiones activas? (2) ¿Quién opera el
  red-team por release cuando el equipo es de una persona — checklist
  auto-aplicado, pares externos, o ambos? (3) ¿A partir de qué tamaño de
  base instalada un "acceptable beta bug" de Bluetooth se reclasifica como
  bloqueante por impacto agregado?

---

## 7. Principio final

**SHIP EARLY ENOUGH TO LEARN. NOT EARLY ENOUGH TO BET USER SECURITY ON LUCK.**

Users can help us find bugs. They should not be our security boundary.
