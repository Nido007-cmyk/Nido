// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.

package expo.modules.nidolaunch

import android.app.PendingIntent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * Acceso rápido "Preguntar a NIDO" en la barra de ajustes. Abre NIDO en un
 * chat nuevo. Si el teléfono está bloqueado, Android pide desbloquear antes
 * (y NIDO, además, aplica su propio bloqueo/bóveda al abrirse).
 */
class AskNidoTileService : TileService() {
  override fun onStartListening() {
    super.onStartListening()
    qsTile?.apply {
      state = Tile.STATE_INACTIVE
      updateTile()
    }
  }

  override fun onClick() {
    super.onClick()
    if (isLocked) unlockAndRun(Runnable { openNido() }) else openNido()
  }

  private fun openNido() {
    val intent = NidoLaunchModule.launchIntent(this, "new_chat") ?: return
    if (Build.VERSION.SDK_INT >= 34) {
      val pi = PendingIntent.getActivity(
        this,
        0,
        intent,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
      startActivityAndCollapse(pi)
    } else {
      @Suppress("DEPRECATION")
      startActivityAndCollapse(intent)
    }
  }
}
