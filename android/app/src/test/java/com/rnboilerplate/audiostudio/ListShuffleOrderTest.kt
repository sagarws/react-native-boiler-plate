package com.rnboilerplate.audiostudio

import androidx.media3.common.C
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import kotlin.random.Random

class ListShuffleOrderTest {
  private fun ListShuffleOrder.walk(): List<Int> {
    val out = mutableListOf<Int>()
    var i = firstIndex
    while (i != C.INDEX_UNSET) {
      out.add(i)
      i = getNextIndex(i)
    }
    return out
  }

  @Test
  fun followsTheGivenOrderBothWays() {
    val order = ListShuffleOrder(intArrayOf(2, 0, 3, 1))
    assertEquals(listOf(2, 0, 3, 1), order.walk())
    assertEquals(1, order.lastIndex)
    assertEquals(3, order.getPreviousIndex(1))
    assertEquals(C.INDEX_UNSET, order.getPreviousIndex(2))
  }

  @Test
  fun shuffledStartsWithTheCurrentSongAndKeepsEveryIndex() {
    val order = ListShuffleOrder.shuffled(10, 4, Random(7))
    val walk = order.walk()
    assertEquals(4, walk.first())
    assertEquals((0 until 10).toList(), walk.sorted())
  }

  @Test
  fun insertShiftsExistingIndicesAndAppendsNewOnes() {
    val order = ListShuffleOrder(intArrayOf(2, 0, 1)).cloneAndInsert(1, 2) as ListShuffleOrder
    assertArrayEquals(intArrayOf(4, 0, 3, 1, 2), order.toArray())
  }

  @Test
  fun removeKeepsTheRemainingSequence() {
    val order = ListShuffleOrder(intArrayOf(3, 0, 2, 1)).cloneAndRemove(1, 3) as ListShuffleOrder
    assertArrayEquals(intArrayOf(1, 0), order.toArray())
  }

  @Test
  fun moveKeepsTheSameSongsInTheSamePlayOrder() {
    // Playlist a b c d, play order c a d b; move a (index 0) to index 2 → b c a d.
    val order = ListShuffleOrder(intArrayOf(2, 0, 3, 1)).cloneAndMove(0, 1, 2) as ListShuffleOrder
    // c=1, a=2, d=3, b=0
    assertArrayEquals(intArrayOf(1, 2, 3, 0), order.toArray())
  }
}
