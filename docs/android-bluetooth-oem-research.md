# Android Bluetooth OEM Research — RFCOMM/SPP per-fabricante

**Fecha:** 2026-10-10
**Contexto:** NIDO usa Bluetooth clásico RFCOMM (`createInsecureRfcommSocketToServiceRecord`) para P2P NIDO↔NIDO. En el Samsung Galaxy Tab A9+ 5G (SM-X218U) se observó que la conexión solo funciona tras: reiniciar tablets, apagar WiFi, y emparejar en Ajustes de Android antes de abrir NIDO. Esta investigación determina qué ajustes por fabricante se necesitan.

---

## 1. Fabricantes top por volumen

### Teléfonos — FY2025 (Omdia, vía cleartechai / IDC)
| # | Fabricante | Share aprox. |
|---|------------|--------------|
| 1 | Samsung | ~19% |
| 2 | Xiaomi | ~13% |
| 3 | Vivo | ~8% |
| 4 | OPPO (incl. OnePlus/realme en agrupación Counterpoint) | ~8% |
| 5 | Transsion (Tecno/Infinix/itel) | ~8% |
| 6 | Honor | ~6% |
| 7 | Lenovo/Motorola | ~5% |
| 8 | Huawei | ~4% |
| 9 | realme | ~3% |

H1 2026 (Counterpoint): Samsung 22%, Xiaomi 11%, OPPO 10%, vivo 8%.
Fuentes: https://news.cleartechai.com/omdia-apple-narrowly-beats-samsung-in-2025-shipping-the-most-smartphones/ · https://tablet-news.com/samsung-leads-global-smartphone-shipments-in-h1-2026-but-apple-is-one-point-behind/

### Tablets — Q2/Q3 2025 (IDC)
1. Apple ~33–35% · 2. Samsung ~18–19% · 3. Lenovo ~8–10% · 4. Amazon ~8% · 5. Huawei ~9% / Xiaomi ~6–7%. En India, Samsung domina tablets (~37–41%).
Fuentes: https://m.gsmarena.com/idc_global_tablet_shipments_grow_by_13_in_q2_apple_leads_the_way-news-68970.php · https://telecomlead.com/smart-phone/global-tablet-market-declines-4-4-in-q3-2025-apple-samsung-lenovo-huawei-and-xiaomi-lead-vendor-rankings-123409

---

## 2. Stack Bluetooth: todos usan Fluoride

Conclusión clave de la investigación: **ningún OEM moderno (Android 8+) usa un stack userspace distinto de AOSP Fluoride/Bluedroid**. Las diferencias OEM viven en la HAL del vendor, el firmware del combo-chip y las capas de ecosistema (SmartThings, HyperConnect, etc.). El chipset importa más que la marca: Qualcomm vs MediaTek vs Unisoc.

- **Samsung:** Fluoride modificado — existe una librería Bluetooth propia de Samsung (el proyecto XDA "BluetoothLibraryPatcher" existe porque el fix "NOT applicable with an aosp rom, only samsung stock/based"). Modificaciones en framework/service, vendor HAL y firmware del controlador. https://xdaforums.com/t/bluetoothlibrarypatcher-fix-bluetooth-pairings-loss-android-14-13-12-11-10-pie-oreo-nougat.4017735/page-21
- **Xiaomi/HyperOS, Oppo/ColorOS, Vivo/OriginOS, OnePlus/OxygenOS:** Fluoride sobre base AOSP. OnePlus = mismo código que ColorOS desde OxygenOS 12. https://www.androidcentral.com/oxygenos-12-oneplus-identity
- **Motorola:** casi stock Android; Fluoride sin desviaciones documentadas.
- **Lenovo:** Fluoride stock-ish en ROMs globales; la variable dominante es el chipset (la mayoría de sus tablets actuales son MediaTek: Tab M9 Helio G80, Idea Tab Dimensity 6300). https://www.notebookcheck.net/The-tablet-with-the-best-sound-system-in-years-Lenovo-Tab-Plus-Gen-2-in-review.1402404.0.html
- **Huawei/EMUI, Honor/MagicOS:** Fluoride con customizaciones de framework/vendor. **NO se verificó** el supuesto "NPE dentro de BluetoothSocket.connect() en Huawei" — ninguna fuente primaria lo documenta; los NPEs vistos por devs son casi siempre app-side (socket null tras un `create*` fallido). No construir handling Huawei-específico alrededor de eso.
- **Google Pixel:** referencia AOSP. Si funciona en Pixel, las desviaciones en otros son bugs OEM.

