> **Idioma:** [English](../../architecture/FEATURE_MAP.md) · Español

# Mapa de funcionalidades — app NIDO (pantalla por pantalla)

**Estado:** AUDITADO 2026-09-27 (auditoría de solo lectura del código real).
**Método:** cada pantalla/componente bajo `src/ui/` + `App.tsx` leído y
clasificado contra su código de respaldo real. Ninguna funcionalidad se lista
como operativa a menos que el código muestre lógica de respaldo real.
**Leyenda:** BUILT = totalmente funcional contra servicios reales · PARTIAL =
funciona pero con piezas faltantes/rotas identificadas · MOCK = renderiza pero
respaldada por controles falsos o no funcionales · NOT BUILT = referenciada pero
no implementada · DEAD = implementada pero inalcanzable desde cualquier ruta de
navegación.

**Modelo de navegación:** sin React Navigation — una máquina de estados manual.
`App.tsx`: `checking` → `locked` (puerta biométrica/PIN) → `required-setup` |
`chat`. ChatScreen es el hub; ajustes/about/telemetría/NIDO se renderizan como
reemplazos de pantalla completa vía flags booleanos (sin historial de pila). El
Drawer es un overlay `Animated` personalizado.

---

## 1. App shell y onboarding

| Pantalla | Propósito | Estado | Evidencia / notas |
|---|---|---|---|
| Raíz de App + LockScreen (`App.tsx`) | Puerta biométrica/PIN, enrutamiento required-setup vs chat | BUILT | `ensureUnlocked` (l.38–108); gating vía `ModelManager.requiredModelsPresent()`; 0 cadenas codificadas |
| SetupWizardScreen | Obligatorio de 4 pasos en primer arranque: escaneo de hardware → selección de nivel → descargas de modelos → indexación offline | BUILT | Sondeo real de RAM/disco, descargas reanudables, carga de embeddings + siembra de KB; 1 codificada: título héroe "el proyecto original" |
| ModelSetupScreen (`mode="required"`) | UI de descarga de modelos en primer arranque | BUILT | `downloadManager` real + `llamaEngine.load()`; 0 codificadas |

## 2. Chat (núcleo)

| Pantalla / componente | Propósito | Estado | Evidencia / notas |
|---|---|---|---|
| ChatScreen | Chat principal: inferencia streaming, RAG, sesiones, feedback, TTS, deep research, enrutamiento adaptativo, bucle de agente | BUILT | `llamaEngine`, `retrieve`/`assemblePrompt`, CRUD de `chatHistory`, `runAgentLoop`, `runAdaptiveChat`, `speakAloud` reales; 75 llamadas `t()`; 1 codificada: etiqueta del drawer `"NIDO"` |
| ChatHeader | Barra superior: drawer, marca, píldora offline, etiqueta de modelo, tono/nuevo-chat, toggle de deep-research, tok/s en vivo | BUILT | Props conectadas; 2 codificadas: "el proyecto original", "tok/s" |
| Drawer | Lista de sesiones + nuevo chat + nav (Prompts, Mis documentos, Ajustes, Telemetría, NIDO, About) + stats de pie | BUILT | Lista real de sesiones; 1 codificada: "el proyecto original" |
| DrawerFooterStats | Barras de RAM/disco en vivo + tok/s de la última consulta | BUILT | Sondea stats nativas reales; se degrada si el módulo no está enlazado; 0 codificadas |
| PromptIdeasCarousel | Carrusel descartable de prompts demo | BUILT | Persiste el descarte; **12 cadenas en inglés codificadas** (no en i18n) |
| ProcessingIndicator | Animación de estado recuperando/pensando/generando | BUILT | Presentacional; 0 codificadas |
| MarkdownMessage | Markdown de chat + bloques de código con copiar/compartir | BUILT | Parseo real + `Share.share`; 2 codificadas: "COPY / SHARE", "✓ SHARED" |
| ReasoningPeek | Ticker colapsable de razonamiento en vivo | BUILT | Timer real + texto peek; 0 codificadas |
| SourceFootnotes | Chips expandibles de citas RAG | BUILT | `RetrievedChunk`s reales; 0 codificadas |
| VoiceInputButton | Mic → dictado vía Android SpeechRecognizer | BUILT | Módulo `VoiceInput` real; ruta honesta no disponible; **2 cadenas de Alert en inglés codificadas** |
| Toast | Toast auto-descartable | BUILT | Dirigido por props; 0 codificadas |

