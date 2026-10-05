> **Idioma:** [English](../PRIVACY.md) · Español

# PRIVACY.md — Endurecimiento de privacidad NIDO

NIDO parte de BOAR, que ya era offline-first y sin analítica. Este documento
registra cada brecha encontrada en la auditoría (ver `BOAR_DEEP_DIVE.md` §10)
y su estado.

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
