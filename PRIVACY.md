# Privacy policy

*Política de privacidad — versión en español más abajo.*

Last updated: 2026-10-21 (0.1.45). Applies to the NIDO Android app built from this repository.

## Summary

NIDO runs on your phone. It has no accounts, no analytics, no advertising and no servers of its own. The project maintainers do not receive your chats, documents, notes, contacts or usage data, because the app never sends them anywhere.

## What stays on your phone

- Chats, notes, reminders, memories and the documents you import.
- The AI models and knowledge packs you download.
- Your NIDO identity keys and the list of phones you paired with.
- On-device measurements for the Execution Telemetry screen: timings, and which path each message took (handled by NIDO's router or by the AI model, and which tool). They contain no message text.
- Only if you turn it on (it is off by default): the last 50 commands NIDO's router did not recognize, so you can review them. Turning the option off deletes them.

This data is stored in an encrypted database (SQLCipher). The encryption key is kept in the Android Keystore. Android automatic cloud backup is disabled for the app.

## When NIDO uses the network

NIDO never uses the internet except when you start a download:

- **AI models**, fetched from Hugging Face.
- **Knowledge packs and the built-in corpus**, fetched from GitHub.

Those services see your IP address and which file you requested, as with any download, and apply their own privacy policies. NIDO sends no account, identifier or content with the request. Every connection is recorded in the network log inside the app (About → Network log), so you can check this yourself.

## Phone-to-phone (Bluetooth and local Wi-Fi)

When you pair with another NIDO, messages travel directly between the two phones, end-to-end encrypted. Nothing passes through a server or the internet. The other person receives what you send them and can keep it.

- **Bluetooth.** While NIDO is running, it listens for your paired contacts over Bluetooth, also in the background. A nearby device that probes yours could learn that NIDO is installed. The phone that receives a connection does not reveal who it is until the other side proves it is one of your contacts.
- **Local Wi-Fi (backup route).** While you are looking for or connecting to another NIDO, it also uses your Wi-Fi network or hotspot. It announces itself on that network with a random name that changes on every start and a fixed service type, so other devices on the same network can see that a NIDO is there, but not who you are. It only accepts connections from local network addresses, never from the internet. When you leave that screen it stops announcing itself; connections already open stay.
- **What is not hidden yet.** By default, the phone that starts a connection sends its NIDO public key in the first message, before encryption begins. Someone recording Bluetooth or Wi-Fi traffic nearby could recognise the same phone across connections, without being able to read any message. The experimental **Private hello** setting (Settings) removes it when calling a contact whose NIDO supports it.
- **Message size.** Messages are padded to fixed sizes before encryption, so their length does not reveal the length of what you wrote.
- **Disappearing messages.** If you set a timer in a chat, new messages are deleted from both phones when it runs out (for the sender, counted from sending; for the receiver, from when they see it). Deleted messages are overwritten inside the encrypted database. A timer cannot stop someone from photographing the screen with another camera, and an older NIDO on the other side ignores it.
- **New key per message (experimental, off by default).** With the setting on in both phones, each message uses its own key and each connection also uses ML-KEM-768, a quantum-resistant algorithm.

Every local Wi-Fi connection also appears in the network log.

## Voice input

Voice dictation uses the speech recognition service installed on your phone. NIDO asks it to work offline, but that service belongs to your phone's manufacturer or to Google and may process audio according to its own policy. If that matters to you, type instead.

## Permissions

- **Bluetooth and nearby devices**: pairing and messaging between phones.
- **Network (local Wi-Fi)**: the backup route between two NIDOs on the same Wi-Fi or hotspot, and the downloads you start. No permission dialog is shown for this; Android grants it at install.
- **Display over other apps is blocked**: on Android 12 and later NIDO asks the system to hide other apps' overlays while it is on screen, so nobody can draw a fake button over a confirmation.
- **Location** (on older Android versions): required by Android to scan for Bluetooth devices. NIDO does not read your location.
- **Microphone**: voice input, only while you hold dictation open.
- **Notifications**: reminders and incoming messages.
- **Calendar and contacts**, if you grant them: so the agent can read them on the phone when you ask. They are not uploaded.

## Your controls

- Delete any chat, memory, document or contact from inside the app.
- Erase everything from Settings → Danger zone, or by uninstalling the app.
- Optional panic button (Settings → Security): holding it for 3 seconds erases all NIDO data at once, without asking for a fingerprint.
- NIDO asks your keyboard not to learn from what you type in it (incognito keyboard). Major keyboards respect this; NIDO cannot force one that ignores it.
- Create an encrypted backup and keep the key yourself. If you lose the key, nobody can recover the data, including the maintainers.

## Children

NIDO is not directed at children under 13.

## Changes and contact

Changes to this policy are made in this file and recorded in the repository history. Questions or reports: open an issue at https://github.com/Nido007-cmyk/Nido/issues, or follow [SECURITY.md](SECURITY.md) for security matters.

---

# Política de privacidad

Última actualización: 2026-10-21 (0.1.45). Aplica a la app NIDO para Android compilada desde este repositorio.

## Resumen

NIDO funciona en tu teléfono. No tiene cuentas, ni analítica, ni publicidad, ni servidores propios. Quienes mantienen el proyecto no reciben tus chats, documentos, notas, contactos ni datos de uso, porque la app no los envía a ningún lado.

## Qué se queda en tu teléfono

- Chats, notas, recordatorios, memorias y los documentos que importas.
- Los modelos de IA y paquetes de conocimiento que descargas.
- Tus claves de identidad NIDO y la lista de teléfonos emparejados.

Estos datos se guardan en una base de datos cifrada (SQLCipher). La clave de cifrado se guarda en el Keystore de Android. El respaldo automático en la nube de Android está desactivado para la app.

## Cuándo usa NIDO la red

NIDO nunca usa internet salvo cuando tú inicias una descarga:

- **Modelos de IA**, desde Hugging Face.
- **Paquetes de conocimiento y el corpus integrado**, desde GitHub.

Esos servicios ven tu dirección IP y qué archivo pediste, como en cualquier descarga, y aplican sus propias políticas de privacidad. NIDO no envía ninguna cuenta, identificador ni contenido con la petición. Cada conexión queda anotada en el registro de red dentro de la app (Acerca de → Registro de red), para que puedas comprobarlo.

## De teléfono a teléfono (Bluetooth y Wi-Fi local)

Cuando te emparejas con otro NIDO, los mensajes viajan directamente entre los dos teléfonos, cifrados de extremo a extremo. Nada pasa por un servidor ni por internet. La otra persona recibe lo que le envías y puede conservarlo.

- **Bluetooth.** Mientras NIDO está en marcha, espera a tus contactos emparejados por Bluetooth, también en segundo plano. Un dispositivo cercano que consulte el tuyo podría saber que tienes NIDO instalado. El teléfono que recibe una conexión no dice quién es hasta que el otro demuestra ser uno de tus contactos.
- **Wi-Fi local (ruta de respaldo).** Mientras buscas o te conectas a otro NIDO, también usa tu red Wi-Fi o el punto de acceso. Se anuncia en esa red con un nombre aleatorio que cambia en cada arranque y un tipo de servicio fijo: otros dispositivos de la misma red pueden ver que hay un NIDO, pero no quién eres. Solo acepta conexiones de direcciones de la red local, nunca de internet. Al salir de esa pantalla deja de anunciarse; las conexiones ya abiertas siguen.
- **Lo que todavía no se oculta.** Por defecto, el teléfono que inicia una conexión manda su clave pública de NIDO en el primer mensaje, antes de que empiece el cifrado. Alguien que grabe el tráfico Bluetooth o Wi-Fi cerca podría reconocer el mismo teléfono de una conexión a otra, sin poder leer ningún mensaje. El ajuste experimental **Saludo privado** (Ajustes) lo quita al llamar a un contacto cuyo NIDO lo soporta.
- **Tamaño de los mensajes.** Los mensajes se rellenan hasta tamaños fijos antes de cifrarse, así su longitud no revela la de lo que escribiste.
- **Mensajes temporales.** Si pones un temporizador en un chat, los mensajes nuevos se borran de los dos teléfonos al vencer (para quien envía, desde que lo envía; para quien recibe, desde que lo ve). Los mensajes borrados se sobrescriben dentro de la base cifrada. Un temporizador no impide que alguien fotografíe la pantalla con otra cámara, y un NIDO anterior del otro lado lo ignora.
- **Clave nueva por mensaje (experimental, apagado por defecto).** Con el ajuste activado en los dos teléfonos, cada mensaje usa su propia clave y cada conexión usa además ML-KEM-768, un algoritmo resistente a ordenadores cuánticos.

Cada conexión por Wi-Fi local también aparece en el registro de red.

## Entrada por voz

El dictado usa el servicio de reconocimiento de voz instalado en tu teléfono. NIDO le pide trabajar sin conexión, pero ese servicio pertenece al fabricante de tu teléfono o a Google y puede procesar el audio según su propia política. Si eso te importa, escribe en lugar de dictar.

## Permisos

- **Bluetooth y dispositivos cercanos**: emparejar y enviar mensajes entre teléfonos.
- **Red (Wi-Fi local)**: la ruta de respaldo entre dos NIDO en el mismo Wi-Fi o punto de acceso, y las descargas que inicias. Android lo concede al instalar, sin diálogo.
- **Superposiciones bloqueadas**: en Android 12 y posteriores NIDO pide al sistema ocultar las capas de otras apps mientras está en pantalla, para que nadie pueda dibujar un botón falso sobre una confirmación.
- **Ubicación** (en versiones antiguas de Android): Android la exige para buscar dispositivos Bluetooth. NIDO no lee tu ubicación.
- **Micrófono**: entrada por voz, solo mientras dictas.
- **Notificaciones**: recordatorios y mensajes entrantes.
- **Calendario y contactos**, si los concedes: para que el agente los lea en el teléfono cuando se lo pides. No se suben a ningún lado.

## Tus controles

- Borra cualquier chat, memoria, documento o contacto desde la app.
- Borra todo desde Ajustes → Zona de peligro, o desinstalando la app.
- Botón de pánico opcional (Ajustes → Seguridad): mantenerlo 3 segundos borra todos los datos de NIDO de una vez, sin pedir huella.
- NIDO pide a tu teclado que no aprenda de lo que escribes en la app (teclado incógnito). Los teclados principales lo respetan; NIDO no puede obligar a uno que lo ignore.
- Crea un respaldo cifrado y guarda tú la clave. Si pierdes la clave, nadie puede recuperar los datos, tampoco quienes mantienen el proyecto.

## Menores

NIDO no está dirigido a menores de 13 años.

## Cambios y contacto

Los cambios a esta política se hacen en este archivo y quedan en el historial del repositorio. Preguntas o reportes: abre un issue en https://github.com/Nido007-cmyk/Nido/issues, o sigue [SECURITY.md](SECURITY.md) para temas de seguridad.
