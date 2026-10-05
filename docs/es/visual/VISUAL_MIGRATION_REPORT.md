> **Idioma:** [English](../../visual/VISUAL_MIGRATION_REPORT.md) · Español

# VISUAL MIGRATION REPORT — v0.3 → v2 3D

**Fecha:** 2026-09-27
**Autorización:** instrucción explícita de Arsrs (propietario del proyecto), 2026-09-27:
"EL PDF NIDO_3D_Character_Design_System_v2.pdf ES LA NUEVA SOURCE OF TRUTH PARA EL
DISEÑO DE PERSONAJES NIDO."
**Alcance:** únicamente sistema visual / personajes / assets / personalización / motion.
**No toca:** protocolo, seguridad, identidad criptográfica, Policy Engine, arquitectura
técnica, conformance.

## Fuentes comparadas

| ID | Fuente | Estado tras esta migración |
|---|---|---|
| v0.3 | `docs/visual/nido-brand-guide.jpg` + `docs/NIDO_VISUAL_IDENTITY_SYSTEM.md` v0.3 + `docs/NIDO_AVATAR_SYSTEM.md` v0.3 | **SUPERSEDED FOR CHARACTER DESIGN.** Se conserva commit e historia. La guía JPG sigue válida a nivel marca (tagline, lenguaje del anillo) pero ya no es referencia de personajes. |
| V2 | `docs/visual/NIDO_3D_Character_Design_System_v2.pdf` ("3D CHARACTER DESIGN SYSTEM · v2.0") | **NUEVA SOURCE OF TRUTH para personajes.** |

## Tabla de comparación

Clasificación: **KEEP FROM V0.3** · **REPLACE WITH V2** · **MERGE** · **DEPRECATE**

