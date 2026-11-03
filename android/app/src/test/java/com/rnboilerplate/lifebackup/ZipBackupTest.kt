package com.rnboilerplate.lifebackup

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class ZipBackupTest {
  @get:Rule val tmp = TemporaryFolder()

  private fun stage() = File(tmp.root, "stage-${System.nanoTime()}")

  private fun rawZip(vararg entries: Pair<String, ByteArray>): ByteArray {
    val out = ByteArrayOutputStream()
    ZipOutputStream(out).use { z ->
      for ((name, bytes) in entries) {
        z.putNextEntry(ZipEntry(name))
        z.write(bytes)
        z.closeEntry()
      }
    }
    return out.toByteArray()
  }

  private fun expectReject(code: String, bytes: ByteArray) {
    val dir = stage()
    try {
      ZipBackup.read(ByteArrayInputStream(bytes), dir)
      fail("expected $code")
    } catch (e: ZipBackupException) {
      assertEquals(code, e.message)
    }
    assertFalse("nothing staged after a rejection", dir.exists() && dir.walkTopDown().any { it.isFile })
  }

  @Test
  fun roundTripsTextAndAttachmentsWithChecksums() {
    val photo = tmp.newFile("photo.jpg").apply { writeBytes(byteArrayOf(1, 2, 3, 4, 5)) }
    val out = ByteArrayOutputStream()
    ZipBackup.write(
      listOf(
        ZipPart.Text("manage-life/projects.json", """[{"id":"p1","name":"मराठी"}]"""),
        ZipPart.Text("long-term-planner/nodes.json", "[]"),
        ZipPart.FilePart("attachments/0-photo.jpg", photo),
      ),
      JSONObject().put("format", "akshar-manage-life-backup").put("schemaVersion", 1),
      out,
    )
    val dir = stage()
    val r = ZipBackup.read(ByteArrayInputStream(out.toByteArray()), dir)
    assertEquals("akshar-manage-life-backup", r.manifest.getString("format"))
    assertEquals(3, r.manifest.getJSONArray("files").length())
    assertEquals("""[{"id":"p1","name":"मराठी"}]""", r.texts["manage-life/projects.json"])
    assertTrue(r.files["attachments/0-photo.jpg"]!!.readBytes().contentEquals(byteArrayOf(1, 2, 3, 4, 5)))
    assertTrue(r.checksumErrors.isEmpty())
  }

  @Test
  fun rejectsPathTraversalAndUnexpectedEntries() {
    val manifest = "manifest.json" to "{}".toByteArray()
    expectReject("unsafe_entry", rawZip(manifest, "attachments/../../evil.sh" to byteArrayOf(1)))
    expectReject("unsafe_entry", rawZip(manifest, "/etc/passwd" to byteArrayOf(1)))
    expectReject("unsafe_entry", rawZip(manifest, "attachments\\..\\x" to byteArrayOf(1)))
    expectReject("unsafe_entry", rawZip(manifest, "other/file.json" to "{}".toByteArray()))
    // ZipOutputStream refuses duplicates, so write two names and rename one in the bytes.
    val dup = rawZip(manifest, "manage-life/a.json" to "1".toByteArray(), "manage-life/b.json" to "2".toByteArray())
    val text = String(dup, Charsets.ISO_8859_1).replace("manage-life/b.json", "manage-life/a.json")
    expectReject("duplicate_entry", text.toByteArray(Charsets.ISO_8859_1))
    assertFalse(ZipBackup.isSafePath("C:/x"))
    assertTrue(ZipBackup.isSafePath("attachments/12-photo.jpg"))
  }

  @Test
  fun reportsChecksumMismatches() {
    val manifest =
      JSONObject()
        .put("files", org.json.JSONArray().put(JSONObject().put("path", "manage-life/projects.json").put("size", 2).put("sha256", "00")))
        .toString()
    val r = ZipBackup.read(
      ByteArrayInputStream(rawZip("manifest.json" to manifest.toByteArray(), "manage-life/projects.json" to "[]".toByteArray())),
      stage(),
    )
    assertEquals(listOf("manage-life/projects.json"), r.checksumErrors)
  }

  @Test
  fun rejectsArchivesWithoutManifestOrNotZip() {
    expectReject("no_manifest", rawZip("manage-life/projects.json" to "[]".toByteArray()))
    expectReject("not_zip", "hello".toByteArray())
    expectReject("bad_manifest", rawZip("manifest.json" to "{oops".toByteArray()))
  }
}
