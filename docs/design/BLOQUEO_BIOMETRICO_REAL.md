# Diseño: bloqueo biométrico real (clave de la base atada a la autenticación)

> Estado: **IMPLEMENTADO en la rama `feat/hardware-key-vault` (PR #36), sin probar en dispositivos.** No forma parte de v0.1.6.
> Revisión 2 (2026-10-11): tras la investigación del §15 se cambió a autorización **por operación** (CryptoObject, timeout 0) y se quitó `setUnlockedDeviceRequired`.
> Fecha: 2026-10-11. Autor: Claude (a pedido del owner).
> Objetivo de versión: v0.1.7 (como pieza principal, probada con calma).

## 1. Problema

Hoy la pantalla de bloqueo de NIDO es solo de interfaz:

- La llave de la base de datos (DEK, 32 B aleatorios) vive en `expo-secure-store`,
  envuelta por una llave del Android Keystore **que no exige autenticación**.
- `App.tsx` lee la DEK (`getDatabaseKeyHex`) en el arranque, **antes** de la
  pantalla de bloqueo.
- `src/security/biometricGate.ts` pide la huella con `expo-local-authentication`,
  pero ese resultado no participa en ninguna operación criptográfica
  (documentado en `docs/C1_SQLCIPHER.md`).

Consecuencia: quien extraiga el almacenamiento de la app de una tablet robada
(root, exploit forense, cadena de arranque comprometida) puede pedirle al
Keystore que desenvuelva la DEK **sin conocer el PIN** y abrir la base.

## 2. Objetivo y modelo de amenazas

| Escenario | Hoy | Con este diseño |
|---|---|---|
| Tablet robada **apagada o recién reiniciada** (equivalente a BFU en iPhone) | Datos extraíbles con root/forense | **Protegido:** la DEK solo se desenvuelve tras PIN/huella del dueño |
| Tablet robada **bloqueada** con NIDO vivo en memoria (AFU) | Extraíble | Igual que hoy en el nivel recomendado (la DEK está en RAM); protegido solo en el modo estricto opcional |
| Tablet **desbloqueada** en manos de otro | Lee todo en pantalla | Igual (ninguna app protege esto) |
| Malware con root en un dispositivo vivo | Extraíble | Igual |
| Interceptación P2P | Ya protegida por el cifrado de sesión | Sin cambios |

No-objetivos: proteger contra el dueño, contra root en vivo, ni sustituir el
cifrado de disco de Android (FBE), que ya existe y es complementario.

## 3. Por qué no `expo-secure-store` con `requireAuthentication`

Investigado (docs de expo-secure-store v57):

- En Android exige autenticación **en cada operación**, sin ventana de validez.
- Las llaves se **invalidan al cambiar la biometría** (agregar una huella), y
  la lectura devuelve `null`: un usuario que agrega un dedo perdería el
  acceso a sus datos.
- No permite elegir PIN/patrón vs biometría, ni StrongBox, ni informar el
  nivel de seguridad del hardware.

Por eso hace falta un **módulo nativo propio** (como ya existen `nido-p2p`,
`ram-monitor`, etc.).

## 4. Arquitectura (revisión 2)

```
Android Keystore (StrongBox si el dispositivo declara FEATURE_STRONGBOX_KEYSTORE; si no, TEE)
  └─ KEK  "nido_kek_v1"  AES-256-GCM, no exportable
        · setUserAuthenticationRequired(true)
        · setUserAuthenticationParameters(0, AUTH_DEVICE_CREDENTIAL | AUTH_BIOMETRIC_STRONG)
            → timeout 0 = autorización POR OPERACIÓN (CryptoObject obligatorio)
        · setInvalidatedByBiometricEnrollment(false)
        · SIN setUnlockedDeviceRequired (ver §15.3)
        · Solo Android 11+ (API 30): por debajo la bóveda no se ofrece.
     └─ envuelve → DEK (32 B)  →  blob "nido_db_key_wrapped_v1"
                                   = versión(1) ‖ iv(12) ‖ ciphertext+tag(48), AAD "nido-dek-v1"
                                   guardado en expo-secure-store (sin auth)
        └─ PRAGMA key = x'<DEK>' sobre cada base SQLCipher (sin cambios)
```

Cada operación con la KEK (envolver o desenvolver) abre su propio
`BiometricPrompt` con un `CryptoObject` sobre el `Cipher` ya inicializado.
El hardware solo permite `update/doFinal` si el token de autenticación lleva
el desafío de **esa** operación. Consecuencias:

1. **Un desbloqueo normal de la tablet no habilita la llave** (con ventana de
   tiempo sí: cualquier token reciente la abría).
2. **Enganchar el callback de éxito no sirve** (ataque típico con Frida): sin
   token válido, `doFinal` falla.
3. **Diálogos:** desbloquear NIDO = 1; activar = 2 (proteger + verificar);
   rotar la llave = 2; desactivar = 1.

## 5. Módulo nativo `nido-keyvault` (Kotlin)

```ts
export interface NidoKeyVaultNative {
  getStatus(): Promise<{ supported; kekExists; securityLevel: "strongbox"|"tee"|"software"|"unknown"; apiLevel }>;
  ensureKek(): Promise<VaultStatus>;                       // E_UNSUPPORTED, E_NO_SECURE_LOCK, E_KEYGEN
  wrapWithAuth(plainB64, title, subtitle): Promise<string>;   // diálogo + cifrado
  unwrapWithAuth(blobB64, title, subtitle): Promise<string>;  // diálogo + descifrado
  deleteKek(): Promise<void>;
}
```

| Código | Causa | Respuesta de la app |
|---|---|---|
| `E_UNSUPPORTED` | Android 10 o inferior | Seguir en modo actual |
| `E_NO_SECURE_LOCK` | Sin PIN/patrón/contraseña | Seguir en modo actual + aviso |
| `E_KEY_INVALIDATED` | `KeyPermanentlyInvalidatedException` (se quitó el bloqueo de pantalla) | Pantalla de recuperación |
| `E_BLOB_CORRUPT` | Blob dañado o de otra versión | Si existe la DEK legada: volver al modo legado |
| `E_CANCELLED` / `E_AUTH_FAILED` | Diálogo cancelado / fallido | Quedarse bloqueado, reintentar |

## 6. Niveles de protección

- **Nivel A — "tras el primer desbloqueo" (recomendado, por defecto en v0.1.7):**
  la DEK queda en memoria mientras NIDO esté vivo. No rompe nada de lo que
  funciona: P2P en segundo plano, reconexión, recordatorios y tareas siguen
  igual porque ocurren con el proceso vivo tras el primer desbloqueo.
- **Nivel B — estricto (opcional, ajuste avanzado):** al pasar a segundo plano
  más de N minutos se cierra la base y se borra la DEK de memoria. Advertencia
  explícita: dejarán de recibirse mensajes P2P hasta abrir NIDO.

Nota: tras reiniciar la tablet, NIDO no arranca solo (no hay receptor de
arranque), así que el nivel A no pierde funcionalidad en segundo plano.

## 7. Flujo de arranque nuevo (`App.tsx`)

```
checking
  ├─ vault.getStatus()
  ├─ ¿blob envuelto existe?
  │    ├─ sí → pantalla de bloqueo → vault.unwrapWithAuth(blob)
  │    │        (un diálogo PIN/huella) → DEK en memoria → abrir bases → chat
  │    └─ no → flujo actual (DEK en SecureStore) + ofrecer migración (§8)
  └─ errores de vault → pantallas: E_KEY_INVALIDATED → recuperación
```

Cambios concretos:

- `enterKeyLossIfNeeded()` ya no llama a `getDatabaseKeyHex()` antes del
  bloqueo cuando hay blob: solo comprueba que el blob existe.
- `getDatabaseKeyHex()` (keyManager) pasa a leer de una caché en memoria
  poblada tras `unwrap`; si la caché está vacía y hay blob → `E_LOCKED`
  (nunca cae al almacenamiento sin auth).
- `biometricGate.ensureUnlocked()` se sustituye por `unlockVault()`
  cuando la bóveda está activa (misma UI).

## 8. Migración (sin pérdida de datos)

Máquina de estados persistida (archivo marcador, igual que `secureDatabase.ts`):

1. `LEGACY` — DEK solo en SecureStore (estado actual de todos los usuarios).
2. Tras un desbloqueo exitoso, con aviso previo al usuario (§9):
   - `ensureKek()` → `wrapWithAuth(DEK)` (diálogo 1) → guardar blob.
3. `WRAPPED_PENDING` — verificar: `unwrapWithAuth(blob)` (diálogo 2) == DEK.
4. Solo si todo verifica → borrar `nido_db_key` del SecureStore → `WRAPPED`.
5. Cualquier fallo antes del paso 4 → borrar el blob, quedar en `LEGACY`,
   registrar el motivo. **Nunca** se borra la DEK original sin verificación.

Reintentable e idempotente; un cierre en medio de la migración deja el
estado `WRAPPED_PENDING`, que al siguiente arranque se verifica o se revierte.

## 9. Experiencia de usuario y avisos

Antes de activar (una sola vez):

> "NIDO va a proteger tus datos con el PIN o la huella de esta tablet. Si un
> día quitas el bloqueo de pantalla de la tablet, NIDO no podrá abrir tus
> datos y solo podrás recuperarlos con un respaldo. ¿Crear un respaldo ahora?"

- Botones: **Crear respaldo y activar** (recomendado) / **Activar sin respaldo** / **Ahora no**.
- En Acerca de → Seguridad: estado ("Protección por hardware: activa, TEE"),
  nivel A/B, y el botón para desactivar (vuelve a `LEGACY` tras autenticarse).
- Tablet sin PIN: aviso "Pon un PIN en la tablet para activar la protección
  por hardware" y se sigue como hoy.

## 10. Casos de fallo y recuperación

| Caso | Qué pasa | Qué ve el usuario |
|---|---|---|
| Quita el PIN de la tablet | Android invalida la KEK | Pantalla de recuperación: restaurar respaldo (con su llave) o empezar de cero. Nunca se finge un primer uso |
| Agrega/quita una huella | Nada (`setInvalidatedByBiometricEnrollment(false)` + PIN) | Nada |
| Actualiza la app | KEK y blob se conservan | Nada |
| Desinstala | Android borra la KEK | Datos perdidos salvo respaldo (igual que hoy) |
| Restaura un respaldo | El respaldo se re-cifra con la DEK nueva y la DEK se envuelve | Flujo de restauración actual + envoltura |
| StrongBox lento o ausente | Se usa TEE | Estado muestra "TEE" |

## 11. Relación con otros pendientes

- **Llave de respaldo separada (pendiente):** diseñarla junto con esto. El
  respaldo debe re-cifrarse con una llave de respaldo propia (BEK) en vez de
  exportar la DEK; así la DEK nunca sale del dispositivo y la recuperación
  tras `E_KEY_INVALIDATED` no depende de ella.
- **Claves P2P (fase 2):** la clave de firma y la de identidad pueden
  envolverse con la misma KEK (un solo desbloqueo abre todo). Se necesitan
  solo con el proceso vivo tras el desbloqueo, así que el nivel A no afecta
  al P2P.
- **Hallazgo relacionado:** el texto de los recordatorios programados queda en
  el almacén de notificaciones de Android (expo-notifications), fuera de
  SQLCipher. Valorar guardar un texto genérico en la notificación y el detalle
  dentro de NIDO.

## 12. Plan de pruebas

Automáticas (JS, con módulo nativo simulado):

- Máquina de estados de migración: cada paso con fallo inyectado revierte a `LEGACY` sin borrar la DEK.
- `getDatabaseKeyHex()` nunca lee la DEK del SecureStore cuando existe blob.
- Mapeo de cada código de error a su pantalla.

En las tablets (obligatorias antes de publicar):

1. Instalar sobre datos existentes → migrar → todo sigue (chat, memoria, contactos, P2P).
2. Reiniciar la tablet → NIDO pide PIN/huella → abre.
3. Forzar cierre → reabrir → pide autenticación.
4. Agregar una huella nueva → sigue abriendo.
5. Cambiar el PIN (sin quitarlo) → sigue abriendo.
6. Quitar el PIN → pantalla de recuperación → restaurar respaldo.
7. P2P en segundo plano con pantalla apagada (nivel A) → sigue funcionando.
8. Crear y restaurar respaldo con la bóveda activa.
9. Cancelar el diálogo de huella → se queda bloqueado, sin errores.

## 13. Fases y esfuerzo

| Fase | Contenido | Esfuerzo (Claude) |
|---|---|---|
| 1 | Módulo `nido-keyvault` + pruebas JS con simulador | ~0,5 día |
| 2 | Integración en keyManager/App.tsx + migración + pantallas | ~0,5–1 día |
| 3 | Llave de respaldo separada (BEK) | ~0,5 día |
| 4 | Pruebas en tablets (owner) + correcciones | según resultados |
| 5 (opcional) | Nivel B estricto y claves P2P envueltas | ~0,5 día |

Riesgo principal: dejar a un usuario fuera de sus datos. Mitigación: migración
verificada antes de borrar nada, PIN incluido como método, aviso + respaldo
antes de activar, y pantalla honesta de recuperación.

## 14. Referencias

- Android `KeyGenParameterSpec.Builder` (setUserAuthenticationParameters, setInvalidatedByBiometricEnrollment, setUnlockedDeviceRequired, setIsStrongBoxBacked): https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec.Builder
- `KeyPermanentlyInvalidatedException`: https://developer.android.com/reference/kotlin/android/security/keystore/KeyPermanentlyInvalidatedException
- expo-secure-store (comportamiento de `requireAuthentication`): https://docs.expo.dev/versions/v57.0.0/sdk/securestore/
- Estado actual documentado: `docs/C1_SQLCIPHER.md`, `src/security/biometricGate.ts`, `src/privacy/keyManager.ts`, `src/security/secureDatabase.ts`.

## 15. Investigación (revisión 2, 2026-10-11)

### 15.1 Por tiempo vs. por operación

- **OWASP MASTG-BEST-0036** recomienda `BiometricPrompt` con `CryptoObject`
  respaldado por una llave del Keystore y `setUserAuthenticationParameters(0, …)`
  ("un timeout de 0 exige autenticación para cada operación criptográfica"),
  porque sin `CryptoObject` la autenticación depende solo del callback, que se
  puede enganchar.
- **OWASP MASTG-TEST-0330** marca como fallo las llaves para operaciones
  sensibles con duración > 0: "un atacante con acceso físico al teléfono podría
  disparar operaciones sensibles sin verificación biométrica".
- **Código de Keymaster (AOSP, `keymaster_enforcement.cpp`)**: las llaves con
  timeout solo verifican la frescura del token al **iniciar** la operación; las
  de timeout 0 exigen que el **desafío** del token coincida con el identificador
  de la operación en cada update/finish.
- **Documentación del Keystore**: el hardware seguro normalmente **no** impone
  los intervalos de validez temporal (no tiene reloj propio); sí impone la
  autorización por operación.

**Decisión:** por operación (timeout 0) con `CryptoObject`.

### 15.2 PIN además de la huella (desviación consciente de MASTG-BEST-0031/0037)

- MASTG-BEST-0031 desaconseja `DEVICE_CREDENTIAL` cuando la operación es "solo
  biométrica"; MASTG-BEST-0037 recomienda invalidar al inscribir huellas nuevas
  (para que quien sepa el PIN no agregue su dedo).
- En NIDO el PIN **es** la raíz de confianza (igual que en el iPhone): quien lo
  sepa ya puede autenticarse con él, así que invalidar por inscripción no añade
  protección y sí riesgo de pérdida de datos. Además, muchos usuarios no tienen
  huella. La documentación del Keystore indica que la invalidación por
  inscripción aplica a llaves solo biométricas.
- Con `CryptoObject`, la credencial del dispositivo solo es posible desde
  **Android 11** (MASTG-KNOW-0001): por eso el requisito mínimo es API 30.

### 15.3 `setUnlockedDeviceRequired`: retirado

La documentación de AOSP (cambio "Improve the documentation for
UnlockedDeviceRequired") advierte usarlo **solo en Android 15+**: en 12–14 hay
fallos conocidos, entre ellos que desbloquear con una biometría no fuerte (p.
ej. ciertos desbloqueos faciales) **no** re-autoriza la llave. En tablets
Samsung con reconocimiento facial eso podía dejar a NIDO sin abrir. La
autorización por operación ya es más estricta, así que no se usa.

### 15.4 StrongBox

La guía oficial: StrongBox es más resistente a manipulación física y canales
laterales pero más lento; "para la mayoría de apps no es necesario". NIDO hace
una sola operación AES de 32 B por desbloqueo y el riesgo que se busca cubrir
es justamente la tablet robada, así que se **prefiere StrongBox si el
dispositivo lo declara**, con caída a TEE si la generación falla. El nivel real
se muestra en Acerca de.

### 15.5 Antecedentes en otras apps

- **Signal** quitó su contraseña local de la base al apoyarse en el cifrado de
  disco de Android (FBE); **Molly** (fork de Signal) la reintrodujo como "cifrado
  en reposo" con bloqueo configurable y borrado seguro de RAM. Es el mismo
  objetivo que este diseño (nivel A ≈ FBE "credential encrypted" a nivel de app;
  nivel B ≈ bloqueo de Molly).

### 15.6 Fuentes

- OWASP MASTG-BEST-0036: https://mas.owasp.org/MASTG/best-practices/MASTG-BEST-0036/
- OWASP MASTG-TEST-0330: https://mas.owasp.org/MASTG/tests/android/MASVS-AUTH/MASTG-TEST-0330/
- OWASP MASTG-BEST-0031 y 0037, MASTG-KNOW-0001 (repositorio OWASP/mastg)
- Android Keystore: https://developer.android.com/privacy-and-security/keystore
- AOSP keymaster_enforcement.cpp: https://android.googlesource.com/platform/system/keymaster/+/refs/heads/oreo-dr1-dev/keymaster_enforcement.cpp
- AOSP, documentación de UnlockedDeviceRequired: https://gerrit.omnirom.org/plugins/gitiles/android_frameworks_base/+/dbbfc624add70d97f1d9b5c6140f10bf7d658793%5E%21
- StrongBox vs TEE: https://proandroiddev.com/android-keystore-what-is-the-difference-between-strongbox-and-hardware-backed-keys-4c276ea78fd0
- Molly: https://github.com/mollyim/mollyim-android

### 15.7 Pendiente de verificar en dispositivo

- Si las Tab A9+ declaran StrongBox y si la generación con StrongBox +
  autenticación por operación funciona (si no, debe caer a TEE).
- Que el diálogo con PIN funcione con `CryptoObject` en la versión de Android
  de las tablets (Samsung One UI).
- Tiempos: StrongBox puede tardar; medir el desbloqueo.
