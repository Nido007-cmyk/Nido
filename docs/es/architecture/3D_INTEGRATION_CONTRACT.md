> **Idioma:** [English](../../architecture/3D_INTEGRATION_CONTRACT.md) · Español

# Contrato de integración 3D — app NIDO ↔ assets de avatar 3D

**Estado:** SOLO ESPECIFICACIÓN (2026-09-27). Sin implementación.
**Propósito:** definir una interfaz limpia y versionada entre la app NIDO y sus
assets de avatar 3D, de modo que los modelos (BASE_MASTER, variantes, estados,
LODs) puedan reemplazarse o actualizarse más adelante **sin reescribir la lógica
de la app**.
**Fuente de verdad visual:** `docs/visual/NIDO_3D_Character_Design_System_v2.pdf`
y `docs/visual/NIDO_BASE_MASTER_V2_REFERENCE.jpg`.
**Compañeros normativos:** `docs/visual/NIDO_3D_ASSET_SPEC.md`,
`docs/visual/NIDO_3D_MOTION_SPEC.md`, `docs/visual/NIDO_3D_QA_CHECKLIST.md`,
`docs/NIDO_AVATAR_SYSTEM.md` (niveles LOCAL/CONTACT/PUBLIC + mapeo estado→expresión),
`docs/NIDO_PRINCIPLES.md` (privacidad, separación de autoridad).

**Estado actual:** NO CONSTRUIDO. La app no tiene renderizador 3D ni assets 3D
incluidos. `src/ui/NidoScreen.tsx` es actualmente una pantalla de mensajería P2P
(chats/contactos/QR), no una pantalla de avatar. No existe en `package.json`
ninguna dependencia de carga de `three.js`/`filament`/GLB. Este contrato es
prospectivo; nada de esto está conectado aún.

---

## 1. Objetivos de diseño

1. **Reemplazabilidad:** cambiar BASE_MASTER v2 → v3 (o cualquier variante/estado/LOD)
   es un cambio de datos + assets, nunca un cambio de código de la app.
2. **Independencia del renderizador:** la app depende de una interfaz abstracta
   `AvatarRenderer`, no de un motor 3D concreto. El motor es un backend reemplazable.
3. **Avatares basados en datos:** cada decisión visual es un
   `AvatarDescriptor` serializable (JSON). Ningún parámetro de avatar codificado
   en los componentes.
4. **Privacidad por construcción:** niveles de avatar (LOCAL/CONTACT/PUBLIC)
   aplicados en el momento de la exportación; los assets compartidos no llevan
   metadatos privados; el avatar nunca es una prueba de identidad
   (`NIDO_AVATAR_SYSTEM.md` §7).
5. **Degradación elegante:** escalera de LOD definida por tamaño de visualización,
   con un respaldo 2D (PNG prerenderizado) cuando el 3D no está disponible.
6. **Offline primero:** todos los assets y el renderizador funcionan totalmente
   sin conexión; los assets se verifican por checksum al cargarse (mismo patrón
   que los pesos de los modelos en `ARCHITECTURE.md`).

---

## 2. Interfaces principales (bocetos TypeScript — especificación, no código)

### 2.1 `AvatarDescriptor` — lo único que manipula el código de la app

```ts
/** Versioned, serializable description of "which NIDO to show". */
interface AvatarDescriptor {
  schema: "nido.avatar/v1";
  /** Asset-set identity, e.g. "nido_body_master_v02". Must match the manifest. */
  baseModel: string;
  /** Layer selections; each value is an asset id from the manifest. */
  layers: {
    body: string;      // e.g. "nido_body_base_v01"
    face: string;      // e.g. "nido_face_base_v01"
    sprout: string;    // e.g. "nido_sprout_dual_v02"
    mantle: string;    // e.g. "nido_mantle_olive_v01"
    core: string;      // e.g. "nido_core_warm_v01"
    accessory?: string;// e.g. "nido_accessory_glasses_round_v01" (max 1 dominant)
  };
  /** Personality preset id, or "custom" with explicit layer overrides above. */
  preset: string;      // e.g. "nido_preset_profesional_v01"
  /** Operational state → expression/motion (see §5). */
  state: AvatarState;  // "idle" | "listening" | "thinking" | "working" |
                       // "talking" | "completed" | "offline" | "error"
  /** Requested fidelity; renderer may step down (never up) per §4. */
  lod: "hero" | "app" | "compact" | "icon";
  /** Privacy tier of this render (see §6). */
  tier: "local" | "contact" | "public";
}
```

Reglas:
- Los componentes de la app NUNCA referencian rutas `.glb`, nombres de malla ni
  nombres de materiales. Solo construyen/consumen objetos `AvatarDescriptor`.
- `baseModel` o ids de capa desconocidos → el renderizador recurre al
  descriptor predeterminado incluido (fallo cerrado hacia una apariencia
  conocida-buena, nunca un crash).
- La versión de `schema` controla el parseo: un descriptor con una versión de
  schema no soportada se rechaza y se sustituye por el predeterminado.

