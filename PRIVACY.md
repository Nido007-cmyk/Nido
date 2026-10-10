# Privacy policy

*Política de privacidad — versión en español más abajo.*

Last updated: 2026-10-10. Applies to the NIDO Android app built from this repository.

## Summary

NIDO runs on your phone. It has no accounts, no analytics, no advertising and no servers of its own. The project maintainers do not receive your chats, documents, notes, contacts or usage data, because the app never sends them anywhere.

## What stays on your phone

- Chats, notes, reminders, memories and the documents you import.
- The AI models and knowledge packs you download.
- Your NIDO identity keys and the list of phones you paired with.

This data is stored in an encrypted database (SQLCipher). The encryption key is kept in the Android Keystore. Android automatic cloud backup is disabled for the app.

## When NIDO uses the network

Only when you start a download:

- **AI models**, fetched from Hugging Face.
- **Knowledge packs and the built-in corpus**, fetched from GitHub.

Those services see your IP address and which file you requested, as with any download, and apply their own privacy policies. NIDO sends no account, identifier or content with the request. Every connection is recorded in the network log inside the app (About → Network log), so you can check this yourself.

## Phone-to-phone (Bluetooth)

When you pair with another NIDO, messages travel directly between the two phones over Bluetooth, end-to-end encrypted. Nothing passes through a server. The other person receives what you send them and can keep it. Nearby devices can see that your phone has Bluetooth on.

## Voice input

Voice dictation uses the speech recognition service installed on your phone. NIDO asks it to work offline, but that service belongs to your phone's manufacturer or to Google and may process audio according to its own policy. If that matters to you, type instead.

## Permissions

- **Bluetooth and nearby devices**: pairing and messaging between phones.
- **Location** (on older Android versions): required by Android to scan for Bluetooth devices. NIDO does not read your location.
- **Microphone**: voice input, only while you hold dictation open.
- **Notifications**: reminders and incoming messages.
- **Calendar and contacts**, if you grant them: so the agent can read them on the phone when you ask. They are not uploaded.

## Your controls

- Delete any chat, memory, document or contact from inside the app.
- Erase everything from Settings → Danger zone, or by uninstalling the app.
- Create an encrypted backup and keep the key yourself. If you lose the key, nobody can recover the data, including the maintainers.

## Children

NIDO is not directed at children under 13.

## Changes and contact

Changes to this policy are made in this file and recorded in the repository history. Questions or reports: open an issue at https://github.com/Nido007-cmyk/Nido/issues, or follow [SECURITY.md](SECURITY.md) for security matters.

---

# Política de privacidad

Última actualización: 2026-10-10. Aplica a la app NIDO para Android compilada desde este repositorio.

## Resumen

NIDO funciona en tu teléfono. No tiene cuentas, ni analítica, ni publicidad, ni servidores propios. Quienes mantienen el proyecto no reciben tus chats, documentos, notas, contactos ni datos de uso, porque la app no los envía a ningún lado.

## Qué se queda en tu teléfono

- Chats, notas, recordatorios, memorias y los documentos que importas.
- Los modelos de IA y paquetes de conocimiento que descargas.
- Tus claves de identidad NIDO y la lista de teléfonos emparejados.

Estos datos se guardan en una base de datos cifrada (SQLCipher). La clave de cifrado se guarda en el Keystore de Android. El respaldo automático en la nube de Android está desactivado para la app.

## Cuándo usa NIDO la red

Solo cuando tú inicias una descarga:

- **Modelos de IA**, desde Hugging Face.
- **Paquetes de conocimiento y el corpus integrado**, desde GitHub.

Esos servicios ven tu dirección IP y qué archivo pediste, como en cualquier descarga, y aplican sus propias políticas de privacidad. NIDO no envía ninguna cuenta, identificador ni contenido con la petición. Cada conexión queda anotada en el registro de red dentro de la app (Acerca de → Registro de red), para que puedas comprobarlo.

## De teléfono a teléfono (Bluetooth)

Cuando te emparejas con otro NIDO, los mensajes viajan directamente entre los dos teléfonos por Bluetooth, cifrados de extremo a extremo. Nada pasa por un servidor. La otra persona recibe lo que le envías y puede conservarlo. Los dispositivos cercanos pueden ver que tu teléfono tiene Bluetooth encendido.

## Entrada por voz

El dictado usa el servicio de reconocimiento de voz instalado en tu teléfono. NIDO le pide trabajar sin conexión, pero ese servicio pertenece al fabricante de tu teléfono o a Google y puede procesar el audio según su propia política. Si eso te importa, escribe en lugar de dictar.

## Permisos

- **Bluetooth y dispositivos cercanos**: emparejar y enviar mensajes entre teléfonos.
- **Ubicación** (en versiones antiguas de Android): Android la exige para buscar dispositivos Bluetooth. NIDO no lee tu ubicación.
- **Micrófono**: entrada por voz, solo mientras dictas.
- **Notificaciones**: recordatorios y mensajes entrantes.
- **Calendario y contactos**, si los concedes: para que el agente los lea en el teléfono cuando se lo pides. No se suben a ningún lado.

## Tus controles

- Borra cualquier chat, memoria, documento o contacto desde la app.
- Borra todo desde Ajustes → Zona de peligro, o desinstalando la app.
- Crea un respaldo cifrado y guarda tú la clave. Si pierdes la clave, nadie puede recuperar los datos, tampoco quienes mantienen el proyecto.

## Menores

NIDO no está dirigido a menores de 13 años.

## Cambios y contacto

Los cambios a esta política se hacen en este archivo y quedan en el historial del repositorio. Preguntas o reportes: abre un issue en https://github.com/Nido007-cmyk/Nido/issues, o sigue [SECURITY.md](SECURITY.md) para temas de seguridad.
