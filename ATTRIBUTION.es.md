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
- Eliminado: buscador de modelos en Hugging Face (filtraba intereses por red)
  y pantallas de desarrollo. La telemetría es solo local: tiempos y
  cuentas en la base cifrada, que nunca se envían a ningún sitio
- La entrada de voz usa el SpeechRecognizer integrado de Android con la
  opción de preferir offline (no es un modelo incluido: la disponibilidad y
  el comportamiento sin conexión dependen del servicio del dispositivo)
- Idiomas español y portugués además del inglés (`src/i18n/locales/`)

## Licencias de modelos y datos

La app no lleva ningún modelo de IA dentro del APK: los modelos se descargan
de quien los publica cuando los eliges, y cada uno conserva su licencia. Las
licencias de abajo se verificaron en su origen el 2026-10-14 (ver
[`docs/release/MODEL_LICENSE_AUDIT.md`](docs/release/MODEL_LICENSE_AUDIT.md)).

| Qué | Licencia | Notas |
|---|---|---|
| Qwen2.5 0.5B / 1.5B / 7B Instruct (Alibaba Qwen) | Apache-2.0 | GGUF de bartowski |
| Qwen3-0.6B (Alibaba Qwen) | Apache-2.0 | GGUF de unsloth |
| Gemma 4 E4B (Google) | Apache-2.0 | GGUF QAT oficial |
| Phi-3.5-mini-instruct (Microsoft) | MIT | GGUF de bartowski |
| bge-small-en-v1.5 (BAAI) | MIT | GGUF de CompendiumLabs |
| multilingual-e5-small (intfloat; Wang et al., arXiv:2402.05672) | MIT, Copyright (c) Microsoft Corporation | el GGUF del release `knowledge-packs-v2` es la conversión de NIDO; el aviso MIT va en `LICENSE-ATTRIBUTION.txt` junto a él |
| LFM2.5-8B-A1B (Liquid AI) | LFM Open License v1.0 | no es Apache/MIT: el uso comercial solo se licencia a entidades con menos de 10 millones de USD de ingresos anuales (§5); redistribuirlo exige entregar copia de la licencia (§4). NIDO no lo redistribuye: la app lo descarga del repositorio de Liquid AI |

**Texto de Wikipedia (CC BY-SA 4.0).** La app *sí* lleva texto de Wikipedia:
300 introducciones de artículos dentro del APK (`assets/corpus/corpus.json`),
además de los paquetes opcionales que se descargan (`corpus-standard`,
`corpus-full`, `wiki-vital5`, `wiki-vital5-e5`). Texto de los colaboradores
de Wikipedia, https://www.wikipedia.org, con licencia Creative Commons
Atribución-CompartirIgual 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).
Cada entrada conserva la URL de su artículo. Los paquetes compilados por NIDO
se comparten con la misma licencia CC BY-SA 4.0 (por el «compartir igual» no
pueden ser MIT): si los compartes o adaptas, da crédito a **NIDO** (como
compilador) y a **Wikipedia**, enlaza la licencia, indica qué cambiaste y
mantén CC BY-SA 4.0. El aviso va también dentro de cada paquete (tabla
`meta`), en `assets/packs/ATTRIBUTION.txt` y en los archivos
`LICENSE-ATTRIBUTION.txt` / `ATTRIBUTION.txt` de los releases. NIDO no está
afiliado a la Fundación Wikimedia ni cuenta con su respaldo.

**Software de terceros.** Los paquetes npm que se compilan dentro de la app y
los textos de sus licencias están en
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md), y la misma lista se puede
leer dentro de la app (Acerca de → Licencias).

## Adaptado de las entradas de la bounty poidh #31 (2026-10-31)

Ideas y algoritmos adaptados — reimplementados en el TypeScript propio
de NIDO, sin código copiado literal — de la entrada ganadora y las
finalistas de la bounty poidh #31 («Build the Best Offline AI Research
App for Android»), reunidos con sus licencias verificadas en la fuente:

| Qué | Origen | Licencia | Dónde vive en NIDO |
|---|---|---|---|
| Post-chequeo de citas: las cifras de una respuesta tienen que salir de la evidencia, con su redondeo y escala honestos («16,4 millones» por 16.431.599) | Commonplace de 0xPD33 (`citations.rs`, `evidence.rs`) | Apache-2.0 | `src/rag/evidenceNumbers.ts`, usado por `src/rag/grounding.ts` |
| Evidencia primero: la tarjeta de la fuente principal, con su frase que mejor responde, encima de la respuesta; un color por fuente compartido por sus marcadores de cita | Commonplace de 0xPD33 (`AnswerViews.kt`, `evidence.rs`) | Apache-2.0 | `src/rag/evidenceCard.ts`, `src/ui/components/EvidenceFirstCard.tsx`, `src/ui/components/sourceColors.ts` |

## ¿Usas código de NIDO? Conserva el aviso

NIDO tiene licencia MIT. Puedes usarlo, copiarlo, modificarlo y distribuirlo.
La única condición de la licencia MIT es incluir el aviso de copyright y el
aviso de permiso en todas las copias o partes sustanciales:

> Copyright (c) 2026 NIDO contributors

En la práctica: conserva el archivo `LICENSE` (que también lleva el aviso de
BOAR, "Copyright (c) 2026 aoair contributors") y los encabezados de cada
archivo.

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
como "Basado en [NIDO](https://github.com/Nido007-cmyk/Nido)" no lo exige la
licencia, pero lo agradecen quienes lo construyeron.
