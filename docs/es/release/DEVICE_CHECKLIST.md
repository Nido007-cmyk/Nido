> **Idioma:** [English](../../release/DEVICE_CHECKLIST.md) · Español

# Lista de comprobación en el aparato para cada versión

Las pruebas automáticas corren en cada cambio, pero no en un teléfono.
Esta es la pasada corta en un teléfono real que toda alfa debería tener
antes de que sus notas digan nada sobre cómo se comporta. Lleva unos 20
minutos en el aparato de referencia, una Galaxy Tab A9+ (unos 4 GB de RAM,
contexto con techo de 2.048 tokens).

Los resultados van a las notas de la versión, también lo que falló. Una
comprobación que no se hizo se escribe como no hecha, nunca como superada.

## Antes de empezar

- Instala el APK publicado y compruébalo con su `app-release.apk.sha256`.
- Apunta el aparato, la versión de Android y el almacenamiento libre.
- Para las comprobaciones de tiempo, espera tres minutos sin tocar la app,
  o fuerza su cierre, para que el modelo quede descargado.

## 1. Primer arranque sin red (desde la 0.1.95)

1. Desinstala NIDO. Activa el modo avión. Instala el candidato y ábrelo.
2. En el asistente de instalación, toca **Emergencia**. Debe salir el
   selector de país. Elige México y Estados Unidos: cada uno debe mostrar
   sus números con fuente y fecha.
3. Ciérralo y toca **Leer las guías**. Deben aparecer las guías de NIDO
   Essentials y abrirse como documentos.
4. Apunta si funcionó y cuántos segundos pasaron desde abrir la app hasta
   que Emergencia mostró números.

## 2. Respuestas que no necesitan el modelo (desde la 0.1.94)

Con el modelo descargado de memoria:

1. Pregunta algo que responde una guía («¿qué hago si alguien se
   atraganta?»).
2. Pregunta «gracias», «¿qué hora es?» y «¿cuál es el número de
   emergencias?».
3. Apunta, para cada una, los segundos hasta que aparece el texto y si
   salió la franja «Cargando modelo…». No debe salir.

## 3. Una respuesta que genera

1. Con el modelo descargado de memoria, pide un cuento corto.
2. En Telemetría de ejecución, apunta carga, primer token, tokens por
   segundo y pico de memoria.
3. Compara con la versión anterior. Las cifras deben coincidir; la carga
   tiene ahora su propia casilla.

## 4. Cifras y tablas (desde la 0.1.94)

1. Importa un documento con una tabla larga de cifras (40 filas de dosis
   u horarios).
2. Pregunta algo que solo la tabla responde.
3. La respuesta debe terminar entera, sin nota de corte ni error. Apunta
   los tokens del prompt y si apareció `context_full` en la telemetría.

## 5. Notificaciones (desde la 0.1.95, sin el arranque de Firebase)

1. Programa un recordatorio para dentro de un minuto.
2. Bloquea el teléfono. La notificación debe llegar a su hora.

## 6. Borrado de pánico (desde la 0.1.95, la clave muere primero)

Solo en una instalación de prueba sin datos reales.

1. Activa el botón de pánico en Ajustes → Seguridad.
2. Mantenlo pulsado 3 segundos.
3. NIDO debe arrancar vacío, sin la tarjeta de «borrado interrumpido». En
   el asistente, Emergencia debe seguir funcionando (los packs se
   reinstalan desde el APK).

## 7. Dos teléfonos

1. Empareja dos teléfonos por código QR y envía un mensaje en cada
   sentido por Bluetooth.
2. Repítelo en modo avión con el Bluetooth encendido.

## 8. Calidad de respuesta, con cifras

La batería de evaluación corre dentro de la app real (la misma capa
determinista, las guías y el modelo que recibe la persona), dirigida desde
un ordenador:

```bash
npm run eval:device -- --models <id del modelo>
```

Ver [DEVICE_EVALUATION.md](../DEVICE_EVALUATION.md). Necesita una build de
desarrollo y la depuración USB. Guarda los archivos `.jsonl` y
`.answers.md` y pon el resumen (consultas bien, primer token, tokens por
segundo, pico de memoria) en las notas, junto a las cifras de la versión
anterior.

## Bloqueos de distribución encontrados el 2026-11-12

Salieron de leer el APK de la 0.1.94. No cambian lo que hace la app, pero
F-Droid (decisión D8) los va a señalar:

- **Arranque de Firebase.** El manifiesto declaraba `FirebaseInitProvider`
  y `ComponentDiscoveryService`, que traía expo-notifications. Firebase no
  puede iniciarse en NIDO (el APK no lleva `google_app_id`), así que solo
  eran peso muerto. Se quitan en la 0.1.95 (`plugins/withLeanManifest.js`).
- **Las clases de Firebase y Google Play Services siguen compiladas.**
  `classes*.dex` contiene `com/google/firebase` (messaging, installations,
  datatransport) y `com/google/android/gms`. Sin entrada en el manifiesto
  quedan inertes, pero el escáner de F-Droid marca las librerías no libres.
  Quitarlas exige excluir `firebase-messaging` de expo-notifications en
  Gradle y comprobar que R8 sigue compilando. Hace falta un build Android
  de prueba. Abierto.
- **La entrada de voz** usa el reconocedor en el propio teléfono cuando
  Android 12+ lo ofrece, y rechaza el modo solo sin conexión cuando no lo
  hay. En teléfonos sin él (GrapheneOS, muchas ROM sin Google) no hay voz
  sin conexión. [WHISPER_PLAN.md](../WHISPER_PLAN.md) tiene el plan de un
  reconocedor propio. Abierto.
