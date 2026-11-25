package com.rnboilerplate.ytdownload

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.rnboilerplate.common.FileShare
import com.rnboilerplate.screenocr.NativeYouTubeDownloaderSpec
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

/**
 * Utility → YouTube Downloader. Reads a video's qualities (YtExtractor),
 * starts/cancels the download in [YtDownloadService] and manages the list
 * of finished downloads. Relays [YtDownloadEvents] to JS as
 * `YouTubeDownloadEvent` {type, body: JSON}.
 */
class YouTubeDownloaderModule(context: ReactApplicationContext) : NativeYouTubeDownloaderSpec(context) {
  private val io = Executors.newSingleThreadExecutor()
  private val store = DownloadStore.get(context)

  /** Details already fetched for a URL, so Download doesn't extract twice. */
  private val cache =
    object : LinkedHashMap<String, VideoDetails>(8, 0.75f, true) {
      override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, VideoDetails>?) = size > 5
    }

  private val relay: (String, JSONObject) -> Unit = { type, body ->
    if (reactApplicationContext.hasActiveReactInstance()) {
      val map = Arguments.createMap()
      map.putString("type", type)
      map.putString("body", body.toString())
      reactApplicationContext.emitDeviceEvent(EVENT, map)
    }
  }

  override fun initialize() {
    super.initialize()
    YtDownloadEvents.add(relay)
  }

  override fun invalidate() {
    YtDownloadEvents.remove(relay)
    io.shutdown()
    super.invalidate()
  }

  override fun getVideoInfo(url: String, promise: Promise) {
    io.execute {
      try {
        val details = YtExtractor.fetch(url.trim())
        synchronized(cache) { cache[url.trim()] = details }
        promise.resolve(details.toJson().toString())
      } catch (e: YtException) {
        promise.reject(e.code, e.code)
      } catch (e: Exception) {
        promise.reject("extract_failed", "extract_failed")
      }
    }
  }

  override fun startDownload(url: String, optionId: String, promise: Promise) {
    if (YtDownloadService.active != null) {
      promise.reject("busy", "busy")
      return
    }
    io.execute {
      try {
        val key = url.trim()
        val details = synchronized(cache) { cache[key] } ?: YtExtractor.fetch(key).also { synchronized(cache) { cache[key] = it } }
        val option = details.option(optionId) ?: throw YtException("unknown_option")
        val job = DownloadJob.create(details, option)
        YtDownloadService.start(reactApplicationContext, job)
        promise.resolve(job.id)
      } catch (e: YtException) {
        promise.reject(e.code, e.code)
      } catch (e: Exception) {
        promise.reject("start_failed", "start_failed")
      }
    }
  }

  override fun cancelDownload() {
    YtDownloadService.cancel(reactApplicationContext)
  }

  override fun getActiveDownload(promise: Promise) {
    promise.resolve(YtDownloadService.active?.toString() ?: "")
  }

  override fun listDownloads(promise: Promise) {
    io.execute { promise.resolve(store.list().toString()) }
  }

  override fun removeDownload(id: String, deleteFile: Boolean, promise: Promise) {
    io.execute {
      val removed = store.remove(id)
      if (removed != null && deleteFile) DownloadOutput(reactApplicationContext).delete(Uri.parse(removed.optString("uri")))
      promise.resolve(removed != null)
    }
  }

  override fun openDownload(id: String, promise: Promise) {
    val entry = store.get(id) ?: return promise.resolve(false)
    promise.resolve(launch(Intent(Intent.ACTION_VIEW).apply { setDataAndType(contentUri(entry), entry.optString("mime")) }))
  }

  override fun shareDownload(id: String, promise: Promise) {
    val entry = store.get(id) ?: return promise.resolve(false)
    val send =
      Intent(Intent.ACTION_SEND).apply {
        type = entry.optString("mime")
        putExtra(Intent.EXTRA_STREAM, contentUri(entry))
      }
    promise.resolve(launch(Intent.createChooser(send, null).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)))
  }

  /** MediaStore URIs are shareable as-is; app-folder files go through FileProvider. */
  private fun contentUri(entry: JSONObject): Uri {
    val uri = Uri.parse(entry.optString("uri"))
    return if (uri.scheme == "file") FileShare.contentUri(reactApplicationContext, File(uri.path!!)) else uri
  }

  private fun launch(intent: Intent): Boolean =
    try {
      intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      reactApplicationContext.startActivity(intent)
      true
    } catch (_: ActivityNotFoundException) {
      false
    } catch (_: SecurityException) {
      false
    }

  companion object {
    const val NAME = "YouTubeDownloader"
    const val EVENT = "YouTubeDownloadEvent"
  }
}

class YouTubeDownloaderPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == YouTubeDownloaderModule.NAME) YouTubeDownloaderModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
      // name, className, canOverrideExistingModule, needsEagerInit, isCxxModule, isTurboModule
      YouTubeDownloaderModule.NAME to
        ReactModuleInfo(YouTubeDownloaderModule.NAME, YouTubeDownloaderModule.NAME, false, false, false, true),
    )
  }
}