### 2.2 `AvatarRenderer` — la abstracción del motor

```ts
interface AvatarRenderer {
  readonly name: string;            // e.g. "expo-gl+three" (backend id)
  /** True if this backend can run on the current device. */
  isAvailable(): Promise<boolean>;
  /** Preload + verify assets for a descriptor (checksums vs manifest). */
  prepare(descriptor: AvatarDescriptor): Promise<void>;
  /** Render into a provided view; returns a handle for state updates. */
  mount(view: unknown, descriptor: AvatarDescriptor): Promise<AvatarHandle>;
}

interface AvatarHandle {
  /** Switch expression/motion without remounting (state changes are cheap). */
  setState(state: AvatarState): Promise<void>;
  /** Swap descriptor (preset/layers) — may reload assets. */
  setDescriptor(descriptor: AvatarDescriptor): Promise<void>;
  /** Release GPU/native resources. */
  dispose(): Promise<void>;
}
```

Reglas:
- La app elige un backend mediante comprobación de capacidades
  (`isAvailable()`), con preferencia ordenada y un respaldo 2D (§4). La elección
  del backend es configuración, no ramificación de código en las pantallas.
- `setState()` debe ser ligero (objetivo < 1 presupuesto de fotograma): los
  cambios de estado son la ruta caliente (listening → thinking → talking).
  Recargas completas solo al cambiar de descriptor.

### 2.3 `AvatarAssetManifest` — lo que existe en disco

```json
{
  "schema": "nido.avatar-manifest/v1",
  "baseModel": "nido_body_master_v02",
  "assets": [
    { "id": "nido_mantle_olive_v01", "layer": "mantle", "file": "nido_mantle_olive_v01.glb",
      "sha256": "<hex>", "bytes": 123456,
      "lods": { "hero": "…_hero.glb", "app": "…_app.glb", "compact": "…_compact.glb" } }
  ],
  "presets": [ { "id": "nido_preset_profesional_v01", "layers": { "body": "…", "face": "…", "sprout": "…", "mantle": "…", "core": "…", "accessory": "…" } } ],
  "thumbnails": { "nido_mantle_olive_v01": "thumbs/nido_mantle_olive_v01.png" }
}
```

Reglas:
- Cada carga de asset verifica su `sha256` antes de usarse (la misma disciplina
  que con los pesos de los modelos). Asset corrupto/manipulado → recurrir al
  descriptor predeterminado, registrar en diagnósticos (nunca romper la pantalla).
- El manifiesto es el registro único: los selectores de UI (futuro editor)
  enumeran `assets`/`presets` desde él — sin listas codificadas en los componentes.
- Los ids de asset siguen `nido_<layer>_<variant>_<version>`
  (`NIDO_3D_ASSET_SPEC.md` §2).

---

## 3. Forma objetivo — contrato visual v2

El contrato está moldeado para la dirección v2 aprobada
(`NIDO_BASE_MASTER_V2_REFERENCE.jpg`). El renderizador y la pipeline de assets
deben soportar, como mínimo, estos elementos separables e independientemente
reemplazables:

| Elemento | especificación de referencia v2 | Implicación para el contrato |
|---|---|---|
| Cuerpo | huevo/judía, cabeza-cuerpo integrados, crema `#F6F4E9`, peluche/fieltro, sin aristas duras | capa `body`: una sola malla estanca, normales suaves, suavidad PBR tipo subsurface |
| Cara | ojos grandes oscuros, sonrisa pequeña, rubor sutil | capa `face`: rig de expresión intercambiable (ojos+boca+rubor), conjunto cerrado de expresiones |
| Brote | 2–3 hojas orgánicas en la coronilla, `#8FA67A` | capa `sprout`: debe seguir legible en la silueta en todos los LODs |
| Manto | bufanda de tela verde salvia `#6B7F5B`, envuelve en diagonal, volumen/pliegues reales, textil mate | capa `mantle`: malla tipo tela con detalle de pliegues; nunca cubre la cara ni el núcleo por completo |
| Núcleo | anillo dorado luminoso `#FFD27A`, luz cálida difusa + bloom, **integrado en el manto a la altura del pecho** | capa `core`: malla de anillo emisivo + luz; variantes de color por estado/identidad dentro de una paleta accesible |
| Accesorios | máx. 1 dominante (gafas, sombreros…), nunca sobre el núcleo | capa `accessory`: opcional, anclada, excluida de los LODs `compact`/`icon` |

Las variantes de silueta (estándar/compacta/alta/redonda/suave-cuadrada/flotante)
son deformaciones por shape-key/rig de la misma malla base — no personajes
separados — por lo que el contrato las trata como morph targets de `body`,
seleccionables vía descriptor.

---

## 4. Escalera de LOD y respaldo 2D

| Tamaño de visualización | LOD | Se renderiza como |
|---|---|---|
| 16–24 px | `icon` | silueta + brote (plano o 3D mínimo) |
| 32–64 px | `compact` | 3D simplificado (cara+manto+núcleo, sin accesorio) |
| 96 px+ | `app` | personaje 3D completo |
| AR/VR, marketing | `hero` | asset de fidelidad total |

