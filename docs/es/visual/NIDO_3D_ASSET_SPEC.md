> **Idioma:** [English](../../visual/NIDO_3D_ASSET_SPEC.md) · Español

# NIDO 3D Asset Spec — v2.0

**Fecha:** 2026-09-27
**Normativa:** `NIDO_3D_VISUAL_SYSTEM.md` + `NIDO_3D_Character_Design_System_v2.pdf` (§10–11).
**Estado de producción:** ningún asset 3D de producción existe todavía. Todo lo listado
aquí está **PENDIENTE** salvo que se indique lo contrario.
**Regla:** los assets se producen en el pipeline 3D (BASE_MASTER → derivados). No se
generan personajes con IA como assets oficiales; los renders del PDF son referencia,
no assets de producción.

---

## 1. Pipeline (del PDF, §10)

1. Crear un **BASE_MASTER** 3D neutral con turnaround aprobado.
2. Separar malla/materiales: body, face, sprout, mantle, core, accessories.
3. Crear shape keys o rigs para siluetas permitidas y expresiones.
4. Generar presets como datos/capas; no duplicar personajes completos innecesariamente.
5. Exportar LODs: hero, app, compact e icon.
6. Generar thumbnails deterministas para el editor.
7. QA automático de nombres, pivots, materiales, dimensiones, LOD y archivos faltantes.
8. QA visual humano contra la Source of Truth antes de aceptar un asset.

## 2. Nomenclatura

`nido_<layer>_<variant>_<version>` · Ejemplos: `nido_mantle_olive_v01`,
`nido_sprout_dual_v02`, `nido_accessory_glasses_round_v01`.

Capas (`<layer>`): `body` · `face` · `sprout` · `mantle` · `core` · `accessory` ·
`preset` · `lod` · `thumb` · `motion`.

---

## 3. Lista exacta de assets

### 3.1 BASE_MASTER

| Asset | Nombre | Estado |
|---|---|---|
| Personaje 3D neutral (sin personalidad) | `nido_body_master_v01` | PENDIENTE |
| Turnaround frontal | `nido_master_turnaround_front_v01` (render 3D) | PENDIENTE |
| Turnaround 3/4 | `nido_master_turnaround_threequarter_v01` (render 3D) | PENDIENTE |
| Turnaround lateral | `nido_master_turnaround_side_v01` (render 3D) | PENDIENTE |
| Turnaround trasera (resuelve manto + nacimiento del brote) | `nido_master_turnaround_back_v01` (render 3D) | PENDIENTE |
| Vista superior ligera | `nido_master_turnaround_top_v01` (render 3D) | PENDIENTE |

Criterio: la trasera debe resolver cómo envuelve el manto y cómo nace el brote;
topología preparada para deformación suave.

### 3.2 Mallas y materiales separados

| Asset | Nombre | Estado |
|---|---|---|
| Malla + material cuerpo (peluche/fieltro crema) | `nido_body_base_v01` | PENDIENTE |
| Gramática facial (ojos ovales, boca mínima, rubor sutil) | `nido_face_base_v01` | PENDIENTE |
| Brote base (1–3 hojas orgánicas) | `nido_sprout_base_v01` | PENDIENTE |
| Manto base (tela mate envolvente parcial) | `nido_mantle_base_v01` | PENDIENTE |
| Núcleo base (aro emissive cálido) | `nido_core_base_v01` | PENDIENTE |
| Hoja de materiales PBR + paleta (valores §3 del sistema) | `nido_materials_pbr_v01` | PENDIENTE |

### 3.3 Siluetas (6 variantes, como shape keys/rigs dentro de límites)

| Variante | Nombre | Estado |
|---|---|---|
| Estándar (= base) | `nido_body_standard_v01` | PENDIENTE |
| Compacto | `nido_body_compact_v01` | PENDIENTE |
| Alto | `nido_body_tall_v01` | PENDIENTE |
| Redondo | `nido_body_round_v01` | PENDIENTE |
| Cuadrado suave | `nido_body_softsquare_v01` | PENDIENTE |
| Flotante | `nido_body_floating_v01` | PENDIENTE |

Criterio: todas conservan el brote legible en silueta; proporciones dentro de
0.70–0.78H de ancho salvo la variante que lo justifique (Alto/Flotante) con
aprobación explícita.

