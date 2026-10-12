/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

package expo.modules.nidovectors

import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteOrder
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel
import kotlin.math.sqrt

/**
 * The vector index file and the exact cosine search over it. Plain JVM code
 * (no Android or Expo classes) so it is tested on a computer
 * (modules/nido-vectors/test/run.sh).
 *
 * File layout (little-endian):
 *   "NVI1" | dims:int32 | count:int32 | ids:int32[count] | norms:float32[count] | vecs:int8[count*dims]
 */
object VectorIndexCore {
  const val MAGIC = 0x3149564E // "NVI1" read as a little-endian int32
  const val HEADER = 12

  class Index(
    val buf: MappedByteBuffer,
    val dims: Int,
    val count: Int,
    val ids: IntArray,
    val norms: FloatArray,
    val vecOffset: Int,
  )

  class Result(
    val ids: IntArray,
    val scores: FloatArray,
    val gatedCount: Int,
    /** Lowest score >= floor, or NaN when nothing passed. */
    val gatedMin: Float,
    val count: Int,
  )

  /**
   * Writes `count` rows (chunk id, int8 vector of `dims` bytes) to `dest`,
   * through a temporary file renamed at the end: a half-written index is
   * never visible under `dest`.
   */
  fun write(dest: File, dims: Int, count: Int, rows: Iterator<Pair<Long, ByteArray>>) {
    require(dims in 1..4096) { "bad dims $dims" }
    require(count >= 1) { "no rows" }
    val size = HEADER.toLong() + 8L * count + count.toLong() * dims
    require(size < Int.MAX_VALUE) { "index too large ($size bytes)" }
    val tmp = File(dest.path + ".tmp")
    tmp.delete()
    try {
      RandomAccessFile(tmp, "rw").use { raf ->
        raf.setLength(size)
        val out = raf.channel.map(FileChannel.MapMode.READ_WRITE, 0, size)
        out.order(ByteOrder.LITTLE_ENDIAN)
        out.putInt(0, MAGIC)
        out.putInt(4, dims)
        out.putInt(8, count)
        val normsOffset = HEADER + 4 * count
        val vecOffset = HEADER + 8 * count
        var i = 0
        while (rows.hasNext()) {
          val (id, v) = rows.next()
          require(i < count) { "more rows than announced ($count)" }
          require(id in Int.MIN_VALUE..Int.MAX_VALUE) { "chunk id $id out of range" }
          require(v.size == dims) { "chunk $id: vector has ${v.size} bytes, expected $dims" }
          var ss = 0.0
          for (b in v) ss += (b * b).toDouble()
          out.putInt(HEADER + 4 * i, id.toInt())
          out.putFloat(normsOffset + 4 * i, sqrt(ss).toFloat())
          out.position(vecOffset + i * dims)
          out.put(v)
          i++
        }
        require(i == count) { "read $i rows, expected $count" }
        out.force()
      }
      dest.delete()
      require(tmp.renameTo(dest)) { "could not move index into place" }
    } finally {
      tmp.delete()
    }
  }

  fun open(path: String): Index {
    RandomAccessFile(path, "r").use { raf ->
      val size = raf.channel.size()
      require(size >= HEADER) { "index truncated" }
      val buf = raf.channel.map(FileChannel.MapMode.READ_ONLY, 0, size)
      buf.order(ByteOrder.LITTLE_ENDIAN)
      require(buf.getInt(0) == MAGIC) { "not a NIDO vector index" }
      val dims = buf.getInt(4)
      val n = buf.getInt(8)
      require(dims in 1..4096 && n >= 0) { "bad index header" }
      require(size == HEADER.toLong() + 8L * n + n.toLong() * dims) { "index size mismatch" }
      val ids = IntArray(n) { buf.getInt(HEADER + 4 * it) }
      val norms = FloatArray(n) { buf.getFloat(HEADER + 4 * n + 4 * it) }
      return Index(buf, dims, n, ids, norms, HEADER + 8 * n)
    }
  }

  /**
   * Top `limit` chunks by cosine with `query` among those >= floor, best
   * first (ties keep index order), plus how many passed and the lowest
   * passing score. Same cosine as cosineSimilarityInt8 in src/rag/pure.ts.
   */
  fun search(index: Index, query: DoubleArray, floor: Double, limit: Int): Result {
    val dims = index.dims
    require(query.size == dims) { "query has ${query.size} dims, index has $dims" }
    require(limit in 1..1000) { "bad limit $limit" }

    var qn = 0.0
    for (x in query) qn += x * x
    qn = sqrt(qn)
    val q = FloatArray(dims) { if (qn > 0) (query[it] / qn).toFloat() else 0f }

    val topIds = IntArray(limit)
    val topScores = FloatArray(limit)
    var size = 0
    var gated = 0
    var gatedMin = Float.NaN
    val f = floor.toFloat()

    // duplicate(): own position, so concurrent searches don't interfere.
    val src = index.buf.duplicate()
    src.position(index.vecOffset)
    val row = ByteArray(dims)
    for (i in 0 until index.count) {
      src.get(row)
      var dot = 0f
      for (k in 0 until dims) dot += q[k] * row[k]
      val norm = index.norms[i]
      val s = if (norm > 0f) dot / norm else 0f
      if (s < f) continue
      gated++
      if (gatedMin.isNaN() || s < gatedMin) gatedMin = s
      if (size == limit && s <= topScores[size - 1]) continue
      var j = if (size < limit) size++ else size - 1
      while (j > 0 && topScores[j - 1] < s) {
        topScores[j] = topScores[j - 1]
        topIds[j] = topIds[j - 1]
        j--
      }
      topScores[j] = s
      topIds[j] = index.ids[i]
    }
    return Result(topIds.copyOf(size), topScores.copyOf(size), gated, gatedMin, index.count)
  }
}
