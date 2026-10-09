# Diseño N3: Briefing diario resiliente

**Fecha:** 2026-10-09
**Estado:** Diseño (no implementado)
**Severidad original:** LOW

## Problema

`refreshBriefingNotification` programa un trigger one-shot para las 8:00 del día siguiente, solo cuando la app abre (`runStartupRoutines`). Si el usuario no abre la app por 3 días, no hay briefing esos días.

## Diseño propuesto

### Opción A: Trigger diario repetitivo (recomendado)

Usar `SchedulableTriggerInputTypes.DAILY` con hora 8:00:

```typescript
await Notifications.scheduleNotificationAsync({
  content: { title, body: await buildBriefingBody() },
  trigger: { type: SchedulableTriggerInputTypes.DAILY, hour: 8, minute: 0 },
});
```

**Ventajas:**
- El SO lo dispara aunque la app no abra
- Simple, una sola programación

**Desventajas:**
- El contenido se congela al momento de programar (no se refresca diario)
- Necesita re-programar para actualizar el cuerpo

### Opción B: Híbrido (recomendado final)

1. Programar trigger DAILY a las 8:00
2. En `runStartupRoutines`, si el trigger existe, cancelar y re-programar con contenido fresco
3. El cuerpo se genera con datos del día anterior (el briefing es "ayer + hoy")

**Contenido del briefing:**
- Recordatorios vencidos
- Eventos del calendario (si hay)
- Resumen de memoria (nuevos datos)

### Consideraciones

- **Batería:** un trigger diario es barato (el SO lo maneja)
- **Privacidad:** el contenido se genera on-device, no sale
- **Idioma:** usar el idioma actual del usuario

### Tests necesarios

1. El trigger se programa con tipo DAILY
2. El contenido incluye recordatorios vencidos
3. Re-programar no duplica notificaciones
4. Funciona sin abrir la app por N días (test de integración)

### Estimación

- Implementación: 3-4 horas
- Tests: 2 horas
- Riesgo: BAJO

## Decisión

Implementar Opción B cuando se priorice. No es bloqueante para el APK público.
