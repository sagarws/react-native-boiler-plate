package com.rnboilerplate.systemaudio

import android.accessibilityservice.AccessibilityService
import android.content.ComponentName
import android.content.Context
import android.media.AudioManager
import android.provider.Settings
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent

/**
 * 8D volume helper. While it is enabled (by the user, in Android's
 * accessibility settings) the accessibility audio stream has its own volume
 * (flagEnableAccessibilityVolume) — that is what lets "Hear only the 8D sound"
 * silence the original app with media volume 0 and still be heard.
 *
 * While that mode is on, volume up/down change the 8D volume instead of the
 * media volume (which would bring the original back). Every other key, and
 * the volume keys when the mode is off, pass through untouched. It reads no
 * screen content.
 */
class EightDVolumeService : AccessibilityService() {
  override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

  override fun onInterrupt() = Unit

  override fun onKeyEvent(event: KeyEvent): Boolean {
    if (!HearOnly8D.active) return false
    val dir =
      when (event.keyCode) {
        KeyEvent.KEYCODE_VOLUME_UP -> AudioManager.ADJUST_RAISE
        KeyEvent.KEYCODE_VOLUME_DOWN -> AudioManager.ADJUST_LOWER
        else -> return false
      }
    if (event.action == KeyEvent.ACTION_DOWN) {
      val am = getSystemService(AudioManager::class.java)
      am?.adjustStreamVolume(AudioManager.STREAM_ACCESSIBILITY, dir, AudioManager.FLAG_SHOW_UI)
      HearOnly8D.verifyLater(this)
    }
    return true
  }

  companion object {
    /** Is this service switched on in Android's accessibility settings? */
    fun isEnabled(context: Context): Boolean {
      val enabled =
        Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
      val me = ComponentName(context, EightDVolumeService::class.java)
      return enabled.split(':').any { ComponentName.unflattenFromString(it) == me }
    }
  }
}
