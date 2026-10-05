> **Idioma:** [English](../../harness/README.md) · Español
# Harness de Conformidad NIDO (independiente del lenguaje)

Los vectores oficiales viven en `../vectors/v0/final/*.json` (más
`manifest.json`). Cualquier implementación del protocolo de agentes NIDO
puede testarse contra ellos sin saber TypeScript, hablando NDJSON por
stdio.

## Protocolo

La implementación bajo test (IUT) se inicia como un proceso hijo:

```
<iut-command>
```

Debe entonces, hasta que stdin llegue a EOF:

1. leer **un objeto JSON por línea** de stdin — cada línea es un vector
   oficial (el objeto completo del vector: `{id, title, category, kind,
   input?, input_raw?, expected}`),
2. por cada vector, computar el resultado normalizado para `vector.kind`
   (la misma normalización que produce el adaptador de referencia — ver
   `../reference-ts/adapter.ts` para las formas exactas de resultado),
3. escribir **un objeto JSON por línea** a stdout:
   `{"id": "<vector id>", "result": <normalized result>}`.

El harness compara `result` con el `expected` del vector usando igualdad
profunda de JSON (el orden de claves de objeto es irrelevante). Cualquier
otra cosa en stdout rompe el protocolo; usa stderr para logs.

Valores de `kind` y sus formas de resultado (v0):

| kind | input | result |
|---|---|---|
| `canonicalization` | `input_raw` (text) | `{ok, canonical?, sha256?, error?}` |
| `signature` | `input {key, message, signature}` | `{ok}` o `{ok:false, error}` |
| `envelope` | `input_raw` (text) + `input.ctx` | `{ok, message_type?, sender_device?, task_id?, error?}` |
| `policy` | `input {rules, request}` | `{ok, decision}` |
| `budget` | `input {state, steps, opts}` | `{ok, remaining?, state?, error?, at_step?}` |
| `disclosure` | `input {value, allowed_paths}` | `{ok, projected}` |
| `graph` | `input {nodes, budget}` | `{ok, total?, error?}` |
| `delegation` | `input {chain, now, pubkeys}` | `{ok, leaf_subject?, max_uses?, error?}` |
| `consent` | `input {grant, request}` | `{ok, uses_left?, error?}` |
| `version` | `input {protocol_version, capability_version}` | `{ok, error?}` |
| `extension` | `input {core, attempts}` | `{ok, results}` |
| `state_machine` | `input {machine, events}` | `{ok, final?, error?, at_event?}` |
| `idempotency` | `input {task_ids}` | `{ok, log, duplicates_rejected, executed_count}` |

## Ejecución

```
python3 runner.py --impl ./my-iut [--vectors ../vectors/v0/final]
```

Código de salida 0 ssi cada vector coincide. Un archivo de resultados
`differential-results-<impl>.json` se escribe para el registro.

## Notas

- Los valores `expected` fueron generados por la referencia TypeScript. El
  harness NO confía en la referencia: para un test diferencial real, la IUT
  debe ser una implementación independiente (autor diferente, idealmente
  lenguaje diferente). Los desacuerdos deben investigarse como ambigüedades
  de spec, no auto-resolverse a favor de ningún lado.
- `reference-python/` contiene una segunda implementación PARCIAL (solo
  canonicalización + SHA-256), usada para testar diferencialmente el
  componente más delicado. No es una segunda implementación completa.
