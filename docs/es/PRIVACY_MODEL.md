> **Idioma:** [English](../PRIVACY_MODEL.md) · Español

# PRIVACY_MODEL.md — NIDO

**Fecha:** 27 de septiembre de 2026. **Principio rector:** el dispositivo del usuario es
el único lugar donde existen sus datos. No hay cuenta, no hay servidor, no hay nube.

## 1. Qué datos existen y dónde viven

| Dato | Dónde | Sale del dispositivo |
|---|---|---|
| Mensajes (inbox/outbox) | SQLite local | **No** — solo por Bluetooth al contacto emparejado, cifrados |
| Contactos P2P | SQLite local | **No** |
| Memoria del agente (memorias, notas, resúmenes) | SQLite local | **No** |
| Claves de identidad/firma | SecureStore (Keystore) | **No** (nunca; solo la pública viaja en el QR físico) |
| Modelos de IA (LLM, STT, TTS) | Almacenamiento local (bundled) | **No** |
| Crash reports | Local, opt-in | **No** (exportación manual del usuario) |
| Telemetría / analytics | — | **No existe** |

**No hay:** registro de usuarios, login, número de teléfono, email, publicidad, trackers,
SDKs de analytics, ni endpoints de red propios. La app no abre sockets de Internet para
ninguna de sus funciones declaradas (ver §4 sobre el modelo de red del OS).

## 2. Modelo de red

- **Funciones core (mensajería, memoria, voz, herramientas):** cero red por diseño.
  El único canal de comunicación es Bluetooth RFCOMM con dispositivos emparejados por QR.
- **Lo que el OS puede hacer por su cuenta** (fuera de nuestro control, documentado
  honestamente): checks de conectividad de Android, NTP, Play Services. NIDO no los
  provoca ni los necesita; el modo avión + Bluetooth es una prueba oficial de que la app
  funciona sin ellos.
- **Regla:** ninguna feature futura puede introducir una llamada de red silenciosa.
  Si una feature necesitara red algún día, sería opt-in explícito, con explicación en
  lenguaje humano y sin degradar el modo offline.

## 3. Metadatos: qué se expone y a quién

| Metadato | Quién lo ve | Mitigación |
|---|---|---|
| MAC Bluetooth (estable) | Cualquier radio cercana durante discovery/conexión | M-5: nombre genérico rotatorio, discovery explícito y breve; la MAC nunca es identidad |
| Nombre del dispositivo | Igual que arriba | M-5 |
| Momento/duración de conexiones | Observador radio cercano | Sin mitigación total posible en radio clásica; el contenido va cifrado |
| Grafo social (quién habla con quién) | Nadie remoto (no hay servidor que lo agregue) | Local-first: el grafo solo existe en el teléfono |
| Patrones de uso (cuándo abre la app) | Solo el propio dispositivo | Sin telemetría que los exporte |

**No prometemos anonimato** (ver §7). La privacidad de NIDO es *confidencialidad local +
ausencia de terceros*, no anonimato frente a un observador radio.

## 4. Consentimiento y confirmación humana

La app **nunca** actúa hacia fuera sin confirmación explícita del usuario:

- Llamadas, SMS, mensajes a contactos externos, eventos de calendario.
- Compartir, exportar o borrar información.
- Cambiar identidad o claves (rotación).
- Emparejar un contacto nuevo (el QR se escanea y la huella se verifica en persona).
- Exportar crash reports o cualquier dato.

El texto de cada confirmación está en lenguaje humano (qué se va a hacer, con quién,
qué riesgo tiene), no en jerga técnica.

## 5. Superficies de fuga involuntaria (estado y plan)

| Superficie | Estado hoy | Plan |
|---|---|---|
| Notificaciones | **Auditar:** verificar que no muestran texto del mensaje | M-1: texto genérico "Nuevo mensaje de NIDO" |
| Clipboard | **Auditar:** no auto-copiar secretos | M-1: `EXTRA_IS_SENSITIVE` (API 33+), limpieza tras timeout |
| Screenshots / switcher | Sin protección | M-1: `FLAG_SECURE` en pantallas sensibles (QR, inbox, mensajes) |
| Backups en la nube | `allowBackup=false` | H-3: `dataExtractionRules` (bloquea también device-transfer en 12+) |
| Logs de la app | Sin PII por diseño en el código P2P (los errores no incluyen contenido) | M-3: sanitización antes de persistir crash reports |
| Miniaturas en "recientes" | Sin protección | M-1 (FLAG_SECURE las cubre) |
| Teclado de terceros | Fuera de control de la app | Documentar: recomendar teclado del sistema; los campos sensibles usan input seguro |

## 6. Borrado y retención

- **Borrado de mensajes:** borrado lógico + `VACUUM` periódico; el borrado físico en
  flash con wear-leveling no se puede garantizar — se documenta, no se promete.
- **Revocación de identidad:** `deleteIdentity()` elimina las semillas de SecureStore.
- **Sin retención remota:** al no haber servidor, "borrar" significa borrar en el
  dispositivo. Los mensajes ya entregados al peer no se pueden borrar a distancia
  (sin protocolo de borrado remoto; documentado como límite).
- **Retención por defecto:** los mensajes se conservan hasta que el usuario los borre.
  No hay política de auto-borrado todavía (candidata a setting futuro, opt-in).

## 7. Lo que NO prometemos (límites honestos)

- **No "anonimato":** el Bluetooth clásico expone una MAC estable a observadores radio
  cercanos. NIDO no anonimiza la capa radio.
- **No "imposible de hackear":** un dispositivo rooteado o con malware con privilegios
  derrota las defensas de app (T-04). Lo documentamos en lugar de prometer lo imposible.
- **No "quantum-proof":** el riesgo harvest-now-decrypt-later existe en teoría y está
  aceptado hasta que X-1 cumpla sus criterios (ver CRYPTO_ARCHITECTURE.md §9 y
  SECURITY_ROADMAP.md X-1).
- **No "cifrado biométrico"** (todavía): el prompt biométrico actual es gate UX; la
  garantía criptográfica requiere el módulo nativo futuro (H-6).
- **Los tests no son una auditoría.** 423 tests verdes ≠ revisión criptográfica externa.

## 8. Privacidad de los modelos de IA locales

- Los modelos (LLM, whisper STT, Piper TTS) se distribuyen con la app o se descargan
  una vez de una URL inmutable con **SHA-256 pinneado y verificado antes de cargar**.
- La inferencia ocurre en el dispositivo; ningún audio, texto ni embedding sale.
- **Sin promesas sin evidencia:** no se declara "STT 100% offline" hasta probarlo en modo
  avión con captura de tráfico (P7); `EXTRA_PREFER_OFFLINE` es una preferencia, no una
  garantía.

## 9. Compromisos verificables

1. Cero llamadas de red iniciadas por la app (verificable con captura de tráfico en
   modo avión + Bluetooth, P7).
2. Cero telemetría, cero analytics, cero crash reporting automático.
3. Todo dato sensible en reposo, cifrado (C-1) con claves en hardware (C-2).
4. Ninguna acción externa sin confirmación humana (§4).
5. Documentos de seguridad públicos en el repo y actualizados con cada cambio.

**Métrica:** la privacidad se mide por *datos que es técnicamente imposible que salgan*,
no por promesas. Cada compromiso de esta lista debe tener un test o una prueba física
que lo respalde.
