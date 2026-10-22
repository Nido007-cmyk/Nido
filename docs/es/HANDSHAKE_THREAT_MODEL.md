> **Idioma:** [English](../HANDSHAKE_THREAT_MODEL.md) · Español

# NIDO — Threat model del handshake P2P

> Decisión documentada ANTES de implementar (Fase Hardening, P2).
>
> **Nota histórica (2026-10-08):** este documento registra el diseño del
> handshake **v2**. El protocolo vigente es HELLO v3 + CONFIRM v1 con
> **HKDF-SHA512** como KDF de sesión (no la construcción SHA-512 directa que
> se muestra abajo). Para el protocolo implementado, ver
> `CRYPTO_ARCHITECTURE.md`; para las auditorías de octubre 2026, ver
> `es/security/AUDITS_2026-10.md`. Este archivo se conserva como historia
> de diseño.

## Actores y supuestos

- **Alice y Bob**: dos NIDOs emparejados por QR en persona. El QR entrega la
  identidad de cada uno (clave pública) por un canal **auténtico** (verse las
  caras) pero no confidencial (un QR puede fotografiarse).
- **Atacante**: controla el canal Bluetooth (puede escuchar, interceptar,
  modificar, inyectar y reenviar todo; es el modelo Dolev-Yao sobre el
  enlace RFCOMM). NO ha comprometido ninguno de los dos teléfonos.
- **Canal**: RFCOMM sin cifrado del SO a propósito (el emparejamiento del
  sistema pediría PINs y confundiría; la seguridad la pone NIDO).
- **Primitivas**: X25519, Ed25519, XSalsa20-Poly1305, SHA-512 — todas de
  `tweetnacl`, auditadas y estándar. No se inventa ninguna primitiva.

## Qué protege el handshake v2

El handshake v2 autentica el intercambio de efímeros ligándolo a la
identidad verificada por QR:

```
HELLO v2 = { t, v:2, pk, eph, nonce, sig }
sig = Ed25519_sign("nido-hello-v2" | pk | eph | nonce)   con la clave de firma
                                                          entregada en el QR
clave de sesión = SHA-512("nido-session-v2" | X25519(ephA,ephB)
                           | nonce_min | nonce_max)[0:32]
```

### Ataques que resuelve

| Ataque | Cómo lo resuelve |
|---|---|
| **MITM sustituyendo el efímero** (el riesgo crítico del HELLO v1) | La firma cubre `pk‖eph‖nonce`. Sin la clave de firma del peer (solo en su teléfono), el atacante no puede forjar un HELLO con su propio `eph`. La verificación falla → socket cerrado, sin sesión. |
| **Suplantación de identidad** (atacante dice "soy Alice") | `pk` debe ser un contacto emparejado por QR y la firma debe verificar con la `spk` guardada en ese emparejamiento. |
| **Replay de un HELLO viejo para resucitar una sesión** | La clave de sesión incluye los nonces de AMBOS lados, ordenados canónicamente. Un HELLO repetido no reproduce la clave de ninguna sesión pasada (el otro nonce es fresco por conexión) ni permite predecir la nueva: el atacante no conoce el secreto efímero y no puede derivar la clave. |
| **Confusión de sesión por HELLO repetido dentro de la ventana** | Mitigado con límite de handshakes por peer (un HELLO válido por ventana de 15 s y por socket); un replay solo puede crear una sesión inútil que nadie más que el peer real podría usar, y el rate-limit evita el DoS por spam. |
| **Downgrade a HELLO v1 sin firma** | Fail closed: el receptor exige `v:2` con firma válida. Un peer con app antigua no conecta (mensaje claro: "actualiza el otro NIDO"). |

## R4 (2026-09-28): HELLO v3 + CONFIRM — secuestro de ruta cerrado

**Estado:** IMPLEMENTADO + PROBADO AUTOMÁTICAMENTE. **No** PROBADO
FÍSICAMENTE (fase 1 / A1–A2 en Tab A9+ pendientes), **no** AUDITADO
EXTERNAMENTE.

R4 reemplaza el handshake v2 en el cable (corte duro: `v != 3` se rechaza
antes de mutar ningún estado). El análisis v2 anterior sigue siendo válido
como historia; lo que sigue es el protocolo actual.

