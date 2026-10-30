> **Idioma:** [English](../DECISIONS.md) · Español

# Decisiones

Decisiones de producto que marcan NIDO para años, con su motivo y lo que nos
haría revisarlas. Una decisión solo cambia con un PR que actualice este
archivo (y la [constitución](NIDO_CONSTITUTION.md) si toca una regla firme).

## 2026-10-29

### D1. NIDO tiene una constitución, y el CI hace cumplir sus reglas firmes

- **Decisión:** adoptar [la constitución de NIDO](NIDO_CONSTITUTION.md), versión 1.
  Cada regla firme está atada a tests y casos de evaluación
  (`docs/constitution-rules.json`, comprobado por `scripts/check-constitution.mjs`).
- **Por qué:** un modelo pequeño en el teléfono se equivoca más que uno grande
  en la nube; donde un error puede hacer daño hacen falta reglas fijas con
  tests, y para todo lo demás, un orden de prioridades escrito.
- **Se revisa si:** un fallo real muestra que falta una regla o que está mal.

### D2. Ningún modelo reescribe una guía de primeros auxilios, ni para acortarla

- **Decisión:** si alguien pide resumir una guía de NIDO Esencial, NIDO muestra
  el principio de la guía tal cual, hasta su primer paso a paso, y dice que la
  guía completa es la referencia (0.1.60).
- **Por qué:** en 0.1.58 el modelo perdió un «no» en la regla de la aspirina.
  Un «resumen» es el mismo riesgo.
- **Se revisa si:** nunca para primeros auxilios. Los demás packs se pueden
  resumir con el modelo y sus fuentes, como hoy.

### D3. El resumen diario es opcional

- **Decisión:** el resumen de las 8:00 está apagado salvo que la persona lo
  active (0.1.60).
- **Por qué:** las notificaciones de NIDO son las que la persona pide
  (constitución §9). Antes se programaba en cuanto había permiso.
- **Se revisa si:** nunca por defecto; se puede ofrecer una vez en la
  configuración inicial.

### D4. Los mensajes solo viajan entre contactos emparejados

- **Decisión:** la mensajería de NIDO, y cualquier reenvío futuro por otros
  teléfonos (malla), funciona solo entre contactos emparejados con su
  código. Nunca para cualquier teléfono cercano. Si algún día se construye
  el reenvío, solo pasará por contactos con la huella verificada (ver D12).
