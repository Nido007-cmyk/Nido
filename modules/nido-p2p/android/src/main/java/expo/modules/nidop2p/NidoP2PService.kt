package expo.modules.nidop2p

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
import android.os.PowerManager
import androidx.core.app.NotificationCompat

/**
 * NidoP2PService — Foreground Service para el servidor Bluetooth de NIDO.
 *
 * Arquitectura basada en Briar (bramble-android): el servidor RFCOMM y su
 * accept loop viven en un foreground service con notificación persistente,
 * independiente del ciclo de vida de cualquier Activity o del bridge JS.
 *
 * Por qué es necesario:
 * Sin foreground service, Android congela el proceso ~30s después de que la
 * app va a background (o se apaga la pantalla). El kernel sigue aceptando
 * conexiones en el backlog del server socket, pero el hilo `accept()` nunca
 * corre porque el proceso está congelado. El dialer conecta a nivel TCP pero
 * nadie lee el HELLO → timeout de 15s ("el otro lado no respondió como NIDO").
 *
 * Con foreground service, el proceso está exento del freezer y `accept()`
 * siempre responde, aunque la pantalla esté apagada.
 *
 * El servicio se inicia vía `NidoP2PModule.startServer()` y se detiene vía
 * `stopServer()`. Mientras corre, muestra una notificación persistente
 * (requerido por Android para foreground services).
 */
class NidoP2PService : Service() {

  companion object {
    const val CHANNEL_ID = "nido_p2p_service"
    const val NOTIFICATION_ID = 0x1D0
    const val ACTION_START = "team.nido.app.p2p.START"
    const val ACTION_STOP = "team.nido.app.p2p.STOP"

    /**
     * Inicia el servicio como foreground. Idempotente: si ya corre, no hace nada.
     */
    fun start(context: Context) {
      val intent = Intent(context, NidoP2PService::class.java).setAction(ACTION_START)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    /**
     * Detiene el servicio.
     */
    fun stop(context: Context) {
      val intent = Intent(context, NidoP2PService::class.java).setAction(ACTION_STOP)
      context.startService(intent)
    }
  }

  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    return when (intent?.action) {
      ACTION_STOP -> {
        stopForegroundService()
        START_NOT_STICKY
      }
      ACTION_START -> {
        startForegroundService()
        START_STICKY
      }
      else -> {
        // DIAG-2026-10-07: reinicio del sistema (intent null tras muerte del
        // proceso). El server socket y el accept loop vivían en el
        // NidoP2PManager del módulo (JS-driven) y murieron con el proceso;
        // sin runtime JS no se pueden reconstruir desde aquí, así que NO se
        // publica la notificación "listo para recibir" (mentiría). La app
        // reconstruye todo al abrir la pantalla P2P (startLink).
        stopSelf()
        START_NOT_STICKY
      }
    }
  }

  private fun startForegroundService() {
    // Wake lock parcial: permite que el accept() y el handshake sobrevivan
    // a Doze mientras el servicio está activo (patrón wakefulIoExecutor de Briar).
    // Se libera en onDestroy.
    if (wakeLock == null) {
      val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "NIDO:P2PServer").apply {
        acquire(10 * 60 * 1000L) // 10 min; se renueva si el servicio sigue activo
      }
    }

    val notification = buildNotification()

    // Android 14+ requiere declarar el tipo de foreground service.
    // CONNECTED_DEVICE es el tipo correcto para Bluetooth.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val serviceType = if (Build.VERSION.SDK_INT >= 30) {
        // API 30+: CONNECTED_DEVICE disponible
        ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
      } else {
        0
      }
      if (serviceType != 0) {
        startForeground(NOTIFICATION_ID, notification, serviceType)
      } else {
        @Suppress("DEPRECATION")
        startForeground(NOTIFICATION_ID, notification)
      }
    } else {
      @Suppress("DEPRECATION")
      startForeground(NOTIFICATION_ID, notification)
    }

    // El manager del módulo (NidoP2PModule) sigue siendo el dueño del
    // server socket y el accept loop. Este servicio existe únicamente
    // para mantener el proceso vivo (exento del freezer de Android)
    // mientras el servidor está activo. Sin foreground service, Android
    // congela el proceso ~30s después del background y accept() nunca
    // responde aunque el kernel tenga conexiones en el backlog.
  }

  private fun stopForegroundService() {
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    wakeLock?.let {
      if (it.isHeld) it.release()
    }
    wakeLock = null
    super.onDestroy()
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "NIDO P2P",
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "Mantiene el servidor Bluetooth de NIDO activo para recibir mensajes"
        setShowBadge(false)
      }
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      nm.createNotificationChannel(channel)
    }
  }

  private fun buildNotification(): Notification {
    // Intent para abrir la app al tocar la notificación.
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val pendingIntent = launchIntent?.let {
      PendingIntent.getActivity(
        this, 0, it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("NIDO P2P activo")
      .setContentText("Listo para recibir mensajes de tus contactos")
      .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
      .setContentIntent(pendingIntent)
      .setOngoing(true)
      .setShowWhen(false)
      .build()
  }
}
