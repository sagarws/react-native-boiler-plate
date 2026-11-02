package com.rnboilerplate.lifebackup

import org.json.JSONArray
import org.json.JSONObject
import org.w3c.dom.Element
import org.w3c.dom.Node
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream
import javax.xml.parsers.DocumentBuilderFactory

/** One worksheet: a name and rows of cells (String, Number or null). */
data class Sheet(val name: String, val rows: List<List<Any?>>)

/** The file is not a readable .xlsx workbook (or is too big to be a backup). */
class XlsxException(message: String) : Exception(message)

/**
 * Minimal .xlsx (Office Open XML spreadsheet) writer and reader — just what
 * a data backup needs, with no third-party library. An .xlsx is a ZIP of XML
 * parts; java.util.zip handles both stored and deflated entries, so files
 * re-saved by Excel, Google Sheets or LibreOffice read back too.
 *
 * Written workbooks use inline strings, numbers, a bold, frozen header row.
 * The reader understands shared strings, inline strings, rich-text runs,
 * numbers and booleans; formulas are read as their cached value.
 */
object Xlsx {
  const val MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

  private const val MAX_TOTAL_BYTES = 64L * 1024 * 1024
  private const val MAX_ENTRIES = 500

  // ── Writing ──────────────────────────────────────────────────────────

  fun write(sheets: List<Sheet>, out: OutputStream) {
    require(sheets.isNotEmpty()) { "no sheets" }
    val names = uniqueSheetNames(sheets.map { it.name })
    ZipOutputStream(out).use { zip ->
      fun put(path: String, xml: String) {
        zip.putNextEntry(ZipEntry(path))
        zip.write(xml.toByteArray(Charsets.UTF_8))
        zip.closeEntry()
      }
      put("[Content_Types].xml", contentTypes(sheets.size))
      put(
        "_rels/.rels",
        """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>""",
      )
      put("xl/workbook.xml", workbook(names))
      put("xl/_rels/workbook.xml.rels", workbookRels(sheets.size))
      put("xl/styles.xml", STYLES)
      sheets.forEachIndexed { i, sheet -> put("xl/worksheets/sheet${i + 1}.xml", worksheet(sheet)) }
    }
  }

  fun toBytes(sheets: List<Sheet>): ByteArray = ByteArrayOutputStream().also { write(sheets, it) }.toByteArray()

  /** Excel: ≤ 31 chars, none of []:*?/\, unique ignoring case. */
  fun uniqueSheetNames(raw: List<String>): List<String> {
    val used = HashSet<String>()
    return raw.mapIndexed { i, name ->
      val base = name.replace(Regex("[\\[\\]:*?/\\\\]"), " ").trim().take(31).ifBlank { "Sheet${i + 1}" }
      var candidate = base
      var n = 2
      while (!used.add(candidate.lowercase())) candidate = "${base.take(27)} ($n)".also { n++ }
      candidate
    }
  }

  /** 0 → "A", 25 → "Z", 26 → "AA". */
  fun columnName(index: Int): String {
    var i = index
    val sb = StringBuilder()
    do {
      sb.insert(0, ('A' + i % 26))
      i = i / 26 - 1
    } while (i >= 0)
    return sb.toString()
  }

  /** "AB12" → 27 (column part only). */
  fun columnIndex(ref: String): Int {
    var n = 0
    for (ch in ref) {
      if (ch !in 'A'..'Z') break
      n = n * 26 + (ch - 'A' + 1)
    }
    return n - 1
  }

  private fun escape(s: String): String {
    val sb = StringBuilder(s.length + 8)
    for (ch in s) {
      when {
        ch == '&' -> sb.append("&amp;")
        ch == '<' -> sb.append("&lt;")
        ch == '>' -> sb.append("&gt;")
        ch == '"' -> sb.append("&quot;")
        // XML 1.0 forbids most control characters.
        ch < ' ' && ch != '\t' && ch != '\n' && ch != '\r' -> {}
        else -> sb.append(ch)
      }
    }
    return sb.toString()
  }

