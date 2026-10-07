package expo.modules.nidop2p

import android.util.Base64
import expo.modules.interfaces.permissions.PermissionsResponseListener
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executors

/**
 * NidoP2P — módulo Expo (Kotlin) del transporte Bluetooth RFCOMM de NIDO.
 *
 * Expone a TypeScript el [NidoP2PManager] con una API mínima y explícita.
 * Toda la cripto (handshake X25519, secretbox, anti-replay) y el protocolo
 * de mensajes viven en TypeScript (`src/p2p/`); aquí solo viajan bytes.
 *
 * Nota de verificación: este módulo aún no se ha compilado (sin Android SDK
 * en este entorno). `requestPermissions` ya se corrigió contra las fuentes
 * reales de expo-modules-core SDK 57 (`askForPermissions(listener, ...)`
 * con `PermissionsResponseListener`/`PermissionsStatus`). En el primer build
 * real, comprobar sobre todo los hilos de `connect` y el registro de eventos.
 * Ver docs/BLUETOOTH.md.
 */
class NidoP2PModule : Module() {

  private val manager: NidoP2PManager by lazy {
    val ctx = appContext.reactContext
      ?: throw IllegalStateException("NidoP2P necesita un reactContext activo.")
    NidoP2PManager(ctx).also { m ->
      m.listener = object : NidoP2PManager.Listener {
        override fun onDeviceFound(address: String, name: String?) {
          sendEvent("onDeviceFound", mapOf("address" to address, "name" to name))
        }
        override fun onDiscoveryFinished() {
          sendEvent("onDiscoveryFinished", emptyMap<String, Any>())
        }
        override fun onConnected(address: String, name: String?, incoming: Boolean) {
          sendEvent(
            "onConnected",
            mapOf("address" to address, "name" to name, "incoming" to incoming),
          )
        }
        override fun onFrame(address: String, base64: String) {
          sendEvent("onFrame", mapOf("address" to address, "base64" to base64))
        }
        override fun onDisconnected(address: String) {
          sendEvent("onDisconnected", mapOf("address" to address))
        }
        override fun onError(message: String) {
          sendEvent("onError", mapOf("message" to message))
        }
      }
    }
  }

  /** Serializa las operaciones de socket fuera del hilo de JS. */
  private val io = Executors.newCachedThreadPool { r ->
    Thread(r, "nido-p2p-io").also { it.isDaemon = true }
  }

