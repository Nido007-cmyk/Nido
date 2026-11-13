/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

package expo.modules.nidonotify

import java.util.Calendar

/**
 * Cuándo toca el próximo aviso. Kotlin puro, sin Android: se compila en la
 * JVM y se prueba en la CI (scripts/check-notify-triggers.mjs).
 *
 * Es la misma cuenta que hacía expo-notifications 57.0.24
 * (notifications/triggers/NotificationTriggers.kt, nextTriggerDate), línea
 * a línea, para que los avisos de NIDO caigan a la misma hora que antes de
 * cambiar de motor:
 *  - el calendario es Calendar.getInstance() del teléfono (zona y semana
 *    del sistema), con su modo indulgente;
 *  - segundos y milisegundos a cero;
 *  - si la hora calculada ya pasó, se suma un día, una semana
 *    (DAY_OF_WEEK_IN_MONTH), un mes o un año;
 *  - un aviso de fecha fija que ya pasó no se programa (null).
 *
 * weekday sigue a Calendar: 1 = domingo … 7 = sábado. month empieza en 0.
 */
data class TriggerSpec(
  val type: String,
  val timestamp: Long = 0L,
  val hour: Int = 0,
  val minute: Int = 0,
  val weekday: Int = 0,
  val day: Int = 0,
  val month: Int = 0,
) {
  val repeats: Boolean get() = type != TYPE_DATE

  companion object {
    const val TYPE_DATE = "date"
    const val TYPE_DAILY = "daily"
    const val TYPE_WEEKLY = "weekly"
    const val TYPE_MONTHLY = "monthly"
    const val TYPE_YEARLY = "yearly"
  }
}

object NotifyTriggers {
  /**
   * El próximo disparo en milisegundos, o null si no habrá ninguno.
   * [now] es «ahora» con el calendario del teléfono; las pruebas pasan uno
   * fijo. No se modifica.
   */
  fun nextTriggerMillis(spec: TriggerSpec, now: Calendar): Long? {
    val rightNow = now.clone() as Calendar
    return when (spec.type) {
      TriggerSpec.TYPE_DATE -> if (spec.timestamp < rightNow.timeInMillis) null else spec.timestamp
      TriggerSpec.TYPE_DAILY -> {
        val next = rightNow.clone() as Calendar
        next[Calendar.HOUR_OF_DAY] = spec.hour
        next[Calendar.MINUTE] = spec.minute
        next[Calendar.SECOND] = 0
        next[Calendar.MILLISECOND] = 0
        if (next.before(rightNow)) next.add(Calendar.DATE, 1)
        next.timeInMillis
      }
      TriggerSpec.TYPE_WEEKLY -> {
        val next = rightNow.clone() as Calendar
        next[Calendar.DAY_OF_WEEK] = spec.weekday
        next[Calendar.HOUR_OF_DAY] = spec.hour
        next[Calendar.MINUTE] = spec.minute
        next[Calendar.SECOND] = 0
        next[Calendar.MILLISECOND] = 0
        if (next.before(rightNow)) next.add(Calendar.DAY_OF_WEEK_IN_MONTH, 1)
        next.timeInMillis
      }
      TriggerSpec.TYPE_MONTHLY -> {
        val next = rightNow.clone() as Calendar
        next[Calendar.DATE] = spec.day
        next[Calendar.HOUR_OF_DAY] = spec.hour
        next[Calendar.MINUTE] = spec.minute
        next[Calendar.SECOND] = 0
        next[Calendar.MILLISECOND] = 0
        if (next.before(rightNow)) next.add(Calendar.MONTH, 1)
        next.timeInMillis
      }
      TriggerSpec.TYPE_YEARLY -> {
        val next = rightNow.clone() as Calendar
        next[Calendar.DATE] = spec.day
        next[Calendar.MONTH] = spec.month
        next[Calendar.HOUR_OF_DAY] = spec.hour
        next[Calendar.MINUTE] = spec.minute
        next[Calendar.SECOND] = 0
        next[Calendar.MILLISECOND] = 0
        if (next.before(rightNow)) next.add(Calendar.YEAR, 1)
        next.timeInMillis
      }
      else -> null
    }
  }
}
