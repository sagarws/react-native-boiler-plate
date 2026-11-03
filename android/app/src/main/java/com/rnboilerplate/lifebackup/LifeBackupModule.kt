package com.rnboilerplate.lifebackup

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.rnboilerplate.common.DocumentSaver
import com.rnboilerplate.common.FileShare
import com.rnboilerplate.followup.Reminder
import com.rnboilerplate.followup.ReminderScheduler
import com.rnboilerplate.screenocr.NativeLifeBackupSpec
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Manage Life backup: writes the sheets JS prepares into an .xlsx file
 * where the user chooses ("Save to…", no storage permission), and reads a
 * picked .xlsx back into sheets. The data mapping and validation live in JS
 * (life/services/backup.ts); this module only handles the file format.
 */
class LifeBackupModule(context: ReactApplicationContext) : NativeLifeBackupSpec(context) {
  private val saver = DocumentSaver(context, REQUEST_SAVE)
  private val io = Executors.newSingleThreadExecutor()

  override fun initialize() {
    super.initialize()
    saver.attach()
  }

  override fun invalidate() {
    saver.detach()
    io.shutdown()
    super.invalidate()
  }

  override fun saveWorkbook(fileName: String, sheetsJson: String, promise: Promise) {
    val sheets =
      try {
        Xlsx.sheetsFromJson(sheetsJson)
      } catch (e: Exception) {
        promise.reject("bad_sheets", "Invalid sheet data", e)
        return
      }
    saver.save(fileName.take(120), Xlsx.MIME, promise) { out -> Xlsx.write(sheets, out) }
  }

  override fun readWorkbook(uri: String, promise: Promise) {
    io.execute {
      val file = FileShare.privateFile(reactApplicationContext, uri)
      if (file == null) {
        promise.reject("not_found", "File not found")
        return@execute
      }
      try {
        val sheets = file.inputStream().use { Xlsx.read(it) }
        promise.resolve(Xlsx.sheetsToJson(sheets))
      } catch (e: XlsxException) {
        promise.reject(e.message ?: "not_xlsx", e.message ?: "not_xlsx")
      } catch (e: Exception) {
        promise.reject("read_failed", "read_failed")
      } finally {
        // The picker made a private copy just for this import.
        file.delete()
      }
    }
  }

  override fun saveText(fileName: String, mimeType: String, content: String, promise: Promise) {
    saver.save(fileName.take(120), mimeType, promise) { it.write(content.toByteArray(Charsets.UTF_8)) }
  }

  override fun openFile(uri: String, mimeType: String, promise: Promise) {
    val file = FileShare.privateFile(reactApplicationContext, uri)
    promise.resolve(file != null && FileShare.open(reactApplicationContext, file, mimeType))
  }

  /**
   * entriesJson: [{path, text}] or [{path, file}] — files must be private
   * app files (attachments). manifestJson gets the file list + SHA-256s.
   */
  override fun saveZip(fileName: String, manifestJson: String, entriesJson: String, promise: Promise) {
    val parts: List<ZipPart>
    val manifest: JSONObject
    try {
      manifest = JSONObject(manifestJson)
      val arr = JSONArray(entriesJson)
      parts =
        (0 until arr.length()).mapNotNull { i ->
          val o = arr.getJSONObject(i)
          val path = o.getString("path")
          when {
            o.has("text") -> ZipPart.Text(path, o.getString("text"))
            o.has("file") -> FileShare.privateFile(reactApplicationContext, o.getString("file"))?.let { ZipPart.FilePart(path, it) }
            else -> null
          }
        }
    } catch (e: Exception) {
      promise.reject("bad_entries", "Invalid backup entries", e)
      return
    }
    saver.save(fileName.take(120), "application/zip", promise) { out -> ZipBackup.write(parts, manifest, out) }
  }

