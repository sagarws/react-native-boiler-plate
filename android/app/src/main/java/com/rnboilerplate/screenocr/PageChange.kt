package com.rnboilerplate.screenocr

/** What one captured page looked like: its text and a 64-bit image fingerprint. */
data class PageSnapshot(val text: String, val imageHash: Long)

/**
 * Decides whether a page turn happened, and trims repeated page chrome.
 *
 * A dispatched click proves nothing; the page is only "turned" when the new
 * capture differs from the previous one by more than transient noise:
 * - text: compared as normalised line sets (Jaccard); a clock, cursor or
 *   page counter changes only a line or two, which stays above the
 *   similarity threshold;
 * - image: a 9×8 difference hash of the frame; used to decide when there is
 *   too little text to compare (image-only pages).
 */
object PageChangeDetector {
  /** Text at least this similar is the same page. */
  const val SAME_TEXT = 0.75

  /** Below this many characters, text comparison is unreliable. */
  const val MIN_TEXT_FOR_COMPARISON = 40

  /** dHash bits that must differ for an image-only page to count as new. */
  const val IMAGE_CHANGED_BITS = 10

  /**
   * Share of lines (of the longer page) that have a fuzzy match on the other
   * page — OCR rarely reads the same pixels identically twice, so exact line
   * equality would call every re-capture a new page.
   */
  fun textSimilarity(a: String, b: String): Double {
    val la = lineSet(a).toList()
    val lb = lineSet(b).toList()
    if (la.isEmpty() && lb.isEmpty()) return 1.0
    val (shorter, longer) = if (la.size <= lb.size) la to lb else lb to la
    val matched = shorter.count { line -> longer.any { TextDedup.isSameLine(it, line) } }
    return matched.toDouble() / longer.size
  }

  fun hammingDistance(a: Long, b: Long): Int = java.lang.Long.bitCount(a xor b)

  fun isNewPage(previous: PageSnapshot, current: PageSnapshot): Boolean {
    val enoughText =
      previous.text.length >= MIN_TEXT_FOR_COMPARISON && current.text.length >= MIN_TEXT_FOR_COMPARISON
    if (enoughText) return textSimilarity(previous.text, current.text) < SAME_TEXT
    if (previous.text.isBlank() != current.text.isBlank()) return true
    return hammingDistance(previous.imageHash, current.imageHash) >= IMAGE_CHANGED_BITS
  }

  /** True when [current] matches one of the pages already read (viewer wrapped or went back). */
  fun isRepeatOf(current: PageSnapshot, seen: List<PageSnapshot>): Boolean =
    seen.any { !isNewPage(it, current) }

  /**
   * Difference hash: for each of 8 rows, whether each of 9 greyscale samples
   * is brighter than its right neighbour. [grey] is 9×8 row-major, 0..255.
   */
  fun dHash(grey: IntArray): Long {
    require(grey.size == 72) { "dHash needs 9x8 samples" }
    var hash = 0L
    var bit = 0
    for (row in 0 until 8) {
      for (col in 0 until 8) {
        if (grey[row * 9 + col] > grey[row * 9 + col + 1]) hash = hash or (1L shl bit)
        bit++
      }
    }
    return hash
  }

  private fun lineSet(text: String): Set<String> =
    text.lines().map(TextDedup::normalize).filter { it.length >= 2 }.toSet()
}

/**
 * Removes running headers, footers and page numbers before a page is spoken.
 *
 * Only lines at the **edges** of the page (first/last few in reading order)
 * are candidates, and only when the same line was at the edge of the previous
 * page or is a bare page number — so repeated sentences in the body are
 * never dropped.
 */
object PageText {
  private const val EDGE_LINES = 3
  private val PAGE_NUMBER =
    Regex(
      "^(page\\s*)?\\d{1,4}(\\s*(/|of)\\s*\\d{1,4})?$|^[-–]\\s*\\d{1,4}\\s*[-–]$|^पृष्ठ\\s*[०-९\\d]+$|^પાનું\\s*[૦-૯\\d]+$",
      RegexOption.IGNORE_CASE,
    )

  fun isPageNumber(line: String): Boolean = PAGE_NUMBER.matches(line.trim())

  fun stripChrome(current: String, previous: String?): String {
    val lines = current.lines().map { it.trim() }.filter { it.isNotEmpty() }
    if (lines.size <= 2) return lines.filterNot(::isPageNumber).joinToString("\n")
    val prevLines = previous?.lines()?.map { it.trim() }?.filter { it.isNotEmpty() }.orEmpty()
    val prevEdges = (prevLines.take(EDGE_LINES) + prevLines.takeLast(EDGE_LINES)).map(TextDedup::normalize)

    fun isChrome(line: String): Boolean {
      if (isPageNumber(line)) return true
      val key = TextDedup.normalize(line)
      return key.isNotEmpty() && prevEdges.any { TextDedup.isSameLine(it, key) }
    }

    var start = 0
    while (start < minOf(EDGE_LINES, lines.size) && isChrome(lines[start])) start++
    var end = lines.size
    while (end > start && lines.size - end < EDGE_LINES && isChrome(lines[end - 1])) end--
    return lines.subList(start, end).joinToString("\n")
  }
}
