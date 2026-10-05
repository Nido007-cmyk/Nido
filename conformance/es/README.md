> **Idioma:** [English](../README.md) · Español
# Suite de Conformidad del Protocolo NIDO v0

Verificación ejecutable de que dos implementaciones entienden el documento
del protocolo de la misma manera. La suite NO mide características; mide
**reducción de superficie de ataque verificada** (ver
`SECURITY_INVARIANTS.md`).

> "NO CONFÍES EN QUE DOS IMPLEMENTACIONES ENTENDIERON EL DOCUMENTO IGUAL. DEMUÉSTRALO."

## Estructura

```
conformance/
  reference-ts/        # Implementación de referencia (TypeScript, NO es código de producto)
  vectors/v0/source/   # Vectores escritos por humanos (pueden usar alias de claves)
  vectors/v0/final/    # Vectores generados y congelados (claves literales, firmados)
  harness/             # Harness diferencial independiente del lenguaje (NDJSON sobre stdio)
  harness/reference-python/  # Segunda implementación PARCIAL (canonicalización + SHA-256)
  __tests__/
    gen.test.ts        # Generador determinista + chequeo de frescura
    vectors.test.ts    # Runner genérico sobre final/ (157 vectores)
    properties.test.ts # Tests de fuzz / propiedades (7 propiedades)
  SECURITY_INVARIANTS.md
  SPEC_AMBIGUITIES.md
```

## Estado

- `IMPLEMENTED` · `AUTOMATED/UNIT TESTED`: sí (157 vectores + 7 propiedades en verde)
- `ANDROID COMPILED` / `EMULATOR TESTED` / `PHYSICAL DEVICE TESTED`: no
- `EXTERNALLY AUDITED`: no
- Segunda implementación: PARCIAL (Python, solo canonicalización + SHA-256).
  La segunda implementación completa (preferiblemente Rust) sigue pendiente.

## Ejecución

```bash
npx vitest run conformance/__tests__     # suite completa
npx tsc --noEmit                        # typecheck

# Test diferencial contra la implementación parcial en Python:
python3 conformance/harness/runner.py \
  --impl "python3 conformance/harness/reference-python/canon.py --ndjson" \
  --only canonicalization

# Cualquier otra implementación que hable el protocolo del harness:
python3 conformance/harness/runner.py --impl ./my-iut
```

## Modificar vectores

1. Edita SOLO `vectors/v0/source/*.json`.
2. Regenera: `CONFORMANCE_GEN=1 npx vitest run conformance/__tests__/gen.test.ts`
3. El test de frescura falla si `final/` está desactualizado — regenera, nunca edites a mano.
4. Ejecuta la suite completa + typecheck antes de commitear.

## Documentos normativos

- `SECURITY_INVARIANTS.md` — los 7 invariantes, cada uno como
  amenaza → ruta de explotación → mitigación → test.
- `SPEC_AMBIGUITIES.md` — 10 ambigüedades encontradas y resueltas, con la
  lectura conservadora (fail-closed) registrada.

## No-objetivos (v0)

Sin nuevas características, sin P2P por relay/Internet, sin cripto de
grupo, sin economía de agentes, sin nuevas capacidades.
`calendar.availability.query/v1` sigue BLOQUEADO hasta: suite estable →
segunda implementación independiente → tests diferenciales → C-1 verificado
en Android donde sea posible.
