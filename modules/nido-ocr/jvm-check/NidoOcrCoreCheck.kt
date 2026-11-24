/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
package expo.modules.nidoocr

import java.io.File

/**
 * Batería JVM del núcleo del OCR (auditoría 0.1.112, bloque 6). El primer
 * argumento es la carpeta tessdata del repositorio: sus ficheros tienen
 * que coincidir con los hashes fijados, o el OCR se negaría a arrancar en
 * el teléfono.
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

fun main(args: Array<String>) {
  val C = NidoOcrCore
  check("imagen pequeña intacta", C.dimensions(800, 600) == (800 to 600))
  val (w, h) = C.dimensions(4000, 3000)
  check("12 MP baja a ≤4 MP", w.toLong() * h <= 4_000_000 && w > 2000)
  check("proporción conservada", kotlin.math.abs(w.toDouble() / h - 4.0 / 3.0) < 0.01)
  val (pw, ph) = C.dimensions(20000, 100)
  check("lado largo ≤4096", pw <= 4096 && ph >= 1)
  check("1×1 no da 0", C.dimensions(1, 1) == (1 to 1))
  check("tira extrema no da 0", C.dimensions(100_000, 1).second == 1)
  check("ancho 0 rechazado", runCatching { C.dimensions(0, 10) }.isFailure)

  check("A4 a 300 dpi", C.renderSize(595, 842) == (2479 to 3508))
  val (rw, rh) = C.renderSize(5000, 5000)
  check("página enorme ≤12 MP y ≤4096", rw.toLong() * rh <= 12_000_000 && rw <= 4096 && rh <= 4096)
  check("página 1×1 no da 0", C.renderSize(1, 1).first >= 1)

  check("vacía es escaneada", C.isScannedText("   \n "))
  check("número de página es escaneada", C.isScannedText("  12 \n"))
  check("15 caracteres, escaneada", C.isScannedText("a".repeat(15)))
  check("16 caracteres, texto", !C.isScannedText("a".repeat(16)))

  check("sha256 vacío", C.sha256Hex(ByteArray(0)) == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
  check("sha256 abc", C.sha256Hex("abc".toByteArray()) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")

  val dir = File(args.getOrNull(0) ?: "")
  check("hay carpeta tessdata", dir.isDirectory)
  check("tres idiomas fijados", C.TRAINEDDATA_SHA256.keys == setOf("eng", "spa", "por"))
  for ((lang, expected) in C.TRAINEDDATA_SHA256) {
    val f = File(dir, "$lang.traineddata")
    check("$lang.traineddata coincide con su hash", f.isFile && C.sha256Hex(f.readBytes()) == expected)
  }

  if (failures == 0) println("check-ocr-core: PASS ($checks comprobaciones)")
  else println("check-ocr-core: FAIL ($failures de $checks)")
}
