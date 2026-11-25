package com.rnboilerplate.ytdownload

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.ParcelFileDescriptor
import android.provider.MediaStore
import java.io.File

/**
 * Where finished downloads go. Android 10+: the shared Movies/Akshar and
 * Music/Akshar folders through MediaStore — visible in the gallery and music
 * apps, no storage permission. Before Android 10: the app's own external
 * Movies/Music folders (also permission-free; removed with the app).
 */
class DownloadOutput(private val context: Context) {
  class Target(val uri: Uri, val name: String, val file: File?)

  private val folder = "Akshar"

  fun create(name: String, output: OutputFormat, audioOnly: Boolean): Target {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val collection =
        if (audioOnly) MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        else MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
      val base = if (audioOnly) Environment.DIRECTORY_MUSIC else Environment.DIRECTORY_MOVIES
      val values =
        ContentValues().apply {
          put(MediaStore.MediaColumns.DISPLAY_NAME, name)
          put(MediaStore.MediaColumns.MIME_TYPE, output.mime)
          put(MediaStore.MediaColumns.RELATIVE_PATH, "$base/$folder")
          put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
      val uri = context.contentResolver.insert(collection, values) ?: throw YtException("storage_failed")
      return Target(uri, name, null)
    }
    val dir =
      context.getExternalFilesDir(if (audioOnly) Environment.DIRECTORY_MUSIC else Environment.DIRECTORY_MOVIES)
        ?: throw YtException("storage_failed")
    dir.mkdirs()
    var file = File(dir, name)
    var n = 1
    while (file.exists()) file = File(dir, "${name.substringBeforeLast('.')} ($n).${name.substringAfterLast('.')}").also { n++ }
    return Target(Uri.fromFile(file), file.name, file)
  }

  fun openWrite(target: Target): ParcelFileDescriptor =
    context.contentResolver.openFileDescriptor(target.uri, "rw") ?: throw YtException("storage_failed")

  fun finish(target: Target) {
    if (target.file == null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      context.contentResolver.update(target.uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
    }
  }

  fun size(target: Target): Long =
    target.file?.length()
      ?: runCatching { context.contentResolver.openFileDescriptor(target.uri, "r")?.use { it.statSize } }.getOrNull()
      ?: 0L

  fun delete(uri: Uri) {
    runCatching {
      if (uri.scheme == "file") File(uri.path!!).delete() else context.contentResolver.delete(uri, null, null)
    }
  }
}