  private fun worksheet(sheet: Sheet): String {
    val sb = StringBuilder()
    sb.append("""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>""")
    sb.append("""<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">""")
    // Freeze the header row.
    sb.append("""<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>""")
    val widths = columnWidths(sheet)
    if (widths.isNotEmpty()) {
      sb.append("<cols>")
      widths.forEachIndexed { i, w -> sb.append("""<col min="${i + 1}" max="${i + 1}" width="$w" customWidth="1"/>""") }
      sb.append("</cols>")
    }
    sb.append("<sheetData>")
    sheet.rows.forEachIndexed { r, row ->
      sb.append("""<row r="${r + 1}">""")
      row.forEachIndexed { c, value ->
        val ref = "${columnName(c)}${r + 1}"
        val style = if (r == 0) """ s="1"""" else ""
        when (value) {
          null -> {}
          is Number -> {
            val d = value.toDouble()
            if (d.isFinite()) sb.append("""<c r="$ref"$style><v>${number(d)}</v></c>""")
          }
          else -> {
            val text = value.toString()
            if (text.isNotEmpty()) {
              sb.append("""<c r="$ref" t="inlineStr"$style><is><t xml:space="preserve">${escape(text)}</t></is></c>""")
            }
          }
        }
      }
      sb.append("</row>")
    }
    sb.append("</sheetData></worksheet>")
    return sb.toString()
  }

  /** Integers without ".0"; others in full precision. */
  private fun number(d: Double): String =
    if (d == Math.rint(d) && Math.abs(d) < 1e15) d.toLong().toString() else d.toString()

  private fun columnWidths(sheet: Sheet): List<Int> {
    val count = sheet.rows.maxOfOrNull { it.size } ?: 0
    return (0 until count).map { c ->
      val longest = sheet.rows.take(200).maxOfOrNull { (it.getOrNull(c)?.toString() ?: "").length } ?: 0
      (longest + 2).coerceIn(8, 50)
    }
  }