Orden de degradación (qué se pierde primero): accesorios → detalle de
texturas → cara → detalle del núcleo (anillo → punto) → **la silueta + el brote
nunca se pierden** (`NIDO_AVATAR_SYSTEM.md` §4).

**Respaldo 2D (obligatorio):** si no hay backend 3D disponible (o `isAvailable()`
es falso), la app renderiza el PNG prerenderizado determinista para el estado
del descriptor (familia `nido_thumb_<layer>_<variant>_v01` / imágenes fijas de
turnaround). El avatar siempre es *expresable*, nunca una vista rota. Los PNG
estáticos son también la ruta de integración provisional: la app puede mostrar
renders v2 aprobados mucho antes de que llegue un backend 3D en tiempo real.

---

## 5. Mapeo estado → expresión (ruta caliente)

Los estados operativos de la app se mapean a estados del avatar exactamente según
`NIDO_AVATAR_SYSTEM.md` §5 (idle, listening, thinking/planning, working,
talking/communicating, completed, offline, error, waiting-approval).
Restricciones trasladadas a este contrato:

- `setState()` cambia solo expresión + movimiento + comportamiento del brillo del núcleo.
- **Nunca renderizar chain-of-thought ni razonamiento interno** en el avatar.
- `prefers-reduced-motion` → pose estática + color por estado, sin animación.
- A ≤ 48 px la cara puede desaparecer; el estado lo llevan entonces la postura +
  el núcleo (el contrato exige que cada estado sea distinguible a 48 px).
- Los visuales del enlace NIDO↔NIDO son cromo de UI *alrededor* de los avatares,
  nunca dentro de la malla del avatar, y nunca implican verificación de identidad.

---

## 6. Niveles de privacidad (aplicados en la exportación, no en el render)

| Nivel | Contenido | Dónde puede ir |
|---|---|---|
| `local` | NIDO personal completo (todas las capas, personalizado) | solo en el dispositivo |
| `contact` | versión simplificada elegida por el usuario (sin bits personalizados de nivel FREE) | por contacto, exportación explícita |
| `public` | silueta + brote (o marca de marca) | contextos públicos/desconocidos |

Reglas del contrato:
- El descriptor lleva su `tier`. Un renderizador DEBE negarse a renderizar un
  descriptor `local` en un contexto `contact`/`public` (fallo cerrado).
- Los descriptores CONTACT/PUBLIC se producen mediante una función de exportación
  explícita que elimina capas; nunca filtrando un render local en el momento de
  mostrarlo.
- Los assets compartidos/exportados no contienen metadatos personales (nombres,
  claves, identificadores, ubicación). Los `thumbnails` del manifiesto para
  niveles compartidos se generan desde el descriptor exportado, no desde el local.
- La UI de "identidad verificada" es cromo separado, nunca parte del asset del avatar.

---

## 7. Puntos de integración en la app (cuando se construya)

- **Proveedor de avatar (futuro):** un contexto React que replica los patrones
  de `LanguageContext`/`ThemeContext` — `useAvatar()` devuelve el
  `AvatarDescriptor` actual + el puente `setState()` alimentado por el estado
  operativo del orquestador. Las pantallas consumen el contexto; nunca tocan el
  renderizador.
- **Ajustes:** selector de preset de avatar, niveles predeterminados por
  contacto, anulación de movimiento reducido, preferencia 2D/3D — enumerados
  desde el manifiesto (§2.3).
- **Diagnósticos:** fallos de checksum de assets, disponibilidad del backend y
  activaciones de respaldo se registran en el canal de diagnósticos (sin PII).
- **Editor (futuro):** los selectores de capa/preset leen el manifiesto; las
  miniaturas son prerenders deterministas (`nido_thumb_*`).

## 8. No-objetivos / prohibiciones

- Ningún parámetro de avatar codificado en los componentes de UI (todo vía descriptor).
- Ninguna descarga de assets de avatar por red en tiempo de ejecución
  (incluidos + verificados, como los modelos).
- El avatar es EXPRESIÓN (`AVATAR = EXPRESSION`). Nunca es identidad, nunca una
  señal de confianza, nunca un medidor/barra de progreso, nunca un portador de
  datos privados.
- Ningún asset 3D nuevo entra en la app hasta que el turnaround de BASE_MASTER
  esté aprobado y cada asset pase el QA de 12 puntos (`NIDO_3D_ASSET_SPEC.md` §5).

## 9. Preguntas abiertas

- Elección del backend 3D para React Native sin conexión (three.js vía expo-gl
  vs. filament vs. solo prerenderizados): requiere una prueba que mida tamaño
  del APK, RAM y costo de arranque en frío en un dispositivo real. **No se decide aquí.**
- Si el LOD `hero` se incluye en el APK o como paquete de descarga opcional.
- Lista exacta de `AvatarState` si los 9 estados de la app (`NIDO_AVATAR_SYSTEM.md` §5)
  necesitan granularidad más fina (p. ej. waiting-approval como estado de avatar distinto).
