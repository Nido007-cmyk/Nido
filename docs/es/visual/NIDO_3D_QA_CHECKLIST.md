> **Idioma:** [English](../../visual/NIDO_3D_QA_CHECKLIST.md) · Español

# NIDO 3D QA Checklist — v2.0

**Fecha:** 2026-09-27
**Normativa:** `NIDO_3D_Character_Design_System_v2.pdf` (§13) + este sistema v2.0.
**Uso:** cada asset 3D necesita su QA sheet con PASS/FAIL por punto antes de
aceptarse. Nada entra a la app sin los 12 puntos en PASS.

---

## 1. Checklist de aceptación de un personaje (12 puntos, del PDF)

- [ ] Se reconoce como la misma especie NIDO sin leer texto.
- [ ] Es 3D soft/plush, no vector plano.
- [ ] Conserva cuerpo compacto, rostro mínimo, brote orgánico, manto y núcleo.
- [ ] Los accesorios no tapan rostro ni núcleo.
- [ ] El núcleo sigue legible en light/dark y a tamaño avatar.
- [ ] La pose funciona frontal y 3/4.
- [ ] Los materiales no parecen plástico duro.
- [ ] El estado se entiende sin depender solo del color.
- [ ] Reduced Motion tiene alternativa.
- [ ] No introduce autoridad o permisos por apariencia.
- [ ] Funciona en 64 px y existe fallback de 24 px.
- [ ] Pasa originality review antes de integrarse.

## 2. QA automático (pipeline, §7 del PDF)

- [ ] Nombres según `nido_<layer>_<variant>_<version>`.
- [ ] Pivots correctos.
- [ ] Materiales asignados y dentro de la hoja PBR.
- [ ] Dimensiones dentro de proporción (1.00H / 0.70–0.78H salvo variante aprobada).
- [ ] LOD correcto (hero / app / compact / icon).
- [ ] Sin archivos faltantes ni referencias rotas.

## 3. QA visual humano

- [ ] Comparado contra la Source of Truth (el PDF v2.0), no contra memoria ni
      contra renders intermedios.
- [ ] La trasera resuelve el manto y el nacimiento del brote.
- [ ] La especie se mantiene con accesorios y color especial ocultos.
- [ ] Revisado por Arsrs o revisor designado antes de aceptar.

## 4. QA de motion (por clip)

- [ ] Tiempos dentro de norma (idle 2–5 s; transiciones 180–450 ms;
      expresivas 500–1200 ms; anticipación del núcleo 80–150 ms).
- [ ] Reduced Motion tiene alternativa estática aprobada.
- [ ] Sin loops inquietos; sin terror/culpa en Error; sin lip-sync hiperrealista.
- [ ] Nunca representa razonamiento interno.

## 5. Audit de migración visual v0.3 → v2 (esta migración)

- [x] Comparación v0.3 vs PDF clasificada (KEEP / REPLACE / MERGE / DEPRECATE)
      — `VISUAL_MIGRATION_REPORT.md`.
- [x] Documentos oficiales v2 creados: `NIDO_3D_VISUAL_SYSTEM.md`,
      `NIDO_3D_ASSET_SPEC.md`, `NIDO_3D_MOTION_SPEC.md`, `NIDO_3D_QA_CHECKLIST.md`.
- [x] v0.3 marcada como SUPERSEDED FOR CHARACTER DESIGN; historia conservada.
- [x] PDF archivado como source of truth en `docs/visual/`.
- [x] Regla no negociable registrada: prohibida la ilustración plana del personaje,
      incluso para diagramas.
- [x] Alcance verificado: sin cambios a protocolo, seguridad, identidad
      criptográfica, Policy Engine ni arquitectura.
- [ ] Aprobación visual de Arsrs de la dirección v2.
- [ ] Cierre del audit (solo cuando los assets del §3 del asset spec existan y
      pasen QA). **Hasta entonces: no implementar en la app.**

## 6. Plantilla de QA sheet por asset

```text
Asset: nido_<layer>_<variant>_<version>
Fecha: 
Revisor: 
12 puntos de aceptación:  [ ]x12  →  PASS / FAIL
QA automático:             PASS / FAIL (detalle)
QA visual humano:          PASS / FAIL (detalle)
QA motion (si aplica):     PASS / FAIL (detalle)
Originality:               PASS / FAIL
Decisión:                  ACEPTADO / RECHAZADO (motivo)
```
