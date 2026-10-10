> **Idioma:** [English](../../internal/TEN_YEAR_REVIEW.md) · Español

# NIDO — Revisión de diseño a 10 años

**Propósito:** evaluar si el diseño puede sobrevivir cambios de
dispositivo, sistema operativo, modelo y criptografía durante 10+ años.
No se optimiza para teléfonos actuales.

**Estado:** diseño. Sin implementar.

---

## 1. Leyes fundamentales (candidatas a FROZEN CORE)

- `USER = AUTHORITY`
- `POLICY ENGINE = ENFORCEMENT`
- `MODEL = REASONING, NOT AUTHORITY`
- `TOOLS = CAPABILITIES`
- `TRANSPORT = DELIVERY, NOT TRUST`
- `REMOTE/EXTERNAL CONTENT = UNTRUSTED DATA`
- `MINIMUM DISCLOSURE BY DEFAULT`
- `A REQUEST CAN DESCRIBE WHAT ANOTHER NIDO WANTS. IT CAN NEVER DEFINE
  WHAT THIS NIDO IS AUTHORIZED TO DO.`
- `AUTONOMY MUST NEVER GROW SILENTLY`

Más dos invariantes: **fail-closed** ante lo desconocido/expirado/fuera
de política, y **sin downgrade silencioso** de seguridad.

---

## 2. Evaluación por dimensión (horizonte 10+ años)

| Dimensión | Veredicto | Razonamiento |
|---|---|---|
| Interoperabilidad entre implementaciones independientes | **Adecuado con reservas** | Canonicalización RFC 8785 + vectores oficiales + schemas cerrados lo hacen posible (S14). Riesgo: ambigüedades de spec que solo se descubren con 2+ implementaciones reales. No hay sustituto para una segunda implementación. |
| Crypto agility | **Fuerte** | Suites versionadas, negociación con transcript binding, identidad lógica separable del algoritmo, cadena de rotación que puede cruzar suites. Riesgo: la migración PQ real exigirá tamaños de firma/clave distintos — el envelope lo tolera (campos opacos), pero los transportes con MTU pequeña sufrirán. |
| Multi-device identity | **Adecuado con reservas** | Identidad → certificados → sesiones es el modelo correcto; roles primary/secondary y revocación sin servidor central escalan. Reserva: el sync de políticas entre dispositivos (C-11) y la recuperación tras perder todos los primaries siguen abiertos. |
| Revocación | **Adecuado con reservas** | Expiración corta + gossip en contacto directo + frescura exigible para `high`. Sin servidor central = sin punto único de fallo ni de censura. Reserva: la latencia de propagación en redes solo-relay es la ventana de ataque (C-8); está acotada, no eliminada. |
| Offline-first | **Fuerte** | Todo el núcleo (identidad, política, memoria, protocolo, cola) funciona sin red por diseño; el relay es opcional y reemplazable. La prueba de dos teléfonos en modo avión sigue siendo el baseline. |
| Transport independence | **Fuerte** | El envelope es idéntico en cualquier medio; la interfaz Transport es mínima (bytes opacos). Añadir un transporte en 2032 no toca el protocolo. |
| Provider independence | **Fuerte** | Los providers (modelo, relay, servicios) son intercambiables tras interfaces; ninguno es identidad ni autoridad. |
| Model independence | **Fuerte** | Es el principio arquitectónico central (EL MODELO NO ES NIDO). El protocolo no contiene prompts; un NIDO con un paradigma de IA distinto puede interoperar si respeta schemas y política. |
| Capability versioning | **Fuerte** | Nombre + versión exactos, versionado independiente del protocolo, anti-shadowing, sin fallback silencioso. El pinning de versiones en las reglas de autonomía (C-5) cierra la expansión silenciosa. |
| Protocol evolution | **Adecuado con reservas** | Negociación de versiones fail-closed + deprecación con sunset. Reserva: la evolución real necesita gobernanza (quién decide `nido/2.0`), hoy sin definir más allá de "sin autoridad central". |
| Migración durante décadas | **Abierto** | Rotación de identidad con cadena verificable y expiración como revocación implícita dan el mecanismo. Falta: historia probada. La primera migración real (p. ej. a PQ) será el test; hasta entonces es teoría bien formada. |

---

## 3. Clasificación

### FROZEN CORE (principios, no formatos — lo mínimo que debe sobrevivir)

1. Las 9 leyes fundamentales (§1).
2. Fail-closed ante lo desconocido, expirado o fuera de política.
3. Sin downgrade silencioso de seguridad.
4. At-most-once para operaciones con side effects (idempotencia como
   principio, no el campo `task_id` concreto).
