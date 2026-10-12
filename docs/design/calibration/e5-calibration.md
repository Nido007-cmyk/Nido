# Calibración búsqueda multilingüe (generado)

- Generado: 2026-10-12T00:34:56.540410+00:00
- llama.cpp: `171e8846b4af9766c354064cb776cb34a50f053f` (el de llama.rn)
- e5: `intfloat/multilingual-e5-small@614241f622f53c4eeff9890bdc4f31cfecc418b3`, GGUF sha256 `802c868f57ccddd2e0c80645c3db1cb96a1aa50986a057cbaee2526f6e474cde`
- bge GGUF sha256 `ec38e8da142596baa913124ae50550de284b6916bf59577ef2f0cb9660c2f514`
- Filtro de la app hoy: piso 0.6, una palabra 0.7, margen 0.4

Recall = la pregunta trae el artículo correcto entre los 4 fragmentos que ve el modelo.
Falsos = preguntas sin respuesta en el corpus que aun así traen fragmentos.
Solo búsqueda por significado (la de palabras va aparte y no cambia).

## Corpus: builtin

| | es recall | en recall | pt recall | falsos (media) |
|---|---|---|---|---|
| bge hoy (frases) | 50% | 98% | 48% | 23% |
| e5 con pisos de bge | 100% | 100% | 100% | 100% |
| e5 piso 0.81 margen 0.3 | 85% | 100% | 90% | 15% |
| e5 piso 0.81 margen 0.4 | 85% | 100% | 90% | 15% |
| e5 piso 0.81 margen 0.5 | 85% | 100% | 90% | 15% |
| **e5 en la app** (integrado 0.81, paquetes 0.84) | 85% | 100% | 90% | 15% |
| bge re-ajustado piso 0.6 | 50% | 98% | 48% | 23% |

Una sola palabra:

| | es | en | pt | falsos |
|---|---|---|---|---|
| bge hoy | 17% | 83% | 17% | 0% |
| **e5 en la app** (integrado 0.87, paquetes 0.88) | 83% | 83% | 83% | 0% |
| e5 piso 0.87 margen 0.3 | 83% | 83% | 83% | 0% |
| e5 piso 0.87 margen 0.4 | 83% | 83% | 83% | 0% |
| e5 piso 0.87 margen 0.5 | 83% | 83% | 83% | 0% |

Mejor coseno por pregunta (p10 / p50 / p90):

| | bge | e5 |
|---|---|---|
| neg_en | 0.511 / 0.546 / 0.610 | 0.798 / 0.810 / 0.829 |
| neg_es | 0.540 / 0.562 / 0.632 | 0.781 / 0.799 / 0.818 |
| neg_pt | 0.564 / 0.589 / 0.609 | 0.785 / 0.801 / 0.814 |
| pos_en | 0.703 / 0.761 / 0.822 | 0.848 / 0.875 / 0.909 |
| pos_es | 0.580 / 0.639 / 0.732 | 0.808 / 0.829 / 0.875 |
| pos_pt | 0.582 / 0.649 / 0.723 | 0.821 / 0.840 / 0.872 |

## Corpus: builtin+vital

| | es recall | en recall | pt recall | falsos (media) |
|---|---|---|---|---|
| bge hoy (frases) | 25% | 95% | 35% | 87% |
| e5 con pisos de bge | 78% | 88% | 80% | 100% |
| e5 piso 0.81 margen 0.3 | 80% | 88% | 88% | 78% |
| e5 piso 0.815 margen 0.4 | 78% | 88% | 82% | 72% |
| e5 piso 0.815 margen 0.5 | 78% | 88% | 80% | 72% |
| **e5 en la app** (integrado 0.81, paquetes 0.84) | 85% | 90% | 92% | 32% |
| bge re-ajustado piso 0.64 | 28% | 95% | 35% | 60% |

Una sola palabra:

| | es | en | pt | falsos |
|---|---|---|---|---|
| bge hoy | 17% | 100% | 33% | 8% |
| **e5 en la app** (integrado 0.87, paquetes 0.88) | 83% | 100% | 83% | 0% |
| e5 piso 0.87 margen 0.3 | 83% | 100% | 83% | 8% |
| e5 piso 0.87 margen 0.4 | 83% | 100% | 83% | 8% |
| e5 piso 0.87 margen 0.5 | 83% | 100% | 83% | 8% |

Piso de los paquetes (frases; integrado fijo):

| piso | es | en | pt | falsos |
|---|---|---|---|---|
| 0.81 | 78% | 88% | 80% | 78% |
| 0.815 | 80% | 88% | 82% | 72% |
| 0.82 | 80% | 88% | 88% | 68% |
| 0.825 | 82% | 90% | 88% | 57% |
| 0.83 | 85% | 90% | 88% | 53% |
| 0.835 | 85% | 90% | 90% | 42% |
| 0.84 | 85% | 90% | 92% | 32% |
| 0.845 | 85% | 90% | 92% | 30% |
| 0.85 | 85% | 90% | 90% | 27% |
| 0.855 | 85% | 95% | 90% | 23% |
| 0.86 | 85% | 98% | 90% | 23% |
| 0.865 | 85% | 98% | 90% | 20% |
| 0.87 | 85% | 98% | 90% | 18% |

Mejor coseno por pregunta (p10 / p50 / p90):

| | bge | e5 |
|---|---|---|
| neg_en | 0.602 / 0.665 / 0.738 | 0.830 / 0.847 / 0.870 |
| neg_es | 0.596 / 0.647 / 0.691 | 0.801 / 0.824 / 0.851 |
| neg_pt | 0.610 / 0.643 / 0.682 | 0.808 / 0.826 / 0.856 |
| pos_en | 0.751 / 0.783 / 0.833 | 0.869 / 0.887 / 0.914 |
| pos_es | 0.632 / 0.692 / 0.753 | 0.829 / 0.844 / 0.875 |
| pos_pt | 0.642 / 0.699 / 0.753 | 0.838 / 0.856 / 0.876 |