### Cable

```
HELLO v3 = { t:"nido-hello", v:3, pk, eph, nonce, ts, sig }
sig      = Ed25519_sign("nido-hello-v3|pk|eph|nonce|ts")

CONFIRM  = { t:"nido-confirm", v:1, pk, cn, pn, sig }
sig      = Ed25519_sign("nido-confirm-v1|pk|cn|pn")
```

`ts` = segundos Unix, firmado; se acepta dentro de ±600 s (constante
provisional, pendiente de pruebas con relojes reales). `cn` = el nonce
PROPIO del que envía el CONFIRM (visto en su HELLO); `pn` = el nonce del
receptor (visto en mi HELLO).

### La invariante central

> Un HELLO por sí solo JAMÁS modifica la tabla de rutas
> (`pkToMac`/`macToPk`). La ruta y la sesión solo se establecen después de
> verificar un CONFIRM válido ligado a AMBOS nonces de esa conexión.

En concreto: ante un HELLO válido el receptor verifica contacto + firma +
frescura, reclama atómicamente `(pk, nonce)` en una cache persistente
SQLCipher (`hello_nonce_cache`; un único `INSERT` — un conflicto UNIQUE
ES la señal de replay, fail-closed), envía su CONFIRM y no cambia nada
más. Ante un CONFIRM válido comprueba que la identidad coincide con el
HELLO pendiente, que `cn` cita el nonce del peer, que `pn` cita mi nonce
fresco, verifica la firma — y solo entonces establece la ruta y deriva la
sesión. Sin CONFIRM en 10 s → timeout fail-closed, sin ruta.

### Qué cierra R4 (frente al residual v2)

- **Secuestro de ruta B/F1 por replay de HELLO capturado (probado el
  2026-09-28):** el residual v2 — un replay cross-contexto con un nonce
  nunca visto — se cierra de dos formas: (1) la cache persistente
  `(pk, nonce)` rechaza CUALQUIER nonce repetido incluso tras reinicios
  (el reinicio era la mejor arma del atacante: borraba el set en memoria);
  (2) incluso un HELLO capturado FRESCO (nonce nuevo, firma válida) no
  puede mover la ruta: sin el CONFIRM en vivo del peer citando mi nonce
  fresco, no se crea ninguna ruta. El atacante necesitaría la signing key
  del peer para forjar el CONFIRM.
- **Marcado simultáneo:** si ambos teléfonos marcan a la vez, cada lado
  calcula `K = min(nonce_local, nonce_peer) ‖ max(nonce_local, nonce_peer)`
  por socket y conserva el socket con menor `K` — determinista e
  independiente del orden (vectores en `src/p2p/handshakeV3.test.ts`).

### Claim acotado (leer con atención)

R4 demuestra: **el poseedor de la signing key del peer participó en vivo
en ESE transcript.** NO demuestra:

- que el socket/MAC pertenezca físicamente al peer (un relay activo que
  reenvía bytes en vivo entre dos NIDOs reales sigue entregándolos — el
  peer realmente participó);
- entrega (un relay-then-drop tras el CONFIRM es un blackhole; N6 resuelve
  la semántica de entrega por separado);
- que el CONFIRM sea un recibo de entrega.

`HELLO_TS_SKEW_S = 600` es provisional hasta probarlo con relojes
desviados y reinicios en hardware real. La identidad P2P NO forma parte
del backup/restore: una instalación restaurada genera identidad fresca y
exige re-emparejar.

### Manejo de replay (resumen R4 — sustituye la entrada v2 de abajo)

1. **Mensajes**: sin cambios.
2. **HELLO v3**: `ts` firmado + claim atómico persistente `(pk, nonce)` +
   establecimiento de ruta condicionado al CONFIRM. Un HELLO repetido se
   rechaza en el claim; un HELLO fresco pero solitario (firma válida,
   nonce nuevo, sin peer vivo detrás) muere en la puerta del CONFIRM.
   Ninguno toca jamás la tabla de rutas.

### Autenticación de identidad

- La **identidad** de cada NIDO son dos claves ligadas al mismo dispositivo:
  - `pk` (X25519): identificador + cifrado. Se anuncia en el HELLO.
  - `spk` (Ed25519): firma. Se entrega **solo** en el QR de emparejamiento
    y se guarda en `p2p_contacts.sig_pk`.
