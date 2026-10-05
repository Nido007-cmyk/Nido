package expo.modules.downloadwakelock

import android.content.Context
import android.os.PowerManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * One PARTIAL_WAKE_LOCK (CPU on, screen free to turn off) held while model
 * downloads run. Not reference-counted: acquire while held is a no-op and a
 * single release frees it, so repeated calls can never stack locks. JS
 * (src/services/downloadWakeLock.ts) decides when downloads start and end.
 */
class DownloadWakeLockModule : Module() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun definition() = ModuleDefinition {
    Name("DownloadWakeLock")

    Function("acquire") {
      acquire()
    }

    Function("release") {
      release()
    }

    // JS reload or app teardown: nothing on the JS side will release it anymore.
    OnDestroy {
      release()
    }
  }

  private fun acquire(): Boolean {
    val lock = wakeLock ?: run {
      val context = appContext.reactContext ?: return false
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, TAG).apply { setReferenceCounted(false) }
    }.also { wakeLock = it }
    // Timeout is a backstop only; JS releases it when the download settles.
    if (!lock.isHeld) lock.acquire(MAX_HOLD_MS)
    return true
  }

  private fun release() {
    wakeLock?.let { if (it.isHeld) it.release() }
  }

  companion object {
    const val TAG = "NIDO:ModelDownload"
    const val MAX_HOLD_MS = 6L * 60 * 60 * 1000
  }
}
