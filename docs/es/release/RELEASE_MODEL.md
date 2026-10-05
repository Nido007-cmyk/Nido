> **Idioma:** [English](../../release/RELEASE_MODEL.md) · Español

# NIDO Release Model — INTERNAL → ALPHA → BETA → STABLE

**Estado:** diseño, NO implementar todavía.
**Principio rector:** la meta no es esperar a que NIDO sea perfecto; es llevarlo
a un estado suficientemente sólido y seguro para aprender de usuarios reales
sin convertirlos en la frontera de seguridad.

---

## 1. Los cuatro canales

```
INTERNAL ──gate──▶ ALPHA ──gate──▶ BETA ──gate──▶ STABLE
   ▲                  │                 │               │
   │                  │                 │               └── hotfix (gate reducido)
   └── rollback / downgrade declarado (ver UPDATE_AND_ROLLBACK.md)
```

Cada canal es un **conjunto de garantías**, no un número de versión. Una build
puede llevar el mismo `versionCode` en dos canales y no ofrecer las mismas
garantías: lo que cambia es qué se verificó, en qué dispositivos, y qué se
permite hacer.

### 1.1 Definiciones

| Canal | Audiencia | Propósito |
|---|---|---|
| **INTERNAL** | El equipo/desarrollador y dispositivos de laboratorio propios | Iteración rápida; romper cosas es aceptable; datos de prueba, nunca datos reales del usuario |
| **ALPHA** | Un círculo pequeño de testers de confianza, invitados explícitamente | Validar flujos reales end-to-end con datos reales bajo supervisión; descubrir incompatibilidades de dispositivo |
| **BETA** | Usuarios voluntarios que aceptan riesgo conocido y documentado | Descubrir crashes, edge cases de Bluetooth, rendimiento, UI, compatibilidad de modelos, batería y workflows inesperados **a escala** |
| **STABLE** | Público general | El producto. Ningún riesgo conocido de las clases bloqueantes (§4 de BETA_SECURITY_GATE.md) |

> **FROZEN PRINCIPLE.** Una feature experimental puede existir en Beta **sin**
> convertirse automáticamente en Stable. La promoción entre canales es siempre
> una **decisión explícita** con su propio gate; nunca automática por tiempo,
> número de builds o "lleva X semanas sin quejas".

### 1.2 Distinción de builds: DEVELOPMENT / VALIDATION / RELEASE

Tres tipos de build con propósitos distintos. Confundirlos es una fuente
clásica de falsa confianza.

| | DEVELOPMENT | VALIDATION | RELEASE |
|---|---|---|---|
| Propósito | Iterar código | **Demostrar propiedades de seguridad** | Lo que usa el usuario |
| DB en claro | Permitido solo con backend inseguro explícito + advertencia visible (`__DEV__` plaintext fallback) | **PROHIBIDO. SQLCipher falla = FAIL CLOSED** | Prohibido |
| Keystore ausente | Puede degradar con aviso | **FAIL CLOSED** | Fail closed |
| Diagnostics | Verbosos | Solo PASS/FAIL/UNVERIFIED, sin secretos | Mínimos |
| Telemetría | Local | Ninguna | Solo opt-in explícito |

> **FROZEN PRINCIPLE.** El fallback `__DEV__` de base en plaintext **jamás**
> puede hacer que una prueba parezca segura cuando no lo es. Un VALIDATION
> BUILD que abre la DB sin SQLCipher o sin Keystore **falla cerrado** y lo
> reporta como FAIL, no como "modo degradado". Ningún resultado de seguridad
> obtenido en DEVELOPMENT BUILD cuenta como evidencia para un gate de canal.

---

## 2. Requisitos por canal

### 2.1 INTERNAL

- **Security requirements:** ninguno exigible; el código puede estar a medio
  escribir. *Prohibido* usar datos reales del usuario (conversaciones,
  calendario, contactos) en este canal.
- **Test requirements:** compila (`ANDROID COMPILED` como mínimo aspiracional);
  tests unitarios en verde si existen.
- **Device coverage:** 1 dispositivo del desarrollador.
- **Rollback strategy:** reinstalar; se acepta pérdida de datos de prueba.
- **Data migration requirements:** ninguna; la DB puede destruirse entre builds.
- **Known-risk policy:** todo riesgo es aceptable salvo que afecte a terceros
  (p. ej. enviar datos reales a un servidor por accidente).

### 2.2 ALPHA

- **Security requirements:** VALIDATION BUILD disponible; SQLCipher verificado
  cargado en el dispositivo (`cipher_version` reportado); Keystore disponible;
  biometric gate funcional; ningún secreto en logs.
- **Test requirements:** suite completa en verde (unit + conformance TS/Rust +
  differential); `nido release-check` (ver BETA_SECURITY_GATE.md) sin FAILs en
  las secciones BUILD/TESTS/CONFORMANCE.
- **Device coverage:** ≥2 dispositivos Android físicos distintos (distinto
  fabricante o versión de Android); NIDO↔NIDO por Bluetooth entre ellos al
  menos una vez.
- **Rollback strategy:** downgrade declarado posible o imposible, pero
  **documentado**; la identidad del usuario sobrevive al rollback.
- **Data migration requirements:** migraciones de DB probadas hacia adelante;
  hacia atrás solo si se declara soportado.
