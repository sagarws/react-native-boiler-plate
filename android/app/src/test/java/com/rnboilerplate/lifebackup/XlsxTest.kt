package com.rnboilerplate.lifebackup

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class XlsxTest {
  @Test
  fun roundTripsTextNumbersBlanksAndSpecialCharacters() {
    val sheets =
      listOf(
        Sheet("Projects", listOf(listOf("id", "name", "notes"), listOf("p1", "Health & <Fitness> \"2026\"", null), listOf("p2", "मराठी · ગુજરાતી", "line1\nline2"))),
        Sheet("Progress", listOf(listOf("id", "quantity"), listOf("r1", 30), listOf("r2", 2.5), listOf("r3", 1_000_000))),
      )
    val back = Xlsx.fromBytes(Xlsx.toBytes(sheets))
    assertEquals(listOf("Projects", "Progress"), back.map { it.name })
    assertEquals(listOf("p1", "Health & <Fitness> \"2026\""), back[0].rows[1])
    assertEquals(listOf("p2", "मराठी · ગુજરાતી", "line1\nline2"), back[0].rows[2])
    assertEquals(30.0, back[1].rows[1][1])
    assertEquals(2.5, back[1].rows[2][1])
    assertEquals(1_000_000.0, back[1].rows[3][1])
  }

  @Test
  fun readsAnExcelStyleFileWithSharedStringsAndDeflate() {
    val bytes =
      zip(
        "xl/workbook.xml" to
          """<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Tasks" sheetId="1" r:id="rId7"/></sheets></workbook>""",
        "xl/_rels/workbook.xml.rels" to
          """<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="worksheet" Target="/xl/worksheets/data.xml"/></Relationships>""",
        "xl/sharedStrings.xml" to
          """<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>id</t></si><si><r><t>Rich </t></r><r><t>text</t></r></si><si><t>2026-10-20</t></si></sst>""",
        "xl/worksheets/data.xml" to
          """<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3"><v>12.5</v></c><c r="D3" t="b"><v>1</v></c></row></sheetData></worksheet>""",
      )
    val sheet = Xlsx.fromBytes(bytes).single()
    assertEquals("Tasks", sheet.name)
    assertEquals(listOf("id", null, "Rich text"), sheet.rows[0])
    assertEquals(emptyList<Any?>(), sheet.rows[1])
    assertEquals(listOf("2026-10-20", 12.5, null, true), sheet.rows[2])
  }

  @Test
  fun rejectsFilesThatAreNotWorkbooks() {
    for (bytes in listOf("hello".toByteArray(), zip("a.xml" to "<a/>"))) {
      try {
        Xlsx.fromBytes(bytes)
        fail("expected XlsxException")
      } catch (e: XlsxException) {
        assertEquals("not_xlsx", e.message)
      }
    }
  }

  @Test
  fun columnNamesAndSheetNames() {
    assertEquals(listOf("A", "Z", "AA", "AZ", "BA"), listOf(0, 25, 26, 51, 52).map(Xlsx::columnName))
    assertEquals(27, Xlsx.columnIndex("AB12"))
    val names = Xlsx.uniqueSheetNames(listOf("a/b", "A B", "", "x".repeat(40)))
    assertEquals("a b", names[0])
    assertTrue(names[1].startsWith("A B") && names[1] != "A B")
    assertEquals("Sheet3", names[2])
    assertEquals(31, names[3].length)
  }

  @Test
  fun jsonBridgeKeepsTypes() {
    val sheets = Xlsx.sheetsFromJson("""[{"name":"S","rows":[["a",1,null,true]]}]""")
    assertEquals(listOf("a", 1, null, "TRUE"), sheets.single().rows.single())
    assertTrue(Xlsx.sheetsToJson(sheets).contains("\"a\""))
  }

  private fun zip(vararg parts: Pair<String, String>): ByteArray {
    val out = ByteArrayOutputStream()
    ZipOutputStream(out).use { z ->
      for ((name, xml) in parts) {
        z.putNextEntry(ZipEntry(name))
        z.write(xml.toByteArray())
        z.closeEntry()
      }
    }
    return out.toByteArray()
  }
}
