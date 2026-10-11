/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

package expo.modules.nidop2p

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.util.Base64
import android.util.Log
import java.io.IOException
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap

/**
 * NidoLanManager — transporte de RESPALDO por Wi-Fi local (TCP + mDNS/NSD).
 *
 * Se usa cuando Bluetooth falla: ambos teléfonos en la misma red Wi-Fi, o
 * uno compartiendo hotspot (funciona sin internet). Igual que el transporte
 * Bluetooth, SOLO mueve bytes: emite los mismos eventos (onConnected,
 * onFrame, onDisconnected) con direcciones "LAN:<ipv4>:<puerto>", así que
 * el handshake HELLO/CONFIRM, el cifrado de sesión y la anti-replay de
 * `src/p2p/` se reutilizan sin cambios. Transporte ≠ confianza.
 *
 * Decisiones de seguridad y privacidad (docs/TRANSPORT_ARCHITECTURE.md §5):
 *  - Solo red LOCAL: se rechaza cualquier dirección que no sea IPv4 privada
 *    (10/8, 172.16/12, 192.168/16) o link-local (169.254/16), tanto al
 *    conectar como al aceptar. Este transporte nunca puede llegar a internet.
 *  - El anuncio mDNS usa un nombre ALEATORIO por arranque ("nido-xxxxxxxx"),
 *    nunca la identidad. Sin registros TXT.
 *  - El servidor y el anuncio solo viven mientras la pantalla de enlace
 *    busca peers (startLan/stopLan). Las conexiones ya establecidas siguen.
 *  - Máximo [MAX_CONNECTIONS] conexiones simultáneas; frames con el mismo
 *    tope que Bluetooth (256 KB). El handshake en JS limita la frecuencia
 *    por IP y descarta en 15 s lo que no hable NIDO.
 */
