# Verificación formal del protocolo P2P de NIDO

Aquí están los modelos del protocolo NIDO-a-NIDO para
[ProVerif](https://bblanche.gitlabpages.inria.fr/proverif/), una herramienta
que prueba propiedades de seguridad contra un atacante que controla toda la
red (modelo Dolev-Yao). El atacante puede leer, borrar, reenviar e inventar
cualquier mensaje.

CI (`.github/workflows/formal.yml`) los verifica en cada cambio de `formal/` o
`src/p2p/`, y también una vez por semana. Los resultados se comparan con
`expected.txt`. Si uno cambia, la comprobación falla.

## Qué se prueba

### `nido_handshake.pv`: handshake v3 + capa de mensajes

Actores: A y B, honestos y emparejados por QR. C es un **contacto
malicioso** de los dos: el atacante tiene su clave de firma.

| # | Propiedad | Resultado |
|---|-----------|-----------|
| 1–2 | Lo que A y B se mandan es secreto | ✅ demostrado |
| 3 | Secreto hacia adelante: aunque después se filtren las claves de firma de A y B, lo enviado antes sigue secreto | ✅ demostrado |
| 4–5 | Autenticidad: si B acepta un mensaje "de A", A lo envió a B (sin repeticiones) | ✅ demostrado |
| 6–7 | Acuerdo de identidades a nivel de handshake con CONFIRM **v1**: si A acepta una sesión con B, ¿B la ejecutó (mismos nonces) creyendo hablar con A? | ❌ ataque encontrado (ver abajo) |

### `nido_handshake_v2.pv` — lo mismo con CONFIRM v2 (0.1.48)

La firma v2 del CONFIRM nombra también al destinatario.

| # | Propiedad | Resultado |
|---|-----------|-----------|
| 1–5 | Igual que arriba | ✅ demostrado |
| 6–7 | Acuerdo de identidades a nivel de handshake | ✅ **demostrado**: el ataque de v1 desaparece |

### `nido_v5_pq.pv`: v5 (X25519 + ML-KEM-768 + Double Ratchet)

| # | Propiedad | Resultado |
|---|-----------|-----------|
| 1 | **Grabar ahora, descifrar después:** un atacante que graba la sesión y más tarde rompe X25519 con un ordenador cuántico no puede leer lo enviado en v5 | ✅ demostrado |
| 2 | Control: ese mismo atacante **sí** puede leer lo enviado solo con la clave clásica | ❌ ataque encontrado (esperado: comprueba que el modelo no es demasiado optimista) |
| 3 | Autenticidad del primer mensaje v5 | ✅ demostrado |
| 4 | Secreto del mensaje v5 durante la sesión, también con el contacto malicioso C | ✅ demostrado |

## El ataque de CONFIRM v1: "unknown key share" (y cómo se cerró)

Con CONFIRM v1, ni la firma del HELLO ni la del CONFIRM nombran al otro
lado. Por eso un contacto malicioso C puede conseguir que A acepte una sesión
"con B" que B cree estar teniendo con C. No permite leer ni falsificar
mensajes (consultas 1–5): el sobre lleva `from`/`to` dentro del cifrado y se
rechaza.

**0.1.48 lo cierra (CONFIRM v2):**

1. **Firma v2.** El CONFIRM lleva una segunda firma,
   `nido-confirm-v2|yo|destinatario|cn|pn` (campo `s2`). Un CONFIRM hecho
   para otro destinatario no verifica.
2. **Exigencia por contacto.** Tras la primera v2 válida de un contacto, el
   contacto queda marcado y desde entonces su CONFIRM sin v2 se rechaza (es
   una degradación). Si la marca no se puede leer, se rechaza igual.
3. **Primera conexión, también cubierta** (completo desde 0.1.52). Con un
   contacto todavía sin marcar, el CONFIRM sin v2 se acepta. Desde 0.1.49, los
   contactos emparejados con un QR nuevo ya vienen marcados. Lo que pase
   después lo vigila la sesión cifrada, que nadie puede tocar:
   - Si el otro lado dice `cf2` (firma v2) y su CONFIRM llegó sin ella,
     alguien la quitó: la sesión no se usa, se corta y se marca al contacto.
   - Si llega un frame que autentica con la clave de sesión pero viene de otra
     identidad o va dirigido a otra, eso es justo el *unknown key share*: se
     corta y, si decía `cf2`, se marca al contacto. Esto lo encontró una
     revisión independiente: hasta 0.1.51 ese frame se descartaba en silencio.
   - Si el atacante descarta esos frames, la sesión nunca se activa (ningún
     mensaje se envía por ella), pero tampoco se detecta.

   Los modelos formales cubren el modo estricto (v2 exigida). Este último
   tramo, la primera conexión con un contacto sin marcar, está cubierto por
   pruebas (`unknownKeyShare.test.ts`, `confirmV2.session.test.ts`).
4. **Con un NIDO viejo**, que no sabe firmar v2, la conexión sigue
   funcionando como antes, porque ese teléfono solo puede usar v1. Se aplica
   el modelo v1: los mensajes siguen protegidos (consultas 1–5). El punto
   débil desaparece cuando ese teléfono se actualiza.

Las consultas 6–7 no dependen del papel de cada uno: dos teléfonos que se
llaman a la vez (los dos iniciadores) forman una sesión legítima, como en el
código.

## Abstracciones (léalas antes de citar estos resultados)

- **Criptografía ideal.** X25519 es Diffie-Hellman ideal y Ed25519 es firma
  ideal. HKDF es una función aleatoria, secretbox es cifrado autenticado ideal
  y ML-KEM es un KEM ideal (IND-CCA). Se prueba el *diseño* del protocolo, no
  las bibliotecas.
- **El modelo no es el código.** Está escrito a mano a partir de los
  archivos que cita en su cabecera. Si el código cambia, hay que actualizar el
  modelo.
- **Reloj:** cada HELLO lleva un valor nuevo y público. El atacante puede
  reenviar HELLOs viejos tal cual.
- **Valores nuevos al principio de la sesión.** Los efímeros, nonces y
  claves KEM se crean antes de leer de la red. Es equivalente, porque un valor
  aleatorio que todavía no se ha usado no cambia nada. Sin esto ProVerif no
  termina: los nombres simbólicos dependerían de las entradas y el atacante
  podría anidarlos sin fin reflejando HELLOs entre A y B.
- **Composición modular para v5.** `nido_v5_pq.pv` parte de una clave
  clásica compartida por A y B, que es lo que demuestra `nido_handshake.pv`.
  No vuelve a modelar las firmas. Con el contacto malicioso C, el atacante
  conoce la clave de sesión.
- **Solo el primer paso del ratchet.** Las propiedades de los pasos
  siguientes (ventana de claves saltadas, retroceso de estado) se cubren con
  pruebas unitarias y fuzzing (`src/p2p/ratchetV5.test.ts`, `src/p2p/fuzz/`),
  no aquí.

## Cómo ejecutarlo

```sh
# ProVerif 2.05 (https://bblanche.gitlabpages.inria.fr/proverif/)
python3 formal/check.py                     # todos los modelos
python3 formal/check.py nido_handshake.pv   # uno solo
```

Cada ejecución guarda su salida completa en `formal/out/<modelo>.log`.
