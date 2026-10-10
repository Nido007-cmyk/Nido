> **Idioma:** [English](../../internal/SUBMISSION_CHECKLIST.md) · Español

# Lista de verificación para el envío

Rastrea los requisitos reales del bounty contra el estado del repo. El trabajo
alcanzable por código está hecho (ver `ARCHITECTURE.es.md` para la lista
detallada de estado); todo lo de abajo necesita tu dispositivo/cuentas y no
puede hacerse desde una sesión de agente.

- [ ] `make setup` (o `npm install`)
- [ ] `make run-android` (o `npx expo prebuild -p android --clean && npx expo run:android`)
      en un dispositivo conectado — el verdadero paso sin verificar, necesita una
      compilación real de Gradle/NDK. Los modelos NO van embebidos en el APK por
      defecto (eso es `scripts/setup-models.sh` + el plugin `withBundledModels` —
      una ruta alternativa que no está activa en la lista de plugins de `app.json`
      ahora mismo); la app en su lugar muestra un asistente de configuración en el
      primer arranque que descarga los dos LLM por defecto (primario +
      rápido/secundario) + el modelo de embeddings (~3.2 GB) una vez que la abres.
- [ ] Confirmar que el asistente de primer arranque descarga y carga los tres
      modelos por defecto, y que la app responde una consulta de extremo a extremo
- [ ] Probar las consultas en `docs/es/EVAL_QUERIES.md` y capturar las respuestas
- [ ] Verificar por muestreo que la RAM vía el monitor en la app (Settings >
      Stats & System) se mantiene bajo 12 GB, y el almacenamiento bajo 50 GB
- [ ] Apagar la red por completo (modo avión) y re-verificar que la app sigue
      funcionando — la verdadera prueba del requisito de "cero conectividad"
- [ ] Publicar una demo pública (X o Farcaster): prueba de offline, consultas de
      ejemplo incluyendo las que un modelo de 1B fallaría, enlace al repo, breve
      explicación del enfoque
- [ ] Enviar una captura de pantalla + enlaces a poidh
- [ ] Asegurarse de que el estado actual del repo de GitHub coincide con lo
      mostrado/declarado en la demo
