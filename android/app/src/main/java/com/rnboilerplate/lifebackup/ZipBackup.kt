package com.rnboilerplate.lifebackup

import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/** An archive entry to write: UTF-8 text, or a file copied in as-is. */
sealed class ZipPart(val path: String) {
  class Text(path: String, val text: String) : ZipPart(path)

  class FilePart(path: String, val file: File) : ZipPart(path)
}

/** A rejected archive; [message] is a stable code for JS. */
class ZipBackupException(message: String) : Exception(message)

data class ZipReadResult(
  val manifest: JSONObject,
  /** JSON / text parts by path. */
  val texts: Map<String, String>,
  /** Binary parts (attachments) extracted into the staging folder, by path. */
  val files: Map<String, File>,
  /** Paths whose SHA-256 or size didn't match the manifest. */
  val checksumErrors: List<String>,
)

/**
 * Manage Life backup archive (.zip). Writes text parts and attachment
 * files with a manifest.json listing every file's size and SHA-256 (the
 * manifest goes last, once the hashes are known). Reading validates every
 * entry before anything is used: only known top-level folders, no absolute
 * paths, `..`, backslashes or drive letters (path traversal), bounded entry
 * count and sizes (zip bombs), and staged files must stay inside the
 * staging folder.
 */
object ZipBackup {
  const val MANIFEST = "manifest.json"
  private val ALLOWED_ROOTS = listOf("manage-life/", "long-term-planner/", "attachments/")
  private const val MAX_ENTRIES = 5000
  private const val MAX_TEXT_BYTES = 32L * 1024 * 1024
  private const val MAX_TOTAL_BYTES = 512L * 1024 * 1024

  /** Whether [path] is a safe, expected archive path. */
  fun isSafePath(path: String): Boolean {
    if (path.isEmpty() || path.length > 300) return false
    if (path.startsWith("/") || path.contains('\\') || path.contains(':') || path.contains('\u0000')) return false
    val segments = path.split('/')
    if (segments.any { it == ".." || it == "." || it.isEmpty() }) return false
    return path == MANIFEST || ALLOWED_ROOTS.any { path.startsWith(it) }
  }

  fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

  /** Writes [parts] then manifest.json (= [manifest] + "files": [{path, size, sha256}]). */
  fun write(parts: List<ZipPart>, manifest: JSONObject, out: OutputStream) {
    val listed = JSONArray()
    val seen = HashSet<String>()
    ZipOutputStream(out).use { zip ->
      for (part in parts) {
        if (!isSafePath(part.path) || part.path == MANIFEST) throw ZipBackupException("unsafe_entry")
        if (!seen.add(part.path)) throw ZipBackupException("duplicate_entry")
        zip.putNextEntry(ZipEntry(part.path))
        val digest = MessageDigest.getInstance("SHA-256")
        var size = 0L
        when (part) {
          is ZipPart.Text -> {
            val bytes = part.text.toByteArray(Charsets.UTF_8)
            digest.update(bytes)
            zip.write(bytes)
            size = bytes.size.toLong()
          }
          is ZipPart.FilePart -> {
            part.file.inputStream().use { input ->
              val buf = ByteArray(64 * 1024)
              while (true) {
                val n = input.read(buf)
                if (n < 0) break
                digest.update(buf, 0, n)
                zip.write(buf, 0, n)
                size += n
              }
            }
          }
        }
        zip.closeEntry()
        listed.put(
          JSONObject()
            .put("path", part.path)
            .put("size", size)
            .put("sha256", digest.digest().joinToString("") { "%02x".format(it) }),
        )
      }
      zip.putNextEntry(ZipEntry(MANIFEST))
      zip.write(JSONObject(manifest.toString()).put("files", listed).toString(2).toByteArray(Charsets.UTF_8))
      zip.closeEntry()
    }
  }

  /**
   * Reads and validates an archive. Text parts (.json, .txt) are returned
   * in memory; other parts are extracted under [stageDir]. Any unsafe entry
   * rejects the whole archive (nothing partial is returned).
   */
  fun read(input: InputStream, stageDir: File): ZipReadResult {
    val texts = HashMap<String, String>()
    val files = HashMap<String, File>()
    val hashes = HashMap<String, Pair<Long, String>>()
    var manifest: JSONObject? = null
    var total = 0L
    var count = 0
    val stageRoot = stageDir.canonicalFile
    try {
      ZipInputStream(input).use { zip ->
        while (true) {
          val entry = zip.nextEntry ?: break
          if (entry.isDirectory) continue
          if (++count > MAX_ENTRIES) throw ZipBackupException("too_large")
          val path = entry.name
          if (!isSafePath(path)) throw ZipBackupException("unsafe_entry")
          if (hashes.containsKey(path)) throw ZipBackupException("duplicate_entry")
          val digest = MessageDigest.getInstance("SHA-256")
          val isText = path.endsWith(".json") || path.endsWith(".txt")
          var size = 0L
          if (isText) {
            val buffer = ByteArrayOutputStream()
            val buf = ByteArray(64 * 1024)
            while (true) {
              val n = zip.read(buf)
              if (n < 0) break
              size += n
              total += n
              if (size > MAX_TEXT_BYTES || total > MAX_TOTAL_BYTES) throw ZipBackupException("too_large")
              digest.update(buf, 0, n)
              buffer.write(buf, 0, n)
            }
            val text = buffer.toString(Charsets.UTF_8.name())
            if (path == MANIFEST) {
              manifest =
                try {
                  JSONObject(text)
                } catch (e: Exception) {
                  throw ZipBackupException("bad_manifest")
                }
            } else {
              texts[path] = text
            }
          } else {
            val target = File(stageRoot, path).canonicalFile
            // Defence in depth: never write outside the staging folder.
            if (!target.path.startsWith(stageRoot.path + File.separator)) throw ZipBackupException("unsafe_entry")
            target.parentFile?.mkdirs()
            FileOutputStream(target).use { out ->
              val buf = ByteArray(64 * 1024)
              while (true) {
                val n = zip.read(buf)
                if (n < 0) break
                size += n
                total += n
                if (total > MAX_TOTAL_BYTES) throw ZipBackupException("too_large")
                digest.update(buf, 0, n)
                out.write(buf, 0, n)
              }
            }
            files[path] = target
          }
          hashes[path] = size to digest.digest().joinToString("") { "%02x".format(it) }
        }
      }
    } catch (e: ZipBackupException) {
      stageRoot.deleteRecursively()
      throw e
    } catch (e: Exception) {
      stageRoot.deleteRecursively()
      throw ZipBackupException("not_zip")
    }
    val m = manifest ?: run {
      stageRoot.deleteRecursively()
      throw ZipBackupException(if (count == 0) "not_zip" else "no_manifest")
    }
    val errors = ArrayList<String>()
    val listed = m.optJSONArray("files") ?: JSONArray()
    for (i in 0 until listed.length()) {
      val f = listed.optJSONObject(i) ?: continue
      val path = f.optString("path")
      val actual = hashes[path]
      val sha = f.optString("sha256")
      if (actual == null || (sha.isNotEmpty() && sha != actual.second) || (f.has("size") && f.optLong("size") != actual.first)) {
        errors += path
      }
    }
    return ZipReadResult(m, texts, files, errors)
  }
}
