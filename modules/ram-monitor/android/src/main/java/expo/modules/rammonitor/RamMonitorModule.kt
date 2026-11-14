/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

package expo.modules.rammonitor

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.Configuration
import android.os.BatteryManager
import android.os.Build
import android.os.Debug
import android.os.PowerManager
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.RandomAccessFile

/**
 * Reports this process's real memory usage, unlike the JS heap size (which
 * only covers JS-allocated objects and misses the mmap'd model weights,
 * native inference buffers, etc). Two figures are exposed:
 *
 * - rssBytes: resident set size from /proc/self/status (VmRSS) — includes
 *   mmap'd pages actually resident in RAM right now, which is the figure
 *   that matters for auditing the 12GB RAM cap while a GGUF model is
 *   memory-mapped.
 * - totalPssBytes: proportional set size via ActivityManager, a slower but
 *   more "fair" accounting that avoids double-counting shared pages across
 *   processes; useful as a cross-check.
 */
class RamMonitorModule : Module() {
  companion object {
    /** Último fallo Java/JS registrado por el manejador (sobrevive al cierre). */
    const val CRASH_FILE = "nido-last-crash.txt"
    const val MAX_CRASH_CHARS = 16_000
    const val MAX_TRACE_CHARS = 4_000
    @Volatile private var crashRecorderInstalled = false
  }

  override fun definition() = ModuleDefinition {
    Name("RamMonitor")

    // Evento de presión de memoria (optimización 2026-11-08, fase 5):
    // onTrimMemory con nivel ≥ RUNNING_CRITICAL llega a JS para que
    // la app descargue los motores antes de que el sistema la cierre.
    Events("onMemoryPressure")

    OnCreate {
      installCrashRecorder()
      registerMemoryPressure()
    }

    // ---------------------------------------------------- informe de cierres
    //
    // Diagnóstico SIN cable ni adb para la alpha: cuando la app se cierra
    // sola, la siguiente vez se puede ver en Acerca de el motivo exacto.
    //  1) Manejador de excepciones no capturadas: guarda la traza de un fallo
    //     Java/Kotlin o de un error fatal de JS (React Native lo relanza como
    //     JavascriptException con la pila JS) en un archivo PRIVADO de la app.
    //  2) ApplicationExitInfo (Android 11+): el motivo que el sistema registró
    //     de cada muerte del proceso — falta de memoria, fallo nativo (C/C++),
    //     ANR, etc. — aunque no haya excepción Java.
    // Nada sale del teléfono: el usuario decide si copia el informe.

    Function("installCrashRecorder") {
      installCrashRecorder()
      crashRecorderInstalled
    }

    Function("getCrashReport") {
      val ctx = appContext.reactContext?.applicationContext
      mapOf(
        "lastCrash" to readLastCrash(ctx),
        "exits" to readRecentExits(ctx),
        "sdkInt" to Build.VERSION.SDK_INT,
        "device" to "${Build.MANUFACTURER} ${Build.MODEL}",
      )
    }

    Function("clearCrashReport") {
      try {
        appContext.reactContext?.applicationContext?.let { File(it.filesDir, CRASH_FILE).delete() }
      } catch (_: Exception) {
      }
      true
    }

    Function("getMemoryInfo") {
      val rss = readRssBytes()
      val pss = readTotalPssBytes()
      mapOf(
        "rssBytes" to rss,
        "totalPssBytes" to pss
      )
    }

    // Total physical RAM on this device, for the model catalog's
    // compatibility badges (comparing a candidate model's size against what
    // the device actually has, not just the bounty's 12GB ceiling).
    Function("getDeviceTotalRamBytes") {
      readDeviceTotalRamBytes()
    }

    // 2026-11-06 (prueba física, tableta de 3,3 GB): la memoria que el
    // sistema tiene libre AHORA (ActivityManager.MemoryInfo). El pre-flight
    // solo miraba la RAM total menos una reserva fija y dejó cargar un
    // modelo que agotó la memoria: con otras apps abiertas, lo libre de
    // verdad era menos. availMem incluye la caché que el sistema puede
    // soltar; threshold es el nivel en que Android empieza a matar apps.
    Function("getAvailableMemory") {
      readAvailableMemory()
    }

    // Logical cores on this device, for the inference thread policy
    // (P-03): without it the app pinned 4 threads blind on every device.
    Function("getProcessorCount") {
      Runtime.getRuntime().availableProcessors()
    }

    // Optimización 2026-11-08 (fase 3): batería del aparato para la
    // política de presión. El nivel sale del intent pegajoso
    // ACTION_BATTERY_CHANGED (sin receptor registrado, sin permisos);
    // el modo de ahorro, de PowerManager. levelPct -1 = sin lectura.
    Function("getBatteryStatus") {
      readBatteryStatus()
    }

    // Optimización 2026-11-08 (fase 3): estado térmico del sistema,
    // escala de PowerManager 0 (ninguno) a 6 (apagado); -1 si el
    // aparato no lo reporta (API 29+ y no todos los fabricantes).
    Function("getThermalStatus") {
      readThermalStatus()
    }
  }

