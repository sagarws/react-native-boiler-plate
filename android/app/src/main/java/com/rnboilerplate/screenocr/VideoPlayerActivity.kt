package com.rnboilerplate.screenocr

import android.app.Activity
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.MediaController
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import android.widget.VideoView
import com.rnboilerplate.R

/**
 * In-app video player for File Management: streams a Drive file with the
 * caller's short-lived access token (Android's VideoView + MediaController —
 * play/pause/seek; no extra library). Not exported; the token only travels
 * inside this app's own Intent.
 */
class VideoPlayerActivity : Activity() {
  private lateinit var video: VideoView

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    val url = intent.getStringExtra(EXTRA_URL)
    if (url.isNullOrEmpty()) {
      finish()
      return
    }
    val headers = intent.getStringExtra(EXTRA_AUTH)?.let { mapOf("Authorization" to it) }.orEmpty()

    val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
    video =
      VideoView(this).apply {
        layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER)
      }
    val spinner =
      ProgressBar(this).apply {
        layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER)
      }
    val title =
      TextView(this).apply {
        text = intent.getStringExtra(EXTRA_TITLE).orEmpty()
        setTextColor(Color.WHITE)
        textSize = 16f
        maxLines = 1
        setPadding(48, 48, 48, 24)
        setBackgroundColor(0x66000000)
        layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP)
      }
    root.addView(video)
    root.addView(spinner)
    root.addView(title)
    setContentView(root)

    val controller = MediaController(this).apply { setAnchorView(video) }
    video.setMediaController(controller)
    video.setOnPreparedListener {
      spinner.visibility = View.GONE
      video.start()
      controller.show(3000)
    }
    video.setOnErrorListener { _, _, _ ->
      spinner.visibility = View.GONE
      Toast.makeText(this, R.string.video_play_failed, Toast.LENGTH_LONG).show()
      finish()
      true
    }
    video.setOnCompletionListener { controller.show(0) }
    root.setOnClickListener { if (controller.isShowing) controller.hide() else controller.show() }
    video.setVideoURI(Uri.parse(url), headers)
  }

  override fun onPause() {
    super.onPause()
    if (::video.isInitialized) video.pause()
  }

  override fun onDestroy() {
    if (::video.isInitialized) video.stopPlayback()
    super.onDestroy()
  }

  companion object {
    const val EXTRA_URL = "url"
    const val EXTRA_AUTH = "authorization"
    const val EXTRA_TITLE = "title"
  }
}
