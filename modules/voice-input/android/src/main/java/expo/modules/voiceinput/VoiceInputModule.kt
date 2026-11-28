/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

package expo.modules.voiceinput

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.content.ContextCompat
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.RandomAccessFile

/**
 * Offline speech-to-text via Android's built-in SpeechRecognizer with
 * EXTRA_PREFER_OFFLINE. This depends on a system-provided recognition
 * service (Google's, or an OEM's) being installed — commonly true on stock
 * Android/most OEM builds, commonly FALSE on GrapheneOS or other
 * de-Googled builds with no such service. isAvailable() reflects this
 * honestly rather than pretending to work; the JS side (src/voice/VoiceInput.ts)
 * surfaces it as an "unavailable" state instead of a silent failure.
 *
 * Audit 2026-10-29: "prefer offline" is a request, not a guarantee. On
 * Android 12+ (API 31) the system can say whether an ON-DEVICE recognizer
 * exists (isOnDeviceRecognitionAvailable) and create one
 * (createOnDeviceSpeechRecognizer), which by contract never sends audio
 * off the phone. engineState() reports "onDevice", "system" or "none";
 * startListening(onDeviceOnly) refuses with E_ON_DEVICE_UNAVAILABLE instead
 * of silently falling back to a recognizer that may go online.
 *
 * 0.1.124: the cross-device path is whisper.cpp (whisper.rn): this module
 * only records the WAV it transcribes (startRecording/stopRecording); see
 * src/voice/whisperDictation.ts and docs/MODELS.md.
 */
class VoiceInputModule : Module() {
  private var recognizer: SpeechRecognizer? = null
  private val mainHandler = Handler(Looper.getMainLooper())

  // 0.1.124 (dictado con Whisper): grabación PCM 16 kHz mono 16 bits a un
  // WAV en la caché de la app, solo en el teléfono. La transcribe
  // whisper.cpp (src/voice/whisperDictation.ts) y el JS borra el fichero
  // en cuanto termina. Nada sale del teléfono.
  @Volatile private var recording = false
  private var recordThread: Thread? = null
  private var recordPath: String? = null
  private var recordStartedAt = 0L

