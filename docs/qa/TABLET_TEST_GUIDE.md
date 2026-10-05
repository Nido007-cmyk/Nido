# Guía de validación en tablet — NIDO standalone (uso privado)

**Para:** prueba en un solo dispositivo — Galaxy Tab A9+ 5G (SM-X218U)
**Idioma de esta guía:** español · **Idioma de la app:** inglés (probar §7)
**Fecha de preparación:** 2026-09-27

> ⚠️ Este APK es un **artifact de validación**, no una release distribuible.
> Está firmado con un **certificado Android Debug TEMPORAL** — no usar esta
> firma para ninguna distribución más amplia.

## 0. El archivo: qué vas a descargar

| Dato | Valor |
|------|-------|
| Archivo | `nido-standalone-apk.zip` (contiene un solo archivo: `app-release.apk`) |
| SHA-256 del APK | `0ee2bc9f8ca3a6eb3694b4af2d674e9f06f341158bed40f18115d3f208b3ae57` |
| Tamaño exacto del APK | **130,708,855 bytes** |
| Procedencia | CI run 36341581820, commit a4b55a07 (= árbol idéntico a 2a9c4c4, Fase B) |
| Link privado | (ver QR abajo) |
| El link expira | **martes 2026-09-29, 13:13 (hora de Arizona)** — después deja de funcionar |

**Cómo descargar:** escanea el QR con la cámara de la tablet → se descarga el
ZIP (~65.6 MB). QR: `docs/qa/nido-standalone-qr.png` (adjunto en el mensaje).

### 0.1 Verifica que el archivo es el correcto (no te saltes esto)

1. Abre **Mis archivos** → **Descargas** → toca el ZIP `nido-standalone-apk.zip`
   → **Extraer** (la tablet sabe abrir ZIPs sola).
2. Entra a la carpeta extraída y mantén pulsado `app-release.apk` → **Detalles**.
3. Comprueba el tamaño: debe decir **130,708,855 bytes** exactos.
   - ✅ Si coincide: es el artifact preservado. Sigue.
   - ❌ Si NO coincide: **para aquí** y avísame — no instales.
4. (Opcional, más fuerte) Instala del Play Store una app tipo "SHA256 Checker",
   calcula el hash de `app-release.apk` y compáralo letra por letra con el
   SHA-256 de la tabla de arriba.

## 0.2 Resultados de la primera sesión (2026-09-27, ~13:20 MST)

| Prueba | Resultado |
|--------|-----------|
| Instalación (§1) | ✅ **PASS** — el APK se instala correctamente |
| P1 — arranque standalone (§2) | ❌ **FAIL** — la app crashea al arrancar |

**Detalle del crash:** al abrir NIDO se muestra brevemente la pantalla de
carga/inicio y la app se cierra sola volviendo al launcher de Android.
Reproducido **2 veces**, incluyendo una vez desde Ajustes → Apps → NIDO →
**Abrir**. La app **NO se desinstaló** y sus datos **NO se borraron**: todo se
preserva intacto para el diagnóstico.

**Siguiente paso:** capturar el log del crash con la sección **§2b** antes de
continuar con el resto de las pruebas. No intentes arreglar nada.

## 1. Instalación

1. Toca `app-release.apk` en Mis archivos.
2. Android pedirá **"Permitir instalar apps desconocidas"** → actívalo para
   Mis archivos (solo esta vez).
3. Si Play Protect dice "App no segura / editor desconocido": es normal, es
   nuestra firma temporal de pruebas. Toca **Más detalles → Instalar de todos modos**.
4. ✅ Pasa si: la app se instala sin errores. Anota la hora.

## 2. P1 — Arranque standalone en frío (la prueba más importante)

Objetivo: demostrar que la app vive **sin** ordenador, sin Metro, sin `adb`,
sin servidor de desarrollo.

1. **Cierra la app del todo**: botón Recientes → desliza NIDO fuera (o
   Ajustes → Apps → NIDO → Forzar detención).
2. Activa el **modo avión**.
3. Abre NIDO.
4. ✅ Pasa si: la app abre y muestra su pantalla inicial/onboarding **sin
   errores de conexión** y sin quedarse en blanco.

## 2b. Captura del crash — informe de errores (hacer ANTES de seguir)

