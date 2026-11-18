package com.rnboilerplate.photowidget

import android.app.Activity
import android.app.AlertDialog
import android.appwidget.AppWidgetManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.widget.Toast
import com.rnboilerplate.R
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Shown by the launcher when a photo widget is added (or reconfigured):
 * pick one of the photo widgets set up in the app, or a new photo from the
 * gallery (system photo picker — no storage permission). Cancelling leaves
 * the widget unplaced.
 */
class PhotoWidgetConfigureActivity : Activity() {
  private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID
  private val io = Executors.newSingleThreadExecutor()

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    widgetId = intent?.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
      ?: AppWidgetManager.INVALID_APPWIDGET_ID
    // Until a photo is chosen, backing out cancels the placement.
    setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
    if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
      finish()
      return
    }
    if (savedInstanceState != null) return
    val configs = PhotoWidgetStore(this).configs()
    if (configs.isEmpty()) {
      pickPhoto()
      return
    }
    val names = configs.mapIndexed { i, c -> c.name.ifBlank { getString(R.string.photo_widget_unnamed, i + 1) } } +
      getString(R.string.photo_widget_choose_new)
    AlertDialog.Builder(this)
      .setTitle(R.string.photo_widget_choose_title)
      .setItems(names.toTypedArray()) { _, which ->
        if (which < configs.size) done(configs[which].id) else pickPhoto()
      }
      .setOnCancelListener { finish() }
      .show()
  }

  override fun onDestroy() {
    io.shutdown()
    super.onDestroy()
  }

  private fun pickPhoto() {
    val picker =
      if (Build.VERSION.SDK_INT >= 33) Intent(MediaStore.ACTION_PICK_IMAGES).setType("image/*")
      else Intent(Intent.ACTION_GET_CONTENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE)
    try {
      @Suppress("DEPRECATION") startActivityForResult(picker, REQUEST_PICK)
    } catch (_: Exception) {
      finish()
    }
  }

  @Deprecated("Activity result API kept simple for a single picker")
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    @Suppress("DEPRECATION") super.onActivityResult(requestCode, resultCode, data)
    val uri = data?.data
    if (requestCode != REQUEST_PICK || resultCode != RESULT_OK || uri == null) {
      finish()
      return
    }
    io.execute {
      try {
        val img = PhotoImages.import(this, uri)
        val store = PhotoWidgetStore(this)
        val config = PhotoConfig(
          id = UUID.randomUUID().toString(),
          name = getString(R.string.photo_widget_unnamed, store.configs().size + 1),
          image = img.path,
          imgW = img.width,
          imgH = img.height,
          mode = "fill",
          frameW = 0,
          frameH = 0,
          focusX = 0.5f,
          focusY = 0.5f,
          zoom = 1f,
          corner = 16,
          updatedAt = System.currentTimeMillis(),
        )
        store.upsert(config)
        runOnUiThread { done(config.id) }
      } catch (_: Exception) {
        runOnUiThread {
          Toast.makeText(this, R.string.photo_widget_import_failed, Toast.LENGTH_LONG).show()
          finish()
        }
      }
    }
  }

  private fun done(configId: String) {
    PhotoWidgetStore(this).bind(widgetId, configId)
    PhotoWidgetProvider.render(this, widgetId)
    setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
    finish()
  }

  private companion object {
    const val REQUEST_PICK = 0x7601
  }
}

/**
 * "Add to home screen" from the app: the launcher calls back here with the
 * new widget's id once the user accepts, so it shows the right photo.
 */
class PhotoWidgetPinReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
    val configId = intent.getStringExtra(EXTRA_CONFIG) ?: return
    if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) return
    if (PhotoWidgetStore(context).config(configId) == null) return
    PhotoWidgetStore(context).bind(widgetId, configId)
    PhotoWidgetProvider.refresh(context, configId)
  }

  companion object {
    const val EXTRA_CONFIG = "configId"
  }
}
