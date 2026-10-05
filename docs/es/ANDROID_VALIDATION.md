> **Idioma:** [English](../ANDROID_VALIDATION.md) · Español
# NIDO — Checklist de Validación Android (dos teléfonos nuevos, desde cero)

Para la primera corrida real en hardware. Un checkbox solo no vale nada:
cada PASS requiere la **evidencia** listada. Captura la evidencia en
`docs/evidence/<fecha>/` (screenshots, extractos de logcat, salidas de
comandos). Si falta la evidencia, el ítem NO está pasado.

Precondiciones: APK release o debug compilado desde un
`npx expo prebuild -p android --clean` limpio; ambos teléfonos con
restablecimiento de fábrica o nuevos; depuración USB habilitada; una
estación de trabajo con `adb`.

Nombre de paquete: `team.nido.app`. Nombres de DB: `nido_memory.db`
(memoryStore), `aoair_knowledge.db` (rag). Archivo marcador: `.sqlcipher`.

## 0. Compilación e instalación (ambos teléfonos)

- [ ] `PASS` → El APK instala: `adb install <apk>` sale 0 en ambos teléfonos.
  Evidencia: salida del comando guardada.
- [ ] `PASS` → La app arranca a la pantalla de setup/bloqueo **sin red**
  (modo avión ON desde el primer arranque).
  Evidencia: foto del ícono de modo avión + primera pantalla; anota la
  pantalla exacta mostrada.
- [ ] `PASS` → Módulo Kotlin empaquetado:
  `unzip -l app.apk | grep -i nidop2p` lista las clases `NidoP2PModule`/
  `NidoP2PManager`. Evidencia: salida del comando guardada. (Si ausente →
  prebuild ignoró el módulo: BLOQUEADOR.)
- [ ] `PASS` → Atributos del manifiesto:
  `aapt dump xmltree app.apk AndroidManifest.xml | grep -iE "allowBackup|dataExtractionRules"`
  muestra `allowBackup=false` y `dataExtractionRules="@xml/data_extraction_rules"`.
  Evidencia: salida del comando guardada.
- [ ] `PASS` → Permisos declarados:
  `aapt dump permissions app.apk` lista `BLUETOOTH`, `BLUETOOTH_CONNECT`,
  `BLUETOOTH_SCAN` (y `ACCESS_FINE_LOCATION`, `BLUETOOTH_ADMIN`).
  Evidencia: salida del comando guardada.

## 1. SQLCipher cargado

- [ ] `PASS` → La app abre sus bases de datos y funciona (el chat funciona)
  sin ningún error fail-closed de "SQLite sin SQLCipher".
  Evidencia: extracto de logcat mostrando arranque normal, sin mensaje
  fail-closed de `applyDatabaseKey`.
- [ ] `PASS` → `PRAGMA cipher_version` no vacío. Actualmente no hay hook en
  dispositivo que lo imprima, así que captúralo de UNA de estas formas y
  registra cuál: (a) compilación debug temporal logueando la cadena de
  versión desde `applyDatabaseKey`, (b) pantalla de diagnósticos in-app (si
  se añade después). Evidencia: la cadena de versión exacta, p. ej.
  `4.12.0 community`. Hasta que (a) o (b) exista, este ítem queda ABIERTO —
  las pruebas de extracción de archivo de abajo son la evidencia primaria
  de SQLCipher.

## 2. DB cifrada en reposo (la afirmación central de C-1)

Correr en un teléfono con datos en la app (envía primero unos mensajes,
con una cadena canaria conocida, p. ej. `CANARY-7f3a-nido`):

- [ ] `PASS` → La DB extraída NO abre con sqlite3 estándar:
  ```
  adb exec-out run-as team.nido.app cat files/nido_memory.db > /tmp/nido_memory.db
  sqlite3 /tmp/nido_memory.db "SELECT count(*) FROM sqlite_master;"
  ```
  Esperado: `Error: file is not a database`. Evidencia: salida completa
  guardada. (Encuentra primero la ruta real: `adb shell run-as
  team.nido.app ls -R files databases` — expo-sqlite pone las DBs bajo
  `files/SQLite/`; registra la ruta real usada.)
- [ ] `PASS` → Sin fixture en plaintext en los bytes de la DB:
  ```
  strings /tmp/nido_memory.db | grep -i "CANARY-7f3a-nido"
  ```
  Esperado: salida vacía. Evidencia: comando + resultado vacío guardados.
- [ ] `PASS` → Mismas dos verificaciones para `aoair_knowledge.db` (si
  existe).
- [ ] `PASS` → El archivo marcador `.sqlcipher` existe junto a la DB, y no
  quedan sidecars plaintext `-wal`/`-shm`/`-journal` de una DB
  pre-migración. Evidencia: salida de `ls` guardada.

## 3. Keystore / SecureStore

- [ ] `PASS` → Round-trip de DEK: desinstalar → reinstalar → flujo de
  restauración NO recupera silenciosamente datos viejos (esperado: DEK
  fresca, DB vieja ilegible — o la ruta de recuperación documentada;
  registra cuál ocurrió). Evidencia: observación escrita del
  comportamiento post-reinstalación.
