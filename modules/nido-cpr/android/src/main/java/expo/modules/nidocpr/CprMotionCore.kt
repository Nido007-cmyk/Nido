/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

package expo.modules.nidocpr

import kotlin.math.abs
import kotlin.math.sqrt

/**
 * El análisis de cada fotograma del medidor de ritmo de la RCP, sin nada
 * de Android: el mismo algoritmo, operación por operación y en doble
 * precisión, que src/cpr/frameMotion.ts. Allí está probado de punta a
 * punta con vídeo sintético; scripts/check-cpr-motion-parity.mjs compila
 * este fichero con kotlinc y comprueba que da los mismos números que el
 * de TypeScript sobre los mismos fotogramas.
 *
 * Rejilla de 4 × 3 bloques. Por bloque: perfil por filas (1 de cada 2
 * filas, media de 1 de cada 4 píxeles) y por columnas (1 de cada 2
 * columnas, media de 1 de cada 4 filas), normalizados, y su
 * desplazamiento respecto al fotograma anterior con media muestra de
 * precisión. Salida: 36 números, [dy, dx, e] por bloque.
 */
class CprMotionCore {
  companion object {
    const val GRID_X = 4
    const val GRID_Y = 3
    const val BLOCKS = GRID_X * GRID_Y
    const val MAX_SHIFT = 6
  }

  private var prevRows: Array<DoubleArray>? = null
  private var prevCols: Array<DoubleArray>? = null
  private var prevW = -1
  private var prevH = -1

  fun reset() {
    prevRows = null
    prevCols = null
    prevW = -1
    prevH = -1
  }

  /** `luma(i)` devuelve el byte de luminancia (0..255) en el índice i = y × rowStride + x. */
  fun analyse(width: Int, height: Int, rowStride: Int, luma: (Int) -> Int): DoubleArray? {
    val rows = Array(BLOCKS) { DoubleArray(0) }
    val cols = Array(BLOCKS) { DoubleArray(0) }
    var b = 0
    for (by in 0 until GRID_Y) {
      for (bx in 0 until GRID_X) {
        val bw = width / GRID_X
        val bh = height / GRID_Y
        val x0 = bx * bw
        val y0 = by * bh
        val nr = bh / 2
        val nc = bw / 2
        val rp = DoubleArray(nr)
        val cp = DoubleArray(nc)
        for (r in 0 until nr) {
          val base = (y0 + r * 2) * rowStride + x0
          var sum = 0.0
          var n = 0
          var c = 0
          while (c < bw) {
            sum += luma(base + c)
            n++
            c += 4
          }
          rp[r] = sum / n
        }
        for (c in 0 until nc) {
          val x = x0 + c * 2
          var sum = 0.0
          var n = 0
          var r = 0
          while (r < bh) {
            sum += luma((y0 + r) * rowStride + x)
            n++
            r += 4
          }
          cp[c] = sum / n
        }
        normalise(rp)
        normalise(cp)
        rows[b] = rp
        cols[b] = cp
        b++
      }
    }
    val pr = prevRows
    val pc = prevCols
    val same = prevW == width && prevH == height
    prevRows = rows
    prevCols = cols
    prevW = width
    prevH = height
    if (pr == null || pc == null || !same) return null
    val out = DoubleArray(BLOCKS * 3)
    for (i in 0 until BLOCKS) {
      val v = shiftOf(rows[i], pr[i])
      val h = shiftOf(cols[i], pc[i])
      out[i * 3] = v[0]
      out[i * 3 + 1] = h[0]
      out[i * 3 + 2] = v[1]
    }
    return out
  }

  private fun normalise(p: DoubleArray) {
    var mean = 0.0
    for (i in p.indices) mean += p[i]
    mean /= p.size
    var sq = 0.0
    for (i in p.indices) sq += (p[i] - mean) * (p[i] - mean)
    val sd = sqrt(sq / p.size).coerceAtLeast(1.0)
    for (i in p.indices) p[i] = (p[i] - mean) / sd
  }

  /** [desplazamiento, cambio sin desplazar]. */
  fun shiftOf(cur: DoubleArray, prev: DoubleArray): DoubleArray {
    val len = cur.size
    if (len <= 2 * MAX_SHIFT + 4 || prev.size != len) return doubleArrayOf(0.0, 0.0)
    val errs = DoubleArray(2 * MAX_SHIFT + 1)
    for (s in -MAX_SHIFT..MAX_SHIFT) {
      var e = 0.0
      var n = 0
      for (i in MAX_SHIFT until len - MAX_SHIFT) {
        e += abs(cur[i] - prev[i + s])
        n++
      }
      errs[s + MAX_SHIFT] = e / n
    }
    var best = 0
    for (i in 1 until errs.size) if (errs[i] < errs[best]) best = i
    var d = (best - MAX_SHIFT).toDouble()
    if (best >= 1 && best < errs.size - 1) {
      val a = errs[best - 1]
      val bb = errs[best]
      val c = errs[best + 1]
      val den = a - 2 * bb + c
      if (den > 1e-6) d += (0.5 * (a - c)) / den
    }
    return doubleArrayOf(d, errs[MAX_SHIFT])
  }
}