  private fun contentTypes(count: Int): String {
    val sheets =
      (1..count).joinToString("") {
        """<Override PartName="/xl/worksheets/sheet$it.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>"""
      }
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>$sheets</Types>"""
  }

  private fun workbook(names: List<String>): String {
    val sheets = names.mapIndexed { i, n -> """<sheet name="${escape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>""" }.joinToString("")
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>$sheets</sheets></workbook>"""
  }

  private fun workbookRels(count: Int): String {
    val rels =
      (1..count).joinToString("") {
        """<Relationship Id="rId$it" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet$it.xml"/>"""
      }
    val styles =
      """<Relationship Id="rId${count + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>"""
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">$rels$styles</Relationships>"""
  }

  /** Style 0 = default, 1 = bold (header row). */
  private const val STYLES =
    """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>"""

  // ── Reading ──────────────────────────────────────────────────────────

  fun read(input: InputStream): List<Sheet> {
    val parts = unzip(input)
    val workbook = parts["xl/workbook.xml"] ?: throw XlsxException("not_xlsx")
    val rels = parts["xl/_rels/workbook.xml.rels"]?.let(::parse)
    val targets = HashMap<String, String>()
    rels?.let { doc ->
      elements(doc.documentElement, "Relationship").forEach { targets[it.getAttribute("Id")] = it.getAttribute("Target") }
    }
    val shared = parts["xl/sharedStrings.xml"]?.let { bytes -> elements(parse(bytes).documentElement, "si").map(::text) } ?: emptyList()

    val sheets = ArrayList<Sheet>()
    elements(parse(workbook).documentElement, "sheet").forEachIndexed { i, el ->
      val rid = el.getAttributeNS(REL_NS, "id").ifEmpty { el.getAttribute("r:id") }
      val target = targets[rid] ?: "worksheets/sheet${i + 1}.xml"
      val path = if (target.startsWith("/")) target.drop(1) else "xl/$target"
      val bytes = parts[path] ?: return@forEachIndexed
      sheets += Sheet(el.getAttribute("name"), readRows(parse(bytes), shared))
    }
    if (sheets.isEmpty()) throw XlsxException("not_xlsx")
    return sheets
  }

  fun fromBytes(bytes: ByteArray): List<Sheet> = read(ByteArrayInputStream(bytes))

  private const val REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

  private fun readRows(doc: org.w3c.dom.Document, shared: List<String>): List<List<Any?>> {
    val rows = ArrayList<List<Any?>>()
    for (rowEl in elements(doc.documentElement, "row")) {
      val rowNumber = rowEl.getAttribute("r").toIntOrNull()
      // Rows may be sparse: keep row positions so the header stays row 1.
      if (rowNumber != null) while (rows.size < rowNumber - 1) rows += emptyList<Any?>()
      val cells = ArrayList<Any?>()
      var next = 0
      for (c in elements(rowEl, "c")) {
        val ref = c.getAttribute("r")
        val col = if (ref.isNotEmpty()) columnIndex(ref) else next
        while (cells.size < col) cells += null
        cells += cellValue(c, shared)
        next = col + 1
      }
      while (cells.isNotEmpty() && cells.last() == null) cells.removeAt(cells.lastIndex)
      rows += cells
    }
    return rows
  }

  private fun cellValue(c: Element, shared: List<String>): Any? {
    val type = c.getAttribute("t")
    val v = elements(c, "v").firstOrNull()?.textContent
    return when (type) {
      "s" -> v?.trim()?.toIntOrNull()?.let { shared.getOrNull(it) }
      "inlineStr" -> elements(c, "is").firstOrNull()?.let(::text)
      "b" -> v?.trim() == "1"
      "str", "e" -> v
      else -> v?.trim()?.toDoubleOrNull()
    }
  }

  /** Concatenated text of every <t> below [el] (handles rich-text runs). */
  private fun text(el: Element): String = elements(el, "t").joinToString("") { it.textContent ?: "" }

  private fun elements(root: Element, localName: String): List<Element> {
    val out = ArrayList<Element>()
    fun walk(node: Node) {
      var child = node.firstChild
      while (child != null) {
        if (child is Element) {
          if ((child.localName ?: child.nodeName.substringAfter(':')) == localName) out += child
          walk(child)
        }
        child = child.nextSibling
      }
    }
    walk(root)
    return out
  }

  private fun parse(bytes: ByteArray): org.w3c.dom.Document {
    val factory = DocumentBuilderFactory.newInstance()
    factory.isNamespaceAware = true
    factory.isExpandEntityReferences = false
    // No DTDs or external entities (XXE). Some parsers don't know the feature.
    runCatching { factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true) }
    return try {
      factory.newDocumentBuilder().parse(ByteArrayInputStream(bytes))
    } catch (e: Exception) {
      throw XlsxException("not_xlsx")
    }
  }

  /** Reads the ZIP parts, refusing archives that are suspiciously large. */
  private fun unzip(input: InputStream): Map<String, ByteArray> {
    val parts = HashMap<String, ByteArray>()
    var total = 0L
    try {
      ZipInputStream(input).use { zip ->
        while (true) {
          val entry = zip.nextEntry ?: break
          if (entry.isDirectory) continue
          if (parts.size >= MAX_ENTRIES) throw XlsxException("too_large")
          val name = entry.name.removePrefix("/")
          val buffer = ByteArrayOutputStream()
          val chunk = ByteArray(64 * 1024)
          while (true) {
            val read = zip.read(chunk)
            if (read < 0) break
            total += read
            if (total > MAX_TOTAL_BYTES) throw XlsxException("too_large")
            buffer.write(chunk, 0, read)
          }
          // Only XML parts are needed (skip images, printer settings, …).
          if (name.endsWith(".xml") || name.endsWith(".rels")) parts[name] = buffer.toByteArray()
        }
      }
    } catch (e: XlsxException) {
      throw e
    } catch (e: Exception) {
      throw XlsxException("not_xlsx")
    }
    if (parts.isEmpty()) throw XlsxException("not_xlsx")
    return parts
  }

  // ── JSON bridge ──────────────────────────────────────────────────────

  /** `[{name, rows: [[cell…]…]}]` (cells: string, number, boolean or null). */
  fun sheetsFromJson(json: String): List<Sheet> {
    val arr = JSONArray(json)
    return (0 until arr.length()).map { i ->
      val o = arr.getJSONObject(i)
      val rows = o.optJSONArray("rows") ?: JSONArray()
      Sheet(
        o.optString("name", "Sheet${i + 1}"),
        (0 until rows.length()).map { r ->
          val row = rows.optJSONArray(r) ?: JSONArray()
          (0 until row.length()).map { c ->
            when (val v = row.opt(c)) {
              null, JSONObject.NULL -> null
              is Number -> v
              is Boolean -> if (v) "TRUE" else "FALSE"
              else -> v.toString()
            }
          }
        },
      )
    }
  }

  fun sheetsToJson(sheets: List<Sheet>): String =
    JSONArray(
      sheets.map { s ->
        JSONObject().put("name", s.name).put("rows", JSONArray(s.rows.map { row -> JSONArray(row.map { it ?: JSONObject.NULL }) }))
      },
    ).toString()
}
