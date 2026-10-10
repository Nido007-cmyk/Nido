> **Idioma:** [English](../PRIVACY.md) · Español

# PRIVACY.md — Endurecimiento de privacidad NIDO

Este documento registra cada brecha de privacidad encontrada durante el
endurecimiento y su estado. La política para usuarios está en
[`PRIVACY.md`](../../PRIVACY.md), en la raíz del repositorio.

## Implementado

### 1. Auditoría de red (`src/privacy/networkAudit.ts`)
Singleton append-only. `ModelManager.downloadCatalogModel` registra
`download_start` / `download_complete` / `download_failed` con endpoint
recortado a host+path (sin query strings — nunca se loguean tokens).
`isPristine()` permite a la UI mostrar "cero conexiones esta sesión".

### 2. Sin backup de Google (`app.json`)
`android.allowBackup: false` — el backup automático ya no puede subir
`documentDirectory` (ajustes + bases de datos).

### 3. Buscador de modelos eliminado
`src/services/modelBrowser.ts`, `src/models/discoveredModels.ts` y
`src/ui/ModelBrowser.tsx` eliminados, con todas sus referencias
(`ChatScreen`, `ModelSetupScreen`, `evalHarness`, `appReset`,
`ExecutionTelemetryScreen`). Buscar en `huggingface.co/api` filtraba
los intereses del usuario por red.

### 4. Revisiones fijadas (`src/models/manifest.ts`)
Nuevo campo `revision` + `pinnedSourceUrl()`: si está fijado, la descarga
usa `/resolve/<commit>/` en vez de la rama móvil `/resolve/main/`.
Los hashes reales se fijan en el proceso de release
(`scripts/setup-models.sh` los registra).

### 5. Verificación sha256 tras descargar (`ModelManager`)
- Assets ≤ 256 MB (embeddings, corpus): sha256 **obligatorio** tras la
  descarga; mismatch = archivo eliminado + error.
- LLMs multi-GB: verificación bajo demanda desde Ajustes
  (`verifyChecksum()` ya existía; verificar GBs en JS haría OOM).

### 6. Capa de agente sin red por construcción
- `src/agent/tools/manifest.ts`: solo herramientas locales. Regla:
  si una herramienta futura necesitara red, va a otro manifiesto con
  consentimiento por uso.
- `src/agent/tools/dispatcher.ts`: validación determinista — el modelo
  no puede invocar herramientas inexistentes ni inventar parámetros.

## Pendiente (fases siguientes)

- [ ] **SQLCipher**: `src/agent/memory/memoryStore.ts` ya emite
      `PRAGMA key` y falla cerrado si el SQLite no trae cipher.
      Falta: build con la variante SQLCipher de expo-sqlite + clave
      generada en Android Keystore al primer arranque.
- [ ] **Migrar `rag/db.ts` y `settings.ts`** al mismo cifrado.
- [ ] **Voz on-device**: reemplazar `modules/voice-input`
      (SpeechRecognizer del sistema) por whisper.cpp.
- [ ] **Bloqueo biométrico** al abrir la app.
- [ ] **Pantalla de auditoría** en Ajustes (listar `networkAudit.list()`).
- [ ] **Botón "verificar integridad"** en Ajustes → Modelos para LLMs grandes.

## Notas de seguridad del transporte P2P

- La cripto P2P de NIDO corre **por encima** del socket Bluetooth
  (X25519 ECDH + Ed25519 + XSalsa20-Poly1305 en `src/p2p/crypto.ts`),
  así que los ataques Bluetooth a nivel de enlace (KNOB, BIAS) no pueden
  leer el tráfico de NIDO. La clave de sesión se deriva con HKDF-SHA512
  (RFC 5869) ligada a los nonces frescos del handshake de ambos lados;
  los secretos efímeros se borran de memoria tras el handshake.
- Riesgo residual debajo de la capa de la app: RCE pre-autenticación en
  el stack Bluetooth de Android (p. ej. CVE-2025-0075 / CVE-2025-22403,
  use-after-free en SDP) puede comprometer el *dispositivo*, y entonces
  ninguna garantía de la app se sostiene. No hay fix en la app para esta
  clase. **Mínimo operativo: mantener ambas tablets con nivel de parche
  de seguridad de Android ≥ 2025-03-05.**
- Los tokens de tareas delegadas (feature flag OFF en v1) se ligan al
  tag de la sesión de transporte al emitirse; un token capturado en
  reposo no puede reinyectarse en otra sesión con el mismo peer.