- **Por qué:** las mallas abiertas a extraños dejan ver quién habla con quién.
  El propio documento de bitchat dice que los metadatos son su punto débil (un
  identificador que no rota, anuncios en claro). Bridgefy se rompió dos veces,
  la segunda después de adoptar libsignal: suplantación, hombre en el medio y
  lectura de mensajes privados
  ([USENIX Security 2022](https://www.usenix.org/conference/usenixsecurity22/presentation/albrecht)).
- **Se revisa si:** un diseño de malla abierta con identificadores que rotan
  pasa una auditoría externa.

### D5. Sin servidor intermedio

- **Decisión:** NIDO no usa un servidor intermedio (relay) para los mensajes.
  Solo podría llegar como pieza opcional y reemplazable, que vea solo datos
  cifrados y cumpla antes las capas de [METADATA_PRIVACY.md](METADATA_PRIVACY.md),
  y se decidiría cambiando la constitución a propósito.
- **Por qué:** «sin servidores» es la promesa central de NIDO; además, alguien
  tendría que mantenerlo y pagarlo, y ve horarios y tamaños.
- **Se revisa si:** la malla (D4) no basta para usuarios reales y las capas de
  metadatos existen.

### D6. Registrarse como desarrollador verificado de Android antes de 2027

- **Decisión:** registrar NIDO (`team.nido.app`, con la llave de firma propia de
  NIDO) en la Android Developer Console con una cuenta de distribución completa,
  antes del despliegue global de Google en 2027.
- **Por qué:** desde el 30 de septiembre de 2026, en Brasil, Indonesia, Singapur
  y Tailandia los teléfonos certificados solo instalan apps de desarrolladores
  verificados desde las tiendas participantes; las descargas directas, como el
  APK de GitHub de NIDO, todavía no están cubiertas, pero Google planea el
  despliegue global en 2027 y recomienda registrar las apps que se distribuyen
  fuera de Google Play
  ([preguntas frecuentes](https://developer.android.com/developer-verification/guides/faq),
  [registro de apps en plataformas abiertas](https://developer.android.com/developer-verification/guides/open-source-app-registration)).
  Sin registro, la gente necesitaría un «flujo avanzado» con 24 horas de espera
  la primera vez, o `adb`, para instalar NIDO, y nadie hace eso en una
  emergencia. Una cuenta gratuita de «distribución limitada» solo cubre 20
  aparatos.
- **Coste:** 25 USD una sola vez y verificación de identidad del dueño.
- **Se revisa si:** Google cambia las reglas.

### D7. Pedir una auditoría de seguridad externa gratuita después de las pruebas en dos teléfonos

- **Decisión:** solicitarla al
  [Security Lab de Open Technology Fund](https://www.opentech.fund/labs/security-lab/),
  que financia auditorías de seguridad para herramientas de libertad en
  Internet, cuando el «hola privado» y la llave nueva por mensaje se hayan
  probado en dos teléfonos físicos.
- **Por qué:** una auditoría externa es lo que permite decir más que «cifrado
  de extremo a extremo, sin servidores». Auditar código que cambia la semana
  siguiente vale menos.
- **Se revisa si:** responden a la solicitud.

### D8. Orden de distribución: GitHub ahora, F-Droid después, Google Play más tarde

- **Decisión:** mantener el APK firmado en GitHub; preparar F-Droid (pide
  software libre compilado desde el código y sin librerías propietarias; NIDO
  tiene licencia MIT y el CI comprueba que su compilación es reproducible, y
  falta revisar sus dependencias contra esa regla); Google Play cuando haya al
  menos 12 probadores para la prueba cerrada que piden las cuentas personales
  nuevas.
- **Por qué:** F-Droid encaja con el público y los principios de NIDO; Play
  llega a más gente, pero pide antes una prueba cerrada de 14 días con 12
  probadores.
- **Se revisa si:** la revisión de F-Droid encuentra un bloqueo (por ejemplo,
  cómo trata la descarga de modelos y packs).

### D9. La bóveda de hardware sigue siendo una oferta, no lo de serie

- **Decisión:** la bóveda de hardware (la clave de la base envuelta por una
  llave del Keystore que pide la huella o el PIN) sigue apagada por defecto,
  ofrecida en la pantalla principal desde 0.1.51 (lo preguntó la auditoría de
  seguridad del dueño del 29 de octubre de 2026).
- **Por qué:** la bóveda necesita un bloqueo de pantalla, y Android borra su
  llave si se quita ese bloqueo: desde ese momento los datos solo vuelven con
  un respaldo. Encenderla sin preguntar dejaría los datos de la gente a un
  cambio de ajustes de perderse, sin haberlo elegido. Muchos teléfonos y
  tablets de uso familiar no tienen bloqueo de pantalla, y ahí la bóveda no
  se puede encender. Sin la bóveda, la base sigue cifrada con una clave
  aleatoria de 256 bits guardada en el Keystore de Android.
- **Se revisa si:** al encender la bóveda se puede comprobar antes que hay un
  respaldo reciente cuya clave la persona guardó. Entonces puede venir
  encendida en los teléfonos con bloqueo de pantalla.

### D10. «Solo saludo privado» sigue apagado por defecto

- **Decisión:** el modo estricto del iniciador (Ajustes → Seguridad → «Solo
  saludo privado») sigue apagado por defecto.
- **Por qué:** el saludo privado ya viene activado desde 0.1.49, y el
  teléfono recuerda qué contactos lo soportan. La clave pública solo va en
  claro con un contacto que tenga un NIDO anterior a la 0.1.49, o uno
  emparejado antes de la 0.1.49 que no se haya conectado desde la 0.1.45. El
  modo estricto solo añade rechazar a esos contactos. Encenderlo para todos
  los dejaría sin conexión sin avisar, y NIDO está para funcionar cuando
  importa.
- **Se revisa si:** las pruebas del saludo privado en dos teléfonos salen
  bien (ver D7). Después, encenderlo por defecto puede ir con un aviso que
  diga qué contactos se quedarían sin conexión.

### D11. Límites conocidos de la auditoría del 29 de octubre, que se quedan y se dicen

- **Lo pegado en trozos cortos cuenta como escrito.** Android no avisa a una
  app de que se pegó texto. NIDO toma como pegado un bloque de 24 caracteres
  o más con espacios (y lo aparta del enrutador), así que pegar unas pocas
  palabras cada vez parece escribir. Toda acción con efecto fuera de la app
  sigue pidiendo confirmación (regla firme R4), así que ese borde no puede
  actuar solo. Bajar el umbral apartaría lo escrito de verdad con teclados
  de gestos.
- ~~El dictado por voz~~ y ~~el archivo de la rotación de clave~~: cerrados el
  mismo día (ver D12).
- **Se revisa si:** Android o React Native ofrecen un evento de pegar.

### D12. Lecciones de las auditorías de Signal y Briar

La investigación del dueño sobre todas las auditorías públicas de Signal y
Briar (29 de octubre de 2026) cruzó sus hallazgos con los de NIDO. Decidido y
hecho:

- **Un contacto solo está verificado cuando las dos personas compararon la
  huella.** El código de emparejamiento de NIDO es texto y puede llegar por
  cualquier canal, pero hasta la 0.1.62 todo contacto se guardaba y se
  mostraba como «verificado». Briar dejó esto abierto para los contactos
  remotos (OTF-005, retest de 2024), y en un estudio de 2016 el 75 % de los
  usuarios de Signal creía haber verificado sin hacerlo. Ahora un contacto
  está «sin verificar» hasta que alguien pulsa Verificar después de comparar
  la huella que muestra «Mi código» en el otro teléfono, y los contactos que
  ya existían empiezan «sin verificar». Emparejar no cambia; solo lo que la
  app afirma.
- **El dictado por voz solo usa un reconocedor en el teléfono por defecto.**
  El único hallazgo High de Briar (Cure53, 2017) fue un solo canal saliéndose
  del perímetro (el DNS de RSS fuera de Tor). «Preferir sin conexión» pasa a
  ser «en el teléfono o nada», salvo que la persona lo apague en Ajustes ›
  Voz.
- **El archivo de la rotación de clave va cifrado** con una llave guardada en
  el Keystore de Android (por SecureStore). Signal Desktop tuvo la clave de
  su base en un `config.json` en claro seis años (2018–2024).
- **Las ofertas de packs tienen cuota:** como mucho 3 ofertas sin aceptar por
  contacto y 10 en total, que se olvidan a los 30 minutos (la denegación de
  servicio de Briar por un contacto malicioso, ETH 2023).
- **Comprobado, nada que arreglar hoy:** las capturas de pantalla están
  bloqueadas (FLAG_SECURE) y los toques bajo la capa de otra app se ignoran
  (`filterTouchesWhenObscured`, más capas ocultas en Android 12+), el único
  componente exportado es el acceso rápido de la barra de ajustes (protegido
  por un permiso del sistema), y nada que se abra desde fuera de NIDO puede
  borrar ni enviar nada.
- **Sigue abierto, y se dice:** el tamaño de un respaldo deja ver más o menos
  cuántos datos tiene.
- ~~El texto de un PDF lo extraía una librería nativa antes de que NIDO
  pudiera medirlo.~~ Cerrado: el módulo propio de NIDO
  (`modules/nido-pdf-text`) analiza el PDF con búferes en archivos
  temporales, rechaza más de 3.000 páginas y deja de leer en cuanto el texto
  pasa de lo que aún cabe en el tope de la importación, también a mitad de
  una página enorme.
- **Clones de sesión, revisado el mismo día:** el fallo de Sesame en Signal
  (Cremers, Jacomme y Naska, USENIX 2023) era que una sesión vieja volvía a
  ser la activa al descifrar un mensaje, así que un clon con un estado
  antiguo podía volver. NIDO no tiene ese camino: guarda como mucho una
  sesión viva y una candidata por contacto, una candidata solo existe tras
  un handshake firmado con la clave de identidad, y al promocionarse la
  vieja desaparece para siempre (`src/p2p/messenger.ts`, `handleFrame`; test
  «una sesión sustituida no se reactiva nunca»). Las sesiones no se guardan
  en disco: una conexión nueva siempre necesita un handshake firmado nuevo.
  Lo que ningún diseño de sesiones arregla es un clon que también tiene la
  clave de identidad; detectarlo (la segunda propuesta del artículo) pide
  cambiar el protocolo y queda para la auditoría externa (D7).
- **Se revisa si:** algún día se plantean presentaciones remotas de
  contactos: antes necesitan un camino real hasta la verificación plena, y
  nada que confíe en quien presenta (CVE-2023-33983 de Briar).