---

## 3. Modelo de permisos Bluetooth por versión de Android

Fuente: https://developer.android.com/develop/connectivity/bluetooth/bt-permissions

**API ≤ 30 (pre-Android 12):**
- `BLUETOOTH` — cualquier comunicación BT.
- `BLUETOOTH_ADMIN` — iniciar discovery / manipular ajustes.
- `ACCESS_FINE_LOCATION` (runtime) — el scan BT puede revelar ubicación. En Android 10/11, servicios en background además necesitaban `ACCESS_BACKGROUND_LOCATION` para discovery.

**API 31+ (Android 12+):** tres permisos runtime nuevos, presentados al usuario como un solo grupo **"Dispositivos cercanos"**:
- `BLUETOOTH_SCAN` — buscar dispositivos.
- `BLUETOOTH_ADVERTISE` — hacer el dispositivo descubrible.
- `BLUETOOTH_CONNECT` — comunicarse con dispositivos (ya emparejados).
- Los legacy `BLUETOOTH`/`BLUETOOTH_ADMIN` se limitan con `android:maxSdkVersion="30"`.
- Flag `neverForLocation`: si la app nunca deriva ubicación de los scans, declarar `android:usesPermissionFlags="neverForLocation"` en `BLUETOOTH_SCAN` y se puede omitir `ACCESS_FINE_LOCATION`.
- En API 31+, `cancelDiscovery()` requiere `BLUETOOTH_SCAN` (antes `BLUETOOTH_ADMIN`).

**Android 14 (API 34):**
- Apps target-34+ deben declarar `foregroundServiceType` por servicio; para servicios de conexión BT el tipo correcto es `connectedDevice`. El sistema valida permisos al crear el servicio (SecurityException si faltan). https://www.allianceTek.com/blog/post/2024/08/30/api-level-34-requirements-in-android-14.aspx
- `BluetoothAdapter.getProfileConnectionState()` ahora requiere `BLUETOOTH_CONNECT`.

**Android 15 (API 35):** requisito de **página de 16 KiB** para `.so` ARM64 en Google Play (desde nov-2025); el linker rechaza librerías mal alineadas en dispositivos de 16 KiB. Recompilar con NDK r28+ o `-Wl,-z,max-page-size=16384`. https://developer.android.com/guide/practices/page-sizes

**Android 13 (API 33):** sin cambios BT relevantes encontrados.

**Deprecación:** `BluetoothAdapter.getDefaultAdapter()` deprecado en API 31; reemplazo: `context.getSystemService(BluetoothManager.class).getAdapter()`. https://developer.android.com/reference/android/bluetooth/BluetoothAdapter

**Discoverability:** requiere consentimiento del usuario vía actividad del sistema `ACTION_REQUEST_DISCOVERABLE`. Duración default 120 s, máximo 300 s por petición. En S+ requiere `BLUETOOTH_ADVERTISE` (runtime). No hay bypass programático.

### Manejo por OEM (notas)
- **Samsung/One UI:** los tres permisos se agrupan bajo "Nearby devices". El diálogo solo aparece cuando la app invoca una API que lo requiere. Issue documentado: flutter-permission-handler #838 "Bluetooth is not working on Samsung" — el fix es el split exacto de manifest (legacy con maxSdkVersion 30 + los tres nuevos). https://github.com/Baseflow/flutter-permission-handler/issues/838
- **Xiaomi/Oppo/Vivo/OnePlus/Huawei:** modelo estándar Android 12+; no se encontró quirk BT-específico de diálogos de permiso. Recomendación defensiva: en ROMs agresivas pedir también `ACCESS_FINE_LOCATION` y exigir Location services ON — varios ROMs atan la fiabilidad de scan/connect a ello. https://github.com/bearound/bearound-android-sdk/blob/HEAD/README.md
- **Huawei/EMUI ≤ 11:** el master toggle de ubicación apaga también el posicionamiento por BT; si está off, el discovery no devuelve nada en silencio.

