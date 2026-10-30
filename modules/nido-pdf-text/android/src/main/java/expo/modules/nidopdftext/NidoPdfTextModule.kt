/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

package expo.modules.nidopdftext

import android.content.Context
import android.net.Uri
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.io.MemoryUsageSetting
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException
import com.tom_roush.pdfbox.text.PDFTextStripper
import com.tom_roush.pdfbox.text.TextPosition
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.InputStream
import java.io.Writer

/**
 * PDF text extraction with hard limits (audit 2026-10-29).
 *
 * expo-pdf-text-extract returned the WHOLE text of a PDF in one string, so a
 * small PDF that unpacks into hundreds of MB of text could exhaust memory
 * before NIDO could measure it. Here:
 *  - the document is parsed with temp-file buffers (MemoryUsageSetting
 *    .setupTempFileOnly in the app cache), not the Java heap;
 *  - a document with more than `maxPages` pages is refused before any text
 *    is extracted;
 *  - characters are counted as the page is read (processTextPosition) and
 *    the extraction stops as soon as it passes `maxChars`, even in the middle
 *    of one huge page; the Writer has the same limit as a second guard.
 *
 * Error codes: PASSWORD_REQUIRED, TOO_MANY_PAGES, TEXT_TOO_LARGE,
 * PDF_LOAD_ERROR, PDF_EXTRACTION_ERROR.
 */
class NidoPdfTextModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is null" }

  override fun definition() = ModuleDefinition {
    Name("NidoPdfText")

    OnCreate {
      try {
        PDFBoxResourceLoader.init(context)
      } catch (_: Exception) {
        // extractText reports PDF_LOAD_ERROR if the engine can't start.
      }
    }

    AsyncFunction("extractText") { uri: String, maxChars: Int, maxPages: Int, promise: Promise ->
      try {
        promise.resolve(extract(uri, maxChars, maxPages))
      } catch (e: InvalidPasswordException) {
        promise.reject("PASSWORD_REQUIRED", "PDF requires a password", e)
      } catch (e: TooManyPagesException) {
        promise.reject("TOO_MANY_PAGES", "PDF has ${e.pages} pages (max $maxPages)", null)
      } catch (e: TextTooLargeException) {
        promise.reject("TEXT_TOO_LARGE", "PDF text is larger than $maxChars characters", null)
      } catch (e: TextTooLargeWhileReading) {
        promise.reject("TEXT_TOO_LARGE", "PDF text is larger than $maxChars characters", null)
      } catch (e: OutOfMemoryError) {
        promise.reject("TEXT_TOO_LARGE", "PDF too large to read on this phone", null)
      } catch (e: java.io.IOException) {
        promise.reject("PDF_LOAD_ERROR", "Couldn't read the PDF: ${e.message}", e)
      } catch (e: Exception) {
        promise.reject("PDF_EXTRACTION_ERROR", "Couldn't extract text: ${e.message}", e)
      }
    }
  }

  private class TooManyPagesException(val pages: Int) : Exception()
  private class TextTooLargeException : java.io.IOException("text too large")
  /** Unchecked on purpose: PDFBox logs and skips some IOExceptions inside form XObjects. */
  private class TextTooLargeWhileReading : RuntimeException("text too large")

  /** Counts characters while the page is read, before they pile up in memory. */
  private class CappedStripper(private val maxChars: Int) : PDFTextStripper() {
    private var count = 0L
    override fun processTextPosition(text: TextPosition) {
      count += (text.unicode?.length ?: 1).toLong()
      if (count > maxChars) throw TextTooLargeWhileReading()
      super.processTextPosition(text)
    }
  }

  /** Collects text and stops the extraction as soon as it passes the limit. */
  private class CappedWriter(private val maxChars: Int) : Writer() {
    val out = StringBuilder()
    override fun write(cbuf: CharArray, off: Int, len: Int) {
      if (out.length.toLong() + len > maxChars) throw TextTooLargeException()
      out.append(cbuf, off, len)
    }
    override fun flush() {}
    override fun close() {}
  }

  private fun extract(uri: String, maxChars: Int, maxPages: Int): String {
    val memory = MemoryUsageSetting.setupTempFileOnly().setTempDir(context.cacheDir)
    return open(uri).use { stream ->
      PDDocument.load(stream, "", memory).use { document ->
        val pages = document.numberOfPages
        if (pages > maxPages) throw TooManyPagesException(pages)
        val writer = CappedWriter(maxChars)
        CappedStripper(maxChars).apply { sortByPosition = true }.writeText(document, writer)
        writer.out.toString()
      }
    }
  }

  private fun open(uri: String): InputStream = when {
    uri.startsWith("content://") ->
      context.contentResolver.openInputStream(Uri.parse(uri))
        ?: throw java.io.IOException("Cannot open content URI")
    uri.startsWith("file://") -> File(Uri.parse(uri).path ?: uri.removePrefix("file://")).inputStream()
    else -> File(uri).inputStream()
  }
}