  @Volatile private var memoryPressureRegistered = false

  /**
   * Fase 5: registra un ComponentCallbacks2 sobre el contexto de la
   * aplicación; onTrimMemory con nivel ≥ TRIM_MEMORY_RUNNING_CRITICAL
   * (15) se reenvía a JS como evento «onMemoryPressure». Idempotente;
   * un fallo al registrar deja la app sin el evento, nunca caída.
   *
   * F3-04 (auditoría 2026-11-13): onLowMemory también reenvía el
   * evento, con el nivel RUNNING_CRITICAL. Es la señal «el sistema
   * se quedó sin memoria» — distinta de los trim por nivel — y hasta
   * la 0.1.98 caía en un override vacío: el aviso llegaba al proceso
   * y no salía de él, así que la política JS de presión nunca se
   * enteraba del peor de los avisos.
   */
  private fun registerMemoryPressure() {
    if (memoryPressureRegistered) return
    val ctx = appContext.reactContext?.applicationContext ?: return
    try {
      ctx.registerComponentCallbacks(object : ComponentCallbacks2 {
        override fun onTrimMemory(level: Int) {
          if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL) {
            try {
              sendEvent("onMemoryPressure", mapOf("level" to level))
            } catch (_: Throwable) {
            }
          }
        }

        override fun onConfigurationChanged(newConfig: Configuration) {}

        override fun onLowMemory() {
          try {
            sendEvent(
              "onMemoryPressure",
              mapOf("level" to ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL),
            )
          } catch (_: Throwable) {
          }
        }
      })
      memoryPressureRegistered = true
    } catch (_: Throwable) {
    }
  }

  private fun readBatteryStatus(): Map<String, Any> {
    val ctx = appContext.reactContext?.applicationContext
      ?: return mapOf("levelPct" to -1, "charging" to false, "powerSave" to false)
    var levelPct = -1
    var charging = false
    try {
      val intent = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
      val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
      val scale = intent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
      if (level >= 0 && scale > 0) levelPct = level * 100 / scale
      val status = intent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
      charging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
        status == BatteryManager.BATTERY_STATUS_FULL
    } catch (_: Exception) {
    }
    var powerSave = false
    try {
      val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
      powerSave = pm.isPowerSaveMode
    } catch (_: Exception) {
    }
    return mapOf("levelPct" to levelPct, "charging" to charging, "powerSave" to powerSave)
  }

  private fun readThermalStatus(): Int {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return -1
    val ctx = appContext.reactContext?.applicationContext ?: return -1
    return try {
      val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
      pm.currentThermalStatus
    } catch (_: Exception) {
      -1
    }
  }

  private fun installCrashRecorder() {
    if (crashRecorderInstalled) return
    val ctx = appContext.reactContext?.applicationContext ?: return
    val dir = ctx.filesDir
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, error ->
      try {
        val text = buildString {
          append("time=").append(System.currentTimeMillis()).append('\n')
          append("thread=").append(thread.name).append('\n')
          append(Log.getStackTraceString(error))
        }
        File(dir, CRASH_FILE).writeText(scrubCrashText(text).take(MAX_CRASH_CHARS))
      } catch (_: Throwable) {
        // Nunca impedir el comportamiento normal de cierre.
      }
      previous?.uncaughtException(thread, error)
    }
    crashRecorderInstalled = true
  }

  /**
   * SEC-05, capa A (al escribir): corta del texto del fallo las rutas del
   * sistema de ficheros y las URIs file:/content: — la miga que el mensaje
   * de una IOException arrastra (ruta absoluta y nombre del fichero de la
   * persona). Los marcos nunca contienen estas formas (son nombres de
   * clase), así que la pila sobrevive entera y el mensaje conserva su
   * forma. Nada más se toca aquí: el fragmento de las JSONException lo
   * sanea la capa B en JS (maskCrashCrumbs, con tests); recortarlo en
   * Kotlin sin arnés de tests nativos sería el riesgo contrario.
   */
  private fun scrubCrashText(text: String): String =
    text
      .replace(Regex("""/(data|storage|sdcard|mnt|vendor)/[^\s:]*"""), "<ruta>")
      .replace(Regex("""(file|content)://[^\s]*"""), "<ruta>")

  private fun readLastCrash(ctx: Context?): String? {
    if (ctx == null) return null
    return try {
      val f = File(ctx.filesDir, CRASH_FILE)
      if (f.exists()) f.readText().take(MAX_CRASH_CHARS) else null
    } catch (_: Exception) {
      null
    }
  }

  private fun reasonName(reason: Int): String = when (reason) {
    1 -> "EXIT_SELF"
    2 -> "SIGNALED"
    3 -> "LOW_MEMORY"
    4 -> "CRASH"
    5 -> "CRASH_NATIVE"
    6 -> "ANR"
    7 -> "INITIALIZATION_FAILURE"
    8 -> "PERMISSION_CHANGE"
    9 -> "EXCESSIVE_RESOURCE_USAGE"
    10 -> "USER_REQUESTED"
    11 -> "USER_STOPPED"
    12 -> "DEPENDENCY_DIED"
    13 -> "OTHER"
    14 -> "FREEZER"
    15 -> "PACKAGE_STATE_CHANGE"
    16 -> "PACKAGE_UPDATED"
    else -> "UNKNOWN($reason)"
  }

  /**
   * Fragmento legible de la traza que guarda el sistema: texto para ANR; para
   * fallos nativos es un tombstone binario, del que se extraen las cadenas
   * imprimibles (señal, mensaje de abort, librerías y funciones de la pila).
   */
  private fun traceSnippet(info: ApplicationExitInfo): String? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null
    if (info.reason != ApplicationExitInfo.REASON_ANR &&
      info.reason != ApplicationExitInfo.REASON_CRASH_NATIVE
    ) return null
    return try {
      info.traceInputStream?.use { input ->
        val bytes = input.readBytes()
        if (info.reason == ApplicationExitInfo.REASON_ANR) {
          String(bytes, Charsets.UTF_8).take(MAX_TRACE_CHARS)
        } else {
          val out = StringBuilder()
          val run = StringBuilder()
          for (b in bytes) {
            val c = b.toInt() and 0xff
            if (c in 0x20..0x7e) {
              run.append(c.toChar())
            } else {
              if (run.length >= 6) out.append(run).append('\n')
              run.setLength(0)
            }
            if (out.length >= MAX_TRACE_CHARS) break
          }
          if (run.length >= 6) out.append(run)
          out.toString().take(MAX_TRACE_CHARS)
        }
      }
    } catch (_: Exception) {
      null
    }
  }

  private fun readRecentExits(ctx: Context?): List<Map<String, Any?>> {
    if (ctx == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return emptyList()
    return try {
      val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      // Ventana de 10 (H-09, adversaria 2026-11-01): el cruce de M2
      // elige el PRIMER cierre posterior al registro, y cada arranque
      // inocente posterior a una muerte empuja esa muerte una
      // posición hacia fuera de la ventana. Con 5, cinco aperturas
      // bastaban para borrarla de toda superficie; 10 duplica el
      // margen con el mismo coste de lectura.
      am.getHistoricalProcessExitReasons(ctx.packageName, 0, 10).map { info ->
        mapOf(
          "timestamp" to info.timestamp,
          "reason" to reasonName(info.reason),
          "description" to info.description,
          "status" to info.status,
          "importance" to info.importance,
          "pssKb" to info.pss,
          "rssKb" to info.rss,
          "trace" to traceSnippet(info),
        )
      }
    } catch (_: Exception) {
      emptyList()
    }
  }

  private fun readAvailableMemory(): Map<String, Any> {
    return try {
      val context = appContext.reactContext ?: return mapOf("availBytes" to 0L, "thresholdBytes" to 0L, "lowMemory" to false)
      val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val info = ActivityManager.MemoryInfo()
      am.getMemoryInfo(info)
      mapOf("availBytes" to info.availMem, "thresholdBytes" to info.threshold, "lowMemory" to info.lowMemory)
    } catch (e: Exception) {
      mapOf("availBytes" to 0L, "thresholdBytes" to 0L, "lowMemory" to false)
    }
  }

  private fun readDeviceTotalRamBytes(): Long {
    return try {
      val context = appContext.reactContext ?: return 0L
      val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val info = ActivityManager.MemoryInfo()
      am.getMemoryInfo(info)
      info.totalMem
    } catch (e: Exception) {
      0L
    }
  }

  private fun readRssBytes(): Long {
    return try {
      RandomAccessFile("/proc/self/status", "r").use { reader ->
        var line: String?
        while (reader.readLine().also { line = it } != null) {
          if (line!!.startsWith("VmRSS:")) {
            val kb = line!!.replace(Regex("[^0-9]"), "").toLongOrNull() ?: 0L
            return kb * 1024L
          }
        }
        0L
      }
    } catch (e: Exception) {
      0L
    }
  }

  private fun readTotalPssBytes(): Long {
    return try {
      val context = appContext.reactContext ?: return 0L
      val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val pid = android.os.Process.myPid()
      val infos: Array<Debug.MemoryInfo> = am.getProcessMemoryInfo(intArrayOf(pid))
      if (infos.isEmpty()) 0L else infos[0].totalPss.toLong() * 1024L
    } catch (e: Exception) {
      0L
    }
  }
}
