package com.rnboilerplate.recorder

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.rnboilerplate.screenocr.NativeRecorderSpec
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

/**
 * Screen Recorder TurboModule: settings, the recording button, actions and
 * the recordings library. All capture runs in [RecorderService]; this
 * module only sends it commands and relays [RecorderEvents] to JS as
 * `RecorderEvent`. Nothing here touches the OCR service.
 */
class RecorderModule(context: ReactApplicationContext) : NativeRecorderSpec(context) {
  private val io = Executors.newSingleThreadExecutor()
  private val prefs = RecorderPrefs(context)
  private val storage = OutputStorage(context)
  private val store = RecordingStore.get(context)
  private var pendingPick: Pair<OutputKind, Promise>? = null

  private val relay: (String, JSONObject) -> Unit = { type, body ->
    if (reactApplicationContext.hasActiveReactInstance()) {
      val map = Arguments.createMap()
      map.putString("type", type)
      map.putString("body", body.toString())
      reactApplicationContext.emitDeviceEvent(EVENT, map)
    }
  }

  private val results =
    object : BaseActivityEventListener() {
      override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQUEST_TREE) return
        val (kind, promise) = pendingPick ?: return
        pendingPick = null
        val tree = data?.data
        if (resultCode != Activity.RESULT_OK || tree == null) {
          promise.resolve("")
          return
        }
        io.execute {
          try {
            storage.persist(tree)
            val previous = prefs.read().dirs[kind]
            setDir(kind, tree.toString())
            // Release the old folder's grant unless another kind still uses it.
            if (previous != null && previous != tree.toString() && prefs.read().dirs.values.none { it == previous }) storage.release(previous)
            promise.resolve(dirJson(kind, tree.toString()).toString())
          } catch (e: Exception) {
            promise.reject("dir_access", e.message ?: "Folder not accessible", e)
          }
        }
      }
    }

  override fun initialize() {
    super.initialize()
    RecorderEvents.add(relay)
    reactApplicationContext.addActivityEventListener(results)
    // Cut-off sessions from a killed process, when no service owns them.
    if (RecorderService.running == null) {
      val now = System.currentTimeMillis()
      io.execute { store.recoverStale(now) { MediaCheck.verify(reactApplicationContext, storage, it) } }
    }
  }

  override fun invalidate() {
    RecorderEvents.remove(relay)
    reactApplicationContext.removeActivityEventListener(results)
    pendingPick?.second?.resolve("")
    pendingPick = null
    io.shutdown()
    super.invalidate()
  }

  private fun granted(permission: String) =
    ContextCompat.checkSelfPermission(reactApplicationContext, permission) == PackageManager.PERMISSION_GRANTED

  override fun getStatus(promise: Promise) {
    val s = JSONObject(RecorderService.snapshot.toString())
    s.put("supported", true)
    s.put("sdk", Build.VERSION.SDK_INT)
    s.put("overlayPermission", Settings.canDrawOverlays(reactApplicationContext))
    s.put("micPermission", granted(Manifest.permission.RECORD_AUDIO))
    s.put("notifications", NotificationManagerCompat.from(reactApplicationContext).areNotificationsEnabled())
    s.put("systemAudioSupported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
    s.put("serviceRunning", RecorderService.running != null)
    promise.resolve(s.toString())
  }

  override fun getConfig(promise: Promise) = promise.resolve(prefs.read().toJson().toString())

  override fun updateConfig(patchJson: String, promise: Promise) {
    try {
      // Folders change only through pickDirectory/clearDirectory (grants).
      val patch = JSONObject(patchJson).apply { remove("dirs") }
      val next = prefs.patch(patch)
      if (RecorderService.running != null) RecorderService.send(reactApplicationContext, RecorderService.ACTION_CONFIG)
      promise.resolve(next.toJson().toString())
    } catch (e: Exception) {
      promise.reject("invalid_config", e.message ?: "Invalid settings", e)
    }
  }

  override fun setBubbleEnabled(enabled: Boolean, promise: Promise) {
    val ctx = reactApplicationContext
    if (enabled && !Settings.canDrawOverlays(ctx)) {
      promise.resolve("overlay_permission")
      return
    }
    prefs.write(prefs.read().copy(bubbleEnabled = enabled))
    if (enabled) {
      RecorderService.send(ctx, RecorderService.ACTION_SHOW)
      promise.resolve("shown")
    } else {
      if (RecorderService.running != null) RecorderService.send(ctx, RecorderService.ACTION_HIDE)
      promise.resolve("hidden")
    }
  }

  override fun openOverlaySettings() {
    val ctx = reactApplicationContext
    val intent =
      Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${ctx.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      ctx.startActivity(intent)
    } catch (_: ActivityNotFoundException) {
    }
  }

  override fun resetBubblePosition() {
    prefs.resetPosition()
    if (RecorderService.running != null) RecorderService.send(reactApplicationContext, RecorderService.ACTION_RESET_POSITION)
  }

  override fun runAction(mode: String) =
    RecorderService.send(reactApplicationContext, RecorderService.ACTION_RUN) { putExtra(RecorderService.EXTRA_MODE, RecorderMode.from(mode).id) }

  private fun sendIfRunning(action: String) {
    if (RecorderService.running != null) RecorderService.send(reactApplicationContext, action)
  }

  override fun stopRecording() = sendIfRunning(RecorderService.ACTION_STOP)

  override fun pauseResume() = sendIfRunning(RecorderService.ACTION_PAUSE_RESUME)

  override fun endCapture() = sendIfRunning(RecorderService.ACTION_END_CAPTURE)

  // ── Library ──

  override fun listRecordings(promise: Promise) = io.execute { promise.resolve(store.listJson()) }

  private fun extension(name: String) = name.substringAfterLast('.', "")

  override fun renameRecording(id: String, name: String, promise: Promise) {
    io.execute {
      val entry = store.get(id)
      val uri = entry?.optString("uri").orEmpty()
      val clean = RecordingNames.sanitizeRename(name, extension(entry?.optString("name").orEmpty()))
      when {
        entry == null -> promise.reject("not_found", "Recording not found")
        clean == null -> promise.reject("invalid_name", "Invalid name")
        uri.isEmpty() -> {
          // Not merged yet: only the library name changes.
          promise.resolve(store.update(id) { it.put("name", clean) }.toString())
        }
        else -> {
          val renamed = storage.rename(Uri.parse(uri), clean)
          if (renamed == null) {
            promise.reject("rename_failed", "Rename failed")
          } else {
            val finalName = storage.displayName(renamed) ?: clean
            promise.resolve(store.update(id) { it.put("uri", renamed.toString()); it.put("name", finalName) }.toString())
            RecorderEvents.emit("library_changed")
          }
        }
      }
    }
  }

  private fun isLive(entry: JSONObject): Boolean {
    val status = entry.optString("status")
    return RecorderService.running != null &&
      (status == RecordingStore.STATUS_RECORDING || status == RecordingStore.STATUS_PROCESSING)
  }

  override fun deleteRecording(id: String, promise: Promise) {
    io.execute {
      val entry = store.get(id)
      if (entry == null) {
        promise.resolve(false)
        return@execute
      }
      if (isLive(entry)) {
        promise.reject("in_use", "This recording is still being written")
        return@execute
      }
      entry.optString("uri").takeIf { it.isNotEmpty() }?.let { storage.delete(Uri.parse(it)) }
      val segments = entry.optJSONArray("segments") ?: JSONArray()
      for (k in 0 until segments.length()) {
        val s = segments.getJSONObject(k)
        if (s.optString("status") != RecordingStore.SEG_DELETED) storage.delete(Uri.parse(s.optString("uri")))
      }
      MediaCheck.deleteThumb(reactApplicationContext, id)
      store.remove(id)
      RecorderEvents.emit("library_changed")
      promise.resolve(true)
    }
  }

  override fun remerge(id: String) =
    RecorderService.send(reactApplicationContext, RecorderService.ACTION_MERGE) { putExtra(RecorderService.EXTRA_ID, id) }

  /** content:// for a recording URI (file:// goes through FileProvider). */
  private fun shareable(uri: Uri): Uri =
    if (uri.scheme == "file") FileProvider.getUriForFile(reactApplicationContext, "${reactApplicationContext.packageName}.files", File(uri.path!!))
    else uri

  private fun mime(entry: JSONObject) =
    when (entry.optString("type")) {
      "screenshot" -> "image/png"
      "audio" -> "audio/mp4"
      else -> "video/mp4"
    }

  private fun view(uri: Uri, mime: String, promise: Promise) {
    val intent =
      Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(shareable(uri), mime)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      }
    try {
      reactApplicationContext.startActivity(Intent.createChooser(intent, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      promise.resolve(true)
    } catch (_: Exception) {
      promise.resolve(false)
    }
  }

  override fun openRecording(id: String, promise: Promise) {
    val entry = store.get(id)
    val uri = entry?.optString("uri").orEmpty()
    if (entry == null || uri.isEmpty()) return promise.resolve(false)
    view(Uri.parse(uri), mime(entry), promise)
  }

  override fun openSegment(id: String, index: Double, promise: Promise) {
    val entry = store.get(id) ?: return promise.resolve(false)
    val segs = entry.optJSONArray("segments") ?: return promise.resolve(false)
    val seg = (0 until segs.length()).map { segs.getJSONObject(it) }.firstOrNull { it.optInt("index") == index.toInt() }
    if (seg == null || seg.optString("status") != RecordingStore.SEG_DONE) return promise.resolve(false)
    view(Uri.parse(seg.optString("uri")), mime(entry), promise)
  }

  override fun shareRecording(id: String, promise: Promise) {
    val entry = store.get(id)
    val uri = entry?.optString("uri").orEmpty()
    if (entry == null || uri.isEmpty()) return promise.resolve(false)
    val content = shareable(Uri.parse(uri))
    val intent =
      Intent(Intent.ACTION_SEND).apply {
        type = mime(entry)
        putExtra(Intent.EXTRA_STREAM, content)
        clipData = ClipData.newRawUri(null, content)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
    try {
      reactApplicationContext.startActivity(Intent.createChooser(intent, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      promise.resolve(true)
    } catch (_: Exception) {
      promise.resolve(false)
    }
  }

  override fun editScreenshot(id: String, promise: Promise) {
    val entry = store.get(id)
    if (entry == null || entry.optString("type") != "screenshot" || entry.optString("uri").isEmpty()) return promise.resolve(false)
    ScreenshotEditorActivity.open(reactApplicationContext, entry.optString("uri"))
    promise.resolve(true)
  }

  // ── Storage & quality ──

  private fun setDir(kind: OutputKind, tree: String?) {
    val config = prefs.read()
    val dirs = config.dirs.toMutableMap()
    if (tree == null) dirs.remove(kind) else dirs[kind] = tree
    prefs.write(config.copy(dirs = dirs))
    if (RecorderService.running != null) RecorderService.send(reactApplicationContext, RecorderService.ACTION_CONFIG)
  }

  private fun dirJson(kind: OutputKind, tree: String?): JSONObject {
    val status = storage.status(kind, tree)
    return JSONObject().apply {
      put("label", status.label)
      put("custom", status.custom)
      put("accessible", status.accessible)
      put("freeBytes", storage.freeBytes(kind, tree))
    }
  }

  override fun pickDirectory(kind: String, promise: Promise) {
    val k = OutputKind.from(kind) ?: return promise.reject("invalid_kind", "Unknown folder")
    val activity = reactApplicationContext.currentActivity ?: return promise.reject("no_activity", "The app must be in the foreground")
    pendingPick?.second?.resolve("")
    pendingPick = k to promise
    val intent =
      Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(
        Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION,
      )
    try {
      @Suppress("DEPRECATION") activity.startActivityForResult(intent, REQUEST_TREE)
    } catch (e: ActivityNotFoundException) {
      pendingPick = null
      promise.reject("no_picker", "No folder picker available", e)
    }
  }

  override fun clearDirectory(kind: String, promise: Promise) {
    val k = OutputKind.from(kind) ?: return promise.resolve(false)
    val previous = prefs.read().dirs[k]
    setDir(k, null)
    if (previous != null && prefs.read().dirs.values.none { it == previous }) storage.release(previous)
    promise.resolve(true)
  }

  override fun getDirectories(promise: Promise) {
    io.execute {
      val dirs = prefs.read().dirs
      val out = JSONObject()
      for (k in OutputKind.entries) out.put(k.id, dirJson(k, dirs[k]))
      promise.resolve(out.toString())
    }
  }

  override fun testDirectory(kind: String, promise: Promise) {
    val k = OutputKind.from(kind) ?: return promise.resolve(false)
    io.execute { promise.resolve(storage.testWrite(k, prefs.read().dirs[k])) }
  }

  override fun getVideoCapabilities(promise: Promise) {
    io.execute {
      try {
        val wm = reactApplicationContext.getSystemService(android.view.WindowManager::class.java)
        val (w, h) =
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            wm.currentWindowMetrics.bounds.let { it.width() to it.height() }
          } else {
            val dm = android.util.DisplayMetrics()
            @Suppress("DEPRECATION") wm.defaultDisplay.getRealMetrics(dm)
            dm.widthPixels to dm.heightPixels
          }
        val config = prefs.read()
        val presets = JSONObject()
        var encoder: String? = null
        for ((id, q) in listOf("low" to VideoQuality.LOW, "medium" to VideoQuality.MEDIUM, "high" to VideoQuality.HIGH, "custom" to config.customVideo)) {
          val plan = EncoderSetup.plan(w, h, q)
          encoder = plan.encoderName
          presets.put(id, JSONObject().apply {
            put("width", plan.width)
            put("height", plan.height)
            put("fps", plan.fps)
            put("bitrate", plan.bitrate)
          })
        }
        promise.resolve(
          JSONObject().apply {
            put("screenWidth", w)
            put("screenHeight", h)
            put("encoder", encoder ?: "")
            put("presets", presets)
          }.toString(),
        )
      } catch (e: Exception) {
        promise.reject("capabilities_failed", e.message ?: "Could not read encoder capabilities", e)
      }
    }
  }

  companion object {
    const val NAME = NativeRecorderSpec.NAME
    const val EVENT = "RecorderEvent"
    private const val REQUEST_TREE = 0x5601
  }
}

/** Registers [RecorderModule] as a TurboModule (added in MainApplication). */
class RecorderPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == RecorderModule.NAME) RecorderModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
      // name, className, canOverrideExistingModule, needsEagerInit, isCxxModule, isTurboModule
      RecorderModule.NAME to ReactModuleInfo(RecorderModule.NAME, RecorderModule.NAME, false, false, false, true),
    )
  }
}