**No desinstales NIDO ni borres sus datos.** El informe de errores contiene el
log del sistema con el crash; sin ese archivo no podemos saber qué falló.

### Camino principal — solo con la tablet (sin root, sin ordenador)

1. Abre **Ajustes** → **Acerca de la tablet** → **Información de software**.
2. Toca **Número de compilación** 7 veces seguidas (puede pedirte el PIN de
   la tablet). Verás el aviso "¡Ya eres desarrollador!".
3. Vuelve atrás a **Ajustes**: abajo del todo aparece **Opciones de
   desarrollador** → tócalo.
4. Toca **Informe de errores**. Empieza a generarse — la tablet puede ir
   lenta 1–3 minutos, es normal. **No cierres nada ni bloquees la tablet.**
5. Cuando termine aparece la notificación **"Informe de errores capturado"**
   → tócala → **Compartir** → envíamelo (WhatsApp, correo, Drive…).
6. El archivo es un ZIP (`bugreport-*.zip`) — **envíalo completo**, sin
   extraerlo.

**Archivo a enviar:** el ZIP del informe de errores, completo.

### Camino alternativo — si tienes un ordenador a mano

1. Activa las Opciones de desarrollador como en los pasos 1–3 de arriba.
2. En **Opciones de desarrollador** activa **Depuración USB**.
3. En el ordenador instala **platform-tools** (busca "SDK Platform Tools"
   en developer.android.com) y conecta la tablet por USB.
4. En la tablet acepta **"Permitir depuración USB"** cuando lo pida.
5. Abre NIDO en la tablet para reproducir el crash.
6. En el ordenador ejecuta: `adb logcat -b all -d > nido-crash.log`
   (o el informe completo con: `adb bugreport nido-bugreport`).
7. Envíame el archivo generado.

**Archivo a enviar:** `nido-crash.log` (o el ZIP producido por `adb bugreport`).

## 3. P2 — Setup inicial, navegación y UI básica

1. Quita el modo avión (vuelve el WiFi) — el setup necesita descargar el modelo.
2. Completa el asistente de inicio paso a paso.
3. Recorre: chat, drawer/menú, ajustes. Toca los botones principales.
4. ✅ Pasa si: el setup termina, la navegación funciona y no hay pantallas en
   blanco ni textos cortados/raros. Anota cualquier cosa que se vea rota.

## 4. P3 — Descarga del modelo + chat 100% offline

1. En el setup (o donde la app lo pida), descarga el modelo (~1 GB). Tarda
   varios minutos con buen WiFi — es normal. **No cierres la app mientras descarga.**
2. Cuando termine, activa el **modo avión** otra vez.
3. Pregúntale algo simple, p. ej.: *"What is 12 times 8?"*
4. Espera la respuesta completa y anota **aprox. cuántos segundos tardó** en
   empezar a responder y en terminar.
5. ✅ Pasa si: responde sin internet. ❌ Falla si: dice que necesita conexión,
   se queda colgada (ANR) o se cierra sola (crash).

## 5. P4 — English-first (comportamiento de 1390157)

1. La app debe estar en **inglés** por defecto al instalarse.
2. Ve a Ajustes → Idioma → cambia a **español** → todo debe traducirse.
3. Vuelve a inglés → cierra la app del todo → ábrela → debe seguir en inglés
   (selección persistida).
4. ✅ Pasa si: inglés por defecto, cambio completo de idioma y la selección se
   recuerda. Anota cualquier texto que quede sin traducir.

## 6. P5 — Usage Stats

1. Busca la pantalla de **Usage Stats** / estadísticas de uso en la app.
2. Úsala un rato (un par de preguntas al chat) y vuelve a mirarla.
3. ✅ Pasa si: muestra datos coherentes con lo que hiciste (no ceros
   imposibles ni números absurdos). Si la pantalla no existe o no abre,
   anótalo como fallo con los pasos.

## 7. P6 — Bloqueo biométrico / PIN

1. En Ajustes, activa el bloqueo con huella o PIN.
2. Cierra la app del todo y vuelve a abrirla.
3. ✅ Pasa si: **pide huella/PIN antes de mostrar cualquier contenido**
   (ni el chat ni datos visibles sin desbloquear).
