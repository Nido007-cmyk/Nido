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
  }

  var listener: Listener? = null

  private val adapter: BluetoothAdapter? by lazy {
    val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    manager?.adapter
  }

  private val connections = ConcurrentHashMap<String, Connection>()
  private var serverSocket: BluetoothServerSocket? = null
  private var acceptThread: Thread? = null
  private var discoveryReceiver: BroadcastReceiver? = null

  // ------------------------------------------------------------ estado

  fun isBluetoothEnabled(): Boolean = try {
    adapter?.isEnabled == true
  } catch (e: Exception) {
    false
  }

  /** Permisos que faltan para operar (según nivel de API). */
  fun missingPermissions(): List<String> {
    val needed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      listOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN)
    } else {
      // En API < 31 el discovery exige permiso de ubicación.
      listOf(Manifest.permission.ACCESS_FINE_LOCATION)
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
    context.registerReceiver(receiver, filter)
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

  fun bondedDevices(): List<Map<String, String?>> {
    if (!hasConnectPermission()) return emptyList()
    return try {
      adapter?.bondedDevices?.map { device ->
        mapOf("address" to device.address, "name" to device.name)
      } ?: emptyList()
    } catch (e: Exception) {
      listener?.onError("No se pudieron leer los dispositivos vinculados: ${e.message}")
      emptyList()
    }
  }

  // ------------------------------------------------------------ servidor

  /** Idempotente: si ya hay un servidor, no hace nada. */
  @Synchronized
  fun startServer() {
    if (acceptThread?.isAlive == true) return
    val bt = adapter ?: throw IOException("Bluetooth no disponible.")
    if (!bt.isEnabled) throw IOException("El Bluetooth está apagado.")
    if (!hasConnectPermission()) throw IOException("Falta el permiso BLUETOOTH_CONNECT.")
    val server = bt.listenUsingInsecureRfcommWithServiceRecord(SERVICE_NAME, SERVICE_UUID)
    serverSocket = server
    acceptThread = Thread({
      while (!Thread.currentThread().isInterrupted) {
        try {
          val socket = server.accept() // bloqueante
          onSocketAccepted(socket, incoming = true)
        } catch (e: IOException) {
          // accept() lanza al cerrar el serverSocket en stopServer(): salida normal.
          break
        } catch (e: Exception) {
          listener?.onError("Error aceptando conexión: ${e.message}")
        }
      }
    }, "nido-p2p-accept").also { it.start() }
  }

  @Synchronized
  fun stopServer() {
    acceptThread?.interrupt()
    acceptThread = null
    try {
      serverSocket?.close()
    } catch (_: Exception) {
    }
    serverSocket = null
  }

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
    try {
      socket.connect() // bloqueante (timeout interno del SO, ~10-20 s)
    } catch (e: IOException) {
      try {
        socket.close()
      } catch (_: Exception) {
      }
      throw IOException("No se pudo conectar con $address: ${e.message}")
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
      val out = socket.outputStream
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
