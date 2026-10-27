package com.rnboilerplate.screenocr

/**
 * Paragraph structure of extracted text — the shared step between OCR and
 * speech for every reading mode.
 *
 * Convention: OCR text has one recognised line per `\n`, and a blank line
 * between paragraphs ([OcrTextAssembler.assemble] decides those breaks from
 * layout). [paragraphs] turns that into speakable paragraphs: the lines of a
 * paragraph joined with single spaces, so the engine reads them as running
 * text instead of pausing at every OCR line.
 *
 * Only layout and whitespace change — no character is translated, rewritten
 * or dropped (apart from a soft hyphen re-joining a word split across lines).
 * Works for any script; no English-only sentence rules are used.
 */
object ParagraphText {
  /**
   * Bullets and numbered items start their own paragraph. Em/en dashes are
   * not bullets: at a line start they are usually prose or dialogue.
   */
  private val LIST_ITEM =
    Regex("^\\s*([•●○◦▪▫■□‣⁃∙·*\\-]\\s+|\\(?([0-9]{1,3}|[०-९]{1,3}|[૦-૯]{1,3}|[a-zA-Z])[.)]\\s+)")

  /** A Latin word broken with a hyphen at the end of a line. */
  private val HYPHEN_BREAK = Regex("[A-Za-z]-$")
  private val STARTS_LOWERCASE_LATIN = Regex("^[a-z]")
  private val SPACES = Regex("[ \\t\\u00A0]+")

  fun isListItem(line: String): Boolean = LIST_ITEM.containsMatchIn(line)

  /** Splits text into paragraphs, each a single line of running text. */
  fun paragraphs(text: String): List<String> {
    val result = ArrayList<String>()
    var current = StringBuilder()

    fun flush() {
      val paragraph = current.toString().replace(SPACES, " ").trim()
      if (paragraph.isNotEmpty()) result += paragraph
      current = StringBuilder()
    }

    for (raw in text.lines()) {
      val line = raw.replace(SPACES, " ").trim()
      if (line.isEmpty()) {
        flush()
        continue
      }
      if (isListItem(line) && current.isNotEmpty()) flush()
      if (current.isEmpty()) {
        current.append(line)
      } else if (HYPHEN_BREAK.containsMatchIn(current) && STARTS_LOWERCASE_LATIN.containsMatchIn(line)) {
        // "manage-" + "ment" → "management"
        current.setLength(current.length - 1)
        current.append(line)
      } else {
        current.append(' ').append(line)
      }
    }
    flush()
    return result
  }

  /**
   * Keeps the non-blank lines [keep] accepts while preserving paragraph
   * breaks between the survivors — used to drop already-read or repeated
   * lines without gluing separate paragraphs together.
   */
  fun keepLines(text: String, keep: (index: Int, line: String) -> Boolean): String {
    val out = StringBuilder()
    var pendingBreak = false
    var index = 0
    for (raw in text.lines()) {
      val line = raw.trim()
      if (line.isEmpty()) {
        pendingBreak = out.isNotEmpty()
        continue
      }
      val kept = keep(index++, line)
      if (!kept) continue
      if (out.isNotEmpty()) out.append(if (pendingBreak) "\n\n" else "\n")
      out.append(line)
      pendingBreak = false
    }
    return out.toString()
  }

  /** Non-blank lines, in order. */
  fun lines(text: String): List<String> = text.lines().map { it.trim() }.filter { it.isNotEmpty() }
}
