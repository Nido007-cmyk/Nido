# GATE-1 Físico — Checklist para Tablet

**HEAD autorizado:** `2fb01c7`
**Fecha de preparación:** 2026-10-05
**Estado del código:** Verificado (working tree limpio)

---

## ESTADO DEL BUILD

**⚠️ BLOQUEO REPORTADO:** No se pudo generar el APK en este entorno.

**Razón:**
- Sin Android SDK (`ANDROID_HOME` vacío, sin `adb`)
- Sin credenciales de Expo para EAS Cloud Build
- El directorio `android/` existe (prebuild previo) pero no se puede compilar sin SDK

**Opciones para generar el APK:**
1. **EAS Cloud** (recomendado): `npx eas-cli login` + `make build-eas` — requiere cuenta de Expo
2. **Local**: Instalar Android SDK + NDK + JDK, luego `make run-android`
3. **Desde tu máquina**: Si tienes el entorno configurado, haz checkout de `2fb01c7` y compila

**Cuando tengas el APK, registra:**
- [ ] SHA-256 del APK: `_________________________________`
- [ ] Tamaño: `___________ MB`
- [ ] Fecha/hora de generación: `_________________________________`
- [ ] Tipo de build: `___________` (preview/production/debug)

---

## CHECKLIST GATE-1

Marca cada item como: ✅ PASS | ⚠️ ISSUE | 🛑 BLOCKER

### 1. Instalación y primer arranque
- [ ] APK instala correctamente en la tablet
- [ ] Primer arranque sin crash
- [ ] Pantalla de setup inicial aparece
- [ ] No hay pantallas en blanco ni errores visibles

### 2. Onboarding completo
- [ ] SetupWizard: todas las pantallas navegables
- [ ] Textos legibles, sin overflow ni clipping
- [ ] Botones tienen tamaño táctil adecuado (min 44px)
- [ ] Se puede completar el onboarding de principio a fin

### 3. ModelSetup
- [ ] Lista de modelos visible
- [ ] Estados: no descargado / descargando / descargado
- [ ] Botones de acción claros (descargar, eliminar, reintentar)
- [ ] Feedback visual durante descarga

### 4. SetupWizard (si aplica post-instalación)
- [ ] Todos los pasos visibles y navegables
- [ ] Consistencia visual con el resto de la app

### 5. ChatScreen (pantalla principal)
- [ ] **Empty state:** mensaje de bienvenida o prompt visible
- [ ] **Envío:** escribir y enviar un mensaje funciona
- [ ] **Typing/Thinking:** indicador visible mientras genera
- [ ] **Streaming:** texto aparece progresivamente sin lag visual
- [ ] **Usuario vs Asistente:** burbuja usuario a la derecha, asistente full-width a la izquierda (asimétrico)
- [ ] **Mensajes largos:** scroll funciona, sin clipping
- [ ] **STOP:** botón STOP visible durante generación, detiene correctamente
- [ ] **Retry:** tras error, opción de reintentar visible
- [ ] **Teclado:** no tapa el input, la lista hace scroll correctamente

### 6. KeyLossRecovery
- [ ] Pantalla accesible cuando corresponde
- [ ] Advertencias de acción destructiva visualmente claras
- [ ] Botones de confirmación inequívocos
- [ ] No se puede confirmar accidentalmente

### 7. KnowledgeBase
- [ ] Lista de documentos/corpus visible
- [ ] Estados empty/loading/error manejados
- [ ] Acciones claras (añadir, eliminar, ver)

### 8. About
- [ ] Información de versión visible
- [ ] Textos legibles
- [ ] Enlaces o info adicional funcional

### 9. Nido (pantalla principal alternativa)
- [ ] Contenido visible y navegable
- [ ] Consistencia con ChatScreen

### 10. Evaluation
- [ ] Controles visibles y funcionales
- [ ] Resultados legibles

### 11. ExecutionTelemetry
- [ ] Datos visibles sin overflow
- [ ] Scroll funciona si hay mucho contenido

### 12. Superficies adicionales accesibles
- [ ] Drawer: navegación clara, items táctiles
- [ ] Settings: opciones visibles y funcionales
- [ ] Cualquier modal o diálogo: botones claros, se puede cerrar

---

## REVISIÓN VISUAL ESPECÍFICA

Para cada pantalla, verificar:

### Layout
- [ ] Sin clipping (texto cortado)
- [ ] Sin overflow (contenido fuera de pantalla)
- [ ] Alineación consistente
- [ ] Spacing generoso (no apretado)

### Typography
- [ ] Jerarquía clara (títulos > subtítulos > cuerpo)
- [ ] Tamaños legibles en tablet
- [ ] Sin texto demasiado pequeño

### Interacción
- [ ] Botones: tamaño mínimo 44x44px
- [ ] Touch targets no solapados
- [ ] Feedback visual al tocar (ripple, highlight, etc.)
- [ ] Estados disabled visiblemente diferentes

### Contraste
- [ ] Texto legible sobre fondos
- [ ] Botones distinguibles del fondo
- [ ] Estados de error/advertencia con color apropiado

### Consistencia Calm
- [ ] Mismo estilo de cards en todas las pantallas
- [ ] Mismo estilo de botones
- [ ] Mismo estilo de headers
- [ ] Spacing consistente entre pantallas
- [ ] Sin sombras decorativas (solo hairlines)

### Casos especiales
- [ ] **Approvals:** cuando el agente pide aprobación, es visualmente inequívoco (qué se pide, botones claros de aprobar/denegar)
- [ ] **STOP:** durante generación, el botón STOP es prominente y funciona
- [ ] **Errores:** mensajes de error claros, con acción de recuperación
- [ ] **Acciones destructivas:** (borrar datos, etc.) requieren confirmación explícita, no se activan accidentalmente
- [ ] **Offline:** si aplica, el estado offline es visible
- [ ] **Text scaling:** con texto grande del sistema, la UI no se rompe
- [ ] **Contenido largo:** mensajes largos, listas largas, hacen scroll correctamente

---

## REGISTRO DE ISSUES

Para cada problema encontrado:

**Pantalla:** _______________
**Severidad:** 🛑 BLOCKER / ⚠️ ISSUE
**Pasos para reproducir:**
1. _______________
2. _______________
3. _______________

**Comportamiento observado:** _______________
**Comportamiento esperado:** _______________

---

## DESPUÉS DEL GATE-1

- [ ] Todos los items marcados como PASS, ISSUE, o BLOCKER
- [ ] Issues documentados con detalle
- [ ] Si hay BLOCKERs: no continuar hasta resolver
- [ ] Si todo PASS: notificar para regresión final y decisión de push

---

**Nota:** UsageStatsScreen está clasificada como *dead-code candidate* (sin callers). No aparece en este checklist porque no es accesible en la app. No conectarla artificialmente.
