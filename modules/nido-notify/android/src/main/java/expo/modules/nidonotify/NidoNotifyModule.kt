/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

package expo.modules.nidonotify

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import expo.modules.interfaces.permissions.PermissionsResponse
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * El puente JS de las notificaciones locales (modules/nido-notify/index.ts).
 * La lógica vive en NotifyEngine, que también usa el receptor sin JS.
 */
class NidoNotifyModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext
      ?: throw IllegalStateException("nido-notify: sin contexto")

  override fun definition() = ModuleDefinition {
    Name("NidoNotify")

    Events(EVENT_RECEIVED)

    OnCreate {
      NotifyEngine.onDelivered = { id ->
        try {
          sendEvent(EVENT_RECEIVED, mapOf("identifier" to id))
        } catch (_: Exception) {
          // JS ya no escucha: el aviso está mostrado igual.
        }
      }
    }

    OnDestroy {
      NotifyEngine.onDelivered = null
    }

    // Como expo-notifications: en Android 13+ con targetSdk 33+ se pide
    // POST_NOTIFICATIONS; antes, basta con que estén activadas.
    AsyncFunction("requestPermissionsAsync") { promise: Promise ->
      val ctx = context
      if (ctx.applicationInfo.targetSdkVersion >= 33 && Build.VERSION.SDK_INT >= 33) {
        val permissions = appContext.permissions
        if (permissions == null) {
          promise.resolve(classicStatus(ctx))
          return@AsyncFunction
        }
        permissions.askForPermissions(
          { result: Map<String, PermissionsResponse> ->
            val enabled = notificationManager(ctx).areNotificationsEnabled()
            val allGranted = result.values.all { it.status == PermissionsStatus.GRANTED }
            val allDenied = result.values.all { it.status == PermissionsStatus.DENIED }
            val status = when {
              allDenied -> PermissionsStatus.DENIED
              !enabled -> PermissionsStatus.DENIED
              allGranted -> PermissionsStatus.GRANTED
              else -> PermissionsStatus.UNDETERMINED
            }
            promise.resolve(
              mapOf(
                "status" to status.status,
                "granted" to allGranted,
                "canAskAgain" to result.values.all { it.canAskAgain },
              ),
            )
          },
          Manifest.permission.POST_NOTIFICATIONS,
        )
      } else {
        promise.resolve(classicStatus(ctx))
      }
    }

    AsyncFunction("setNotificationChannelAsync") { id: String, options: Map<String, Any?> ->
      NotifyEngine.setChannel(
        context,
        id,
        options["name"] as? String ?: id,
        (options["importance"] as? Number)?.toInt() ?: 0,
        vibrationPatternFrom(options["vibrationPattern"]),
        options["sound"] as? String,
        options.containsKey("sound"),
        (options["lockscreenVisibility"] as? Number)?.toInt(),
      )
    }

    AsyncFunction("scheduleNotificationAsync") { request: Map<String, Any?> ->
      val identifier = (request["identifier"] as? String)?.takeIf { it.isNotEmpty() }
        ?: NotifyEngine.newIdentifier()
      NotifyEngine.schedule(
        context,
        NotifyRequest(
          identifier = identifier,
          title = request["title"] as? String,
          body = request["body"] as? String,
          channelId = request["channelId"] as? String,
          trigger = (request["trigger"] as? Map<*, *>)?.let { triggerFrom(it) },
          sound = request["sound"] == true,
        ),
      )
    }

    AsyncFunction("cancelScheduledNotificationAsync") { identifier: String ->
      NotifyEngine.cancel(context, identifier)
    }

    AsyncFunction("cancelAllScheduledNotificationsAsync") {
      NotifyEngine.cancelAll(context)
    }

    AsyncFunction("getAllScheduledNotificationsAsync") {
      NotifyEngine.stored(context).map { it.identifier }
    }

    AsyncFunction("getPresentedNotificationsAsync") {
      NotifyEngine.presented(context)
    }

    AsyncFunction("dismissNotificationAsync") { identifier: String ->
      NotifyEngine.dismiss(context, identifier)
    }

    AsyncFunction("dismissAllNotificationsAsync") {
      NotifyEngine.dismissAll(context)
    }

    // Al pasar de expo-notifications a este módulo: si quedó el almacén de
    // expo, se borra (lleva el texto de los avisos en claro) y se devuelve
    // true para que la app vuelva a programar lo pendiente una vez. Las
    // alarmas viejas apuntan a un receptor que ya no existe.
    AsyncFunction("consumeLegacyStoreAsync") {
      val ctx = context
      val present = NotifyEngine.legacyStorePresent(ctx)
      if (present) NotifyEngine.deleteLegacyStore(ctx)
      present
    }
  }

  /**
   * T-15 (P-25): el patrón de vibración se valida elemento a elemento.
   * Antes, un elemento no numérico lanzaba ClassCastException desde un
   * cast duro a mitad de la llamada y la promesa se rechazaba sin
   * explicación; ahora la lista mala se rechaza con un error claro antes
   * de crear nada (nunca un canal a medias) y la buena se convierte como
   * siempre. Solo lo alcanza el propio JS de la app.
   */
  private fun vibrationPatternFrom(raw: Any?): LongArray? {
    val list = raw as? List<*> ?: return null
    return LongArray(list.size) { i ->
      (list[i] as? Number)?.toLong()
        ?: throw IllegalArgumentException("nido-notify: vibrationPattern debe ser una lista de números.")
    }
  }

  private fun notificationManager(ctx: Context) =
    ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  private fun classicStatus(ctx: Context): Map<String, Any> {
    val enabled = notificationManager(ctx).areNotificationsEnabled()
    return mapOf(
      "status" to (if (enabled) PermissionsStatus.GRANTED else PermissionsStatus.DENIED).status,
      "granted" to enabled,
      "canAskAgain" to enabled,
    )
  }

  private fun triggerFrom(m: Map<*, *>): TriggerSpec {
    fun int(k: String) = (m[k] as? Number)?.toInt() ?: 0
    return TriggerSpec(
      type = m["type"] as? String ?: "",
      timestamp = (m["timestamp"] as? Number)?.toLong() ?: 0L,
      hour = int("hour"),
      minute = int("minute"),
      weekday = int("weekday"),
      day = int("day"),
      month = int("month"),
    )
  }

  companion object {
    const val EVENT_RECEIVED = "onNotificationReceived"
  }
}
