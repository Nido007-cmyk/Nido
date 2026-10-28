/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

package expo.modules.downloadwakelock

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * 0.1.55: mantiene vivo NIDO mientras la IA escribe una respuesta, con una
 * notificación discreta («NIDO está respondiendo…»). Sin esto, algunos
 * fabricantes cierran la app pocos segundos después de salir de ella y la
 * respuesta se pierde a medias. Patrón tomado de BOAR (AnswerService, MIT).
 *
 * Empieza con cada respuesta, mientras NIDO está en pantalla (Android no deja
 * que una app en segundo plano lo arranque: ese intento se ignora, nunca
 * lanza) y para cuando la respuesta termina. Importancia baja: sin sonido ni
 * ventana emergente.
 */
class AnswerKeepAliveService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Siempre foreground primero: Android cierra la app si a
    // startForegroundService() no le sigue startForeground().
    runCatching {
      val n = notification(this)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
      } else {
        startForeground(ID, n)
      }
    }
    synchronized(lock) {
      started = true
      if (stopPending) {
        stopPending = false
        stopSelf()
      }
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    synchronized(lock) {
      started = false
      stopPending = false
    }
    super.onDestroy()
  }

  companion object {
    private const val ID = 0x1D1
    private const val CHANNEL = "nido_answering"
    private val lock = Any()
    private var started = false
    private var stopPending = false
    private var requested = false
    @Volatile private var title = "NIDO"
    @Volatile private var text = ""
    @Volatile private var channelName = "NIDO"

    fun start(ctx: Context, title: String, text: String, channelName: String) {
      this.title = title
      this.text = text
      this.channelName = channelName
      synchronized(lock) { stopPending = false }
      runCatching {
        val i = Intent(ctx, AnswerKeepAliveService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
        synchronized(lock) { requested = true }
      }
    }

    fun stop(ctx: Context) {
      synchronized(lock) {
        if (!requested) return
        requested = false
        // Aún no es foreground: pararlo ahora haría que Android cerrara la
        // app. onStartCommand lo para en cuanto lo sea.
        if (!started) {
          stopPending = true
          return
        }
      }
      runCatching { ctx.stopService(Intent(ctx, AnswerKeepAliveService::class.java)) }
    }

    private fun smallIcon(ctx: Context): Int {
      val id = ctx.resources.getIdentifier("ic_stat_nido", "drawable", ctx.packageName)
      return if (id != 0) id else ctx.applicationInfo.icon
    }

    private fun notification(ctx: Context): Notification {
      val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm?.createNotificationChannel(NotificationChannel(CHANNEL, channelName, NotificationManager.IMPORTANCE_LOW))
        Notification.Builder(ctx, CHANNEL)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(ctx)
      }
      val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
        ?.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
      if (launch != null) {
        builder.setContentIntent(
          PendingIntent.getActivity(ctx, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT),
        )
      }
      return builder
        .setSmallIcon(smallIcon(ctx))
        .setContentTitle(title)
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .build()
    }
  }
}
