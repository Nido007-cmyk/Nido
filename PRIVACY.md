# Privacy policy

*Política de privacidad — versión en español más abajo.*

Last updated: 2026-10-29 (after 0.1.61). Applies to the NIDO Android app built from this repository.

## Summary

NIDO runs on your phone. It has no accounts, no analytics, no advertising and no servers of its own. The project maintainers do not receive your chats, documents, notes, contacts or usage data, because the app never sends them anywhere.

## What stays on your phone

- Chats, notes, reminders, memories and the documents you import.
- The AI models and knowledge packs you download.
- Your NIDO identity keys and the list of phones you paired with.
- The network log (see below).
- On-device measurements for the Execution Telemetry screen: timings, and which path each message took (handled by NIDO's router or by the AI model, and which tool). They contain no message text.
- Only if you turn it on (it is off by default): the last 50 commands NIDO's router did not recognize, so you can review them. Turning the option off deletes them.

This data is stored in an encrypted database (SQLCipher). The encryption key is kept in the Android Keystore. Android automatic cloud backup is disabled for the app.

## When NIDO uses the network

NIDO never uses the internet except when you start a download:

- **AI models**, fetched from Hugging Face.
- **Knowledge packs and the built-in corpus**, fetched from GitHub.

Those services see your IP address and which file you requested, as with any download, and apply their own privacy policies. NIDO sends no account, identifier or content with the request. Every connection is recorded in the network log inside the app (Settings › Security and privacy › Security check and network log), so you can check this yourself. The log is kept in the encrypted database and survives restarts (the latest 500 entries); up to 0.1.61 it was only kept until the app closed. It never contains your content: only the server and path, size, time and result.

## Phone-to-phone (Bluetooth and local Wi-Fi)

When you pair with another NIDO, messages travel directly between the two phones, end-to-end encrypted. Nothing passes through a server or the internet. The other person receives what you send them and can keep it.

- **Bluetooth.** While NIDO is running, it listens for your paired contacts over Bluetooth, also in the background. A nearby device that probes yours could learn that NIDO is installed. The phone that receives a connection does not reveal who it is until the other side proves it is one of your contacts.
- **Local Wi-Fi (backup route).** While you are looking for or connecting to another NIDO, it also uses your Wi-Fi network or hotspot. It announces itself on that network with a random name that changes on every start and a fixed service type, so other devices on the same network can see that a NIDO is there, but not who you are. It only accepts connections from local network addresses, never from the internet. When you leave that screen it stops announcing itself; connections already open stay.
- **Who is calling.** Since 0.1.49 the **Private hello** is on by default: when calling a contact whose NIDO supports it (0.1.45 or later), the first messages are sealed and nobody nearby can see who is calling. With a contact on an older NIDO, or one paired before 0.1.49 that has not connected since 0.1.45, the calling phone still sends its NIDO public key in clear in the first message. Someone recording nearby could then recognise the same phone across connections, without being able to read any message.
- **Message size.** Messages are padded to fixed sizes before encryption, so their length does not reveal the length of what you wrote.
- **Disappearing messages.** If you set a timer in a chat, new messages are deleted from both phones when it runs out (for the sender, counted from sending; for the receiver, from when they see it). Deleted messages are overwritten inside the encrypted database. A timer cannot stop someone from photographing the screen with another camera, and an older NIDO on the other side ignores it.
- **New key per message (on by default since 0.1.49).** When both phones have it, each message uses its own key and each connection also uses ML-KEM-768, a quantum-resistant algorithm.

Every local Wi-Fi connection also appears in the network log.

## Voice input

By default, voice dictation only works with a speech recognizer that runs on your phone (Android 12 or later, when the phone has one), so the audio never leaves it. If your phone only has the system speech service (Google's or the manufacturer's), dictation stays off unless you turn off Settings › Voice › "On-device recognition only". That service may send your audio over the internet and process it according to its own policy.

## Permissions

- **Bluetooth and nearby devices**: pairing and messaging between phones.
- **Network (local Wi-Fi)**: the backup route between two NIDOs on the same Wi-Fi or hotspot, and the downloads you start. No permission dialog is shown for this; Android grants it at install.
- **Display over other apps is blocked**: on Android 12 and later NIDO asks the system to hide other apps' overlays while it is on screen, so nobody can draw a fake button over a confirmation.
- **Location** (on older Android versions): required by Android to scan for Bluetooth devices. NIDO does not read your location.
- **Microphone**: voice input, only while you hold dictation open.
- **Notifications**: reminders, and a notice when a NIDO message arrives with the app in the background. The message notice never shows who wrote or what: only "New NIDO message", hidden on the lock screen.
- **Exact alarms**: so a reminder fires at the time you set, not when Android finds it convenient. Android asks you to allow this in its own settings screen.
- **"NIDO is answering" service**: a foreground service Android shows while the on-device model finishes an answer with the app in the background; it stops when the answer ends. Declared to Android as a special use, with that sentence as its stated purpose.
- **Battery exemption, only if you accept it**: Android's own dialog asks; without it Android freezes NIDO in the background after a while and the phone-to-phone link drops.
- **Start after reboot** (inherited from the notifications library): so scheduled reminders are re-armed after the phone restarts.
- **Vibrate** (inherited from the haptics library): the small vibration on confirmations and the panic button.
- **Calendar and contacts**, if you grant them: so the agent can read them on the phone when you ask. They are not uploaded.

## Your controls

- Delete any chat, memory, document or contact from inside the app.
- Erase everything from Settings → Danger zone, or by uninstalling the app. This also deletes the local backups made from Settings; copies you saved elsewhere (Downloads, another app) are outside NIDO and stay.
- Optional panic button (Settings → Security): holding it for 3 seconds erases all NIDO data at once, without asking for a fingerprint.
- NIDO asks your keyboard not to learn from what you type in it (incognito keyboard). Major keyboards respect this; NIDO cannot force one that ignores it.
- Create an encrypted backup and keep the key yourself. If you lose the key, nobody can recover the data, including the maintainers.

## Children

NIDO is not directed at children under 13.

## Changes and contact

Changes to this policy are made in this file and recorded in the repository history. Questions or reports: open an issue at https://github.com/Nido007-cmyk/Nido/issues, or follow [SECURITY.md](SECURITY.md) for security matters.

---

# Política de privacidad

Última actualización: 2026-10-29 (después de 0.1.61). Aplica a la app NIDO para Android compilada desde este repositorio.

## Resumen

NIDO funciona en tu teléfono. No tiene cuentas, ni analítica, ni publicidad, ni servidores propios. Quienes mantienen el proyecto no reciben tus chats, documentos, notas, contactos ni datos de uso, porque la app no los envía a ningún lado.

## Qué se queda en tu teléfono

- Chats, notas, recordatorios, memorias y los documentos que importas.
- Los modelos de IA y paquetes de conocimiento que descargas.
- Tus claves de identidad NIDO y la lista de teléfonos emparejados.
- Mediciones en el teléfono para la pantalla de Telemetría de ejecución: tiempos, y por qué camino fue cada mensaje (lo resolvió el enrutador de NIDO o el modelo de IA, y con qué herramienta). No contienen el texto de los mensajes.
- Solo si lo activas (viene apagado): las últimas 50 órdenes que el enrutador de NIDO no reconoció, para que puedas revisarlas. Al apagar la opción se borran.
- El registro de red (ver más abajo).

Estos datos se guardan en una base de datos cifrada (SQLCipher). La clave de cifrado se guarda en el Keystore de Android. El respaldo automático en la nube de Android está desactivado para la app.

## Cuándo usa NIDO la red

NIDO nunca usa internet salvo cuando tú inicias una descarga:

- **Modelos de IA**, desde Hugging Face.
- **Paquetes de conocimiento y el corpus integrado**, desde GitHub.

Esos servicios ven tu dirección IP y qué archivo pediste, como en cualquier descarga, y aplican sus propias políticas de privacidad. NIDO no envía ninguna cuenta, identificador ni contenido con la petición. Cada conexión queda anotada en el registro de red dentro de la app (Ajustes › Seguridad y privacidad › Comprobación de seguridad y registro de red), para que puedas comprobarlo. El registro se guarda en la base cifrada y sobrevive a los reinicios (las últimas 500 entradas); hasta 0.1.61 solo duraba hasta cerrar la app. Nunca contiene tu contenido: solo el servidor y la ruta, el tamaño, la hora y el resultado.

## De teléfono a teléfono (Bluetooth y Wi-Fi local)

Cuando te emparejas con otro NIDO, los mensajes viajan directamente entre los dos teléfonos, cifrados de extremo a extremo. Nada pasa por un servidor ni por internet. La otra persona recibe lo que le envías y puede conservarlo.

- **Bluetooth.** Mientras NIDO está en marcha, espera a tus contactos emparejados por Bluetooth, también en segundo plano. Un dispositivo cercano que consulte el tuyo podría saber que tienes NIDO instalado. El teléfono que recibe una conexión no dice quién es hasta que el otro demuestra ser uno de tus contactos.
- **Wi-Fi local (ruta de respaldo).** Mientras buscas o te conectas a otro NIDO, también usa tu red Wi-Fi o el punto de acceso. Se anuncia en esa red con un nombre aleatorio que cambia en cada arranque y un tipo de servicio fijo: otros dispositivos de la misma red pueden ver que hay un NIDO, pero no quién eres. Solo acepta conexiones de direcciones de la red local, nunca de internet. Al salir de esa pantalla deja de anunciarse; las conexiones ya abiertas siguen.
- **Quién llama.** Desde 0.1.49 el **Saludo privado** viene activado: al llamar a un contacto cuyo NIDO lo soporta (0.1.45 o posterior), los primeros mensajes van sellados y nadie cerca puede ver quién llama. Con un contacto que tenga un NIDO más viejo, o uno emparejado antes de 0.1.49 que no se haya conectado desde 0.1.45, el teléfono que llama todavía manda su clave pública de NIDO en claro en el primer mensaje. Alguien que grabe cerca podría entonces reconocer el mismo teléfono de una conexión a otra, sin poder leer ningún mensaje.
- **Tamaño de los mensajes.** Los mensajes se rellenan hasta tamaños fijos antes de cifrarse, así su longitud no revela la de lo que escribiste.
- **Mensajes temporales.** Si pones un temporizador en un chat, los mensajes nuevos se borran de los dos teléfonos al vencer (para quien envía, desde que lo envía; para quien recibe, desde que lo ve). Los mensajes borrados se sobrescriben dentro de la base cifrada. Un temporizador no impide que alguien fotografíe la pantalla con otra cámara, y un NIDO anterior del otro lado lo ignora.
- **Clave nueva por mensaje (activada por defecto desde 0.1.49).** Cuando los dos teléfonos la tienen, cada mensaje usa su propia clave y cada conexión usa además ML-KEM-768, un algoritmo resistente a ordenadores cuánticos.

Cada conexión por Wi-Fi local también aparece en el registro de red.

## Entrada por voz

Por defecto, el dictado solo funciona con un reconocedor de voz que trabaja en tu teléfono (Android 12 o posterior, si el teléfono lo tiene), así que el audio no sale de él. Si tu teléfono solo tiene el servicio de voz del sistema (de Google o del fabricante), el dictado queda apagado salvo que apagues Ajustes › Voz › «Solo reconocimiento en el teléfono». Ese servicio puede mandar tu audio a internet y tratarlo según su propia política.

## Permisos

- **Bluetooth y dispositivos cercanos**: emparejar y enviar mensajes entre teléfonos.
- **Red (Wi-Fi local)**: la ruta de respaldo entre dos NIDO en el mismo Wi-Fi o punto de acceso, y las descargas que inicias. Android lo concede al instalar, sin diálogo.
- **Superposiciones bloqueadas**: en Android 12 y posteriores NIDO pide al sistema ocultar las capas de otras apps mientras está en pantalla, para que nadie pueda dibujar un botón falso sobre una confirmación.
- **Ubicación** (en versiones antiguas de Android): Android la exige para buscar dispositivos Bluetooth. NIDO no lee tu ubicación.
- **Micrófono**: entrada por voz, solo mientras dictas.
- **Notificaciones**: recordatorios y un aviso cuando llega un mensaje NIDO con la app en segundo plano. El aviso nunca muestra quién escribe ni qué: solo «Nuevo mensaje NIDO», y oculto en la pantalla de bloqueo.
- **Alarmas exactas**: para que un recordatorio suene a la hora que fijaste, no cuando Android lo crea oportuno. Android te pide permitirlo en su propia pantalla de ajustes.
- **Servicio «NIDO está respondiendo»**: un servicio en primer plano que Android muestra mientras el modelo del teléfono termina una respuesta con la app en segundo plano; se detiene cuando la respuesta acaba. Declarado ante Android como uso especial, con esa frase como finalidad escrita.
- **Exención de batería, solo si la aceptas**: lo pide un diálogo del propio Android; sin él, Android congela NIDO en segundo plano al rato y el enlace entre teléfonos se corta.
- **Arranque tras reiniciar** (heredado de la librería de notificaciones): para que los recordatorios programados se rearmen después de reiniciar el teléfono.
- **Vibración** (heredada de la librería de háptica): la vibración breve en las confirmaciones y el botón de pánico.
- **Calendario y contactos**, si los concedes: para que el agente los lea en el teléfono cuando se lo pides. No se suben a ningún lado.

## Tus controles

- Borra cualquier chat, memoria, documento o contacto desde la app.
- Borra todo desde Ajustes → Zona de peligro, o desinstalando la app. Eso borra también los respaldos locales hechos desde Ajustes; las copias que guardaste fuera (Descargas, otra app) quedan fuera de NIDO y siguen ahí.
- Botón de pánico opcional (Ajustes → Seguridad): mantenerlo 3 segundos borra todos los datos de NIDO de una vez, sin pedir huella.
- NIDO pide a tu teclado que no aprenda de lo que escribes en la app (teclado incógnito). Los teclados principales lo respetan; NIDO no puede obligar a uno que lo ignore.
- Crea un respaldo cifrado y guarda tú la clave. Si pierdes la clave, nadie puede recuperar los datos, tampoco quienes mantienen el proyecto.

## Menores

NIDO no está dirigido a menores de 13 años.

## Cambios y contacto

Los cambios a esta política se hacen en este archivo y quedan en el historial del repositorio. Preguntas o reportes: abre un issue en https://github.com/Nido007-cmyk/Nido/issues, o sigue [SECURITY.md](SECURITY.md) para temas de seguridad.
