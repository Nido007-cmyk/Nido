/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

package expo.modules.nidokeyvault

import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.UserNotAuthenticatedException
import android.util.Base64
import androidx.biometric.BiometricManager.Authenticators
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyStore
import java.util.concurrent.atomic.AtomicBoolean
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec

/** Error con código estable que JS traduce a pantallas (ver keyVault.ts). */
class VaultException(code: String, message: String, cause: Throwable? = null) :
  CodedException(code, message, cause)

/**
 * NidoKeyVault — KEK de hardware atada a la autenticación del usuario.
 *
 * Diseño: docs/design/BLOQUEO_BIOMETRICO_REAL.md.
 *  - La KEK (AES-256-GCM, no exportable) vive en el Android Keystore
 *    (StrongBox si existe; si no, TEE) y SOLO se puede usar durante
 *    [VALIDITY_SECONDS] s después de que el dueño se autentique con su
 *    PIN/patrón/contraseña o su huella (biometría fuerte).
 *  - Agregar o quitar huellas NO la invalida (setInvalidatedByBiometricEnrollment
 *    false + credencial del dispositivo aceptada). Quitar el bloqueo de
 *    pantalla SÍ (lo hace Android): JS lo trata como E_KEY_INVALIDATED.
 *  - Solo cifra/descifra la DEK de 32 B; el blob va versionado:
 *    [0x01][iv 12 B][ciphertext ‖ tag 16 B], con AAD fija "nido-dek-v1".
 */
class NidoKeyVaultModule : Module() {
  companion object {
    const val KEYSTORE = "AndroidKeyStore"
    const val KEK_ALIAS = "nido_kek_v1"
    const val VALIDITY_SECONDS = 30
    const val BLOB_VERSION: Byte = 1
    const val IV_BYTES = 12
    const val TAG_BITS = 128
    val AAD = "nido-dek-v1".toByteArray(Charsets.UTF_8)
  }

  private val context: Context
    get() = appContext.reactContext ?: throw VaultException("E_NO_CONTEXT", "Sin contexto de Android.")

  override fun definition() = ModuleDefinition {
    Name("NidoKeyVault")

    AsyncFunction("getStatus") { status() }

    AsyncFunction("ensureKek") {
      ensureKek()
      status()
    }

    AsyncFunction("authenticate") { title: String, subtitle: String, promise: Promise ->
      authenticate(title, subtitle, promise)
    }

    AsyncFunction("wrap") { plainB64: String -> wrap(plainB64) }

    AsyncFunction("unwrap") { blobB64: String -> unwrap(blobB64) }

    AsyncFunction("deleteKek") {
      deleteKekQuietly()
    }
  }

  private fun deleteKekQuietly() {
    try {
      keyStore().deleteEntry(KEK_ALIAS)
    } catch (_: Exception) {
    }
  }

  // ------------------------------------------------------------ estado

  private fun keyStore(): KeyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

  private fun deviceSecure(): Boolean {
    val km = context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
    return km?.isDeviceSecure ?: false
  }

  private fun status(): Map<String, Any> {
    val exists = try {
      keyStore().containsAlias(KEK_ALIAS)
    } catch (_: Exception) {
      false
    }
    return mapOf(
      "supported" to deviceSecure(),
      "kekExists" to exists,
      "securityLevel" to (if (exists) securityLevel() else "unknown"),
      "apiLevel" to Build.VERSION.SDK_INT,
    )
  }

