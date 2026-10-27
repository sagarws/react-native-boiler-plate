package com.rnboilerplate.screenocr

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle

/**
 * Invisible activity that shows Android's own screen-capture consent dialog
 * and, if the user agrees, starts [OverlayCaptureService] with the token.
 *
 * The user chooses in Android's dialog (Android 14+): "Entire screen" lets
 * the button read any app; "One app" limits capture to that app — Akshar
 * then reads only it, and says so when another app is in front. The consent
 * token is single use, so every enable asks again — Android does not allow
 * it to be stored.
 */
class CaptureConsentActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    // Recreated after a configuration change: the dialog is already showing.
    if (savedInstanceState != null) return
    val manager = getSystemService(MediaProjectionManager::class.java)
    // No MediaProjectionConfig: both "Entire screen" and "One app" are offered.
    val request = manager.createScreenCaptureIntent()
    try {
      @Suppress("DEPRECATION") startActivityForResult(request, REQUEST_CAPTURE)
    } catch (e: RuntimeException) {
      complete(false)
    }
  }

  @Deprecated("Activity result API kept for a plain, dependency-free Activity")
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    @Suppress("DEPRECATION") super.onActivityResult(requestCode, resultCode, data)
    if (requestCode != REQUEST_CAPTURE) return
    val granted = resultCode == RESULT_OK && data != null
    if (granted && data != null) OverlayCaptureService.start(this, resultCode, data)
    complete(granted)
  }

  private fun complete(granted: Boolean) {
    ScreenOcrBus.deliverConsent(granted)
    finish()
    @Suppress("DEPRECATION") overridePendingTransition(0, 0)
  }

  override fun onDestroy() {
    // Dismissed without an answer (e.g. task removed): never leave JS waiting.
    if (isFinishing) ScreenOcrBus.deliverConsent(false)
    super.onDestroy()
  }

  private companion object {
    const val REQUEST_CAPTURE = 4201
  }
}
