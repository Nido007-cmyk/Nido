/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

package expo.modules.nidop2p

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothServerSocket
import android.bluetooth.BluetoothSocket
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.util.Base64
import android.util.Log
import androidx.core.content.ContextCompat
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * NidoP2PManager — transporte Bluetooth RFCOMM de NIDO (lado nativo).
 *
 * Responsabilidades (y SOLO estas):
 *  - Servidor RFCOMM con el UUID de servicio de NIDO (acepta conexiones entrantes).
 *  - Cliente RFCOMM (conecta con un dispositivo por su dirección MAC).
 *  - Discovery Bluetooth clásico (lista dispositivos cercanos).
 *  - Framing: [u32 big-endian: longitud][payload], máx. 256 KB —
 *    idéntico al `FrameReassembler` de `src/p2p/protocol.ts`.
 *    El módulo reensambla y entrega frames COMPLETOS (base64) al lado JS;
 *    no interpreta el contenido (el cifrado/handshake vive en TypeScript).
 *
 * Decisiones de seguridad (documentadas también en docs/BLUETOOTH.md):
 *  - Se usa RFCOMM *inseguro* (sin emparejamiento del SO): la confianza de
 *    NIDO viene del emparejamiento por QR + su propia cripto (X25519 +
 *    secretbox). El emparejamiento del sistema pediría PINs y confundiría;
 *    no aporta nada una vez que el handshake de NIDO verifica al peer.
 *  - El módulo nunca guarda bytes más allá de entregarlos: cada frame
 *    completo se emite una vez y se olvida.
 */
class NidoP2PManager(private val context: Context) {

  interface Listener {
    fun onDeviceFound(address: String, name: String?)
    fun onDiscoveryFinished()
    fun onConnected(address: String, name: String?, incoming: Boolean)
    fun onFrame(address: String, base64: String)
    fun onDisconnected(address: String)
    fun onError(message: String)
  }

  companion object {
    /** UUID del servicio NIDO. Fijo y público; debe coincidir con el lado TS. */
    const val SERVICE_UUID_STRING = "8f3a1c2e-9b4d-4e5f-8a6b-7c9d0e1f2a3b"
    val SERVICE_UUID: UUID = UUID.fromString(SERVICE_UUID_STRING)

    /** Debe coincidir con MAX_FRAME_BYTES en src/p2p/protocol.ts. */
    const val MAX_FRAME_BYTES = 256 * 1024

    const val SERVICE_NAME = "NIDO-P2P"

    /** Tag de logcat para el diagnóstico del accept loop. */
    const val TAG = "NidoP2P"
  }

  var listener: Listener? = null

  private val adapter: BluetoothAdapter? by lazy {
    val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    manager?.adapter
  }

  private val connections = ConcurrentHashMap<String, Connection>()
  private var serverSocket: BluetoothServerSocket? = null
  private var acceptThread: Thread? = null
  /**
   * DIAG-2026-10-07: telemetría del accept loop. El síntoma "el dialer conecta
   * pero el listener no responde" corresponde a socket abierto sin hilo en
   * accept() (el kernel completa connect() contra el backlog). Estos
   * contadores permiten verificarlo desde la UI sin logcat.
   */
  private var acceptedCount: Int = 0
  private var lastAcceptAt: Long = 0L
  private var discoveryReceiver: BroadcastReceiver? = null
  private var adapterStateReceiver: BroadcastReceiver? = null

  init {
    // BUG-6 FIX: seed inicial del caché con la lista actual del adapter.
    seedBondedCache()
    registerAdapterStateReceiver()
  }

  /**
   * BUG-6 FIX: siembra el caché local con los dispositivos vinculados actuales.
   * Se llama al inicio y cuando Bluetooth se enciende (el stack re-sincroniza).
   */
  private fun seedBondedCache() {
    if (!hasConnectPermission()) return
    try {
      val devices = adapter?.bondedDevices ?: return
      synchronized(bondedMacCache) {
        for (d in devices) {
          val mac = d.address?.uppercase()
          if (!mac.isNullOrEmpty()) bondedMacCache.add(mac)
        }
      }
    } catch (_: Exception) { /* best-effort */ }
  }

