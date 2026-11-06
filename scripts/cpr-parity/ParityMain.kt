/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Arnés de scripts/check-cpr-motion-parity.mjs: lee fotogramas crudos
 * (luminancia) y escribe, por fotograma, los 36 números de CprMotionCore.
 * Uso: java -jar parity.jar <frames.bin> <ancho> <alto> <n>
 */

import expo.modules.nidocpr.CprMotionCore
import java.io.File

fun main(args: Array<String>) {
  val bytes = File(args[0]).readBytes()
  val w = args[1].toInt()
  val h = args[2].toInt()
  val n = args[3].toInt()
  val core = CprMotionCore()
  val sb = StringBuilder("[")
  for (k in 0 until n) {
    val off = k * w * h
    val out = core.analyse(w, h, w) { i -> bytes[off + i].toInt() and 0xff }
    if (k > 0) sb.append(',')
    if (out == null) sb.append("null") else sb.append(out.joinToString(",", "[", "]") { it.toString() })
  }
  sb.append(']')
  println(sb)
}