5. El consentimiento debe ser explícito, con scope y revocable.
6. La revocación debe ser posible sin autoridad central.
7. La identidad lógica sobrevive a los dispositivos.

Nada de wire formats, algoritmos, nombres de campos o timeouts concretos
se congela: todo eso está versionado precisamente para poder evolucionar.

### PROVISIONAL (probablemente estable; puede evolucionar con experiencia)

- Envelope actual: campos, canonicalización JCS, firma-sobre-canónico.
- Suites `nido-crypto/1`, negociación y transcript binding.
- Taxonomía de errores y tipos de mensaje (tarea, negociación, grupo,
  consentimiento).
- Formato de certificado de dispositivo y QR v2.
- Schemas de capabilities del catálogo inicial y sus disclosures.
- Reglas de autonomía (`autonomy.rule/v1`), budgets y sus parámetros.
- Rendezvous IDs por época y alias de sesión (fase 1 de metadatos).

### EXPERIMENTAL (no congelar; investigación)

- Blind routing tokens, sealed-sender bajo demanda, private contact
  discovery.
- DP para agregados multi-sujeto.
- Criptografía de grupo (MLS vs sender keys vs pairwise permanente).
- IFC completo entre nodos de task graphs.
- Sync de políticas multi-dispositivo.
- "Nutrition labels" de providers remotos.

### OPEN QUESTION

Recuperación tras perder todos los primaries; tolerancia de reloj en
dispositivos offline prolongado; relay buzón vs reenvío en caliente;
direccionamiento P2P sin servidor central; DSL de constraints;
fatiga de diálogos ASK; revalidación temporal en graphs largos; intervalo
de rotación de identificadores de discovery; cover traffic; gobernanza de
`nido/2.0`.

---

## 4. Decisiones que serían costosas de cambiar en el futuro

1. **Identidad = clave pública de largo plazo.** La rotación con cadena
   verificable da salida, pero con millones de identidades la inercia del
   ecosistema (contactos, QR impresos) haría costosa una migración de
   formato de identidad.
2. **JSON canónico como wire format.** Cambiar a binario después partiría
   la red en dos; la decisión es pegajosa aunque hoy sea correcta
   (debuggeable, vectores triviales).
3. **Sin infraestructura central.** Añadir después un servidor "opcional"
   para revocación o discovery erosionaría offline-first; es una decisión
   casi irreversible en la práctica.
4. **Confianza por defecto cero entre NIDO.** Pasar a un modelo con
   "contactos de confianza implícita" rompería el threat model; mantener
   el default-deny es barato hoy y carísimo de reintroducir mañana.
5. **El relay no es autoridad ni ve plaintext.** Cualquier concesión futura
   (p. ej. "el relay modera spam") reabriría RT-9/A-3.

## 5. Todavía no suficientemente seguro para implementar

- **Sync de políticas multi-dispositivo** (C-11): hasta que las políticas
  converjan, hay puerta blanda. Restricción temporal: `high` solo en
  primary.
- **IFC completo en task graphs** (C-3): la contabilidad agregada es un
  piso, no un techo verificable.
- **Ventana de revocación en redes solo-relay** (C-8): acotada por
  expiración, no eliminada.
- **Recuperación de identidad** (pérdida de todos los primaries): sin
  mecanismo diseñado, no hay implementación honesta.
- **Group crypto**: diferido correctamente; el modo pairwise actual no
  escala a grupos grandes sin reevaluar.
- **Reloj y expiración** en dispositivos offline durante semanas: sin
  datos reales, los umbrales son conjeturas.

## 6. Recomendación del siguiente paso

**No implementar el protocolo todavía.** El orden propuesto:

1. **Cerrar C-1 con verificación Android real** (sigue pendiente):
   sin almacenamiento cifrado + Keystore verificados, todo lo demás se
   construye sobre arena.
2. **Conformance suite ejecutable antes que red:** implementar solo el
   subconjunto máquina-verificable y sin red — canonicalización,
   parse/validación de envelope, pipeline de política en memoria — contra
   los vectores oficiales, tras feature flag, sin transporte.
3. **Segunda implementación del subconjunto** (p. ej. un validador en otro
   lenguaje) para cazar ambigüedades de spec: es el único test real de
   interoperabilidad.
4. Recién entonces: transporte Bluetooth real con el protocolo nuevo,
   empezando por `CAPABILITY_QUERY`/`TASK_REQUEST` de una sola capability
   de lectura (`availability.query/v1`).

La base de 10 años no se compra con más features, sino con menos
superficie congelada y más vectores que la verifiquen.
