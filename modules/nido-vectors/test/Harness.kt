// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.
//
// Test harness for modules/nido-vectors VectorIndexCore (plain JVM).
// Reads rows.bin (id:int64 LE + dims int8) and queries.bin (float64 LE),
// writes the index, runs every query and prints JSON lines with the results.
import expo.modules.nidovectors.VectorIndexCore
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

fun main(args: Array<String>) {
  val dir = File(args[0])
  val dims = args[1].toInt()
  val floor = args[2].toDouble()
  val limit = args[3].toInt()
  val rowsBuf = ByteBuffer.wrap(File(dir, "rows.bin").readBytes()).order(ByteOrder.LITTLE_ENDIAN)
  val n = rowsBuf.capacity() / (8 + dims)
  val rows = (0 until n).map {
    val id = rowsBuf.getLong()
    val v = ByteArray(dims)
    rowsBuf.get(v)
    Pair(id, v)
  }
  val index = File(dir, "test.nvi")
  VectorIndexCore.write(index, dims, n, rows.iterator())
  val idx = VectorIndexCore.open(index.path)
  val qBuf = ByteBuffer.wrap(File(dir, "queries.bin").readBytes()).order(ByteOrder.LITTLE_ENDIAN)
  val nq = qBuf.capacity() / (8 * dims)
  val out = StringBuilder()
  for (qi in 0 until nq) {
    val q = DoubleArray(dims) { qBuf.getDouble() }
    val r = VectorIndexCore.search(idx, q, floor, limit)
    out.append("{\"ids\":[").append(r.ids.joinToString(",")).append("],\"scores\":[")
      .append(r.scores.joinToString(",")).append("],\"gatedCount\":").append(r.gatedCount)
      .append(",\"gatedMin\":").append(if (r.gatedMin.isNaN()) "null" else r.gatedMin.toString())
      .append(",\"count\":").append(r.count).append("}\n")
  }
  File(dir, "results.jsonl").writeText(out.toString())
}
