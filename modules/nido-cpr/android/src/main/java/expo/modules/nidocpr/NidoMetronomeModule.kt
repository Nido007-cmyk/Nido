/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

package expo.modules.nidocpr

import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * El pitido de la práctica de RCP (0.1.76).
 *
 * Un tono corto en cada compresión, programado en su propio hilo con
 * tiempos absolutos (inicio + k × intervalo), así el ritmo no se desvía
 * aunque el hilo de JS esté ocupado. ToneGenerator: sin ficheros de audio
 * ni dependencias. Va por el canal de alarma, que suena aunque el teléfono
 * esté en silencio para multimedia: con el teléfono en el suelo tiene que
 * oírse por encima del esfuerzo.
 */
class NidoMetronomeModule : Module() {
  private val lock = Any()
  private var thread: HandlerThread? = null
  private var handler: Handler? = null
  private var tone: ToneGenerator? = null
  private var generation = 0

  override fun definition() = ModuleDefinition {
    Name("NidoMetronome")

    // bpm: 30..200. maxBeats: 0 = hasta stop(); N = se para solo tras N pitidos.
    // Devuelve el instante de inicio (uptime del sistema, ms) o -1 si no pudo.
    Function("start") { bpm: Int, maxBeats: Int ->
      start(bpm, maxBeats)
    }

    Function("stop") {
      stop()
      true
    }

    OnDestroy { stop() }
  }

  private fun start(bpm: Int, maxBeats: Int): Double {
    if (bpm < 30 || bpm > 200 || maxBeats < 0) return -1.0
    synchronized(lock) {
      stopLocked()
      val tg = try {
        ToneGenerator(AudioManager.STREAM_ALARM, 90)
      } catch (_: RuntimeException) {
        return -1.0
      }
      val t = HandlerThread("nido-metronome", android.os.Process.THREAD_PRIORITY_URGENT_AUDIO).also { it.start() }
      val h = Handler(t.looper)
      tone = tg
      thread = t
      handler = h
      val gen = ++generation
      val intervalMs = 60_000.0 / bpm
      val t0 = SystemClock.uptimeMillis() + 50
      fun schedule(k: Int) {
        if (maxBeats in 1..k) return
        val at = t0 + Math.round(k * intervalMs)
        h.postAtTime({
          synchronized(lock) {
            if (gen != generation) return@postAtTime
            try {
              tone?.startTone(ToneGenerator.TONE_PROP_BEEP, 60)
            } catch (_: RuntimeException) {
            }
          }
          schedule(k + 1)
        }, at)
      }
      schedule(0)
      return t0.toDouble()
    }
  }

  private fun stop() {
    synchronized(lock) { stopLocked() }
  }

  private fun stopLocked() {
    generation++
    handler?.removeCallbacksAndMessages(null)
    handler = null
    thread?.quitSafely()
    thread = null
    try {
      tone?.release()
    } catch (_: RuntimeException) {
    }
    tone = null
  }
}
