/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
package expo.modules.nidokeyvault

import java.security.SecureRandom
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Batería JVM del blob de la bóveda (auditoría 0.1.112, bloque 6). Usa un
 * AES-256-GCM de software en lugar de la KEK del Keystore: prueba el
 * formato y el sellado, no el hardware ni el diálogo de huella/PIN.
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

private fun wrap(key: SecretKey, plain: ByteArray): ByteArray {
  val c = Cipher.getInstance("AES/GCM/NoPadding")
  c.init(Cipher.ENCRYPT_MODE, key)
  c.updateAAD(NidoKeyVaultBlob.AAD)
  return NidoKeyVaultBlob.pack(c.iv, c.doFinal(plain))!!
}

private fun unwrap(key: SecretKey, blob: ByteArray): ByteArray? {
  val (iv, ct) = NidoKeyVaultBlob.unpack(blob) ?: return null
  val c = Cipher.getInstance("AES/GCM/NoPadding")
  c.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(NidoKeyVaultBlob.TAG_BITS, iv))
  c.updateAAD(NidoKeyVaultBlob.AAD)
  return try {
    c.doFinal(ct)
  } catch (_: AEADBadTagException) {
    null
  }
}

fun main() {
  val kg = KeyGenerator.getInstance("AES").apply { init(256) }
  val key = kg.generateKey()
  val other = kg.generateKey()
  val dek = ByteArray(32).also { SecureRandom().nextBytes(it) }

  val blob = wrap(key, dek)
  check("longitud 1+12+32+16", blob.size == 1 + 12 + 32 + 16)
  check("versión 0x01", blob[0] == 1.toByte())
  check("ida y vuelta", unwrap(key, blob)?.contentEquals(dek) == true)
  check("IV nuevo en cada sellado", !wrap(key, dek).copyOfRange(1, 13).contentEquals(blob.copyOfRange(1, 13)))
  check("otra llave no abre", unwrap(other, blob) == null)

  for (i in blob.indices.drop(1)) {
    val t = blob.copyOf()
    t[i] = (t[i].toInt() xor 1).toByte()
    if (unwrap(key, t) != null) check("byte $i alterado se rechaza", false)
  }
  check("cualquier byte alterado se rechaza", true)

  val v2 = blob.copyOf().also { it[0] = 2 }
  check("otra versión: unpack null", NidoKeyVaultBlob.unpack(v2) == null)
  check("corto: unpack null", NidoKeyVaultBlob.unpack(blob.copyOf(1 + 12 + 15)) == null)
  check("mínimo (sin texto, solo tag) aceptado por formato", NidoKeyVaultBlob.unpack(blob.copyOf(1 + 12 + 16)) != null)
  check("vacío: unpack null", NidoKeyVaultBlob.unpack(ByteArray(0)) == null)
  check("IV null: pack null", NidoKeyVaultBlob.pack(null, ByteArray(48)) == null)
  check("IV de 16: pack null", NidoKeyVaultBlob.pack(ByteArray(16), ByteArray(48)) == null)

  // Otra AAD (un blob de otro uso) no abre.
  val c = Cipher.getInstance("AES/GCM/NoPadding")
  c.init(Cipher.ENCRYPT_MODE, key)
  c.updateAAD("otra-cosa".toByteArray())
  val foreign = NidoKeyVaultBlob.pack(c.iv, c.doFinal(dek))!!
  check("otra AAD no abre", unwrap(key, foreign) == null)

  if (failures == 0) println("check-keyvault-blob: PASS ($checks comprobaciones)")
  else println("check-keyvault-blob: FAIL ($failures de $checks)")
}
