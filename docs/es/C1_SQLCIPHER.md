> **Idioma:** [English](../C1_SQLCIPHER.md) · Español
# C-1 — SQLCipher + Keystore + migración fail-closed · Informe

Fecha: 2026-09-27. Rama: `master`. Commits: `f2a347e`, `f515b65`, `974d1b5`,
`40dc2a0`, `91c4c87`, `5f1db0d`, `c95c02b`.

## Objetivo

Eliminar almacenamiento sensible en claro: SQLCipher real para la base
completa, jerarquía Keystore→KEK→DEK, migración plaintext→encrypted
recuperable y fail-closed, sin fallback silencioso a plaintext.

## Librería y jerarquía real (sin aspiraciones)

- **SQLCipher**: `expo-sqlite` con `useSQLCipher: true` (app.json). En el
  contenedor se verificó SQLCipher **4.12.0 community** (vía python/sqlcipher3).
- **DEK**: 32 bytes CSPRNG (`expo-crypto`), formato `x'hex'`, guardada en
  `expo-secure-store` (Keystore Android / Keychain iOS).
- **Estado honesto de la jerarquía**: hoy la DEK vive directamente en el
  SecureStore del SO. **No** hay todavía KEK explícita no exportable con
  `setUserAuthenticationRequired`, ni detección StrongBox vs TEE. El
  comentario "StrongBox/TEE" en código anterior sobrestimaba lo
  implementado; el módulo Keystore nativo con clase de protección reportada
  queda como trabajo pendiente (no bloquea el cifrado en reposo: el
  SecureStore ya usa el Keystore del SO).
- **Biometría** (`src/security/biometricGate.ts`): gate de acceso UX con
  timeout de 5 min en memoria y `lockNow()` al pasar a background. **No** es
  autorización criptográfica de uso de clave; no sustituye a la DEK.

## Migración (`src/security/secureDatabase.ts`)

Estados: `MIGRATION_NOT_REQUIRED · REQUIRED · IN_PROGRESS · COMPLETE ·
RECOVERY_REQUIRED`.

Orden fail-closed:
1. `PRAGMA wal_checkpoint(TRUNCATE)` sobre la original.
2. Huella de esquema + conteos de la original.
3. `ATTACH DATABASE … KEY "x'…'"` + `sqlcipher_export('nido_enc')` a
   `<db>.migtmp` (+ `DETACH`).
4. Reapertura del temporal con la DEK → `PRAGMA key`, lectura forzada de
   `sqlite_master`, `integrity_check`, comparación de huella.
5. `rename` temporal→principal, borrado de sidecars plaintext
   (-wal/-shm/-journal), marcador `.sqlcipher`, reapertura final.

Garantías: la original **nunca** se borra antes de verificar la cifrada; sin
fallback silencioso a plaintext; sin presentar una base vacía como éxito.
`applyDatabaseKey` valida el formato de la clave y fuerza una lectura real:
clave incorrecta, base corrupta o base aún en claro → cierre fail-closed sin
incluir la clave en el error.

Recuperación: temporal válido → completa el rename; temporal inválido →
se descarta y se re-migra desde la principal; ni temporal ni principal
legibles → `RECOVERY_REQUIRED` (requiere intervención, no adivina).

Integrado en `memoryStore` (`nido_memory.db`) y `rag/db`
(`aoair_knowledge.db`). El JSON sensible de caché del importador se elimina
en `finally`.

## H-8 (sesiones P2P)

`completeHandshake` guarda la sesión derivada como **candidata**
(`pendingSessions`); la sesión viva no se sustituye hasta que `handleFrame`
recibe un frame válido bajo la clave de la candidata (liveness). Un HELLO
repetido ya no desaloja la sesión viva ni desvía la cola.

## Backups

`android:allowBackup=false` (todas las API) + `dataExtractionRules` con
**exclusiones explícitas** de los nueve dominios
(root/file/database/sharedpref/external/device_root/device_file/
device_database/device_sharedpref, `path="."`) en `<cloud-backup>` y
`<device-transfer>`. Verificado con `expo prebuild --clean`: XML generado
y atributos presentes en el manifest. (Secciones vacías habrían aplicado la
política por defecto —incluir datos—; se corrigió.)

## Evidencia (tests exactos, 2026-09-27)

- `npx tsc --noEmit` → 0 errores.
- Suite completa: **46 archivos, 460 tests, todos verdes**.
- `src/security/secureDatabase.test.ts` (21): estados, migración completa,
  fallo en export (original intacta), huella distinta (aborta), temporal
  parcial/válido/inválido, `RECOVERY_REQUIRED`, clave incorrecta
  fail-closed, end-to-end, constructores SQL.
- `src/security/sqlcipherReal.test.ts` (1): ejecuta **nuestras sentencias
  exactas** contra SQLCipher 4.12 real — migración preserva datos,
  `integrity_check` ok, sqlite3 estándar no abre, clave incorrecta/ausente
  fallan, sin strings en claro en el fichero. (Se omite si no hay
  python3+sqlcipher3; no es evidencia Android.)
- `src/security/biometricGate.test.ts` (11): timeout, cancelación, fallo,
  sin enrollment (sin bypass), `lockNow`.
- `src/p2p/messenger.test.ts`: test H-8 (handshake 2 no rompe la viva;
  tras liveness promociona y la vieja deja de autenticar).
- Prebuild limpio verificado dos veces (backup rules + manifest).

## Riesgos residuales y lo que falta para cerrar C-1

1. **Sin compilación Android ni prueba en dispositivo**: todo lo anterior
   es lógica TS + SQLCipher de contenedor. Pendiente: build real, `PRAGMA
   cipher_version` en Android, migración de una base con datos en el
   teléfono, pruebas de fallo (kill, sin espacio).
2. **Keystore nativo**: falta el módulo con KEK no exportable,
   StrongBox→TEE con fallback y reporte de clase de protección; la
   biometría como autorización criptográfica (`setUserAuthenticationRequired`).
3. **Sin auditoría externa**.
4. `runStartupRoutines()` corre antes del desbloqueo biométrico: revisar si
   toca datos sensibles.
5. `expo-file-system.moveAsync` se asume atómico/sobrescribiente: confirmar
   en dispositivo.

C-1 se considera **implementado y probado en lógica**, pendiente de
validación Android para el cierre.
