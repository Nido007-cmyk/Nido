/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
package expo.modules.nidop2p

import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream

/**
 * Batería JVM de NidoP2PFraming (auditoría 0.1.112, bloque 6). La corre
 * scripts/check-native-cores.mjs; imprime PASS o los fallos.
 */
private var failures = 0
private var checks = 0

private fun check(name: String, ok: Boolean) {
  checks++
  if (!ok) {
    failures++
    println("FALLO: $name")
  }
}

private fun throwsIo(block: () -> Unit): String? = try {
  block()
  null
} catch (e: IOException) {
  e.message ?: ""
}

/** Stream que entrega de a 1 byte: prueba que readFully junta lecturas cortas. */
private class Trickle(private val data: ByteArray) : InputStream() {
  private var i = 0
  override fun read(): Int = if (i < data.size) data[i++].toInt() and 0xff else -1
  override fun read(b: ByteArray, off: Int, len: Int): Int {
    if (i >= data.size) return -1
    if (len == 0) return 0
    b[off] = data[i++]
    return 1
  }
}

fun main() {
  val F = NidoP2PFraming
  // Cabecera: ida y vuelta en los bordes.
  for (n in listOf(1, 255, 256, 65_535, 65_536, 4 * 1024, F.MAX_FRAME_BYTES, Int.MAX_VALUE)) {
    check("header/length $n", F.length(F.header(n)) == n)
  }
  check("big-endian", F.header(0x01020304).toList() == listOf<Byte>(1, 2, 3, 4))
  check("cabecera 0xFFFFFFFF = -1", F.length(byteArrayOf(-1, -1, -1, -1)) == -1)

  // Veredictos.
  check("0 bytes inválido", F.judge(0, 5) == NidoP2PFraming.Verdict.INVALID)
  check("negativo inválido", F.judge(-1, 5) == NidoP2PFraming.Verdict.INVALID)
  check("tope exacto vale", F.judge(F.MAX_FRAME_BYTES, 5) == NidoP2PFraming.Verdict.OK)
  check("tope+1 inválido", F.judge(F.MAX_FRAME_BYTES + 1, 5) == NidoP2PFraming.Verdict.INVALID)
  check("saludo 4 KB vale", F.judge(4 * 1024, 0) == NidoP2PFraming.Verdict.OK)
  check("saludo 4 KB+1 grande", F.judge(4 * 1024 + 1, 0) == NidoP2PFraming.Verdict.HANDSHAKE_TOO_BIG)
  check("2º frame de saludo grande", F.judge(4 * 1024 + 1, 1) == NidoP2PFraming.Verdict.HANDSHAKE_TOO_BIG)
  check("3er frame ya puede ser grande", F.judge(4 * 1024 + 1, 2) == NidoP2PFraming.Verdict.OK)
  check("sendable 0 no", !F.sendable(0))
  check("sendable tope sí", F.sendable(F.MAX_FRAME_BYTES))
  check("sendable tope+1 no", !F.sendable(F.MAX_FRAME_BYTES + 1))

  // readFully con lecturas cortas y fin de stream.
  val payload = ByteArray(1000) { (it * 7).toByte() }
  val wire = F.header(payload.size) + payload
  val inp = Trickle(wire)
  val h = ByteArray(4)
  F.readFully(inp, h, 0, 4)
  val body = ByteArray(F.length(h))
  F.readFully(inp, body, 0, body.size)
  check("frame entero por goteo", body.contentEquals(payload))
  check("stream corto lanza", throwsIo { F.readFully(ByteArrayInputStream(ByteArray(3)), ByteArray(4), 0, 4) } == "Fin del stream.")
  val off = ByteArray(6)
  F.readFully(ByteArrayInputStream(byteArrayOf(9, 8)), off, 3, 2)
  check("offset respetado", off.toList() == listOf<Byte>(0, 0, 0, 9, 8, 0))

  // Direcciones LAN.
  check("válida", F.parseLanAddress("LAN:192.168.1.20:40123") == ("192.168.1.20" to 40123))
  check("sin prefijo", throwsIo { F.parseLanAddress("192.168.1.20:40123") } == "Dirección Wi-Fi local inválida: 192.168.1.20:40123")
  check("puerto 0", throwsIo { F.parseLanAddress("LAN:10.0.0.1:0") } == "Puerto inválido: 0")
  check("puerto 65536", throwsIo { F.parseLanAddress("LAN:10.0.0.1:65536") } == "Puerto inválido: 65536")
  check("octeto 256", throwsIo { F.parseLanAddress("LAN:10.0.256.1:80") } == "IP inválida: 10.0.256.1")
  check("nombre de host no", throwsIo { F.parseLanAddress("LAN:evil.example:80") } != null)
  check("IPv6 no", throwsIo { F.parseLanAddress("LAN:[::1]:80") } != null)
  check("basura detrás no", throwsIo { F.parseLanAddress("LAN:10.0.0.1:80\n") } != null)

  // Subred (T-13: fail-closed).
  val a = byteArrayOf(192.toByte(), 168.toByte(), 1, 20)
  val b = byteArrayOf(192.toByte(), 168.toByte(), 1, 77)
  val c = byteArrayOf(192.toByte(), 168.toByte(), 2, 77)
  check("/24 misma", F.sameSubnet(a, b, 24))
  check("/24 distinta", !F.sameSubnet(a, c, 24))
  check("/16 misma", F.sameSubnet(a, c, 16))
  check("/32 solo ella misma", F.sameSubnet(a, a, 32) && !F.sameSubnet(a, b, 32))
  check("/30 de operadora separa clientes", !F.sameSubnet(byteArrayOf(10, 0, 0, 1), byteArrayOf(10, 0, 0, 9), 30))
  check("prefijo 0 no", !F.sameSubnet(a, b, 0))
  check("prefijo 33 no", !F.sameSubnet(a, b, 33))
  check("IPv6 no", !F.sameSubnet(ByteArray(16), ByteArray(16), 64))

  if (failures == 0) println("check-p2p-framing: PASS ($checks comprobaciones)")
  else println("check-p2p-framing: FAIL ($failures de $checks)")
}