---

## 4. Quirks RFCOMM/SPP por fabricante

### El error canónico
`java.io.IOException: read failed, socket might closed or timeout, read ret: -1` durante `connect()` es EL fallo RFCOMM estándar (viene de `BluetoothSocket.readAll()/readInt()`; existe desde el cambio BlueZ→Bluedroid en Android 4.2). Causas documentadas:
- El peer no expone el UUID vía SDP (UUID incorrecto, o el otro lado no está en `accept()`).
- Discovery activo durante connect — **siempre `cancelDiscovery()` antes de `connect()`**; el inquiry scan "starvea" la conexión y es la causa #1 de timeouts de ~12 s.
- Socket a medio abrir de un intento previo bloquea el siguiente — cerrar el socket entre intentos.
- Confusión dirección clásica vs LE: conectar RFCOMM contra la dirección de identidad LE siempre falla con este error.
Fuentes: https://github.com/mazenrashed/printooth/issues/44 · https://github.com/miskibin/obd2-dashboard/blob/HEAD/docs/research-obd2-protocol.md · https://github.com/cayatur/windows-to-android-bridge/blob/HEAD/docs/ARCHITECTURE.md

### Samsung
- **"Inseguro" no garantiza sin emparejamiento:** devs reportan que `createInsecureRfcommSocketToServiceRecord` + `connect()` **aún dispara el diálogo de emparejamiento del sistema** en algunas tablets/stacks. El patrón confiable en campo es exactamente lo observado: **emparejar una vez en Ajustes del sistema, luego conectar programáticamente contra un dispositivo bonded**. https://pub.dev/packages/bluetooth_spp · https://github.com/miskibin/obd2-dashboard/blob/HEAD/docs/research-obd2-protocol.md
- **Bug Samsung-only de persistencia de bonds:** ROMs stock Samsung pierden emparejamientos tras reboot o toggle de modo avión (Nougat→13); el XDA BluetoothLibraryPatcher existe solo para esto ("only samsung stock/based"). **Explica directamente el síntoma "tuvo que reiniciar"**: en Samsung el estado de bond tras reboot no es confiable — hay que re-verificar el bond antes de conectar, no asumir que persistió. https://xdaforums.com/t/bluetoothlibrarypatcher-fix-bluetooth-pairings-loss-android-14-13-12-11-10-pie-oreo-nougat.4017735/page-21
- **Coexistencia WiFi+BT (confirmado en Samsung):** "Samsung Galaxy S phones are notoriously known for this kind of problems. They have very weak filters separating Bluetooth and Wi-Fi frequencies" (ambos en 2.4 GHz). Thread Galaxy A51: "when I turn off my Wi-Fi network, Bluetooth works correctly". Mitigación: WiFi 5 GHz o WiFi off durante pairing/discovery. https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-mobile-andriod/445528/sync-sunk-recovery-or-not · https://r2.community.samsung.com/t5/Galaxy-A/Galaxy-A51-Bluetooth-and-WiFi-issues-Causes-and-Temporary/td-p/3365892
- **"Nearby device scanning"** (Ajustes → Conexiones → Más ajustes de conexión) escanea BT/WiFi en background **incluso con Bluetooth apagado** (diseño intencional del ecosistema Galaxy). Genera contención de radio durante discovery/connect — recomendar apagarlo. https://www.sammobile.com/news/why-is-your-galaxy-phone-getting-nearby-device-notifications-with-bluetooth-turned-off/
- **Matanza de background:** Samsung es el peor OEM en dontkillmyapp. El socket RFCOMM muere en background si no se exime: Ajustes → Apps → [app] → Batería → **Sin restricciones** + "Never sleeping apps". https://screenrant.com/samsung-rated-worst-killing-android-11-background-apps-dontkillmyapp-how-to-fix/
- Tab A9+ 5G (SM-X218U): Snapdragon 695, Android 13/One UI 5.1 (actualizable a 14), WiFi dual-band a/b/g/n/ac + WiFi Direct. BT listado como 5.1 en bases de datos vs 5.3 en copy de Samsung (sin verificar; irrelevante para RFCOMM clásico).

