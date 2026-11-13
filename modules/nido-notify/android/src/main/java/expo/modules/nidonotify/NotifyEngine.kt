/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

package expo.modules.nidonotify

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import org.json.JSONObject
import java.util.Calendar
import java.util.UUID

/** Un aviso guardado: lo que se muestra y cuándo. */
data class NotifyRequest(
  val identifier: String,
  val title: String?,
  val body: String?,
  val channelId: String?,
  val trigger: TriggerSpec?,
  /** content.sound == "default": solo cuenta antes de Android 8 (luego manda el canal). */
  val sound: Boolean = false,
)

/**
 * Notificaciones locales de NIDO, sin Firebase ni Google Play.
 *
 * Sustituye a expo-notifications (paquete NIDO-SIN-GOOGLE-2026-11-13). Hace
 * lo mismo que hacía expo para lo que NIDO usa:
 *  - guarda cada aviso programado en SharedPreferences privadas, para
 *    volver a programarlo tras reiniciar el teléfono o actualizar la app;
 *  - lo programa con AlarmManager RTC_WAKEUP: exacto si Android lo permite
 *    (menos de Android 12, o SCHEDULE_EXACT_ALARM concedido), si no
 *    inexacto, como expo;
 *  - al dispararse lo muestra con etiqueta = identificador e id 0 (como
 *    expo) y, si se repite, programa la siguiente vez;
 *  - una fecha fija que ya pasó no se muestra: se descarta, como expo.
 */
object NotifyEngine {
  private const val TAG = "nido-notify"
  private const val STORE = "nido.notify.requests"
  /** El almacén que dejaba expo-notifications (texto de los avisos en claro). */
  const val LEGACY_EXPO_STORE = "expo.modules.notifications.SharedPreferencesNotificationsStore"
  const val ACTION_FIRE = "expo.modules.nidonotify.FIRE"
  const val EXTRA_IDENTIFIER = "identifier"
  /** Mismo id que expo (ANDROID_NOTIFICATION_ID): la etiqueta distingue. */
  const val NOTIFY_ID = 0

  /** Quien escucha las entregas mientras la app está viva (el módulo). */
  @Volatile var onDelivered: ((String) -> Unit)? = null

  // ---- almacén ----

  private fun prefs(ctx: Context) = ctx.getSharedPreferences(STORE, Context.MODE_PRIVATE)

  fun toJson(r: NotifyRequest): String = JSONObject().apply {
    put("identifier", r.identifier)
    r.title?.let { put("title", it) }
    r.body?.let { put("body", it) }
    r.channelId?.let { put("channelId", it) }
    put("sound", r.sound)
    r.trigger?.let { t ->
      put("trigger", JSONObject().apply {
        put("type", t.type)
        put("timestamp", t.timestamp)
        put("hour", t.hour)
        put("minute", t.minute)
        put("weekday", t.weekday)
        put("day", t.day)
        put("month", t.month)
      })
    }
  }.toString()

  fun fromJson(s: String): NotifyRequest? = try {
    val o = JSONObject(s)
    val t = o.optJSONObject("trigger")
    NotifyRequest(
      identifier = o.getString("identifier"),
      title = if (o.has("title")) o.getString("title") else null,
      body = if (o.has("body")) o.getString("body") else null,
      channelId = if (o.has("channelId")) o.getString("channelId") else null,
      sound = o.optBoolean("sound", false),
      trigger = t?.let {
        TriggerSpec(
          type = it.getString("type"),
          timestamp = it.optLong("timestamp"),
          hour = it.optInt("hour"),
          minute = it.optInt("minute"),
          weekday = it.optInt("weekday"),
          day = it.optInt("day"),
          month = it.optInt("month"),
        )
      },
    )
  } catch (e: Exception) {
    null
  }

  fun stored(ctx: Context): List<NotifyRequest> =
    prefs(ctx).all.values.mapNotNull { v -> (v as? String)?.let { fromJson(it) } }

  private fun save(ctx: Context, r: NotifyRequest) {
    prefs(ctx).edit().putString(r.identifier, toJson(r)).apply()
  }