- La cadena de confianza es: **QR (encuentro físico) → spk → firma del
  efímero → sesión**. Sin QR no hay `spk`, sin `spk` no hay sesión.

### Forward secrecy

- Las claves de sesión son **efímero–efímero** (X25519 entre secretos que se
  generan por conexión y se borran al cerrar el socket).
- Comprometer las claves de identidad (firma o box) **no** permite descifrar
  sesiones pasadas: los secretos efímeros ya no existen.
- Los mensajes en reposo (bandeja/cola) usan la base cifrada (SQLCipher, P3),
  no las claves de sesión.

### Manejo de replay (resumen)

1. **Mensajes**: ID único + `INSERT OR IGNORE` + filtro en memoria (ya
   existía; se mantiene).
2. **HELLO**: firma + nonce fresco por conexión + clave de sesión ligada a
   ambos nonces + rate-limit por peer. Un replay no filtra contenido ni
   resucita sesiones.

## P2P v4 (2026-10-21): quien recibe calla, y el saludo puede ir sellado

**Receptor silencioso en los dos transportes.** El teléfono que *recibe*
una conexión (Bluetooth o Wi-Fi local) no envía nada hasta que el HELLO de
quien llama demuestra que es un contacto emparejado (firma, frescura,
anti-replay). Antes del 2026-10-21 esto solo valía por Wi-Fi: por Bluetooth,
donde el servidor RFCOMM escucha en segundo plano, cualquier dispositivo
cercano que conectara al servicio de NIDO recibía nuestro HELLO firmado: un
identificador estable y una prueba firmada de presencia. Sin cambios en el
cable: quien llama siempre envió su HELLO primero.

**Saludo sellado (experimental, apagado por defecto).** El HELLO de quien
llama todavía lleva su clave pública permanente en claro. El saludo sellado
la quita:

- Cada pareja de contactos comparte una clave estática que nadie más tiene:
  `K_pareja = HKDF-SHA512(salt="nido-v4-pair", X25519(mi_sk, su_pk), info="nido-v4|pk_min|pk_max")`.
- Cada frame del saludo (HELLO v3 y CONFIRM v1 sin cambios) se sella: un `r`
  aleatorio nuevo, una etiqueta de 16 bytes `HKDF(salt=r, K_pareja, "nido-v4-tag|tipo")`
  y el cuerpo cifrado con `secretbox` bajo `HKDF(salt=r, K_pareja, "nido-v4-enc|tipo")`.
  En el cable: `{"t":"nido-s4", r, g, n, b}`, solo bytes de aspecto aleatorio.
- Quien recibe prueba la etiqueta contra cada contacto (siempre todos, sin
  salida temprana) y solo entonces abre el cuerpo. Dentro corren las mismas
  comprobaciones v3: firma, ventana de tiempo, nonce único, CONFIRM ligado a
  los dos nonces.
- Si un saludo empezó sellado, todos sus frames deben venir sellados con la
  misma clave. No hay vuelta a v3 dentro de un saludo sellado.
- Un teléfono anuncia que lo entiende con `"c4":1` en su HELLO v3 (pista no
  firmada). Quien llama sella solo si el ajuste «Saludo privado» está activo
  **y** el contacto lo anunció. Recibir saludos sellados funciona siempre.

Qué consigue: un observador pasivo no ve ninguna identidad ni puede enlazar
dos conexiones del mismo teléfono; un desconocido que llame no obtiene
nada; un HELLO sellado para B no se puede reenviar a otro contacto (solo se
abre con la clave de la pareja con B), lo que cierra el hueco de reenvío de
HELLO del v3.

Qué no: el tipo de frame `nido-s4` y su tamaño siguen delatando que se usa
NIDO; un atacante activo puede quitar la pista `c4` para que dos teléfonos
sigan en v3 (lo de hoy); un contacto, por definición, reconoce al otro.

## P2P v5 (0.1.46): clave nueva por mensaje y ML-KEM en cada conexión

Experimental, apagado por defecto (Ajustes → Seguridad). Solo se usa si los
**dos** teléfonos lo tienen activado; si no, la sesión sigue como se describe
arriba. Código: `src/p2p/ratchet.ts`, `src/p2p/pq.ts`, `src/p2p/protocol.ts`.

