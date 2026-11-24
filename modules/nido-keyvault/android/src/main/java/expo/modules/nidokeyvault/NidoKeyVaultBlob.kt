/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
package expo.modules.nidokeyvault

/**
 * Formato del blob de la bóveda, sin Android (auditoría 0.1.112, bloque 6):
 * [0x01][iv 12 B][ciphertext ‖ tag 16 B], AAD "nido-dek-v1". La CI lo
 * compila y lo prueba en la JVM con un AES-GCM de software
 * (jvm-check/NidoKeyVaultBlobCheck.kt). La llave del Keystore y el diálogo
 * de huella/PIN no se pueden probar fuera del teléfono: eso sigue siendo
 * pasada en dispositivo.
 */
internal object NidoKeyVaultBlob {
  const val VERSION: Byte = 1
  const val IV_BYTES = 12
  const val TAG_BITS = 128
  val AAD: ByteArray get() = "nido-dek-v1".toByteArray(Charsets.UTF_8)

  /** Monta el blob; null si el IV no mide lo que debe. */
  fun pack(iv: ByteArray?, ciphertext: ByteArray): ByteArray? {
    if (iv == null || iv.size != IV_BYTES) return null
    val out = ByteArray(1 + IV_BYTES + ciphertext.size)
    out[0] = VERSION
    System.arraycopy(iv, 0, out, 1, IV_BYTES)
    System.arraycopy(ciphertext, 0, out, 1 + IV_BYTES, ciphertext.size)
    return out
  }

  /** Separa (iv, ciphertext‖tag); null si es corto o de otra versión. */
  fun unpack(blob: ByteArray): Pair<ByteArray, ByteArray>? {
    if (blob.size < 1 + IV_BYTES + TAG_BITS / 8 || blob[0] != VERSION) return null
    return blob.copyOfRange(1, 1 + IV_BYTES) to blob.copyOfRange(1 + IV_BYTES, blob.size)
  }
}