  override fun definition() = ModuleDefinition {
    Name("VoiceInput")

    Events("onSpeechStart", "onSpeechEnd", "onPartialResults", "onResults", "onError", "onRecordLimit")

    // 0.1.124: graba a `path` (WAV 16 kHz mono) hasta stopRecording() o
    // hasta `maxMs`; al llegar al tope emite onRecordLimit y deja de grabar.
    AsyncFunction("startRecording") { path: String, maxMs: Int, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("E_NO_CONTEXT", "No React context available", null)
        return@AsyncFunction
      }
      val hasPermission = ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.RECORD_AUDIO
      ) == PackageManager.PERMISSION_GRANTED
      if (hasPermission) {
        beginRecording(path, maxMs, promise)
        return@AsyncFunction
      }
      val permissions = appContext.permissions
      if (permissions == null) {
        promise.reject("E_NO_PERMISSIONS_MODULE", "Permissions module unavailable", null)
        return@AsyncFunction
      }
      permissions.askForPermissions({ result ->
        val granted = result[Manifest.permission.RECORD_AUDIO]?.status == PermissionsStatus.GRANTED
        if (granted) beginRecording(path, maxMs, promise)
        else promise.reject("E_PERMISSION_DENIED", "Microphone permission denied", null)
      }, Manifest.permission.RECORD_AUDIO)
    }

    // Para la grabación y resuelve con { path, durationMs } (o null si no
    // había ninguna).
    AsyncFunction("stopRecording") { promise: Promise ->
      val thread = recordThread
      val path = recordPath
      if (thread == null || path == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      recording = false
      Thread {
        try {
          thread.join(3000)
        } catch (_: InterruptedException) {
        }
        recordThread = null
        recordPath = null
        promise.resolve(mapOf("path" to path, "durationMs" to (System.currentTimeMillis() - recordStartedAt).toDouble()))
      }.start()
    }

    AsyncFunction("isAvailable") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      mainHandler.post {
        promise.resolve(SpeechRecognizer.isRecognitionAvailable(context))
      }
    }

    AsyncFunction("engineState") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve("none")
        return@AsyncFunction
      }
      mainHandler.post {
        promise.resolve(engineStateOf(context))
      }
    }

    AsyncFunction("startListening") { onDeviceOnly: Boolean, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("E_NO_CONTEXT", "No React context available", null)
        return@AsyncFunction
      }

      val hasPermission = ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.RECORD_AUDIO
      ) == PackageManager.PERMISSION_GRANTED

      if (hasPermission) {
        beginListening(context, onDeviceOnly, promise)
        return@AsyncFunction
      }

      val permissions = appContext.permissions
      if (permissions == null) {
        promise.reject("E_NO_PERMISSIONS_MODULE", "Permissions module unavailable", null)
        return@AsyncFunction
      }
      permissions.askForPermissions({ result ->
        val granted = result[Manifest.permission.RECORD_AUDIO]?.status == PermissionsStatus.GRANTED
        if (granted) {
          beginListening(context, onDeviceOnly, promise)
        } else {
          promise.reject("E_PERMISSION_DENIED", "Microphone permission denied", null)
        }
      }, Manifest.permission.RECORD_AUDIO)
    }

    AsyncFunction("stopListening") { promise: Promise ->
      mainHandler.post {
        recognizer?.stopListening()
        promise.resolve(null)
      }
    }

    OnDestroy {
      recording = false
      mainHandler.post {
        recognizer?.destroy()
        recognizer = null
      }
    }
  }

  private fun onDeviceAvailable(context: Context): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
      SpeechRecognizer.isOnDeviceRecognitionAvailable(context)

  private fun engineStateOf(context: Context): String = when {
    onDeviceAvailable(context) -> "onDevice"
    SpeechRecognizer.isRecognitionAvailable(context) -> "system"
    else -> "none"
  }

  private fun beginListening(context: Context, onDeviceOnly: Boolean, promise: Promise) {
    mainHandler.post {
      try {
        recognizer?.destroy()
        recognizer = null
        val onDevice = onDeviceAvailable(context)
        if (onDeviceOnly && !onDevice) {
          promise.reject("E_ON_DEVICE_UNAVAILABLE", "No on-device speech recognizer on this phone", null)
          return@post
        }
        val created = if (onDevice && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
        } else {
          SpeechRecognizer.createSpeechRecognizer(context)
        }
        recognizer = created.apply {
          setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {}

            override fun onBeginningOfSpeech() {
              sendEvent("onSpeechStart", mapOf<String, Any?>())
            }

            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}

            override fun onEndOfSpeech() {
              sendEvent("onSpeechEnd", mapOf<String, Any?>())
            }

            override fun onError(error: Int) {
              sendEvent(
                "onError",
                mapOf("code" to error.toString(), "message" to errorMessage(error))
              )
            }

            override fun onResults(results: Bundle?) {
              val text = results
                ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                ?.firstOrNull() ?: ""
              sendEvent("onResults", mapOf("text" to text))
            }

            override fun onPartialResults(partialResults: Bundle?) {
              val text = partialResults
                ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                ?.firstOrNull() ?: ""
              sendEvent("onPartialResults", mapOf("text" to text))
            }

            override fun onEvent(eventType: Int, params: Bundle?) {}
          })
        }

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
          putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
          putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
          putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        }

        recognizer?.startListening(intent)
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("E_START_FAILED", e.message ?: "Failed to start listening", e)
      }
    }
  }

  private fun beginRecording(path: String, maxMs: Int, promise: Promise) {
    if (recording) {
      promise.reject("E_BUSY", "Already recording", null)
      return
    }
    val rate = 16000
    val minBuf = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    if (minBuf <= 0) {
      promise.reject("E_RECORD_UNSUPPORTED", "16 kHz mono recording not supported", null)
      return
    }
    val record = try {
      AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, minBuf * 4)
    } catch (e: Exception) {
      promise.reject("E_RECORD_FAILED", e.message ?: "AudioRecord failed", e)
      return
    }
    if (record.state != AudioRecord.STATE_INITIALIZED) {
      record.release()
      promise.reject("E_RECORD_FAILED", "AudioRecord not initialized", null)
      return
    }
    val file = File(path.removePrefix("file://"))
    file.parentFile?.mkdirs()
    val out = try {
      RandomAccessFile(file, "rw").apply { setLength(0); write(ByteArray(44)) }
    } catch (e: Exception) {
      record.release()
      promise.reject("E_RECORD_FAILED", e.message ?: "Cannot open file", e)
      return
    }
    recording = true
    recordPath = file.absolutePath
    recordStartedAt = System.currentTimeMillis()
    val limit = if (maxMs > 0) maxMs.toLong() else 60_000L
    recordThread = Thread {
      val buf = ByteArray(minBuf)
      var dataBytes = 0L
      var hitLimit = false
      try {
        record.startRecording()
        while (recording) {
          val n = record.read(buf, 0, buf.size)
          if (n > 0) {
            out.write(buf, 0, n)
            dataBytes += n
          }
          if (System.currentTimeMillis() - recordStartedAt >= limit) {
            hitLimit = true
            break
          }
        }
      } catch (_: Exception) {
      } finally {
        try { record.stop() } catch (_: Exception) {}
        record.release()
        try {
          writeWavHeader(out, dataBytes, rate)
          out.close()
        } catch (_: Exception) {}
        recording = false
        if (hitLimit) sendEvent("onRecordLimit", mapOf<String, Any?>())
      }
    }.also { it.start() }
    promise.resolve(null)
  }

  /** Cabecera RIFF/WAVE de 44 bytes para PCM 16 bits mono. */
  private fun writeWavHeader(out: RandomAccessFile, dataBytes: Long, rate: Int) {
    val byteRate = rate * 2
    val h = java.nio.ByteBuffer.allocate(44).order(java.nio.ByteOrder.LITTLE_ENDIAN)
    h.put("RIFF".toByteArray()); h.putInt((36 + dataBytes).toInt()); h.put("WAVE".toByteArray())
    h.put("fmt ".toByteArray()); h.putInt(16); h.putShort(1); h.putShort(1)
    h.putInt(rate); h.putInt(byteRate); h.putShort(2); h.putShort(16)
    h.put("data".toByteArray()); h.putInt(dataBytes.toInt())
    out.seek(0)
    out.write(h.array())
  }

  private fun errorMessage(error: Int): String = when (error) {
    SpeechRecognizer.ERROR_AUDIO -> "Audio recording error"
    SpeechRecognizer.ERROR_CLIENT -> "Client side error"
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Insufficient permissions"
    SpeechRecognizer.ERROR_NETWORK -> "Network error"
    SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Network timeout"
    SpeechRecognizer.ERROR_NO_MATCH -> "No speech match"
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Recognizer busy"
    SpeechRecognizer.ERROR_SERVER -> "Server error"
    SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No speech input"
    else -> "Unknown error ($error)"
  }
}