  /**
   * BUG-6 FIX: cuando Bluetooth se apaga/enciende, el stack re-sincroniza
   * la lista de vinculados. Re-sembramos el caché en STATE_ON.
   */
  private fun registerAdapterStateReceiver() {
    if (adapterStateReceiver != null) return
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(ctx: Context?, intent: Intent?) {
        if (intent?.action != BluetoothAdapter.ACTION_STATE_CHANGED) return
        val state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1)
        if (state == BluetoothAdapter.STATE_ON) {
          seedBondedCache()
        }
      }
    }
    adapterStateReceiver = receiver
    val filter = IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
    if (Build.VERSION.SDK_INT >= 33) {
      context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
    } else {
      context.registerReceiver(receiver, filter)
    }
  }
  /**
   * BOND-LOSS-2026-10-07 (Android 16/API 36): receptor para detectar pérdida
   * de bond remota. En API 36+, el sistema emite ACTION_KEY_MISSING cuando
   * detecta que el peer perdió el bond; antes removía el bond silenciosamente.
   * Sin este receptor, un bond perdido causa "Handshake agotado" sin diagnóstico.
   */
  private var bondLossReceiver: BroadcastReceiver? = null
  /**
   * BUG-6 FIX 2026-10-07: caché local de MACs vinculadas.
   * `BluetoothAdapter.getBondedDevices()` devuelve el caché interno del adapter,
   * que puede estar desactualizado (ej: bonds creados mientras la app no recibía
   * broadcasts, o race en el inicio). El toggle de Bluetooth lo "arregla" porque
   * fuerza al stack a re-sincronizar. Este caché se actualiza con broadcasts
   * de BOND_BONDED/BOND_NONE y se fusiona con la lista del adapter en bondedDevices().
   */
  private val bondedMacCache: MutableSet<String> = mutableSetOf()

  // ------------------------------------------------------------ estado

  fun isBluetoothEnabled(): Boolean = try {
    adapter?.isEnabled == true
  } catch (e: Exception) {
    false
  }

  /** Permisos que faltan para operar (según nivel de API). */
  fun missingPermissions(): List<String> {
    val needed = mutableListOf<String>()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      needed.add(Manifest.permission.BLUETOOTH_CONNECT)
      needed.add(Manifest.permission.BLUETOOTH_SCAN)
    } else {
      // En API < 31 el discovery exige permiso de ubicación.
      needed.add(Manifest.permission.ACCESS_FINE_LOCATION)
    }
    // Android 13+ (API 33): el foreground service necesita mostrar su
    // notificación persistente.
    if (Build.VERSION.SDK_INT >= 33) {
      needed.add(Manifest.permission.POST_NOTIFICATIONS)
    }
    return needed.filter {
      ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED
    }
  }

  fun hasConnectPermission(): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      ContextCompat.checkSelfPermission(
        context, Manifest.permission.BLUETOOTH_CONNECT,
      ) == PackageManager.PERMISSION_GRANTED
    } else {
      true
    }

  // ------------------------------------------------------------ discovery

  fun startDiscovery(): Boolean {
    val bt = adapter ?: run {
      listener?.onError("Bluetooth no disponible en este dispositivo.")
      return false
    }
    if (!hasConnectPermission()) {
      listener?.onError("Falta el permiso BLUETOOTH_SCAN/ubicación para descubrir dispositivos.")
      return false
    }
    try {
      if (bt.isDiscovering) bt.cancelDiscovery()
    } catch (e: Exception) {
      listener?.onError("No se pudo reiniciar el discovery: ${e.message}")
      return false
    }
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
          BluetoothDevice.ACTION_FOUND -> {
            val device: BluetoothDevice? =
              intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
            if (device != null) {
              listener?.onDeviceFound(device.address, device.name)
            }
          }
          BluetoothAdapter.ACTION_DISCOVERY_FINISHED -> {
            listener?.onDiscoveryFinished()
            unregisterDiscoveryReceiver()
          }
        }
      }
    }
    discoveryReceiver = receiver
    val filter = IntentFilter().apply {
      addAction(BluetoothDevice.ACTION_FOUND)
      addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED)
    }
    // FIX-BRIAR-1.5.15: En Android 13+ (API 33), registerReceiver() exige
    // especificar RECEIVER_EXPORTED o RECEIVER_NOT_EXPORTED. Los broadcasts
    // de Bluetooth (ACTION_FOUND, ACTION_DISCOVERY_FINISHED) los envía el
    // SISTEMA, no la app, así que el receptor debe ser EXPORTED. Sin esto,
    // el discovery falla silenciosamente y las tablets no se ven entre sí.
    if (Build.VERSION.SDK_INT >= 33) {
      context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
    } else {
      context.registerReceiver(receiver, filter)
    }
    return try {
      bt.startDiscovery()
    } catch (e: Exception) {
      unregisterDiscoveryReceiver()
      listener?.onError("No se pudo iniciar el discovery: ${e.message}")
      false
    }
  }

  fun stopDiscovery() {
    try {
      adapter?.cancelDiscovery()
    } catch (_: Exception) {
    }
    unregisterDiscoveryReceiver()
  }

  private fun unregisterDiscoveryReceiver() {
    val receiver = discoveryReceiver ?: return
    discoveryReceiver = null
    try {
      context.unregisterReceiver(receiver)
    } catch (_: Exception) {
      // Ya desregistrado; no pasa nada.
    }
  }

  /**
   * BOND-LOSS-2026-10-07: registra receptor para ACTION_KEY_MISSING (API 36+)
   * y ACTION_BOND_STATE_CHANGED. Cuando el sistema detecta bond perdido,
   * se notifica al listener para que el transporte marque la ruta como
   * sospechosa en vez de reintentar el handshake ciegamente.
   */
  private fun registerBondLossReceiver() {
    if (bondLossReceiver != null) return
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(ctx: Context?, intent: Intent?) {
        if (intent == null) return
        val device: BluetoothDevice? = if (Build.VERSION.SDK_INT >= 33) {
          intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
        } else {
          @Suppress("DEPRECATION")
          intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
        }
        val addr = device?.address ?: return
        when (intent.action) {
          // API 36+: el sistema retiene el bond local y avisa.
          "android.bluetooth.device.action.KEY_MISSING" -> {
            listener?.onError("Bond perdido con $addr: re-pairea en Ajustes Bluetooth.")
            // Cierra cualquier conexión stale con este dispositivo.
            connections.remove(addr)?.close()
          }
          BluetoothDevice.ACTION_BOND_STATE_CHANGED -> {
            val state = intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, -1)
            if (state == BluetoothDevice.BOND_NONE) {
              listener?.onError("Dispositivo $addr desvinculado.")
              connections.remove(addr)?.close()
              // BUG-6 FIX: remover del caché local.
              synchronized(bondedMacCache) { bondedMacCache.remove(addr.uppercase()) }
            } else if (state == BluetoothDevice.BOND_BONDED) {
              // BUG-6 FIX: agregar al caché local. El adapter puede no
              // reflejarlo inmediatamente en getBondedDevices().
              synchronized(bondedMacCache) { bondedMacCache.add(addr.uppercase()) }
            }
          }
        }
      }
    }
    bondLossReceiver = receiver
    val filter = IntentFilter().apply {
      addAction(BluetoothDevice.ACTION_BOND_STATE_CHANGED)
      // ACTION_KEY_MISSING solo existe en API 36+; agregarlo en versiones
      // anteriores es inofensivo (nunca se emite).
      addAction("android.bluetooth.device.action.KEY_MISSING")
    }
    if (Build.VERSION.SDK_INT >= 33) {
      context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
    } else {
      context.registerReceiver(receiver, filter)
    }
  }

  private fun unregisterBondLossReceiver() {
    val receiver = bondLossReceiver ?: return
    bondLossReceiver = null
    try {
      context.unregisterReceiver(receiver)
    } catch (_: Exception) {
      // Ya desregistrado; no pasa nada.
    }
  }

  fun bondedDevices(): List<Map<String, String?>> {
    if (!hasConnectPermission()) return emptyList()
    return try {
      val fromAdapter = adapter?.bondedDevices?.map { device ->
        mapOf("address" to device.address, "name" to device.name)
      } ?: emptyList()
      // BUG-6 FIX: fusionar con el caché local (actualizado por broadcasts).
      // Elimina duplicados por MAC (case-insensitive).
      val seen = mutableSetOf<String>()
      val merged = mutableListOf<Map<String, String?>>()
      for (entry in fromAdapter) {
        val mac = (entry["address"] ?: "").uppercase()
        if (mac.isNotEmpty() && seen.add(mac)) merged.add(entry)
      }
      synchronized(bondedMacCache) {
        for (mac in bondedMacCache) {
          if (seen.add(mac)) {
            merged.add(mapOf("address" to mac, "name" to null))
          }
        }
      }
      merged
    } catch (e: Exception) {
      listener?.onError("No se pudieron leer los dispositivos vinculados: ${e.message}")
      emptyList()
    }
  }

  // ------------------------------------------------------------ servidor

  /** Idempotente: si ya hay un servidor, no hace nada. */
  @Synchronized
  fun startServer() {
    if (acceptThread?.isAlive == true) {
      Log.d(TAG, "startServer: el accept loop ya está vivo; no se reinicia.")
      return
    }
    val bt = adapter ?: throw IOException("Bluetooth no disponible.")
    if (!bt.isEnabled) throw IOException("El Bluetooth está apagado.")
    if (!hasConnectPermission()) throw IOException("Falta el permiso BLUETOOTH_CONNECT.")
    registerBondLossReceiver()
    val server = bt.listenUsingInsecureRfcommWithServiceRecord(SERVICE_NAME, SERVICE_UUID)
    serverSocket = server
    Log.i(TAG, "startServer: server socket abierto, iniciando accept loop.")
    acceptThread = Thread({
      Log.i(TAG, "accept loop: hilo iniciado, bloqueado en accept().")
      try {
        while (!Thread.currentThread().isInterrupted) {
          try {
            val socket = server.accept() // bloqueante
            onSocketAccepted(socket, incoming = true)
          } catch (e: IOException) {
            // accept() lanza al cerrar el serverSocket en stopServer(): salida normal.
            Log.i(TAG, "accept loop: salida por IOException (cierre normal).")
            break
          } catch (e: Exception) {
            listener?.onError("Error aceptando conexión: ${e.message}")
          }
        }
      } catch (e: Throwable) {
        // DIAG-2026-10-07: un Error (no Exception) mataría el hilo en
        // silencio dejando el socket abierto sin nadie en accept(). Se
        // registra para que el diagnóstico lo capture.
        Log.e(TAG, "accept loop: muerte por Throwable no capturado.", e)
      } finally {
        Log.w(TAG, "accept loop: hilo terminado.")
      }
    }, "nido-p2p-accept").also { it.start() }
  }

  @Synchronized
  fun stopServer() {
    acceptThread?.interrupt()
    acceptThread = null
    unregisterBondLossReceiver()
    try {
      serverSocket?.close()
    } catch (_: Exception) {
    }
    serverSocket = null
    Log.i(TAG, "stopServer: accept loop detenido y server socket cerrado.")
  }

  /**
   * DIAG-2026-10-07: ¿hay un hilo vivo bloqueado en accept()? La notificación
   * del foreground service NO lo garantiza: solo prueba que el servicio está
   * en primer plano, no que el servidor escucha.
   */
  @Synchronized
  fun isServerAlive(): Boolean = acceptThread?.isAlive == true && serverSocket != null

  /**
   * DIAG-2026-10-07: estado del servidor para la UI de diagnóstico.
   * Claves: alive (Boolean), acceptedCount (Int), lastAcceptAt (Long, epoch ms).
   */
  @Synchronized
  fun getServerStatus(): Map<String, Any> = mapOf(
    "alive" to isServerAlive(),
    "acceptedCount" to acceptedCount,
    "lastAcceptAt" to lastAcceptAt,
  )

  // ------------------------------------------------------------ cliente

  /** Conecta con un dispositivo por MAC. Bloqueante: llamar fuera del hilo principal. */
  @Throws(IOException::class)
  fun connect(address: String): Map<String, String?> {
    val bt = adapter ?: throw IOException("Bluetooth no disponible.")
    if (!bt.isEnabled) throw IOException("El Bluetooth está apagado.")
    if (!hasConnectPermission()) throw IOException("Falta el permiso BLUETOOTH_CONNECT.")
    val device = try {
      bt.getRemoteDevice(address)
    } catch (e: Exception) {
      throw IOException("Dirección Bluetooth inválida: $address")
    }
    // El discovery activo degrada/rompe las conexiones: se cancela primero.
    try {
      if (bt.isDiscovering) bt.cancelDiscovery()
    } catch (_: Exception) {
    }
    // Cierra una conexión previa con el mismo dispositivo, si la hay.
    connections.remove(address)?.close()
    val socket = device.createInsecureRfcommSocketToServiceRecord(SERVICE_UUID)
    // WATCHDOG-2026-10-07: `socket.connect()` es bloqueante sin timeout
    // configurable; el SO tarda 10-20s en fallar. Un watchdog de 7s cierra
    // el socket desde otro hilo para fallar rápido y permitir reintento
    // con backoff (ver fdittgen-png/tankstellen#3348: el canal RFCOMM puede
    // quedar ocupado por una sesión caída).
    val watchdog = Thread {
      try {
        Thread.sleep(7000)
        try {
          socket.close()
        } catch (_: Exception) {
        }
      } catch (_: InterruptedException) {
        // connect() terminó antes: el watchdog se cancela.
      }
    }
    watchdog.isDaemon = true
    watchdog.start()
    try {
      socket.connect() // bloqueante (watchdog de 7s arriba)
    } catch (e: NullPointerException) {
      // GUARD-BRIAR-2026-10-07: Briar documenta NPE dentro de
      // BluetoothSocket.connect() en ciertos stacks (Huawei). Se envuelve
      // en IOException para manejo uniforme.
      try {
        socket.close()
      } catch (_: Exception) {
      }
      throw IOException("NPE interno en connect() con $address (stack del OEM).")
    } catch (e: IOException) {
      try {
        socket.close()
      } catch (_: Exception) {
      }
      // Diagnóstico: incluir estado del bond y del adaptador para triage.
      // "read failed" es genérico por diseño; sin este contexto no se puede
      // distinguir peer apagado vs socket stale vs fallo SDP.
      val bondState = try {
        when (device.bondState) {
          BluetoothDevice.BOND_BONDED -> "bonded"
          BluetoothDevice.BOND_BONDING -> "bonding"
          else -> "none"
        }
      } catch (_: SecurityException) {
        "unknown(no-perm)"
      }
      throw IOException(
        "No se pudo conectar con $address: ${e.message} " +
          "[bond=$bondState, discovering=${bt.isDiscovering}]",
      )
    } finally {
      watchdog.interrupt()
    }
    onSocketAccepted(socket, incoming = false)
    return mapOf("address" to device.address, "name" to device.name)
  }

  // ------------------------------------------------------------ E/S

  /**
   * F-7: serializa el reemplazo de conexión (remove/close/put) bajo un solo
   * lock. `onSocketAccepted` corre en dos hilos (accept entrante y pool `io`
   * de `connect()` saliente); sin esto, el intercalado remove/remove/put/put
   * dejaba un socket zombie sin cerrar cuyo `onDisconnected` tardío podía
   * desmontar la ruta viva del reemplazo.
   */
  @Synchronized
  private fun onSocketAccepted(socket: BluetoothSocket, incoming: Boolean) {
    val address = try {
      socket.remoteDevice.address
    } catch (e: Exception) {
      listener?.onError("Conexión sin dirección remota: ${e.message}")
      try {
        socket.close()
      } catch (_: Exception) {
      }
      return
    }
    // Una sola conexión por dirección: la nueva sustituye a la vieja.
    connections.remove(address)?.close()
    val conn = Connection(address, socket)
    connections[address] = conn
    conn.start()
    // DIAG-2026-10-07: telemetría del accept.
    acceptedCount++
    lastAcceptAt = System.currentTimeMillis()
    Log.i(TAG, "accept: conexión #$acceptedCount aceptada de $address (incoming=$incoming).")
    val name = try {
      socket.remoteDevice.name
    } catch (_: Exception) {
      null
    }
    listener?.onConnected(address, name, incoming)
  }

  @Throws(IOException::class)
  fun sendFrame(address: String, payload: ByteArray) {
    val conn = connections[address] ?: throw IOException("Sin conexión con $address.")
    if (payload.isEmpty() || payload.size > MAX_FRAME_BYTES) {
      throw IOException("Frame de tamaño inválido: ${payload.size} bytes.")
    }
    conn.writeFrame(payload)
  }

  /**
   * F-7: solo emite `onDisconnected` cuando se retiró una conexión real del
   * mapa. Un `disconnect()` sobre una dirección sin conexión ya no finge
   * una desconexión al lado TS.
   */
  fun disconnect(address: String) {
    val conn = connections.remove(address) ?: return
    conn.close()
    listener?.onDisconnected(address)
  }

  /**
   * F-7: callback de muerte de una conexión (desde su propio hilo lector).
   * SOLO la instancia que actualmente posee la ruta puede limpiarla:
   * `ConcurrentHashMap.remove(key, value)` es atómico, así que un socket
   * superseded (zombie) que muera tarde no puede retirar ni emitir por la
   * conexión de reemplazo. Sus callbacks son inofensivos.
   */
  private fun onConnectionClosed(conn: Connection) {
    if (connections.remove(conn.address, conn)) {
      listener?.onDisconnected(conn.address)
    }
  }

  /**
   * Apagado total: detiene discovery y servidor y CIERRA todos los sockets
   * RFCOMM activos. `connections.clear()` por sí solo no basta: hay que
   * llamar a `Connection.close()` en cada una (cierra el socket e
   * interrumpe su hilo lector); de lo contrario los sockets sobrevivirían
   * al apagado a nivel de SO aunque el mapa quede vacío.
   * Idempotente: `Connection.close()` ya es idempotente y con cero
   * conexiones el bucle no hace nada.
   */
  fun shutdown() {
    stopDiscovery()
    stopServer()
    // F-7: retirar por dirección con remove() atómico por entrada: si el
    // hilo lector de una conexión muere a la vez, solo uno de los dos
    // (shutdown u onConnectionClosed) retira la entrada y emite
    // onDisconnected — exactamente una vez por conexión.
    for (address in connections.keys.toList()) {
      val conn = connections.remove(address) ?: continue
      try {
        conn.close()
      } catch (_: Exception) {
      }
      try {
        listener?.onDisconnected(address)
      } catch (_: Exception) {
      }
    }
  }

  // ------------------------------------------------------------ conexión

  /**
   * F-7: inner class para poder llamar a `onConnectionClosed(this)` del
   * manager. La muerte de un socket (readLoop/finally) ya NO emite
   * `onDisconnected` directamente: pasa por el chequeo de propiedad, así
   * que un socket viejo muerto tarde no puede desmontar la ruta viva de su
   * reemplazo. `onFrame`/`onError` de un socket viejo siguen siendo
   * informativos: el lado TS atribuye frames por MAC y la cripto de sesión
   * rechaza los que no correspondan (availability, no ruptura cripto).
   */
  private inner class Connection(
    val address: String,
    private val socket: BluetoothSocket,
  ) {
    private val readerThread = Thread({ readLoop() }, "nido-p2p-read-$address")
    @Volatile private var closed = false

    fun start() = readerThread.start()

    fun close() {
      if (closed) return
      closed = true
      readerThread.interrupt()
      try {
        socket.close()
      } catch (_: Exception) {
      }
    }

    /** Escribe [u32 BE longitud][payload] de forma atómica por conexión. */
    @Synchronized
    fun writeFrame(payload: ByteArray) {
      if (closed) throw IOException("Conexión cerrada ($address).")
      // GUARD-BRIAR-2026-10-07: los streams pueden ser null o lanzar si el
      // socket se cerró concurrentemente. Briar hace null-check explícito.
      val out = try {
        socket.outputStream
      } catch (e: Exception) {
        throw IOException("Stream de escritura no disponible ($address): ${e.message}")
      } ?: throw IOException("Stream de escritura null ($address).")
      val header = ByteArray(4)
      header[0] = (payload.size ushr 24).toByte()
      header[1] = (payload.size ushr 16).toByte()
      header[2] = (payload.size ushr 8).toByte()
      header[3] = payload.size.toByte()
      out.write(header)
      out.write(payload)
      out.flush()
    }

    private fun readLoop() {
      try {
        val input = socket.inputStream
        val header = ByteArray(4)
        while (!closed && !Thread.currentThread().isInterrupted) {
          readFully(input, header, 0, 4)
          val bodyLen = ((header[0].toInt() and 0xff) shl 24) or
            ((header[1].toInt() and 0xff) shl 16) or
            ((header[2].toInt() and 0xff) shl 8) or
            (header[3].toInt() and 0xff)
          if (bodyLen <= 0 || bodyLen > MAX_FRAME_BYTES) {
            listener?.onError("Frame inválido de $address (${bodyLen} bytes): conexión cerrada.")
            break
          }
          val body = ByteArray(bodyLen)
          readFully(input, body, 0, bodyLen)
          listener?.onFrame(address, Base64.encodeToString(body, Base64.NO_WRAP))
        }
      } catch (e: IOException) {
        // Cierre normal del socket (o peer desconectado): no es un error a reportar.
      } catch (e: Exception) {
        listener?.onError("Error leyendo de $address: ${e.message}")
      } finally {
        close()
        // F-7: solo la instancia dueña de la ruta emite/limpia.
        onConnectionClosed(this)
      }
    }

    private fun readFully(
      input: java.io.InputStream,
      buffer: ByteArray,
      offset: Int,
      length: Int,
    ) {
      var read = 0
      while (read < length) {
        val n = input.read(buffer, offset + read, length - read)
        if (n < 0) throw IOException("Fin del stream.")
        read += n
      }
    }
  }
}
