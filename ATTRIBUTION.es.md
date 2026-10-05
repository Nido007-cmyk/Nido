> **Idioma:** [English](ATTRIBUTION.md) · Español

# ATTRIBUTION.md — NIDO

NIDO es un fork de **BOAR** (https://github.com/rferrari/boar-app),
licencia MIT, Copyright (c) 2026 aoair contributors.
El aviso de copyright y el texto de la licencia MIT se conservan en `LICENSE`.

## Qué se reutiliza de BOAR
- Motor de inferencia local (`src/inference/LlamaEngine.ts`, `src/rag/embed.ts`)
- RAG híbrido local (`src/rag/retrieve.ts`, `pure.ts`, `db.ts` — migrado a cifrado)
- Gestión de modelos y descarga reanudable (`src/models/ModelManager.ts`)
- Importador de documentos locales (`src/services/documentImporter.ts`)
- UI base: chat, drawer, temas, componentes (`src/ui/`)
- Módulos nativos: `ram-monitor`, `download-wake-lock`

## Qué cambió en NIDO (privacidad total + agente)
- Capa de agente nueva: `src/agent/` (memoria persistente cifrada,
  herramientas locales, bucle pensar→actuar→observar)
- `src/privacy/networkAudit.ts`: auditoría de red (registro inmutable)
- Base de datos y ajustes cifrados (SQLCipher + Android Keystore)
- `allowBackup=false`: fuera del backup de Google
- Eliminado: buscador de modelos en Hugging Face (filtraba intereses por red),
  telemetría persistente, pantallas de desarrollo
- Voz del sistema reemplazada por inferencia on-device (whisper.cpp)
- Español (`src/i18n/locales/es.json`) como idioma principal

## Licencias de modelos y datos (si se distribuyen los assets de BOAR)
- Qwen2.5 / Gemma: Apache-2.0
- Phi-3.5-mini / bge-small-en-v1.5: MIT
- LFM2.5-8B: LFM Open License v1.0 (revisar términos antes de distribuir)
- Corpus Wikipedia: CC BY-SA 4.0 (atribución + compartir-igual)
