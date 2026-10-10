# Próximos pasos de NIDO

Lista viva de lo que falta para seguir mejorando la app. Última actualización: 2026-10-10, tras la versión 0.1.4.

Reglas de esta lista: cada punto dice si necesita un teléfono para probarse. Lo marcado "sin probar" ya está en el código pero nadie lo ha visto funcionar en un dispositivo.

## 1. Probar en teléfono lo que ya está hecho (0.1.1 a 0.1.4)

Nada de esto se ha probado en un dispositivo. Va antes que cualquier función nueva.

- [ ] Restaurar con la clave del respaldo (Ajustes). Usar datos que no importen y conservar el archivo original.
- [ ] Respaldo: crear, ver y copiar la clave, rotar la clave, guardar en Descargas.
- [ ] Tareas programadas: crear una para dentro de unos minutos, ver que corre, que llega el aviso y que el resultado aparece en la tarjeta.
- [ ] Historial del agente: que se conserva al cerrar la app y que "Deshacer" borra la nota o el recordatorio.
- [ ] Permisos del agente: apagar una herramienta y comprobar que el agente ya no la usa.
- [ ] Comprobación de seguridad en Acerca de.
- [ ] Tema claro y verde oscuro en todas las pantallas, sobre todo Ajustes.
- [ ] Lector de pantalla (TalkBack) en chat, Ajustes y NIDO.
- [ ] Icono monocromo nuevo en la pantalla de inicio.

## 2. P2P (necesita dos teléfonos)

- [ ] Probar emparejamiento y mensajes con la versión actual.
- [ ] PR #2 (el teléfono no contesta el saludo a desconocidos): fusionar solo si la prueba sale bien.
- [ ] Repetición de mensajes después de 10.000 (P6).
- [ ] Usar el enlace de los permisos delegados a la sesión (P7).
- [ ] `propose_negotiation` falta en el manifiesto de herramientas (F7).
- [ ] Compartir paquetes de conocimiento: terminar de conectarlo y volver a mostrar la pestaña (F2).

## 3. Mejoras pequeñas que no necesitan teléfono

- [ ] Pulgares arriba/abajo: hoy solo se guardan. Darles uso (lista de respuestas mal valoradas) o quitarlos.
- [ ] Marcar como sensible lo que se copia al portapapeles (clave de cifrado, código de emparejamiento) y borrarlo tras un tiempo.
- [ ] Pedir desbloqueo para "borrar todos los datos".
- [ ] Mover el prompt de sistema personalizado de `settings.json` a la base cifrada.
- [ ] Huella del respaldo calculada sobre bytes, no sobre texto (A6). Cambia el formato: hacerlo junto con la prueba de restauración.
- [ ] Fijar las acciones de GitHub por hash y publicar la lista de componentes (SBOM) con cada versión.
- [ ] Revisar las actualizaciones de Dependabot (#5 a #15). Una falla sus pruebas.

## 4. Mejoras que necesitan compilar y probar

- [ ] Tareas programadas con la app cerrada (requiere una librería de segundo plano).
- [ ] Memoria de conversación para el agente (hoy cada petición con herramientas es de un solo turno). Puede empeorar las respuestas de los modelos pequeños.
- [ ] Voz sin conexión garantizada (hoy usa el reconocedor del teléfono).
- [ ] Aceleración por GPU/NPU.
- [ ] Compartir hacia NIDO desde otras apps (texto, PDF).
- [ ] Declarar la versión mínima de Android.
- [ ] Linter y pruebas de interfaz (Jest) en CI. Jest falla en el runner y aún no se sabe por qué.
- [ ] Dividir los archivos de más de 800 líneas (`ChatScreen`, `NidoScreen`, `SetupWizardScreen`…).

## 5. Para que sea una app profesional (investigar y decidir)

- [ ] **Tiendas:** requisitos de Google Play (páginas de 16 KB, nivel de API objetivo, formulario de seguridad de datos, clasificación de contenido) y de F-Droid (compilación reproducible, sin binarios descargados sin consentimiento).
- [ ] **Seguridad:** cerrar las brechas de `docs/security/MASVS_CHECKLIST.md`; revisar el APK compilado (componentes exportados, permisos reales).
- [ ] **Auditoría externa del P2P** antes de llamarlo "seguro" en público.
- [ ] **Accesibilidad:** contraste medido pantalla por pantalla, tamaño de letra del sistema, pruebas con TalkBack.
- [ ] **Idiomas:** hoy son 3 (español, inglés, portugués). Decidir cuáles siguen.
- [ ] **Capturas reales** para el README y la ficha de tienda (hoy hay maquetas).
- [ ] **Medición de rendimiento** en varios teléfonos y con los 7 modelos del catálogo, publicada.
- [ ] **Actualizaciones:** aviso de versión nueva dentro de la app.
- [ ] **Soporte:** cómo reporta un usuario un fallo sin enviar datos privados.
- [ ] **Legal:** revisar privacidad y términos con alguien que sepa de la jurisdicción donde se publique; licencias de cada modelo descargable.

## Decisiones tomadas (para no reabrirlas sin motivo)

- La conexión Bluetooth entre teléfonos no se cambia sin prueba con dos teléfonos.
- El buscador de modelos de Hugging Face se quitó a propósito: buscar revela los intereses del usuario a un servidor.
- No existe "permitir sin preguntar" para las herramientas del agente: solo se puede restringir.
- Una tarea programada nunca puede enviar mensajes, llamar, emparejar ni abrir otras apps.
- El emoji de tono en la cabecera se conserva por decisión del dueño del proyecto.
- En el repo solo queda del proyecto original lo legal: licencia, atribución y créditos del código adaptado.