  /**
   * Reads a picked .zip (a private copy, deleted afterwards). Attachments
   * are extracted into a staging folder; nothing is applied yet.
   * Resolves {stageId, manifest, texts: {path: text}, files: {path: uri}, checksumErrors}.
   */
  override fun readZip(uri: String, promise: Promise) {
    io.execute {
      val file = FileShare.privateFile(reactApplicationContext, uri)
      if (file == null) {
        promise.reject("not_found", "File not found")
        return@execute
      }
      val stageId = UUID.randomUUID().toString()
      try {
        val result = file.inputStream().use { ZipBackup.read(it, stageDir(stageId)) }
        val texts = JSONObject()
        result.texts.forEach { (k, v) -> texts.put(k, v) }
        val files = JSONObject()
        result.files.forEach { (k, v) -> files.put(k, android.net.Uri.fromFile(v).toString()) }
        promise.resolve(
          JSONObject()
            .put("stageId", stageId)
            .put("manifest", result.manifest)
            .put("texts", texts)
            .put("files", files)
            .put("checksumErrors", JSONArray(result.checksumErrors))
            .toString(),
        )
      } catch (e: ZipBackupException) {
        promise.reject(e.message ?: "not_zip", e.message ?: "not_zip")
      } catch (e: Exception) {
        promise.reject("read_failed", "read_failed")
      } finally {
        file.delete()
      }
    }
  }

  /** Moves staged attachments into permanent app storage; resolves {stagedUri: newUri}. */
  override fun adoptStaged(stageId: String, promise: Promise) {
    io.execute {
      try {
        val stage = stageDir(stageId)
        val target = File(reactApplicationContext.filesDir, "restored/$stageId").canonicalFile
        val map = JSONObject()
        if (stage.exists()) {
          stage.walkTopDown().filter { it.isFile }.forEach { f ->
            val rel = f.relativeTo(stage).path
            val dest = File(target, rel).canonicalFile
            if (!dest.path.startsWith(target.path + File.separator)) return@forEach
            dest.parentFile?.mkdirs()
            f.copyTo(dest, overwrite = true)
            map.put(android.net.Uri.fromFile(f.canonicalFile).toString(), android.net.Uri.fromFile(dest).toString())
          }
          stage.deleteRecursively()
        }
        promise.resolve(map.toString())
      } catch (e: Exception) {
        promise.reject("adopt_failed", "adopt_failed")
      }
    }
  }

  /**
   * Long-Term Planner reminders: replaces only the "plan:" reminders in the
   * shared scheduler (Follow Up's are untouched). Resolves how many were
   * armed, or -1 when notifications are blocked.
   */
  override fun syncPlannerReminders(json: String, promise: Promise) {
    io.execute {
      try {
        val ctx = reactApplicationContext
        val list = Reminder.parseAll(json).filter { ReminderScheduler.isPlanner(it.key) }
        if (list.isNotEmpty() && !ReminderScheduler.notificationsAllowed(ctx)) {
          ReminderScheduler.sync(ctx, emptyList()) { ReminderScheduler.isPlanner(it) }
          promise.resolve(-1.0)
        } else {
          promise.resolve(ReminderScheduler.sync(ctx, list) { ReminderScheduler.isPlanner(it) }.toDouble())
        }
      } catch (e: Exception) {
        promise.reject("sync_failed", "sync_failed", e)
      }
    }
  }

  override fun discardStaged(stageId: String) {
    io.execute { stageDir(stageId).deleteRecursively() }
  }

  private fun stageDir(stageId: String): File {
    require(Regex("^[0-9a-f-]{36}$").matches(stageId)) { "bad stage id" }
    return File(reactApplicationContext.cacheDir, "restore-stage/$stageId")
  }

  companion object {
    const val NAME = NativeLifeBackupSpec.NAME
    private const val REQUEST_SAVE = 0x4C42
  }
}

class LifeBackupPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == LifeBackupModule.NAME) LifeBackupModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
      // name, className, canOverrideExistingModule, needsEagerInit, isCxxModule, isTurboModule
      LifeBackupModule.NAME to ReactModuleInfo(LifeBackupModule.NAME, LifeBackupModule.NAME, false, false, false, true),
    )
  }
}
