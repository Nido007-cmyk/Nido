> **Idioma:** [English](../../visual/NIDO_3D_VISUAL_SYSTEM.md) · Español

# NIDO 3D Visual System — v2.0

**Versión:** v2.0 (sistema oficial en desarrollo — NO asset final de producción)
**Estado:** Especificación normativa para revisión y aprobación visual de Arsrs.
**Source of truth:** `docs/visual/NIDO_3D_Character_Design_System_v2.pdf`
("NIDO · 3D CHARACTER DESIGN SYSTEM · Guía de construcción, personalización,
animación y QA · v2.0"). La familia 3D renderizada en el PDF define el ADN visual.
**Supersede:** v0.3 queda como **SUPERSEDED FOR CHARACTER DESIGN** (ver
`VISUAL_MIGRATION_REPORT.md`). Se conserva su historia.
**Fecha:** 2026-09-27
**No tocar:** protocolo, criptografía, identidad, Policy Engine, permisos, conformance,
wire formats, domain separators. El diseño nunca acomoda la arquitectura; la
arquitectura no cambia por el diseño.

**Regla no negociable (del PDF):** no volver a sustituir el personaje 3D por una
ilustración plana, ni siquiera para explicar el sistema. Si se necesita un diagrama
(anatomía, proporciones, materiales, rig, capas, estados), se usa un render 3D del
personaje con overlays técnicos: líneas de construcción, medidas y callouts.

---

## 0. Principios permanentes

**ONE FAMILY. MILLIONS OF INDIVIDUALS.** · Tagline: **TU AGENTE. TU MUNDO.**

**Separación de autoridades (de v0.3, intacta):**

- **Avatar = expression.** El personaje expresa estado y personalidad. Nada más.
- **Keys = identity.** La identidad criptográfica vive en las claves, nunca en el dibujo.
- **Policy = authority.** La autoridad vive en el Policy Engine, nunca en el avatar.
- **User = final authority.** El usuario decide.

El núcleo luminoso es **únicamente visual/simbólico** (el espacio privado del usuario).
NO representa clave criptográfica, autoridad, nivel de confianza ni permisos, y nunca
se usa como medidor (barras, porcentajes, semáforos). La seguridad real se muestra por
separado en la UI ("Identity verified" solo cuando corresponde criptográficamente,
fuera del avatar).

**Naming:** NIDO sigue siendo el codename técnico. La identidad visual debe sobrevivir
a un futuro cambio de marca pública (Memini / Amparo / Umbral / Meus / Nidal
congelados — sin ganador).

---

## 1. ADN visual obligatorio

Cinco piezas forman un NIDO reconocible incluso cuando cambia de personalidad.
[Render 3D: vista etiquetada de las 5 piezas — pendiente de producción del BASE_MASTER.]

1. **Cuerpo:** volumen compacto tipo semilla/guijarro, crema, suave y redondeado.
   Cabeza y torso se leen como una sola masa.
2. **Rostro:** dos ojos ovalados oscuros, separados y simples; boca corta y amable;
   rubor muy sutil. Sin nariz obligatoria. Ojos grandes pero no anime.
3. **Brote:** 1–3 hojas orgánicas. Debe parecer vegetal, no antena tecnológica.
4. **Manto:** pieza envolvente de tela suave que cruza el torso. Es la principal
   superficie de personalización. Representa protección, privacidad, refugio y
   control del usuario — no es ropa.
5. **Núcleo:** aro luminoso en el pecho. Comunica identidad, conexión y estado;
   no es un botón genérico.

**Regla de especie:** si se ocultan accesorios, color especial y contexto, el
personaje todavía debe leerse inmediatamente como NIDO por
cuerpo + rostro + brote + manto + núcleo.

---

## 2. Proporciones y modelado 3D

[Render 3D: turnaround con líneas de construcción y medidas — pendiente de producción.]

- Altura base = **1.00H**. Ancho visual aproximado **0.70–0.78H**.
- Evitar extremidades largas o anatomía humana.
- La cara ocupa la zona superior-central; los ojos permanecen grandes pero no anime.
- El núcleo se coloca bajo el centro facial, integrado con el manto.
- Brazos cortos, blandos y pegados al cuerpo; pies pequeños y anchos.
- Silueta estable, amable y ligeramente pesada.
- Vistas mínimas del asset maestro: **frontal, 3/4, lateral, trasera y superior
  ligera**. La parte trasera debe resolver cómo envuelve el manto y cómo nace el brote.
- Topología preparada para deformación suave. No depender de detalles microscópicos
  para que la identidad funcione.

---

## 3. Materiales, luz y render

[Render 3D: hoja de materiales con callouts — pendiente de producción.]

- **Cuerpo:** peluche/fieltro fino crema; microfibra visible solo de cerca;
  roughness alta, specular bajo.
- **Manto:** tela mate más densa; pliegues grandes y suaves; sin plástico brillante.
- **Brote:** hoja orgánica satinada, nervaduras discretas, variación natural.
- **Núcleo:** emissive cálido con halo controlado; conservar detalle del aro,
  nunca quemarlo a blanco.
- **Iluminación:** studio softbox grande, sombras blandas, contraste bajo-medio,
  fondo crema. La forma debe leerse sin contorno negro.

---

## 4. Sistema de personalización (capas L0–L6)

El usuario crea su NIDO sin crear otra especie. Mapeo al envelope v0.3:
L0→FIXED · L1–L5→BOUNDED · L6→FREE · FORBIDDEN se mantiene.

- **L0 — Especie (BLOQUEADA):** cuerpo base, gramática facial, posición del núcleo,
  lógica del brote.
- **L1 — Silueta:** Estándar, Compacto, Alto, Redondo, Cuadrado suave, Flotante;
  siempre dentro de límites de proporción. Ninguna variante puede perder el brote
  en silueta.
- **L2 — Brote:** cantidad (1–3), orientación (±30°), color natural de hojas.
- **L3 — Manto:** color, caída, cuello, pliegues y pequeños acabados. Siempre
  parcial y asimétrico; nunca cubre rostro ni núcleo por completo.
- **L4 — Núcleo:** color dentro de paleta accesible (cálido `#FFD27A` por defecto);
  el aro sigue siendo reconocible. Nunca medidor.
- **L5 — Accesorios:** gafas, gorros, auriculares, goggles, pequeños objetos;
  **máximo 2–3 simultáneos por defecto**; nunca sobre el rostro ni el núcleo.
- **L6 — Tema:** naturaleza, creativo, técnico, deportivo, elegante, futurista, etc.
  El tema modifica capas permitidas, no la especie.

**FORBIDDEN** (de v0.3 + V2): eliminar el brote o hacerlo irreconocible; rostro
humano detallado o hiperrealista; armas; símbolos de autoridad (coronas, insignias
oficiales); iconografía religiosa/política; elementos que sugieran verificación de
identidad (checks, sellos, candados) dentro del avatar; núcleo como medidor; texto
incrustado en el asset; metadata personal sensible en assets compartidos; parecido
deliberado con mascotas de IA existentes.

**Privacidad del editor (V2):** las opciones de personalización no deben revelar
información privada del usuario por defecto.

---

## 5. Personalidades de referencia

Minimalista · Profesional · Creativo · Deportivo · Naturaleza · Futurista ·
Elegante · Divertido · Aventurero · Técnico · Tranquilo · Personalizado.

Son presets, no identidades rígidas. Cada una es una combinación de capas L1–L6;
el usuario parte de un preset y lo ajusta. Ninguna puede romper L0 ni entrar en
FORBIDDEN. [Renders 3D de los 12 presets: ver board del PDF; producción de presets
como datos pendiente.]

---

## 6. Expresiones y estados

Set canónico: **8 estados animables** (ver `NIDO_3D_MOTION_SPEC.md` para la
semántica de movimiento):

1. **Idle** — respiración mínima; núcleo estable.
2. **Escuchando** — ligera inclinación; núcleo frío/suave; sin gestos exagerados.
3. **Pensando** — mirada/pose contenida; pulso lento del núcleo.
4. **Trabajando** — movimiento deliberado; pulso o flujo alrededor del núcleo.
5. **Hablando** — boca animada simple; evitar lip-sync humano hiperrealista.
6. **Completado** — micro-celebración breve; núcleo cálido.
7. **Sin conexión** — estado sereno, no "muerto"; comunica que lo local sigue
   disponible.
8. **Error** — preocupación ligera; nunca terror o culpa.

**9.º estado operativo de app (de v0.3):** `waiting for approval` — pausa expectante
dirigida al usuario. No es una expresión del personaje; se renderiza con una
expresión existente (postura expectante + pulso lento del núcleo).

Reglas del rostro: extremadamente simple (ojos ovales + boca mínima tenue);
prohibido cejas humanas detalladas, dientes, lengua, lágrimas realistas. Solo
estado operativo visible; **nunca** representar razonamiento interno.

---

## 7. NIDO ↔ NIDO y grupos

- Cada personaje mantiene su identidad visual. La conexión se representa **entre
  núcleos** mediante un enlace luminoso temporal; no fusionar cuerpos ni convertir
  el vínculo en una marca de autoridad.
- **La conexión visual nunca demuestra identidad.** La UI muestra por separado,
  solo cuando corresponde criptográficamente, "Identity verified" (texto + icono
  de UI, fuera del avatar). Sin verificación: enlace neutro o ausente; jamás
  candado/check dentro del avatar.
- En grupos: mostrar participantes individuales y estados parciales. Para grupos
  grandes usar avatares compactos derivados del mismo ADN visual.
- [Render 3D: prueba NIDO↔NIDO y grupo — pendiente de producción.]

---

## 8. Uso por tamaño y plataforma

| Contexto | Representación | Regla |
|---|---|---|
| 16–24 px | Marca/silueta simplificada | No intentar renderizar ojos, textura y accesorios completos. |
| 32–64 px | Avatar 3D simplificado | Rostro + brote + manto + núcleo deben sobrevivir. |
| 96 px+ | Personaje 3D | Materiales, expresión y personalización completas. |
| App/desktop | Avatar + estado | No usar la mascota para bloquear contenido funcional. |
| Wearable/auto | Versión compacta | Lectura inmediata, movimiento mínimo. |
| AR/VR | Asset 3D completo | Escala y presencia suaves; sin invadir espacio personal. |

**Orden de degradación** (de v0.3, sin conflicto): accesorios → textura → rostro →
detalle del núcleo (queda anillo/punto) → **la silueta y el brote nunca se pierden.**

**Monocromo:** un solo color sólido; el núcleo pasa a anillo/contorno; el manto se
diferencia por forma, no por tono. **Dark mode:** paleta invertida con glow cálido
del núcleo preservado; el núcleo sigue legible en light/dark y a tamaño avatar.

---

## 9. Paleta oficial (de v0.3, con restricción V2)

| Familia | Tonos |
|---|---|
| Cuerpo | `#F8F4E9` · `#EDE4D6` · `#D9C8B7` |
| Manto (verdes) | `#6B7158` · `#8FA47A` · `#A7BC9A` |
| Manto (otros) | `#6C7EE7` · `#FFA25B` · `#F4A2C1` · `#7AC0E0` |
| Brote | `#5B7150` · `#6FA47A` · `#8FC08A` · `#C9A05A` |
| Núcleo | `#FFD27A` (cálido, defecto) · `#8CE0FF` · `#A78BFA` · `#FFBEC6` |

**Restricción V2:** no usar azul Meta como color estructural de marca. Los azules
(`#6C7EE7`, `#8CE0FF`) quedan como opciones no estructurales, nunca color de marca
por defecto. Toda extensión de paleta requiere aprobación explícita.

---

## 10. Privacidad del avatar (tiers, de v0.3)

El avatar **nunca es un identificador de protocolo**.

- **LOCAL:** Personal NIDO completo y detallado. Solo existe en el dispositivo.
- **CONTACT:** versión simplificada que el usuario elige compartir (sin elementos
  FREE personales). El usuario controla qué ve cada contacto.
- **PUBLIC:** mínimo (silueta + brote, o Brand Mark). Contextos públicos/desconocidos.

Reglas: nada de información personal sensible ni metadata innecesaria en assets
compartidos; CONTACT y PUBLIC se generan por exportación explícita, nunca por
filtración del LOCAL.

---

## 11. Originality

- El objetivo es una identidad propia de NIDO: no copiar silueta, rostro,
  iconografía, paleta, motion o trade dress de otra compañía.
- No usar azul Meta como color estructural ni elementos que parezcan su logotipo.
- No describir el personaje como "versión de" otra mascota en producción. La
  referencia oficial es únicamente este sistema NIDO.
- Los accesorios pueden cambiar mucho; la anatomía base y el núcleo no.
- **Antes de release público: revisión legal de nombre, marca y assets finales.**
- Regla permanente: si aparece similitud fuerte con otra marca, se modifica nuestra
  dirección manteniendo la filosofía (semilla + brote + manto + núcleo), nunca
  acercándonos a la referencia ajena.

---

## 12. Accesibilidad

- Contraste del núcleo y rostro verificable en light/dark.
- `prefers-reduced-motion`: los estados se comunican por forma/color estático.
- El personaje nunca es el único portador de información crítica (siempre hay texto/UI).
- Cada estado tiene etiqueta de texto accesible (cuando se implemente en app).

---

## Historial

- v2.0 (2026-09-27): adopción del PDF como source of truth de personajes.
  Ver `VISUAL_MIGRATION_REPORT.md`.
- v0.3: SUPERSEDED FOR CHARACTER DESIGN. Historia conservada en
  `docs/NIDO_VISUAL_IDENTITY_SYSTEM.md` y `docs/NIDO_AVATAR_SYSTEM.md`.
