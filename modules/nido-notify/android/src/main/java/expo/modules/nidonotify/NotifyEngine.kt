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
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Log
import org.json.JSONObject
import java.security.KeyStore
import java.util.Calendar
import java.util.UUID
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

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
 *    desde la 0.1.99 cada entrada va SELLADA (AES-256-GCM con la clave en
 *    el Android Keystore, ver NotifyStoreSeal): antes el título y el
 *    cuerpo quedaban en claro en el fichero;
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
  /** El canal de respaldo de expo: mismo id, así no aparece uno nuevo en Ajustes. */
  const val FALLBACK_CHANNEL_ID = "expo_notifications_fallback_notification_channel"

  /** Quien escucha las entregas mientras la app está viva (el módulo). */
  @Volatile var onDelivered: ((String) -> Unit)? = null

  // ---- almacén ----

  private fun prefs(ctx: Context) = ctx.getSharedPreferences(STORE, Context.MODE_PRIVATE)

  /** Alias de la clave del almacén en el Android Keystore (T-15, m-58). */
  private const val STORE_KEY_ALIAS = "nido.notify.store.v1"

  /**
   * La clave con la que se sella el almacén: AES-256 en el Android
   * Keystore, fuera de las prefs (el fichero deja de contener texto
   * legible). Sin autenticación de usuario: el receptor de arranque debe
   * poder reprogramar los avisos sin que nadie haya desbloqueado nada.
   * Null si el Keystore no responde: quien llama degrada (no se persiste
   * en claro jamás), nunca revienta.
   */
  private fun storeKey(): SecretKey? = try {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (ks.getKey(STORE_KEY_ALIAS, null) as? SecretKey) ?: createStoreKey()
  } catch (e: Exception) {
    Log.w(TAG, "Clave del almacén de avisos no disponible: ${e.message}")
    null
  }

  /** Borra la clave actual y crea otra (tras una invalidación permanente). */
  private fun regenerateStoreKey(): SecretKey? = try {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    if (ks.containsAlias(STORE_KEY_ALIAS)) ks.deleteEntry(STORE_KEY_ALIAS)
    createStoreKey()
  } catch (e: Exception) {
    Log.w(TAG, "No se pudo regenerar la clave del almacén de avisos: ${e.message}")
    null
  }

  private fun createStoreKey(): SecretKey {
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    gen.init(
      KeyGenParameterSpec.Builder(
        STORE_KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build(),
    )
    return gen.generateKey()
  }

  /**
   * Sella el JSON de un aviso con su identificador como datos asociados.
   * Si la clave murió de forma permanente (cambió el bloqueo del
   * teléfono), se regenera y se reintenta una vez: las entradas selladas
   * con la clave vieja ya no abrirán y stored() las descartará. Null si
   * no hay manera: el aviso no se persiste, pero NUNCA en claro.
   */
  private fun sealFor(identifier: String, json: String): String? {
    val aad = identifier.toByteArray(Charsets.UTF_8)
    val plain = json.toByteArray(Charsets.UTF_8)
    val key = storeKey() ?: return null
    return try {
      NotifyStoreSeal.seal(key, aad, plain)
    } catch (e: KeyPermanentlyInvalidatedException) {
      val fresh = regenerateStoreKey() ?: return null
      try {
        NotifyStoreSeal.seal(fresh, aad, plain)
      } catch (e2: Exception) {
        Log.w(TAG, "No se pudo sellar el aviso $identifier: ${e2.message}")
        null
      }
    } catch (e: Exception) {
      Log.w(TAG, "No se pudo sellar el aviso $identifier: ${e.message}")
      null
    }
  }

  /** Abre una entrada sellada; null si no abre (manipulada o clave ajena). */
  private fun openFor(identifier: String, sealed: String): ByteArray? {
    val key = storeKey() ?: return null
    return NotifyStoreSeal.open(key, identifier.toByteArray(Charsets.UTF_8), sealed)
  }

  /**
   * Lee una entrada del almacén: sellada (formato actual) o en claro
   * (legado de ≤0.1.98, que solo puede venir de una actualización).
   */
  private fun decodeEntry(identifier: String, raw: String): NotifyRequest? {
    if (NotifyStoreSeal.isSealed(raw)) {
      val plain = openFor(identifier, raw) ?: return null
      return fromJson(String(plain, Charsets.UTF_8))
    }
    return fromJson(raw)
  }

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

  fun stored(ctx: Context): List<NotifyRequest> {
    val snapshot = prefs(ctx).all.toMap()
    val out = ArrayList<NotifyRequest>()
    for ((id, v) in snapshot) {
      val raw = v as? String ?: continue
      val req = decodeEntry(id, raw)
      if (req == null) {
        // Sellada que no abre (clave perdida o entrada manipulada) o
        // ilegible: se descarta. Un aviso perdido es recuperable
        // reprogramando desde JS; un formato a medias, no. Y nunca es un
        // error fatal: stored() corre en rescheduleAll tras el arranque,
        // así que «clave perdida» se comporta como «almacén vacío».
        forget(ctx, id)
        continue
      }
      out.add(req)
      if (!NotifyStoreSeal.isSealed(raw)) {
        // Migración en la primera lectura: lo legado en claro (≤0.1.98)
        // se reescribe sellado.
        save(ctx, req)
      }
    }
    return out
  }

  private fun save(ctx: Context, r: NotifyRequest) {
    val sealed = sealFor(r.identifier, toJson(r))
    if (sealed == null) {
      // Sin clave no se guarda en claro jamás (m-58). La alarma de esta
      // sesión ya la pone schedule(); lo que se pierde es solo la
      // persistencia tras reinicio, y queda dicho en el log.
      Log.w(TAG, "Aviso ${r.identifier} no persistido: almacén sellado no disponible")
      return
    }
    prefs(ctx).edit().putString(r.identifier, sealed).apply()
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
    val request = decodeEntry(identifier, raw)
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
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(ctx, resolveChannel(ctx, request.channelId))
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
   * El canal donde va el aviso, como en expo (BaseNotificationBuilder): el
   * pedido si existe; si no (sin canal, o aún sin crear, por ejemplo un
   * mensaje que llega antes de que el arranque cree los canales), el canal
   * de respaldo de expo, con su mismo identificador, nombre «Miscellaneous»,
   * importancia alta, insignia y vibración. Android descarta en silencio un
   * aviso dirigido a un canal que no existe.
   */
  fun resolveChannel(ctx: Context, requested: String?): String {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return requested ?: FALLBACK_CHANNEL_ID
    val nm = notificationManager(ctx)
    if (requested != null && nm.getNotificationChannel(requested) != null) return requested
    if (nm.getNotificationChannel(FALLBACK_CHANNEL_ID) == null) {
      val channel = NotificationChannel(FALLBACK_CHANNEL_ID, "Miscellaneous", NotificationManager.IMPORTANCE_HIGH)
      channel.setShowBadge(true)
      channel.enableVibration(true)
      nm.createNotificationChannel(channel)
    }
    return FALLBACK_CHANNEL_ID
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
