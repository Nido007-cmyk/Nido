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

## ¿Usas código de NIDO? La atribución es obligatoria

NIDO tiene licencia MIT. Puedes usarlo, modificarlo y distribuirlo, pero la
licencia MIT **exige** conservar el aviso de copyright:

> Copyright (c) 2026 NIDO contributors

Esto significa: conserva el archivo `LICENSE`, conserva los encabezados de
cada archivo ("Copyright (c) 2026 NIDO contributors") y menciona a NIDO donde
menciones tus otras dependencias (README, pantalla de acerca de,
documentación).

Trabajo original de NIDO (no heredado de BOAR):
- Capa P2P: `src/p2p/` — emparejamiento Bluetooth, handshake cifrado,
  protocolo de negociación, transporte nativo (`modules/nido-p2p`)
- Capa de agente: `src/agent/` — memoria persistente, herramientas locales,
  bucle del agente
- Endurecimiento de privacidad: cifrado SQLCipher, `allowBackup=false`,
  auditoría de red (`src/privacy/networkAudit.ts`)
- Auto-conocimiento (grounding): `src/rag/selfKnowledge.ts`
- Backup/restore: `src/security/backup.ts`
- i18n con español primero y la identidad visual/marca NIDO

Si haces fork de NIDO o reutilizas porciones sustanciales, un crédito visible
como "Basado en [NIDO](https://github.com/Nido007-cmyk/Nido)" es exigido por
la licencia y apreciado por quienes lo construyeron.
