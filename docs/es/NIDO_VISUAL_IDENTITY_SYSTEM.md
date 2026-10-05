> **Idioma:** [English](../NIDO_VISUAL_IDENTITY_SYSTEM.md) · Español

# NIDO — Sistema de Identidad Visual

> **ESTADO: SUPERSEDED FOR CHARACTER DESIGN (2026-09-27).**
> El diseño de personajes 3D ahora se rige por
> `docs/visual/NIDO_3D_VISUAL_SYSTEM.md` (source of truth:
> `docs/visual/NIDO_3D_Character_Design_System_v2.pdf`, v2.0).
> Este documento se conserva como historia (v0.3). Siguen vigentes a nivel marca:
> tagline "TU AGENTE. TU MUNDO.", lenguaje del anillo, y las reglas de separación
> de autoridades / privacidad / originality / naming recogidas en la migración
> (`docs/visual/VISUAL_MIGRATION_REPORT.md`).

**Versión:** v0.3 — SUPERSEDED FOR CHARACTER DESIGN (dirección oficial en desarrollo — NO asset final de producción)
**Estado:** Propuesta de diseño para revisión y aprobación visual de Arsrs.
**Supersede:** v0.2 (`docs/visual/nido-reference-v2.jpg`) queda archivada como referencia
previa; la imagen `docs/visual/nido-brand-guide.jpg` ("NIDO — TU AGENTE. TU MUNDO. /
GUÍA COMPLETA DE DISEÑO DE PERSONAJES", 10 secciones) es ahora el **SOURCE OF TRUTH visual**.
v0.1 (Nidito / tres arcos) permanece archivada como exploración.
**Fecha:** 2026-09-27
**No tocar:** protocolo, criptografía, identidad, Policy Engine, permisos, conformance,
wire formats, domain separators. El diseño nunca acomoda la arquitectura; la arquitectura
no cambia por el diseño.

---

## 0. Principio

**ONE FAMILY. MILLIONS OF INDIVIDUALS.**

**Tagline oficial (de la guía de marca):** TU AGENTE. TU MUNDO.

Cada usuario puede hacer suyo su NIDO. Pero incluso sin color, ropa, accesorios o rostro,
debe seguir siendo reconocible como parte de la familia NIDO.

**Separación de autoridades (permanente):**

- **Avatar = expression.** El personaje expresa estado y personalidad. Nada más.
- **Keys = identity.** La identidad criptográfica vive en las claves, nunca en el dibujo.
- **Policy = authority.** La autoridad vive en el Policy Engine, nunca en el avatar.
- **User = final authority.** El usuario decide.

El círculo luminoso (Núcleo) es **únicamente visual/simbólico** (el espacio privado del
usuario). NO representa clave criptográfica, autoridad, nivel de confianza ni permisos.
La seguridad real se muestra por separado en la UI (p. ej. "Identity verified" solo cuando
corresponde criptográficamente).

**Naming:** NIDO sigue siendo el codename técnico. La identidad visual debe sobrevivir a un
futuro cambio de marca pública (Memini / Amparo / Umbral / Meus / Nidal congelados —
sin ganador). No adaptar el personaje a ningún nombre candidato.

---

## 1. El personaje base

Criatura-semilla de cuerpo suave, compacto y redondeado. Debe sentirse:

- amigable, tranquila, protectora
- premium y táctil (material honesto: se ve suave al tacto, mate, con volumen)
- reconocible
- **no infantilizada en exceso** — es un compañero adulto, no un juguete

### 1.1 ADN visual (5 elementos)

**ESTILO DE RENDER (directiva de Arsrs, 2026-09-27): los personajes se ven COMO LA
FOTO de la guía de marca.** Render 3D suave y táctil: cuerpo de peluche con volumen
real, tela del manto con caída y textura, brote orgánico con luz natural, núcleo como
anillo de luz difusa cálida, iluminación cálida envolvente. **No** es ilustración
vectorial plana, **no** es SVG minimalista, **no** es estilo "sticker" 2D. Todo asset
futuro del personaje (app, marketing, artifact web) debe apuntar a este acabado 3D
suave o reutilizar los renders de la guía como referencia directa. La simplificación
para tamaños pequeños (§1.4) reduce detalle del render, nunca lo convierte en plano.

1. **Forma (cuerpo):** masa ovoide/redondeada, sin aristas. Silueta de "semilla".
   Proporción aproximada: alto ≈ 1.15 × ancho. Base estable, sin piernas visibles
   (o pies mínimos integrados en la masa).
2. **Brote:** hojas/brote superior. **Elemento distintivo de la familia NIDO.**
   Debe funcionar incluso en silueta. Pequeñas variaciones permitidas (1–3 hojas,
   ángulo, tamaño) conservando el concepto de crecimiento y continuidad.
3. **Manto:** envuelve parcialmente al personaje (hombro/torso, asimétrico).
   Representa **protección, privacidad, refugio, control del usuario** — no es ropa.
   Es parte del ADN visual NIDO. Puede variar en estilo, material y color entre
   usuarios sin perder su geometría familiar (banda envolvente parcial, caída
   natural, nunca cubre el rostro ni el núcleo por completo).
4. **Núcleo:** **anillo luminoso** sobre el torso (la guía de marca v0.3 lo renderiza
   como anillo, no como disco lleno — converge con el lenguaje del Brand Mark).
   Representa el espacio privado del usuario. Elemento importante del lenguaje visual,
   pero **puramente simbólico** (ver §0). Luz difusa y cálida por defecto; en monocromo
   se representa como contorno simple.
5. **Rostro:** extremadamente simple. Dos ojos ovales + sonrisa tenue (o solo ojos en
   variantes). Sin nariz, sin rasgos humanos. Pocas expresiones. Debe seguir siendo
   reconocible cuando el rostro desaparezca a tamaños pequeños (la silueta manda).

**Materialidad (de la guía, §4):** cuerpo suave tipo peluche; manto de tela mate suave;
brote orgánico realista; núcleo de luz difusa y cálida. Táctil y premium en todos los
materiales; nunca plástico barato ni metálico agresivo.

### 1.2 Vistas

- **Front:** rostro centrado, manto cruzando de un hombro, núcleo visible en el torso.
- **Side:** perfil de la masa ovoide; el brote se lee en silueta; el manto cae por la espalda.
- **Back:** sin rostro; el manto y el brote sostienen el reconocimiento; el núcleo puede
  asomar como glow lateral o quedar oculto (variante permitida: núcleo visible solo front/side).

### 1.3 Silueta (test de reconocimiento)

La silueta en negro sólido debe leerse como NIDO por: masa ovoide + brote superior +
banda del manto. **Regla de escala:** a tamaños pequeños se eliminan detalles (rostro,
textura, accesorios) **antes** de destruir la silueta. El brote nunca se elimina.

### 1.4 Tests de tamaño

- **16px:** silueta + brote. Sin rostro, sin núcleo detallado (punto o nada).
- **24px:** silueta + brote + sugerencia de manto.
- **48px:** silueta + brote + manto + núcleo (anillo) + rostro mínimo opcional.
- **Profile (avatar):** rostro + manto + núcleo.
- **Full character:** todo el detalle.

### 1.6 Paleta oficial (de la guía de marca, §3)

| Familia | Tonos |
|---|---|
| Cuerpo | `#F8F4E9` · `#EDE4D6` · `#D9C8B7` |
| Manto (verdes) | `#6B7158` · `#8FA47A` · `#A7BC9A` |
| Manto (otros) | `#6C7EE7` · `#FFA25B` · `#F4A2C1` · `#7AC0E0` |
| Brote | `#5B7150` · `#6FA47A` · `#8FC08A` · `#C9A05A` |
| Núcleo | `#FFD27A` (cálido, defecto) · `#8CE0FF` · `#A78BFA` · `#FFBEC6` |

El núcleo cálido `#FFD27A` es el defecto; los fríos/alternos viven en BOUNDED
(variantes Futurista/Técnico o elección explícita del usuario). Toda personalización
de color usa estas familias salvo aprobación explícita de una extensión de paleta.

### 1.7 Variantes de silueta (de la guía, §7)

Seis variantes normativas, todas con brote legible: **Estándar · Compacto · Alto ·
Redondo · Cuadrado suave · Flotante**. La variante Estándar es el personaje base (§1.1);
las demás son opciones BOUNDED para Personal NIDO (p. ej. Tranquilo → Redondo,
Futurista → Flotante). Ninguna variante puede perder el brote en silueta.

### 1.8 Monocromo y dark mode

- **Monocromo:** un solo color sólido. El núcleo pasa a anillo/contorno. El manto se
  diferencia por forma, no por tono. Test: fotocopia / grabado / fax mental.
- **Dark mode:** paleta invertida con glow cálido del núcleo preservado; el manto no
  debe perderse contra fondos oscuros (borde sutil o tono elevado).

---

## 2. Personal NIDO — una familia, no una mascota idéntica

12 personalidades de referencia, **renderizadas en la guía de marca (§5) en el estilo
3D peluche oficial**. Todas comparten el ADN del §1; varían dentro del envelope del §3.

1. **Minimalista** — tonos neutros, sin accesorios, manto liso.
2. **Profesional** — gafas sutiles, manto estructurado oscuro.
3. **Creativo** — acentos violeta, brote asimétrico juguetón.
4. **Deportivo** — banda/cinta en el brote, manto ligero, colores cálidos.
5. **Naturaleza** — tonos musgo/tierra, textura mate, hojas extra en el brote.
6. **Futurista** — superficies lisas oscuras, glow frío en el núcleo, líneas limpias.
7. **Elegante** — paleta sobria, manto con caída refinada, mínimo detalle.
8. **Divertido** — tonos rosados, expresión alegre, accesorio pequeño.
9. **Aventurero** — gafas de explorador sobre el brote, manto resistente.
10. **Técnico** — auricular/casco ligero, detalles geométricos sobrios.
11. **Tranquilo** — tonos lavanda/azulados, ojos cerrados serenos, formas aún más suaves.
12. **Personalizado** — slot abierto del usuario (ver envelope FREE).

Ninguna personalidad puede romper el envelope FIXED ni entrar en FORBIDDEN.

---

## 3. Personalization Envelope

### FIXED — nunca cambia (identidad de la familia)

- Masa corporal ovoide/redondeada sin aristas; proporción corporal base.
- Brote superior presente y legible en silueta.
- Manto envolvente parcial con geometría familiar (nunca cubre rostro ni núcleo por completo).
- Núcleo como **anillo** luminoso en el torso (posición y forma, no su "significado").
- Rostro mínimo de 2 elementos como máximo expresivo base (ojos; boca opcional).
- Ausencia de rasgos humanos (sin nariz, sin boca articulada, sin extremidades humanas).

### BOUNDED — personalizable dentro de límites

- **Color:** paletas aprobadas (cálidas, frías, neutras, oscuras); el núcleo mantiene glow
  cálido salvo variante Futurista/Técnico (glow frío permitido).
- **Material:** mate, suave, cerámico, tejido — siempre táctil y premium; nunca metálico
  agresivo ni translúcido total.
- **Manto:** estilo, largo, textura y color; siempre parcial y asimétrico.
- **Brote:** 1–3 hojas, ángulo ±30°, tamaño 10–20% de la altura total.
- **Expresión:** set cerrado de expresiones (ver `NIDO_AVATAR_SYSTEM.md`).
- **Accesorios limitados:** gafas, cintas, sombreros pequeños, auriculares — uno dominante
  como máximo, nunca sobre el núcleo.

### FREE — creatividad amplia

- Temas y "skins" estacionales/eventos.
- Pequeños elementos personales (parches, bordados, motivos en el manto).
- Fondos y escenas del avatar local.
- Nombre y pronombres del Personal NIDO (texto, no afecta la forma).

### FORBIDDEN — destruye la identidad o crea confusión/riesgo

- Eliminar el brote o hacerlo irreconocible en silueta.
- Rostro humano detallado o hiperrealista.
- Armas, símbolos de autoridad (coronas, insignias oficiales), iconografía religiosa/política.
- Elementos que sugieran verificación de identidad (checks, sellos, candados) **dentro del
  avatar** — la verificación vive en la UI, separada.
- Núcleo usado como medidor (barras, porcentajes, semáforos de "confianza").
- Texto incrustado en el asset del personaje (nombres, IDs).
- Metadata personal sensible en assets compartidos (ver §7).
- Parecido deliberado con mascotas de IA existentes (ver §9 originality).

---

## 4. Brand Mark (refinado por separado)

El símbolo circular de la imagen base es **exploración, no logo definitivo**.
Relación conceptual con el personaje y el núcleo (círculo = espacio privado, continuidad),
pero **no** es el mismo elemento reutilizado sin reflexión.

Requisitos:

- Funciona independiente del personaje.
- **16px / 24px / 48px**, app icon, monocromo, dark mode, hardware, grabado, wearables.
- Construcción geométrica simple: anillo con apertura/gesto de brote sugerido
  (una sola interrupción que evoca la hoja sin dibujarla).
- Versiones: color, mono positivo, mono negativo, app icon (fondo + mark).
- Clearspace mínimo = 25% del diámetro; tamaño mínimo digital 16px, impreso 5mm.

---

## 5. Estados operativos (sin chain-of-thought)

Nueve estados normativos. Solo estado operativo visible; **nunca** representar razonamiento interno.
La guía de marca (§6) ilustra 8 expresiones renderizadas (Idle, Escuchando, Pensando,
Trabajando, Hablando, Completado, Sin conexión, Error) en el estilo 3D oficial; el noveno
estado (`waiting for approval`) se rige por el mapeo de `NIDO_AVATAR_SYSTEM.md` §5.

1. **idle** — reposo, respiración sutil.
2. **listening** — atención (brote levemente erguido / pulso suave del núcleo).
3. **planning** — pausa activa (mirada al frente, núcleo estable).
4. **working locally** — actividad contenida (variación rítmica suave, todo on-device).
5. **communicating with another NIDO** — orientación hacia el otro NIDO, pulso de enlace
   **entre** ambos (el enlace es visual, no prueba identidad).
6. **waiting for approval** — pausa expectante dirigida al usuario (el usuario decide).
7. **completed** — asentimiento mínimo / glow cálido breve.
8. **offline** — atenuado, núcleo apagado o tenue; el personaje sigue presente
   (offline es un estado digno, no un error).
9. **error** — contracción mínima, tono sobrio; sin alarmismo.

Cada estado debe leerse a 48px con silueta + núcleo + postura. El detalle expresivo
vive en `NIDO_AVATAR_SYSTEM.md`.

---

## 6. NIDO ↔ NIDO y grupos

- **Dos NIDO colaborando** (p. ej. "Brett's NIDO ↔ Maria's NIDO"): los personajes se
  orientan entre sí con un enlace visual. **La conexión visual nunca demuestra identidad.**
- La UI muestra por separado, solo cuando corresponde criptográficamente:
  **"Identity verified"** (texto + icono de UI, fuera del avatar).
- Sin verificación: el enlace se muestra neutro o ausente; nunca un candado dentro del avatar.
- **Grupos 3–5:** vista compacta, personajes en fila con solapamiento parcial.
- **Grupos 6+:** vista de grupo abstracta (círculos/núcleos), sin rostros individuales.

---

## 7. Privacidad del avatar (tres niveles)

El avatar **nunca es un identificador de protocolo**.

- **LOCAL AVATAR:** el Personal NIDO completo y detallado del usuario. Solo existe en el
  dispositivo. Puede ser tan personal como quiera.
- **CONTACT AVATAR:** versión simplificada que el usuario elige compartir con contactos
  (menos detalle, sin elementos personales FREE). El usuario controla qué ve cada contacto.
- **PUBLIC AVATAR:** representación mínima (silueta + brote, o Brand Mark). Para contextos
  públicos o desconocidos.

Reglas:

- El usuario puede tener un NIDO local muy detallado sin estar obligado a compartirlo.
- No incrustar información personal sensible ni metadata innecesaria en assets compartidos.
- Los assets compartidos se generan por exportación explícita del nivel elegido, nunca por
  filtración del local.

---

## 8. Escala y contextos

Contextos normativos (de la guía, §10): **App móvil · Desktop · Wearable · AR/VR**.
Estrategia por tamaño:

- **16px:** Brand Mark o silueta NIDO (brote obligatorio).
- **24px:** silueta + manto sugerido.
- **48px:** personaje simplificado completo.
- **Profile:** medio cuerpo con rostro.
- **Full character:** detalle total (solo pantallas grandes / marketing).

En automotive y AR/VR: silueta de alto contraste, sin texto integrado, legible a distancia.

---

## 9. Originality review (red-team permanente)

La dirección actual (criatura-semilla + brote + manto + núcleo) se evaluó contra:

- **Muse / Meta AI:** sin solapamiento — sin formas abstractas flotantes, sin gradientes
  azul-violeta corporativos, sin "sparkle" genérico. Nuestro lenguaje es orgánico/táctil,
  no geométrico/digital.
- **Mascotas de IA genéricas** (robots redondos, blobs con ojos): el **brote en silueta** +
  el **manto asimétrico** + el **núcleo** forman una combinación distintiva; ningún
  competidor reúne los tres.
- **Riesgos a vigilar:** personajes "planta" de videojuegos (el manto y el núcleo nos
  separan); cualquier deriva hacia robot (FORBIDDEN: mantener lo orgánico).

Regla: si durante el refinamiento aparece similitud fuerte con otra marca, se modifica
nuestra dirección manteniendo la filosofía (semilla + brote + manto + núcleo), nunca
acercándonos a la referencia ajena para parecer "más familiar".

---

## 10. Accesibilidad y motion

- Contraste del núcleo y rostro verificable en light/dark.
- `prefers-reduced-motion`: los estados se comunican por forma/color estático, sin animación.
- El personaje nunca es el único portador de información crítica (siempre hay texto/UI).
- Tamaño táctil mínimo y etiquetas accesibles para cada estado en la app (cuando se implemente).

---

## 11. Entregables de esta iteración (diseño, no implementación)

- [ ] Personaje base refinado: front / side / back / 3-4 + silueta (estilo 3D peluche de la guía).
- [ ] Tests 16px / 24px / 48px + monocromo + dark mode.
- [ ] 12 Personal NIDO refinados (guía §5 como referencia directa).
- [ ] 6 variantes de silueta (guía §7).
- [ ] 8 expresiones renderizadas (guía §6) + mapeo del 9.º estado.
- [ ] Capas de personalización: brote, manto, accesorios, colores de núcleo, temas (guía §8).
- [ ] Personalization envelope (este documento, §3).
- [ ] Estados y expresiones (9 estados).
- [ ] NIDO ↔ NIDO + grupos (3–5 y 6+).
- [ ] Avatares local / contact / public.
- [ ] Brand Mark refinado (sistema separado).
- [ ] Originality review (este documento, §9).

**No implementar en la app hasta aprobación visual de Arsrs.**