### Xiaomi (MIUI/HyperOS)
- Sin quirk RFCOMM específico encontrado; aplican las reglas universales.
- **Background killing — peor nivel junto a Huawei.** HyperOS mata procesos en el intervalo Doze (~30 min) salvo "Sin restricciones". dontkillmyapp: Xiaomi mata hasta foreground services. Ajustes requeridos para el loop `accept()`: **Autostart ON** + **Ahorro de batería → Sin restricciones** + bloquear la app en Recientes (candado). Solo desactivar la optimización de batería a menudo NO basta; "Automatic startup" fue el fix clave en XDA. https://xdaforums.com/t/is-there-any-way-of-not-having-miui-terminate-background-apps-every-few-hours.4641583/ · https://xdaforums.com/t/miui-14-stopping-apps-in-background.4577485/
- **Coexistencia (bien documentada):** el filing FCC de Xiaomi describe coexistencia WLAN/BT como *time-sharing, sin transmisión simultánea*. Reportes: Redmi Note 11 — encender BT rompe WiFi, se arregla con reboot o 5 GHz; mismo patrón en Mi Pad 4, Mi 5s, Mi A1, Redmi Note 4X. El tuning de coexistencia de MIUI difiere de AOSP. https://fccpdf.com/2AFZZ/2AFZZRPBDG/8582806.pdf · https://xdaforums.com/t/redmi-note-11-bluetooth-interferes-with-wifi.4468393/post-89586555 · https://xdaforums.com/t/another-tablet-with-shared-antennas.3862202/
- Deep-links para guía in-app: `com.miui.powerkeeper` HoldApplicationsDetailActivity (fallback: Security Center AppPermissionsEditorActivity).

### Oppo (ColorOS)
- Sin bug RFCOMM específico encontrado. Limitación histórica: ColorOS limitaba a ~5 apps en auto-start y ~5 bloqueadas en memoria; companion apps de accesorios BT reportadas rotas. Ajustes: permitir auto-launch + actividad en background + sin optimización de batería. Servicio foreground con notificación persistente **no descartable** (algunas skins reapean notificaciones de baja importancia). https://xdaforums.com/t/are-there-any-deal-breakers-in-this-gorgeous-device.3820409/page-2 · https://github.com/fluttercommunity/flutter_workmanager/blob/HEAD/docs/troubleshooting.mdx
- Coexistencia: sin reportes Oppo-específicos encontrados — no afirmar problema; probar en hardware.

### Vivo (OriginOS/FuntouchOS)
- Sin quirk RFCOMM específico. Background agresivo vía **iManager / com.vivo.pem** (no se puede remover). Ajustes: **Batería → Alto consumo de energía en segundo plano** (allowlist oficial de Vivo) + **Autostart** + bloquear en Recents. https://www.vivoglobal.ph/questionlist/How-to-turn-onoff-High-background-power-consumption/ · https://github.com/sn4k3/TiagoConceicao/wiki/Vivo-OriginOS-setup-guide-for-global-user

### OnePlus (OxygenOS)
- Desde OxygenOS 12 = mismo código que ColorOS → tratar como Oppo.
- La página dontkillmyapp de OnePlus vincula su "deep optimization" con **pérdida de conexiones Bluetooth** a wearables — su power management demonstrablemente mata persistencia de links BT. Ajustes: desactivar **Deep optimization**, **Sleep standby optimization** (desactiva red de noche), **App Auto-Launch** por app; per-app "Don't optimize" + lock en Recents. Advertencia: OnePlus ha revertido "Don't optimize" a optimizado aleatoriamente — el lock en Recents es el workaround. https://github.com/jley81/dont-kill-my-app/blob/HEAD/_vendors/oneplus.md

### Motorola
- Casi stock; sin quirks RFCOMM documentados. Leniente en background (no aparece en rankings dontkillmyapp): basta Doze estándar + foreground service + `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`. (Inferido de ausencia en listas de ofensores.)

