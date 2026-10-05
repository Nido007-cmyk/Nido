> **Idioma:** [English](../NIDO_DESIGN_LANGUAGE.md) · Español

# NIDO Design Language

**Estado:** propuesta de diseño, v0.1 — para revisión, no implementación.
**Regla:** la UI *representa* las reglas de NIDO. Nunca debilita Policy Engine, consentimiento, minimum disclosure ni local-first para simplificar una pantalla.

---

## 1. Principios de diseño

1. **Cálido antes que ingenioso.** Cada pantalla debería sentirse como una habitación tranquila, no una cabina.
2. **Privado visible, nunca ruidoso.** El estado de privacidad siempre a un vistazo, nunca un sermón.
3. **Humano, no infantil.** Curvas amables, tipografía adulta, sin exceso cartoon.
4. **Calma por defecto.** Nada pulsa, pone badges ni pide atención salvo que una decisión humana sea genuinamente necesaria.
5. **Minimalismo premium.** Espacios en blanco generosos, una idea por tarjeta, materiales honestos (papel, arena, hoja — no neón glassmorphism).
6. **Futurista sin sci-fi.** Sin hologramas, sin degradados del espacio, sin cromo robótico. El futuro aquí es silencioso y doméstico.
7. **El agente es alguien con quien hablas, no un dashboard que operas.** Home es un iniciador de conversación, no un panel de control.

---

## 2. Color

La paleta se construye sobre neutros cálidos + verdes botánicos. **Ni un azul Meta en ningún lado.** El color de acción primario es **oliva**, no azul — este es el diferenciador más fuerte frente a las UIs de asistentes de Meta/Google/Microsoft.

### Tokens

| Token | HEX | Usage |
|---|---|---|
| `--cream` | `#FAF6ED` | Fondo de la app |
| `--paper` | `#FFFDF7` | Tarjetas, sheets, burbujas de chat (NIDO) |
| `--sand` | `#ECE1C9` | Superficies secundarias, estados pressed |
| `--sand-deep` | `#DECFAE` | Bordes sobre sand, divisores |
| `--sage` | `#DDE3D0` | Superficie sage suave (chips de info, disponibilidad) |
| `--sage-ink` | `#5C6B47` | Texto/iconos sobre sage |
| `--olive` | `#6C7346` | Acciones primarias, estados activos, enlaces |
| `--olive-deep` | `#545A34` | Primario pressed, texto de énfasis sobre claro |
| `--olive-ghost` | `#EFF1E4` | Superficie tintada para contenido adyacente al primario |
| `--charcoal` | `#2B2A25` | Texto primario |
| `--bark` | `#4A463C` | Texto secundario |
| `--muted` | `#8B8471` | Texto terciario, placeholders |
| `--line` | `#E6DCC4` | Bordes hairline |
| `--clay` | `#B26E4B` | Atención / tier "Never" / destructivo (terracota, no alerta roja) |
| `--clay-ghost` | `#F6E9DD` | Superficie tintada para atención |
| `--gold` | `#C99B3F` | Con moderación: highlights de aprobación, estrellas — nunca como primario |

### Reglas

