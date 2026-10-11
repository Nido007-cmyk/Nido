// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.

package expo.modules.nidolaunch

import android.content.Context
import android.content.Intent
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * NIDO desde fuera de la app (0.1.10):
 *  - "Compartir → NIDO" (ACTION_SEND text/plain, declarado en app.json);
 *  - atajos al mantener pulsado el icono (dinámicos, ShortcutManager);
 *  - el acceso rápido de la barra de ajustes (AskNidoTileService).
 *
 * Todo llega aquí como una "acción pendiente" que la app recoge cuando el
 * chat está visible (después del bloqueo/bóveda). El texto compartido es
 * contenido NO confiable: la app solo lo pone en el campo de texto, nunca
 * lo envía sola. Nada de esto toca la red.
 */
class NidoLaunchModule : Module() {
  companion object {
    const val EXTRA_ACTION = "nido_action"
    private val ALLOWED = setOf("new_chat", "p2p")
    private const val MAX_SHARED_CHARS = 4000

    @Volatile
    private var pending: Map<String, String>? = null

    /**
     * Lee la intención y la marca como consumida (así un giro de pantalla o
     * una recreación de la actividad no la entrega dos veces).
     */
    fun capture(intent: Intent?): Boolean {
      if (intent == null) return false
      if (intent.action == Intent.ACTION_SEND && intent.type?.startsWith("text/") == true) {
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.take(MAX_SHARED_CHARS)?.trim()
        intent.action = Intent.ACTION_MAIN
        intent.removeExtra(Intent.EXTRA_TEXT)
        if (text.isNullOrEmpty()) return false
        pending = mapOf("action" to "share", "text" to text)
        return true
      }
      val action = intent.getStringExtra(EXTRA_ACTION) ?: return false
      intent.removeExtra(EXTRA_ACTION)
      if (action !in ALLOWED) return false
      pending = mapOf("action" to action)
      return true
    }

    fun launchIntent(context: Context, action: String): Intent? =
      context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
        // Los atajos exigen una acción explícita.
        this.action = Intent.ACTION_VIEW
        putExtra(EXTRA_ACTION, action)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      }
  }

  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("React context no disponible")

  override fun definition() = ModuleDefinition {
    Name("NidoLaunch")
    Events("onLaunchAction")

    OnNewIntent { intent ->
      if (capture(intent)) sendEvent("onLaunchAction", mapOf<String, Any>())
    }

    /** Devuelve y borra la acción pendiente (null si no hay). */
    Function("getPendingAction") {
      if (pending == null) capture(appContext.currentActivity?.intent)
      val p = pending
      pending = null
      p
    }

    /** Atajos del icono, con los textos ya traducidos por la app. */
    Function("setShortcuts") { items: List<Map<String, String>> ->
      try {
        val icon = IconCompat.createWithResource(context, context.applicationInfo.icon)
        val shortcuts = items.mapNotNull { item ->
          val id = item["id"] ?: return@mapNotNull null
          val label = item["label"] ?: return@mapNotNull null
          if (id !in ALLOWED) return@mapNotNull null
          val intent = launchIntent(context, id) ?: return@mapNotNull null
          ShortcutInfoCompat.Builder(context, id)
            .setShortLabel(label.take(25))
            .setLongLabel(label.take(45))
            .setIcon(icon)
            .setIntent(intent)
            .build()
        }
        ShortcutManagerCompat.setDynamicShortcuts(context, shortcuts)
        true
      } catch (_: Exception) {
        false
      }
    }
  }
}
