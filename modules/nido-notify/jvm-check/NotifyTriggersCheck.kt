/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Comprobación en la JVM de NotifyTriggers.kt (la cuenta de la próxima
// hora de un aviso). No entra en el APK: la compila y la corre
// scripts/check-notify-triggers.mjs, en local y en la CI.
//
// Dos clases de comprobación:
//  1. casos exactos, calculados a mano, en una zona sin cambio de hora
//     (America/Phoenix) y alrededor del cambio de hora de Europa/Madrid;
//  2. propiedades, para miles de «ahoras» al azar en varias zonas: el
//     resultado nunca está en el pasado, cae en la hora y minuto pedidos
//     (salvo la hora que no existe al adelantar el reloj), en el día de
//     la semana pedido, y como mucho a un día / una semana vista.

import expo.modules.nidonotify.NotifyTriggers
import expo.modules.nidonotify.TriggerSpec
import java.util.Calendar
import java.util.Random
import java.util.TimeZone

private var failures = 0
private var checks = 0

private fun check(ok: Boolean, what: () -> String) {
  checks += 1
  if (!ok) {
    failures += 1
    if (failures <= 20) println("FAIL: ${what()}")
  }
}

// «Ahora» como lo ve la app: un Calendar.getInstance() con la hora puesta
// por milisegundos, todos sus campos calculados. (Un Calendar armado con
// set() resuelve DAY_OF_WEEK de otra manera y no sirve como «ahora».)
private fun cal(tz: TimeZone, y: Int, mo: Int, d: Int, h: Int, mi: Int, s: Int = 0): Calendar {
  val ms = Calendar.getInstance(tz).apply {
    clear()
    set(y, mo, d, h, mi, s)
  }.timeInMillis
  return Calendar.getInstance(tz).apply { timeInMillis = ms }
}

private fun fmt(tz: TimeZone, ms: Long?): String {
  if (ms == null) return "null"
  val c = Calendar.getInstance(tz).apply { timeInMillis = ms }
  return "%04d-%02d-%02d %02d:%02d:%02d".format(
    c[Calendar.YEAR], c[Calendar.MONTH] + 1, c[Calendar.DATE],
    c[Calendar.HOUR_OF_DAY], c[Calendar.MINUTE], c[Calendar.SECOND],
  )
}

private fun expectAt(tz: TimeZone, label: String, spec: TriggerSpec, now: Calendar, expected: String?) {
  val got = fmt(tz, NotifyTriggers.nextTriggerMillis(spec, now))
  check(got == (expected ?: "null")) { "$label: esperaba $expected, salió $got" }
}

private fun exactCases() {
  val phx = TimeZone.getTimeZone("America/Phoenix")
  TimeZone.setDefault(phx)
  // Viernes 13 de noviembre de 2026, 10:00:30.
  val now = cal(phx, 2026, Calendar.NOVEMBER, 13, 10, 0, 30)
  expectAt(phx, "diario más tarde hoy", TriggerSpec("daily", hour = 18, minute = 5), now, "2026-11-13 18:05:00")
  expectAt(phx, "diario ya pasado hoy", TriggerSpec("daily", hour = 8, minute = 0), now, "2026-11-14 08:00:00")
  // Misma hora y minuto que ahora, con segundos: 10:00:00 ya pasó → mañana (como expo).
  expectAt(phx, "diario este mismo minuto", TriggerSpec("daily", hour = 10, minute = 0), now, "2026-11-14 10:00:00")
  expectAt(phx, "semanal domingo", TriggerSpec("weekly", weekday = Calendar.SUNDAY, hour = 9, minute = 0), now, "2026-11-15 09:00:00")
  expectAt(phx, "semanal viernes ya pasado", TriggerSpec("weekly", weekday = Calendar.FRIDAY, hour = 7, minute = 0), now, "2026-11-20 07:00:00")
  expectAt(phx, "semanal viernes más tarde", TriggerSpec("weekly", weekday = Calendar.FRIDAY, hour = 20, minute = 0), now, "2026-11-13 20:00:00")
  expectAt(phx, "mensual día 20", TriggerSpec("monthly", day = 20, hour = 9, minute = 30), now, "2026-11-20 09:30:00")
  expectAt(phx, "mensual día 1 (siguiente mes)", TriggerSpec("monthly", day = 1, hour = 9, minute = 30), now, "2026-12-01 09:30:00")
  expectAt(phx, "anual 3 de mayo", TriggerSpec("yearly", month = Calendar.MAY, day = 3, hour = 9, minute = 0), now, "2027-05-03 09:00:00")
  expectAt(phx, "anual 25 de diciembre", TriggerSpec("yearly", month = Calendar.DECEMBER, day = 25, hour = 9, minute = 0), now, "2026-12-25 09:00:00")
  val future = cal(phx, 2026, Calendar.NOVEMBER, 20, 9, 30).timeInMillis
  expectAt(phx, "fecha futura", TriggerSpec("date", timestamp = future), now, "2026-11-20 09:30:00")
  expectAt(phx, "fecha pasada", TriggerSpec("date", timestamp = now.timeInMillis - 1), now, null)
  expectAt(phx, "fecha justo ahora", TriggerSpec("date", timestamp = now.timeInMillis), now, "2026-11-13 10:00:30")
  expectAt(phx, "tipo desconocido", TriggerSpec("calendar"), now, null)

  // Indulgencia de Calendar, heredada de expo a propósito: el día 31 en un
  // mes de 30 se convierte en el 1 del mes siguiente (expo hacía lo mismo;
  // NIDO no deja crear un mensual del 31 en un mes de 30, pero un aviso
  // del 31 que se repite pasa por meses cortos).
  val endOfNov = cal(phx, 2026, Calendar.NOVEMBER, 30, 12, 0)
  expectAt(phx, "mensual 31 desde el 30 de noviembre", TriggerSpec("monthly", day = 31, hour = 9, minute = 0), endOfNov, "2026-12-01 09:00:00")
  val endOfJan = cal(phx, 2027, Calendar.JANUARY, 31, 9, 0, 1)
  expectAt(phx, "mensual 31 tras dispararse el 31 de enero", TriggerSpec("monthly", day = 31, hour = 9, minute = 0), endOfJan, "2027-02-28 09:00:00")
  // Fin de año: semanal y diario cruzan a 2027.
  val nye = cal(phx, 2026, Calendar.DECEMBER, 31, 23, 30)
  expectAt(phx, "diario cruza el año", TriggerSpec("daily", hour = 7, minute = 0), nye, "2027-01-01 07:00:00")
  expectAt(phx, "semanal cruza el año", TriggerSpec("weekly", weekday = Calendar.MONDAY, hour = 7, minute = 0), nye, "2027-01-04 07:00:00")

  // Cambio de hora en Madrid (29 de marzo de 2026, las 02:00 pasan a 03:00).
  val mad = TimeZone.getTimeZone("Europe/Madrid")
  TimeZone.setDefault(mad)
  val beforeDst = cal(mad, 2026, Calendar.MARCH, 28, 22, 0)
  expectAt(mad, "diario 08:00 tras adelantar el reloj", TriggerSpec("daily", hour = 8, minute = 0), beforeDst, "2026-03-29 08:00:00")
  val beforeFallBack = cal(mad, 2026, Calendar.OCTOBER, 24, 22, 0)
  expectAt(mad, "diario 08:00 tras atrasar el reloj", TriggerSpec("daily", hour = 8, minute = 0), beforeFallBack, "2026-10-25 08:00:00")
}

private fun properties() {
  val zones = listOf("America/Phoenix", "Europe/Madrid", "America/Mexico_City", "America/Sao_Paulo", "Asia/Kolkata", "UTC")
  val rnd = Random(20261113L)
  val day = 24L * 3600_000L
  for (zone in zones) {
    val tz = TimeZone.getTimeZone(zone)
    TimeZone.setDefault(tz)
    repeat(2000) {
      val nowMs = 1_767_225_600_000L + (rnd.nextDouble() * 400 * day).toLong() // 2026-01-01 + ~400 días
      val now = Calendar.getInstance(tz).apply { timeInMillis = nowMs }
      val h = rnd.nextInt(24)
      val m = rnd.nextInt(60)
      val wd = 1 + rnd.nextInt(7)

      val daily = NotifyTriggers.nextTriggerMillis(TriggerSpec("daily", hour = h, minute = m), now)!!
      check(daily >= nowMs) { "$zone diario en el pasado" }
      check(daily - nowMs <= day + 3600_000L) { "$zone diario a más de un día" }
      val dc = Calendar.getInstance(tz).apply { timeInMillis = daily }
      // La hora que no existe al adelantar el reloj se corre una hora.
      check(dc[Calendar.MINUTE] == m && (dc[Calendar.HOUR_OF_DAY] == h || dc[Calendar.HOUR_OF_DAY] == (h + 1) % 24)) {
        "$zone diario: pedía $h:$m, salió ${fmt(tz, daily)}"
      }
      check(dc[Calendar.SECOND] == 0 && dc[Calendar.MILLISECOND] == 0) { "$zone diario con segundos" }

      val weekly = NotifyTriggers.nextTriggerMillis(TriggerSpec("weekly", weekday = wd, hour = h, minute = m), now)!!
      check(weekly >= nowMs) { "$zone semanal en el pasado" }
      check(weekly - nowMs <= 7 * day + 3600_000L) { "$zone semanal a más de una semana" }
      val wc = Calendar.getInstance(tz).apply { timeInMillis = weekly }
      check(wc[Calendar.DAY_OF_WEEK] == wd || wc[Calendar.HOUR_OF_DAY] != h) { "$zone semanal: día $wd, salió ${fmt(tz, weekly)}" }

      val d = 1 + rnd.nextInt(28)
      val monthly = NotifyTriggers.nextTriggerMillis(TriggerSpec("monthly", day = d, hour = h, minute = m), now)!!
      check(monthly >= nowMs) { "$zone mensual en el pasado" }
      check(Calendar.getInstance(tz).apply { timeInMillis = monthly }[Calendar.DATE] == d) { "$zone mensual: día $d, salió ${fmt(tz, monthly)}" }

      val mo = rnd.nextInt(12)
      val yearly = NotifyTriggers.nextTriggerMillis(TriggerSpec("yearly", month = mo, day = d, hour = h, minute = m), now)!!
      check(yearly >= nowMs) { "$zone anual en el pasado" }
      check(yearly - nowMs <= 366 * day + 3600_000L) { "$zone anual a más de un año" }
      val yc = Calendar.getInstance(tz).apply { timeInMillis = yearly }
      check(yc[Calendar.MONTH] == mo && yc[Calendar.DATE] == d) { "$zone anual: $d/${mo + 1}, salió ${fmt(tz, yearly)}" }
    }
  }
}

fun main() {
  exactCases()
  properties()
  if (failures > 0) {
    println("check-notify-triggers: FAIL $failures de $checks")
    kotlin.system.exitProcess(1)
  }
  println("check-notify-triggers: PASS $checks comprobaciones")
}
