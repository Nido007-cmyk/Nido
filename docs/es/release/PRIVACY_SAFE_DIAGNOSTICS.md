> **Idioma:** [English](../../release/PRIVACY_SAFE_DIAGNOSTICS.md) · Español

# NIDO Privacy-Safe Diagnostics

**Estado:** diseño, NO implementar todavía.
**Principio:** observabilidad para **verificar, no asumir** — sin que el
diagnóstico se convierta en una puerta trasera, en telemetría silenciosa o en
una nueva fuente de información sensible (NIDO_PRINCIPLES.md §8: *auditability
sin crear una nueva fuga sensible*).

---

## 1. Sistema de logging estructurado

### 1.1 Prohibido: logs libres

No existen logs de texto libre con interpolación de valores arbitrarios. Todo
log es un **registro estructurado** con campos cerrados. La razón es simple:
un `log("decrypt failed for key " + key)` lo escribe alguien una vez a las
3am y el secreto vive en el log para siempre.

### 1.2 Forma del registro

```json
{
  "ts": 1790000000000,
  "event": "db.open",
  "component": "storage.sqlcipher",
  "build": "validation/1.0.0+42",
  "code": "SQLCIPHER_OK",
  "transition": "closed -> open_encrypted",
  "meta": { "cipher_version": "4.x", "page_size": 4096 }
}
```

Campos:

| Campo | Contenido permitido |
|---|---|
| `ts` | Timestamp ms epoch. Sin fechas humanas con zona horaria ambigua. |
| `event` | Enum cerrado (`db.open`, `keystore.get`, `bt.connect`, `policy.decide`, `model.load`, …). Nunca texto libre. |
| `component` | Enum cerrado del subsistema emisor. |
| `build` | Canal + versión + build number. Permite correlacionar sin identificar al usuario. |
| `code` | Código de error **sanitizado** de un catálogo cerrado (`SQLCIPHER_OK`, `KEYSTORE_UNAVAILABLE`, `BT_PEER_UNKNOWN`, …). Nunca mensajes de excepción crudos. |
| `transition` | Transición de estado `antes -> después`, de un conjunto cerrado por componente. |
| `meta` | Objeto con **claves allow-listed por evento**. Cualquier clave no listada se descarta en emisión, no en revisión. |

> **FROZEN PRINCIPLE.** El sanitizado ocurre **en el punto de emisión**: el
> componente que genera el log solo puede emitir claves allow-listed. Revisar
> logs "después" para quitar secretos es una estrategia perdedora — el secreto
> ya viajó, ya se persistió, ya se pudo exfiltrar.

### 1.3 Redacción automática (qué nunca sale del dispositivo en un log)

El emisor aplica redacción antes de construir el registro. Lista cerrada de
patrones redactados — si un valor coincide, se reemplaza por `[REDACTED:<clase>]`
y se registra el hecho de la redacción (no el valor):

- **tokens / keys / seeds:** claves privadas, seeds, session keys, API tokens,
  OAuth tokens, `Authorization:` headers. Patrón: longitud + entropía + contexto
  de nombre de campo (`*key*`, `*token*`, `*secret*`, `*seed*`, `*auth*`).
- **rutas sensibles:** rutas de archivos del usuario fuera de directorios de
  la app → se registra solo el nombre del directorio base de la app o
  `[REDACTED:path]`, nunca `/storage/emulated/0/...` completo con nombres
  personales.
- **datos personales:** nombres, emails, teléfonos, identificadores de
  contactos/calendario.
- **contenido de mensajes:** cuerpo de mensajes NIDO↔NIDO, texto de
  conversaciones, contenido de archivos. Se registra `message_id` (hash) y
  tamaño, nunca contenido.
- **URLs con secretos:** query strings y fragmentos se eliminan; se conserva
  `scheme://host/path` sin parámetros.
- **prompts y chain-of-thought:** el log registra *qué capability se invocó
  con qué policy decision*, nunca el prompt ni el razonamiento del modelo.

### 1.4 Almacenamiento local de logs

- Append-only, rotación por tamaño (p. ej. 5 MB) y por tiempo (p. ej. 7 días),
  cifrado en reposo con la misma llave de la DB (nunca en plaintext junto a
  una DB cifrada — eso sería teatro de seguridad).
- El usuario puede ver, exportar y **borrar** sus logs desde la app. Borrar
  es borrar: sin copias ocultas.
- En OFFLINE ONLY los logs nunca salen del dispositivo salvo exportación
  manual explícita.

---

## 2. Security diagnostics on-device

Pantalla / comando de diagnóstico que el usuario puede ejecutar para
**verificar** el estado de seguridad real del dispositivo. Cada ítem reporta
exactamente uno de: **PASS / FAIL / UNVERIFIED**. No hay "quizás", no hay
texto tranquilizador.

### 2.1 Ítems

