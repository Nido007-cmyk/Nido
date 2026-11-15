/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

package expo.modules.nidonotify

import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Sobre sellado del almacén de avisos (T-15, m-58).
 *
 * Hasta la 0.1.98, NotifyEngine guardaba el título y el cuerpo de cada
 * aviso EN CLARO en SharedPreferences: cualquier copia del fichero (un
 * respaldo del aparato, un volcado de depuración) dejaba leer los
 * recordatorios del usuario. El propio módulo borraba el almacén legado
 * de expo por ese mismo motivo sin aplicárselo al suyo.
 *
 * Esto es la parte pura del arreglo: AES-256-GCM con IV aleatorio de
 * 12 bytes por entrada y el identificador del aviso como datos asociados
 * (un sobre trasplantado a otra entrada no abre). Solo usa `javax.crypto`
 * (API de plataforma, sin dependencias nuevas), así que la misma clase se
 * comprueba en la JVM con jvm-check/NotifyStoreSealCheck.kt. La clave la
 * pone NotifyEngine desde el Android Keystore; aquí no se guarda ninguna.
 *
 * Formato: `v1:` + hex(IV ‖ cifrado‖etiqueta). El hex es un códec propio
 * a propósito: `java.util.Base64` exige API 26 y `android.util.Base64`
 * no existe en la JVM del arnés. El tamaño no importa (decenas de avisos).
 *
 * Contrato de fallo: `open` devuelve null ante CUALQUIER problema (sobre
 * manipulado, clave distinta, datos asociados distintos, formato roto):
 * el llamador descarta la entrada. `seal` sí lanza: quien sella decide
 * (NotifyEngine distingue la clave invalidada para regenerarla).
 */
object NotifyStoreSeal {
  private const val PREFIX = "v1:"
  private const val IV_BYTES = 12
  private const val TAG_BITS = 128
  private const val TRANSFORMATION = "AES/GCM/NoPadding"

  fun isSealed(value: String): Boolean = value.startsWith(PREFIX)

  fun seal(key: SecretKey, associatedData: ByteArray, plaintext: ByteArray): String {
    val iv = ByteArray(IV_BYTES)
    SecureRandom().nextBytes(iv)
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
    cipher.updateAAD(associatedData)
    val ct = cipher.doFinal(plaintext)
    return PREFIX + toHex(iv + ct)
  }

  fun open(key: SecretKey, associatedData: ByteArray, sealed: String): ByteArray? {
    if (!isSealed(sealed)) return null
    val raw = fromHex(sealed.substring(PREFIX.length)) ?: return null
    if (raw.size <= IV_BYTES) return null
    val iv = raw.copyOfRange(0, IV_BYTES)
    val ct = raw.copyOfRange(IV_BYTES, raw.size)
    return try {
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
      cipher.updateAAD(associatedData)
      cipher.doFinal(ct)
    } catch (e: Exception) {
      null
    }
  }

  private val HEX_DIGITS = "0123456789abcdef".toCharArray()

  private fun toHex(bytes: ByteArray): String {
    val out = CharArray(bytes.size * 2)
    for (i in bytes.indices) {
      val v = bytes[i].toInt() and 0xff
      out[i * 2] = HEX_DIGITS[v ushr 4]
      out[i * 2 + 1] = HEX_DIGITS[v and 0x0f]
    }
    return String(out)
  }

  private fun fromHex(s: String): ByteArray? {
    if (s.length % 2 != 0) return null
    val out = ByteArray(s.length / 2)
    var i = 0
    while (i < s.length) {
      val hi = hexValue(s[i])
      val lo = hexValue(s[i + 1])
      if (hi < 0 || lo < 0) return null
      out[i / 2] = ((hi shl 4) or lo).toByte()
      i += 2
    }
    return out
  }

  private fun hexValue(c: Char): Int = when (c) {
    in '0'..'9' -> c - '0'
    in 'a'..'f' -> c - 'a' + 10
    in 'A'..'F' -> c - 'A' + 10
    else -> -1
  }
}
