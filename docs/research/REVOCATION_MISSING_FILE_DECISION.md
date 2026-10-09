# Decisión: escenario "archivo de revocaciones desaparecido"

## Fecha
2026-10-09

## Contexto
`SEC-REVOCATION-FAILCLOSED` (commit 0385da07) hace fail-closed cuando
`revoked-peers.json` existe pero está corrupto o ilegible. Queda un escenario
no cubierto: el archivo no existe en absoluto.

## Análisis

El código actual (`nativeTransport.ts:doLoadRevokedPks`) trata "archivo
inexistente" como instalación nueva: lista vacía, estado sano. No hay forma
de distinguir:
- Instalación genuinamente nueva (nunca se revocó a nadie)
- Archivo eliminado externamente después de revocaciones

## Por qué no se implementa un centinela

Un archivo centinela en el mismo directorio (`documentDirectory`) desaparecería
junto con `revoked-peers.json` ante el mismo evento (borrado, corrupción del
directorio). No aporta señal independiente.

Opciones reales requerirían:
1. **Marcador en la base SQLCipher** (ej. `meta` key `revocation_store_sealed`):
   acopla el transporte P2P al store persistente, introduce una dependencia
   nueva en la ruta crítica de `establishRoute`, y requiere migración de
   esquema. Cambio arquitectónico fuera del alcance autorizado.
2. **Keystore del sistema**: diseñado para secretos, no para marcadores de
   estado; abusar de él crea confusión operativa.

## Modelo de amenaza

Para que el archivo desaparezca sin desinstalación se requiere:
- Borrado manual vía "Clear Data" (equivale a reset de fábrica de la app:
  las BDs cifradas también se pierden; el estado resultante es indistinguible
  de instalación nueva, lo cual es correcto)
- Acceso root al dispositivo (ante root, ningún mecanismo app-level es
  confiable: el atacante puede modificar la BD, el código o el Keystore)

El directorio privado de Android (`documentDirectory`) no es accesible a otras
apps sin root. La probabilidad del escenario en uso normal es baja y el
impacto es observable: los contactos previamente revocados reaparecerían como
disponibles en la UI, lo que el propietario puede detectar y re-revocar.

## Decisión

**Riesgo residual aceptado y documentado.** No se implementa contramedida
adicional en esta fase. Se revisará después del gate físico si la validación
en dispositivo revela un vector realista.

## UI implementada en esta fase

Ante archivo corrupto (escenario cubierto):
- Banner visible en NidoScreen con título, explicación y botón de recuperación
- P2P bloqueado (fail-closed en `establishRoute` + `isRevoked`)
- Recuperación solo tras `showSecureAlert` con advertencia explícita de
  pérdida de revocaciones anteriores
- Mensajes i18n en ES/EN/PT (no presentados como restauración de confianza)
- Errores de escritura visibles vía `setNotice` (ya existía el try/catch)