| # | Check | PASS significa | FAIL significa |
|---|---|---|---|
| 1 | SQLCipher loaded | La librería nativa SQLCipher está cargada en este proceso | No cargada |
| 2 | cipher_version | `PRAGMA cipher_version` devuelve versión SQLCipher 4.x | Versión inesperada o ausente |
| 3 | Encrypted DB opened | La DB de la app se abrió con clave y `PRAGMA cipher_integrity_check` OK | No se pudo abrir cifrada |
| 4 | Plaintext DB rejected | Una copia de prueba en SQLite estándar **no** abre la DB real (verificación negativa activa) | La DB real se abre sin clave → FAIL crítico |
| 5 | Keystore available | Android Keystore accesible en este dispositivo | No accesible |
| 6 | Hardware-backed key | La clave está marcada `isInsideSecureHardware()=true` | Clave en software (degradado declarado, no silencioso) |
| 7 | StrongBox | StrongBox disponible y en uso cuando el dispositivo lo soporta | No disponible → UNVERIFIED si el hardware no lo soporta; FAIL si la política lo exige y no se usa |
| 8 | Biometric capability | Biométricos enrollados y gate funcional | No disponibles / gate no funcional |
| 9 | Backup configuration | `allowBackup=false` y reglas de backup verificadas post-prebuild | Backup permitido o reglas no verificadas |
| 10 | App build mode | Canal de build (DEVELOPMENT/VALIDATION/RELEASE) mostrado explícitamente | Desconocido |
| 11 | Network mode | Modo actual (OFFLINE ONLY / LOCAL-FIRST / ONLINE ENHANCED) y conexiones observadas en esta sesión | Modo declarado ≠ comportamiento observado |

### 2.2 Reglas duras

- **Nunca mostrar ni registrar:** claves, seed material, identidad privada en
  crudo, contenido de memoria, contenido de la DB en plaintext, hashes que
  puedan correlacionarse con identidad fuera del dispositivo.
- **UNVERIFIED ≠ PASS.** Un check que no pudo ejecutarse (p. ej. StrongBox en
  hardware que no lo soporta) se muestra como UNVERIFIED, nunca como PASS
  silencioso. La ausencia de evidencia no es evidencia de seguridad.
- **FAIL en VALIDATION BUILD = FAIL CLOSED.** Si el check 3 o 5 falla en un
  validation build, la app no arranca en "modo degradado": no arranca.
- **Los diagnostics no son telemetría.** Ejecutarlos no envía nada. El
  resultado vive en el dispositivo hasta que el usuario decida incluirlo en
  un reporte (ver BUG_REPORTING.md) — y aun entonces, solo como
  PASS/FAIL/UNVERIFIED por ítem, nunca con valores crudos.
- **Los diagnostics no son puerta trasera.** Ningún ítem expone material
  que permita a un lector del diagnóstico suplantar, descifrar o rastrear al
  usuario. Si un futuro ítem necesitara exponer algo sensible para ser útil,
  ese ítem no se añade: se rediseña.

### 2.3 Ejemplo de salida (forma, no valores reales)

```json
{
  "build": "validation/1.0.0+42",
  "network_mode_declared": "LOCAL-FIRST",
  "checks": [
    { "id": "sqlcipher.loaded", "status": "PASS" },
    { "id": "sqlcipher.cipher_version", "status": "PASS", "meta": { "version": "4.x" } },
    { "id": "db.encrypted_open", "status": "PASS" },
    { "id": "db.plaintext_rejected", "status": "PASS" },
    { "id": "keystore.available", "status": "PASS" },
    { "id": "keystore.hardware_backed", "status": "UNVERIFIED" },
    { "id": "strongbox.used", "status": "UNVERIFIED" },
    { "id": "biometric.gate", "status": "PASS" },
    { "id": "backup.config", "status": "PASS" },
    { "id": "build.mode", "status": "PASS", "meta": { "mode": "VALIDATION" } },
    { "id": "network.mode", "status": "PASS" }
  ]
}
```

Nótese: `meta` solo lleva datos no sensibles (versiones, modos). Jamás claves,
rutas, identificadores.

---

## 3. Clasificación de decisiones

- **FROZEN PRINCIPLES:** (a) sin logs de texto libre — solo registros
  estructurados con enums y claves allow-listed; (b) el sanitizado ocurre en
  emisión, no en revisión; (c) UNVERIFIED ≠ PASS; (d) diagnostics nunca
  exponen secretos ni salen del dispositivo sin aprobación explícita;
  (e) FAIL en validation build = fail closed.
- **PROVISIONAL:** los umbrales de rotación (5 MB / 7 días), el catálogo
  inicial de eventos y códigos, y la lista de 11 checks — punto de partida
  razonable, ajustable con experiencia.
- **EXPERIMENTAL:** la verificación negativa activa del check 4
  (intentar abrir la DB real con SQLite estándar como prueba) — potente pero
  debe diseñarse para no corromper ni bloquear la DB real.
- **OPEN QUESTIONS:** (1) ¿Cómo detectar "modo declarado ≠ comportamiento
  observado" en el check 11 sin convertir el detector en un sniffer
  permanente? (2) ¿Deben los logs estructurados firmarse localmente para
  detectar manipulación, y con qué clave? (3) ¿Qué granularidad de
  `disclosure_summary` es útil en auditoría sin convertirse en fuga por
  agregación?
