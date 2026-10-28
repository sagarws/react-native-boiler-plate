package com.rnboilerplate.utility

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.IntentSender
import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.ar.core.ArCoreApk
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import com.rnboilerplate.common.DocumentSaver
import com.rnboilerplate.common.FileShare
import com.rnboilerplate.screenocr.NativeUtilitySpec
import org.json.JSONArray
import java.util.concurrent.Executors

/**
 * Utility tools' TurboModule: compass, water-eject tone, QR/barcode scanner,
 * document scanner + export, AR Measure. Each tool is independent; a failure
 * in one is reported to its screen and doesn't affect the others.
 */
class UtilityModule(context: ReactApplicationContext) : NativeUtilitySpec(context) {
  private val io = Executors.newSingleThreadExecutor()
  private val saver = DocumentSaver(context, REQUEST_SAVE)
  private var compass: CompassSensor? = null
  private var tone: TonePlayer? = null
  private var pendingBarcode: Promise? = null
  private var pendingDocument: Promise? = null
  private var pendingMeasure: Promise? = null

  private val results = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      when (requestCode) {
        REQUEST_BARCODE -> onBarcode(resultCode, data)
        REQUEST_DOCUMENT -> onDocument(resultCode, data)
        REQUEST_MEASURE -> onMeasure(resultCode, data)
      }
    }
  }

  override fun initialize() {
    super.initialize()
    saver.attach()
    reactApplicationContext.addActivityEventListener(results)
  }

  override fun invalidate() {
    reactApplicationContext.removeActivityEventListener(results)
    saver.detach()
    UiThreadUtil.runOnUiThread {
      compass?.stop()
      tone?.stop(null)
    }
    io.shutdown()
    super.invalidate()
  }

  private fun emit(event: String, body: com.facebook.react.bridge.WritableMap) {
    if (reactApplicationContext.hasActiveReactInstance()) reactApplicationContext.emitDeviceEvent(event, body)
  }

  // ── Compass ──

  private fun compassSensor(): CompassSensor =
    compass ?: CompassSensor(reactApplicationContext) { heading, accuracy ->
      emit(EVENT_COMPASS, Arguments.createMap().apply {
        putDouble("heading", heading)
        putInt("accuracy", accuracy)
      })
    }.also { compass = it }

  override fun getCompassSupport(promise: Promise) = promise.resolve(compassSensor().support)

  override fun startCompass() {
    UiThreadUtil.runOnUiThread { compassSensor().start() }
  }

  override fun stopCompass() {
    UiThreadUtil.runOnUiThread { compass?.stop() }
  }

  // ── Water eject ──

  private fun tonePlayer(): TonePlayer =
    tone ?: TonePlayer(reactApplicationContext) { reason ->
      emit(EVENT_TONE_ENDED, Arguments.createMap().apply { putString("reason", reason) })
    }.also { tone = it }

  override fun hasVibrator(promise: Promise) = promise.resolve(tonePlayer().hasVibrator())

  override fun startTone(mode: String, durationMs: Double, vibrate: Boolean, promise: Promise) {
    UiThreadUtil.runOnUiThread { promise.resolve(tonePlayer().start(mode, durationMs.toLong(), vibrate)) }
  }

  override fun stopTone() {
    UiThreadUtil.runOnUiThread { tone?.stop("stopped") }
  }

  // ── Barcode ──

  override fun scanBarcode(labelsJson: String, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject(E_NO_ACTIVITY, "The app must be in the foreground")
      return
    }
    pendingBarcode?.resolve("")
    pendingBarcode = promise
    val intent = Intent(activity, BarcodeScanActivity::class.java).putExtra(BarcodeScanActivity.EXTRA_LABELS, labelsJson)
    @Suppress("DEPRECATION") activity.startActivityForResult(intent, REQUEST_BARCODE)
  }

  private fun onBarcode(resultCode: Int, data: Intent?) {
    val promise = pendingBarcode ?: return
    pendingBarcode = null
    val result = data?.getStringExtra(BarcodeScanActivity.EXTRA_RESULT)
    when {
      resultCode != Activity.RESULT_OK || result == null -> promise.resolve("")
      result.startsWith(BarcodeScanActivity.ERROR_PREFIX) ->
        promise.reject(result.removePrefix(BarcodeScanActivity.ERROR_PREFIX), "Scanner could not start")
      else -> promise.resolve(result)
    }
  }

  // ── Documents ──

  override fun getDocumentScannerSupport(promise: Promise) {
    val ok = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(reactApplicationContext) ==
      ConnectionResult.SUCCESS
    promise.resolve(if (ok) "available" else "unavailable")
  }

  override fun scanDocument(pageLimit: Double, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject(E_NO_ACTIVITY, "The app must be in the foreground")
      return
    }
    val options = GmsDocumentScannerOptions.Builder()
      .setGalleryImportAllowed(true)
      .setPageLimit(pageLimit.toInt().coerceIn(1, 50))
      .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
      .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
      .build()
    pendingDocument?.resolve("")
    pendingDocument = promise
    GmsDocumentScanning.getClient(options)
      .getStartScanIntent(activity)
      .addOnSuccessListener { sender ->
        try {
          @Suppress("DEPRECATION")
          activity.startIntentSenderForResult(sender, REQUEST_DOCUMENT, null, 0, 0, 0)
        } catch (e: IntentSender.SendIntentException) {
          pendingDocument = null
          promise.reject("scanner_failed", e.message ?: "Scanner could not start", e)
        }
      }
      .addOnFailureListener { e ->
        pendingDocument = null
        promise.reject("scanner_unavailable", e.message ?: "Scanner unavailable", e)
      }
  }

  private fun onDocument(resultCode: Int, data: Intent?) {
    val promise = pendingDocument ?: return
    pendingDocument = null
    val scan = if (resultCode == Activity.RESULT_OK) GmsDocumentScanningResult.fromActivityResultIntent(data) else null
    val uris = scan?.pages?.map { it.imageUri }.orEmpty()
    if (uris.isEmpty()) {
      promise.resolve("")
      return
    }
    io.execute {
      try {
        promise.resolve(JSONArray(DocumentPages.importPages(reactApplicationContext, uris)).toString())
      } catch (e: Exception) {
        promise.reject("import_failed", e.message ?: "Could not keep the scanned pages", e)
      }
    }
  }

  private fun paths(json: String): List<String> = try {
    val arr = JSONArray(json)
    (0 until arr.length()).map { arr.getString(it) }
  } catch (_: Exception) {
    emptyList()
  }

  override fun rotateImage(path: String, degrees: Double, promise: Promise) {
    io.execute {
      try {
        promise.resolve(DocumentPages.rotate(reactApplicationContext, path, degrees.toInt()))
      } catch (e: Exception) {
        promise.reject("rotate_failed", e.message ?: "Rotate failed", e)
      }
    }
  }

  override fun exportPdf(pagesJson: String, fileName: String, promise: Promise) {
    val pages = paths(pagesJson)
    if (pages.isEmpty()) {
      promise.reject("no_pages", "Nothing to export")
      return
    }
    saver.save(PageLayout.safeName(fileName, "pdf"), "application/pdf", promise) {
      DocumentPages.writePdf(reactApplicationContext, pages, it)
    }
  }

  override fun exportImages(pagesJson: String, format: String, baseName: String, promise: Promise) {
    val pages = paths(pagesJson)
    if (pages.isEmpty()) {
      promise.reject("no_pages", "Nothing to export")
      return
    }
    val png = format == "png"
    val ext = if (png) "png" else "jpg"
    val base = PageLayout.safeName(baseName, ext).removeSuffix(".$ext")
    val files = pages.mapIndexed { i, path ->
      "$base-${i + 1}.$ext" to { out: java.io.OutputStream -> DocumentPages.writeImage(reactApplicationContext, path, png, out) }
    }
    saver.saveToFolder(if (png) "image/png" else "image/jpeg", files, promise)
  }

  override fun sharePdf(pagesJson: String, fileName: String, promise: Promise) {
    val pages = paths(pagesJson)
    io.execute {
      try {
        val pdf = DocumentPages.cachePdf(reactApplicationContext, pages, fileName)
        promise.resolve(FileShare.share(reactApplicationContext, listOf(pdf), "application/pdf"))
      } catch (e: Exception) {
        promise.reject("share_failed", e.message ?: "Share failed", e)
      }
    }
  }

  override fun deleteFiles(pathsJson: String) {
    val list = paths(pathsJson)
    io.execute { DocumentPages.delete(reactApplicationContext, list) }
  }

  // ── AR Measure ──

  override fun getArSupport(promise: Promise) {
    val availability = try {
      ArCoreApk.getInstance().checkAvailability(reactApplicationContext)
    } catch (_: Exception) {
      null
    }
    promise.resolve(
      when {
        availability == null || availability.isTransient -> "unknown"
        availability == ArCoreApk.Availability.SUPPORTED_INSTALLED -> "supported"
        availability.isSupported -> "install_required"
        else -> "unsupported"
      },
    )
  }

  override fun measure(mode: String, unit: String, labelsJson: String, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject(E_NO_ACTIVITY, "The app must be in the foreground")
      return
    }
    pendingMeasure?.resolve("")
    pendingMeasure = promise
    val intent = Intent(activity, MeasureActivity::class.java)
      .putExtra(MeasureActivity.EXTRA_MODE, mode)
      .putExtra(MeasureActivity.EXTRA_UNIT, unit)
      .putExtra(MeasureActivity.EXTRA_LABELS, labelsJson)
    try {
      @Suppress("DEPRECATION") activity.startActivityForResult(intent, REQUEST_MEASURE)
    } catch (e: ActivityNotFoundException) {
      pendingMeasure = null
      promise.reject("ar_failed", "AR Measure could not start", e)
    }
  }

  private fun onMeasure(resultCode: Int, data: Intent?) {
    val promise = pendingMeasure ?: return
    pendingMeasure = null
    val error = data?.getStringExtra(MeasureActivity.EXTRA_ERROR)
    val result = data?.getStringExtra(MeasureActivity.EXTRA_RESULT)
    when {
      error != null -> promise.reject(error, "AR Measure: $error")
      resultCode == Activity.RESULT_OK && result != null -> promise.resolve(result)
      else -> promise.resolve("")
    }
  }

  companion object {
    const val NAME = NativeUtilitySpec.NAME
    const val EVENT_COMPASS = "UtilityCompass"
    const val EVENT_TONE_ENDED = "UtilityToneEnded"
    private const val E_NO_ACTIVITY = "no_activity"
    private const val REQUEST_SAVE = 0x5501
    private const val REQUEST_BARCODE = 0x5510
    private const val REQUEST_DOCUMENT = 0x5511
    private const val REQUEST_MEASURE = 0x5512
  }
}

/** Registers [UtilityModule] as a TurboModule (added in MainApplication). */
class UtilityPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == UtilityModule.NAME) UtilityModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
      // name, className, canOverrideExistingModule, needsEagerInit, isCxxModule, isTurboModule
      UtilityModule.NAME to ReactModuleInfo(UtilityModule.NAME, UtilityModule.NAME, false, false, false, true),
    )
  }
}
