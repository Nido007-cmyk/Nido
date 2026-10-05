<!--
MIT License
Copyright (c) 2026 NIDO contributors
See LICENSE file for details.
-->

> **Idioma:** [English](SECURITY.md) · Español

# Política de seguridad — NIDO

NIDO es un asistente personal de IA privado y offline. La seguridad no es una
funcionalidad aquí; es la premisa: memoria cifrada en el dispositivo, claves
respaldadas por hardware, sin cuentas, sin nube. Si encuentras una
vulnerabilidad, queremos saberlo — en privado, para poder corregirla antes de
que alguien resulte afectado.

## Cómo reportar una vulnerabilidad

**NO abras un issue público para vulnerabilidades de seguridad.**

Usa el [reporte privado de vulnerabilidades de
GitHub](https://github.com/Nido007-cmyk/Nido/security/advisories/new) de este repositorio. Abre un canal
privado entre tú y los mantenedores; nada se divulga públicamente hasta que
la corrección esté lista y su divulgación se coordine contigo.

## Alcance

Dentro del alcance:

- La app NIDO para Android: gestión de claves (Android Keystore /
  SecureStore), cifrado de la base de datos con SQLCipher, bloqueo
  biométrico, semántica de "Borrar todos los datos", criptografía de
  respaldo / restauración / borrado.
- P2P: ceremonia de emparejamiento, handshake, criptografía de sesión,
  claves de identidad.
- Motor de políticas: formas de eludir la autorización del usuario.
- Pipeline de build y firma: cualquier cosa que pudiera distribuir un APK
  manipulado.

Fuera del alcance:

- Ingeniería social, phishing o acceso físico a un dispositivo desbloqueado.
- Vulnerabilidades en dependencias de terceros — repórtalas al proyecto
  correspondiente (un aviso para nosotros también se agradece).
- El repositorio original de BOAR — repórtalo a sus propios mantenedores.

## Versiones soportadas

Las correcciones de seguridad van a la última release y a `main`. Esto es
software alpha; al reportar, usa el APK más reciente de la página de
releases e indica su versión y commit SHA.

## Qué incluir en un reporte

- Versión de NIDO (versión del APK + commit SHA si lo compilaste tú),
  modelo del dispositivo, versión de Android.
- Una descripción clara de la vulnerabilidad y su impacto: ¿qué puede hacer
  un atacante que no debería poder hacer?
- Pasos para reproducirla, idealmente mínimos. Código de prueba de concepto
  bienvenido.
- Si requiere acceso físico, un contacto emparejado o puede hacerse en
  remoto.
- Tu evaluación de severidad, si tienes una.

Mientras más preciso el reporte, más rápido podemos actuar.

## Tiempos de respuesta

- Intentamos confirmar tu reporte dentro de 5 días hábiles.
- Te mantendremos informado mientras investigamos y coordinaremos la
  divulgación contigo: sin detalles públicos hasta que haya una corrección
  disponible.
- Si no podemos reproducir el problema o no lo consideramos una
  vulnerabilidad, te explicaremos por qué.

## Puerto seguro

No tomaremos acciones legales contra nadie que, de buena fe:

- investigue dentro del alcance descrito arriba,
- no acceda, modifique ni extraiga datos de otras personas,
- no interrumpa la disponibilidad de ningún servicio,
- reporte lo encontrado por el canal privado y nos dé un tiempo razonable
  para corregirlo antes de cualquier divulgación.

## Reglas básicas

- **Nunca publiques secretos en issues públicos**: nada de material del
  keystore, claves de cifrado, credenciales, tokens ni datos reales de
  usuarios — ni siquiera fragmentos que "parezcan redactados". Si dudas de
  si algo es sensible, trátalo como sensible y usa el canal privado.
- No tenemos programa de recompensas por el momento; no condiciones tus
  reportes a un pago.
- Si usas escáneres automatizados, que sean suaves con cualquier
  infraestructura en vivo que no sea tuya.
