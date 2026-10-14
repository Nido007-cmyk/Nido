# Calibración búsqueda multilingüe (generado)

- Generado: 2026-10-14T06:08:00.748334+00:00
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
| bge hoy (frases) | 50% | 98% | 48% | 21% |
| e5 con pisos de bge | 100% | 100% | 100% | 100% |
| e5 piso 0.81 margen 0.3 | 85% | 100% | 90% | 20% |
| e5 piso 0.81 margen 0.4 | 85% | 100% | 90% | 20% |
| e5 piso 0.81 margen 0.5 | 85% | 100% | 90% | 20% |
| **e5 en la app** (integrado 0.81, paquetes 0.84) | 85% | 100% | 90% | 20% |
| bge re-ajustado piso 0.6 | 50% | 98% | 48% | 21% |

Una sola palabra:

| | es | en | pt | falsos |
|---|---|---|---|---|
| bge hoy | 17% | 83% | 17% | 0% |
| **e5 en la app** (integrado 0.87, paquetes 0.88) | 83% | 83% | 83% | 0% |
| e5 piso 0.87 margen 0.3 | 83% | 83% | 83% | 0% |
| e5 piso 0.87 margen 0.4 | 83% | 83% | 83% | 0% |
| e5 piso 0.87 margen 0.5 | 83% | 83% | 83% | 0% |

Distintividad (mejor − media de los puestos 10–50) a los pisos de la app:

| gap | es | en | pt | falsos | 1 palabra es/en/pt | falsos 1p |
|---|---|---|---|---|---|---|
| 0.0 | 85% | 100% | 90% | 20% | 83%/83%/83% | 0% |
| 0.01 | 85% | 100% | 90% | 20% | 83%/83%/83% | 0% |
| 0.015 | 85% | 100% | 90% | 20% | 83%/83%/83% | 0% |
| 0.02 | 85% | 100% | 90% | 17% | 83%/83%/83% | 0% |
| 0.025 | 85% | 100% | 90% | 14% | 83%/83%/83% | 0% |
| 0.03 | 85% | 100% | 90% | 10% | 83%/83%/83% | 0% |
| 0.035 | 82% | 98% | 90% | 8% | 83%/83%/83% | 0% |
| 0.04 | 82% | 98% | 88% | 7% | 83%/83%/83% | 0% |
| 0.05 | 80% | 95% | 80% | 3% | 83%/83%/83% | 0% |
| 0.06 | 62% | 90% | 65% | 1% | 83%/83%/83% | 0% |

Distintividad por pregunta (p10 / p50 / p90):

| | e5 |
|---|---|
| neg_en | 0.017 / 0.027 / 0.044 |
| neg_es | 0.017 / 0.025 / 0.038 |
| neg_pt | 0.019 / 0.027 / 0.042 |
| pos_en | 0.062 / 0.090 / 0.118 |
| pos_es | 0.048 / 0.072 / 0.104 |
| pos_pt | 0.048 / 0.075 / 0.095 |

Mejor coseno por pregunta (p10 / p50 / p90):

| | bge | e5 |
|---|---|---|
| neg_en | 0.503 / 0.544 / 0.603 | 0.798 / 0.810 / 0.829 |
| neg_es | 0.543 / 0.576 / 0.611 | 0.781 / 0.797 / 0.815 |
| neg_pt | 0.564 / 0.589 / 0.621 | 0.783 / 0.799 / 0.814 |
| pos_en | 0.703 / 0.761 / 0.822 | 0.848 / 0.875 / 0.909 |
| pos_es | 0.580 / 0.639 / 0.732 | 0.808 / 0.829 / 0.875 |
| pos_pt | 0.582 / 0.649 / 0.723 | 0.821 / 0.840 / 0.872 |

## Corpus: builtin+vital

| | es recall | en recall | pt recall | falsos (media) |
|---|---|---|---|---|
| bge hoy (frases) | 25% | 95% | 35% | 92% |
| e5 con pisos de bge | 78% | 88% | 80% | 100% |
| e5 piso 0.805 margen 0.3 | 85% | 88% | 85% | 91% |
| e5 piso 0.815 margen 0.4 | 78% | 88% | 82% | 76% |
| e5 piso 0.815 margen 0.5 | 78% | 88% | 80% | 76% |
| **e5 en la app** (integrado 0.81, paquetes 0.84) | 85% | 90% | 92% | 33% |
| bge re-ajustado piso 0.64 | 28% | 95% | 35% | 63% |

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
| 0.81 | 78% | 88% | 80% | 80% |
| 0.815 | 80% | 88% | 82% | 76% |
| 0.82 | 80% | 88% | 88% | 69% |
| 0.825 | 82% | 90% | 88% | 57% |
| 0.83 | 85% | 90% | 88% | 52% |
| 0.835 | 85% | 90% | 90% | 42% |
| 0.84 | 85% | 90% | 92% | 33% |
| 0.845 | 85% | 90% | 92% | 32% |
| 0.85 | 85% | 90% | 90% | 29% |
| 0.855 | 85% | 95% | 90% | 26% |
| 0.86 | 85% | 98% | 90% | 26% |
| 0.865 | 85% | 98% | 90% | 23% |
| 0.87 | 85% | 98% | 90% | 22% |

Distintividad (mejor − media de los puestos 10–50) a los pisos de la app:

| gap | es | en | pt | falsos | 1 palabra es/en/pt | falsos 1p |
|---|---|---|---|---|---|---|
| 0.0 | 85% | 90% | 92% | 33% | 83%/100%/83% | 0% |
| 0.01 | 85% | 98% | 92% | 33% | 83%/100%/83% | 0% |
| 0.015 | 85% | 100% | 92% | 33% | 83%/100%/83% | 0% |
| 0.02 | 85% | 100% | 92% | 33% | 83%/100%/83% | 0% |
| 0.025 | 85% | 100% | 90% | 28% | 83%/100%/83% | 0% |
| 0.03 | 85% | 100% | 90% | 22% | 83%/100%/83% | 0% |
| 0.035 | 82% | 98% | 90% | 20% | 83%/100%/83% | 0% |
| 0.04 | 82% | 98% | 88% | 16% | 83%/100%/83% | 0% |
| 0.05 | 80% | 95% | 80% | 6% | 83%/83%/83% | 0% |
| 0.06 | 62% | 92% | 65% | 1% | 83%/83%/83% | 0% |

Distintividad por pregunta (p10 / p50 / p90):

| | e5 |
|---|---|
| neg_en | 0.021 / 0.031 / 0.049 |
| neg_es | 0.020 / 0.029 / 0.044 |
| neg_pt | 0.021 / 0.030 / 0.048 |
| pos_en | 0.062 / 0.090 / 0.118 |
| pos_es | 0.048 / 0.072 / 0.104 |
| pos_pt | 0.048 / 0.075 / 0.095 |

Mejor coseno por pregunta (p10 / p50 / p90):

| | bge | e5 |
|---|---|---|
| neg_en | 0.610 / 0.658 / 0.715 | 0.830 / 0.847 / 0.871 |
| neg_es | 0.597 / 0.647 / 0.691 | 0.801 / 0.824 / 0.849 |
| neg_pt | 0.612 / 0.644 / 0.690 | 0.808 / 0.824 / 0.853 |
| pos_en | 0.751 / 0.783 / 0.833 | 0.869 / 0.887 / 0.914 |
| pos_es | 0.632 / 0.692 / 0.753 | 0.829 / 0.844 / 0.875 |
| pos_pt | 0.642 / 0.699 / 0.753 | 0.838 / 0.856 / 0.876 |

