package com.rnboilerplate.expense

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Base64
import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.rnboilerplate.screenocr.NativeExpenseSpec
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors

/**
 * Expense Tracker's TurboModule: lists the installed UPI apps for a
 * `upi://pay` link and opens the one the user picks (or Android's chooser),
 * and reads a payment QR from a gallery image (ML Kit, on the device).
 *
 * No payment gateway, no credentials, no network: the link goes to the UPI
 * app, which handles the payment. The app's result is passed back only as a
 * hint — the user confirms what happened. Links and responses are never logged.
 */
class ExpenseModule(context: ReactApplicationContext) : NativeExpenseSpec(context) {
  private val io = Executors.newSingleThreadExecutor()
  private var pendingLaunch: Promise? = null
  private var pendingImage: Promise? = null

  private val results = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode == REQUEST_IMAGE) {
        onImage(resultCode, data)
        return
      }
      if (requestCode != REQUEST_UPI) return
      val promise = pendingLaunch ?: return
      pendingLaunch = null
      // UPI apps report e.g. "txnId=…&Status=SUCCESS" under "response".
      val response = data?.getStringExtra("response") ?: data?.getStringExtra("Status") ?: ""
      promise.resolve(
        JSONObject()
          .put("result", if (resultCode == Activity.RESULT_OK) "ok" else "cancelled")
          .put("response", response.take(MAX_RESPONSE))
          .toString(),
      )
    }
  }

  override fun initialize() {
    super.initialize()
    reactApplicationContext.addActivityEventListener(results)
  }

  override fun invalidate() {
    reactApplicationContext.removeActivityEventListener(results)
    pendingLaunch?.reject(E_LAUNCH_FAILED, "Module was torn down")
    pendingLaunch = null
    pendingImage?.resolve("")
    pendingImage = null
    io.shutdown()
    super.invalidate()
  }

  override fun getUpiApps(uri: String, promise: Promise) {
    val target = upiUri(uri)
    if (target == null) {
      promise.reject(E_INVALID_URI, "Not a UPI payment link")
      return
    }
    io.execute {
      try {
        val pm = reactApplicationContext.packageManager
        val apps = JSONArray()
        resolvers(target).forEach { info ->
          apps.put(
            JSONObject()
              .put("packageName", info.activityInfo.packageName)
              .put("label", info.loadLabel(pm).toString().take(60))
              .put("icon", iconOf(info.loadIcon(pm))),
          )
        }
        promise.resolve(apps.toString())
      } catch (error: Exception) {
        promise.reject(E_LAUNCH_FAILED, "Could not list UPI apps", error)
      }
    }
  }

  override fun launchUpiApp(uri: String, packageName: String, promise: Promise) {
    val target = upiUri(uri)
    if (target == null) {
      promise.reject(E_INVALID_URI, "Not a UPI payment link")
      return
    }
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject(E_NO_ACTIVITY, "The app must be in the foreground")
      return
    }
    // Only an app Android itself lists as a UPI handler may receive the link.
    if (resolvers(target).none { it.activityInfo.packageName == packageName }) {
      promise.reject(E_NO_APP, "That app can't handle UPI payments")
      return
    }
    pendingLaunch?.reject(E_LAUNCH_FAILED, "Replaced by a newer payment")
    pendingLaunch = promise
    try {
      val intent = Intent(Intent.ACTION_VIEW, target).setPackage(packageName)
      @Suppress("DEPRECATION") activity.startActivityForResult(intent, REQUEST_UPI)
    } catch (error: ActivityNotFoundException) {
      pendingLaunch = null
      promise.reject(E_NO_APP, "UPI app not found", error)
    } catch (error: Exception) {
      pendingLaunch = null
      promise.reject(E_LAUNCH_FAILED, "UPI app could not be opened", error)
    }
  }

  override fun launchUpiChooser(uri: String, title: String, promise: Promise) {
    val target = upiUri(uri)
    if (target == null) {
      promise.reject(E_INVALID_URI, "Not a UPI payment link")
      return
    }
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject(E_NO_ACTIVITY, "The app must be in the foreground")
      return
    }
    pendingLaunch?.reject(E_LAUNCH_FAILED, "Replaced by a newer payment")
    pendingLaunch = promise
    try {
      val chooser = Intent.createChooser(Intent(Intent.ACTION_VIEW, target), title.take(60))
      @Suppress("DEPRECATION") activity.startActivityForResult(chooser, REQUEST_UPI)
    } catch (error: ActivityNotFoundException) {
      pendingLaunch = null
      promise.reject(E_NO_APP, "No UPI app found", error)
    } catch (error: Exception) {
      pendingLaunch = null
      promise.reject(E_LAUNCH_FAILED, "UPI app could not be opened", error)
    }
  }

  override fun openUpiApp(packageName: String, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject(E_NO_ACTIVITY, "The app must be in the foreground")
      return
    }
    val probe = Uri.parse("upi://pay?pa=probe@upi")
    if (resolvers(probe).none { it.activityInfo.packageName == packageName }) {
      promise.reject(E_NO_APP, "That app can't handle UPI payments")
      return
    }
    val launch = reactApplicationContext.packageManager.getLaunchIntentForPackage(packageName)
    if (launch == null) {
      promise.reject(E_NO_APP, "That app has no launcher screen")
      return
    }
    try {
      activity.startActivity(launch)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject(E_LAUNCH_FAILED, "UPI app could not be opened", error)
    }
  }

  override fun pickQrImage(promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject(E_NO_ACTIVITY, "The app must be in the foreground")
      return
    }
    pendingImage?.resolve("")
    pendingImage = promise
    // The system photo picker needs no storage permission; older phones
    // without it get the document picker, which doesn't either.
    val picker =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        Intent(MediaStore.ACTION_PICK_IMAGES).setType("image/*")
      } else {
        Intent(Intent.ACTION_GET_CONTENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE)
      }
    try {
      @Suppress("DEPRECATION") activity.startActivityForResult(picker, REQUEST_IMAGE)
    } catch (error: Exception) {
      pendingImage = null
      promise.reject(E_IMAGE_FAILED, "Photo picker could not be opened", error)
    }
  }

  private fun onImage(resultCode: Int, data: Intent?) {
    val promise = pendingImage ?: return
    pendingImage = null
    val uri = data?.data
    if (resultCode != Activity.RESULT_OK || uri == null) {
      promise.resolve("")
      return
    }
    val image = try {
      InputImage.fromFilePath(reactApplicationContext, uri)
    } catch (error: Exception) {
      promise.reject(E_IMAGE_FAILED, "Image could not be read", error)
      return
    }
    val scanner = BarcodeScanning.getClient(
      BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build(),
    )
    scanner.process(image)
      .addOnSuccessListener { codes ->
        val value = codes.firstOrNull { !it.rawValue.isNullOrEmpty() }?.rawValue
        if (value == null) promise.reject(E_NO_QR, "No QR code in the image")
        else promise.resolve(value)
      }
      .addOnFailureListener { error -> promise.reject(E_IMAGE_FAILED, "QR could not be read", error) }
      .addOnCompleteListener { scanner.close() }
  }

  /** The link as a Uri when it is a `upi://pay` link with a payee, else null. */
  private fun upiUri(raw: String): Uri? {
    if (raw.length > MAX_URI) return null
    val uri = runCatching { Uri.parse(raw) }.getOrNull() ?: return null
    if (!uri.scheme.equals("upi", ignoreCase = true) || !uri.host.equals("pay", ignoreCase = true)) return null
    return if (uri.getQueryParameter("pa").isNullOrBlank()) null else uri
  }

  private fun resolvers(uri: Uri): List<ResolveInfo> {
    val pm = reactApplicationContext.packageManager
    val intent = Intent(Intent.ACTION_VIEW, uri)
    val list = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      pm.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(0))
    } else {
      @Suppress("DEPRECATION") pm.queryIntentActivities(intent, 0)
    }
    val self = reactApplicationContext.packageName
    return list.filter { it.activityInfo?.packageName != null && it.activityInfo.packageName != self }
      .distinctBy { it.activityInfo.packageName }
  }

  private fun iconOf(drawable: Drawable?): String {
    if (drawable == null) return ""
    return try {
      val bitmap = Bitmap.createBitmap(ICON_PX, ICON_PX, Bitmap.Config.ARGB_8888)
      val canvas = Canvas(bitmap)
      drawable.setBounds(0, 0, ICON_PX, ICON_PX)
      drawable.draw(canvas)
      val out = ByteArrayOutputStream()
      bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
      bitmap.recycle()
      "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    } catch (_: Exception) {
      ""
    }
  }

  companion object {
    const val NAME = NativeExpenseSpec.NAME
    private const val REQUEST_UPI = 0x5601
    private const val REQUEST_IMAGE = 0x5602
    private const val ICON_PX = 96
    private const val MAX_URI = 2048
    private const val MAX_RESPONSE = 500
    private const val E_INVALID_URI = "invalid_uri"
    private const val E_NO_APP = "no_app"
    private const val E_NO_ACTIVITY = "no_activity"
    private const val E_LAUNCH_FAILED = "launch_failed"
    private const val E_NO_QR = "no_qr"
    private const val E_IMAGE_FAILED = "image_failed"
  }
}

/** Registers [ExpenseModule] as a TurboModule (added in MainApplication). */
class ExpensePackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == ExpenseModule.NAME) ExpenseModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
      // name, className, canOverrideExistingModule, needsEagerInit, isCxxModule, isTurboModule
      ExpenseModule.NAME to ReactModuleInfo(ExpenseModule.NAME, ExpenseModule.NAME, false, false, false, true),
    )
  }
}
