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
  /** Recogniser confidence, 0..1 (1 when the engine reports none). */
  val confidence: Float = 1f,
) {
  val width: Int get() = max(0, right - left)
  val height: Int get() = max(0, bottom - top)
  val area: Long get() = width.toLong() * height.toLong()
}

/**
 * Pure text assembly: merges several recognisers' output for the multi-script
 * modes and turns recognised lines into copyable text in reading order.
 *
 * Kept free of Android types so it runs under plain JVM unit tests.
 */
object OcrTextAssembler {
  val DEVANAGARI = Regex("[\\u0900-\\u097F\\uA8E0-\\uA8FF]")
  val GUJARATI = Regex("[\\u0A80-\\u0AFF]")
  val DEVANAGARI_OR_GUJARATI = Regex("[\\u0900-\\u097F\\uA8E0-\\uA8FF\\u0A80-\\u0AFF]")

  /** Any Indic block after Devanagari (Bengali … Sinhala). */
  private val INDIC_AFTER_DEVANAGARI = Regex("[\\u0980-\\u0DFF]")

  /** A Latin line replaces a base line only on a near-exact box match… */
  private const val REPLACE_IOU = 0.8f

  /** …or a looser one when the base line is a misread in an unrelated script. */
  private const val REPLACE_IOU_MISREAD = 0.5f

  /** A Latin line overlapping a base line by this much is the same text. */
  private const val DUPLICATE_OVERLAP = 0.3f

  private const val SAME_LINE_OVERLAP = 0.5f
  private const val SCRIPT_BONUS = 0.25f
  private const val FOREIGN_PENALTY = 0.5f

  fun containsDevanagari(text: String): Boolean = DEVANAGARI.containsMatchIn(text)

  fun containsGujarati(text: String): Boolean = GUJARATI.containsMatchIn(text)

  /**
   * True when [text] has Indic characters from a script the mode does not
   * read. The Devanagari model sometimes emits these for icons and glyph-like
   * UI (seen on device: "১l61" for a status-bar battery); they are never
   * right, so such a line is a misread.
   */
  fun hasForeignIndic(text: String, expected: Regex): Boolean =
    text.any { ch ->
      val s = ch.toString()
      INDIC_AFTER_DEVANAGARI.matches(s) && !expected.matches(s)
    }

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
   * An Indic script + English (Hindi + English, Gujarati + English, …).
   *
   * The Indic recogniser also reads Latin script (ML Kit Devanagari natively,
   * Tesseract through its `+eng` model), so its output is the base: a line
   * with any [script] character in it (including mixed lines such as
   * "आपका Order Shipped हो गया") is kept as is. A line that came out purely
   * Latin is swapped for the Latin recogniser's reading of the same box,
   * which is the stronger model for English. Latin lines the base pass missed
   * entirely are appended in their own blocks.
   */
  fun mergeMixed(
    base: List<OcrLine>,
    latin: List<OcrLine>,
    script: Regex = DEVANAGARI,
  ): List<OcrLine> {
    val merged = ArrayList<OcrLine>(base.size + latin.size)
    for (line in base) {
      if (script.containsMatchIn(line.text)) {
        merged += line
        continue
      }
      val threshold = if (hasForeignIndic(line.text, script)) REPLACE_IOU_MISREAD else REPLACE_IOU
      val match = latin.maxByOrNull { iou(line, it) }
      merged += if (match != null && iou(line, match) >= threshold) {
        line.copy(text = match.text)
      } else {
        line
      }
    }
    val blockOffset = (base.maxOfOrNull { it.block } ?: -1) + 1
    for (line in latin) {
      val covered = base.any { overlapOfSmaller(it, line) >= DUPLICATE_OVERLAP }
      if (!covered) merged += line.copy(block = line.block + blockOffset)
    }
    return merged
  }

