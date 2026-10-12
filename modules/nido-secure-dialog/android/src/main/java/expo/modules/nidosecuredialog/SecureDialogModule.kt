/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

package expo.modules.nidosecuredialog

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import android.view.WindowManager
import androidx.appcompat.app.AlertDialog
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicBoolean

/**
 * R3 — Secure confirmation dialogs.
 *
 * P-F2 set FLAG_SECURE on MainActivity's window, but FLAG_SECURE is a
 * per-Window flag: React Native's Alert.alert() shows through RN's
 * AlertFragment (a DialogFragment), which creates its own AlertDialog on a
 * SEPARATE Android window whose flags are independent of the activity's.
 * So the activity flag never covered the agent-confirmation and
 * pairing-fingerprint dialogs.
 *
 * This module shows a two-button confirmation AlertDialog and sets
 * FLAG_SECURE on the DIALOG's own window before showing it — the only
 * surface the flag can land on to protect that dialog's pixels.
 *
 * Scope: used ONLY for the agent-confirmation dialog (ChatScreen) and the
 * pairing-fingerprint ceremony dialog (NidoScreen). All other UI is
 * untouched.
 */
class SecureDialogModule : Module() {
  /**
   * Offensive audit (0.1.18): the backup key was copied with a plain
   * clipboard write, so it showed in the keyboard's clipboard preview and
   * stayed in clipboard history (Gboard / Samsung keep it). Marked as
   * sensitive, Android 13+ hides it from previews and keyboards don't save
   * it; clearIfEquals() lets JS remove it after a short time.
   */
  private fun clipboard(): ClipboardManager? =
    (appContext.reactContext ?: appContext.currentActivity)
      ?.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager

  private fun onMain(promise: Promise, block: () -> Any) {
    Handler(Looper.getMainLooper()).post {
      try {
        promise.resolve(block())
      } catch (e: Exception) {
        promise.reject("CLIPBOARD_ERROR", "NidoSecureDialog: ${e.message}", e)
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("NidoSecureDialog")

    AsyncFunction("copySensitive") { text: String, promise: Promise ->
      onMain(promise) {
        val cm = clipboard() ?: throw IllegalStateException("no clipboard")
        val clip = ClipData.newPlainText("NIDO", text)
        val extras = PersistableBundle()
        // ClipDescription.EXTRA_IS_SENSITIVE (API 33); the same key is read by
        // keyboards on older versions too.
        extras.putBoolean("android.content.extra.IS_SENSITIVE", true)
        clip.description.extras = extras
        cm.setPrimaryClip(clip)
        true
      }
    }

    AsyncFunction("clearClipboardIfEquals") { text: String, promise: Promise ->
      onMain(promise) {
        val cm = clipboard() ?: return@onMain false
        val current = try {
          cm.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.text?.toString()
        } catch (_: Exception) {
          null
        }
        if (current != text) return@onMain false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) cm.clearPrimaryClip()
        else cm.setPrimaryClip(ClipData.newPlainText("", ""))
        true
      }
    }

    AsyncFunction("showSecureAlert") {
        title: String,
        message: String,
        cancelLabel: String,
        confirmLabel: String,
        cancelable: Boolean,
        promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject(
          "NO_ACTIVITY",
          "NidoSecureDialog: no current activity; cannot show a secure dialog",
          null
        )
        return@AsyncFunction
      }
      activity.runOnUiThread {
        try {
          val settled = AtomicBoolean(false)
          fun settle(value: Boolean) {
            if (settled.compareAndSet(false, true)) {
              promise.resolve(value)
            }
          }
          val dialog =
            AlertDialog.Builder(activity)
              .setTitle(title)
              .setMessage(message)
              .setCancelable(cancelable)
              .setNegativeButton(cancelLabel) { _, _ -> settle(false) }
              .setPositiveButton(confirmLabel) { _, _ -> settle(true) }
              .create()
          // R3: the flag lands on the DIALOG window's own flags. Setting it
          // on the activity window (P-F2) does not propagate to Dialog
          // windows — each Window carries independent flags.
          dialog.window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
          // Dismiss (back button / tap-outside) resolves false: fail-closed,
          // same contract as the previous Alert.alert call sites.
          dialog.setOnDismissListener { settle(false) }
          dialog.show()
        } catch (e: Exception) {
          promise.reject("DIALOG_ERROR", "NidoSecureDialog: ${e.message}", e)
        }
      }
    }
  }
}
