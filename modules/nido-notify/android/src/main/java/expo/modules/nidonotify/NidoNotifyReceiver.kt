/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

package expo.modules.nidonotify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Recibe las alarmas de los avisos y los avisos del sistema (teléfono
 * encendido, app actualizada) para volver a programarlos. Las mismas
 * acciones que escuchaba el receptor de expo-notifications.
 */
class NidoNotifyReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val pending = goAsync()
    Thread {
      try {
        when (intent.action) {
          NotifyEngine.ACTION_FIRE -> {
            val id = intent.getStringExtra(NotifyEngine.EXTRA_IDENTIFIER)
            if (id != null) NotifyEngine.onAlarm(context.applicationContext, id)
          }
          Intent.ACTION_BOOT_COMPLETED,
          Intent.ACTION_REBOOT,
          Intent.ACTION_MY_PACKAGE_REPLACED,
          "android.intent.action.QUICKBOOT_POWERON",
          "com.htc.intent.action.QUICKBOOT_POWERON" -> NotifyEngine.rescheduleAll(context.applicationContext)
        }
      } finally {
        pending.finish()
      }
    }.start()
  }
}