## 3. Modelos y conocimiento

| Pantalla / componente | Propósito | Estado | Evidencia / notas |
|---|---|---|---|
| ModelSetupScreen (`mode="optional"`) | Panel de ajustes: 9 secciones acordeón | BUILT | Descargas/activación/zona de peligro reales; 0 codificadas |
| CatalogItemCard | Fila de modelo/corpus: insignia de compatibilidad, progreso/velocidad/ETA, usar/eliminar | BUILT | Estado real de `downloadManager`; 0 codificadas |
| CorpusSettingsTab | Paquetes de corpus + documentos personales | BUILT | Compone componentes reales; 0 codificadas |
| PersonalDocumentsManager | Importar/listar/alternar/exportar/borrar colecciones de documentos | BUILT | `documentImporter` real; 0 codificadas |
| KnowledgeBaseScreen | Atajo del drawer → PersonalDocumentsManager | BUILT | Wrapper fino; 0 codificadas |
| ModelLoadErrorCard | Diagnostica errores de carga con acciones reintentar/ajustes/asistente | BUILT | `diagnose()` por palabras clave; 1 codificada: etiqueta "ERR_LOCAL_INIT" |

## 4. NIDO P2P (mensajería)

| Pantalla | Propósito | Estado | Evidencia / notas |
|---|---|---|---|
| NidoScreen (tabs: chats/contactos/enlace) | Identidad P2P, emparejamiento QR, contactos, chats cifrados | PARTIAL | **Real:** identidad/huella/código de emparejamiento, render QR en JS puro, contactos + conversación desde `p2p/store` cifrado, envíos encolados vía `messenger.sendChat`. **Roto:** `createPlatformTransport()` → el stub `NativeP2PTransport` lanza error explícito hasta que `modules/nido-p2p` (Kotlin Bluetooth RFCOMM) se compile — descubrimiento/conexión/envío fallan ruidosamente. **Faltante:** *escáner* QR ("Sin cámara todavía", l.412 — pegar código como texto). **i18n:** toda la pantalla evita `t()` — **20 cadenas en español codificadas** |

## 5. Ajustes (9 secciones reales en ModelSetupScreen modo opcional)

| Sección | Componente | Estado | Notas |
|---|---|---|---|
| Tono | PersonalitySettings | BUILT | Presets de estilo de respuesta + prompt personalizado + max tokens + toggles deep-research/adaptativo; todo persistido |
| Modelos | (lista CatalogItemCard) | BUILT | — |
| Base de conocimiento | CorpusSettingsTab | BUILT | — |
| Memoria | MemorySettings | BUILT | Auto-resumen, umbrales, topes, borrar-todo-el-historial |
| Telemetría | UsageStatsContent | BUILT | **16 encabezados en inglés codificados** — no localizados |
| Pantalla y tema | ThemeSelector + toggle háptico | BUILT | Tema/fontScale persistidos; **8 cadenas en inglés codificadas + texto decorativo falso de vista previa "18.4 tok/s • 0ms Cloud Latency • 100% Offline" + typo "for dad & bright glare"** |
| Idioma | LanguageSelector | BUILT | Persistido vía LanguageContext; 1 codificada: encabezado "LANGUAGE" |
| Voz | VoiceSettings | BUILT | Toggle de habilitación + sonda de motor; 0 codificadas |
| Recuperación y zona de peligro | (inline) | BUILT | Relanzamiento del asistente + modal de reset de fábrica → `resetAllAppData()` (**que omite la DB de memoria y las claves — ver TECH_DEBT.md**) |

**Nota de arquitectura de ajustes:** los ajustes se renderizan desde componentes
de sección construidos a mano (aún no un registro). Propuesto: un registro de
ajustes `{ key, type, default, scope, sensitive, ui }` para que los ajustes
nuevos (idiomas, toggle de economía, prefs de avatar) se rendericen sin código
de UI por ajuste — especificado en `DATA_MODEL.md` §2.5. El idioma es
seleccionable en Ajustes (LanguageSelector) Y en el asistente de setup — cumple
con "Ajustes → Idioma".

## 6. Telemetría, evaluación, sistema

