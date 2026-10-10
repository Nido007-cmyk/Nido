> **Idioma:** [English](../../../internal/economic/SETTLEMENT_ABSTRACTION.md) · Español

# NIDO Economic Layer — Abstracción de liquidación

**Estado:** RESEARCH / DESIGN ONLY. Sin implementación. No se implementa
ningún adapter, ningún rail, ningún token. Subordinado a
`../NIDO_PRINCIPLES.md` (§2: todo lo intercambiable es intercambiable) y a
`ECONOMIC_ARCHITECTURE.md`.

Etiquetas de decisión: **[FROZEN PRINCIPLES]** · **[PROVISIONAL]** ·
**[EXPERIMENTAL]** · **[OPEN QUESTIONS]**.

---

## 1. Principio: el protocolo no sabe qué es dinero

**[FROZEN PRINCIPLES]** El protocolo NIDO (envelopes, tareas,
idempotencia, expiración) **nunca** depende de un rail de pago concreto.
`TASK_REQUEST` no contiene campos de pago; la capa económica vive
**encima** del protocolo como mensajes de cotización/autorización y
**debajo** como adapters hacia rails. Cambiar de fiat a stablecoin a
créditos offline no cambia `TASK` ni `CAPABILITY`.

Consecuencia: todo lo que un rail necesita saber viaja en estructuras de
datos económicas versionadas (ver `ECONOMIC_ARCHITECTURE.md` §4), y todo
lo que un rail devuelve se normaliza a un resultado de liquidación común.
El protocolo nunca parsea "blockchain", "cuenta" ni "tarjeta".

---

## 2. PaymentAdapter / SettlementAdapter (rol abstracto)

El adapter es un **rol** con responsabilidades definidas, no una clase ni
una interfaz de código. Cada rail futuro lo materializa a su manera; la
capa económica solo exige el contrato de comportamiento:

**Responsabilidades del adapter:**

- **Declarar su rail**: identificador (`rail_id`, p. ej. `fiat/manual`,
  `offline-credits/v1`), unidades soportadas, finality esperada
  (instantánea / diferida / por confirmaciones), y si requiere
  conectividad.
- **Preparar** una instrucción de liquidación a partir de una autorización
  del Policy Engine: `{payment_id, amount (string decimal exacto), unit,
  rail_id, beneficiario (formato opaco del rail), concepto mínimo}`.
  El adapter **no** decide si el pago procede: recibe una autorización ya
  decidida y la ejecuta o la rechaza por imposibilidad técnica.
- **Ejecutar** la transferencia exactamente una vez por `payment_id`
  (idempotencia también a nivel de adapter: si el rail no es idempotente
  por sí mismo, el adapter mantiene el diario por `payment_id`).
- **Consultar estado**: `pendiente / asentado / fallido`, con referencia
  del rail para el recibo.
- **Reembolsar** por `refund_id`, con las mismas garantías de idempotencia.
- **Fracasar cerrado**: si el rail no confirma, el estado es `desconocido`
  y el diseño lo trata como **no liquidado** hasta prueba en contrario.
  **[FROZEN PRINCIPLES]** Un estado de liquidación ambiguo nunca se
  presenta como éxito. La ambigüedad se registra, se congela el
  `payment_id` (no se reintenta a ciegas) y se escala a humano.

**[FROZEN PRINCIPLES]** El adapter opera exclusivamente con las
credenciales del **settlement profile** acotado al budget vault
(`ECONOMIC_POLICY_MODEL.md` §3). Un adapter con acceso a fondos fuera del
vault es una configuración inválida: la capa económica debe negarse a
operar con él (fail-closed en configuración, no solo en ejecución).

**[PROVISIONAL]** Formato de datos del resultado de liquidación
normalizado (DATA, no código):

```json
{
  "payment_id": "9f2c…",
  "rail_id": "offline-credits/v1",
  "status": "settled | pending | failed | unknown",
  "amount": { "amount": "0.40", "unit": "USD" },
  "rail_reference": "opaco-para-el-rail",
  "settled_at": 1790000000123
}
```

---

## 3. Rails futuros: survey sin selección

