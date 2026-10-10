# REBRAND.md — Guía de cambio de marca

> **Propósito:** Si NIDO necesita cambiar de nombre comercial (p. ej. por un
> conflicto legal sobre la palabra "nido"), esta guía permite hacerlo rápido
> y sin romper nada.

## Principio fundamental

**La marca visible y el protocolo son cosas separadas.**

- ✅ **SÍ cambia:** nombre en UI, system prompts, app.json, package name, íconos
- ❌ **NO cambia:** `nido-hello`, `nido-confirm`, UUIDs Bluetooth, `nido-ack-session-v1`
  (son protocolo wire; cambiarlos rompería comunicación entre dispositivos)

## Paso 1: Marca visible (1 archivo)

Edita `src/branding/branding.ts`:

```typescript
export const APP_NAME = "NUEVO_NOMBRE";
export const APP_TAGLINE = "nuevo tagline";
export const AGENT_NAME = "NUEVO_NOMBRE";
```

## Paso 2: Configuración de la app

| Archivo | Campo | Valor actual |
|---------|-------|--------------|
| `app.json` | `name` | `"NIDO"` → nuevo nombre |
| `app.json` | `slug` | `"nido-app"` → nuevo slug |
| `package.json` | `name` | `"nido-app"` → nuevo slug |
| `android/app/build.gradle` | `applicationId` | `'team.nido.app'` → nuevo ID |

**⚠️ Cambiar `applicationId` = app nueva en Play Store** (no actualiza la anterior).
Solo hacerlo si es estrictamente necesario.

## Paso 3: Assets visuales

| Archivo | Descripción |
|---------|-------------|
| `assets/icon-nido.png` | Ícono principal → reemplazar |
| `assets/mascot-nido.png` | Mascota → reemplazar o renombrar |
| `assets/android-icon-*.png` | Íconos Android → regenerar |
| `assets/favicon.png` | Favicon → reemplazar |
| `docs/social-preview.png` | Banner GitHub → regenerar |

## Paso 4: Documentación

- `README.md` + `README.es.md` — título y referencias
- `ATTRIBUTION.md` — actualizar si cambia la entidad legal
- `docs/social-preview.png` — regenerar banner

## Paso 5: GitHub

- Nombre del repo (Settings → Rename)
- Descripción del repo
- Topics (mantener los técnicos, actualizar si hay de marca)

## Lo que NO se toca (protocolo inmutable)

Estos identificadores están documentados en `src/p2p/protocol.ts` y son
parte del protocolo wire. **Nunca cambiar en un rebrand:**

- `nido-hello` (tipo de mensaje HELLO)
- `nido-confirm` (tipo de mensaje CONFIRM)
- `nido-p2p` (nombre de servicio Bluetooth)
- `nido-ack-session-v1` (dominio de session tag)
- `SERVICE_UUID` en `NidoP2PManager.kt` (UUID Bluetooth)

## Verificación post-rebrand

```bash
npx tsc --noEmit    # sin errores
npm test            # todos los tests pasan
# Buscar residuos:
grep -ri "nido" src/branding/  # solo el archivo de config debe mencionarlo
```

## Tiempo estimado

- Solo marca visible (Paso 1): **5 minutos**
- Completo sin cambiar applicationId: **1-2 horas**
- Completo con nuevo applicationId: **medio día** (nuevo keystore, Play Store, etc.)
