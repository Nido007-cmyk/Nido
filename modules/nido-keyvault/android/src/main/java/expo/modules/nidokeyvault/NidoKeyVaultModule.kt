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
import android.util.Base64
import androidx.annotation.RequiresApi
import androidx.biometric.BiometricManager
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
 * Diseño e investigación: docs/design/BLOQUEO_BIOMETRICO_REAL.md.
 *
 *  - KEK AES-256-GCM no exportable en el Android Keystore (StrongBox si
 *    existe; si no, TEE).
 *  - Autorización POR OPERACIÓN (timeout 0) con BiometricPrompt +
 *    CryptoObject: el hardware exige un token de autenticación ligado al
 *    desafío de ESA operación concreta. Un desbloqueo cualquiera de la
 *    tablet no habilita la llave (con una ventana de tiempo sí lo haría), y
 *    enganchar el callback de éxito no sirve: sin token válido, doFinal
 *    falla. Recomendación OWASP MASTG-BEST-0036 / MASTG-TEST-0330.
 *  - Métodos: biometría fuerte (clase 3) o PIN/patrón/contraseña. Con
 *    CryptoObject, la credencial del dispositivo solo es posible desde
 *    Android 11 (API 30): por debajo la bóveda se declara no soportada y
 *    NIDO sigue en el modo actual.
 *  - setInvalidatedByBiometricEnrollment(false): agregar huellas no destruye
 *    los datos. Con el PIN aceptado como método, invalidar por inscripción no
 *    añade protección (quien sabe el PIN ya puede autenticarse).
 *  - Sin setUnlockedDeviceRequired: Android documenta fallos en 12–14 (p. ej.
 *    desbloqueo facial "débil" de Samsung no re-autoriza la llave) y la
 *    autorización por operación ya es más estricta.
 *  - Blob versionado: [0x01][iv 12 B][ciphertext ‖ tag 16 B], AAD "nido-dek-v1".
 */
class NidoKeyVaultModule : Module() {
  companion object {
    const val KEYSTORE = "AndroidKeyStore"
    const val KEK_ALIAS = "nido_kek_v1"
    const val MIN_API = Build.VERSION_CODES.R // 30
    const val BLOB_VERSION: Byte = 1
    const val IV_BYTES = 12
    const val TAG_BITS = 128
    val AAD = "nido-dek-v1".toByteArray(Charsets.UTF_8)
    const val AUTHENTICATORS = Authenticators.BIOMETRIC_STRONG or Authenticators.DEVICE_CREDENTIAL
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

    /** Cifra la DEK tras un diálogo de PIN/huella ligado a ESTA operación. */
    AsyncFunction("wrapWithAuth") { plainB64: String, title: String, subtitle: String, promise: Promise ->
      wrapWithAuth(plainB64, title, subtitle, promise)
    }

    /** Descifra el blob tras un diálogo de PIN/huella ligado a ESTA operación. */
    AsyncFunction("unwrapWithAuth") { blobB64: String, title: String, subtitle: String, promise: Promise ->
      unwrapWithAuth(blobB64, title, subtitle, promise)
    }

    AsyncFunction("deleteKek") {
      deleteKekQuietly()
    }

    /**
     * Nivel B ("máxima seguridad"): cierra NIDO por completo. Matar el
     * proceso es la única forma fiable de que NO quede en memoria ni la DEK
     * ni datos ya descifrados (estado de React, cachés): el recolector de
     * JS no permite borrar memoria a voluntad. El servicio P2P vive en el
     * mismo proceso; si Android lo reinicia sin intent, se detiene solo.
     */
    AsyncFunction("terminateProcess") {
      val act = appContext.currentActivity
      act?.runOnUiThread {
        try {
          act.finishAndRemoveTask()
        } catch (_: Exception) {
        }
      }
      Thread {
        try {
          Thread.sleep(250)
        } catch (_: InterruptedException) {
        }
        android.os.Process.killProcess(android.os.Process.myPid())
      }.start()
      Unit
    }
  }

  // ------------------------------------------------------------ estado

  private fun keyStore(): KeyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

