package com.rnboilerplate.audiostudio

import android.app.PendingIntent
import android.content.Intent
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

/**
 * Hosts the MediaSession for [AudioStudioPlayer]. Media3 turns it into a
 * mediaPlayback foreground service while playing and posts the default media
 * notification (lock screen, Bluetooth / headset buttons, system media
 * controls). Started by the module when a queue is set; stopped when the
 * queue is cleared or the task is swiped away while paused.
 */
class AudioStudioService : MediaSessionService() {
  private var session: MediaSession? = null

  override fun onCreate() {
    super.onCreate()
    val builder = MediaSession.Builder(this, AudioStudioPlayer.sessionPlayer(this))
    packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
      builder.setSessionActivity(
        PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT),
      )
    }
    val created = builder.build()
    session = created
    // Started (not bound) by the module: register the session so Media3 shows its notification.
    addSession(created)
    AudioStudioPlayer.serviceRunning = true
    AudioStudioPlayer.stopService = { stopAndRelease() }
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

  override fun onTaskRemoved(rootIntent: Intent?) {
    val player = session?.player
    if (player == null || !player.playWhenReady || player.mediaItemCount == 0) stopAndRelease()
  }

  override fun onDestroy() {
    AudioStudioPlayer.serviceRunning = false
    AudioStudioPlayer.stopService = null
    // Without the service there is no foreground state: never keep playing unseen.
    // The queue stays, so play() from the app restarts the service with it.
    AudioStudioPlayer.pauseNow()
    session?.release()
    session = null
    super.onDestroy()
  }

  private fun stopAndRelease() {
    session?.release()
    session = null
    AudioStudioPlayer.release()
    stopSelf()
  }
}
