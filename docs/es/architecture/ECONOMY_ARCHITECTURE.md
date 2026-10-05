> **Idioma:** [English](../../architecture/ECONOMY_ARCHITECTURE.md) · Español

# Arquitectura de economía de NIDO — Especificación a nivel de app

**Estado:** SOLO ESPECIFICACIÓN (2026-09-27). Cero implementación. Sin balances,
sin código de ledger, sin monetización, sin integración de pagos, sin token, sin
blockchain.
**Subordinada a:** `docs/NIDO_PRINCIPLES.md` (en caso de conflicto, ganan los
principios) y la línea de investigación en `docs/economic/`
(`ECONOMIC_ARCHITECTURE.md`, `ECONOMIC_POLICY_MODEL.md`, `SETTLEMENT_ABSTRACTION.md`,
`ECONOMIC_PRIVACY.md`, `ECONOMIC_REDTEAM.md`).

**Etiquetas de decisión** (las mismas que en los docs de investigación):
- **[FROZEN PRINCIPLES]** — no negociable sin revisión explícita del usuario.
- **[PROVISIONAL]** — decisión de diseño actual, revisable con evidencia.
- **[EXPERIMENTAL]** — hipótesis por validar; nada aguas abajo puede asumirla.
- **[OPEN QUESTIONS]** — sin decidir; registrado para investigación futura.

**Alcance de este documento:** la economía *de producto* dentro de la app NIDO —
monedas, recompensas, sumideros/fuentes, inventario, progresión, límites — como
diseño orientado al usuario. La economía *de protocolo* (liquidación agente-a-agente)
se especifica en `docs/economic/`; este documento debe mantenerse consistente con ella.

---

## 1. Para qué sirve la economía

**[FROZEN PRINCIPLES]** La economía es una **capa opcional**. NIDO funciona por
completo sin ella: ninguna capacidad, flujo de protocolo ni decisión de política
puede depender de que la economía exista. Un NIDO con la economía desactivada es
un NIDO completo, no uno degradado. **CAPABILITY IS THE ECONOMIC PRIMITIVE** —
lo único que puede intercambiarse alguna vez es la ejecución de capacidades
versionadas, nunca la autoridad, los datos o la identidad del usuario.

**[FROZEN PRINCIPLES]** USER = AUTHORITY aplica al valor exactamente igual que a
los datos. El modelo puede **proponer**; el **Policy Engine decide** si está
permitido; el **usuario sigue siendo la autoridad**. Ningún flujo económico mueve
valor sin una decisión de política trazable o una confirmación explícita del usuario.

Propósito de producto (por qué una economía): dar a la progresión a largo plazo,
los desbloqueos de personalización y (más adelante, opcionalmente) el intercambio
agente-a-agente un marco coherente y legible — sin convertirse jamás en
pago-por-funcionar.

---

## 2. Monedas (spec)

**[PROVISIONAL]** Diseño de moneda de dos niveles, ambas **puramente locales**
en esta spec (sin red, sin cadena, sin rieles fiat — los rieles son trabajo
futuro según `docs/economic/SETTLEMENT_ABSTRACTION.md`):

| Moneda | Unidad (prov.) | Naturaleza | Se gana con | Se gasta en |
|---|---|---|---|---|
| **Spark** (participación) | `spark` | Suave, oferta infinita, no transferible, por dispositivo | usar NIDO: tareas completadas, rutinas, hitos | desbloqueos cosméticos/personalización, capas de avatar, temas |
| **Core** (capacidad) | `core` | Dura, escasa, no transferible, por dispositivo | logros significativos, rachas, retos comunitarios (futuro) | ventajas adyacentes a capacidad: programación prioritaria de cómputo, ranuras extra de modelos locales, funciones avanzadas |

**[FROZEN PRINCIPLES]**
- Ninguna moneda es comprable con dinero real en esta spec. Sin IAP, sin anuncios,
  sin muros de pago en la función central. La monetización está **fuera de alcance**
  para este diseño.
- Ninguna moneda sale del dispositivo. Sin transferencias, sin intercambio, sin
  exportación — hasta que se especifique un riel de liquidación (futuro; decisión
  separada), si es que se especifica.
- Los balances **no** son identidad y **no** son reputación: nunca aparecen en el
  descubrimiento P2P, nunca influyen en decisiones de política, nunca bloquean
  capacidades.

