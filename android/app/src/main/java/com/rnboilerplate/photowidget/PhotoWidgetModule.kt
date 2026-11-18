package com.rnboilerplate.photowidget

import android.app.Activity
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.rnboilerplate.screenocr.NativePhotoWidgetSpec
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Photo Widget's TurboModule: pick + import photos, save / delete widget
 * settings (re-rendering every placed widget that shows them) and ask the
 * launcher to place a new widget.
 */
class PhotoWidgetModule(context: ReactApplicationContext) : NativePhotoWidgetSpec(context) {
  private val io = Executors.newSingleThreadExecutor()
  private val store = PhotoWidgetStore(context)
  private var pendingPick: Promise? = null

  private val results = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode != REQUEST_PICK) return
      val promise = pendingPick ?: return
      pendingPick = null
      val uri = data?.data
      if (resultCode != Activity.RESULT_OK || uri == null) {
        promise.resolve("")
        return
      }
      io.execute {
        try {
          val img = PhotoImages.import(reactApplicationContext, uri)
          promise.resolve(JSONObject().put("path", img.path).put("width", img.width).put("height", img.height).toString())
        } catch (e: Exception) {
          promise.reject("import_failed", "Could not read that photo", e)
        }
      }
    }
  }

  override fun initialize() {
    super.initialize()
    reactApplicationContext.addActivityEventListener(results)
  }

  override fun invalidate() {
    reactApplicationContext.removeActivityEventListener(results)
    io.shutdown()
    super.invalidate()
  }

  override fun list(promise: Promise) {
    io.execute {
      val bindings = store.bindings()
      val placed = PhotoWidgetProvider.allIds(reactApplicationContext).toSet()
      val arr = JSONArray()
      store.configs().forEach { c ->
        arr.put(c.toJson().put("placed", bindings.count { (id, cid) -> cid == c.id && id in placed }))
      }
      promise.resolve(JSONObject().put("widgets", arr).put("pinSupported", pinSupported()).toString())
    }
  }

  override fun pickImage(promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("no_activity", "The app must be in the foreground")
      return
    }
    pendingPick?.resolve("")
    pendingPick = promise
    val picker =
      if (Build.VERSION.SDK_INT >= 33) Intent(MediaStore.ACTION_PICK_IMAGES).setType("image/*")
      else Intent(Intent.ACTION_GET_CONTENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE)
    try {
      @Suppress("DEPRECATION") activity.startActivityForResult(picker, REQUEST_PICK)
    } catch (e: Exception) {
      pendingPick = null
      promise.reject("picker_failed", "Photo picker could not be opened", e)
    }
  }

  override fun save(configJson: String, promise: Promise) {
    io.execute {
      val c = PhotoConfig.from(runCatching { JSONObject(configJson) }.getOrNull())
      if (c == null || !PhotoImages.owns(reactApplicationContext, c.image)) {
        promise.reject("invalid", "Invalid photo widget")
        return@execute
      }
      store.upsert(c.copy(updatedAt = System.currentTimeMillis()))
      PhotoImages.prune(reactApplicationContext, store.configs().map { it.image }.toSet())
      PhotoWidgetProvider.refresh(reactApplicationContext, c.id)
      promise.resolve(true)
    }
  }

  override fun remove(id: String, promise: Promise) {
    io.execute {
      store.saveConfigs(store.configs().filter { it.id != id })
      PhotoImages.prune(reactApplicationContext, store.configs().map { it.image }.toSet())
      // Placed widgets that showed it now offer to choose a photo.
      PhotoWidgetProvider.refresh(reactApplicationContext, id)
      promise.resolve(true)
    }
  }

  /** Deletes a picked photo that was never saved (the user backed out). */
  override fun discardImage(path: String) {
    io.execute {
      if (store.configs().none { it.image == path }) PhotoImages.delete(reactApplicationContext, path)
    }
  }

  private fun pinSupported(): Boolean =
    Build.VERSION.SDK_INT >= 26 && AppWidgetManager.getInstance(reactApplicationContext).isRequestPinAppWidgetSupported

  override fun requestPin(id: String, promise: Promise) {
    if (!pinSupported() || store.config(id) == null) {
      promise.resolve(false)
      return
    }
    val ctx = reactApplicationContext
    val callback = PendingIntent.getBroadcast(
      ctx,
      id.hashCode(),
      Intent(ctx, PhotoWidgetPinReceiver::class.java)
        .setData(Uri.parse("akshar-photo-widget://pin/${Uri.encode(id)}"))
        .putExtra(PhotoWidgetPinReceiver.EXTRA_CONFIG, id),
      // Mutable: the launcher adds the new widget's id to it.
      PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0),
    )
    promise.resolve(
      AppWidgetManager.getInstance(ctx).requestPinAppWidget(ComponentName(ctx, PhotoWidgetProvider::class.java), null, callback),
    )
  }

  companion object {
    const val NAME = NativePhotoWidgetSpec.NAME
    private const val REQUEST_PICK = 0x7602
  }
}

/** Registers [PhotoWidgetModule] as a TurboModule (added in MainApplication). */
class PhotoWidgetPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == PhotoWidgetModule.NAME) PhotoWidgetModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(PhotoWidgetModule.NAME to ReactModuleInfo(PhotoWidgetModule.NAME, PhotoWidgetModule.NAME, false, false, false, true))
  }
}