| # | Área | v0.3 | V2 PDF | Clasificación | Decisión |
|---|---|---|---|---|---|
| 1 | Source of truth de personajes | `nido-brand-guide.jpg` | El PDF v2 + la familia 3D renderizada | **REPLACE WITH V2** | El PDF es la referencia normativa de personajes. |
| 2 | Estilo de render | "COMO LA FOTO": 3D peluche suave, no plano | PBR preciso: peluche/fieltro fino crema, microfibra solo de cerca, roughness alta, specular bajo; manto mate denso sin plástico brillante; brote satinado orgánico; núcleo emissive cálido con halo controlado sin quemar a blanco; softbox grande, sombras blandas, contraste bajo-medio, fondo crema, sin contorno negro | **REPLACE WITH V2** | La directiva "como la foto" queda absorbida por la especificación PBR. |
| 3 | Proporciones | alto ≈ 1.15 × ancho; sin piernas visibles (o pies mínimos) | Altura 1.00H, ancho 0.70–0.78H; cara zona superior-central; ojos grandes pero no anime; brazos cortos blandos pegados al cuerpo; pies pequeños y anchos; núcleo bajo el centro facial integrado con el manto | **REPLACE WITH V2** | V2 gana: números normativos. |
| 4 | Rostro | ojos ovales + sonrisa tenue; sin nariz; sin rasgos humanos | dos ojos ovalados oscuros separados; boca corta amable; rubor muy sutil; sin nariz obligatoria | **MERGE** | Se adopta la gramática V2 (añade rubor sutil); se mantiene "sin rasgos humanos". |
| 5 | Núcleo | anillo luminoso, simbólico, nunca medidor/autoridad | aro luminoso en el pecho; comunica identidad, conexión y estado; no es un botón genérico | **MERGE** | Anillo confirmado. Se mantiene la regla v0.3 (nunca clave/autoridad/confianza/permisos/medidor) reforzada por V2. |
| 6 | Vistas del asset maestro | front / side / back (+ 3/4 opcional) | Mínimo: frontal, 3/4, lateral, trasera y superior ligera. La trasera debe resolver cómo envuelve el manto y cómo nace el brote | **REPLACE WITH V2** | 5 vistas normativas. |
| 7 | Paletas hex | cuerpo/manto/brote/núcleo con códigos hex | Sin hex en el PDF, pero regla: no usar azul Meta como color estructural de marca | **MERGE** | Se conservan los hex v0.3; los azules (`#6C7EE7` manto, `#8CE0FF` núcleo) quedan como opciones NO estructurales, nunca color de marca por defecto. |
| 8 | Siluetas | 6 variantes (Estándar, Compacto, Alto, Redondo, Cuadrado suave, Flotante) | L1: standard, compact, tall, round, soft square, floating, dentro de límites de proporción | **KEEP FROM V0.3** | Mismas seis; V2 las confirma como capa L1. |
| 9 | Personalidades | 12 (mismos nombres) | 12 mismos nombres; son presets, no identidades rígidas; el editor no debe revelar info privada por defecto | **MERGE** | Mismos 12 nombres; se añade la regla de privacidad del editor. |
| 10 | Capas de personalización | envelope FIXED/BOUNDED/FREE/FORBIDDEN | L0 especie BLOQUEADA; L1 silueta; L2 brote; L3 manto; L4 núcleo; L5 accesorios (máx 2–3 por defecto); L6 tema | **MERGE** | Mapeo: L0→FIXED, L1–L5→BOUNDED, L6→FREE, FORBIDDEN se mantiene y se amplía con las prohibiciones V2. |
| 11 | Límite de accesorios | 0–1 dominante | máximo 2–3 simultáneos por defecto | **REPLACE WITH V2** | V2 gana: 2–3 por defecto. |
| 12 | Estados/expresiones | 9 estados (8 de la foto + waiting-for-approval); tabla rostro/núcleo/brote | 8 estados animables con semántica de motion precisa: Idle, Escuchando, Pensando, Trabajando, Hablando, Completado, Sin conexión, Error | **MERGE** | Set canónico = los 8 de V2 con su motion. `waiting for approval` se mantiene como 9.º estado **operativo de app** (no expresión del personaje), renderizado con expresión existente. |
| 13 | Motion | Sin especificar (solo reduced-motion) | Sistema completo: idle 2–5 s; transiciones 180–450 ms; acciones 500–1200 ms; el núcleo anticipa 80–150 ms; Reduced Motion sin bounce/flotación/parallax; prohibidos loops inquietos | **REPLACE WITH V2** | Nuevo `NIDO_3D_MOTION_SPEC.md`. |
| 14 | NIDO↔NIDO | orientación mutua + enlace neutro; "Identity verified" como chip UI separado | enlace luminoso temporal entre núcleos; no fusionar cuerpos; el vínculo no es marca de autoridad | **MERGE** | Enlace luminoso entre núcleos (V2) + chip de verificación separado (v0.3). |
| 15 | Grupos | 3–5 fila compacta; 6+ abstracción a círculos/núcleos | participantes individuales y estados parciales; grupos grandes: avatares compactos derivados del mismo ADN | **MERGE** | En grupos grandes se usan avatares compactos del mismo ADN (más fiel que círculos abstractos). |
| 16 | Tamaños | 16/24/48/profile/full + orden de degradación | Tabla: 16–24 marca/silueta; 32–64 avatar 3D simplificado (rostro+brote+manto+núcleo sobreviven); 96+ personaje completo; wearable/auto compacto; AR/VR asset completo | **MERGE** | Se adopta la tabla V2; se mantiene el orden de degradación v0.3 (accesorios→textura→rostro→núcleo→silueta/brote nunca se pierden). |
| 17 | Pipeline de assets | No existía | 8 pasos: BASE_MASTER → separación de mallas → shape keys/rigs → presets como datos → LODs (hero/app/compact/icon) → thumbnails deterministas → QA automático → QA visual humano | **REPLACE WITH V2** | Nuevo `NIDO_3D_ASSET_SPEC.md`. |
| 18 | Nomenclatura de assets | No existía | `nido_<layer>_<variant>_<version>` (ej. `nido_mantle_olive_v01`) | **REPLACE WITH V2** | Normativa desde ahora. |
| 19 | QA | checklist de entregables de diseño | checklist de aceptación de 12 puntos + QA automático + QA visual humano contra la source of truth | **REPLACE WITH V2** | Nuevo `NIDO_3D_QA_CHECKLIST.md`. |
| 20 | Originality | review contra Muse/Meta/mascotas genéricas | No copiar silueta/rostro/iconografía/paleta/motion/trade dress ajenos; no azul Meta estructural; no describir como "versión de" otra mascota; revisión legal antes de release público | **MERGE** | Se mantiene el review v0.3 y se añade la revisión legal pre-release. |
| 21 | Separación de autoridades | Avatar=expresión, Keys=identidad, Policy=autoridad, User=autoridad final | El núcleo "comunica identidad, conexión y estado" (visual); el vínculo no es marca de autoridad | **KEEP FROM V0.3** | La formulación v0.3 es más estricta y se mantiene intacta. |
| 22 | Privacidad del avatar | Tiers LOCAL/CONTACT/PUBLIC + reglas de exportación explícita | Sin tiers; el editor no debe revelar info privada por defecto | **KEEP FROM V0.3** | Los tiers se mantienen; la regla del editor se añade. |
| 23 | Tagline y Brand Mark | "TU AGENTE. TU MUNDO."; Brand Mark separado | El board incluye "TU AGENTE. TU MUNDO." y contexto "NIDO↔NIDO: conexión segura, identidad verificada" | **KEEP FROM V0.3** | Nivel marca, sin conflicto. |
| 24 | Naming | NIDO = codename técnico; Memini/Amparo/Umbral/Meus/Nidal congelados | "La referencia oficial es únicamente este sistema NIDO" | **KEEP FROM V0.3** | Sin cambios. |
| 25 | Regla de documentación | "No ilustración plana" (directiva de estilo) | **NO NEGOCIABLE:** no volver a sustituir el personaje 3D por ilustración plana ni para explicarlo; los diagramas usan renders 3D + overlays técnicos | **REPLACE WITH V2** | Regla endurecida: ni siquiera para diagramas. El artifact web v0.2 (SVG plano) queda formalmente deprecado. |

