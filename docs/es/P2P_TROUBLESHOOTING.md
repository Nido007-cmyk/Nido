# Guía de solución de problemas P2P de NIDO

Si dos dispositivos no se conectan por Bluetooth, sigue estos pasos en orden.

## Solución rápida (funciona en la mayoría de los casos)

1. **Reinicia ambos dispositivos.** El Bluetooth se atasca; reiniciar lo limpia.
2. **Apaga el WiFi en ambos.** El WiFi y el Bluetooth comparten la antena de 2.4 GHz y se interfieren durante el emparejamiento.
3. **Empareja en Ajustes de Android primero.** Ve a Ajustes → Bluetooth en ambos, hazlos visibles y emparéjalos entre sí. NIDO necesita este emparejamiento del sistema en muchos teléfonos (especialmente Samsung).
4. **Abre NIDO y conecta** desde la pantalla P2P.
5. **Batería:** Si se desconecta en segundo plano, ve a Ajustes → Apps → NIDO → Batería → **Sin restricciones** (el nombre varía por fabricante).

## Notas por fabricante

### Samsung
- El emparejamiento del sistema suele ser **obligatorio** — NIDO no puede emparejar solo.
- Samsung puede perder los emparejamientos Bluetooth tras reiniciar. Si deja de funcionar después de reiniciar, vuelve a emparejar en Ajustes.
- Apaga **Búsqueda de dispositivos cercanos** (Ajustes → Conexiones → Más ajustes de conexión) — compite por el radio Bluetooth.

### Xiaomi / Redmi / POCO (MIUI / HyperOS)
- Activa **Inicio automático** para NIDO (Ajustes → Apps → NIDO → Inicio automático).
- Pon el ahorro de batería en **Sin restricciones**.
- Bloquea NIDO en la pantalla de Recientes (ícono del candado) para que no lo maten.

### Huawei / Honor
- Ajustes → Batería → Inicio de apps → NIDO → desactiva la gestión automática, activa **Inicio automático**, **Inicio secundario** y **Ejecutar en segundo plano**.
- Pon la optimización de batería en **No optimizar** para NIDO.

### Oppo / OnePlus / Vivo / Realme
- Permite **inicio automático** y actividad en segundo plano para NIDO.
- Desactiva **Optimización profunda** (OnePlus) o equivalente.
- Pon la optimización de batería en **No optimizar**.

## ¿Sigue sin funcionar?

Abre un issue usando la [plantilla P2P / Bluetooth](https://github.com/Nido007-cmyk/Nido/issues/new?template=p2p_bluetooth.md) con los modelos de ambos dispositivos y lo que intentaste.