4. Prueba también: bloquea la tablet, desbloquéala y abre NIDO — debe pedir
   autenticación de nuevo si la app se había cerrado.

## 8. P7 — Borrado total (Clear All Data)

1. Escribe un par de mensajes en el chat para tener datos.
2. Ve a Ajustes → **Clear All Data / Borrar todos los datos** → confirma.
3. ✅ Pasa si: la app vuelve al onboarding inicial **como recién instalada**,
   sin rastro de tus chats ni ajustes.
4. ❌ Falla si: queda algún chat, ajuste o archivo de la sesión anterior.

## 9. P8 — GATE-1 / SQLCipher: ¿los datos están cifrados en reposo?

> Honestidad primero: **esta prueba NO cierra GATE-1 por sí sola.**
> El cifrado real a nivel de bytes solo se demuestra volcando el archivo de la
> base de datos y comprobando que es ilegible sin la clave, y eso requiere
> acceso `adb`/root que esta tablet no tiene ahora. Lo que sí podemos probar
> aquí es el comportamiento observable:

1. Con el bloqueo biométrico activado (§7), fuerza la detención de la app.
2. Intenta abrirla: **ningún dato debe ser visible sin autenticar**.
3. Tras el borrado total (§8), confirma que no queda nada recuperable desde la
   propia app.
4. Anota: ¿la app indica en algún sitio que la base de datos está cifrada?
   ¿qué dice exactamente?
5. **GATE-1 queda ABIERTO** hasta la verificación a nivel de bytes
   (pendiente, con acceso adb o root). No marcar como verificado.

## 10. P9 — Observaciones de red

1. Ve a Ajustes → Conexiones → **Uso de datos** → busca NIDO y anota el
   consumo actual (móvil y WiFi) **antes** de las pruebas offline.
2. Haz las pruebas de chat en modo avión (§4).
3. Quita el modo avión y vuelve a mirar el uso de datos.
4. ✅ Esperado: **cero tráfico nuevo** durante el chat en modo avión
   (obvio), y fuera de él solo el tráfico que TÚ iniciaste: la descarga del
   modelo (~1 GB) y nada más.
5. Prueba la entrada de voz en modo avión: anota si funciona o si dice que
   necesita conexión (el reconocedor de voz de Android puede depender de red —
   es un comportamiento conocido, no un bug: anótalo tal cual).
6. Si ves tráfico que no iniciaste tú, anótalo con hora y qué estabas haciendo.

## 11. P10 — Rendimiento y estabilidad (esta tablet: Snapdragon 695, 4 GB RAM)

No esperamos récords — es una tablet modesta y es la primera prueba real.
Anota de forma honesta:

- Segundos aprox. hasta la primera respuesta del modelo y hasta completar.
- ¿Hubo cierres inesperados (crash), congelamientos (ANR), fallos de
  permisos, problemas de renderizado, errores cargando el modelo?
- ¿La tablet se calentó mucho o la batería bajó anormalmente rápido?

## 12. Plantilla de evidencia (una por prueba)

Copia y rellena por cada prueba P1–P10:

```
Prueba: P__ — <nombre>
Fecha/hora: 2026-09-__ __:__ MST
APK SHA-256: 0ee2bc9f8ca3a6eb3694b4af2d674e9f06f341158bed40f18115d3f208b3ae57
Dispositivo: Galaxy Tab A9+ 5G (SM-X218U)
Versión Android: __  (Ajustes → Acerca de la tablet → Información de software)
Resultado: ✅ PASS / ❌ FAIL
Observado: <qué viste, tiempos aprox., mensajes exactos>
Capturas: <sí/no, descripción>
Si falló — pasos para reproducir:
  1.
  2.
  3.
```

## 13. Notas honestas

- El cifrado interno (SQLCipher) no se puede "ver" a simple vista; GATE-1 se
  cierra con evidencia a nivel de bytes, no con "se ve bien".
- Si algo falla, **no lo intentes arreglar tú**: anótalo y avísame. Los bugs
  van a `docs/qa/TRIAGE.md`, no se tocan en caliente.
- Durante las pruebas no se cambia código de la app.
- Este APK es solo para tu tablet. No lo reenvíes ni lo subas a ningún sitio:
  el link es privado y expira.
