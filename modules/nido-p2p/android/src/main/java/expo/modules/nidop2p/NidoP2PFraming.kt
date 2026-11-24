/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
package expo.modules.nidop2p

import java.io.IOException
import java.io.InputStream

/**
 * Lógica pura del transporte P2P (auditoría 0.1.112, bloque 6): el framing
 * [u32 BE longitud][payload] que comparten Bluetooth y Wi-Fi local, y la
 * validación de direcciones y subredes de la ruta LAN. Sin Android: así la
 * CI la compila y la prueba en la JVM (jvm-check/NidoP2PFramingCheck.kt,
 * scripts/check-p2p-framing.mjs). Antes vivía duplicada en
 * NidoP2PManager y NidoLanManager, sin ninguna prueba.
 */
internal object NidoP2PFraming {
  /** Tope de un frame (cubre el mayor sobre cifrado admitido). */
  const val MAX_FRAME_BYTES = 256 * 1024

  /** Los dos primeros frames de cada conexión son el saludo. */
  const val HANDSHAKE_FRAMES = 2

  /** Tope de un frame de saludo. */
  const val MAX_HANDSHAKE_FRAME_BYTES = 4 * 1024

  enum class Verdict { OK, INVALID, HANDSHAKE_TOO_BIG }

  /** Cabecera de 4 bytes big-endian con la longitud del payload. */
  fun header(size: Int): ByteArray = byteArrayOf(
    (size ushr 24).toByte(),
    (size ushr 16).toByte(),
    (size ushr 8).toByte(),
    size.toByte(),
  )

  /** Longitud que declara una cabecera (puede salir negativa: se rechaza en judge). */
  fun length(h: ByteArray): Int =
    ((h[0].toInt() and 0xff) shl 24) or
      ((h[1].toInt() and 0xff) shl 16) or
      ((h[2].toInt() and 0xff) shl 8) or
      (h[3].toInt() and 0xff)

  /** Veredicto sobre un frame entrante antes de reservar su memoria. */
  fun judge(bodyLen: Int, framesRead: Int): Verdict = when {
    bodyLen <= 0 || bodyLen > MAX_FRAME_BYTES -> Verdict.INVALID
    framesRead < HANDSHAKE_FRAMES && bodyLen > MAX_HANDSHAKE_FRAME_BYTES -> Verdict.HANDSHAKE_TOO_BIG
    else -> Verdict.OK
  }

  /** true si se puede enviar un payload de este tamaño. */
  fun sendable(size: Int): Boolean = size in 1..MAX_FRAME_BYTES

  /** Lee exactamente [length] bytes o lanza IOException al acabarse el stream. */
  @Throws(IOException::class)
  fun readFully(input: InputStream, buffer: ByteArray, offset: Int, length: Int) {
    var read = 0
    while (read < length) {
      val n = input.read(buffer, offset + read, length - read)
      if (n < 0) throw IOException("Fin del stream.")
      read += n
    }
  }

  // ---------------------------------------------------------------- LAN

  const val LAN_PREFIX = "LAN:"
  private val ADDRESS_RE = Regex("^LAN:(\\d{1,3}(?:\\.\\d{1,3}){3}):(\\d{1,5})$")

  /**
   * Valida «LAN:a.b.c.d:puerto» y devuelve (host, puerto). Lanza
   * IOException con el mismo texto que daba NidoLanManager.connect.
   * No decide si la IP es local: eso lo mira quien la resuelve.
   */
  @Throws(IOException::class)
  fun parseLanAddress(address: String): Pair<String, Int> {
    val m = ADDRESS_RE.matchEntire(address)
      ?: throw IOException("Dirección Wi-Fi local inválida: $address")
    val host = m.groupValues[1]
    val port = m.groupValues[2].toInt()
    if (port !in 1..65535) throw IOException("Puerto inválido: $port")
    if (host.split('.').any { it.toInt() > 255 }) throw IOException("IP inválida: $host")
    return host to port
  }

  /** Los 4 bytes de una IPv4 como entero (orden de red). */
  fun ipv4ToInt(b: ByteArray): Int =
    ((b[0].toInt() and 0xff) shl 24) or ((b[1].toInt() and 0xff) shl 16) or
      ((b[2].toInt() and 0xff) shl 8) or (b[3].toInt() and 0xff)

  /** ¿Comparten subred con ese prefijo? Prefijo fuera de 1..32: NO (fail-closed, T-13). */
  fun sameSubnet(local: ByteArray, remote: ByteArray, prefix: Int): Boolean {
    if (local.size != 4 || remote.size != 4) return false
    if (prefix !in 1..32) return false
    val mask = if (prefix == 32) -1 else (-1 shl (32 - prefix))
    return (ipv4ToInt(local) and mask) == (ipv4ToInt(remote) and mask)
  }
}