**[OPEN QUESTIONS]** Nombres/símbolos finales; si hacen falta dos niveles o basta
uno; tasa de cambio (si la hay) entre niveles — actualmente: ninguna.

---

## 3. Fuentes (cómo entra el valor)

**[PROVISIONAL]** Todas las fuentes son locales, verificables en el dispositivo e
idempotentes (cada concesión lleva un id único; re-conceder el mismo id es un no-op):

| Fuente | Moneda | Disparador (spec) | Notas |
|---|---|---|---|
| Completar tareas | spark | la tarea del agente alcanza el estado terminal `completed` | el monto escala con la clase de esfuerzo de la tarea, no con el tiempo de reloj |
| Rachas de rutinas | spark | la rutina completa N ejecuciones programadas consecutivas | con tope (ver §6) |
| Hitos | spark + core | logros de primera vez (primer emparejamiento P2P, primera semana offline, etc.) | una sola vez cada uno, enumerados en un registro de hitos |
| Participación diaria | spark | primera interacción significativa del día | pequeño, tope anti-grind |
| Contribución de conocimiento | spark | el usuario añade documentos personales / entradas de corpus | premia la curaduría, no el volumen |
| Comunidad (futuro) | core | retos opt-in | NO en el alcance de v1 |

**[FROZEN PRINCIPLES]** Ninguna fuente puede premiar: compartir datos privados,
debilitar la postura de seguridad, conceder permisos o mantener la app en línea.
La economía nunca debe incentivar en contra de la privacidad o la seguridad del usuario.

---

## 4. Sumideros (cómo sale el valor)

**[PROVISIONAL]** Todos los sumideros son cosméticos, expresivos o de
conveniencia — nunca puertas funcionales:

| Sumidero | Moneda | Qué compra (spec) |
|---|---|---|
| Capas/presets de avatar | spark | estilos de manto, variantes de brote, accesorios, colores de brillo del núcleo (del manifiesto de assets aprobado) |
| Temas | spark | temas de UI, paletas de acento |
| Expresión de perfil | spark | placas de nombre, florituras de estado (nunca señales de identidad) |
| Conveniencia | core | ranuras extra de modelos locales, programación prioritaria de inferencia, cuota mayor de corpus personal |
| Regalos (futuro) | — | explícitamente FUERA de alcance hasta que existan rieles de liquidación |

**[FROZEN PRINCIPLES]** Ningún sumidero puede comprar: capacidades, permisos,
excepciones de política, degradaciones de seguridad ni visibilidad sobre otro
NIDO. El gasto siempre lo inicia el usuario y es explícito; el agente puede
sugerir, nunca gastar de forma autónoma (gastar = efecto lateral → necesita
decisión de política o confirmación del usuario según `ECONOMIC_POLICY_MODEL.md`).

---

## 5. Inventario

**[PROVISIONAL]** Inventario = el conjunto de titularidades no consumibles poseídas:

```ts
// Spec sketch — not code.
interface InventoryItem {
  id: string;                 // e.g. "mantle.olive", "theme.midnight"
  kind: "avatar-layer" | "avatar-preset" | "theme" | "convenience" | "title";
  acquiredAt: string;         // ISO timestamp
  source: "purchase" | "milestone" | "reward" | "default";
  cost?: { currency: "spark" | "core"; amount: number };
  // Cosmetic items are pure data referencing the 3D asset manifest ids
  // (see docs/architecture/3D_INTEGRATION_CONTRACT.md §2.3).
  assetRef?: string;
}
interface Inventory { items: InventoryItem[]; schema: "nido.inventory/v1"; }
```

Reglas:
- El inventario vive en el almacén local cifrado (misma clase de protección que
  ajustes/memoria — ver `docs/architecture/DATA_MODEL.md`).
- La titularidad es por dispositivo y por usuario; exportación/importación solo
  vía el flujo explícito de backup del usuario (futuro), nunca automática.
- Los títulos/logros son solo de exhibición; no conllevan privilegios.

---

## 6. Progresión

**[PROVISIONAL]** La progresión trata sobre la *relación* con NIDO, no sobre poder:

