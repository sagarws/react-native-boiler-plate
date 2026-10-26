package com.rnboilerplate.screenocr

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.PersistableBundle
import org.json.JSONObject

/**
 * In-process hand-off between the overlay service, the consent activity and
 * the React Native module, which can each start and stop independently.
 */
object ScreenOcrBus {
  interface Listener {
    fun onCaptureResult()

    fun onStatusChanged()
  }

  @Volatile var listener: Listener? = null

  /** The most recent capture. Memory only — gone when the process dies. */
  @Volatile var latest: JSONObject? = null

  /** Resolves the pending `startOverlay()` call once the user answers the consent dialog. */
  @Volatile var consentCallback: ((Boolean) -> Unit)? = null

  fun deliverConsent(granted: Boolean) {
    val callback = consentCallback
    consentCallback = null
    callback?.invoke(granted)
  }

  fun notifyResult() {
    listener?.onCaptureResult()
  }

  fun notifyStatus() {
    listener?.onStatusChanged()
  }
}

object ClipboardHelper {
  /**
   * Copies [text] as plain text. Unicode (Devanagari included) is stored as
   * is. [sensitive] asks Android 13+ to hide the clipboard preview — used for
   * background captures, whose content the user has not looked at yet.
   */
  fun copy(context: Context, text: String, sensitive: Boolean): Boolean =
    try {
      val clipboard = context.getSystemService(ClipboardManager::class.java)
      val clip = ClipData.newPlainText("Extracted text", text)
      if (sensitive && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        clip.description.extras =
          PersistableBundle().apply { putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true) }
      }
      clipboard.setPrimaryClip(clip)
      true
    } catch (_: RuntimeException) {
      false
    }
}