### 3.4 Bibliotecas de capas

| Biblioteca | Contenido mínimo | Estado |
|---|---|---|
| Brotes | formas y colores naturales de hoja (L2) | PENDIENTE |
| Mantos | colores (paleta §9), caídas, cuellos, pliegues, acabados (L3) | PENDIENTE |
| Núcleos | variantes de color de estado/identidad en paleta accesible (L4) | PENDIENTE |
| Accesorios | gafas, gorros, auriculares, goggles, pequeños objetos (L5, máx 2–3) | PENDIENTE |

### 3.5 Expresiones y estados (8, como rigs/shape keys animables)

| Estado | Asset motion | Estado |
|---|---|---|
| Idle | `nido_motion_idle_v01` | PENDIENTE |
| Escuchando | `nido_motion_listening_v01` | PENDIENTE |
| Pensando | `nido_motion_thinking_v01` | PENDIENTE |
| Trabajando | `nido_motion_working_v01` | PENDIENTE |
| Hablando | `nido_motion_talking_v01` | PENDIENTE |
| Completado | `nido_motion_completed_v01` | PENDIENTE |
| Sin conexión | `nido_motion_offline_v01` | PENDIENTE |
| Error | `nido_motion_error_v01` | PENDIENTE |

Especificación de comportamiento: `NIDO_3D_MOTION_SPEC.md`.

### 3.6 Personalidades (12 presets como datos/capas)

`nido_preset_minimalista_v01` · `nido_preset_profesional_v01` ·
`nido_preset_creativo_v01` · `nido_preset_deportivo_v01` ·
`nido_preset_naturaleza_v01` · `nido_preset_futurista_v01` ·
`nido_preset_elegante_v01` · `nido_preset_divertido_v01` ·
`nido_preset_aventurero_v01` · `nido_preset_tecnico_v01` ·
`nido_preset_tranquilo_v01` · `nido_preset_personalizado_v01`

Estado: PENDIENTE (todos). Criterio: presets como datos sobre el BASE_MASTER, sin
duplicar personajes completos; combinables en el editor sin revelar info privada
por defecto.

### 3.7 LODs

| LOD | Uso | Estado |
|---|---|---|
| `hero` | marketing, pantallas grandes, AR/VR | PENDIENTE |
| `app` | avatar en app (96 px+) | PENDIENTE |
| `compact` | 32–64 px, wearable, grupos grandes | PENDIENTE |
| `icon` | 16–24 px, silueta + brote | PENDIENTE |

### 3.8 Thumbnails del editor

Thumbnails deterministas por capa/preset para el editor de personalización
(`nido_thumb_<layer>_<variant>_v01`). Estado: PENDIENTE.

### 3.9 Runtime avatar assets (por tier de tamaño)

| Tier | Representación | Asset runtime |
|---|---|---|
| 16–24 px | marca/silueta simplificada | `nido_lod_icon` |
| 32–64 px | avatar 3D simplificado (rostro+brote+manto+núcleo) | `nido_lod_compact` |
| 96 px+ | personaje 3D completo | `nido_lod_app` |
| AR/VR, marketing | asset completo | `nido_lod_hero` |

### 3.10 Pruebas renderizadas

| Prueba | Estado |
|---|---|
| Prueba NIDO↔NIDO (enlace luminoso entre núcleos) | PENDIENTE |
| Prueba de grupo (participantes individuales + estados parciales) | PENDIENTE |
| Preview del editor de personalización por capas | PENDIENTE |

---

## 4. QA por asset

- **Automático:** nombres según convención, pivots, materiales, dimensiones,
  LOD correcto, archivos faltantes.
- **Humano:** QA visual contra la Source of Truth (el PDF) antes de aceptar.
- **Aceptación:** checklist de 12 puntos en `NIDO_3D_QA_CHECKLIST.md`; cada asset
  necesita su QA sheet con PASS/FAIL.

## 5. Puerta de implementación en la app

Ningún asset entra a la app hasta que:

1. El BASE_MASTER tiene turnaround aprobado (5 vistas).
2. El asset pasa el QA automático.
3. El asset pasa el QA visual humano contra el PDF.
4. El asset tiene QA sheet con los 12 puntos en PASS.
5. El audit de migración visual está cerrado (`NIDO_3D_QA_CHECKLIST.md` §5).
