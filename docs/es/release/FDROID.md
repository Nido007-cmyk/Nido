> **Idioma:** [English](../../release/FDROID.md) · Español

# F-Droid: estado y camino decidido

**D8 resuelta por el dueño el 2026-11-13: el APK normal de NIDO es el que va
sin Google. No hay un sabor `foss` aparte.**

El motivo: si el APK sin Google fuera una variante distinta de la de GitHub,
F-Droid la firmaría con su propia clave. Entonces pasar de una instalación a
otra obligaría a desinstalar, y desinstalar borra los modelos descargados
(hasta unos 5 GB).

Nada de este documento se ha enviado a gitlab.com/fdroid/fdroiddata. El
borrador de la receta está en
[`docs/release/fdroid/team.nido.app.yml`](../../release/fdroid/team.nido.app.yml).

## 1. Dónde está NIDO

| Requisito de F-Droid | Estado |
|---|---|
| Sin librerías de Google ni de rastreo (Firebase, Play Services) | **Hecho en código, pendiente de release.** #253 sustituye expo-notifications por un módulo propio; #254 censa cada APK construido y tumba la compilación si queda algo. Ninguna versión publicada lo cumple todavía: la 0.1.95 lleva esas clases compiladas e inertes |
| Compilar todo desde fuente | **No cumple.** Las dependencias traen librerías nativas ya compiladas (§3) |
| Licencia libre | Cumple: MIT |
| Metadatos | fastlane/metadata/android en en-US, es-ES y pt-BR; receta en borrador |
| Firma de NIDO (compilación reproducible) | Depende de §3: hoy la compilación de NIDO usa binarios precompilados que F-Droid no puede usar |

El permiso INTERNET se queda: hace falta para descargar los modelos y no es
un bloqueo de F-Droid.

## 2. Google fuera: qué se hizo

Hasta la 0.1.95, todo lo de Google entraba por **dos** dependencias:

- **expo-notifications 57.0.24:** firebase-messaging y todo su árbol
  (Firebase, Play Services, datatransport, kotlinx-coroutines-play-services).
- **expo-application 57.0.3**, que traía expo-notifications: el Install
  Referrer de Google Play.

NIDO solo usaba de expo-notifications los avisos locales.

**PR-1 (#253):** `modules/nido-notify`, un módulo propio (MIT, solo API de
Android y expo-modules-core) con exactamente lo que NIDO usaba:

- programar, mostrar, cancelar y despedir avisos locales;
- canales y permiso;
- saber cuándo se entregó un aviso.

La cuenta de la próxima hora es la de expo, línea a línea. Una comparación
contra el código real de expo dio 0 diferencias en 360.000 casos. Al
actualizar, el primer arranque reprograma lo que expo tenía pendiente y borra
su almacén viejo. Salen expo-notifications, expo-application y badgin.
expo-constants sigue, pero el APK enlaza ahora la copia que pide el propio
expo: pasa de 57.0.22 a 57.0.23, que solo cambia el número de versión.