- **Known-risk policy:** riesgos conocidos se listan por escrito y cada tester
  los acepta explícitamente; ningún riesgo de las 8 clases bloqueantes.

### 2.3 BETA

- **Security requirements:** todos los de ALPHA **más**: security diagnostics
  on-device completos (ver PRIVACY_SAFE_DIAGNOSTICS.md) con cero FAIL en las
  8 clases bloqueantes; revisión red-team de la release (ver
  BETA_SECURITY_GATE.md §5); `security.txt` publicado y ruta de reporte
  activa.
- **Test requirements:** todo lo de ALPHA **más**: matriz de dispositivos
  (§2.4); pruebas de update desde la Stable anterior y desde la Beta
  anterior; pruebas de rollback declarado.
- **Device coverage:** matriz mínima: 3+ modelos Android (gama baja/media/alta,
  Android 12/13/14+), y cuando exista build iOS, 2+ iPhones. Bluetooth
  cruzado entre al menos 2 combinaciones distintas.
- **Rollback strategy:** probado en la matriz; si alguna migración es
  one-way, declarada en las notas de la release.
- **Data migration requirements:** migración automática probada desde las dos
  releases anteriores; backup cifrado antes de migrar; fallo de migración =
  no arrancar con datos a medias (fail closed), ofrecer restaurar.
- **Known-risk policy:** riesgos conocidos publicados en las notas de la
  Beta; el usuario los ve **antes** de instalar; ningún riesgo bloqueante
  puede estar en la lista (esos impiden la release, no se "documentan").

### 2.4 STABLE

- **Security requirements:** todos los de BETA **más**: cero issues abiertos
  de severidad crítica/alta (ver BETA_SECURITY_GATE.md); ventana mínima de
  2 semanas en BETA sin regresiones de seguridad; revisión de cambios de
  permisos/autoridad desde la Stable anterior (ninguna expansión silenciosa).
- **Test requirements:** `nido release-check` → `RELEASE CANDIDATE: YES`
  (determinista, sin opinión del modelo); checklist firmada por un humano.
- **Device coverage:** matriz completa incluyendo la gama baja más débil
  soportada; Android↔Android verificado; iPhone cuando exista.
- **Rollback strategy:** igual que BETA, con la exigencia adicional de que
  el rollback no rompa pairings existentes salvo declaración explícita.
- **Data migration requirements:** igual que BETA; además, la migración debe
  ser reanudable si se interrumpe (corte de energía a mitad de migración no
  deja la DB en estado indefinido).
- **Known-risk policy:** solo riesgos aceptables documentados (rendimiento,
  UI, compatibilidad menor). Ningún riesgo de seguridad conocido.

---

## 3. Gates de promoción (decisión explícita)

| Transición | Gate |
|---|---|
| INTERNAL → ALPHA | Checklist ALPHA completa; un humano la firma; build VALIDATION generado |
| ALPHA → BETA | `nido release-check` en verde salvo secciones marcadas "beta-tolerable"; red-team de la release; notas de riesgo escritas |
| BETA → STABLE | `RELEASE CANDIDATE: YES`; 0 críticas/altas; 2 semanas en BETA; revisión de autoridad (permisos/autonomía/divulgación/gasto/red) sin expansiones silenciosas |
| Cualquier → hotfix | Gate reducido documentado: solo el fix + regresión mínima + las 8 clases bloqueantes re-verificadas; el hotfix no puede aprovechar para colar features |

> **FROZEN PRINCIPLE.** Ningún gate puede pasarse por "el modelo dice que está
> bien". Cada gate lo firma un humano o lo verifica un check determinista.

---

## 4. Clasificación de decisiones

- **FROZEN PRINCIPLES:** (a) la promoción entre canales es siempre explícita,
  nunca automática; (b) el fallback `__DEV__` en plaintext jamás cuenta como
  evidencia de seguridad; (c) VALIDATION BUILD falla cerrado sin SQLCipher ni
  Keystore; (d) ningún gate se pasa por opinión del modelo.
- **PROVISIONAL:** los umbrales concretos de device coverage (números de
  dispositivos, versiones de Android) y la ventana de 2 semanas en BETA —
  razonables hoy, revisables con datos reales.
- **EXPERIMENTAL:** el formato exacto de `nido release-check` como comando
  ejecutable (hoy es un checklist conceptual; ver BETA_SECURITY_GATE.md §4).
- **OPEN QUESTIONS:** (1) ¿Quién firma los gates cuando haya más de una
  persona — firma individual, quorum, o rol? (2) ¿Cómo se versionan y
  distribuyen los VALIDATION BUILDs sin convertirlos en un canal paralelo
  confuso? (3) ¿Qué evidencia de "2 semanas en BETA" cuenta si la base de
  testers es pequeña — tiempo calendario o número de sesiones activas?

---

## 5. Lo que este modelo NO hace

- No sustituye el primer APK: **ANDROID COMPILED sigue siendo el objetivo
  inmediato**. Este documento prepara la arquitectura para cuando haya
  usuarios, no retrasa el build.
- No define el backend de reporting (ver BUG_REPORTING.md — diseño, no
  implementación).
- No convierte métricas (número de bugs, crashes) en criterio de promoción:
  la clasificación es por **impacto** (ver BETA_SECURITY_GATE.md).
