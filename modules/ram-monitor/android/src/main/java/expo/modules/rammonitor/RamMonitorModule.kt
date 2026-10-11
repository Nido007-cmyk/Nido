/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

package expo.modules.rammonitor

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import android.os.Debug
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

    OnCreate { installCrashRecorder() }

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
        File(dir, CRASH_FILE).writeText(text.take(MAX_CRASH_CHARS))
      } catch (_: Throwable) {
        // Nunca impedir el comportamiento normal de cierre.
      }
      previous?.uncaughtException(thread, error)
    }
    crashRecorderInstalled = true
  }

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
      am.getHistoricalProcessExitReasons(ctx.packageName, 0, 5).map { info ->
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
