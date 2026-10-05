> **Idioma:** [English](../HANDSHAKE_THREAT_MODEL.md) · Español

# NIDO — Threat model del handshake P2P

> Decisión documentada ANTES de implementar (Fase Hardening, P2).

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
| Secreto box X25519 de identidad | **Bajo**: la `pk` de identidad solo se usa como identificador; el cifrado de mensajes usa efímeras. No descifra nada por sí sola. |
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