  private fun deleteKekQuietly() {
    try {
      keyStore().deleteEntry(KEK_ALIAS)
    } catch (_: Exception) {
    }
  }

  private fun deviceSecure(): Boolean {
    val km = context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
    return km?.isDeviceSecure ?: false
  }

  private fun canAuthenticate(): Boolean = try {
    BiometricManager.from(context).canAuthenticate(AUTHENTICATORS) == BiometricManager.BIOMETRIC_SUCCESS
  } catch (_: Exception) {
    false
  }

  private fun status(): Map<String, Any> {
    val exists = try {
      keyStore().containsAlias(KEK_ALIAS)
    } catch (_: Exception) {
      false
    }
    val supported = Build.VERSION.SDK_INT >= MIN_API && deviceSecure() && canAuthenticate()
    return mapOf(
      "supported" to supported,
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
    if (Build.VERSION.SDK_INT < MIN_API) {
      throw VaultException("E_UNSUPPORTED", "Requiere Android 11 o superior.")
    }
    if (!deviceSecure()) {
      throw VaultException(
        "E_NO_SECURE_LOCK",
        "La tablet no tiene PIN, patrón ni contraseña: no se puede crear la llave protegida.",
      )
    }
    if (keyStore().containsAlias(KEK_ALIAS)) return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) createKek()
  }

  @RequiresApi(Build.VERSION_CODES.R)
  private fun createKek() {
    val hasStrongBox = context.packageManager.hasSystemFeature("android.hardware.strongbox_keystore")
    try {
      generateKek(strongBox = hasStrongBox)
    } catch (e: Exception) {
      if (!hasStrongBox) throw VaultException("E_KEYGEN", "No se pudo crear la llave: ${e.message}", e)
      // StrongBox presente pero sin soporte para estos parámetros: TEE.
      deleteKekQuietly()
      try {
        generateKek(strongBox = false)
      } catch (e2: Exception) {
        throw VaultException("E_KEYGEN", "No se pudo crear la llave: ${e2.message}", e2)
      }
    }
  }

  @RequiresApi(Build.VERSION_CODES.R)
  private fun generateKek(strongBox: Boolean) {
    val b = KeyGenParameterSpec.Builder(
      KEK_ALIAS,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
    )
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256)
      .setUserAuthenticationRequired(true)
      // timeout 0 = autorización por operación (CryptoObject obligatorio).
      .setUserAuthenticationParameters(
        0,
        KeyProperties.AUTH_DEVICE_CREDENTIAL or KeyProperties.AUTH_BIOMETRIC_STRONG,
      )
      .setInvalidatedByBiometricEnrollment(false)
    if (strongBox) b.setIsStrongBoxBacked(true)
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

