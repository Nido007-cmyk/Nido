> **Idioma:** [English](../../visual/NIDO_3D_MOTION_SPEC.md) · Español

# NIDO 3D Motion Spec — v2.0

**Fecha:** 2026-09-27
**Normativa:** `NIDO_3D_VISUAL_SYSTEM.md` §6 + `NIDO_3D_Character_Design_System_v2.pdf` (§6–7).
**Estado:** especificación; ningún clip de motion existe todavía (PENDIENTE).

---

## 1. Principios

- Solo estado operativo visible; **nunca** representar razonamiento interno.
- El núcleo puede anticipar un cambio de estado **80–150 ms antes** del cuerpo.
- Evitar loops inquietos que sugieran que el agente está "observando" al usuario.
- En Error: preocupación ligera; nunca terror o culpa.
- En Hablando: boca animada simple; evitar lip-sync humano hiperrealista.

## 2. Tiempos normativos

| Tipo | Duración |
|---|---|
| Idle (respiración casi imperceptible) | loop 2–5 s |
| Transiciones de estado | 180–450 ms |
| Acciones expresivas | 500–1200 ms |
| Anticipación del núcleo | 80–150 ms antes del cuerpo |

## 3. Los 8 estados

| Estado | Cuerpo / rostro | Núcleo | Brote | Notas |
|---|---|---|---|---|
| **Idle** | respiración mínima | estable | reposo | loop 2–5 s, casi imperceptible |
| **Escuchando** | ligera inclinación | frío/suave | — | sin gestos exagerados |
| **Pensando** | mirada/pose contenida | pulso lento | reposo | pausa activa |
| **Trabajando** | movimiento deliberado | pulso o flujo alrededor del núcleo | reposo | actividad contenida |
| **Hablando** | boca animada simple | estable | — | sin lip-sync hiperrealista |
| **Completado** | micro-celebración breve | cálido | erguido | 500–1200 ms, luego vuelve a Idle |
| **Sin conexión** | sereno, atenuado | tenue o apagado | caído suave | digno, no "muerto"; lo local sigue disponible |
| **Error** | contracción mínima, tono sobrio | tenue, sin parpadeo alarmante | reposo | sin alarmismo |

**9.º estado operativo de app** (`waiting for approval`, de v0.3): pausa expectante
dirigida al usuario — postura expectante + pulso lento del núcleo. Se implementa
reutilizando rigs existentes, no como expresión nueva.

## 4. Reduced Motion

- Eliminar bounce, flotación y parallax.
- Conservar cambios discretos de luz/pose.
- Los estados se comunican por forma/color estático.
- Cada estado debe tener alternativa estática aprobada.

## 5. Prohibiciones

- Loops de idle inquietos o con micro-movimientos de "vigilancia".
- Terror, culpa o alarmismo en Error.
- Lip-sync humano hiperrealista.
- Representar razonamiento interno (chain-of-thought) de ninguna forma.
- Usar motion para sugerir autoridad, verificación o niveles de confianza.

## 6. Entregables de motion (todos PENDIENTES)

- Especificación de rig / shape keys (`nido_rig_spec_v01`).
- 8 clips de motion, uno por estado (`nido_motion_<estado>_v01`).
- Transiciones entre estados (180–450 ms).
- Variantes Reduced Motion por estado.
- QA sheet de motion con PASS/FAIL contra este documento.