### Lenovo (tablets)
- Sin modificaciones RFCOMM documentadas. La variable es el chipset (mayoría MediaTek). Dos mecanismos de background: Battery Manager propio + **DuraSpeed** (freezer de MediaTek en devices MTK económicos) — debe apagarse o whitelistearse la app. https://github.com/spirtosan/4shu/blob/HEAD/KEEPALIVE_OEM_ANALYSIS.md

### Huawei (EMUI) / Honor (MagicOS)
- **Background: el ajuste más agresivo.** dontkillmyapp los rankea entre los peores. Los tres pasos son obligatorios (el exemption estándar NO basta): 1) Ajustes → Batería → **Inicio de apps** → app → gestión automática OFF, activar **Auto-launch + Secondary launch + Run in background**; 2) Optimización de batería → **Sin optimizar**; 3) en EMUI viejo, PowerGenius (`com.huawei.powergenie`) congela apps. Tip diagnóstico: si la notificación persistente del foreground service *desaparece* con pantalla apagada = proceso matado (whitelist); si *permanece* pero el peer lo ve offline = socket/wakelock throttled. https://github.com/spirtosan/4shu/blob/HEAD/KEEPALIVE_OEM_ANALYSIS.md · https://www.Androidpolice.com/2019/01/13/dontkillmyapp-com-shames-oems-that-needlessly-kill-useful-background-processes-to-save-battery-life/
- Honor hereda el mismo flujo (MagicOS 7/8 algo atenuado pero sigue siendo el ajuste #1).
- HarmonyOS NEXT (5.x): sin datos verificados — probar físicamente.

### Google Pixel
- Referencia AOSP: sin quirks. Úsalo para validar el flujo de permisos y luego adapta el copy de UX a las rutas de ajustes de cada OEM.

---

## 5. Chipsets: Qualcomm vs MediaTek vs Unisoc

- **Qualcomm (Snapdragon + WCN, ej. SD 695 del Tab A9+):** Fluoride + vendor HAL Qualcomm; el camino mejor probado de AOSP después de Pixel. Sin quirks RFCOMM documentados. Coexistencia por PTA en firmware; se comporta bien.
- **MediaTek:** mismo Fluoride arriba, pero transporte propio (`/dev/stpbt` vía `libbt-vendor`/WMT en chips CONSYS). Quirks relevantes: **DuraSpeed** (el freezer de background — la rotura MTK más común para P2P, y NO es un bug Bluetooth); coexistencia 2.4 GHz compartida (preferir WiFi 5 GHz o WiFi-off durante sesiones BT). **El supuesto "SDP caching de MTK": NO verificado** — no afirmar. https://github.com/dangerouslaser/couch/blob/HEAD/docs/bluetooth.md
- **Unisoc (Tiger T606/T610/T616/T618 — común en tablets económicas):** sin quirks RFCOMM funcionales documentados (desconocido — merece prueba física). Nota de seguridad: **CVE-2023-33901** — falta de check de permisos en el servicio BT en varios chipsets Unisoc; tratar el servicio BT como menos endurecido. https://www.redpacketsecurity.com/unisoc-mobile-phone-chipsets-for-android-information-disclosure-cve-2023-33901/

---

## 6. Recomendaciones concretas para `createInsecureRfcommSocketToServiceRecord`

### Cadena de conexión (implementar en el módulo nativo)
1. **Bond-first:** enumerar `bondedDevices`; si no hay bond, llamar `createBond()` o guiar a Ajustes del sistema (lo más confiable en Samsung). Esperar `BOND_BONDED`. Re-verificar el bond tras cada reboot (bug Samsung de pérdida de bonds).
2. **Higiene de radio:** `cancelDiscovery()` inmediatamente antes de `connect()`.
3. **Escalera de fallbacks:** secure `createRfcommSocketToServiceRecord(SPP_UUID)` → insecure `createInsecureRfcommSocketToServiceRecord(SPP_UUID)` → **reflection** `device.getClass().getMethod("createRfcommSocket", int.class).invoke(device, 1)` (canal 1 hardcodeado, salta SDP; último recurso, no garantizado para siempre por las restricciones de hidden API). Cerrar el socket entre intentos; socket fresco por intento; capturar `RuntimeException` además de `IOException` (NPEs de stacks OEM). Fuentes: https://github.com/pooja-goel07/bluecomm · https://github.com/miskibin/obd2-dashboard/blob/HEAD/docs/research-obd2-protocol.md · https://pub.dev/packages/bluetooth_spp
4. **Mismo UUID SPP en ambos extremos** (`00001101-0000-1000-8000-00805F9B34FB`); un lado debe estar en `accept()` antes de que el otro conecte.
5. **Watchdog:** `connect()` bloquea (~12 s timeout del stack, muy largo para UX); correrlo en hilo de I/O dedicado y abortar con `socket.close()` desde otro hilo ante timeout propio (ya implementado en NidoP2PManager: watchdog 7 s).
6. **Pin por dispositivo:** recordar qué método funcionó por MAC y usarlo primero (patrón de la app Bluetooth GPS Provider: https://l-36.com/bluetooth_gps_provider.php).

### Permisos (manifest + runtime)
- API 31+: declarar y pedir en runtime `BLUETOOTH_SCAN` (+`neverForLocation` si no se deriva ubicación), `BLUETOOTH_CONNECT`, `BLUETOOTH_ADVERTISE`. Legacy con `maxSdkVersion="30"`.
- En ROMs agresivas (Xiaomi/Oppo/Vivo/OnePlus/Huawei): pedir también `ACCESS_FINE_LOCATION` y exigir Location services ON para fiabilidad de discovery.
- Re-chequear `checkSelfPermission(BLUETOOTH_CONNECT)` inmediatamente antes de `connect()`, no solo al arrancar (defensivo en EMUI).
- `BluetoothAdapter.getDefaultAdapter()` deprecado en 31 → usar `BluetoothManager.getAdapter()`.

### Servicio y batería
- El loop `accept()` debe vivir en un **foreground service** con notificación persistente no descartable; en Android 14+ declarar `foregroundServiceType="connectedDevice"`.
- **Wizard de configuración por OEM** con deep-links (no solo texto): Xiaomi (Autostart + Sin restricciones + lock Recents), Oppo/OnePlus (auto-launch + deep optimization off + Don't optimize), Vivo (High background power consumption + Autostart), Huawei/Honor (App launch triple-toggle + Sin optimizar), Samsung (Batería → Sin restricciones + Never sleeping apps + apagar "Nearby device scanning").
- Referencias: https://dontkillmyapp.com · https://github.com/spirtosan/4shu/blob/HEAD/KEEPALIVE_OEM_ANALYSIS.md

### Coexistencia WiFi+BT (aplica al Tab A9+ y Xiaomi)
- Durante pairing/discovery: WiFi off o WiFi 5 GHz. El problema es física de antena compartida en 2.4 GHz (firmware), no arreglable en código app.
- Documentarlo en la UI de NIDO como paso de troubleshooting, no como error.

### Qué NO hacer
- No asumir que "inseguro" evita el emparejamiento del sistema (en Samsung a veces lo exige igual).
- No asumir que el bond sobrevive a un reboot (Samsung).
- No construir handling específico para el "NPE de Huawei" (no verificado).
- No afirmar quirks de SDP en MediaTek ni de coexistencia en Oppo/Vivo/OnePlus sin prueba física.

---

## 7. Banderas de incertidumbre

- ❌ NPE dentro de `BluetoothSocket.connect()` específico de Huawei — no verificado.
- ❌ SDP-caching / timeouts RFCOMM específicos de MediaTek — no verificado.
- ❌ Comportamiento BT en HarmonyOS NEXT (5.x) — desconocido.
- ❌ Quirks RFCOMM funcionales en Unisoc — desconocidos (solo CVE-2023-33901 de seguridad).
- ⚠️ Modificaciones exactas de Samsung a Fluoride — no documentadas públicamente; la evidencia es el BluetoothLibraryPatcher Samsung-only.
- ⚠️ "Leniente" en Motorola/Lenovo — inferido de ausencia en dontkillmyapp, no de medición positiva.
- ⚠️ Quirks de permisos BT por OEM (EMUI/MagicOS/ZUI) más allá del modelo estándar — no verificados.

---

*Generado 2026-10-10 a partir de investigación web con fuentes citadas. Cada afirmación lleva su fuente; lo no verificado está marcado explícitamente.*
