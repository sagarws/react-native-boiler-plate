package com.rnboilerplate.audiostudio

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.source.ShuffleOrder
import kotlin.random.Random

/**
 * A shuffle order we control exactly: [order] lists playlist indices in play
 * order. Unlike ExoPlayer's random DefaultShuffleOrder, edits keep the
 * existing sequence — removed items drop out, inserted items go to the end
 * (the player then sets the exact position), moved items keep their place.
 * That lets "play next" / reordering work while shuffled.
 */
@OptIn(UnstableApi::class)
class ListShuffleOrder(private val order: IntArray) : ShuffleOrder {
  private val positions = IntArray(order.size).also { p -> order.forEachIndexed { pos, index -> p[index] = pos } }

  /** Playlist indices in play order (a copy). */
  fun toArray(): IntArray = order.copyOf()

  override fun getLength() = order.size

  override fun getNextIndex(index: Int): Int {
    val pos = positions[index] + 1
    return if (pos < order.size) order[pos] else C.INDEX_UNSET
  }

  override fun getPreviousIndex(index: Int): Int {
    val pos = positions[index] - 1
    return if (pos >= 0) order[pos] else C.INDEX_UNSET
  }

  override fun getLastIndex() = if (order.isEmpty()) C.INDEX_UNSET else order[order.size - 1]

  override fun getFirstIndex() = if (order.isEmpty()) C.INDEX_UNSET else order[0]

  override fun cloneAndInsert(insertionIndex: Int, insertionCount: Int): ShuffleOrder {
    val out = IntArray(order.size + insertionCount)
    var k = 0
    for (i in order) out[k++] = if (i >= insertionIndex) i + insertionCount else i
    for (j in 0 until insertionCount) out[k++] = insertionIndex + j
    return ListShuffleOrder(out)
  }

  override fun cloneAndRemove(indexFrom: Int, indexToExclusive: Int): ShuffleOrder {
    val count = indexToExclusive - indexFrom
    return ListShuffleOrder(
      order
        .filter { it < indexFrom || it >= indexToExclusive }
        .map { if (it >= indexToExclusive) it - count else it }
        .toIntArray(),
    )
  }

  override fun cloneAndMove(indexFrom: Int, indexToExclusive: Int, newIndexFrom: Int): ShuffleOrder {
    val playlist = MutableList(order.size) { it }
    val moved = playlist.subList(indexFrom, indexToExclusive).toList()
    repeat(moved.size) { playlist.removeAt(indexFrom) }
    playlist.addAll(newIndexFrom, moved)
    val oldToNew = IntArray(order.size)
    playlist.forEachIndexed { newIndex, old -> oldToNew[old] = newIndex }
    return ListShuffleOrder(IntArray(order.size) { oldToNew[order[it]] })
  }

  override fun cloneAndClear(): ShuffleOrder = ListShuffleOrder(IntArray(0))

  companion object {
    fun identity(count: Int) = ListShuffleOrder(IntArray(count) { it })

    /** Random order of [count] items starting with [first] (when it is a valid index). */
    fun shuffled(count: Int, first: Int, random: Random = Random.Default): ListShuffleOrder {
      val rest = (0 until count).filter { it != first }.toMutableList()
      rest.shuffle(random)
      return ListShuffleOrder((if (first in 0 until count) listOf(first) + rest else rest).toIntArray())
    }
  }
}
