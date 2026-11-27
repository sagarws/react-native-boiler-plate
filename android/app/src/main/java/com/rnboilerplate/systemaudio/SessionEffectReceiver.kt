package com.rnboilerplate.systemaudio

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.media.audiofx.AudioEffect
import androidx.core.content.ContextCompat

/**
 * Hears players announce / end their audio sessions and forwards them to
 * [SessionEffects]. Carries no data beyond a session id and a package name.
 *
 * Delivery, honestly: OPEN/CLOSE_AUDIO_EFFECT_CONTROL_SESSION are NOT on
 * Android 8+'s list of implicit broadcasts exempt from the background
 * limits. So the manifest entry only receives them when the player addresses
 * this app directly (setPackage, e.g. after the user picked it as the
 * equalizer) or sends with FLAG_RECEIVER_INCLUDE_BACKGROUND. Most players
 * broadcast implicitly; those reach the copy registered at runtime by
 * [registerRuntime] — only while this process runs (the studio module or the
 * capture service is alive). Sessions opened while the process was dead are
 * unknown until the player re-announces them (usually on its next track).
 */
class SessionEffectReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val session = intent.getIntExtra(AudioEffect.EXTRA_AUDIO_SESSION, AudioManager.ERROR)
    val pkg = intent.getStringExtra(AudioEffect.EXTRA_PACKAGE_NAME).orEmpty()
    if (session <= 0 || pkg.isEmpty()) return
    val effects = SessionEffects.get(context)
    when (intent.action) {
      AudioEffect.ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION -> effects.open(session, pkg)
      AudioEffect.ACTION_CLOSE_AUDIO_EFFECT_CONTROL_SESSION -> effects.close(session)
    }
  }

  companion object {
    private var runtime: SessionEffectReceiver? = null
    private var users = 0

    /** Reference-counted runtime registration (exported: the senders are other apps). */
    @Synchronized fun registerRuntime(context: Context) {
      users++
      if (runtime != null) return
      val filter =
        IntentFilter().apply {
          addAction(AudioEffect.ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION)
          addAction(AudioEffect.ACTION_CLOSE_AUDIO_EFFECT_CONTROL_SESSION)
        }
      val r = SessionEffectReceiver()
      ContextCompat.registerReceiver(context.applicationContext, r, filter, ContextCompat.RECEIVER_EXPORTED)
      runtime = r
    }

    @Synchronized fun unregisterRuntime(context: Context) {
      if (users > 0) users--
      if (users > 0) return
      runtime?.let { runCatching { context.applicationContext.unregisterReceiver(it) } }
      runtime = null
    }
  }
}