- Texto sobre `--cream`/`--paper` es `--charcoal` (contraste ≥ 12:1).
- `--olive` (#6C7346) sobre `--paper` = 5.9:1 — OK para texto grande/UI; el texto de cuerpo en oliva usa `--olive-deep` (7.4:1).
- `--muted` sobre `--paper` = 4.6:1 — solo terciario, nunca para info esencial.
- Nunca usar negro puro, blanco puro ni degradados azul/púrpura saturados.
- El modo oscuro está fuera del alcance de v0; la paleta se especifica para seguir cálida si se añade después (sin inversión a oscuro frío).

---

## 3. Tipografía

- **Display:** *Fraunces* (serif cálida, tamaños ópticos suaves) — titulares, saludos, estados vacíos. Transmite premium + humano, y está visualmente lejos de la sans geométrica de Meta y la SF de Apple.
- **UI/Body:** *Inter* — todo lo demás. Neutral, legible, excelente en tamaños pequeños.
- En builds de producto Android, Inter mapea al stack del sistema; Fraunces se distribuye como la única fuente display empaquetada (offline-first: sin descargas de fuentes en runtime).

| Style | Size / Weight | Usage |
|---|---|---|
| Display L | 32 / 600 Fraunces | Titular de onboarding |
| Display M | 24 / 600 Fraunces | Saludos de pantalla ("Good evening, Arsrs") |
| Title | 18 / 600 Inter | Títulos de tarjeta, headers de sheet |
| Body | 15 / 400 Inter | Texto principal |
| Body-strong | 15 / 600 Inter | Énfasis |
| Caption | 13 / 400 Inter | Info secundaria |
| Micro | 11 / 600 Inter, +0.04em tracking, uppercase | Eyebrows, etiquetas de sección ("PRIVACY", "WORKING") |

Altura de línea 1.45 para cuerpo, 1.2 para display. Tamaño mínimo de cuerpo 15sp; la app debe respetar el escalado de texto del sistema hasta 200% sin recortes (scroll, no truncar, acciones críticas).

---

## 4. Espaciado, radios, elevación

- **Escala de espaciado (base 4pt):** 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48. Gutters de pantalla 20.
- **Radios de esquina:** `--r-sm: 12` (chips, controles pequeños), `--r-md: 20` (tarjetas, burbujas), `--r-lg: 28` (sheets, tarjetas hero), `--r-pill: 999` (inputs, botones primarios).
- **Elevación:** suave y cálida, nunca dura. Tarjeta en reposo: `0 1px 2px rgba(74,60,32,.06)`; elevada (sheets, diálogos): `0 12px 32px rgba(74,60,32,.14)`. Sin elevación en filas de lista planas — separación por hairlines `--line`.
- **Textura:** un grano de papel extremadamente sutil puede aplicarse a fondos `--cream` a ≤3% de opacidad. Nunca degradados como decoración.

---

## 5. Componentes

### 5.1 Tarjetas
Relleno `--paper`, `--r-md`, borde 1px `--line` *o* sombra en reposo (no ambos), padding 16–20. Una idea por tarjeta: título → contenido → como máximo una fila de acción. Las tarjetas nunca contienen tarjetas anidadas.

### 5.2 Botones
- **Primario:** relleno `--olive`, texto `--paper`, pill, 52px de alto, peso 600. Pressed: `--olive-deep`.
- **Secundario:** relleno transparente, borde 1.5px `--olive`, texto `--olive-deep`, pill, 52px.
- **Terciario:** solo texto `--olive-deep`, objetivo mínimo 44px.
- **Destructivo/atención:** variantes `--clay` de los anteriores.
- Los diálogos de aprobación siempre ofrecen tres opciones explícitas, nunca un solo "OK": **"Only this time"** (primario) / **"Always for María"** (secundario) / **"Never"** (terciario, clay). Esto mapea 1:1 a `ALLOW_ONCE` / `ALLOW_FOR_CONTACT` / `DENY`.

### 5.3 Inputs (voz/texto)
El input principal es una **pill, 60px**, `--paper` con borde `--line`: `[＋] Ask NIDO anything… [mic]`. Voz y texto son iguales — el mic no es un modo secundario. Estado de escucha: el borde de la pill se vuelve `--olive` y la mascota (pequeña, 28px) aparece a la izquierda con la pose *listening*; una línea de caption en vivo muestra las palabras reconocidas. Sin takeover de voz a pantalla completa.

### 5.4 Chips y status pills
- **Chips de privacidad** (sage): `Processed on device`, `Offline`, `No Internet used`, `Direct NIDO connection`. Pequeño glyph de nido + texto 13px `--sage-ink` sobre `--sage`.
- **Pill de modo** (sand, sutil): `Offline` / `Local-first` / `Online enhanced` — aparece en headers y contextualmente, nunca como hero badge.
- **Chips de estado de tarea:** Working (oliva), Waiting for another NIDO (sand), Needs your approval (clay), Completed (sage).

### 5.5 Toggles y tiers de permiso
Sin toggles desnudos para capabilities. Los permisos usan la **lista de tres tiers** (pantalla Contact permissions):
- **Can automatically** — check oliva en círculo sage.
- **Must ask me** — punto clay en círculo sand.
- **Never** — ✕ clay en círculo clay-ghost.
Cada fila muestra la capability en palabras llanas ("Ask if I'm available") más el `capability/version` exacto en micro type debajo para verificabilidad. Tocar una fila cicla tiers con confirmación para ampliar (ampliar = nueva decisión explícita, nunca silenciosa).

### 5.6 Indicadores de privacidad
El **glyph de nido**: tres arcos rotos concéntricos (un nido visto desde arriba) — nuestra marca original para "se queda en el nido" = on-device / privado. Usado en chips de privacidad, filas de Privacy Activity y el header del diálogo de aprobación. Nunca acompañado de jerga cripto.

### 5.7 Indicadores agente-a-agente
El **glyph de puente**: dos cuadrados redondeados (dos NIDOs) unidos por una sola línea curva. La identidad siempre es explícita con cuatro tratamientos distintos:
- **You** — tu inicial en un círculo sand.
- **Your NIDO** — la mascota mini (28px).
- **Other person** — su inicial en un círculo sage.
- **Their NIDO** — la mascota mini en estilo *outline* (misma forma, sin rellenar) + su inicial debajo.
El trabajo inter-agente se muestra como una sola línea de estado, nunca logs de mensajes: *"Your NIDO ↔ María's NIDO — Negotiating availability…"* → *"Found a time — 6:00 PM"*. El chain-of-thought y los mensajes de protocolo nunca se renderizan.

### 5.8 Progreso y espera
- Determinado: barra oliva de 4px, `--r-pill`, sobre track sand.
- Indeterminado/esperando a otro NIDO: el glyph de puente con un punto a la deriva lento sobre la curva (respeta reduced motion → estático). El texto dice qué se espera y quién lo tiene: "Waiting for María's NIDO to respond".
- Las tareas largas persisten como tarjetas en Tasks; la conversación nunca se convierte en un scroll infinito de líneas de estado.

---

## 6. Movimiento

- **Calma:** 200–300ms, `ease-out`, distancias pequeñas (8–16px), fade+rise para sheets.
- La mascota deriva (nunca rebota): flotación de 2–4px en loop de 4s solo en contextos hero.
- **Reduced motion:** respetar `prefers-reduced-motion` / ajustes de animador de Android — todos los loops se vuelven estáticos, las transiciones se vuelven fades ≤150ms.
- Sin háptica más allá de los defaults de teclado/confirmación del sistema.

---

## 7. Sistema de mascota — "Nidito"

### 7.1 Concepto y nombre
**Nidito** — diminutivo de *nido*. Un ser pequeño, suave, con forma de guijarro que *lleva su nido consigo*: se sienta en un nido tejido poco profundo dondequiera que va. La metáfora es el producto: refugio, hogar, "tu mente tiene un nido". El nombre es propio, con raíz española como el producto, y sin uso por ningún asistente conocido.

### 7.2 Diseño visual (original — ver revisión de originalidad §10)
- **Cuerpo:** un guijarro/cúpula suave — más ancho en la base, color arena (`#E9DCBE`) con una sombra interior suave (`#DCC99E`) en el tercio inferior. Sin extremidades, sin orejas, sin antenas.
- **Nido:** 3–4 trazos curvos dibujados a mano bajo el cuerpo en corteza-oliva (`#8A6F4D`), formando un cuenco tejido poco profundo. El cuerpo siempre se sienta *en* el nido — nunca flotando.
- **Cara:** dos ojos de punto charcoal + un pequeño arco de sonrisa calmada. Nada más. Sin rubor, sin cejas.
- **Lo que NO es:** no un peluche, no un pollito, no un fantasma, no un robot, no una criatura-brote. Sin corona/guirnalda, sin toga, sin ropa de ningún tipo.

### 7.3 Poses (SVG, reutilizadas en todas partes)
1. **Idle** — nivelado, sonrisa suave. Presencia por defecto.
2. **Thinking** — inclinación 6°, ojos mirando arriba, tres puntitos subiendo encima (sin interrogantes, sin engranajes).
3. **Listening** — nivelado, sonrisa ligeramente más amplia, dos pequeños arcos de sonido a un lado.
4. **Confirming** — los ojos se vuelven arcos felices hacia arriba, pequeña elevación de 2px (estático en reduced motion).
5. **Resting** (offline/sleep) — los ojos se vuelven líneas horizontales suaves, trazos del nido ligeramente atenuados.

### 7.4 Reglas de comportamiento y tamaño
| Context | Size | Behavior |
|---|---|---|
| Onboarding hero | ≤160px, once | Deriva suave de 4s |
| Home header | 40px | Idle; se vuelve *thinking* mientras trabaja |
| Chat avatar | 28px | Idle; *listening* mientras el mic está en vivo |
| NIDO↔NIDO card | 32px pair | *Thinking* mientras negocia; *confirming* al acordar |
| Privacy confirmation | 32px | *Confirming* |
| Task completed | 40px inline | *Confirming*, una vez |
| Error/recovery | 40px | Ojos *Resting* → idle; el copy lidera, la mascota apoya |
| Waiting/offline | 32px | *Resting* |

**Regla de hierro:** en uso diario Nidito es una presencia discreta (≤40px). Nunca ocupa media pantalla fuera del onboarding. Nunca habla en primera persona *como* el asistente en un tono cursi — el copy de NIDO se mantiene calmado y llano; Nidito es una presencia, no un personaje con diálogo.

---

## 8. Privacidad como lenguaje UX

Frases aprobadas (llanas, sin jerga). La cripto trabaja debajo; el usuario ve resultados.

- `Processed on device`
- `Offline` / `No Internet used`
- `Direct NIDO connection` (para enlaces de agentes Bluetooth/LAN)
- `Shared: Availability 6–7 PM` (siempre nombra exactamente lo que salió)
- `No calendar details shared`
- `Nothing left your phone today`
- `Waiting for María's NIDO` (nombra quién tiene el siguiente paso)
- Atribución para contenido del peer: `From María's NIDO — not verified`

Prohibido en pantalla: "encrypted", "AES", "Ed25519", "hash", "signature", "zero-knowledge", "military-grade", "unhackable", "blockchain". (La pantalla Privacy Activity puede enlazar a un explainer "How it works" en docs, no en el copy de UI.)

---

## 9. Accesibilidad

- **Contraste:** texto de cuerpo ≥ 7:1 sobre fondos (`--charcoal` sobre `--paper` ≈ 13:1); acentos de UI ≥ 4.5:1; terciario `--muted` ≥ 4.5:1 (nunca lleva significado esencial solo).
- **Objetivos táctiles:** ≥ 48×48dp para todos los elementos interactivos; las filas de tier de permiso son filas de 64dp a ancho completo.
- **Escalado de texto:** respetar la escala de fuente del sistema hasta 200%; los layouts hacen scroll, las acciones críticas nunca se truncan.
- **Lector de pantalla:** cada instancia de la mascota recibe `contentDescription` por estado ("NIDO is thinking", "NIDO is offline"); los chips de privacidad se leen como frases completas ("Processed on device. Nothing left your phone."); el glyph de puente anuncia "Direct connection between your NIDO and María's NIDO".
- **Estado nunca solo por color:** cada estado empareja color con icono y etiqueta de texto (los chips siempre tienen texto; los tiers tienen glyphs ✓/•/✕ más palabras).
- **Reduced motion:** ver §6.

---

## 10. Revisión de originalidad

Revisado contra: app Meta AI (orbe degradado azul/púrpura, UI oscura), Claude ("starburst" terracota, serif+naranja), Siri (blob degradado colorido), Google Assistant/Gemini (puntos de cuatro colores, sparkle azul/púrpura), ChatGPT (minimalismo blanco/negro), Alexa (anillo azul), Bixby.

| Risk | Check | Verdict / change |
|---|---|---|
| Reference mockup (cream + plush character + bottom nav) | Our palette overlaps in warmth, but: primary is **olive** (theirs is sage/blue-grey), type is **Fraunces serif** display (theirs is geometric sans), mascot is a pebble-in-nest (theirs is a plush humanoid with wreath + toga), nav uses nest/home glyphs not generic icons | **Redesigned enough** — recorded |
| Chat bubbles | Standard pattern; ours are `--paper`/`--olive-ghost` with `--r-md` and no gradient | Standard, acceptable |
| "Ask anything" pill | Common; ours pairs mic as equal + mascot state, no sparkle icon | Acceptable |
| Orb/waveform assistant | We deliberately have **no orb, no waveform, no sparkle** — the mascot + bridge glyph replace them | **Differentiated** |
| Permission toggles | Replaced with the three-tier ✓/•/✕ list — no iOS-style switch rows | **Differentiated** |
| Blue "online" dots | Status uses olive/sage/clay with text labels, never blue dots | **Differentiated** |
| Bottom tab bar | Kept (platform convention, expected on Android) but with custom nest glyphs and olive active state; labels always visible | Platform convention, acceptable |

**Conclusión:** la combinación de primario oliva + tipo display Fraunces + motivo de nido + mascota guijarro + permisos de tres tiers no es visualmente confundible con ningún producto de asistente conocido. Si futuras pantallas derivan hacia degradados azul/púrpura, iconografía de orbe o símbolos sparkle, deben rediseñarse según esta sección.
