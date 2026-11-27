package com.rnboilerplate.systemaudio

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle

/**
 * Invisible trampoline for Android's screen-capture consent dialog (the gate
 * for playback capture). On OK it hands the result to
 * [SystemAudioCaptureService] while this activity is still visible, so the
 * service may enter the foreground with the mediaProjection type, as
 * Android requires. Own token, never shared with the OCR or recorder flows.
 */
class SystemAudioConsentActivity : Activity() {
  private var answered = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (savedInstanceState != null) return // The dialog is already showing.
    val manager = getSystemService(MediaProjectionManager::class.java)
    try {
      val intent =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
          // Whole display: a single-app share would limit capture to that one app.
          manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
        } else {
          manager.createScreenCaptureIntent()
        }
      @Suppress("DEPRECATION") startActivityForResult(intent, REQUEST_CAPTURE)
    } catch (_: RuntimeException) {
      deliver(RESULT_CANCELED, null)
    }
  }

  @Deprecated("Activity result API kept for a plain, dependency-free Activity")
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    @Suppress("DEPRECATION") super.onActivityResult(requestCode, resultCode, data)
    if (requestCode != REQUEST_CAPTURE) return
    if (resultCode == RESULT_OK && data != null) deliver(resultCode, data) else deliver(RESULT_CANCELED, null)
  }

  private fun deliver(resultCode: Int, data: Intent?) {
    answered = true
    SystemAudioCaptureService.deliverConsent(this, resultCode, data)
    finish()
    @Suppress("DEPRECATION") overridePendingTransition(0, 0)
  }

  override fun onDestroy() {
    // Closed without an answer (task removed): never leave the promise waiting.
    if (isFinishing && !answered) SystemAudioCaptureService.deliverConsent(this, RESULT_CANCELED, null)
    super.onDestroy()
  }

  companion object {
    private const val REQUEST_CAPTURE = 4811

    fun start(context: Context) {
      context.startActivity(
        Intent(context, SystemAudioConsentActivity::class.java)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION),
      )
    }
  }
}