**[FROZEN PRINCIPLES]** Este documento **no selecciona** ningún rail,
blockchain, moneda o proveedor. La lista siguiente es un survey de
candidatos conceptuales para validar que la abstracción los cubre a todos.
**No se implementa ninguno.**

| Rail candidato | Modelo de confianza | Finality | Requiere red |
|---|---|---|---|
| Fiat manual (el usuario paga fuera de banda) | humano | manual | no (registro local) |
| Proveedor bancario / de pagos | institución regulada | diferida | sí |
| Stablecoin / cripto (sin especificar cadena) | red + claves propias | por confirmaciones | sí |
| Token propio futuro (ver §5) | a definir si existe | a definir | a definir |
| Créditos offline bilaterales | contraparte conocida + techo acotado | local inmediata, global diferida | no |
| Rails futuros desconocidos | desconocido | desconocida | — |

**[PROVISIONAL]** Cada rail declara su modelo de finality y la capa
económica lo respeta: un rail con finality diferida no puede confirmar un
`SETTLE` como definitivo antes de su confirmación. El estado `unknown`
existe precisamente para los rails que no dan garantías síncronas.

---

## 4. Verify-before-settle: modos encuestados, ninguno universal

**[FROZEN PRINCIPLES]** No se asume `RESULT = WORK COMPLETED`. La
liquidación exige verificación previa según el modo que la **política del
pagador** acepte para esa capability. Se encuesta sin adoptar una solución
universal — cada modo tiene un modelo de confianza distinto y honesto:

1. **Deterministic verification.** El resultado es comprobable por función
   pura (hash del output esperado, prueba criptográfica, re-ejecución
   barata). El más fuerte cuando aplica; rara vez aplica a trabajo
   creativo o físico.
2. **Buyer confirmation.** El pagador (humano o su NIDO con política
   explícita) confirma recepción satisfactoria. Simple y honesto, pero no
   escala a micro-pagos autónomos sin fatiga.
3. **Mutual acknowledgement.** Ambas identidades firman la finalización.
   Requiere que el ejecutor coopere tras cobrar — orden de operaciones
   crítico: la firma de finalización debe preceder o acompañar al
   `SETTLE`, nunca ir después sin garantía.
4. **Attestation.** El dispositivo ejecutor atesta que ejecutó (p. ej.
   firma sobre `{task_id, output_hash}`). **Débil por diseño**: atesta
   ejecución, no corrección; un ejecutor malicioso atesta falsedades
   gratis. Solo útil combinado con reputación o staking — ambos fuera de
   alcance.
5. **Third-party verification.** Un verificador externo (otro NIDO, un
   servicio) dictamina. Introduce un tercero en quien confiar y a quien
   pagar: el verificador necesita su propio modelo de incentivos y su
   propia verificación. Regresión potencial al infinito; usar con
   escepticismo explícito.
6. **Escrow / dispute.** Los fondos se retienen hasta verificación o
   expiración con reembolso. **[OPEN QUESTIONS]** En un mundo sin servidor
   central, ¿quién es el escrow? Las formas honestas conocidas son:
   (a) un tercero de confianza explícito (recentraliza), o
   (b) bloqueo bilateral 2-de-2 con timeout de reembolso automático
   (no resuelve desacuerdo genuino, solo abandono). No se diseña escrow
   sin nombrar al custodio.

**[PROVISIONAL]** El `verification_method` declarado por el oferente es una
**oferta**, no un requisito: la política del pagador elige entre los modos
que acepta, y si no hay intersección, no hay trato (`DECLINE`, no
degradación silenciosa a un modo más débil).

---

## 5. Módulo de token opcional futuro: evaluación de funciones, no tokenomics

**[FROZEN PRINCIPLES]** No se diseña tokenomics en esta línea de
investigación. Explícitamente fuera de alcance: supply, allocation,
precio, especulación, fundraising, selección de blockchain, diseño de
smart contracts. Si algún día existe un token, estas decisiones se toman
entonces, con el usuario, desde cero.

Lo único que se evalúa aquí: **¿para qué funciones podría un token propio
tener utilidad real?** Candidatos (todos **[EXPERIMENTAL]**, ninguno
adoptado):