**PR-2 (#254):** retira la configuración que quedaba para Firebase en
`plugins/withLeanManifest.js`. Añade `scripts/check-google-free.py` al final
de cada compilación del APK, que busca Firebase, Play Services, datatransport
y el Install Referrer en tres sitios:

- los `classes*.dex`;
- el manifiesto binario;
- el árbol de dependencias que publica la release.

Un rastro tumba la compilación y, con ella, la release.

| Censo (mismo script) | 0.1.95 publicada | Con #253 y #254 |
|---|---|---|
| dex `com/google/firebase` | 535 | ver #254 |
| dex `com/google/android/gms` | 996 | ver #254 |
| dex `com/google/android/datatransport` | 345 | ver #254 |
| dex `com/google/android/finsky` | 5 | ver #254 |
| dex `com/android/installreferrer` | 16 | ver #254 |
| manifiesto: datatransport CCT / gms | 4 / 2 | ver #254 |
| dependencias de Google en el árbol | 36 | ver #254 |

La columna de la derecha se rellena con la cifra del run de la CI citado en
#254 cuando esté fusionado. Lo que sale de un APK publicado se comprueba en su
release.

## 3. Lo que queda: librerías nativas precompiladas

Esto es lo que sigue separando a NIDO de fdroiddata, dicho sin rodeos.

**Qué pasa:**

- **llama.rn** descarga en su `npm install` sus librerías nativas ya
  compiladas desde su release de GitHub
  (`install/download-native-artifacts.js`). Su paquete de npm trae además
  `bin/arm64-v8a/libOpenCL.so` y las librerías Hexagon `libggml-htp-*.so`.
  Esas dos ya se sacan del APK con `withLlamaTrim`, pero están en el árbol de
  fuentes.
- **Los módulos de Expo** traen cada uno su AAR ya compilado en
  `local-maven-repo/`, y el autolinking los usa por defecto.

**Qué significa para una solicitud a fdroiddata:**

- F-Droid compila desde fuente. Su escáner señala los binarios que
  encuentra, y la receta tiene que borrarlos y compilarlos desde código.
- El código de llama.rn y de Expo es libre, así que en principio se pueden
  compilar. Llevaría:
  - llama.rn con `npm ci --ignore-scripts` y `rnllamaBuildFromSource=true`;
  - Expo con `expo.autolinking.android.buildFromSource: [".*"]` en
    `package.json`.
- Si F-Droid compila desde fuente y NIDO publica en GitHub un APK hecho con
  los binarios precompilados, los dos APK **no coincidirán byte a byte**.
  Entonces F-Droid no puede publicar el APK firmado por NIDO, lo firma con
  su clave, y vuelve el problema que la D8 quería evitar: quien cambie entre
  GitHub y F-Droid tendría que desinstalar.

**Qué se podría hacer (sin garantía de aceptación):**

1. **Compilar también la release de NIDO desde fuente**, con los dos
   ajustes de arriba en `android-apk.yml` y `reproducible.yml`, y comprobar
   con `reproducible.yml` que dos compilaciones coinciden. Es lo único que
   deja abierta la firma de NIDO en F-Droid. No está medido cuánto alarga la
   compilación ni cuánto disco pide llama.cpp desde fuente; la CI ya va
   justa de disco.
2. **Aceptar que F-Droid firme con su clave.** Funciona, pero pierde la
   ventaja que motivó la D8 para quien use las dos fuentes.
3. **Dejar F-Droid para más adelante.** El APK sin Google sirve igual a
   GrapheneOS y a las ROM sin Google desde GitHub.

Aunque se haga lo primero, F-Droid revisa cada solicitud a mano. Puede pedir
cambios o etiquetar la app (§4), y la compilación nativa de llama.cpp tiene
que ser determinista con su cadena de herramientas, cosa que no está
probada. Nada de esto se puede prometer desde aquí.

## 4. Etiquetas que F-Droid podría poner

- **NonFreeAdd** (promueve complementos no libres). El catálogo ofrece
  `lfm2.5-8b-a1b-q4km` bajo la «LFM Open License v1.0», que no es una
  licencia libre reconocida. Los demás modelos son MIT o Apache-2.0, y los
  packs CC BY 4.0 o CC BY-SA 4.0. Es una etiqueta, no un rechazo.
- **NonFreeNet** no aplica: NIDO no depende de ningún servicio de red no
  libre para funcionar.

## 5. Pasos que quedan

1. **Fusionar #253 y #254** con la CI en verde. La primera release que los
   lleve será la primera sin Google; cortarla es decisión de la casa.
2. **Pasada en el aparato** de esa release: DEVICE_CHECKLIST completa, con
   la sección 5 (notificaciones) y la nueva comprobación de actualizar desde
   la 0.1.95 con avisos pendientes.
3. **Decidir §3:** compilar la release desde fuente o no. Si sí:
   - rama aparte;
   - compilación de prueba;
   - `reproducible.yml` en verde.
4. **Prueba local con fdroidserver**, con el borrador de la receta:
   - `fdroid readmeta`, `fdroid lint team.nido.app`,
     `fdroid build -v -l team.nido.app` y `fdroid scanner` sin hallazgos;
   - cerrar los «VERIFICAR» del borrador.
5. **Merge request a fdroiddata:** solo con el visto bueno del dueño y la
   receta que pasó el paso 4.

## 6. Incertidumbres

- La lista de categorías vigente de fdroiddata no se comprobó desde aquí.
- No se sabe qué versión de Node trae el buildserver de F-Droid (NIDO usa
  Node 24).
- Cuánto tarda y cuánto ocupa la compilación de llama.cpp desde fuente, y si
  es reproducible byte a byte.
- Si las comprobaciones de `withLlamaTrim` toleran que `bin/` no exista. Por
  cómo está escrito `syncRNLlamaHtpAssets` debería, pero no está probado.
