/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
package expo.modules.nidoocr

import java.security.MessageDigest
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Lógica pura del OCR, sin Android (auditoría 0.1.112, bloque 6): tamaños
 * de imagen y de página renderizada, la regla de «página escaneada» y el
 * hash de los datos de idioma. La CI la compila y la prueba en la JVM
 * (jvm-check/NidoOcrCoreCheck.kt), incluido que los traineddata del
 * repositorio coinciden con los hashes fijados. Tesseract y el render de
 * PDF no se pueden probar fuera del teléfono.
 */
internal object NidoOcrCore {
  /** A page with less text than this counts as scanned. */
  const val EMPTY_PAGE_MAX_CHARS = 16
  const val RENDER_DPI = 300.0
  const val MAX_RENDER_PIXELS = 12_000_000.0

  /** Image pixel budget, from Field Atlas's ImageTextReader.dimensions. */
  fun dimensions(width: Int, height: Int): Pair<Int, Int> {
    require(width > 0 && height > 0)
    val scale = minOf(1.0, sqrt(4_000_000.0 / (width.toDouble() * height)), 4096.0 / maxOf(width, height))
    return maxOf(1, (width * scale).toInt()) to maxOf(1, (height * scale).toInt())
  }

  /** Bitmap size for a PDF page of [width]×[height] points: 300 dpi, capped. */
  fun renderSize(width: Int, height: Int): Pair<Int, Int> {
    val scale = min(
      RENDER_DPI / 72.0,
      min(4096.0 / max(width, height), sqrt(MAX_RENDER_PIXELS / (width.toDouble() * height))),
    )
    return max(1, (width * scale).toInt()) to max(1, (height * scale).toInt())
  }

  /** true if a page's text layer is empty or nearly so (a header over a scan). */
  fun isScannedText(text: String): Boolean = text.trim().length < EMPTY_PAGE_MAX_CHARS

  /** SHA-256 of each bundled traineddata, recorded in docs/OCR_DESIGN.md (pinned tessdata_fast revision). */
  val TRAINEDDATA_SHA256: Map<String, String> = mapOf(
    "eng" to "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2",
    "spa" to "6f2e04d02774a18f01bed44b1111f2cd7f3ba7ac9dc4373cd3f898a40ea6b464",
    "por" to "c4932b937207a9514b7514d518b931a99938c02a28a5a5a553f8599ed58b7deb",
  )

  fun sha256Hex(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
}