class NidoLanManager(
  private val context: Context,
  private val listener: () -> NidoP2PManager.Listener?,
) {

  companion object {
    /** Tipo de servicio DNS-SD. Fijo y genérico: no identifica a nadie. */
    const val SERVICE_TYPE = "_nidop2p._tcp."
    const val ADDRESS_PREFIX = "LAN:"
    const val CONNECT_TIMEOUT_MS = 5_000
    const val MAX_CONNECTIONS = 8
    const val TAG = "NidoLan"

    private val ADDRESS_RE = Regex("^LAN:(\\d{1,3}(?:\\.\\d{1,3}){3}):(\\d{1,5})$")

    fun isLanAddress(address: String): Boolean = address.startsWith(ADDRESS_PREFIX)

    /** true si la IPv4 es privada o link-local (nunca internet). */
    fun isLocalIpv4(addr: InetAddress): Boolean =
      addr is Inet4Address && (addr.isSiteLocalAddress || addr.isLinkLocalAddress)

    fun formatAddress(addr: InetAddress, port: Int): String =
      "$ADDRESS_PREFIX${addr.hostAddress}:$port"
  }

  private val nsd: NsdManager? by lazy {
    context.getSystemService(Context.NSD_SERVICE) as? NsdManager
  }
  private val random = SecureRandom()

  private val connections = ConcurrentHashMap<String, LanConnection>()
  @Volatile private var server: ServerSocket? = null
  private var acceptThread: Thread? = null

  private var registrationListener: NsdManager.RegistrationListener? = null
  @Volatile private var registeredName: String? = null
  private var discoveryListener: NsdManager.DiscoveryListener? = null
  private var multicastLock: WifiManager.MulticastLock? = null

  /** Android antiguo solo admite un resolveService a la vez: cola propia. */
  private val resolveQueue = ArrayDeque<NsdServiceInfo>()
  private var resolving = false

  // ------------------------------------------------------------ ciclo de vida

  /** Arranca servidor + anuncio + descubrimiento. Idempotente. */
  @Synchronized
  fun start() {
    if (server == null) startServer()
    if (registrationListener == null) registerService()
    if (discoveryListener == null) startNsdDiscovery()
  }

  /**
   * Detiene descubrimiento, anuncio y servidor. Las conexiones YA
   * establecidas siguen vivas (como la ruta Bluetooth al salir de la
   * pantalla de enlace).
   */
  @Synchronized
  fun stop() {
    stopNsdDiscovery()
    unregisterService()
    stopServer()
  }

  /** Apagado total: también cierra las conexiones activas. */
  fun shutdown() {
    stop()
    for (address in connections.keys.toList()) {
      val conn = connections.remove(address) ?: continue
      try {
        conn.close()
      } catch (_: Exception) {
      }
      try {
        listener()?.onDisconnected(address)
      } catch (_: Exception) {
      }
    }
  }

  fun status(): Map<String, Any?> = mapOf(
    "active" to (server != null),
    "port" to (server?.localPort ?: 0),
    "connections" to connections.size,
  )

  // ------------------------------------------------------------ servidor

  private fun startServer() {
    val s = ServerSocket()
    s.reuseAddress = true
    s.bind(InetSocketAddress(0)) // puerto efímero
    server = s
    val t = Thread({ acceptLoop(s) }, "nido-lan-accept")
    t.isDaemon = true
    acceptThread = t
    t.start()
    Log.i(TAG, "servidor LAN escuchando en el puerto ${s.localPort}")
  }

  private fun stopServer() {
    val s = server
    server = null
    try {
      s?.close()
    } catch (_: Exception) {
    }
    acceptThread?.interrupt()
    acceptThread = null
  }

  private fun acceptLoop(s: ServerSocket) {
    while (!s.isClosed) {
      val socket = try {
        s.accept()
      } catch (e: IOException) {
        break // servidor cerrado
      }
      val remote = socket.inetAddress
      if (remote == null || !isLocalIpv4(remote)) {
        Log.w(TAG, "conexión rechazada: dirección no local")
        closeQuietly(socket)
        continue
      }
      if (connections.size >= MAX_CONNECTIONS) {
        Log.w(TAG, "conexión rechazada: tope de $MAX_CONNECTIONS conexiones")
        closeQuietly(socket)
        continue
      }
      onSocket(socket, formatAddress(remote, socket.port), incoming = true)
    }
  }

  // ------------------------------------------------------------ cliente

  /**
   * Conecta con "LAN:<ipv4>:<puerto>". Bloqueante (timeout 5 s); llamar
   * fuera del hilo de JS. Solo admite direcciones de red local.
   */
  @Throws(IOException::class)
  fun connect(address: String): Map<String, String?> {
    val m = ADDRESS_RE.matchEntire(address)
      ?: throw IOException("Dirección Wi-Fi local inválida: $address")
    val host = m.groupValues[1]
    val port = m.groupValues[2].toInt()
    if (port !in 1..65535) throw IOException("Puerto inválido: $port")
    if (host.split('.').any { it.toInt() > 255 }) throw IOException("IP inválida: $host")
    // IP literal: getByName no consulta DNS.
    val ip = InetAddress.getByName(host)
    if (!isLocalIpv4(ip)) throw IOException("Solo se permiten direcciones de la red local.")
    if (connections.size >= MAX_CONNECTIONS) throw IOException("Demasiadas conexiones Wi-Fi activas.")
    val socket = Socket()
    try {
      socket.connect(InetSocketAddress(ip, port), CONNECT_TIMEOUT_MS)
    } catch (e: IOException) {
      closeQuietly(socket)
      throw IOException("No se pudo conectar por Wi-Fi local ($host:$port): ${e.message}")
    }
    onSocket(socket, address, incoming = false)
    return mapOf("address" to address, "name" to null)
  }

  @Synchronized
  private fun onSocket(socket: Socket, address: String, incoming: Boolean) {
    try {
      socket.tcpNoDelay = true
      socket.keepAlive = true
    } catch (_: Exception) {
    }
    // Una conexión por dirección: la nueva sustituye a la vieja.
    connections.remove(address)?.close()
    val conn = LanConnection(address, socket)
    connections[address] = conn
    conn.start()
    Log.i(TAG, "conexión LAN ${if (incoming) "entrante" else "saliente"}: $address")
    listener()?.onConnected(address, null, incoming)
  }

  @Throws(IOException::class)
  fun sendFrame(address: String, payload: ByteArray) {
    val conn = connections[address] ?: throw IOException("Sin conexión con $address.")
    if (payload.isEmpty() || payload.size > NidoP2PManager.MAX_FRAME_BYTES) {
      throw IOException("Frame de tamaño inválido: ${payload.size} bytes.")
    }
    conn.writeFrame(payload)
  }

  fun disconnect(address: String) {
    val conn = connections.remove(address) ?: return
    conn.close()
    listener()?.onDisconnected(address)
  }

  private fun onConnectionClosed(conn: LanConnection) {
    if (connections.remove(conn.address, conn)) {
      listener()?.onDisconnected(conn.address)
    }
  }

  // ------------------------------------------------------------ mDNS / NSD

  private fun randomServiceName(): String {
    val b = ByteArray(4)
    random.nextBytes(b)
    return "nido-" + b.joinToString("") { "%02x".format(it.toInt() and 0xff) }
  }

  private fun registerService() {
    val mgr = nsd ?: return
    val localPort = server?.localPort ?: return
    // Ojo: dentro de apply, `port` sería la propiedad del NsdServiceInfo;
    // por eso la variable externa se llama localPort.
    val info = NsdServiceInfo().apply {
      serviceName = randomServiceName()
      serviceType = SERVICE_TYPE
      port = localPort
    }
    val l = object : NsdManager.RegistrationListener {
      override fun onServiceRegistered(registered: NsdServiceInfo) {
        // El sistema puede renombrar ante un conflicto: guardar el final
        // para no descubrirnos a nosotros mismos.
        registeredName = registered.serviceName
      }
      override fun onRegistrationFailed(i: NsdServiceInfo, errorCode: Int) {
        Log.w(TAG, "registro mDNS fallido ($errorCode)")
        synchronized(this@NidoLanManager) {
          if (registrationListener === this) registrationListener = null
        }
      }
      override fun onServiceUnregistered(i: NsdServiceInfo) {}
      override fun onUnregistrationFailed(i: NsdServiceInfo, errorCode: Int) {}
    }
    registrationListener = l
    registeredName = info.serviceName
    try {
      mgr.registerService(info, NsdManager.PROTOCOL_DNS_SD, l)
    } catch (e: Exception) {
      registrationListener = null
      Log.w(TAG, "no se pudo anunciar por mDNS: ${e.message}")
    }
  }

  private fun unregisterService() {
    val l = registrationListener ?: return
    registrationListener = null
    registeredName = null
    try {
      nsd?.unregisterService(l)
    } catch (_: Exception) {
    }
  }

  private fun startNsdDiscovery() {
    val mgr = nsd ?: return
    acquireMulticastLock()
    val l = object : NsdManager.DiscoveryListener {
      override fun onDiscoveryStarted(serviceType: String) {}
      override fun onDiscoveryStopped(serviceType: String) {}
      override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
        Log.w(TAG, "descubrimiento mDNS fallido ($errorCode)")
        synchronized(this@NidoLanManager) {
          if (discoveryListener === this) discoveryListener = null
        }
        releaseMulticastLock()
      }
      override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
      override fun onServiceFound(info: NsdServiceInfo) {
        if (!info.serviceType.contains("_nidop2p._tcp")) return
        if (info.serviceName == registeredName) return // soy yo
        enqueueResolve(info)
      }
      override fun onServiceLost(info: NsdServiceInfo) {}
    }
    discoveryListener = l
    try {
      mgr.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, l)
    } catch (e: Exception) {
      discoveryListener = null
      releaseMulticastLock()
      Log.w(TAG, "no se pudo buscar por mDNS: ${e.message}")
    }
  }

  private fun stopNsdDiscovery() {
    val l = discoveryListener
    discoveryListener = null
    if (l != null) {
      try {
        nsd?.stopServiceDiscovery(l)
      } catch (_: Exception) {
      }
    }
    synchronized(resolveQueue) {
      resolveQueue.clear()
    }
    releaseMulticastLock()
  }

  private fun enqueueResolve(info: NsdServiceInfo) {
    synchronized(resolveQueue) {
      if (resolveQueue.size >= 16) return // cota: no crecer sin límite
      resolveQueue.addLast(info)
      if (resolving) return
      resolving = true
    }
    resolveNext()
  }

  private fun resolveNext() {
    val next = synchronized(resolveQueue) {
      val n = resolveQueue.removeFirstOrNull()
      if (n == null) resolving = false
      n
    } ?: return
    val mgr = nsd
    if (mgr == null) {
      synchronized(resolveQueue) { resolving = false }
      return
    }
    try {
      @Suppress("DEPRECATION")
      mgr.resolveService(next, object : NsdManager.ResolveListener {
        override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
          resolveNext()
        }
        override fun onServiceResolved(info: NsdServiceInfo) {
          try {
            @Suppress("DEPRECATION")
            val host = info.host
            val port = info.port
            if (host != null && isLocalIpv4(host) && port in 1..65535 && !isMyself(host, port)) {
              listener()?.onDeviceFound(formatAddress(host, port), "NIDO Wi-Fi")
            }
          } catch (_: Exception) {
          }
          resolveNext()
        }
      })
    } catch (e: Exception) {
      resolveNext()
    }
  }

  /** Descarta nuestro propio servicio si el sistema lo devuelve igualmente. */
  private fun isMyself(host: InetAddress, port: Int): Boolean {
    if (port != server?.localPort) return false
    return try {
      NetworkInterface.getNetworkInterfaces()?.toList().orEmpty().any { ni ->
        ni.inetAddresses.toList().any { it == host }
      }
    } catch (_: Exception) {
      false
    }
  }

  private fun acquireMulticastLock() {
    if (multicastLock != null) return
    try {
      val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
      multicastLock = wifi?.createMulticastLock("nido-lan")?.apply {
        setReferenceCounted(false)
        acquire()
      }
    } catch (e: Exception) {
      Log.w(TAG, "sin multicast lock: ${e.message}")
    }
  }

  private fun releaseMulticastLock() {
    try {
      multicastLock?.release()
    } catch (_: Exception) {
    }
    multicastLock = null
  }

  private fun closeQuietly(socket: Socket) {
    try {
      socket.close()
    } catch (_: Exception) {
    }
  }

  // ------------------------------------------------------------ conexión

  /** Mismo framing que Bluetooth: [u32 BE longitud][payload], máx. 256 KB. */
  private inner class LanConnection(
    val address: String,
    private val socket: Socket,
  ) {
    private val readerThread = Thread({ readLoop() }, "nido-lan-read")
    @Volatile private var closed = false

    fun start() {
      readerThread.isDaemon = true
      readerThread.start()
    }

    fun close() {
      if (closed) return
      closed = true
      readerThread.interrupt()
      closeQuietly(socket)
    }

    @Synchronized
    fun writeFrame(payload: ByteArray) {
      if (closed) throw IOException("Conexión cerrada ($address).")
      val out = socket.getOutputStream()
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
        val input = socket.getInputStream()
        val header = ByteArray(4)
        while (!closed && !Thread.currentThread().isInterrupted) {
          readFully(input, header, 4)
          val bodyLen = ((header[0].toInt() and 0xff) shl 24) or
            ((header[1].toInt() and 0xff) shl 16) or
            ((header[2].toInt() and 0xff) shl 8) or
            (header[3].toInt() and 0xff)
          if (bodyLen <= 0 || bodyLen > NidoP2PManager.MAX_FRAME_BYTES) {
            listener()?.onError("Frame inválido por Wi-Fi local (${bodyLen} bytes): conexión cerrada.")
            break
          }
          val body = ByteArray(bodyLen)
          readFully(input, body, bodyLen)
          listener()?.onFrame(address, Base64.encodeToString(body, Base64.NO_WRAP))
        }
      } catch (_: IOException) {
        // Cierre normal o peer desconectado.
      } catch (e: Exception) {
        listener()?.onError("Error leyendo por Wi-Fi local: ${e.message}")
      } finally {
        close()
        onConnectionClosed(this)
      }
    }

    private fun readFully(input: java.io.InputStream, buffer: ByteArray, length: Int) {
      var read = 0
      while (read < length) {
        val n = input.read(buffer, read, length - read)
        if (n < 0) throw IOException("Fin del stream.")
        read += n
      }
    }
  }
}
