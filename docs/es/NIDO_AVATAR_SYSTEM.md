> **Idioma:** [English](../NIDO_AVATAR_SYSTEM.md) · Español

# NIDO Avatar System — Personal NIDO

> **ESTADO: SUPERSEDED FOR CHARACTER DESIGN (2026-09-27).**
> El sistema de personajes 3D ahora se rige por
> `docs/visual/NIDO_3D_VISUAL_SYSTEM.md` (source of truth:
> `docs/visual/NIDO_3D_Character_Design_System_v2.pdf`, v2.0).
> Este documento se conserva como historia (v0.3). Los tiers de privacidad
> LOCAL/CONTACT/PUBLIC y las reglas asociadas siguen vigentes según la migración
> (`docs/visual/VISUAL_MIGRATION_REPORT.md`).

**Versión:** v0.3 — SUPERSEDED FOR CHARACTER DESIGN (dirección oficial en desarrollo — NO asset final de producción)
**Estado:** Propuesta de diseño para revisión y aprobación visual de Arsrs.
**Source of truth:** `docs/visual/nido-brand-guide.jpg` (guía completa de 10 secciones).
**Compañero:** `NIDO_VISUAL_IDENTITY_SYSTEM.md` (ADN, envelope, Brand Mark, estados,
NIDO↔NIDO, privacidad, originality). Este documento especifica el *sistema de
personalización y expresión*: parámetros, expresiones, tamaños, renderizado NIDO↔NIDO,
accesibilidad y reglas de privacidad del avatar.
**Regla:** el avatar es expresión. Las claves son identidad. La política es autoridad.
Nunca mezclarlos.
**Estilo de render:** 3D suave tipo peluche COMO LA FOTO de la guía (ver Identity System
§1.1). No ilustración plana.

---

## 1. Anatomía del Personal NIDO (parámetros)

Todo Personal NIDO se construye sobre el personaje base (§1 del Identity System)
mediante estos parámetros. Los límites vienen del personalization envelope.

| Parámetro | Rango | Notas |
|---|---|---|
| `body.tint` | `#F8F4E9` · `#EDE4D6` · `#D9C8B7` (+ extensiones aprobadas) | tono base del cuerpo; siempre mate y táctil |
| `body.material` | peluche suave / mate / cerámico / tejido | render 3D táctil como la foto; nunca metálico agresivo ni translúcido total |
| `sprout.leaves` | 1–3 | el brote siempre legible en silueta; formas y colores por capa (guía §8) |
| `sprout.angle` | ±30° | |
| `sprout.size` | 10–20% de la altura | |
| `mantle.style` | liso / tejido / estructurado / ligero / resistente / refinado | siempre parcial y asimétrico; estilos y accesorios por capa (guía §8) |
| `mantle.tint` | verdes `#6B7158` `#8FA47A` `#A7BC9A` · otros `#6C7EE7` `#FFA25B` `#F4A2C1` `#7AC0E0` | nunca cubre rostro ni núcleo por completo |
| `core.glow` | `#FFD27A` cálido (defecto) · `#8CE0FF` · `#A78BFA` · `#FFBEC6` | anillo luminoso; simbólico; nunca medidor |
| `face.style` | ojos ovales / ojos+boca mínima tenue | máximo 2 elementos expresivos base |
| `accessory` | 0–1 dominante | gafas, audífonos, gorras (guía §8); nunca sobre el núcleo |
| `theme` | estacional / evento: naturaleza, espacio, tech… (FREE, guía §8) | no altera FIXED |

`name` y pronombres son texto libre asociado (no afectan la forma).

---

## 2. Las 12 personalidades (referencia)

Definidas en el Identity System §2: Minimalista, Profesional, Creativo, Deportivo,
Naturaleza, Futurista, Elegante, Divertido, Aventurero, Técnico, Tranquilo,
Personalizado. Cada una es un preset de los parámetros del §1; el usuario parte de un
preset y lo ajusta dentro del envelope.

---

## 3. Expresiones (set cerrado)

El rostro es extremadamente simple (ojos ovales + sonrisa tenue, como la foto).
La guía de marca (§6) ilustra 8 expresiones renderizadas en 3D: Idle, Escuchando,
Pensando, Trabajando, Hablando, Completado, Sin conexión, Error. Expresiones permitidas
(ojos + boca mínima):

- neutral · happy · curious · focused · sleepy · proud · shy · determined

Reglas:

- Ninguna expresión altera la geometría FIXED.
- A tamaños ≤ 48px el rostro puede desaparecer; la expresión la porta la postura +
  el núcleo (ver §5).