- **Niveles (spec):** una sola pista de progresión suave (p. ej. "nivel Spark")
  calculada desde el spark total ganado en la vida. Puramente expresiva —
  desbloquea cosméticos antes, nunca capacidades.
- **Hitos:** registro enumerado (id, condición, recompensa única). Las
  condiciones referencian solo eventos locales (tareas completadas, rachas,
  funciones probadas). El registro es datos, editable sin cambios de código.
- **Sin tablas de clasificación, sin comparación social, sin presión
  competitiva** en el alcance de v1. (Todo lo social es trabajo futuro con su
  propia revisión de privacidad.)

---

## 7. Límites y anti-abuso

**[PROVISIONAL]**

| Límite | Spec |
|---|---|
| Topes de ganancia | topes diarios/semanales por fuente; tope diario global de spark |
| Idempotencia | cada concesión tiene un id único; la doble concesión es imposible por construcción |
| Sin farming | las fuentes requieren completar tareas genuinas (solo estados terminales); las fuentes basadas en tiempo tienen cooldowns |
| Cotas de balance | los balances son enteros, ≥ 0, con un tope máximo (desbordamiento → topado, registrado) |
| Auditoría | cada concesión/gasto es una entrada de ledger local solo-append: `{ id, ts, kind, amount, reason, policyRef? }`. El ledger es inspeccionable por el usuario (Ajustes → Economía → Historial) y no contiene chain-of-thought ni contenido privado |
| Evidencia de manipulación | las entradas del ledger se encadenan por hash localmente (spec; algoritmo TBD, cripto-ágil según principios) — la edición casual de la DB es detectable, no aceptada en silencio |

**[FROZEN PRINCIPLES]** El ledger es local-first y privado. Nunca se transmite
excepto bajo dirección explícita del usuario, y nunca para liquidar nada hasta
que exista un riel y el usuario autorice ese riel.

---

## 8. Superficies de UI (spec)

- **Ajustes → Economía** (pantalla futura): balances, inventario, historial del
  ledger, explicación de las reglas de ganancia y el interruptor maestro de
  **economía on/off**. Desactivada = toda la capa queda inerte (sin
  concesiones, sin sumideros, UI oculta).
- **Momentos de recompensa:** confirmaciones pequeñas y no intrusivas (un toast,
  nunca un modal) al completar hitos. Respeta los ajustes de notificaciones.
- **Tienda/galería (futuro):** desbloqueos cosméticos enumerados desde datos
  (manifiesto de assets + registro de temas), precios en spark/core, compra =
  acción explícita del usuario → chequeo de política → entrada de ledger →
  actualización de inventario.
- Todas las cadenas de UI de economía son claves i18n desde el día uno
  (ver `docs/architecture/I18N_ARCHITECTURE.md`).

---

## 9. Relación con los docs de investigación

| Esta spec | `docs/economic/*` |
|---|---|
| spark/core, inventario, progresión, límites | la superficie *de producto* |
| "sin rieles aún" | `SETTLEMENT_ABSTRACTION.md` define cómo se conectan los rieles después |
| el usuario confirma / la política decide | `ECONOMIC_POLICY_MODEL.md` |
| el ledger es local y privado | `ECONOMIC_PRIVACY.md` |
| topes, idempotencia, anti-farming | modelos de amenaza de `ECONOMIC_REDTEAM.md` |

Si la economía a nivel de protocolo se activa alguna vez (agente-a-agente),
reutiliza las mismas primitivas (descriptores de capacidad, ids de pago,
liquidación at-most-once) — las monedas de la capa de app de arriba siguen
siendo solo locales a menos que una decisión futura y explícita del usuario las
puentee.

## 10. Preguntas abiertas (deben resolverse antes de cualquier implementación)

1. ¿Una moneda o dos? (Solo Spark en v1 es la hipótesis más simple.)
2. Montos y topes exactos de ganancia — necesita juicio de producto, no solo spec.
3. ¿Crea `core` una psicología de escasez poco sana? Considerar eliminarlo.
4. Contenidos del registro de hitos (la lista real de logros).
5. Algoritmo de encadenado por hash del ledger (cripto-agilidad: versionado desde el inicio).
6. Si la economía se envía activada por defecto u opt-in en el primer arranque.
7. Interacción con multi-dispositivo (los balances son por dispositivo en esta
   spec — ¿es aceptable a largo plazo?).