**Negociación (sin tocar el handshake).** Tras el handshake v3 cada lado
manda su `session_confirm`, sellado con la clave clásica de la sesión `SK`.
L es el lado con la clave de identidad menor y H el de la mayor.
- L (si tiene v5) mete una oferta: una clave de ratchet X25519 nueva `dh_L`
  y una clave pública ML-KEM-768 nueva `ek`.
- H (si tiene v5) pone `r5cap: 1` en su confirm.
- Todos los `session_confirm` se rellenan al mismo tamaño (4 KB): su tamaño
  no revela si llevan oferta. Su posición sí (es el primer frame de sesión
  de L).
- La oferta viaja dentro de un frame autenticado con `SK`: nadie puede
  quitarla ni cambiarla, solo descartar el frame entero. Eso deja a los dos
  en modo clásico. La pantalla del chat muestra cuándo una sesión va en v5
  y avisa si un contacto que ya usaba v5, y que no ha dicho (en un frame
  autenticado) que lo apagó, está conectado sin él.

**Arranque (como RatchetInitAlice/Bob de Signal).** H encapsula hacia `ek` →
`(ct, ss)`, deriva
`RK0 = HKDF-SHA512(sal="nido-v5-root", SK ‖ ss, info="nido-v5-root|pk_L|pk_H|H(ek‖ct)")`
y arranca como Alice con `dh_L` como clave de ratchet del otro. Sus frames v5
llevan `ct` hasta que oye un frame v5 de L. L desencapsula con el primer frame
v5 y arranca como Bob. Mientras L espera el primer v5 de H (como mucho 5 s
desde ver `r5cap`), retiene su cola para que lo encolado salga también en v5.

**Double Ratchet.** Los KDF de raíz y de cadena son HKDF-SHA512 con
etiquetas separadas (`nido-v5-rk`, `nido-v5-ck`, `nido-v5-mk`). Cada clave de
mensaje se usa una vez y se borra. Hay un paso DH cada vez que cambia quién
escribe. Claves saltadas: como mucho 256 por mensaje (`MAX_SKIP`, comprobado
sobre el total de la cadena vieja y la nueva antes de calcular nada) y 512
guardadas por conexión. Descifrar trabaja sobre una copia del estado y solo
la confirma —y solo entonces borra las claves retiradas— si el mensaje
autentica: un frame falso no cambia nada.

**Frame.** `0x05 ‖ flags ‖ dh(32) ‖ pn ‖ n ‖ [ct(1088)] ‖ nonce(24) ‖ secretbox`.
La cabecera se liga al mensaje derivando la clave de cifrado como
`HKDF(sal=mk, ikm=cabecera, "nido-v5-msg")`: un bit cambiado da otra clave.
Desde el primer frame v5 del otro lado se rechazan los clásicos, y cuando los
dos sentidos van en v5 la clave clásica `SK` se borra de la memoria.

**Qué consigue.**
- Secreto hacia atrás por mensaje: un estado robado después no abre los
  mensajes anteriores.
- Recuperación tras compromiso: tras un robo de estado, el siguiente cambio
  de turno cura la sesión (X25519 nuevo). Cada conexión nueva hace además
  un ML-KEM-768 nuevo: frente a un atacante cuántico la curación llega en la
  siguiente conexión.
- "Grabar ahora, descifrar después": la raíz mezcla ML-KEM-768 (FIPS 203)
  con X25519; lo grabado sigue cerrado salvo que se rompan los dos. La
  autenticación sigue siendo Ed25519, como en PQXDH de Signal: no protege
  contra un atacante cuántico activo durante la conexión.

**Qué no consigue.**
- La cabecera v5 (clave de ratchet, contadores) va sin cifrar, como en
  Signal sin cifrado de cabeceras: se pueden contar mensajes y ver turnos.
- El relleno oculta la longitud solo hasta una potencia de dos (512 B,
  1 KB, 2 KB…).
- La librería de ML-KEM (`@noble/post-quantum` 0.7.1) es JavaScript puro, no
  es de tiempo constante y no tiene auditoría independiente. El propio v5
  de NIDO tuvo una revisión independiente hecha por otro agente de IA, no
  una auditoría profesional.