| Pantalla | Propósito | Estado | Evidencia / notas |
|---|---|---|---|
| ExecutionTelemetryScreen | Explorar/exportar/borrar telemetría de ejecución persistida; lanza eval | BUILT | Lista/exporta/borra reales; 1 codificada: "🧭 adaptive" |
| EvaluationScreen | Set fijo de eval vs modelos/adaptativo; progreso, resultados, exportación JSONL/CSV; auto-run de eval en dispositivo | BUILT | `evalHarness` real; 0 codificadas |
| AboutScreen | Info estática de la app, versión, tarjetas air-gapped/hardware/benchmark | BUILT | Versión desde `app.json`; 2 codificadas: "el proyecto original", URL del repo |
| UsageStatsContent | Telemetría de hardware: auditoría RAM/12GB, desglose de almacenamiento, stats de inferencia | BUILT (hueco i18n) | Stats nativas reales; 16 cadenas en inglés codificadas |
| UsageStatsScreen | Wrapper de pantalla completa de UsageStatsContent | **DEAD** | Cero referencias; inalcanzable |
| SystemMonitor | Barras RAM/disco vs presupuestos (sondeo 4s) | **DEAD** | Cero referencias; inalcanzable (lógica real, nunca renderizada) |

## 7. Temas

| Pieza | Estado | Notas |
|---|---|---|
| ThemeContext + colores/espaciado/tipografía | BUILT | `themeId` persistido (midnight/amber/frontier) + `fontScale`; `useTheme()` en toda la app |

---

## 8. Conteos resumen

| Estado | Conteo | Ítems |
|---|---|---|
| BUILT | 30 | 10 pantallas (incl. raíz de App + LockScreen) + 20 componentes |
| PARTIAL | 1 | NidoScreen (cripto/emparejamiento/cola P2P reales; stub de transporte BT con fallo explícito; sin escáner QR) |
| MOCK | 0 | Ninguna pantalla falsea datos de respaldo (lo más cercano: el texto decorativo de vista previa de ThemeSelector) |
| NOT BUILT | 0 | Todo lo referenciado en navegación existe |
| DEAD (inalcanzable) | 2 | UsageStatsScreen, SystemMonitor |

**Cero** marcadores TODO/FIXME/stub en `src/ui/` — los huecos se declaran en
comentarios planos (NidoScreen:412, comentarios del transporte p2p).

## 9. Columna de cobertura i18n (resumen)

Totalmente con claves vía `t()`: raíz de App, ChatScreen (75 llamadas),
ModelSetupScreen, SetupWizardScreen (excepto "el proyecto original"), KnowledgeBaseScreen,
ExecutionTelemetryScreen (excepto 1), EvaluationScreen, PersonalDocumentsManager,
CorpusSettingsTab, PersonalitySettings, MemorySettings, VoiceSettings, Drawer
(excepto "el proyecto original"), DrawerFooterStats, ProcessingIndicator, ReasoningPeek,
SourceFootnotes, AccordionSection, CatalogItemCard, Toast.
Huecos: NidoScreen (20 ES, sin `t()` en absoluto), UsageStatsContent (16 EN),
PromptIdeasCarousel (12 EN), ThemeSelector (8+ EN), VoiceInputButton (2 EN),
MarkdownMessage (2 EN), encabezado de LanguageSelector (1), varios de
marca/técnicos ("el proyecto original" ×4 pantallas, "tok/s", "ERR_LOCAL_INIT", "🧭 adaptive").
Notificaciones (`src/notify/notifications.ts`): nombres de canal y títulos en
español codificados ("Recordatorios de NIDO", "NIDO · Recordatorio",
"NIDO · Tu día") — deben pasar a claves.

## 10. Lo que NO está en la app (ausencia confirmada)

- Renderizado de avatar 3D de ningún tipo (sin three.js/filament/GLB; NidoScreen
  es un mensajero de texto) — ver `3D_INTEGRATION_CONTRACT.md`
- *Escáner* de código QR (solo *muestra* QR)
- Pantalla de perfil de usuario / UI de gestión de identidad más allá del
  emparejamiento P2P
- UI de economía de ningún tipo (balances, inventario, ledger) — ver
  `ECONOMY_ARCHITECTURE.md`
- UI de gestión multi-dispositivo
- Backup/exportación de identidad o memoria (solo exportaciones de
  telemetría/colecciones)
- Los 12 presets de personalidad visual (existen solo en docs de diseño; las
  "personalidades" en la app son presets de estilo de respuesta)
