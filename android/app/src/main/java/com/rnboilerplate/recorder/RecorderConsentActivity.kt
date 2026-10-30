package com.rnboilerplate.recorder

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Bundle

/**
 * Invisible trampoline that asks for what a recording action needs, in
 * order: the microphone permission (Android gates both microphone and
 * system-audio capture behind RECORD_AUDIO), then Android's own
 * screen-capture consent dialog. Its result goes to [RecorderService],
 * which enters the foreground while this activity is still visible — as
 * Android requires for mediaProjection and microphone services.
 *
 * Separate from the OCR button's consent activity; the two never share a
 * token.
 */
class RecorderConsentActivity : Activity() {
  private var needProjection = false
  private var action = ""
  private var answered = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    needProjection = intent.getBooleanExtra(EXTRA_PROJECTION, false)
    action = intent.getStringExtra(EXTRA_ACTION).orEmpty()
    if (savedInstanceState != null) return // A dialog is already showing.
    if (intent.getBooleanExtra(EXTRA_MIC, false) &&
      checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
    ) {
      requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_MIC)
    } else {
      next()
    }
  }

  override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    if (requestCode != REQUEST_MIC) return
    if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) next() else deliver(RecorderService.RESULT_MIC_DENIED, null)
  }

  private fun next() {
    if (!needProjection) {
      deliver(RESULT_OK, null)
      return
    }
    val manager = getSystemService(MediaProjectionManager::class.java)
    try {
      @Suppress("DEPRECATION") startActivityForResult(manager.createScreenCaptureIntent(), REQUEST_CAPTURE)
    } catch (_: RuntimeException) {
      deliver(RecorderService.RESULT_CANCELLED, null)
    }
  }

  @Deprecated("Activity result API kept for a plain, dependency-free Activity")
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    @Suppress("DEPRECATION") super.onActivityResult(requestCode, resultCode, data)
    if (requestCode != REQUEST_CAPTURE) return
    if (resultCode == RESULT_OK && data != null) deliver(resultCode, data) else deliver(RecorderService.RESULT_CANCELLED, null)
  }

  private fun deliver(resultCode: Int, data: Intent?) {
    answered = true
    RecorderService.deliverConsent(this, action, resultCode, data)
    finish()
    @Suppress("DEPRECATION") overridePendingTransition(0, 0)
  }

  override fun onDestroy() {
    // Closed without an answer (task removed): never leave the service waiting.
    if (isFinishing && !answered) RecorderService.deliverConsent(this, action, RecorderService.RESULT_CANCELLED, null)
    super.onDestroy()
  }

  companion object {
    private const val EXTRA_PROJECTION = "projection"
    private const val EXTRA_MIC = "mic"
    private const val EXTRA_ACTION = "action"
    private const val REQUEST_CAPTURE = 4301
    private const val REQUEST_MIC = 4302

    fun start(context: Context, action: String, projection: Boolean, mic: Boolean) {
      context.startActivity(
        Intent(context, RecorderConsentActivity::class.java)
          .putExtra(EXTRA_ACTION, action)
          .putExtra(EXTRA_PROJECTION, projection)
          .putExtra(EXTRA_MIC, mic)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION),
      )
    }
  }
}
