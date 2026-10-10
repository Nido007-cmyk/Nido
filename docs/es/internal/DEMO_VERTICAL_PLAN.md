> **Idioma:** [English](../../internal/DEMO_VERTICAL_PLAN.md) · Español
# NIDO — Plan de Primera Demo Vertical: `calendar.availability.query/v1` (SOLO PREP)

**Estado: NO IMPLEMENTADO. NO EJECUTAR hasta que las compuertas GO de abajo
estén en verde.** Este documento es el guion del operador y el plan de
evidencia, para que la demo pueda ejecutarse el día que C-1 se verifique en
hardware. Preparar el guion ahora no autoriza construir la UI/flujos de la
demo antes de tiempo.

## Lo que la demo prueba (y lo que no)

Prueba: dos NIDOs negocian una consulta de disponibilidad de calendario de
teléfono a teléfono, offline, con el Policy Engine decidiendo, el Privacy
Budget contabilizando, y solo el intervalo permitido cruzando el cable. Cero
servidor, cero Internet.

NO prueba: readiness de producción, auditoría de seguridad, ni que la UI de
la demo sea final. La demo ejercita `calendar.availability.query/v1` SOLO —
la capability sigue BLOQUEADA para uso general hasta que el DoD de
conformance se complete (segunda implementación completa + tests
diferenciales + verificación Android de C-1).

## Compuertas GO / NO-GO (todas deben ser GO)

1. **C-1 verificado en hardware**: `docs/es/ANDROID_VALIDATION.md` §1–§7
   todos en PASS con evidencia. NO-GO en otro caso — sin excepciones.
2. **Emparejamiento funciona**: ambos teléfonos emparejados vía el flujo QR
   sobre Bluetooth (requiere el trabajo de permiso `CAMERA` señalado en
   `docs/ANDROID_BUILD.md`).
3. **Capability desbloqueada**: decisión explícita registrada desbloqueando
   `calendar.availability.query/v1` para esta demo (actualmente BLOQUEADA
   pendiente del DoD de conformance).
4. **Modelos presentes**: ambos teléfonos tienen los modelos requeridos
   pre-sembrados o descargados ANTES del modo avión (la app regula en
   `ModelManager.requiredModelsPresent()`).
5. **Política**: el teléfono B tiene una regla/permiso explícito de usuario
   para `calendar.availability.query/v1` desde la identidad del teléfono A
   (o la demo usa la ruta ASK_USER con el usuario aprobando en el
   dispositivo — registra cuál).

## Precondiciones (setup, con red aún permitida)

- [ ] Ambos teléfonos: APK instalado, onboarding completo, puerta
  biométrica funcionando.
- [ ] Ambos teléfonos: modelos presentes (verifica que el asistente de
  setup terminó).
- [ ] Teléfono B: el calendario contiene un fixture CONOCIDO — p. ej.
  ocupado 18:00–19:30, libre el resto del día de la demo. Registra el
  fixture; es el ground truth para las verificaciones de evidencia.
- [ ] Teléfono B: política para el NIDO de A registrada (permitir consulta
  de disponibilidad, o ASK_USER — decide de antemano y escríbelo).
- [ ] Teléfono A: conoce la identidad de B (emparejado). Anota la cadena de
  identidad NIDO de B.
- [ ] Ambos teléfonos: captura de logcat corriendo a archivos
  (`adb logcat -v time > demo-A.log` / `demo-B.log`).

## Guion del operador (modo avión ON, Bluetooth ON, Wi-Fi OFF — ambos teléfonos)

T+0 — **Aislar.** Ambos teléfonos: modo avión ON, luego Bluetooth ON
manualmente. Wi-Fi queda OFF. El operador verifica el ícono de avión en
ambas pantallas (foto).

T+1 — **A pregunta.** En el teléfono A, el operador dispara la consulta de
disponibilidad para el teléfono B ("¿B está libre 18:00–20:00 hoy?").
Registra la hora exacta y los parámetros exactos de consulta ingresados.

