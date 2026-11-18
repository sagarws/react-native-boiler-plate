package com.rnboilerplate.netinspector

import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebView
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uimanager.UIManagerHelper
import com.rnboilerplate.common.DocumentSaver
import com.rnboilerplate.common.FileShare
import com.rnboilerplate.screenocr.ClipboardHelper
import com.rnboilerplate.screenocr.NativeNetInspectorSpec
import java.io.File
import java.util.concurrent.Executors
import org.json.JSONArray

/**
 * Network Inspector's TurboModule.
 *
 * Capture: registers the capture script with
 * `WebViewCompat.addDocumentStartJavaScript`, so it runs before any page
 * script, in every frame, but only in frames whose origin Chromium matches
 * against the allowed-domain rules. Other sites never see it.
 *
 * Cookies: reads the WebView's own cookie store for a captured request's
 * URL, because the page script can't see the Cookie header (or HttpOnly
 * cookies). Only this app's WebView cookies; never logged.
 *
 * Export: copy (marked sensitive), share sheet and "Save to…". Captured
 * request/response content is never logged.
 */
class NetInspectorModule(context: ReactApplicationContext) : NativeNetInspectorSpec(context) {
  private val saver = DocumentSaver(context, REQUEST_SAVE)
  private val io = Executors.newSingleThreadExecutor()

  /** View tag → its registered script. Touched on the UI thread only. */
  private val scripts = HashMap<Int, ScriptHandler>()

  override fun initialize() {
    super.initialize()
    saver.attach()
  }

  override fun invalidate() {
    saver.detach()
    io.shutdown()
    UiThreadUtil.runOnUiThread {
      scripts.values.forEach { runCatching { it.remove() } }
      scripts.clear()
    }
    super.invalidate()
  }

  override fun attachCaptureScript(viewTag: Double, script: String, originRulesJson: String, promise: Promise) {
    val tag = viewTag.toInt()
    UiThreadUtil.runOnUiThread {
      try {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
          promise.resolve(false)
          return@runOnUiThread
        }
        val rulesArray = JSONArray(originRulesJson)
        val rules = (0 until rulesArray.length()).map { rulesArray.getString(it) }.toSet()
        if (rules.isEmpty()) {
          promise.reject(E_BAD_RULES, "No origin rules")
          return@runOnUiThread
        }
        val webView = findWebView(tag)
        if (webView == null) {
          promise.reject(E_NO_WEBVIEW, "WebView not found")
          return@runOnUiThread
        }
        scripts.remove(tag)?.let { runCatching { it.remove() } }
        scripts[tag] = WebViewCompat.addDocumentStartJavaScript(webView, script, rules)
        promise.resolve(true)
      } catch (e: IllegalArgumentException) {
        // Chromium rejects a malformed origin rule.
        promise.reject(E_BAD_RULES, e.message ?: "Invalid origin rule", e)
      } catch (e: Exception) {
        promise.reject(E_ATTACH, e.message ?: "Could not attach the capture script", e)
      }
    }
  }

  override fun detachCaptureScript(viewTag: Double, promise: Promise) {
    val tag = viewTag.toInt()
    UiThreadUtil.runOnUiThread {
      val handler = scripts.remove(tag)
      handler?.let { runCatching { it.remove() } }
      promise.resolve(handler != null)
    }
  }

  override fun getCookies(url: String, promise: Promise) {
    try {
      val scheme = android.net.Uri.parse(url).scheme?.lowercase()
      if (scheme != "https" && scheme != "http") {
        promise.resolve(null)
        return
      }
      promise.resolve(CookieManager.getInstance().getCookie(url)?.takeIf { it.isNotBlank() })
    } catch (e: Exception) {
      // No WebView provider (being updated) or a malformed URL.
      promise.reject(E_COOKIES, e.message ?: "Cookies unavailable", e)
    }
  }

  override fun copyText(text: String, promise: Promise) {
    promise.resolve(ClipboardHelper.copy(reactApplicationContext, text, sensitive = true))
  }

  override fun shareTextFile(fileName: String, mimeType: String, content: String, promise: Promise) {
    io.execute {
      try {
        // One export file at a time: earlier ones (possibly sensitive) are
        // removed rather than left behind in the cache.
        val dir = File(reactApplicationContext.cacheDir, EXPORT_DIR)
        dir.deleteRecursively()
        dir.mkdirs()
        val file = File(dir, safeName(fileName))
        file.writeText(content, Charsets.UTF_8)
        promise.resolve(FileShare.share(reactApplicationContext, listOf(file), mimeType))
      } catch (e: Exception) {
        promise.reject(DocumentSaver.E_WRITE, e.message ?: "Write failed", e)
      }
    }
  }

  override fun saveTextDocument(fileName: String, mimeType: String, content: String, promise: Promise) {
    saver.save(safeName(fileName), mimeType, promise) { it.write(content.toByteArray(Charsets.UTF_8)) }
  }

  private fun findWebView(tag: Int): WebView? {
    val manager = UIManagerHelper.getUIManagerForReactTag(reactApplicationContext, tag) ?: return null
    val root = runCatching { manager.resolveView(tag) }.getOrNull() ?: return null
    return firstWebView(root)
  }

  private fun firstWebView(view: View): WebView? {
    if (view is WebView) return view
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) firstWebView(view.getChildAt(i))?.let { return it }
    }
    return null
  }

  companion object {
    const val NAME = NativeNetInspectorSpec.NAME
    private const val REQUEST_SAVE = 0x4E49
    private const val EXPORT_DIR = "netinspector-export"
    const val E_NO_WEBVIEW = "no_webview"
    const val E_BAD_RULES = "bad_rules"
    const val E_ATTACH = "attach_failed"
    const val E_COOKIES = "cookies_failed"

    fun safeName(name: String): String =
      name.replace(Regex("[^A-Za-z0-9._-]"), "-").take(120).ifBlank { "network-capture.json" }
  }
}

/** Registers [NetInspectorModule] as a TurboModule (added in MainApplication). */
class NetInspectorPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == NetInspectorModule.NAME) NetInspectorModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
      // name, className, canOverrideExistingModule, needsEagerInit, isCxxModule, isTurboModule
      NetInspectorModule.NAME to
        ReactModuleInfo(NetInspectorModule.NAME, NetInspectorModule.NAME, false, false, false, true),
    )
  }
}
