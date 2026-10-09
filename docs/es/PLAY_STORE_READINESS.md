> **Idioma:** [English](../PLAY_STORE_READINESS.md) · Español

# Lista de preparación para Play Store — NIDO

**Estado:** PREPARACIÓN (no enviado)
**Última revisión:** 2026-10-09
**Target SDK al momento de la revisión:** 36 (cumple el requisito de Play)

Este documento registra todo lo necesario antes de poder enviar NIDO a
Google Play. Nada aquí cambia la arquitectura del app — es una lista de
preparación para el envío.

## Veredicto de la última revisión

Sin bloqueos estructurales. La arquitectura de privacidad de NIDO (cero
recolección de datos, sin analytics, sin anuncios, sin rastreo) es una
ventaja fuerte para la revisión de Play. Los puntos abajo son trabajo de
preparación, no rediseños.

## Lista pre-envío

### 1. Declaración de alarma exacta (RIESGO: rechazo en revisión)

- **Permiso:** `SCHEDULE_EXACT_ALARM` (vía `modules/exact-alarm`)
- **Uso:** recordatorios creados por el usuario que deben sonar a una hora
  precisa.
- **Política de Play:** las alarmas exactas están restringidas a apps donde
  la precisión es funcionalidad central visible (despertadores,
  calendarios, temporizadores). Los recordatorios plausiblemente califican,
  pero Play exige declaración formal en Play Console y los revisores pueden
  discrepar.
- **Acción:** preparar el texto de la declaración desde ahora (ver §
  Justificaciones). Si se rechaza, el plan B es alarmas inexactas con
  `WorkManager` (menos precisas, sin riesgo de política).

### 2. SYSTEM_ALERT_WINDOW — rastrear o eliminar (RIESGO: revisión extra)

- **Hallazgo (2026-10-09):** `SYSTEM_ALERT_WINDOW` aparece en el
  `android/app/src/main/AndroidManifest.xml` generado, pero no se pudo
  rastrear su origen en `app.json`, `plugins/` ni manifests de
  `node_modules`.
- **Política de Play:** "dibujar sobre otras apps" es un permiso altamente
  sensible que dispara revisión adicional y requiere divulgación prominente
  dentro del app.
- **Acción:** rastrear el origen (probablemente un default de un plugin de
  Expo o del manifest merger). Si no se usa, eliminarlo antes del envío. NO
  enviar con un permiso sensible sin explicar.

### 3. Justificación del permiso de ubicación

- **Permiso:** `ACCESS_FINE_LOCATION`
- **Uso:** requerido para descubrimiento Bluetooth clásico en API < 31. En
  API 31+ el app usa `BLUETOOTH_SCAN` con `neverForLocation`.
- **Política de Play:** el acceso a ubicación se escruta fuertemente; la
  sección Data Safety debe explicarlo con precisión.
- **Acción:** documentar la división por nivel de API en las respuestas de
  Data Safety y en la ficha. Considerar eliminar el descubrimiento clásico
  (API < 31) si el minSdk lo permite, lo que quitaría la necesidad de
  ubicación por completo.

### 4. Política de privacidad (OBLIGATORIA)

- **Política de Play:** todo app que maneje datos personales debe enlazar
  una política de privacidad en Play Console y en el app.
- **Estado:** no existe todavía.
- **Acción:** redactar y hospedar una política de privacidad. La historia de
  NIDO es simple y fuerte: todos los datos quedan en el dispositivo,
  cifrados; sin cuentas; sin servidores; sin analytics; el único uso de red
  es la descarga única del modelo. La política debe decir exactamente eso,
  en lenguaje claro.

### 5. Sección Data Safety (OBLIGATORIA)

- **Política de Play:** debe completarse en Play Console antes del
  lanzamiento.
- **Respuestas borrador (verificar al momento del envío):**
  - Datos recolectados: **ninguno** (ningún dato sale del dispositivo).
  - Datos compartidos con terceros: **ninguno**.
  - La descarga única del modelo (~1 GB) contacta un host de archivos; no
    se transmite ningún dato personal. Declarar la descarga claramente.
  - Cifrado en tránsito: N/A (no se transmite datos del app). Datos en
    reposo: SQLCipher + Android Keystore.
- **Acción:** completar el cuestionario en Play Console; mantener estas
  respuestas como fuente de verdad.

### 6. Divulgación de la descarga del modelo en primer uso

- **Estado:** el primer arranque descarga ~1 GB (LLM + modelo de embeddings)
  antes de que el app sea utilizable.
- **Política de Play:** las descargas grandes están permitidas pero deben
  declararse; el app debe manejar conexiones medidas con cuidado (ya avisa).
- **Acción:** mencionar el tamaño de la descarga en la descripción de la
  ficha. Opción a largo plazo: Play Asset Delivery.

### 7. Recursos de la ficha (ESTÁNDAR)

- Ícono (512×512), gráfico destacado (1024×500), capturas (teléfono +
  tablet 7" y 10"), descripción corta y completa, cuestionario de
  clasificación de contenido, categoría, email de contacto.
- **Acción:** producir cuando se decida el envío. Las capturas deben mostrar
  el app real, no mockups.

## Justificación de permisos (para declaraciones en Play Console)

| Permiso | Uso | Justificación |
|---|---|---|
| `BLUETOOTH`, `BLUETOOTH_ADMIN`, `BLUETOOTH_CONNECT` | Mensajería P2P Nido-a-Nido | Función central: chat cifrado teléfono a teléfono |
| `BLUETOOTH_SCAN` (neverForLocation) | Descubrir dispositivos pareados cercanos | Función central; explícitamente no usado para ubicación |
| `ACCESS_FINE_LOCATION` | Descubrimiento BT clásico en API < 31 | Requisito de API legacy; ver punto 3 |
| `RECORD_AUDIO` | Entrada de voz (STT en dispositivo) | Mensajes de voz iniciados por el usuario |
| `READ_CONTACTS` / `WRITE_CONTACTS` | Pareo de contactos P2P | Solo pareo iniciado por el usuario |
| `READ_CALENDAR` / `WRITE_CALENDAR` | Integración de recordatorios | Recordatorios creados por el usuario |
| `POST_NOTIFICATIONS` | Alertas de recordatorios y mensajes P2P | Alertas de función central (Android 13+) |
| `SCHEDULE_EXACT_ALARM` | Recordatorios precisos | Ver punto 1 |
| `USE_BIOMETRIC` / `USE_FINGERPRINT` | Bloqueo del app | Seguridad activada por el usuario |
| `FOREGROUND_SERVICE` + tipo `connectedDevice` | Servicio de conexión P2P | El tipo declarado coincide con el uso |
| `INTERNET` | Descarga única del modelo | Sin otro uso de red (ver auditoría de red) |
| `VIBRATE` | Háptica de notificaciones | Estándar |
| `SYSTEM_ALERT_WINDOW` | **Desconocido — rastrear o eliminar** | Ver punto 2 |

## Notas

- El `src/privacy/networkAudit.ts` del app (toda conexión registrada y
  visible en Ajustes) es evidencia fuerte para la revisión si surgen
  preguntas sobre comportamiento de red.
- No enviar mientras la validación física en dos dispositivos siga
  pendiente — la revisión de Play no sustituye el device gate.
- Re-ejecutar esta lista antes del envío; las políticas de Play cambian.