  private fun securityLevel(): String = try {
    val key = keyStore().getKey(KEK_ALIAS, null) as SecretKey
    val factory = SecretKeyFactory.getInstance(key.algorithm, KEYSTORE)
    val info = factory.getKeySpec(key, KeyInfo::class.java) as KeyInfo
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      when (info.securityLevel) {
        KeyProperties.SECURITY_LEVEL_STRONGBOX -> "strongbox"
        KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> "tee"
        KeyProperties.SECURITY_LEVEL_SOFTWARE -> "software"
        else -> "unknown"
      }
    } else {
      @Suppress("DEPRECATION")
      if (info.isInsideSecureHardware) "tee" else "software"
    }
  } catch (_: Exception) {
    "unknown"
  }

  // ------------------------------------------------------------ KEK

  private fun ensureKek() {
    if (!deviceSecure()) {
      throw VaultException(
        "E_NO_SECURE_LOCK",
        "La tablet no tiene PIN, patrón ni contraseña: no se puede crear la llave protegida.",
      )
    }
    if (keyStore().containsAlias(KEK_ALIAS)) return
    val wantStrongBox = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
    try {
      generateKek(strongBox = wantStrongBox)
    } catch (e: Exception) {
      if (!wantStrongBox) throw VaultException("E_KEYGEN", "No se pudo crear la llave: ${e.message}", e)
      // StrongBox ausente o sin soporte para estos parámetros: TEE.
      try {
        keyStore().deleteEntry(KEK_ALIAS)
      } catch (_: Exception) {
      }
      try {
        generateKek(strongBox = false)
      } catch (e2: Exception) {
        throw VaultException("E_KEYGEN", "No se pudo crear la llave: ${e2.message}", e2)
      }
    }
  }

  private fun generateKek(strongBox: Boolean) {
    val b = KeyGenParameterSpec.Builder(
      KEK_ALIAS,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
    )
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256)
      .setUserAuthenticationRequired(true)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      b.setUserAuthenticationParameters(
        VALIDITY_SECONDS,
        KeyProperties.AUTH_DEVICE_CREDENTIAL or KeyProperties.AUTH_BIOMETRIC_STRONG,
      )
    } else {
      @Suppress("DEPRECATION")
      b.setUserAuthenticationValidityDurationSeconds(VALIDITY_SECONDS)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      b.setInvalidatedByBiometricEnrollment(false)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      b.setUnlockedDeviceRequired(true)
      if (strongBox) b.setIsStrongBoxBacked(true)
    }
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
    gen.init(b.build())
    gen.generateKey()
  }

  private fun kek(): SecretKey {
    val key = try {
      keyStore().getKey(KEK_ALIAS, null) as? SecretKey
    } catch (e: Exception) {
      throw VaultException("E_KEYSTORE", "No se pudo leer la llave protegida: ${e.message}", e)
    }
    return key ?: throw VaultException("E_NO_KEK", "La llave protegida no existe.")
  }

  private fun initCipher(mode: Int, iv: ByteArray?): Cipher {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    try {
      if (iv == null) cipher.init(mode, kek()) else cipher.init(mode, kek(), GCMParameterSpec(TAG_BITS, iv))
    } catch (e: KeyPermanentlyInvalidatedException) {
      throw VaultException(
        "E_KEY_INVALIDATED",
        "Android invalidó la llave protegida (¿se quitó el bloqueo de pantalla?).",
        e,
      )
    } catch (e: UserNotAuthenticatedException) {
      throw VaultException("E_AUTH_REQUIRED", "Hace falta autenticarse antes de usar la llave.", e)
    }
    cipher.updateAAD(AAD)
    return cipher
  }

  // ------------------------------------------------------------ wrap / unwrap

  private fun wrap(plainB64: String): String {
    val plain = Base64.decode(plainB64, Base64.NO_WRAP)
    try {
      val cipher = initCipher(Cipher.ENCRYPT_MODE, null)
      val ct = cipher.doFinal(plain)
      val iv = cipher.iv
      if (iv == null || iv.size != IV_BYTES) throw VaultException("E_CRYPTO", "IV inesperado.")
      val out = ByteArray(1 + IV_BYTES + ct.size)
      out[0] = BLOB_VERSION
      System.arraycopy(iv, 0, out, 1, IV_BYTES)
      System.arraycopy(ct, 0, out, 1 + IV_BYTES, ct.size)
      return Base64.encodeToString(out, Base64.NO_WRAP)
    } catch (e: VaultException) {
      throw e
    } catch (e: Exception) {
      throw VaultException("E_CRYPTO", "No se pudo proteger la llave: ${e.message}", e)
    } finally {
      plain.fill(0)
    }
  }

  private fun unwrap(blobB64: String): String {
    val blob = try {
      Base64.decode(blobB64, Base64.NO_WRAP)
    } catch (e: Exception) {
      throw VaultException("E_BLOB_CORRUPT", "La llave guardada está dañada.", e)
    }
    if (blob.size < 1 + IV_BYTES + TAG_BITS / 8 || blob[0] != BLOB_VERSION) {
      throw VaultException("E_BLOB_CORRUPT", "La llave guardada está dañada o es de otra versión.")
    }
    val iv = blob.copyOfRange(1, 1 + IV_BYTES)
    val ct = blob.copyOfRange(1 + IV_BYTES, blob.size)
    var plain: ByteArray? = null
    try {
      plain = initCipher(Cipher.DECRYPT_MODE, iv).doFinal(ct)
      return Base64.encodeToString(plain, Base64.NO_WRAP)
    } catch (e: VaultException) {
      throw e
    } catch (e: AEADBadTagException) {
      throw VaultException("E_BLOB_CORRUPT", "La llave guardada no se pudo verificar.", e)
    } catch (e: Exception) {
      throw VaultException("E_CRYPTO", "No se pudo abrir la llave: ${e.message}", e)
    } finally {
      plain?.fill(0)
    }
  }

  // ------------------------------------------------------------ autenticación

  private fun authenticate(title: String, subtitle: String, promise: Promise) {
    val activity = appContext.currentActivity as? FragmentActivity
    if (activity == null) {
      promise.reject(VaultException("E_NO_ACTIVITY", "No hay una pantalla activa para pedir la huella."))
      return
    }
    val settled = AtomicBoolean(false)
    fun settle(value: String) {
      if (settled.compareAndSet(false, true)) promise.resolve(value)
    }
    activity.runOnUiThread {
      try {
        val executor = ContextCompat.getMainExecutor(activity)
        val prompt = BiometricPrompt(
          activity,
          executor,
          object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
              settle("ok")
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
              val cancelled = errorCode == BiometricPrompt.ERROR_USER_CANCELED ||
                errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
                errorCode == BiometricPrompt.ERROR_CANCELED
              settle(if (cancelled) "cancelled" else "failed")
            }
            // onAuthenticationFailed = un intento fallido; el diálogo sigue abierto.
          },
        )
        // API 30+: huella fuerte o PIN. API < 30: STRONG|DEVICE_CREDENTIAL no
        // está soportado; WEAK|DEVICE_CREDENTIAL sí (una biometría débil no
        // habilita la llave: JS reintenta y el usuario puede usar el PIN).
        val authenticators = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          Authenticators.BIOMETRIC_STRONG or Authenticators.DEVICE_CREDENTIAL
        } else {
          Authenticators.BIOMETRIC_WEAK or Authenticators.DEVICE_CREDENTIAL
        }
        val info = BiometricPrompt.PromptInfo.Builder()
          .setTitle(title)
          .setSubtitle(subtitle)
          .setAllowedAuthenticators(authenticators)
          .build()
        prompt.authenticate(info)
      } catch (e: Exception) {
        if (settled.compareAndSet(false, true)) {
          promise.reject(VaultException("E_PROMPT", "No se pudo mostrar el diálogo: ${e.message}", e))
        }
      }
    }
  }
}
