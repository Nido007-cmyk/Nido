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
import android.os.Handler
import android.os.IBinder
import android.os.Looper

/**
 * AnswerKeepAliveService — 0.1.55: «NIDO está respondiendo…».
 *
 * Mientras la IA escribe una respuesta, este servicio en primer plano evita
 * que Android congele o cierre NIDO si el usuario cambia de app (algunos
 * fabricantes lo hacen a los pocos segundos y la respuesta se corta). Mismo
 * esquema que NidoP2PService: órdenes START y STOP por Intent, en orden.
 *
 * Propio de NIDO:
 *  - Tope de seguridad: si nadie lo para (JS recargado, error), se para solo
 *    a los [MAX_ALIVE_MS]. Una notificación «respondiendo» que se queda
 *    para siempre sería mentir.
 *  - Un reinicio del sistema (Intent nulo) no lo resucita: sin el motor de
 *    JS no hay respuesta que proteger.
 *  - Textos en el idioma de la app: los manda JS con cada START.
 */
class AnswerKeepAliveService : Service() {

  companion object {
    const val CHANNEL_ID = "nido_answering"
    const val NOTIFICATION_ID = 0x1D1
    const val ACTION_START = "team.nido.app.answer.START"
    const val ACTION_STOP = "team.nido.app.answer.STOP"
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val EXTRA_CHANNEL = "channel"
    /** Más que cualquier respuesta razonable en un teléfono (n_predict + carga). */
    const val MAX_ALIVE_MS = 15L * 60 * 1000

    /** Pide el servicio. Si Android no deja (NIDO ya en segundo plano), se ignora. */
    fun start(context: Context, title: String, text: String, channelName: String): Boolean {
      val intent = Intent(context, AnswerKeepAliveService::class.java)
        .setAction(ACTION_START)
        .putExtra(EXTRA_TITLE, title)
        .putExtra(EXTRA_TEXT, text)
        .putExtra(EXTRA_CHANNEL, channelName)
      return runCatching {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
        else context.startService(intent)
        true
      }.getOrDefault(false)
    }

    /** Lo para. Seguro aunque no esté activo. */
    fun stop(context: Context) {
      val intent = Intent(context, AnswerKeepAliveService::class.java).setAction(ACTION_STOP)
      // La orden STOP llega detrás de START: el servicio ya es foreground y
      // pararlo es seguro. Si Android no acepta la orden, se para por fuera.
      runCatching { context.startService(intent) }
        .onFailure { runCatching { context.stopService(Intent(context, AnswerKeepAliveService::class.java)) } }
    }
  }

  private val handler = Handler(Looper.getMainLooper())
  private val safetyStop = Runnable { finish() }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> {
        goForeground(
          intent.getStringExtra(EXTRA_TITLE) ?: "NIDO",
          intent.getStringExtra(EXTRA_TEXT) ?: "",
          intent.getStringExtra(EXTRA_CHANNEL) ?: "NIDO",
        )
        handler.removeCallbacks(safetyStop)
        handler.postDelayed(safetyStop, MAX_ALIVE_MS)
      }
      ACTION_STOP -> finish()
      else -> stopSelf()
    }
    return START_NOT_STICKY
  }

  private fun goForeground(title: String, text: String, channelName: String) {
    val notification = buildNotification(title, text, channelName)
    runCatching {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    }.onFailure { stopSelf() }
  }

  private fun finish() {
    handler.removeCallbacks(safetyStop)
    runCatching {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        stopForeground(STOP_FOREGROUND_REMOVE)
      } else {
        @Suppress("DEPRECATION")
        stopForeground(true)
      }
    }
    stopSelf()
  }

  override fun onDestroy() {
    handler.removeCallbacks(safetyStop)
    super.onDestroy()
  }

  private fun buildNotification(title: String, text: String, channelName: String): Notification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(CHANNEL_ID, channelName, NotificationManager.IMPORTANCE_LOW).apply {
        setShowBadge(false)
      }
      (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    launchIntent?.let {
      builder.setContentIntent(
        PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE),
      )
    }
    // El icono de NIDO (lo trae el módulo nido-p2p); si faltara, el de la app.
    val icon = resources.getIdentifier("ic_stat_nido", "drawable", packageName).takeIf { it != 0 }
      ?: applicationInfo.icon
    return builder
      .setSmallIcon(icon)
      .setContentTitle(title)
      .setContentText(text)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .build()
  }
}
