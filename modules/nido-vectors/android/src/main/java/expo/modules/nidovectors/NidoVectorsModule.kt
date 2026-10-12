/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

package expo.modules.nidovectors

import android.database.DatabaseUtils
import android.database.sqlite.SQLiteDatabase
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * Exact (brute-force) cosine search over a knowledge pack's int8 vectors.
 *
 * Why native: a pack such as Wikipedia Vital has ~116k chunks. Scoring all of
 * them in JS means reading ~44 MB of blobs from SQLite and ~44M multiply-adds
 * on Hermes per question — seconds on a phone. So packs were searched
 * keyword-first (FTS5 picks candidates, vectors only re-rank them), which can
 * never find an English article for a Spanish question. Here the vectors are
 * copied ONCE into a flat index file next to the pack and memory-mapped; a
 * full scan is a tight loop over bytes (VectorIndexCore).
 *
 * Only ids and scores cross to JS; the text is read from the pack by id.
 */
class NidoVectorsModule : Module() {
  companion object {
    private val cache = ConcurrentHashMap<String, VectorIndexCore.Index>()
  }

  override fun definition() = ModuleDefinition {
    Name("NidoVectors")

    // One-time copy of a pack's vectors into an index file (off the main thread).
    AsyncFunction("buildIndex") { sqlitePath: String, indexPath: String, dims: Int ->
      buildIndex(sqlitePath, indexPath, dims)
    }

    // Top `limit` chunks with cosine >= floor, best first, plus how many
    // passed the floor and the lowest passing score (the app's margin
    // pruning looks at the whole range that passed, not just the top).
    AsyncFunction("search") { indexPath: String, query: List<Double>, floor: Double, limit: Int ->
      val index = cache[indexPath] ?: VectorIndexCore.open(indexPath).also { cache[indexPath] = it }
      val r = VectorIndexCore.search(index, query.toDoubleArray(), floor, limit)
      mapOf(
        "ids" to r.ids.toList(),
        "scores" to r.scores.map { it.toDouble() },
        "gatedCount" to r.gatedCount,
        "gatedMin" to if (r.gatedMin.isNaN()) null else r.gatedMin.toDouble(),
        "count" to r.count,
      )
    }

    Function("release") { indexPath: String ->
      cache.remove(indexPath)
      true
    }
  }

  private fun buildIndex(sqlitePath: String, indexPath: String, dims: Int): Int {
    cache.remove(indexPath)
    val db = SQLiteDatabase.openDatabase(
      sqlitePath,
      null,
      SQLiteDatabase.OPEN_READONLY or SQLiteDatabase.NO_LOCALIZED_COLLATORS,
    )
    try {
      val count = DatabaseUtils.longForQuery(db, "SELECT COUNT(*) FROM chunks", null)
      require(count in 1..Int.MAX_VALUE.toLong()) { "pack has $count chunks" }
      db.rawQuery("SELECT id, vec FROM chunks ORDER BY id", null).use { c ->
        val rows = object : Iterator<Pair<Long, ByteArray>> {
          private var advanced = false
          private var has = false
          override fun hasNext(): Boolean {
            if (!advanced) {
              has = c.moveToNext()
              advanced = true
            }
            return has
          }
          override fun next(): Pair<Long, ByteArray> {
            if (!hasNext()) throw NoSuchElementException()
            advanced = false
            return Pair(c.getLong(0), c.getBlob(1) ?: ByteArray(0))
          }
        }
        VectorIndexCore.write(File(indexPath), dims, count.toInt(), rows)
      }
      return count.toInt()
    } finally {
      db.close()
    }
  }
}
