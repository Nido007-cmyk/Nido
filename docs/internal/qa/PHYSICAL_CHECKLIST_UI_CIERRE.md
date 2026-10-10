# Checklist de Prueba Física — Galaxy Tab A9+
## Build: a85dc90 (UI-CIERRE) — 2026-10-09

### ⚠️ Antes de empezar
- Este build incluye cambios de UI. Si tienes datos importantes en la versión
  anterior, haz backup primero (Ajustes → Backup → Crear backup).
- Instalación limpia recomendada para esta validación.

### Instalación
- [ ] Desinstalar versión anterior (o instalar limpio)
- [ ] Instalar APK, verificar que abre sin crash

### Onboarding
- [ ] Wizard de 4 pasos visible y legible
- [ ] Textos en español correctos (o inglés según selección)

### Modelos
- [ ] Descarga de modelo muestra progreso
- [ ] Modelo se carga correctamente
- [ ] Cambio entre modelos funciona

### Chat y herramientas
- [ ] Chat responde con modelo local
- [ ] Botón de micrófono (STT) funciona
- [ ] **NUEVO:** Switch "Lectura en voz alta" en ajustes de voz lee respuestas

### Memoria
- [ ] Ver/borrar memorias funciona
- [ ] Switches de memoria persisten tras reinicio

### Knowledge y RAG
- [ ] Importar documento funciona
- [ ] Preguntas usan el documento (citas visibles)

### Recordatorios
- [ ] Crear recordatorio vía chat
- [ ] Alarma del sistema se dispara

### Backup
- [ ] Crear backup (textos en español correctos)
- [ ] Compartir backup funciona
- [ ] Restaurar backup pide confirmación + biométrico

### Idiomas
- [ ] Cambiar a inglés: backup/restore en inglés
- [ ] Cambiar a portugués: verificar

### Ajustes
- [ ] Todos los switches persisten tras cerrar y reabrir
- [ ] Apagar y encender: preferencias conservadas

### P2P (requiere 2 dispositivos)
- [ ] Ver contactos Bluetooth
- [ ] Emparejar vía código
- [ ] Enviar mensaje cifrado
- [ ] Recibir mensaje
- [ ] Proponer negociación / aceptar / rechazar
- [ ] Revocar contacto (pide confirmación)
- [ ] **NUEVO:** Simular store corrupto → banner visible, P2P bloqueado

### Revocación y recuperación
- [ ] Revocar → contacto desaparece de lista
- [ ] Intentar conectar a revocado → bloqueado

### Reinicio y offline
- [ ] Cerrar app completamente y reabrir: todo funciona
- [ ] Modo avión: chat local, memoria, knowledge funcionan
- [ ] Apagar pantalla 60s: reconexión P2P al volver

---

## Funciones por estado

### ✅ Terminadas (probar a fondo)
Chat, memoria, knowledge/RAG, recordatorios, STT, TTS, backup/restore,
modelos, idiomas, ajustes, P2P core, negociación, revocación.

### 🧪 Experimentales (identificadas, no probar como final)
- Delegación NIDO↔NIDO (flag OFF por defecto)
- Approval Inbox de propuestas (no implementado; NegotiationCard es la UI real)

### ❌ No disponibles
- Edición de memorias (solo ver/borrar)
- Tareas programadas autónomas
- Pantalla de estadísticas standalone
