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

### D4. Los mensajes solo viajan entre personas que se conocieron en persona

- **Decisión:** la mensajería de NIDO, y cualquier reenvío futuro por otros
  teléfonos (malla), funciona solo entre contactos emparejados con el QR.
  Nunca para cualquier teléfono cercano.
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
