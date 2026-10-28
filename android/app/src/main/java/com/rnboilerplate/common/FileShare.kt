package com.rnboilerplate.common

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.File

/**
 * Hands private app files to another app — a viewer (ACTION_VIEW) or the
 * share sheet — through FileProvider content:// URIs with a one-off read
 * grant. Only files under the app's own files/cache folders qualify.
 */
object FileShare {
  private fun authority(context: Context) = "${context.packageName}.files"

  /** A file:// URI string or plain path inside app storage, else null. */
  fun privateFile(context: Context, uriOrPath: String): File? {
    val path = if (uriOrPath.startsWith("file://")) Uri.parse(uriOrPath).path else uriOrPath
    val file = File(path ?: return null).canonicalFile
    val roots = listOf(context.filesDir, context.cacheDir).map { it.canonicalPath + File.separator }
    return if (file.isFile && roots.any { file.path.startsWith(it) }) file else null
  }

  fun contentUri(context: Context, file: File): Uri =
    FileProvider.getUriForFile(context, authority(context), file)

  /** Opens [file] in a viewer app; false when none can open it. */
  fun open(context: Context, file: File, mimeType: String): Boolean {
    val uri = contentUri(context, file)
    val intent =
      Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, mimeType.ifBlank { "*/*" })
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      }
    return try {
      context.startActivity(Intent.createChooser(intent, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    } catch (_: ActivityNotFoundException) {
      false
    }
  }

  /** Opens the share sheet for [files]; false when nothing can receive them. */
  fun share(context: Context, files: List<File>, mimeType: String): Boolean {
    if (files.isEmpty()) return false
    val uris = ArrayList(files.map { contentUri(context, it) })
    val intent =
      if (uris.size == 1) {
        Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, uris[0])
      } else {
        Intent(Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
      }
    intent.type = mimeType
    intent.clipData = ClipData.newRawUri(null, uris[0]).apply { uris.drop(1).forEach { addItem(ClipData.Item(it)) } }
    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    return try {
      context.startActivity(Intent.createChooser(intent, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    } catch (_: ActivityNotFoundException) {
      false
    }
  }
}
