/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

package expo.modules.nidocpr

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.ImageFormat
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Range
import android.util.Size
import androidx.core.content.ContextCompat
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.abs

/**
 * Medidor de ritmo de la RCP por cámara (0.1.76), opcional.
 *
 * El teléfono, apoyado de pie a un par de metros, mira a quien hace las
 * compresiones con la cámara frontal. Cada fotograma (baja resolución,
 * solo la luminancia) se reduce en CprMotionCore a 36 números: cuánto se
 * desplazó cada bloque de una rejilla de 4 × 3 respecto al fotograma
 * anterior. A JS solo llegan esos números, en lotes;
 * src/cpr/rateEstimator.ts calcula el ritmo. Ningún fotograma se guarda, se copia ni sale del teléfono: el
 * búfer se cierra en cuanto se mide. Sin vista previa: la pantalla es la
 * del asistente.
 */
class NidoCprCameraModule : Module() {
  private val lock = Any()
  private var thread: HandlerThread? = null
  private var handler: Handler? = null
  private var device: CameraDevice? = null
  private var session: CameraCaptureSession? = null
  private var reader: ImageReader? = null
  private var generation = 0

  private val core = CprMotionCore()
  private val batchT = ArrayList<Double>(16)
  private val batchV = ArrayList<Double>(16 * CprMotionCore.BLOCKS * 3)

  override fun definition() = ModuleDefinition {
    Name("NidoCprCamera")
    Events("onCprCameraSamples", "onCprCameraError")

    // Pide el permiso de cámara si hace falta y empieza. Resuelve true si
    // la cámara arrancó, false si no hay permiso o no hay cámara.
    AsyncFunction("start") { promise: Promise ->
      val ctx = appContext.reactContext?.applicationContext
      if (ctx == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
        promise.resolve(open(ctx))
        return@AsyncFunction
      }
      val permissions = appContext.permissions
      if (permissions == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      permissions.askForPermissions({ result ->
        val granted = result[Manifest.permission.CAMERA]?.status == PermissionsStatus.GRANTED
        promise.resolve(if (granted) open(ctx) else false)
      }, Manifest.permission.CAMERA)
    }

    Function("stop") {
      close()
      true
    }

    OnDestroy { close() }
  }

  @SuppressLint("MissingPermission")
  private fun open(ctx: Context): Boolean {
    synchronized(lock) {
      closeLocked()
      val manager = ctx.getSystemService(Context.CAMERA_SERVICE) as? CameraManager ?: return false
      val id = try {
        pickCamera(manager)
      } catch (_: Exception) {
        null
      } ?: return false
      val chars = manager.getCameraCharacteristics(id)
      val map = chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP) ?: return false
      val size = pickSize(map.getOutputSizes(ImageFormat.YUV_420_888) ?: return false)
      val fps = pickFps(chars.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES))

      val t = HandlerThread("nido-cpr-camera").also { it.start() }
      val h = Handler(t.looper)
      val r = ImageReader.newInstance(size.width, size.height, ImageFormat.YUV_420_888, 3)
      val gen = ++generation
      thread = t
      handler = h
      reader = r
      core.reset()
      batchT.clear()
      batchV.clear()

      r.setOnImageAvailableListener({ ir ->
        val img = try { ir.acquireLatestImage() } catch (_: Exception) { null } ?: return@setOnImageAvailableListener
        try {
          if (gen == generation) analyse(img.planes[0].buffer, img.planes[0].rowStride, img.width, img.height)
        } catch (_: Exception) {
        } finally {
          img.close()
        }
      }, h)

      try {
        manager.openCamera(id, object : CameraDevice.StateCallback() {
          override fun onOpened(camera: CameraDevice) {
            synchronized(lock) {
              if (gen != generation) {
                camera.close()
                return
              }
              device = camera
            }
            try {
              @Suppress("DEPRECATION")
              camera.createCaptureSession(listOf(r.surface), object : CameraCaptureSession.StateCallback() {
                override fun onConfigured(s: CameraCaptureSession) {
                  synchronized(lock) {
                    if (gen != generation) {
                      s.close()
                      return
                    }
                    session = s
                  }
                  try {
                    val req = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply {
                      addTarget(r.surface)
                      if (fps != null) set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, fps)
                    }
                    s.setRepeatingRequest(req.build(), null, h)
                  } catch (e: Exception) {
                    fail("session")
                  }
                }

                override fun onConfigureFailed(s: CameraCaptureSession) = fail("configure")
              }, h)
            } catch (e: Exception) {
              fail("session")
            }
          }

          override fun onDisconnected(camera: CameraDevice) {
            camera.close()
            fail("disconnected")
          }

          override fun onError(camera: CameraDevice, error: Int) {
            camera.close()
            fail("camera-$error")
          }
        }, h)
      } catch (_: Exception) {
        closeLocked()
        return false
      }
      return true
    }
  }

  /** Frontal si la hay (mira a quien comprime, con la pantalla hacia él); si no, la trasera. */
  private fun pickCamera(manager: CameraManager): String? {
    var back: String? = null
    for (id in manager.cameraIdList) {
      val facing = manager.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING)
      if (facing == CameraCharacteristics.LENS_FACING_FRONT) return id
      if (facing == CameraCharacteristics.LENS_FACING_BACK && back == null) back = id
    }
    return back
  }

  /** La más pequeña con al menos 240 filas: basta para el movimiento y gasta poco. */
  private fun pickSize(sizes: Array<Size>): Size =
    sizes.filter { it.height >= 240 && it.width >= 320 }.minByOrNull { it.width * it.height }
      ?: sizes.minByOrNull { abs(it.width * it.height - 320 * 240) }!!

  /** El rango con el mínimo más alto hasta 30: un fotograma por cada ~33 ms. */
  private fun pickFps(ranges: Array<Range<Int>>?): Range<Int>? =
    ranges?.filter { it.upper <= 30 }?.maxWithOrNull(compareBy<Range<Int>>({ it.lower }, { it.upper }))

  /**
   * Un fotograma → 36 números (CprMotionCore, el mismo algoritmo que
   * src/cpr/frameMotion.ts). Se mandan a JS en lotes de 8 fotogramas.
   */
  private fun analyse(buf: java.nio.ByteBuffer, rowStride: Int, width: Int, height: Int) {
    val out = core.analyse(width, height, rowStride) { i -> buf.get(i).toInt() and 0xff } ?: return
    batchT.add(SystemClock.uptimeMillis().toDouble())
    for (v in out) batchV.add(v)
    if (batchT.size >= 8) {
      sendEvent(
        "onCprCameraSamples",
        mapOf("t" to batchT.toDoubleArray(), "v" to batchV.toDoubleArray(), "stride" to CprMotionCore.BLOCKS * 3),
      )
      batchT.clear()
      batchV.clear()
    }
  }

  private fun fail(reason: String) {
    sendEvent("onCprCameraError", mapOf("reason" to reason))
    close()
  }

  private fun close() {
    synchronized(lock) { closeLocked() }
  }

  private fun closeLocked() {
    generation++
    try { session?.close() } catch (_: Exception) {}
    session = null
    try { device?.close() } catch (_: Exception) {}
    device = null
    try { reader?.close() } catch (_: Exception) {}
    reader = null
    thread?.quitSafely()
    thread = null
    handler = null
    core.reset()
  }
}
