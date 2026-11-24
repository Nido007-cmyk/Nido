/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

package expo.modules.nidop2p

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
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
    const val ADDRESS_PREFIX = NidoP2PFraming.LAN_PREFIX
    const val CONNECT_TIMEOUT_MS = 5_000
    const val MAX_CONNECTIONS = 8
    /**
     * AUDIT-2026-10-11 (LAN-2): los 2 primeros frames de toda conexión son
     * el handshake (HELLO y CONFIRM, < 1 KB cada uno). Antes de autenticarse
     * nadie puede mandar frames grandes: se corta en vez de pasar hasta
     * 256 KB por frame al hilo de JS.
     */
    const val HANDSHAKE_FRAMES = NidoP2PFraming.HANDSHAKE_FRAMES
    const val MAX_HANDSHAKE_FRAME_BYTES = NidoP2PFraming.MAX_HANDSHAKE_FRAME_BYTES
    /**
     * 0.1.47 (auditoría): conexiones simultáneas por dirección IP. Sin esto,
     * un solo dispositivo de la red podía ocupar los MAX_CONNECTIONS huecos
     * abriendo y reabriendo conexiones sin saludar, y dejar fuera a tus
     * contactos.
     */
    const val MAX_CONNECTIONS_PER_IP = 2
    /**
     * 0.1.47: tiempo máximo de silencio antes de completar el saludo (los dos
     * primeros frames). Después ya no hay tope: una sesión puede estar
     * callada mucho rato.
     */
    const val HANDSHAKE_READ_TIMEOUT_MS = 20_000
    /**
     * T-12 (0.1.99, m-37): gracia POST-saludo. Antes, al llegar el segundo
     * frame el lector retiraba el timeout PARA SIEMPRE, por conteo y no
     * por autenticación: cualquier aparato de la red local que mandara
     * dos frames cualesquiera se quedaba con un socket abierto sin
     * límite. Ahora el segundo frame solo abre esta gracia; el timeout
     * se retira cuando el transporte JS confirma que la ruta quedó
     * establecida y autenticada (markLanAuthenticated, tras verificar el
     * CONFIRM firmado). Sin esa señal, la conexión muere al vencer.
     */
    const val AUTH_GRACE_TIMEOUT_MS = 30_000
    /**
     * T-12 (0.1.99, m-39): tarifa de accepts. Los topes de conexiones
     * simultáneas (8 y 2 por IP) no frenaban el ciclo abrir/cerrar: cada
     * accept crea un hilo lector y eventos hacia JS. Por encima de la
     * tarifa, el socket se acepta y se cierra al instante (el backlog no
     * se atasca y el cliente legítimo puede reintentar tras la ventana).
     */
    const val ACCEPT_WINDOW_MS = 10_000
    const val MAX_ACCEPTS_PER_IP_WINDOW = 12
    const val MAX_ACCEPTS_GLOBAL_WINDOW = 48
    const val TAG = "NidoLan"

    /**
     * 0.1.55 (P-06): interfaces del punto de acceso que crea el propio
     * teléfono (los nombres cambian por fabricante). Todas son de la radio
     * Wi-Fi: nunca la de datos móviles (rmnet*, ccmni*, pdp*…).
     */
    private val HOTSPOT_IFACE_RE = Regex("^(ap|swlan|softap|wlan)\\d+$")

    fun isLanAddress(address: String): Boolean = address.startsWith(ADDRESS_PREFIX)

    /** true si la IPv4 es privada o link-local (nunca internet). */
    fun isLocalIpv4(addr: InetAddress): Boolean =
      addr is Inet4Address && (addr.isSiteLocalAddress || addr.isLinkLocalAddress)

    fun formatAddress(addr: InetAddress, port: Int): String =
      "$ADDRESS_PREFIX${addr.hostAddress}:$port"

    /**
     * Blindaje 2026-10-21: ¿el que se conecta está en la MISMA red local que
     * la interfaz que recibió la conexión? Muchas operadoras móviles dan
     * direcciones 10.x a sus clientes: con solo el filtro de «IP privada»,
     * otro cliente de la misma operadora podía llegar al servidor por datos
     * móviles mientras se buscaban contactos. Las redes móviles asignan
     * prefijos muy cortos (/30, /32), así que otro cliente nunca queda en la
     * misma subred; en Wi-Fi o punto de acceso (/24) el contacto sí.
     * T-13 (m-38): si NO se puede determinar la subred, la respuesta es NO
     * (fail-closed). Antes era SÍ «para no romper conexiones que
     * funcionaban», y eso dejaba el filtro sin efecto justo en los casos
     * que no se podían razonar. Coste declarado: redes legítimas raras
     * (punto de acceso con prefijo corto, /30-/32 de operadora en Wi-Fi)
     * pierden la ruta LAN; la ruta Bluetooth no se toca.
     */
    fun isSameLocalSubnet(local: InetAddress?, remote: InetAddress): Boolean {
      if (local !is Inet4Address || remote !is Inet4Address) return false
      val iface = try {
        NetworkInterface.getByInetAddress(local)
      } catch (_: Exception) {
        null
      } ?: return false
      val ia = iface.interfaceAddresses.firstOrNull { it.address == local } ?: return false
      return NidoP2PFraming.sameSubnet(local.address, remote.address, ia.networkPrefixLength.toInt())
    }
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
    // 0.1.55 (P-06): si cambió la red Wi-Fi (otra IP), el servidor enlazado
    // a la IP vieja ya no recibe nada: se reabre (y se re-anuncia con el
    // puerto nuevo).
    val s = server
    if (s != null && s.inetAddress?.isAnyLocalAddress == false && s.inetAddress != preferredBindAddress()) {
      Log.i(TAG, "la red Wi-Fi cambió: se reabre el servidor LAN")
      unregisterService()
      stopServer()
    }
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

  /**
   * 0.1.55 (P-06): la IPv4 en la que escuchar. Primero la de la red Wi-Fi a
   * la que está conectado el teléfono; si no hay, la del punto de acceso que
   * crea él mismo. null si no hay ninguna de las dos.
   */
  private fun preferredBindAddress(): Inet4Address? {
    try {
      val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
      @Suppress("DEPRECATION")
      val networks = if (cm != null) cm.allNetworks else emptyArray()
      for (n in networks) {
        if (cm == null) break
        val caps = cm.getNetworkCapabilities(n) ?: continue
        if (!caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) continue
        val lp = cm.getLinkProperties(n) ?: continue
        for (la in lp.linkAddresses) {
          val a = la.address
          if (a is Inet4Address && isLocalIpv4(a)) return a
        }
      }
    } catch (_: Exception) {
    }
    try {
      val ifaces = NetworkInterface.getNetworkInterfaces()?.toList() ?: emptyList()
      for (ni in ifaces) {
        if (!ni.isUp || ni.isLoopback || !HOTSPOT_IFACE_RE.matches(ni.name)) continue
        for (a in ni.inetAddresses.toList()) {
          if (a is Inet4Address && isLocalIpv4(a)) return a
        }
      }
    } catch (_: Exception) {
    }
    return null
  }

  private fun startServer() {
    val s = ServerSocket()
    s.reuseAddress = true
    // 0.1.55 (P-06): escuchar SOLO en la interfaz Wi-Fi (o en el punto de
    // acceso propio), no en todas: así el servidor ni siquiera existe en la
    // interfaz de datos móviles.
    // T-13 (m-38): si no se identifica ninguna interfaz, NO se escucha.
    // Antes se escuchaba en todas (0.0.0.0) y el filtro de acceptLoop era
    // la única defensa: un solo filtro entre la red de la operadora y el
    // saludo. Sin servidor, el resto sigue: el descubrimiento NSD y las
    // conexiones salientes no dependen de este socket, y quien llama a
    // start() reintenta en el siguiente arranque.
    val bindTo = preferredBindAddress()
    if (bindTo == null) {
      try {
        s.close()
      } catch (_: Exception) {
      }
      Log.w(TAG, "sin interfaz Wi-Fi ni punto de acceso identificados: el servidor LAN no arranca")
      return
    }
    s.bind(InetSocketAddress(bindTo, 0)) // puerto efímero
    server = s
    val t = Thread({ acceptLoop(s) }, "nido-lan-accept")
    t.isDaemon = true
    acceptThread = t
    t.start()
    Log.i(TAG, "servidor LAN escuchando en ${s.inetAddress?.hostAddress}:${s.localPort}")
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
      if (!isSameLocalSubnet(socket.localAddress, remote)) {
        Log.w(TAG, "conexión rechazada: no está en la misma red local")
        closeQuietly(socket)
        continue
      }
      if (!acceptRateAllows(remote.hostAddress)) {
        // T-12 (m-39): tarifa de accepts excedida: se acepta y se cierra
        // al instante, sin crear hilo lector ni eventos hacia JS.
        Log.w(TAG, "conexión cerrada al instante: tarifa de accepts excedida")
        closeQuietly(socket)
        continue
      }
      if (connections.size >= MAX_CONNECTIONS) {
        Log.w(TAG, "conexión rechazada: tope de $MAX_CONNECTIONS conexiones")
        closeQuietly(socket)
        continue
      }
      val ipPrefix = "$ADDRESS_PREFIX${remote.hostAddress}:"
      if (connections.keys.count { it.startsWith(ipPrefix) } >= MAX_CONNECTIONS_PER_IP) {
        Log.w(TAG, "conexión rechazada: tope de $MAX_CONNECTIONS_PER_IP por dirección")
        closeQuietly(socket)
        continue
      }
      try {
        socket.soTimeout = HANDSHAKE_READ_TIMEOUT_MS
      } catch (_: Exception) {
      }
      onSocket(socket, formatAddress(remote, socket.port), incoming = true)
    }
  }

  // T-12 (m-39): ventana de tarifa de accepts (ver constantes).
  private val acceptRateLock = Any()
  private var acceptWindowStartMs = 0L
  private var acceptWindowTotal = 0
  private val acceptWindowPerIp = HashMap<String, Int>()

  private fun acceptRateAllows(ip: String): Boolean {
    val now = System.currentTimeMillis()
    synchronized(acceptRateLock) {
      if (now - acceptWindowStartMs >= ACCEPT_WINDOW_MS) {
        acceptWindowStartMs = now
        acceptWindowTotal = 0
        acceptWindowPerIp.clear()
      }
      val perIp = acceptWindowPerIp[ip] ?: 0
      if (perIp >= MAX_ACCEPTS_PER_IP_WINDOW || acceptWindowTotal >= MAX_ACCEPTS_GLOBAL_WINDOW) {
        return false
      }
      acceptWindowPerIp[ip] = perIp + 1
      acceptWindowTotal += 1
      return true
    }
  }

  /**
   * T-12 (m-37): el transporte JS confirma que la ruta con esta
   * dirección quedó establecida y autenticada (CONFIRM verificado).
   * Solo entonces el lector de esa conexión retira su timeout.
   */
  fun markAuthenticated(address: String) {
    connections[address]?.markAuthenticated()
  }

  // ------------------------------------------------------------ cliente

  /**
   * Conecta con "LAN:<ipv4>:<puerto>". Bloqueante (timeout 5 s); llamar
   * fuera del hilo de JS. Solo admite direcciones de red local.
   */
  @Throws(IOException::class)
  fun connect(address: String): Map<String, String?> {
    val (host, port) = NidoP2PFraming.parseLanAddress(address)
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
    // T-15 (m-61): el mismo timeout de saludo que pone el aceptador.
    // Sin él, un par elegido que nunca saluda dejaba esta conexión
    // colgada sin límite, ocupando un hueco. El lector lo gestiona al
    // completar el saludo (gracia post-saludo de T-12 y señal de ruta
    // autenticada), igual que en las entrantes.
    try {
      socket.soTimeout = HANDSHAKE_READ_TIMEOUT_MS
    } catch (_: Exception) {
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
    Log.i(TAG, "conexión LAN ${if (incoming) "entrante" else "saliente"}") // sin dirección: el log del sistema no guarda con quién se habla
    listener()?.onConnected(address, null, incoming)
  }

  @Throws(IOException::class)
  fun sendFrame(address: String, payload: ByteArray) {
    val conn = connections[address] ?: throw IOException("Sin conexión con $address.")
    if (!NidoP2PFraming.sendable(payload.size)) {
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

  /**
   * Descarta nuestro propio servicio si el sistema lo devuelve igualmente.
   * SELF-CONNECT-2026-10-11: se compara solo la IP, no el puerto. Tras un
   * cierre forzado, la caché mDNS de la red sigue anunciando el servicio del
   * proceso muerto (mismo IP, puerto viejo). Con el chequeo de puerto ese
   * anuncio no se reconocía como propio y la app intentaba conectarse a sí
   * misma: ECONNREFUSED y 5 s perdidos antes de llegar al peer real. En un
   * mismo dispositivo nunca hay otro NIDO al que conectarse.
   */
  @Suppress("UNUSED_PARAMETER")
  private fun isMyself(host: InetAddress, port: Int): Boolean {
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
    /**
     * T-12 (m-37): true solo cuando JS confirmó la ruta autenticada
     * (markAuthenticated). El conteo de frames ya NO retira el timeout.
     */
    @Volatile private var authenticated = false
    private var framesRead = 0

    fun markAuthenticated() {
      authenticated = true
      try {
        socket.soTimeout = 0
      } catch (_: Exception) {
      }
    }

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
      out.write(NidoP2PFraming.header(payload.size))
      out.write(payload)
      out.flush()
    }

    private fun readLoop() {
      try {
        val input = socket.getInputStream()
        val header = ByteArray(4)
        while (!closed && !Thread.currentThread().isInterrupted) {
          NidoP2PFraming.readFully(input, header, 0, 4)
          val bodyLen = NidoP2PFraming.length(header)
          when (NidoP2PFraming.judge(bodyLen, framesRead)) {
            NidoP2PFraming.Verdict.INVALID -> {
              listener()?.onError("Frame inválido por Wi-Fi local (${bodyLen} bytes): conexión cerrada.")
              break
            }
            NidoP2PFraming.Verdict.HANDSHAKE_TOO_BIG -> {
              Log.w(TAG, "frame de handshake demasiado grande ($bodyLen bytes): conexión cerrada")
              break
            }
            NidoP2PFraming.Verdict.OK -> Unit
          }
          framesRead++
          val body = ByteArray(bodyLen)
          NidoP2PFraming.readFully(input, body, 0, bodyLen)
          if (framesRead == HANDSHAKE_FRAMES) {
            // Saludo completo en frames, pero aún NO autenticado: corre
            // la gracia post-saludo (T-12, m-37). El timeout solo se
            // retira del todo con la señal de ruta autenticada; si la
            // conexión ya la traía, queda sin tope desde aquí.
            try {
              socket.soTimeout = if (authenticated) 0 else AUTH_GRACE_TIMEOUT_MS
            } catch (_: Exception) {
            }
          }
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
  }
}
