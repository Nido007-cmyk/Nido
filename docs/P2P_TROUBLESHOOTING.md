# NIDO P2P Troubleshooting Guide

If two devices won't connect over Bluetooth, follow these steps in order.

## Quick fix (works in most cases)

1. **Restart both devices.** Bluetooth stacks get stuck; a reboot clears it.
2. **Turn off WiFi on both devices.** WiFi and Bluetooth share the 2.4 GHz antenna and interfere with each other during pairing.
3. **Pair in Android Settings first.** Go to Settings → Bluetooth on both devices, make them visible, and pair them with each other. NIDO needs this system-level pairing on many phones (especially Samsung).
4. **Open NIDO and connect** from the P2P screen.
5. **Battery:** If the connection drops in the background, go to Settings → Apps → NIDO → Battery → **Unrestricted** (wording varies by manufacturer).

## Per-manufacturer notes

### Samsung
- System-level pairing is usually **required** — NIDO cannot pair on its own.
- Samsung may lose Bluetooth pairings after a reboot. If it stops working after restarting, re-pair in Settings.
- Turn off **Nearby device scanning** (Settings → Connections → More connection settings) — it competes for the Bluetooth radio.

### Xiaomi / Redmi / POCO (MIUI / HyperOS)
- Enable **Autostart** for NIDO (Settings → Apps → NIDO → Autostart).
- Set Battery saver to **No restrictions**.
- Lock NIDO in the Recents screen (tap the lock icon) so it isn't killed.

### Huawei / Honor
- Settings → Battery → App launch → NIDO → turn OFF automatic management, enable **Auto-launch**, **Secondary launch**, and **Run in background**.
- Set Battery optimization to **Don't optimize** for NIDO.

### Oppo / OnePlus / Vivo / Realme
- Allow **Auto-launch** and background activity for NIDO.
- Disable **Deep optimization** (OnePlus) or equivalent.
- Set battery optimization to **Don't optimize**.

## Still not working?

Open an issue using the [P2P / Bluetooth template](https://github.com/Nido007-cmyk/Nido/issues/new?template=p2p_bluetooth.md) with both device models and what you tried.
