package expo.modules.voiceinput

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
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

/**
 * Offline speech-to-text via Android's built-in SpeechRecognizer with
 * EXTRA_PREFER_OFFLINE. This depends on a system-provided recognition
 * service (Google's, or an OEM's) being installed — commonly true on stock
 * Android/most OEM builds, commonly FALSE on GrapheneOS or other
 * de-Googled builds with no such service. isAvailable() reflects this
 * honestly rather than pretending to work; the JS side (src/voice/VoiceInput.ts)
 * surfaces it as an "unavailable" state instead of a silent failure.
 *
 * A cross-device guarantee (e.g. a bundled whisper.cpp model) would need a
 * separate, much larger native binding — not attempted here; see
 * docs/MODELS.md for the honest scope note.
 */
class VoiceInputModule : Module() {
  private var recognizer: SpeechRecognizer? = null
  private val mainHandler = Handler(Looper.getMainLooper())

  override fun definition() = ModuleDefinition {
    Name("VoiceInput")

    Events("onSpeechStart", "onSpeechEnd", "onPartialResults", "onResults", "onError")

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

    AsyncFunction("startListening") { promise: Promise ->
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
        beginListening(context, promise)
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
          beginListening(context, promise)
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
      mainHandler.post {
        recognizer?.destroy()
        recognizer = null
      }
    }
  }

  private fun beginListening(context: Context, promise: Promise) {
    mainHandler.post {
      try {
        recognizer?.destroy()
        recognizer = SpeechRecognizer.createSpeechRecognizer(context).apply {
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
