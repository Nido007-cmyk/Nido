> **Idioma:** [English](../ROADMAP.md) · Español

# NIDO: Roadmap público

## Visión

Un asistente personal de IA diseñado para vivir en tu dispositivo: privado, local y bajo tu control.

No requiere una cuenta. Las funciones principales no dependen de la nube. Los datos personales se almacenan cifrados en el dispositivo y solo se comparten cuando tú decides utilizar funciones que lo requieren, como la comunicación entre dispositivos o el backup/exportación.

## Dónde estamos

Alpha.

La base funciona: chat de IA en el dispositivo, memoria cifrada, herramientas locales, capacidades offline y comunicación cifrada entre dispositivos.

Las pruebas automatizadas son extensas, pero no sustituyen las pruebas con hardware real. La validación física (incluyendo P2P entre dos dispositivos) es el gate actual antes de considerar NIDO listo para una distribución más amplia.

Documentamos qué está verificado, qué es experimental, qué está incompleto y qué todavía necesita validación física. Consulta el README y la documentación del proyecto para conocer el estado actual.

## Roadmap

### Ahora: Probando la base

- Validar NIDO en dispositivos Android reales
- Completar las pruebas P2P entre dos dispositivos y las pruebas offline
- Verificar recordatorios, voz, memoria cifrada, backup y recuperación
- Mejorar confiabilidad y usabilidad basándonos en pruebas reales
- Mantener cada parte de la UI honesta: sin funciones simuladas ni estados falsos de éxito
- Corregir regresiones antes de ampliar las funciones

### Después: Profundizando el producto

- Mejorar la comprensión local del tiempo, contexto y seguimiento
- Fortalecer la experiencia NIDO-a-NIDO
- Continuar mejorando voz e interacción local
- Pulir la experiencia en inglés, español y portugués
- Mejorar accesibilidad y la experiencia del usuario nuevo
- Ampliar las pruebas automatizadas y en dispositivos físicos

### Más adelante: Creciendo el ecosistema

- Preparar NIDO para una distribución pública más amplia
- Distribución mediante Google Play
- Sitio web dedicado y documentación pública ampliada
- Facilitar las contribuciones de la comunidad open source
- Explorar nuevas capacidades completamente locales sin comprometer la arquitectura offline-first

## Principios que no cambiarán

- Offline primero. Las funciones principales deben funcionar sin conexión a Internet.
- Control del usuario. Tus datos te pertenecen y permanecen bajo tu control.
- Local por defecto. Los datos personales se almacenan cifrados en el dispositivo salvo que tú decidas compartirlos o exportarlos.
- Sin funciones falsas. Si una capacidad no está realmente conectada y funcionando, la interfaz no debe aparentar que lo está.
- Sin cuenta obligatoria. NIDO no debe requerir una cuenta para funcionar.
- Sin modelo de negocio basado en rastreo. NIDO no dependerá de vender o crear perfiles de la actividad de sus usuarios.
- Código abierto. NIDO utiliza licencia MIT y respeta los requisitos de atribución de los proyectos sobre los que se construye.

## Contribuir

NIDO se desarrolla abiertamente y los colaboradores son bienvenidos.

Nos interesa especialmente recibir ayuda en:

- Android y React Native
- IA local e inferencia en el dispositivo
- Privacidad y seguridad de aplicaciones
- Bluetooth y comunicación entre dispositivos
- Accesibilidad y UI/UX
- Pruebas en dispositivos Android reales
- Documentación y traducciones

No necesitas desarrollar una función importante para contribuir. Las pruebas, reportes de bugs, mejoras de documentación y pequeños fixes también son valiosos.

NIDO todavía es software alpha. Si quieres ayudar a construir un asistente personal de IA privado y local-first, eres bienvenido.