## Qué quedó de v0.3

- Tagline "TU AGENTE. TU MUNDO." y lenguaje del anillo a nivel marca.
- Las 6 variantes de silueta y los 12 nombres de personalidad.
- Paletas hex (con la restricción de azules no estructurales).
- Envelope FIXED/BOUNDED/FREE/FORBIDDEN (mapeado a L0–L6).
- Separación de autoridades (Avatar=expresión, Keys=identidad, Policy=autoridad,
  User=autoridad final) y núcleo puramente simbólico.
- Tiers de privacidad LOCAL/CONTACT/PUBLIC y reglas de exportación.
- "Identity verified" como UI separada, nunca dentro del avatar.
- `waiting for approval` como 9.º estado operativo de app.
- Orden de degradación por tamaño y reglas de monocromo/dark mode.
- Originality review (ampliado con revisión legal).
- Naming congelado y NIDO como codename técnico.

## Qué fue reemplazado por V2

- Source of truth de personajes (JPG → PDF v2).
- Proporciones normativas (1.00H / 0.70–0.78H, brazos cortos, pies anchos).
- Especificación de materiales PBR y luz (softbox, sin contorno negro).
- 5 vistas obligatorias del asset maestro (incluye trasera que resuelve manto y brote).
- Set canónico de 8 estados con semántica de motion.
- Sistema de motion completo (tiempos, anticipación del núcleo, reduced motion).
- Pipeline de assets de 8 pasos + nomenclatura `nido_<layer>_<variant>_<version>`.
- Límite de accesorios: 2–3 por defecto.
- QA: checklist de 12 puntos + QA automático + QA humano.
- Regla de documentación: prohibición total de ilustración plana del personaje.

## Qué falta producir (gaps)

1. **BASE_MASTER 3D neutral** — no existe. Sin él no hay turnarounds ni derivados.
2. **Turnarounds** (frontal, 3/4, lateral, trasera, superior ligera) — pendientes.
3. **Separación de mallas/materiales** (body, face, sprout, mantle, core, accessories).
4. **Shape keys / rigs** para las 6 siluetas y las 8 expresiones.
5. **Bibliotecas iniciales**: brotes, mantos, accesorios, variantes de núcleo.
6. **12 presets de personalidad** como datos/capas (no personajes duplicados).
7. **Hoja de materiales PBR + paleta** (valores del §3 del sistema 3D).
8. **Clips de motion** por estado + especificación de rig.
9. **LODs**: hero, app, compact, icon.
10. **Thumbnails deterministas** para el editor.
11. **Preview del editor** de personalización por capas.
12. **Prueba NIDO↔NIDO y grupo** renderizada.
13. **QA sheets** con PASS/FAIL contra el PDF.
14. **Revisión legal** de nombre, marca y assets finales (antes de release público).

## Assets necesarios antes de implementar en la app

Ver detalle en `NIDO_3D_ASSET_SPEC.md`. Resumen mínimo:

- `BASE_MASTER` neutral aprobado (turnaround de 5 vistas).
- Mallas y materiales separados por capa con la nomenclatura `nido_<layer>_<variant>_<version>`.
- Las 6 siluetas como shape keys/rigs dentro de límites.
- Biblioteca inicial: brotes, mantos, accesorios, núcleos.
- Los 8 estados como rigs/shape keys animables.
- LODs: hero, app, compact, icon.
- Thumbnails deterministas del editor.
- Runtime avatar assets por tier de tamaño (tabla §8 del sistema 3D).
- QA sheet con PASS en los 12 puntos de aceptación por asset.

**No implementar en la app hasta terminar el audit de migración visual**
(instrucción de Arsrs). El audit vive en `NIDO_3D_QA_CHECKLIST.md`.

## Versionado

- v0.1 (Nidito / tres arcos): archivada como exploración.
- v0.2 (referencia JPG + artifact web SVG): archivada; artifact formalmente deprecado.
- v0.3 (brand guide JPG como source of truth): **SUPERSEDED FOR CHARACTER DESIGN**
  (2026-09-27). Commits e historia conservados. Sigue válida a nivel marca
  (tagline, lenguaje del anillo).
- **v2.0 (este PDF): nueva source of truth de personajes.**
  Documentos normativos: `NIDO_3D_VISUAL_SYSTEM.md`, `NIDO_3D_ASSET_SPEC.md`,
  `NIDO_3D_MOTION_SPEC.md`, `NIDO_3D_QA_CHECKLIST.md`.