- Prohibido: cejas humanas detalladas, dientes, lengua, lágrimas realistas.

---

## 4. Tamaños y degradación

| Tamaño | Qué se muestra |
|---|---|
| 16px | silueta + brote |
| 24px | silueta + brote + manto sugerido |
| 48px | personaje simplificado (manto + núcleo anillo + rostro opcional) |
| profile | medio cuerpo: rostro + manto + núcleo |
| full | detalle total |

**Orden de degradación** (qué se pierde primero al reducir): accesorios → textura →
rostro → detalle del núcleo (queda anillo/punto) → **la silueta y el brote nunca se pierden.**

---

## 5. Estados operativos → expresión

Mapeo de los 9 estados (§5 del Identity System) a expresión visual.
Solo estado operativo visible; **nunca chain-of-thought.**

| Estado | Rostro/postura | Núcleo | Brote |
|---|---|---|---|
| idle | neutral, respiración sutil | glow tenue estable | reposo |
| listening | curious, leve inclinación | pulso suave | levemente erguido |
| planning | focused, mirada al frente | estable | reposo |
| working locally | focused, ritmo contenido | variación rítmica suave | reposo |
| communicating | happy/curious hacia el otro NIDO | pulso de enlace *entre* ambos | orientado al otro |
| waiting approval | shy/neutral hacia el usuario | pulso expectante lento | leve inclinación al usuario |
| completed | happy, asentimiento mínimo | glow cálido breve | erguido |
| offline | sleepy/neutral, atenuado | apagado o tenue | caído suave |
| error | neutral sobrio, contracción mínima | tenue, sin parpadeo alarmante | reposo |

Nota: el enlace visual entre dos NIDO **no prueba identidad**. La UI muestra
"Identity verified" por separado y solo cuando corresponde criptográficamente.

---

## 6. NIDO ↔ NIDO y grupos (renderizado)

- **1:1:** ambos personajes a medio cuerpo, orientados entre sí; enlace visual tenue
  entre núcleos. Etiqueta de UI (fuera del avatar): nombre del contacto + estado de
  verificación solo si verificado.
- **Sin verificación:** enlace neutro o ausente; jamás candado/check dentro del avatar.
- **Grupo 3–5:** fila compacta con solapamiento parcial; cada uno conserva brote visible.
- **Grupo 6+:** abstracción a círculos/núcleos; sin rostros individuales.

---

## 7. Niveles de avatar (privacidad)

| Nivel | Contenido | Dónde vive |
|---|---|---|
| LOCAL | Personal NIDO completo y detallado | solo en el dispositivo |
| CONTACT | versión simplificada elegida por el usuario (sin elementos FREE) | la elige el usuario por contacto |
| PUBLIC | mínimo: silueta + brote (o Brand Mark) | contextos públicos/desconocidos |

Reglas normativas:

1. El avatar nunca es identificador de protocolo.
2. Nada de información personal sensible ni metadata innecesaria en assets compartidos.
3. Los niveles CONTACT y PUBLIC se generan por **exportación explícita** del nivel
   elegido; nunca por filtración del LOCAL.
4. El usuario puede tener un LOCAL muy detallado sin obligación de compartirlo.
5. La verificación de identidad ("Identity verified") es UI separada, no parte del avatar.

---

## 8. Accesibilidad

- Cada estado tiene etiqueta de texto accesible (cuando se implemente en app).
- Contraste rostro/núcleo verificado en light y dark.
- `prefers-reduced-motion`: estados por forma/color estático.
- El avatar nunca es el único portador de información crítica.

---

## 9. Checklist de aprobación (para Arsrs)

- [ ] Personaje base (front/side/back/silueta) conserva la identidad de la referencia.
- [ ] El brote funciona como distintivo en silueta y a 16px.
- [ ] El manto se lee como protección/refugio, no como ropa casual.
- [ ] El núcleo se entiende como simbólico, sin lectura de "medidor".
- [ ] Las 12 personalidades se sienten familia sin ser idénticas.
- [ ] El envelope FIXED/BOUNDED/FREE/FORBIDDEN es claro y aplicable.
- [ ] Los 9 estados se distinguen a 48px.
- [ ] NIDO↔NIDO no sugiere verificación por sí mismo.
- [ ] Los tres niveles de avatar tienen sentido y son controlables.
- [ ] El Brand Mark funciona solo, a 16px y en monocromo.
- [ ] Originality: claramente NIDO, sin ecos de Muse/Meta ni mascotas ajenas.

**Diseño únicamente. Sin implementación en la app hasta aprobación visual.**