  /** Inicializa el cifrador; la autorización real llega con el CryptoObject. */
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
    }
    return cipher
  }

  // ------------------------------------------------------------ operaciones

  private fun wrapWithAuth(plainB64: String, title: String, subtitle: String, promise: Promise) {
    val plain = try {
      Base64.decode(plainB64, Base64.NO_WRAP)
    } catch (e: Exception) {
      promise.reject(VaultException("E_CRYPTO", "Entrada inválida.", e))
      return
    }
    val cipher = try {
      initCipher(Cipher.ENCRYPT_MODE, null)
    } catch (e: VaultException) {
      plain.fill(0)
      promise.reject(e)
      return
    } catch (e: Exception) {
      plain.fill(0)
      promise.reject(VaultException("E_CRYPTO", "No se pudo preparar el cifrado: ${e.message}", e))
      return
    }
    prompt(title, subtitle, cipher, promise) { authed ->
      try {
        authed.updateAAD(AAD)
        val ct = authed.doFinal(plain)
        val iv = authed.iv
        if (iv == null || iv.size != IV_BYTES) throw VaultException("E_CRYPTO", "IV inesperado.")
        val out = ByteArray(1 + IV_BYTES + ct.size)
        out[0] = BLOB_VERSION
        System.arraycopy(iv, 0, out, 1, IV_BYTES)
        System.arraycopy(ct, 0, out, 1 + IV_BYTES, ct.size)
        Base64.encodeToString(out, Base64.NO_WRAP)
      } finally {
        plain.fill(0)
      }
    }
  }

  private fun unwrapWithAuth(blobB64: String, title: String, subtitle: String, promise: Promise) {
    val blob = try {
      Base64.decode(blobB64, Base64.NO_WRAP)
    } catch (e: Exception) {
      promise.reject(VaultException("E_BLOB_CORRUPT", "La llave guardada está dañada.", e))
      return
    }
    if (blob.size < 1 + IV_BYTES + TAG_BITS / 8 || blob[0] != BLOB_VERSION) {
      promise.reject(VaultException("E_BLOB_CORRUPT", "La llave guardada está dañada o es de otra versión."))
      return
    }
    val iv = blob.copyOfRange(1, 1 + IV_BYTES)
    val ct = blob.copyOfRange(1 + IV_BYTES, blob.size)
    val cipher = try {
      initCipher(Cipher.DECRYPT_MODE, iv)
    } catch (e: VaultException) {
      promise.reject(e)
      return
    } catch (e: Exception) {
      promise.reject(VaultException("E_CRYPTO", "No se pudo preparar el descifrado: ${e.message}", e))
      return
    }
    prompt(title, subtitle, cipher, promise) { authed ->
      authed.updateAAD(AAD)
      val plain = try {
        authed.doFinal(ct)
      } catch (e: AEADBadTagException) {
        throw VaultException("E_BLOB_CORRUPT", "La llave guardada no se pudo verificar.", e)
      }
      try {
        Base64.encodeToString(plain, Base64.NO_WRAP)
      } finally {
        plain.fill(0)
      }
    }
  }

  /**
   * Muestra BiometricPrompt con el CryptoObject y, tras el éxito, ejecuta
   * [onAuthed] con el cifrador ya autorizado por el hardware.
   */
  private fun prompt(
    title: String,
    subtitle: String,
    cipher: Cipher,
    promise: Promise,
    onAuthed: (Cipher) -> String,
  ) {
    val activity = appContext.currentActivity as? FragmentActivity
    if (activity == null) {
      promise.reject(VaultException("E_NO_ACTIVITY", "No hay una pantalla activa para pedir la huella."))
      return
    }
    val settled = AtomicBoolean(false)
    fun reject(e: CodedException) {
      if (settled.compareAndSet(false, true)) promise.reject(e)
    }
    activity.runOnUiThread {
      try {
        val executor = ContextCompat.getMainExecutor(activity)
        val bp = BiometricPrompt(
          activity,
          executor,
          object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
              val authed = result.cryptoObject?.cipher
              if (authed == null) {
                reject(VaultException("E_AUTH_FAILED", "El sistema no devolvió el cifrador autorizado."))
                return
              }
              try {
                val out = onAuthed(authed)
                if (settled.compareAndSet(false, true)) promise.resolve(out)
              } catch (e: VaultException) {
                reject(e)
              } catch (e: KeyPermanentlyInvalidatedException) {
                reject(VaultException("E_KEY_INVALIDATED", "Android invalidó la llave protegida.", e))
              } catch (e: Exception) {
                reject(VaultException("E_CRYPTO", "Fallo criptográfico: ${e.message}", e))
              }
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
              val cancelled = errorCode == BiometricPrompt.ERROR_USER_CANCELED ||
                errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
                errorCode == BiometricPrompt.ERROR_CANCELED
              reject(
                if (cancelled) VaultException("E_CANCELLED", "Autenticación cancelada.")
                else VaultException("E_AUTH_FAILED", "No se pudo autenticar: $errString"),
              )
            }
            // onAuthenticationFailed = un intento fallido; el diálogo sigue abierto.
          },
        )
        val info = BiometricPrompt.PromptInfo.Builder()
          .setTitle(title)
          .setSubtitle(subtitle)
          .setAllowedAuthenticators(AUTHENTICATORS)
          .build()
        bp.authenticate(info, BiometricPrompt.CryptoObject(cipher))
      } catch (e: Exception) {
        reject(VaultException("E_PROMPT", "No se pudo mostrar el diálogo: ${e.message}", e))
      }
    }
  }
}