- v5 todavía no se ha probado en dos teléfonos físicos; por eso viene
  apagado.

## Verificación formal (ProVerif, 2026-10-22)

`formal/` tiene dos modelos simbólicos del protocolo. CI los verifica en cada
cambio de `src/p2p/` (más detalles en `formal/README.md`).

**Demostrado, con un contacto malicioso C en juego:**
- secreto de los mensajes A↔B;
- secreto hacia adelante frente a la filtración posterior de las claves de firma;
- autenticidad inyectiva de los mensajes;
- en v5, que lo grabado hoy sigue secreto aunque X25519 se rompa después.

**Encontrado (esperado, todavía abierto):** *unknown key share* a nivel de
handshake. Ni la firma del HELLO v3 ni la del CONFIRM v1 nombran al otro
lado, así que un contacto malicioso C puede lograr que A y B terminen con la
misma clave de sesión creyendo cada uno que habla con otro.

No permite leer ni falsificar mensajes: el sobre lleva `from`/`to` dentro del
cifrado y el receptor los comprueba. En v5, además, la raíz de claves liga las
dos identidades.

Corrección prevista: un CONFIRM v2 que firme también la clave pública del
otro lado.

## Qué NO resuelve (límites honestos)

- **Peer comprometido**: si el teléfono de Bob tiene malware, Bob es un
  endpoint legítimo y el atacante lee todo lo que Bob recibe. Ningún
  protocolo lo evita; la defensa es el Keystore del SO + no hacer backup
  de claves (P6).
- **Ceremonia del QR**: si el atacante pega SU QR sobre el de Alice
  (sustitución física) y la víctima no verifica la huella en voz alta, el
  emparejamiento es con el atacante. La UI obliga a mostrar la huella y
  recomienda verificarla; no hay defensa criptográfica contra el usuario
  que omite el paso.
- **Negación de servicio por radio**: el atacante puede interferir el
  Bluetooth a nivel físico. Fuera del alcance del protocolo.
- **Deniability / repudio**: las firmas Ed25519 son no repudiables por
  diseño. NIDO prioriza autenticación sobre negación plausible.
- **Análisis de tráfico**: un observador ve cuándo hablan dos NIDOs y el
  tamaño aproximado de los frames (el contenido va cifrado).

## Consecuencias si una clave del dispositivo se compromete

| Clave comprometida | Impacto |
|---|---|
| Secreto de firma Ed25519 | **Grave y activo**: el atacante puede suplantar al dueño en handshakes futuros y establecer sesiones como él. NO puede leer sesiones pasadas (forward secrecy) ni mensajes ya entregados. Remedio: el dueño genera nueva identidad y re-empareja por QR a sus contactos. |
| Secreto box X25519 de identidad | **Bajo para la confidencialidad, real para la privacidad**: el cifrado de mensajes usa efímeras, así que no descifra nada por sí solo. Desde el v4 también deriva las claves de pareja del saludo sellado: quien lo tenga puede reconocer los saludos sellados de ese teléfono con sus contactos. |
| Secreto efímero de una conexión | **Acotado a esa conexión**: solo los mensajes de esa sesión. Se borra al desconectar. |
| Clave de la base (SQLCipher) | **Total local**: bandeja, cola e identidades en reposo. Protegida por Android Keystore (P3); el riesgo es un dispositivo rooteado con la app desbloqueada. |

## Por qué no Noise (decisión explícita)

Noise Protocol Framework (`Noise_XX`) sería la opción "de manual". Se
descarta por ahora porque:

1. No hay binding Noise auditado y mantenido para React Native/Expo 57;
   implementarlo a mano sobre tweetnacl sería **más** superficie inventada
   que el diseño actual.
2. El diseño v2 usa exactamente las propiedades que necesitamos de Noise
   (autenticación del efímero con la identidad + DH efímero-efímero +
   binding de transcript vía nonces) con primitivas auditadas y ~60 líneas
   de código revisable, contra cientos de un handshake Noise completo.

La construcción `SHA-512(dominio ‖ secreto_DH ‖ nonces)` como KDF es
práctica estándar (cf. libsodium `crypto_kdf` / HKDF con SHA-512). Queda
documentada aquí para futura auditoría externa.
