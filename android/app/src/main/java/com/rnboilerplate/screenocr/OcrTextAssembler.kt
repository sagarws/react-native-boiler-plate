package com.rnboilerplate.screenocr

import kotlin.math.max
import kotlin.math.min

/** One recognised line with its on-screen box and the block it belongs to. */
data class OcrLine(
  val text: String,
  val left: Int,
  val top: Int,
  val right: Int,
  val bottom: Int,
  val block: Int,
) {
  val width: Int get() = max(0, right - left)
  val height: Int get() = max(0, bottom - top)
  val area: Long get() = width.toLong() * height.toLong()
}

/**
 * Pure text assembly: merges the two ML Kit recognisers' output for the mixed
 * mode and turns recognised lines into copyable text in reading order.
 *
 * Kept free of Android types so it runs under plain JVM unit tests.
 */
object OcrTextAssembler {
  private val DEVANAGARI = Regex("[\\u0900-\\u097F\\uA8E0-\\uA8FF]")

  /**
   * Indic scripts other than Devanagari (Bengali … Sinhala). The Devanagari
   * model sometimes emits these for icons and glyph-like UI (seen on device:
   * "১l61" for a status-bar battery). They are never right in a Hindi/English
   * screen, so such a line is a misread.
   */
  private val OTHER_INDIC = Regex("[\u0980-\u0DFF]")

  /** A Latin line replaces a Devanagari-model line only on a near-exact box match… */
  private const val REPLACE_IOU = 0.8f

  /** …or a looser one when the Devanagari line is a misread in another script. */
  private const val REPLACE_IOU_MISREAD = 0.5f

  /** A Latin line overlapping a Devanagari line by this much is the same text. */
  private const val DUPLICATE_OVERLAP = 0.3f

  fun containsDevanagari(text: String): Boolean = DEVANAGARI.containsMatchIn(text)

  fun intersectionArea(a: OcrLine, b: OcrLine): Long {
    val w = min(a.right, b.right) - max(a.left, b.left)
    val h = min(a.bottom, b.bottom) - max(a.top, b.top)
    return if (w <= 0 || h <= 0) 0L else w.toLong() * h.toLong()
  }

  fun iou(a: OcrLine, b: OcrLine): Float {
    val inter = intersectionArea(a, b)
    val union = a.area + b.area - inter
    return if (union <= 0L) 0f else inter.toFloat() / union.toFloat()
  }

  /** Intersection relative to the smaller box — "how much of one sits in the other". */
  fun overlapOfSmaller(a: OcrLine, b: OcrLine): Float {
    val smaller = min(a.area, b.area)
    return if (smaller <= 0L) 0f else intersectionArea(a, b).toFloat() / smaller.toFloat()
  }

  /**
   * Mixed Hindi + English.
   *
   * The Devanagari recogniser also reads Latin script, so its output is the
   * base: a line with any Devanagari in it (including mixed lines such as
   * "आपका Order Shipped हो गया") is kept as is. A line that came out purely
   * Latin is swapped for the Latin recogniser's reading of the same box,
   * which is the stronger model for English. Latin lines the Devanagari pass
   * missed entirely are appended in their own blocks.
   */
  fun mergeMixed(devanagari: List<OcrLine>, latin: List<OcrLine>): List<OcrLine> {
    val merged = ArrayList<OcrLine>(devanagari.size + latin.size)
    for (line in devanagari) {
      if (containsDevanagari(line.text)) {
        merged += line
        continue
      }
      val threshold = if (OTHER_INDIC.containsMatchIn(line.text)) REPLACE_IOU_MISREAD else REPLACE_IOU
      val match = latin.maxByOrNull { iou(line, it) }
      merged += if (match != null && iou(line, match) >= threshold) {
        line.copy(text = match.text)
      } else {
        line
      }
    }
    val blockOffset = (devanagari.maxOfOrNull { it.block } ?: -1) + 1
    for (line in latin) {
      val covered = devanagari.any { overlapOfSmaller(it, line) >= DUPLICATE_OVERLAP }
      if (!covered) merged += line.copy(block = line.block + blockOffset)
    }
    return merged
  }

  /**
   * Joins lines into text: blocks in reading order (top to bottom, then left
   * to right within a row), lines within a block likewise, one line per row.
   */
  fun assemble(lines: List<OcrLine>): String {
    val clean = lines.filter { it.text.isNotBlank() }
    if (clean.isEmpty()) return ""

    val tolerance = max(8, medianHeight(clean) / 2)
    val blocks = clean.groupBy { it.block }.values.map { blockLines ->
      Block(
        top = blockLines.minOf { it.top },
        left = blockLines.minOf { it.left },
        lines = readingOrder(blockLines, tolerance, { it.top }, { it.left }),
      )
    }
    val ordered = readingOrder(blocks, tolerance, { it.top }, { it.left })
    return ordered
      .flatMap { block -> block.lines.map { it.text.trim() } }
      .filter { it.isNotEmpty() }
      .joinToString("\n")
  }

  private data class Block(val top: Int, val left: Int, val lines: List<OcrLine>)

  private fun medianHeight(lines: List<OcrLine>): Int {
    val heights = lines.map { it.height }.sorted()
    return heights[heights.size / 2]
  }

  /** Groups items into rows (tops within [tolerance]) and orders each row left to right. */
  private fun <T> readingOrder(
    items: List<T>,
    tolerance: Int,
    top: (T) -> Int,
    left: (T) -> Int,
  ): List<T> {
    val byTop = items.sortedBy(top)
    val result = ArrayList<T>(items.size)
    var row = ArrayList<T>()
    var rowTop = Int.MIN_VALUE
    for (item in byTop) {
      if (row.isNotEmpty() && top(item) - rowTop > tolerance) {
        result += row.sortedBy(left)
        row = ArrayList()
      }
      if (row.isEmpty()) rowTop = top(item)
      row += item
    }
    result += row.sortedBy(left)
    return result
  }
}
