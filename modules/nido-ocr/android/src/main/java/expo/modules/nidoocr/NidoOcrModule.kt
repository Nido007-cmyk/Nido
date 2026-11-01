/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

package expo.modules.nidoocr

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.ImageDecoder
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import com.googlecode.tesseract.android.TessBaseAPI
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.io.MemoryUsageSetting
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException
import com.tom_roush.pdfbox.text.PDFTextStripper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * On-device OCR for imported documents (programa «Lo mejor de la
 * bounty», pieza 05 de la colección: Field Atlas, Apache-2.0 — the
 * engine wiring, the asset-to-files data preparation with hash
 * verification and the image downscale follow its ImageTextReader;
 * design and pins in docs/OCR_DESIGN.md).
 *
 * Two entries, exactly the seam's interface (src/services/ocr.ts):
 *  - recognize(uri, tessdataLang): the printed text of one image.
 *  - recognizePdfPages(uri, pages, tessdataLang): the text of a
 *    PDF's scanned pages. `pages` are 0-based indices; an empty
 *    list means "find the pages whose text layer is empty or
 *    nearly empty yourself" — the TS side cannot enumerate them
 *    (nido-pdf-text returns whole-document text), so detection
 *    lives here: PDFBox reads each page's text layer and only the
 *    scanned pages are rendered (PdfRenderer, platform) and
 *    OCR'd, at most [MAX_OCR_PAGES] of them.
 *
 * The engine's language data (tessdata_fast, pinned revision)
 * ships INSIDE the app as this module's assets, is copied to the
 * app's no-backup files on first use and is SHA-256-verified
 * against the hashes recorded in docs/OCR_DESIGN.md before
 * Tesseract ever initialises. Nothing here uses the network.
 *
 * Error codes: OCR_UNAVAILABLE (no data / engine could not
 * start), PASSWORD_REQUIRED, OCR_FAILED.
 */
class NidoOcrModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is null" }

  override fun definition() = ModuleDefinition {
    Name("NidoOcr")

    AsyncFunction("recognize") { uri: String, tessdataLang: String, promise: Promise ->
      try {
        promise.resolve(recognizeImage(uri, tessdataLang))
      } catch (e: OcrUnavailableException) {
        promise.reject("OCR_UNAVAILABLE", e.message, e)
      } catch (e: Exception) {
        promise.reject("OCR_FAILED", "Couldn't recognize text: ${e.message}", e)
      }
    }

    AsyncFunction("recognizePdfPages") { uri: String, pages: List<Int>, tessdataLang: String, promise: Promise ->
      try {
        promise.resolve(recognizePdf(uri, pages, tessdataLang))
      } catch (e: OcrUnavailableException) {
        promise.reject("OCR_UNAVAILABLE", e.message, e)
      } catch (e: InvalidPasswordException) {
        promise.reject("PASSWORD_REQUIRED", "PDF requires a password", e)
      } catch (e: Exception) {
        promise.reject("OCR_FAILED", "Couldn't recognize the PDF's pages: ${e.message}", e)
      }
    }
  }

  private class OcrUnavailableException(message: String) : Exception(message)

  // ----------------------------------------------------------------
  // Language data: assets -> noBackupFilesDir, hash-verified.
  // ----------------------------------------------------------------

  private val preparedLangs = mutableSetOf<String>()
  private val dataLock = Any()

  /** Directory Tesseract is initialised against (contains tessdata/). */
  private fun tessRoot(lang: String): File {
    val expected = TRAINEDDATA_SHA256[lang]
      ?: throw OcrUnavailableException("No OCR language data for '$lang'")
    val root = File(context.noBackupFilesDir, "ocr")
    val dir = File(root, "tessdata")
    val file = File(dir, "$lang.traineddata")
    synchronized(dataLock) {
      if (lang !in preparedLangs) {
        if (!file.isFile || sha256(file.readBytes()) != expected) {
          check(dir.mkdirs() || dir.isDirectory) { "Cannot create the OCR data directory" }
          val bytes = context.assets.open("tessdata/$lang.traineddata").use { it.readBytes() }
          if (sha256(bytes) != expected) {
            throw OcrUnavailableException("The bundled OCR data for '$lang' failed its integrity check")
          }
          file.writeBytes(bytes)
        }
        preparedLangs += lang
      }
    }
    return root
  }

  private fun newEngine(lang: String): TessBaseAPI {
    val root = tessRoot(lang)
    val tess = TessBaseAPI()
    try {
      if (!tess.init(root.absolutePath, lang)) {
        throw OcrUnavailableException("Text recognition could not start for '$lang'")
      }
      return tess
    } catch (e: OcrUnavailableException) {
      tess.recycle()
      throw e
    } catch (e: Exception) {
      tess.recycle()
      throw OcrUnavailableException("Text recognition could not start: ${e.message}")
    }
  }

  // ----------------------------------------------------------------
  // One image.
  // ----------------------------------------------------------------

  private fun recognizeImage(uri: String, lang: String): String {
    val bitmap = decode(uri)
    try {
      val tess = newEngine(lang)
      try {
        tess.setImage(bitmap)
        return tess.utF8Text.orEmpty()
      } finally {
        tess.clear()
        tess.recycle()
      }
    } finally {
      bitmap.recycle()
    }
  }

  /** Decodes an image downscaled like Field Atlas does (Tesseract needs a software bitmap). */
  private fun decode(uri: String): Bitmap {
    val source = when {
      uri.startsWith("content://") -> ImageDecoder.createSource(context.contentResolver, Uri.parse(uri))
      uri.startsWith("file://") -> ImageDecoder.createSource(File(Uri.parse(uri).path ?: uri.removePrefix("file://")))
      else -> ImageDecoder.createSource(File(uri))
    }
    return ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
      val (w, h) = dimensions(info.size.width, info.size.height)
      decoder.setTargetSize(w, h)
      decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
    }
  }

  // ----------------------------------------------------------------
  // A PDF's scanned pages.
  // ----------------------------------------------------------------

  private fun recognizePdf(uri: String, pages: List<Int>, lang: String): String {
    try {
      PDFBoxResourceLoader.init(context)
    } catch (_: Exception) {
      // recognizePdf reports OCR_FAILED if the engine can't start.
    }
    val memory = MemoryUsageSetting.setupTempFileOnly().setTempDir(context.cacheDir)
    val pageCount = openStream(uri).use { stream ->
      PDDocument.load(stream, "", memory).use { it.numberOfPages }
    }
    if (pageCount <= 0) return ""

    val targets = if (pages.isNotEmpty()) {
      pages.filter { it in 0 until pageCount }.distinct().sorted().take(MAX_OCR_PAGES)
    } else {
      scannedPages(uri, pageCount, memory)
    }
    if (targets.isEmpty()) return ""

    val tess = newEngine(lang)
    try {
      return renderAndRecognize(uri, targets, tess)
    } finally {
      tess.clear()
      tess.recycle()
    }
  }

  /** Pages whose text layer is empty or nearly empty (a header over a scan), in order, capped. */
  private fun scannedPages(uri: String, pageCount: Int, memory: MemoryUsageSetting): List<Int> {
    val found = mutableListOf<Int>()
    openStream(uri).use { stream ->
      PDDocument.load(stream, "", memory).use { document ->
        val stripper = PDFTextStripper()
        for (page in 1..pageCount) {
          stripper.startPage = page
          stripper.endPage = page
          val text = stripper.getText(document)
          if (text.trim().length < EMPTY_PAGE_MAX_CHARS) {
            found += page - 1
            if (found.size >= MAX_OCR_PAGES) break
          }
        }
      }
    }
    return found
  }

  private fun renderAndRecognize(uri: String, targets: List<Int>, tess: TessBaseAPI): String {
    val out = StringBuilder()
    openDescriptor(uri).use { fd ->
      PdfRenderer(fd).use { renderer ->
        for (pageIndex in targets) {
          if (pageIndex >= renderer.pageCount) break
          renderer.openPage(pageIndex).use { page ->
            val bitmap = render(page)
            try {
              tess.setImage(bitmap)
              val text = tess.utF8Text.orEmpty()
              tess.clear()
              if (text.isNotBlank()) {
                if (out.isNotEmpty()) out.append("\n\n")
                out.append(text.trim())
              }
            } finally {
              bitmap.recycle()
            }
          }
        }
      }
    }
    return out.toString()
  }

  /** Renders one page at print resolution (300 dpi), capped so a huge page can't exhaust memory. */
  private fun render(page: PdfRenderer.Page): Bitmap {
    val scale = min(
      RENDER_DPI / 72.0,
      min(4096.0 / max(page.width, page.height), sqrt(MAX_RENDER_PIXELS / (page.width.toDouble() * page.height))),
    )
    val w = max(1, (page.width * scale).toInt())
    val h = max(1, (page.height * scale).toInt())
    val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    bitmap.eraseColor(Color.WHITE)
    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
    return bitmap
  }

  // ----------------------------------------------------------------
  // Opening URIs the way modules/nido-pdf-text does.
  // ----------------------------------------------------------------

  private fun openStream(uri: String): InputStream = when {
    uri.startsWith("content://") ->
      context.contentResolver.openInputStream(Uri.parse(uri))
        ?: throw java.io.IOException("Cannot open content URI")
    uri.startsWith("file://") -> File(Uri.parse(uri).path ?: uri.removePrefix("file://")).inputStream()
    else -> File(uri).inputStream()
  }

  private fun openDescriptor(uri: String): ParcelFileDescriptor = when {
    uri.startsWith("content://") ->
      context.contentResolver.openFileDescriptor(Uri.parse(uri), "r")
        ?: throw java.io.IOException("Cannot open content URI")
    uri.startsWith("file://") ->
      ParcelFileDescriptor.open(File(Uri.parse(uri).path ?: uri.removePrefix("file://")), ParcelFileDescriptor.MODE_READ_ONLY)
    else -> ParcelFileDescriptor.open(File(uri), ParcelFileDescriptor.MODE_READ_ONLY)
  }

  companion object {
    /** Scanned PDF pages that go through OCR (attachmentPolicy.ts: Field Atlas's cap; OCR is slow). */
    const val MAX_OCR_PAGES = 30

    /** A page with less text than this counts as scanned (a page number or a short header over an image). */
    const val EMPTY_PAGE_MAX_CHARS = 16

    /** Print resolution for rendered pages. */
    const val RENDER_DPI = 300.0

    /** Rendered-page pixel budget. */
    const val MAX_RENDER_PIXELS = 12_000_000.0

    /** Image pixel budget, from Field Atlas's ImageTextReader.dimensions. */
    fun dimensions(width: Int, height: Int): Pair<Int, Int> {
      require(width > 0 && height > 0)
      val scale = minOf(1.0, sqrt(4_000_000.0 / (width.toDouble() * height)), 4096.0 / maxOf(width, height))
      return maxOf(1, (width * scale).toInt()) to maxOf(1, (height * scale).toInt())
    }

    /** SHA-256 of each bundled traineddata, recorded in docs/OCR_DESIGN.md (pinned tessdata_fast revision). */
    val TRAINEDDATA_SHA256: Map<String, String> = mapOf(
      "eng" to "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2",
      "spa" to "6f2e04d02774a18f01bed44b1111f2cd7f3ba7ac9dc4373cd3f898a40ea6b464",
      "por" to "c4932b937207a9514b7514d518b931a99938c02a28a5a5a553f8599ed58b7deb",
    )

    private fun sha256(bytes: ByteArray): String =
      MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
  }
}
