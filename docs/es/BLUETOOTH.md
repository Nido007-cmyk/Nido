> **Idioma:** [English](../BLUETOOTH.md) · Español
# NIDO — Transporte Bluetooth (módulo `nido-p2p`)

> Estado: código Kotlin + adaptador TypeScript completos y probados a nivel
> de lógica (413 tests). **No compilado ni probado en hardware**: este
> entorno no tiene Android SDK/Java. La validación física es obligatoria
> antes de declarar el P2P funcional (checklist abajo).

## Qué hace cada pieza

| Pieza | Archivo | Responsabilidad |
|---|---|---|
| Sockets RFCOMM | `modules/nido-p2p/android/.../NidoP2PManager.kt` | Servidor/cliente, discovery, framing. Solo mueve bytes. |
| Puente Expo | `modules/nido-p2p/android/.../NidoP2PModule.kt` | Funciones async + eventos hacia JS. |
| Bindings TS | `modules/nido-p2p/src/index.ts` | API tipada del módulo (solo se carga en build real). |
| Adaptador | `src/p2p/nativeTransport.ts` | Implementa `P2PTransport`: handshake HELLO, rutas MAC↔pk. |
| Cripto/protocolo | `src/p2p/*` (sin cambios) | X25519, secretbox, anti-replay, cola, inbox. |

Regla de oro: **el Kotlin no interpreta nada**. Reensambla frames
`[u32 big-endian longitud][payload]` (máx. 256 KB, igual que
`FrameReassembler` en `src/p2p/protocol.ts`) y los entrega en base64.
El cifrado, el handshake y la verificación de contactos viven en TypeScript,
donde están los tests.

## UUID del servicio

```
8f3a1c2e-9b4d-4e5f-8a6b-7c9d0e1f2a3b   (nombre SDP: "NIDO-P2P")
```

Definido en `NidoP2PManager.SERVICE_UUID_STRING` y expuesto a TS vía
`getServiceUuid()`. Es fijo y público: identifica "habla NIDO" a nivel SDP.

## Handshake (nivel transporte)

Tras establecerse el socket RFCOMM (en cualquier dirección), cada lado envía
un frame HELLO **en claro**:

```json
{"t":"nido-hello","v":1,"pk":"<identidad 64 hex>","eph":"<efímera 64 hex>"}
```

El adaptador (`NidoBluetoothTransport`):

1. Envía su HELLO inmediatamente al conectar/aceptar (idempotente por MAC).
2. Al recibir el HELLO: valida forma → exige que `pk` sea un **contacto
   emparejado por QR** (`findContactByPk`) → si no, cierra el socket.
3. Emite `onHandshakeComplete(pk, myEphSecret, theirEphPk)`; el messenger
   deriva la sesión con su API existente (`completeHandshake`) y vacía la
   cola de salida hacia ese peer.
4. Desde entonces, `sendFrame(pkHex, …)` enruta por la MAC y los frames
   entrantes van a `onFrame(pkHex, …)`.

Timeout de handshake: 15 s. Sin HELLO válido no hay sesión y
`handleFrame` descarta todo (ya era así).

## Decisiones de seguridad

- **RFCOMM inseguro (sin emparejamiento del SO).** La confianza de NIDO viene
  del QR + su propia cripto. El emparejamiento del sistema pediría PINs,
  confundiría al usuario y no añade nada una vez que el handshake verifica
  al peer contra la lista de contactos QR.
- **El `pk` de identidad se anuncia en claro** a quien conecte. Es
  seudónimo y solo los contactos QR obtienen sesión; un desconocido es
  desconectado antes de que fluya ningún contenido.
- **Limitación conocida (no barrer bajo la alfombra):** el HELLO no va
  firmado; la unión criptográfica efímero↔identidad QR (Noise o firmas
  Ed25519 sobre efímeros) sigue pendiente, igual que en el diseño original.
  Un MITM activo *durante* el handshake podría sustituir efímeros. Los
  mensajes, aun así, llevan verificación de remitente, de destinatario e
  ID anti-replay.

## Permisos (Android)

Declarados en `app.json` (merge al manifiesto):

- `BLUETOOTH`, `BLUETOOTH_ADMIN` (legacy)
- `BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN` (API 31+)
- `ACCESS_FINE_LOCATION` (discovery en API < 31)

En ejecución, `requestPermissions()` los pide antes de discovery/servidor;
sin ellos el transporte lanza errores claros en español (no finge).

## Checklist de validación física (dos teléfonos, sin internet)

Requisito: Android SDK + JDK 17, `npx expo prebuild -p android --clean`,
`npx expo run:android` en cada teléfono (ver `docs/ANDROID_BUILD.md`).

1. [ ] Compila: el módulo aparece en el autolinking (`NidoP2P` en la lista
       de módulos Expo del log de prebuild).
2. [ ] En cada teléfono: crear identidad, emparejar por QR (los contactos
       aparecen en ambos).
3. [ ] Pantalla NIDO (futura, Prioridad 5): activar enlace → el discovery
       lista el otro teléfono; al conectar, `onHandshakeComplete` en ambos.
4. [ ] Enviar mensaje con el otro NIDO **sin alcance** → queda en cola
       cifrada (`pendingOutbox`), nada se pierde.
5. [ ] Acercar → el mensaje se entrega solo; `readInbox` lo muestra.
6. [ ] Apagar Bluetooth a mitad de un mensaje largo → no hay bytes
       fantasma: el siguiente handshake retransmite desde la cola (la
       idempotencia por ID evita duplicados visibles).
7. [ ] Un tercer teléfono **sin** emparejar intenta conectar → es
       rechazado ("no emparejado"), sin sesión ni mensajes.
8. [ ] `adb logcat`: sin stacktraces en `NidoP2PModule`/`NidoP2PManager`
       durante los escenarios 3–7.

## Puntos a verificar en el primer build real

- `requestPermissions`: la API `appContext.permissions.askForPermissions`
  de expo-modules-core puede variar entre versiones de Expo; si no compila,
  pedir los permisos con `ActivityCompat` + `onRequestPermissionsResult`
  es el plan B.
- Hilos: `connect()` es bloqueante con timeout del SO; va en el pool `io`
  del módulo, nunca en el hilo principal.
- En algunos fabricantes, el discovery clásico necesita ubicación activada
  a nivel de sistema además del permiso (avisar en la UI si `startDiscovery`
  devuelve falso repetidamente).