- **Micro-settlement**: pagos entre agentes por debajo del umbral práctico
  de rails fiat (comisiones, latencia). Utilidad real solo si el coste de
  liquidación es despreciable frente al importe.
- **Compute/resource exchange**: denominar y netear intercambio de cómputo
  y almacenamiento entre NIDO sin tocar fiat en cada micro-transacción.
- **Relay/storage services**: pagar a terceros (relays, almacenamiento)
  por servicios a la red de agentes, si esos servicios existen algún día.
- **Machine-to-machine settlement**: liquidaciones autónomas frecuentes
  donde la fricción humana (confirmar cada pago) es el cuello de botella.
- **Ecosystem incentives**: recompensar contribuciones verificables
  (vectores de test, relays honestos, datasets). La verificabilidad es el
  problema entero; sin ella, el incentivo financia el fraude.

**[FROZEN PRINCIPLES]** Desigualdades del token — válidas adopte o no se
adopte un token, hoy o en diez años:

- **TOKEN ≠ IDENTITY.** Tener tokens no crea, prueba ni sustituye la
  identidad NIDO.
- **TOKEN ≠ TRUST.** Un balance alto no hace confiable a un peer.
- **TOKEN ≠ REPUTATION.** Ver capa separada en `ECONOMIC_REDTEAM.md` §18.
- **TOKEN ≠ AUTHORITY.** Los tokens no otorgan permisos, no amplían
  capabilities, no eluden al Policy Engine.
- **TOKEN ≠ PERMISSION.** Tener más tokens **nunca** concede acceso
  adicional a datos privados o a capabilities no autorizadas.

Cualquier diseño futuro que viole una de estas igualdades no es "la
economía NIDO": es otro sistema con otro nombre.

**[PROVISIONAL]** Criterio de adopción honesto: un token propio solo se
justifica si resuelve un problema que los rails existentes + créditos
offline no resuelven, sin introducir una autoridad central de facto
(emisor, multisig de fundación, oráculo). Si el token necesita un
operador central para funcionar, no aporta nada frente a fiat y añade
riesgo.

---

## Registro de decisiones

| # | Decisión | Clasificación |
|---|---|---|
| 1.1 | El protocolo nunca depende de un rail concreto | FROZEN PRINCIPLES |
| 2.1 | Adapter como rol con responsabilidades, no como código | PROVISIONAL |
| 2.2 | Estado de liquidación ambiguo = no liquidado; se congela y escala a humano | FROZEN PRINCIPLES |
| 2.3 | Adapter solo con credenciales acotadas al vault; si no, fail-closed | FROZEN PRINCIPLES |
| 3.1 | Ningún rail seleccionado; survey solo para validar la abstracción | FROZEN PRINCIPLES |
| 3.2 | Cada rail declara su finality; la capa la respeta | PROVISIONAL |
| 4.1 | `RESULT ≠ WORK COMPLETED`; verificación previa exigida | FROZEN PRINCIPLES |
| 4.2 | Ningún modo de verificación universal; la política del pagador elige | FROZEN PRINCIPLES |
| 4.3 | Escrow sin custodio nombrado no se diseña | OPEN QUESTIONS |
| 5.1 | Sin tokenomics: no supply, allocation, precio, especulación, fundraising | FROZEN PRINCIPLES |
| 5.2 | Funciones candidatas del token evaluadas como hipótesis | EXPERIMENTAL |
| 5.3 | TOKEN ≠ IDENTITY / TRUST / REPUTATION / AUTHORITY / PERMISSION | FROZEN PRINCIPLES |
| 5.4 | Criterio de adopción: resolver lo que fiat+créditos no resuelven, sin centralizar | PROVISIONAL |

## Preguntas abiertas (este documento)

1. ¿Quién puede ser custodio de escrow en una red sin servidor central
   sin recentralizar la confianza?
2. ¿Cómo se expresa la finality de un rail desconocido futuro en el
   contrato del adapter sin romper la abstracción?
3. Para micro-settlement machine-to-machine, ¿qué umbral de fricción hace
   que un token propio supere a créditos offline neteados periódicamente?
4. ¿Debe el `rail_reference` ser verificable por terceros (auditoría del
   usuario en otro dispositivo) sin exponer datos del rail?