  override fun definition() = ModuleDefinition {
    Name("NidoP2P")

    Events(
      "onDeviceFound",
      "onDiscoveryFinished",
      "onConnected",
      "onFrame",
      "onDisconnected",
      "onError",
    )

    Function("getServiceUuid") { NidoP2PManager.SERVICE_UUID_STRING }

    Function("isBluetoothEnabled") {
      try {
        manager.isBluetoothEnabled()
      } catch (e: Exception) {
        false
      }
    }

    AsyncFunction("requestPermissions") { promise: Promise ->
      io.execute {
        try {
          val missing = manager.missingPermissions()
          if (missing.isEmpty()) {
            promise.resolve(true)
            return@execute
          }
          val perms = appContext.permissions
          if (perms == null) {
            promise.reject(
              "E_NO_PERMISSIONS",
              "Gestor de permisos no disponible. ¿Están bien vinculados los módulos Expo?",
              null,
            )
            return@execute
          }
          // La petición de permisos necesita una Activity viva.
          appContext.activityProvider?.currentActivity?.runOnUiThread {
            try {
              // API real de expo-modules-core (verificada contra SDK 57):
              // askForPermissions(PermissionsResponseListener, vararg String).
              // El listener es @FunctionalInterface: SAM conversion válida.
              perms.askForPermissions(
                PermissionsResponseListener { result ->
                  val granted = missing.all { result[it]?.status == PermissionsStatus.GRANTED }
                  promise.resolve(granted)
                },
                *missing.toTypedArray(),
              )
            } catch (e: Exception) {
              promise.reject("PERM_ERROR", "No se pudieron pedir permisos: ${e.message}", e)
            }
          } ?: promise.reject("E_NO_ACTIVITY", "Sin actividad para pedir permisos.", null)
        } catch (e: Exception) {
          promise.reject("PERM_ERROR", "No se pudieron pedir permisos: ${e.message}", e)
        }
      }
    }

    AsyncFunction("getBondedDevices") { promise: Promise ->
      io.execute {
        try {
          promise.resolve(manager.bondedDevices())
        } catch (e: Exception) {
          promise.reject("BT_ERROR", e.message, e)
        }
      }
    }

    AsyncFunction("startDiscovery") { promise: Promise ->
      io.execute {
        try {
          if (manager.startDiscovery()) promise.resolve(null)
          else promise.reject("BT_ERROR", "No se pudo iniciar el discovery.", null)
        } catch (e: Exception) {
          promise.reject("BT_ERROR", e.message, e)
        }
      }
    }

    AsyncFunction("stopDiscovery") { promise: Promise ->
      io.execute {
        try {
          manager.stopDiscovery()
          promise.resolve(null)
        } catch (e: Exception) {
          promise.reject("BT_ERROR", e.message, e)
        }
      }
    }

    /**
     * Solicita que el dispositivo sea visible (discoverable) para otros
     * dispositivos Bluetooth. Muestra el diálogo del sistema. Necesario
     * para que dos tablets NIDO se encuentren durante el emparejamiento.
     */
    AsyncFunction("requestDiscoverable") { promise: Promise ->
      try {
        val intent = android.content.Intent(android.bluetooth.BluetoothAdapter.ACTION_REQUEST_DISCOVERABLE).apply {
          putExtra(android.bluetooth.BluetoothAdapter.EXTRA_DISCOVERABLE_DURATION, 300)
          addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val ctx = appContext.reactContext ?: throw IllegalStateException("Sin reactContext")
        ctx.startActivity(intent)
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("BT_ERROR", e.message, e)
      }
    }

    AsyncFunction("startServer") { promise: Promise ->
      io.execute {
        try {
          // Foreground service PRIMERO: mantiene el proceso vivo (exento del
          // freezer de Android) mientras el servidor está activo. Sin esto,
          // accept() deja de responder ~30s después del background aunque el
          // kernel siga aceptando conexiones en el backlog.
          val ctx = appContext.reactContext ?: throw IllegalStateException("Sin reactContext")
          NidoP2PService.start(ctx)
          manager.startServer()
          promise.resolve(null)
        } catch (e: Exception) {
          promise.reject("BT_ERROR", e.message, e)
        }
      }
    }

    AsyncFunction("stopServer") { promise: Promise ->
      io.execute {
        try {
          manager.stopServer()
          // Detener el foreground service: ya no necesitamos mantener el
          // proceso vivo solo por P2P.
          val ctx = appContext.reactContext
          if (ctx != null) {
            NidoP2PService.stop(ctx)
          }
          promise.resolve(null)
        } catch (e: Exception) {
          promise.reject("BT_ERROR", e.message, e)
        }
      }
    }

    AsyncFunction("connect") { address: String, promise: Promise ->
      io.execute {
        try {
          val info = manager.connect(address) // bloqueante, con timeout del SO
          promise.resolve(info)
        } catch (e: Exception) {
          promise.reject("BT_CONNECT", e.message, e)
        }
      }
    }

    AsyncFunction("sendFrame") { address: String, base64: String, promise: Promise ->
      io.execute {
        try {
          val bytes = Base64.decode(base64, Base64.NO_WRAP)
          manager.sendFrame(address, bytes)
          promise.resolve(null)
        } catch (e: Exception) {
          promise.reject("BT_SEND", e.message, e)
        }
      }
    }

    AsyncFunction("disconnect") { address: String, promise: Promise ->
      io.execute {
        try {
          manager.disconnect(address)
          promise.resolve(null)
        } catch (e: Exception) {
          promise.reject("BT_ERROR", e.message, e)
        }
      }
    }

    AsyncFunction("shutdown") { promise: Promise ->
      io.execute {
        try {
          manager.shutdown()
          // Detener el foreground service en el apagado terminal.
          val ctx = appContext.reactContext
          if (ctx != null) {
            NidoP2PService.stop(ctx)
          }
          promise.resolve(null)
        } catch (e: Exception) {
          promise.reject("BT_ERROR", e.message, e)
        }
      }
    }
  }
}