T+2 — **Transporte.** A→B: handshake NIDO + `TASK_REQUEST` sobre Bluetooth
RFCOMM. Evidencia a capturar: logcat en ambos teléfonos mostrando
connect, completitud del handshake y eventos de frame (sin Wi-Fi, sin
direcciones IP en ningún lado de los logs — grepea los logs por `192.168`,
`10.`, `wlan` después y espera nada).

T+3 — **B decide localmente.** El Policy Engine del teléfono B evalúa la
petición contra la regla local registrada en precondiciones. Evidencia:
log de B mostrando la decisión de política (`ALLOW` con restricciones, o
el prompt ASK_USER que el operador aprobó — haz screenshot del prompt si
así fue).

T+4 — **B consulta localmente.** B lee su PROPIA base de datos de
calendario en el dispositivo. Evidencia: log de B mostrando la consulta
local; sin llamadas de red durante esta ventana (logcat no muestra
HTTP/DNS — registra la ausencia).

T+5 — **El budget contabiliza.** El Privacy Budget de B consume las
unidades de disclosure para esta respuesta. Evidencia: log/estado de B
mostrando budget antes → después (registra ambos números).

T+6 — **B responde con SOLO el intervalo permitido.** Esperado, dado el
fixture: ocupado 18:00–19:30 → B devuelve libre/ocupado solo para la
ventana PREGUNTADA, p. ej. "busy 18:00–19:30, free 19:30–20:00". Lo que NO
debe cruzar: títulos de eventos, asistentes, ubicaciones, ni ningún tiempo
fuera de la ventana consultada. Evidencia: screenshot del resultado
recibido de A + log de B del payload exacto enviado.

T+7 — **A recibe.** El teléfono A muestra el intervalo. Evidencia:
screenshot de la pantalla de A; log de A mostrando la recepción.

T+8 — **Control negativo (misma sesión).** A pide una ventana MÁS AMPLIA
("¿libre todo el día?") o el calendario completo de B. Esperado: el Policy
Engine niega o el budget rechaza — A recibe una negativa, no datos.
Evidencia: screenshot + logs de la negativa. ESTA es la prueba de
minimum-disclosure; sin ella la demo está incompleta.

## Checklist de evidencia (todo requerido para un PASS)

1. Fotos: ícono de modo avión visible en ambos teléfonos durante la demo.
2. `demo-A.log`, `demo-B.log` con timestamps cubriendo T+0–T+8.
3. Screenshot: prompt/decisión de política de B (T+3).
4. Screenshot: intervalo recibido de A (T+7).
5. Screenshot: negativa en la consulta demasiado amplia (T+8).
6. Grep sobre ambos logs por indicadores IP/Wi-Fi → vacío (registra
   comando+salida).
7. Números de budget antes/después de B (T+5).
8. El payload exacto que B envió (del log de B) — verifica a mano que no
   contenga títulos/asistentes/ubicaciones/tiempos fuera de ventana.

## NO-GO explícito durante la corrida

- Si algún paso necesita Wi-Fi o datos móviles → STOP, registra, NO-GO.
- Si el calendario completo de B (o cualquier detalle de evento) aparece
  en A → STOP, registra, NO-GO.
- Si el prompt de política nunca aparece y los datos fluyen igual → STOP
  (posible bypass), registra, NO-GO.
- Si Bluetooth se cae y la app reintenta silenciosamente sobre otro
  transporte → STOP, registra, NO-GO (el cambio de transporte nunca debe
  ser silencioso).

## Después de la demo

Archiva toda la evidencia bajo `docs/evidence/<fecha>-vertical-demo/`,
escribe el resultado de una página (PASS/FAIL por ítem de evidencia), y
enlázao desde el tracking de C-1. Un PASS aquí no desbloquea la capability
para uso general — esa decisión sigue con el DoD de conformance.
