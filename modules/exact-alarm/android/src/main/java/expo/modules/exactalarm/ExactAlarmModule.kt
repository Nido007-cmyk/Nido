/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

package expo.modules.exactalarm

import android.app.AlarmManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Puente para SCHEDULE_EXACT_ALARM (Android 12+).
 *
 * expo-notifications usa setExactAndAllowWhileIdle solo si
 * AlarmManager.canScheduleExactAlarms() es true; si no, cae a alarma
 * inexacta (Doze la retrasa minutos). El manifest declara el permiso pero
 * en Android 12+ es un "special app access" que el usuario debe otorgar
 * en Ajustes. Sin este puente, JS no puede saber si las alarmas exactas
 * están disponibles.
 */
class ExactAlarmModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExactAlarm")

    Function("canScheduleExactAlarms") {
      val ctx = appContext.reactContext ?: return@Function false
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return@Function true
      val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      am.canScheduleExactAlarms()
    }

    Function("openExactAlarmSettings") {
      val ctx = appContext.reactContext ?: return@Function false
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return@Function true
      try {
        val intent = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        ctx.startActivity(intent)
        true
      } catch (_: Exception) {
        false
      }
    }
  }
}