  /**
   * Two Indic recognisers over the same screen (Hindi + Gujarati).
   *
   * Each model tends to force the other script into its own (Gujarati read as
   * Devanagari and vice versa), so neither output can be trusted wholesale.
   * Lines are matched by box; for each match the reading with the higher
   * score wins, where score = engine confidence, plus a bonus when the line is
   * in the engine's own script, minus a penalty for characters from an
   * unrelated script. Unmatched lines from either side are kept. ML Kit and
   * Tesseract confidences are not calibrated against each other, so this is a
   * heuristic, not a guarantee.
   */
  fun mergeByConfidence(
    a: List<OcrLine>,
    aScript: Regex,
    b: List<OcrLine>,
    bScript: Regex,
  ): List<OcrLine> {
    fun score(line: OcrLine, own: Regex): Float {
      var s = line.confidence
      if (own.containsMatchIn(line.text)) s += SCRIPT_BONUS
      if (hasForeignIndic(line.text, DEVANAGARI_OR_GUJARATI)) s -= FOREIGN_PENALTY
      return s
    }
    val usedB = BooleanArray(b.size)
    val blockOffset = (a.maxOfOrNull { it.block } ?: -1) + 1
    val merged = ArrayList<OcrLine>(a.size + b.size)
    for (line in a) {
      val matches = b.indices.filter { overlapOfSmaller(line, b[it]) >= SAME_LINE_OVERLAP }
      if (matches.isEmpty()) {
        merged += line
        continue
      }
      val bScore = matches.map { score(b[it], bScript) }.average().toFloat()
      if (bScore > score(line, aScript)) {
        matches.filter { !usedB[it] }.forEach { merged += b[it].copy(block = b[it].block + blockOffset) }
      } else {
        merged += line
      }
      matches.forEach { usedB[it] = true }
    }
    b.forEachIndexed { i, line ->
      if (!usedB[i]) merged += line.copy(block = line.block + blockOffset)
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
    val sequence = ordered.flatMap { block -> block.lines.filter { it.text.isNotBlank() } }
    // Thresholds adapt to this block's own text: its typical line height and
    // the typical gap between its lines (no fixed pixel distances).
    val stats = clean.groupBy { it.block }.mapValues { (_, l) -> layoutStats(l) }

    val out = StringBuilder()
    for ((i, line) in sequence.withIndex()) {
      if (i > 0) {
        val previous = sequence[i - 1]
        out.append(if (isParagraphBreak(previous, line, stats[line.block])) "\n\n" else "\n")
      }
      out.append(line.text.trim())
    }
    return out.toString()
  }

  /** Typical line height and inter-line gap within one block. */
  data class LayoutStats(val lineHeight: Int, val lineGap: Int)

  fun layoutStats(lines: List<OcrLine>): LayoutStats {
    val height = max(1, medianHeight(lines))
    val byTop = lines.sortedBy { it.top }
    val gaps =
      byTop.zipWithNext { a, b -> b.top - a.bottom }.filter { it >= -height / 2 && it < height * 3 }.sorted()
    // Lower median: with few lines, one paragraph gap must not become "normal".
    val gap = if (gaps.isEmpty()) height / 3 else max(0, gaps[(gaps.size - 1) / 2])
    return LayoutStats(height, gap)
  }

  /**
   * Whether [next] starts a new paragraph after [previous], from layout:
   * - a different OCR block (separate text region, column, toolbar, cell);
   * - a vertical gap clearly larger than the block's normal line spacing;
   * - a clear change in text size (a heading next to body text);
   * - a first-line indent.
   * Lines on the same row (side by side) never merge across a block.
   */
  fun isParagraphBreak(previous: OcrLine, next: OcrLine, stats: LayoutStats? = null): Boolean {
    if (previous.block != next.block) return true
    val s = stats ?: layoutStats(listOf(previous, next))
    val gap = next.top - previous.bottom
    val height = max(1, s.lineHeight)
    if (gap > max(s.lineGap * 2 + height / 4, (height * 0.6).toInt())) return true
    val a = max(1, previous.height)
    val b = max(1, next.height)
    if (max(a, b).toFloat() / min(a, b) > HEADING_SIZE_RATIO) return true
    if (next.left - previous.left > height * INDENT_LINE_HEIGHTS && gap >= 0) return true
    return false
  }

  /** Text this much taller/shorter than its neighbour is a heading or caption. */
  private const val HEADING_SIZE_RATIO = 1.35f

  /** A first line indented by more than this many line heights starts a paragraph. */
  private const val INDENT_LINE_HEIGHTS = 1.5

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
