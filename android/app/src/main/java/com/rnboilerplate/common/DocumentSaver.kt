package com.rnboilerplate.common

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import java.io.OutputStream
import java.util.concurrent.Executors

/**
 * "Save to…" through the system file picker (Storage Access Framework): the
 * user chooses the folder and name, so no storage permission is needed and
 * nothing lands anywhere they didn't pick. One save at a time per owner; the
 * writes run off the main thread. Resolves true when written, false when the
 * user cancelled; rejects on a write failure (e.g. storage full).
 */
class DocumentSaver(
  private val context: ReactApplicationContext,
  private val requestCode: Int,
) : BaseActivityEventListener() {
  private class Pending(val promise: Promise, val write: (OutputStream) -> Unit)

  /** Several files into one folder the user picks (resolves the count). */
  private class PendingFolder(
    val promise: Promise,
    val mimeType: String,
    val files: List<Pair<String, (OutputStream) -> Unit>>,
  )

  private var pending: Pending? = null
  private var pendingFolder: PendingFolder? = null
  private val io = Executors.newSingleThreadExecutor()

  fun attach() = context.addActivityEventListener(this)

  fun detach() {
    context.removeActivityEventListener(this)
    pending?.promise?.resolve(false)
    pending = null
    pendingFolder?.promise?.resolve(0)
    pendingFolder = null
    io.shutdown()
  }

  fun save(fileName: String, mimeType: String, promise: Promise, write: (OutputStream) -> Unit) {
    val activity = context.currentActivity
    if (activity == null) {
      promise.reject(E_NO_ACTIVITY, "The app must be in the foreground")
      return
    }
    // A second request supersedes one still waiting for the picker.
    pending?.promise?.resolve(false)
    pending = Pending(promise, write)
    val intent =
      Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = mimeType
        putExtra(Intent.EXTRA_TITLE, fileName)
      }
    try {
      @Suppress("DEPRECATION") activity.startActivityForResult(intent, requestCode)
    } catch (e: ActivityNotFoundException) {
      pending = null
      promise.reject(E_NO_PICKER, "No file picker available", e)
    }
  }

  /**
   * Asks for a folder (system picker), then creates each named file in it.
   * Resolves how many were written; 0 when the user cancelled.
   */
  fun saveToFolder(
    mimeType: String,
    files: List<Pair<String, (OutputStream) -> Unit>>,
    promise: Promise,
  ) {
    val activity = context.currentActivity
    if (activity == null) {
      promise.reject(E_NO_ACTIVITY, "The app must be in the foreground")
      return
    }
    pendingFolder?.promise?.resolve(0)
    pendingFolder = PendingFolder(promise, mimeType, files)
    try {
      @Suppress("DEPRECATION")
      activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), requestCode + 1)
    } catch (e: ActivityNotFoundException) {
      pendingFolder = null
      promise.reject(E_NO_PICKER, "No folder picker available", e)
    }
  }

  private fun writeFolder(job: PendingFolder, tree: Uri) {
    io.execute {
      try {
        val dir = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
        var written = 0
        for ((name, write) in job.files) {
          val doc = DocumentsContract.createDocument(context.contentResolver, dir, job.mimeType, name)
            ?: throw IllegalStateException("Cannot create $name")
          context.contentResolver.openOutputStream(doc, "w")?.use { write(it); written++ }
            ?: throw IllegalStateException("Cannot open $name")
        }
        job.promise.resolve(written.toDouble())
      } catch (e: Exception) {
        job.promise.reject(E_WRITE, e.message ?: "Write failed", e)
      }
    }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode == this.requestCode + 1) {
      val job = pendingFolder ?: return
      pendingFolder = null
      val tree = data?.data
      if (resultCode != Activity.RESULT_OK || tree == null) job.promise.resolve(0) else writeFolder(job, tree)
      return
    }
    if (requestCode != this.requestCode) return
    val job = pending ?: return
    pending = null
    val uri = data?.data
    if (resultCode != Activity.RESULT_OK || uri == null) {
      job.promise.resolve(false)
      return
    }
    io.execute {
      try {
        val stream = context.contentResolver.openOutputStream(uri, "wt")
          ?: throw IllegalStateException("Cannot open the chosen file")
        stream.use { job.write(it) }
        job.promise.resolve(true)
      } catch (e: Exception) {
        job.promise.reject(E_WRITE, e.message ?: "Write failed", e)
      }
    }
  }

  companion object {
    const val E_NO_ACTIVITY = "no_activity"
    const val E_NO_PICKER = "no_picker"
    const val E_WRITE = "write_failed"
  }
}
