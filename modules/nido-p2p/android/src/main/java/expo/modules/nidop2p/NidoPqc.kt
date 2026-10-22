/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

package expo.modules.nidop2p

/**
 * NidoPqc — ML-KEM-768 (FIPS 203) nativo, de mlkem-native v2.0.0
 * (src/main/cpp/mlkem-native, vendorizado sin cambios).
 *
 * Por qué nativo: la versión JS (@noble/post-quantum) no tiene auditoría
 * independiente ni es de tiempo constante. mlkem-native es la implementación
 * de AWS-LC y libOQS: su C tiene memoria y desbordamientos verificados con
 * CBMC, y en AArch64 su ensamblador está verificado (corrección, memoria y
 * tiempo constante) con HOL-Light.
 *
 * La aleatoriedad la pone NIDO (variantes *_derand). Antes de usarlo, el
 * lado TS (src/p2p/pq.ts) comprueba que da exactamente los mismos bytes que
 * la versión JS; si no, sigue con la JS.
 */
object NidoPqc {
  val available: Boolean = try {
    System.loadLibrary("nidomlkem")
    true
  } catch (t: Throwable) {
    false
  }

  @JvmStatic private external fun nativeKeypair(coins: ByteArray): ByteArray?
  @JvmStatic private external fun nativeEncaps(pk: ByteArray, m: ByteArray): ByteArray?
  @JvmStatic private external fun nativeDecaps(ct: ByteArray, sk: ByteArray): ByteArray?

  private fun fromHex(s: String): ByteArray? {
    if (s.length % 2 != 0) return null
    val out = ByteArray(s.length / 2)
    for (i in out.indices) {
      val hi = Character.digit(s[2 * i], 16)
      val lo = Character.digit(s[2 * i + 1], 16)
      if (hi < 0 || lo < 0) return null
      out[i] = ((hi shl 4) or lo).toByte()
    }
    return out
  }

  private fun toHex(b: ByteArray): String {
    val digits = "0123456789abcdef"
    val sb = StringBuilder(b.size * 2)
    for (x in b) {
      val v = x.toInt() and 0xff
      sb.append(digits[v ushr 4]).append(digits[v and 0x0f])
    }
    return sb.toString()
  }

  /** coins (64 B en hex) → pk||sk en hex, o null. */
  fun keypair(coinsHex: String): String? {
    if (!available) return null
    val coins = fromHex(coinsHex) ?: return null
    return try {
      nativeKeypair(coins)?.let { r -> toHex(r).also { r.fill(0) } }
    } finally {
      coins.fill(0)
    }
  }

  /** pk (hex), m (32 B en hex) → ct||ss en hex, o null. */
  fun encaps(pkHex: String, mHex: String): String? {
    if (!available) return null
    val pk = fromHex(pkHex) ?: return null
    val m = fromHex(mHex) ?: return null
    return try {
      nativeEncaps(pk, m)?.let { r -> toHex(r).also { r.fill(0) } }
    } finally {
      m.fill(0)
    }
  }

  /** ct (hex), sk (hex) → ss en hex, o null. */
  fun decaps(ctHex: String, skHex: String): String? {
    if (!available) return null
    val ct = fromHex(ctHex) ?: return null
    val sk = fromHex(skHex) ?: return null
    return try {
      nativeDecaps(ct, sk)?.let { r -> toHex(r).also { r.fill(0) } }
    } finally {
      sk.fill(0)
    }
  }
}