- [ ] `PASS` → Sin DEK en archivos privados de la app:
  ```
  adb shell run-as team.nido.app grep -r -i "x'" files/ shared_prefs/ databases/ 2>/dev/null | head
  ```
  Esperado: sin material de clave de 64 hex chars. Evidencia: comando +
  salida guardados. (SecureStore guarda la clave en el Android Keystore;
  SharedPreferences debe mostrar a lo sumo blobs de ciphertext.)
- [ ] `PASS` → Clave no-exportable: documentado como suposición de defecto
  de plataforma (ver `docs/ANDROID_READINESS.md` §3). La prueba en
  dispositivo requiere un hook de debug intentando exportación vía
  `KeyStore.getEntry` — registrar como ABIERTO hasta entonces. NO marcar
  pasado por suposición sola.

## 4. Puerta biométrica

- [ ] `PASS` → La pantalla de bloqueo aparece en el primer arranque antes
  de que se muestre ningún dato. Evidencia: screenshot.
- [ ] `PASS` → Autenticación exitosa (huella/cara) desbloquea al chat.
  Evidencia: grabación de pantalla o notas con timestamp.
- [ ] `PASS` → Autenticación fallida (dedo equivocado ×3, o cancelar) NO
  desbloquea; se muestra error, sin bucle de reintento, sin bypass.
  Evidencia: grabación de pantalla / notas.
- [ ] `PASS` → Dispositivo sin biométricos enrolados: la puerta muestra la
  advertencia degradada (ruta `BiometricUnavailable`), nunca un bypass
  silencioso. Evidencia: screenshot de la advertencia (probar en al menos
  un teléfono con biométricos eliminados, o un dispositivo sin el sensor).
- [ ] `PASS` → El fallback de credencial de dispositivo (PIN/patrón)
  funciona donde el OS lo ofrece. Evidencia: notas.

## 5. Reglas de backup

- [ ] `PASS` (estático) → la verificación de manifiesto de §0 ya mostró
  `allowBackup=false` + `dataExtractionRules`. Referencia esa evidencia
  aquí.
- [ ] `PASS` (conductual) → `adb backup -f /tmp/nido.ab team.nido.app`: en
  Android 12+ esto está restringido y puede negarse — registra el resultado
  exacto. Si SE produce un archivo de backup, inspecciónalo:
  `dd if=/tmp/nido.ab bs=24 skip=1 | tar tvf - | grep -iE "\.db|shared_prefs"`
  Esperado: sin archivos DB, sin prefs de SecureStore. Evidencia: salida
  completa guardada. Si `adb backup` se niega directamente en los
  dispositivos de prueba, registra el mensaje de negación como evidencia y
  mantén la verificación estática de manifiesto como primaria.

## 6. Permisos Bluetooth y Kotlin nido-p2p

- [ ] `PASS` → Concesiones en runtime (Android 12+):
  `adb shell dumpsys package team.nido.app | grep -B1 -A1 "BLUETOOTH_CONNECT\|BLUETOOTH_SCAN"`
  muestra `granted=true` después de que el flujo de emparejamiento in-app
  los pida. Evidencia: extracto de dumpsys ANTES y DESPUÉS de conceder.
- [ ] `PASS` → `BLUETOOTH_SCAN` se concedió SIN ubicación: confirma que la
  bandera de manifiesto sobrevivió el prebuild:
  `aapt dump xmltree app.apk AndroidManifest.xml | grep -A2 BLUETOOTH_SCAN`
  muestra `usesPermissionFlags="neverForLocation"`. Evidencia: salida
  guardada.
- [ ] `PASS` → El módulo carga en runtime: inicia la pantalla P2P/
  emparejamiento; sin "module not found" / redbox. Evidencia: screenshot
  de la pantalla de emparejamiento en ambos teléfonos.
- [ ] `PASS` → Round-trip RFCOMM entre los dos teléfonos (ver
  `docs/DEMO_VERTICAL_PLAN.md` para el script completo): los frames fluyen
  en ambas direcciones. Evidencia: confirmación in-app en ambos teléfonos
  + extractos de logcat mostrando eventos `onConnected`/`onFrame`.

## 7. Ciclo de vida background/foreground

- [ ] `PASS` → Background 5s → foreground: la puerta de bloqueo re-pregunta
  antes de que el chat sea visible. Evidencia: grabación de pantalla.
- [ ] `PASS` → Tras backgrounding, no aparecen NUEVOS archivos plaintext
  en el almacenamiento de la app (diff de `ls -R` antes/después).
  Evidencia: salida del diff guardada.
- [ ] `PASS` → Force-stop → relanzar: la caché de timestamp biométrico
  desapareció (debe re-autenticar; la gracia de 5 minutos NO sobrevive la
  muerte del proceso). Evidencia: notas.

## 8. Auditoría de red (sanity, modo avión)

- [ ] `PASS` → 10 minutos de uso normal en modo avión (después de que los
  modelos estén presentes): sin crash, sin callejón sin salida de "waiting
  for network" en flujos centrales. Evidencia: notas + logcat filtrado
  por errores de red (vacío o explicado).

## Aprobación (sign-off)

C-1 se verifica en hardware solo cuando §1–§7 estén todos en PASS con
evidencia, O cuando cada ítem ABIERTO tenga un responsable nombrado y una
fecha. "Funcionó en mi teléfono" sin evidencia no cuenta.