  private fun forget(ctx: Context, identifier: String) {
    prefs(ctx).edit().remove(identifier).apply()
  }

  // ---- alarmas ----

  private fun fireIntent(ctx: Context, identifier: String): PendingIntent {
    val intent = Intent(ctx, NidoNotifyReceiver::class.java)
      .setAction(ACTION_FIRE)
      // Un dato por identificador: cada aviso tiene su PendingIntent propio.
      .setData(Uri.Builder().scheme("nidonotify").authority("request").appendPath(identifier).build())
      .putExtra(EXTRA_IDENTIFIER, identifier)
    return PendingIntent.getBroadcast(
      ctx,
      0,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun alarmManager(ctx: Context) = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager

  private fun setAlarm(ctx: Context, atMillis: Long, operation: PendingIntent) {
    val am = alarmManager(ctx)
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()) {
      am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, operation)
    } else {
      am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, operation)
    }
  }

  /**
   * Programa (o muestra ya, sin disparador). Devuelve el identificador.
   * Como expo: el mismo identificador sustituye al anterior.
   */
  fun schedule(ctx: Context, request: NotifyRequest): String {
    val trigger = request.trigger
    if (trigger == null) {
      post(ctx, request)
      return request.identifier
    }
    val next = NotifyTriggers.nextTriggerMillis(trigger, Calendar.getInstance())
    if (next == null) {
      cancel(ctx, request.identifier)
    } else {
      save(ctx, request)
      setAlarm(ctx, next, fireIntent(ctx, request.identifier))
    }
    return request.identifier
  }

  fun newIdentifier(): String = UUID.randomUUID().toString()

  fun cancel(ctx: Context, identifier: String) {
    alarmManager(ctx).cancel(fireIntent(ctx, identifier))
    forget(ctx, identifier)
  }

  fun cancelAll(ctx: Context) {
    val ids = prefs(ctx).all.keys.toList()
    for (id in ids) alarmManager(ctx).cancel(fireIntent(ctx, id))
    prefs(ctx).edit().clear().commit()
    // El almacén viejo de expo también lleva texto de avisos: fuera.
    deleteLegacyStore(ctx)
  }

  /** Al dispararse una alarma: mostrar y, si se repite, la siguiente. */
  fun onAlarm(ctx: Context, identifier: String) {
    val raw = prefs(ctx).getString(identifier, null) ?: return
    val request = fromJson(raw)
    if (request == null) {
      forget(ctx, identifier)
      return
    }
    post(ctx, request)
    if (request.trigger?.repeats == true) {
      schedule(ctx, request)
    } else {
      forget(ctx, identifier)
    }
  }

  /** Tras reiniciar el teléfono o actualizar la app: todo de nuevo. */
  fun rescheduleAll(ctx: Context) {
    for (r in stored(ctx)) {
      try {
        schedule(ctx, r)
      } catch (e: Exception) {
        Log.w(TAG, "No se pudo reprogramar ${r.identifier}: ${e.message}")
      }
    }
  }

  // ---- mostrar ----

  private fun notificationManager(ctx: Context) =
    ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  fun post(ctx: Context, request: NotifyRequest) {
    val channelId = request.channelId
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && channelId != null) {
      Notification.Builder(ctx, channelId)
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(ctx, defaultChannel(ctx))
    } else {
      // Antes de Android 8, como expo: el sonido por defecto si el aviso lo pide.
      @Suppress("DEPRECATION")
      Notification.Builder(ctx).apply {
        if (request.sound) {
          setDefaults(Notification.DEFAULT_SOUND)
          setSound(Settings.System.DEFAULT_NOTIFICATION_URI)
        }
      }
    }
    val launch = try {
      ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
    } catch (e: Exception) {
      null
    }
    launch?.let {
      it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      builder.setContentIntent(
        PendingIntent.getActivity(
          ctx,
          request.identifier.hashCode(),
          it,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        ),
      )
    }
    builder
      // Como expo sin icono configurado: el icono de la app.
      .setSmallIcon(ctx.applicationInfo.icon)
      .setAutoCancel(true)
      .setContentTitle(request.title)
      .setContentText(request.body)
      .setStyle(Notification.BigTextStyle().bigText(request.body))
    try {
      notificationManager(ctx).notify(request.identifier, NOTIFY_ID, builder.build())
    } catch (e: SecurityException) {
      // Sin permiso de notificaciones: nada que mostrar.
      Log.w(TAG, "Sin permiso para mostrar ${request.identifier}")
      return
    }
    onDelivered?.invoke(request.identifier)
  }

  /**
   * expo usaba su canal «Miscellaneous» para avisos sin canal. NIDO siempre
   * pasa canal; este es solo la red por si alguno llega sin él.
   */
  private fun defaultChannel(ctx: Context): String {
    val id = "expo_notifications_fallback_notification_channel"
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val nm = notificationManager(ctx)
      if (nm.getNotificationChannel(id) == null) {
        nm.createNotificationChannel(NotificationChannel(id, "Miscellaneous", NotificationManager.IMPORTANCE_DEFAULT))
      }
    }
    return id
  }

  /** Identificadores de los avisos que siguen en la bandeja. */
  fun presented(ctx: Context): List<String> =
    notificationManager(ctx).activeNotifications
      .filter { it.id == NOTIFY_ID && it.tag != null }
      .mapNotNull { it.tag }

  fun dismiss(ctx: Context, identifier: String) {
    notificationManager(ctx).cancel(identifier, NOTIFY_ID)
  }

  fun dismissAll(ctx: Context) {
    notificationManager(ctx).cancelAll()
  }

  // ---- canales ----

  /**
   * Mismos valores que expo: importancia y visibilidad llegan con la
   * numeración de expo (AndroidImportance HIGH = 6 …, SECRET = 3) y aquí
   * pasan a las de Android. sound = "default" pone el sonido de
   * notificación del sistema sin atributos, como hacía expo. Android no
   * cambia la importancia ni el sonido de un canal ya creado; el nombre sí.
   */
  fun setChannel(
    ctx: Context,
    id: String,
    name: String,
    importance: Int,
    vibrationPattern: LongArray?,
    sound: String?,
    hasSound: Boolean,
    lockscreenVisibility: Int?,
  ) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(id, name, importanceFromExpo(importance))
    lockscreenVisibility?.let { v -> visibilityFromExpo(v)?.let { channel.lockscreenVisibility = it } }
    if (hasSound) {
      channel.setSound(if (sound == null) null else Settings.System.DEFAULT_NOTIFICATION_URI, null)
    }
    vibrationPattern?.let { channel.vibrationPattern = it }
    notificationManager(ctx).createNotificationChannel(channel)
  }

  fun importanceFromExpo(v: Int): Int = when (v) {
    1 -> NotificationManager.IMPORTANCE_UNSPECIFIED
    2 -> NotificationManager.IMPORTANCE_NONE
    3 -> NotificationManager.IMPORTANCE_MIN
    4 -> NotificationManager.IMPORTANCE_LOW
    5 -> NotificationManager.IMPORTANCE_DEFAULT
    6 -> NotificationManager.IMPORTANCE_HIGH
    7 -> NotificationManager.IMPORTANCE_MAX
    else -> NotificationManager.IMPORTANCE_DEFAULT
  }

  fun visibilityFromExpo(v: Int): Int? = when (v) {
    1 -> Notification.VISIBILITY_PUBLIC
    2 -> Notification.VISIBILITY_PRIVATE
    3 -> Notification.VISIBILITY_SECRET
    0 -> Notification.VISIBILITY_PUBLIC
    else -> null
  }

  // ---- el almacén viejo de expo ----

  /** ¿Quedó el almacén de expo-notifications de una versión anterior? */
  fun legacyStorePresent(ctx: Context): Boolean =
    ctx.getSharedPreferences(LEGACY_EXPO_STORE, Context.MODE_PRIVATE).all.isNotEmpty()

  fun deleteLegacyStore(ctx: Context) {
    ctx.getSharedPreferences(LEGACY_EXPO_STORE, Context.MODE_PRIVATE).edit().clear().commit()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      ctx.deleteSharedPreferences(LEGACY_EXPO_STORE)
    }
  }
}
