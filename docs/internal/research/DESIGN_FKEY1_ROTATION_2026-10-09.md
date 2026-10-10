# Diseño F-KEY-1: Rotación de DEK

**Fecha:** 2026-10-09
**Estado:** Diseño (no implementado)
**Severidad original:** Medium (design gap)

## Problema

El DEK (Database Encryption Key) nunca rota. El mismo DEK cifra:
- La DB viva
- Todos los backups históricos

Si el DEK se compromete, todos los backups pasados son legibles. No hay forward secrecy.

## Diseño propuesto

### Fase 1: Rotación manual (recomendado para v1)

Agregar opción en Settings: "Rotar clave de cifrado"

**Flujo:**
1. Usuario autentica con biométrico
2. Generar nuevo DEK (32 bytes aleatorios via `expo-crypto`)
3. Abrir DB actual con DEK viejo
4. `PRAGMA rekey = '<nuevo DEK hex>'` (SQLCipher soporta rekey en vivo)
5. Guardar nuevo DEK en Keystore
6. Invalidar backups viejos (marcar en manifest que necesitan DEK anterior)
7. Confirmar al usuario

**Ventajas:**
- SQLCipher `rekey` es atómico y probado
- No necesita exportar/reimportar
- El usuario controla cuándo rotar

**Riesgos:**
- Si falla a mitad, la DB queda con DEK viejo (fail-safe, no corrupta)
- Backups viejos quedan huérfanos (documentar)

### Fase 2: Rotación automática (futuro)

- Rotar cada 90 días automáticamente
- Notificar al usuario
- Mantener los últimos 2 DEKs para abrir backups recientes

### Consideraciones de seguridad

- **Nunca** loggear el DEK (ni viejo ni nuevo)
- **Siempre** biométrico antes de rotar
- El DEK viejo se borra de memoria con `fill(0)` después
- Si el Keystore falla al guardar el nuevo, abortar (no dejar DB sin clave)

### Tests necesarios

1. `rekey` cambia la clave sin perder datos
2. La DB abre con la nueva clave
3. La DB NO abre con la vieja clave
4. Fallo en Keystore → rollback (DB sigue con vieja)
5. Biométrico requerido

### Estimación

- Implementación: 1 día
- Tests: 4 horas
- Riesgo: MEDIO (toca crypto, pero `rekey` es primitiva probada)

## Decisión

Diseño listo. Implementar en lane dedicado post-APK público. No es bloqueante.
