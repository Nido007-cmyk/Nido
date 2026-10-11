# Diseño: bloqueo biométrico real (clave de la base atada a la autenticación)

> Estado: **DISEÑO LISTO, NO IMPLEMENTADO.** No forma parte de v0.1.6.
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

## 4. Arquitectura

```
Android Keystore (StrongBox si existe; si no, TEE)
  └─ KEK  "nido_kek_v1"  AES-256-GCM, no exportable
        · setUserAuthenticationRequired(true)
        · API ≥ 30: setUserAuthenticationParameters(30 s, DEVICE_CREDENTIAL | BIOMETRIC_STRONG)
        · API 24–29: setUserAuthenticationValidityDurationSeconds(30)
        · setInvalidatedByBiometricEnrollment(false)   ← agregar una huella NO invalida
        · setUnlockedDeviceRequired(true) (API ≥ 28)
        · setIsStrongBoxBacked(true) con reintento sin StrongBox
     └─ envuelve → DEK (32 B)  →  blob "nido_db_key_wrapped_v1"
                                   = versión(1) ‖ iv(12) ‖ ciphertext+tag(48)
                                   guardado en expo-secure-store (sin auth)
        └─ PRAGMA key = x'<DEK>' sobre cada base SQLCipher (sin cambios)
```

Puntos clave:

1. **La KEK nunca sale del hardware.** Solo cifra/descifra 32 bytes.
2. **Ventana de 30 s tras autenticarse:** el desbloqueo con PIN o huella en la
   pantalla de NIDO habilita la KEK durante 30 s; en ese intervalo se
   desenvuelve la DEK. Luego la KEK vuelve a quedar cerrada.
3. **PIN incluido como método:** atar la llave también a la credencial del
   dispositivo evita que agregar o quitar huellas invalide nada.
4. **La DEK queda en memoria mientras el proceso vive** (nivel recomendado,
   §6). Al reiniciar la tablet o forzar el cierre, hace falta autenticarse de
   nuevo: ese es el beneficio principal.
5. **Formato versionado** del blob para poder migrar en el futuro.

## 5. Módulo nativo `nido-keyvault` (Kotlin)

API expuesta a JS (Expo Modules):

```ts
// modules/nido-keyvault/index.ts
export type VaultStatus = {
  supported: boolean;            // hay pantalla de bloqueo segura y API suficiente
  kekExists: boolean;
  securityLevel: "strongbox" | "tee" | "software" | "unknown";
  apiLevel: number;
};
export function getStatus(): Promise<VaultStatus>;
/** Crea la KEK si no existe. Falla si no hay pantalla de bloqueo segura. */
export function ensureKek(): Promise<VaultStatus>;
/** Muestra BiometricPrompt (huella o PIN) y deja la KEK usable 30 s. */
export function authenticate(title: string, subtitle: string): Promise<"ok" | "cancelled" | "failed">;
/** Cifra con la KEK (requiere authenticate() reciente). Devuelve blob base64. */
export function wrap(plainB64: string): Promise<string>;
/** Descifra el blob (requiere authenticate() reciente). */
export function unwrap(blobB64: string): Promise<string>;
/** Borra la KEK (solo para "Borrar todos los datos"). */
export function deleteKek(): Promise<void>;
```

Errores tipados (códigos que JS traduce a pantallas):

| Código | Causa | Respuesta de la app |
|---|---|---|
| `E_NO_SECURE_LOCK` | La tablet no tiene PIN/patrón/contraseña | Seguir en modo actual + aviso |
| `E_AUTH_REQUIRED` | Se llamó a unwrap fuera de la ventana | Volver a pedir autenticación |
| `E_KEY_INVALIDATED` | `KeyPermanentlyInvalidatedException` (p. ej. se quitó el PIN) | Pantalla honesta de recuperación con respaldo |
| `E_STRONGBOX_UNAVAILABLE` | Interno: reintentar en TEE | Transparente |
| `E_CANCELLED` | El usuario canceló el diálogo | Quedarse en la pantalla de bloqueo |

Detalles de implementación:

- `BiometricPrompt` (androidx.biometric) con `setAllowedAuthenticators(BIOMETRIC_STRONG or DEVICE_CREDENTIAL)` en API ≥ 30.
  En API 28–29 esa combinación no está permitida: usar `BIOMETRIC_WEAK or DEVICE_CREDENTIAL`
  sin `CryptoObject` (la KEK con ventana de validez no lo necesita). Ojo: una
  biometría débil (clase 2, p. ej. algunos desbloqueos faciales) **no**
  habilita llaves del Keystore; si `unwrap` devuelve `E_AUTH_REQUIRED` tras
  una autenticación así, se vuelve a pedir con PIN.
  En API 24–27: `KeyguardManager.createConfirmDeviceCredentialIntent`.
- Nivel de seguridad: `KeyInfo.securityLevel` (API ≥ 31) o `isInsideSecureHardware` (anteriores).
- Cifrado: `Cipher.getInstance("AES/GCM/NoPadding")`, IV aleatorio de 12 B
  generado por el Keystore, AAD fija `"nido-dek-v1"` para atar el blob a su uso.
- La DEK en Kotlin vive en `ByteArray` que se rellena con ceros tras pasarla a JS.

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
  │    ├─ sí → pantalla de bloqueo → vault.authenticate()
  │    │        → vault.unwrap(blob) → DEK en memoria → abrir bases → chat
  │    └─ no → flujo actual (DEK en SecureStore) + ofrecer migración (§8)
  └─ errores de vault → pantallas: E_KEY_INVALIDATED → recuperación
```

Cambios concretos:

- `enterKeyLossIfNeeded()` ya no llama a `getDatabaseKeyHex()` antes del
  bloqueo cuando hay blob: solo comprueba que el blob existe.
- `getDatabaseKeyHex()` (keyManager) pasa a leer de una caché en memoria
  poblada tras `unwrap`; si la caché está vacía y hay blob → `E_LOCKED`
  (nunca cae al almacenamiento sin auth).
- `biometricGate.ensureUnlocked()` se sustituye por `vault.authenticate()`
  cuando la bóveda está activa (misma UI).

## 8. Migración (sin pérdida de datos)

Máquina de estados persistida (archivo marcador, igual que `secureDatabase.ts`):

1. `LEGACY` — DEK solo en SecureStore (estado actual de todos los usuarios).
2. Tras un desbloqueo exitoso, con aviso previo al usuario (§9):
   - `ensureKek()` → `authenticate()` → `wrap(DEK)` → guardar blob.
3. `WRAPPED_PENDING` — verificar: `unwrap(blob)` == DEK **y** abrir cada base
   SQLCipher con la DEK desenvuelta (lectura de prueba).
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
