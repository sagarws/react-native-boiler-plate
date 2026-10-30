package com.rnboilerplate.recorder

import android.content.ContentResolver
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.ParcelFileDescriptor
import android.os.StatFs
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.provider.OpenableColumns
import androidx.annotation.RequiresApi
import java.io.File

/**
 * Where screenshots, recordings and segments are written.
 *
 * Each [OutputKind] is either a folder the user picked (Storage Access
 * Framework tree with a persisted grant — no storage permission) or its
 * default: MediaStore Pictures/Movies/Recordings "Akshar" on Android 10+
 * (app-owned entries, no permission), the app's own external files folder
 * before that. Temporary segments default to the app's external files
 * folder. MediaStore entries stay pending (hidden from galleries) until
 * [finish], so an incomplete file never shows as a finished recording.
 */
class OutputStorage(private val context: Context) {
  private val resolver: ContentResolver = context.contentResolver

  data class Output(val uri: Uri, val name: String)

  data class DirStatus(val label: String, val custom: Boolean, val accessible: Boolean)

  fun defaultSegmentsDir(): File =
    File(context.getExternalFilesDir(null) ?: context.filesDir, "recordings/segments").apply { mkdirs() }

  private fun fallbackDir(kind: OutputKind): File {
    val type =
      when (kind) {
        OutputKind.SCREENSHOT -> Environment.DIRECTORY_PICTURES
        OutputKind.VOICE -> Environment.DIRECTORY_MUSIC
        else -> Environment.DIRECTORY_MOVIES
      }
    return File(context.getExternalFilesDir(type) ?: context.filesDir, FOLDER).apply { mkdirs() }
  }

  private fun relativePath(kind: OutputKind): String =
    when (kind) {
      OutputKind.SCREENSHOT -> "${Environment.DIRECTORY_PICTURES}/$FOLDER"
      OutputKind.VOICE ->
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) "${Environment.DIRECTORY_RECORDINGS}/$FOLDER"
        else "${Environment.DIRECTORY_MUSIC}/$FOLDER"
      else -> "${Environment.DIRECTORY_MOVIES}/$FOLDER"
    }

  @RequiresApi(Build.VERSION_CODES.Q)
  private fun collection(kind: OutputKind): Uri =
    when (kind) {
      OutputKind.SCREENSHOT -> MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
      OutputKind.VOICE -> MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
      else -> MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    }

  /** Creates an empty file for [kind] named [name] (made unique in its folder). */
  fun create(kind: OutputKind, tree: String?, name: String, mime: String): Output {
    if (!tree.isNullOrEmpty()) {
      val treeUri = Uri.parse(tree)
      check(hasGrant(treeUri)) { E_DIR_ACCESS }
      val dir = DocumentsContract.buildDocumentUriUsingTree(treeUri, DocumentsContract.getTreeDocumentId(treeUri))
      // The provider renames on collision ("name (1).mp4").
      val doc = DocumentsContract.createDocument(resolver, dir, mime, name) ?: error(E_DIR_ACCESS)
      return Output(doc, displayName(doc) ?: name)
    }
    if (kind == OutputKind.SEGMENTS) return fileOutput(defaultSegmentsDir(), name)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val values =
        ContentValues().apply {
          put(MediaStore.MediaColumns.DISPLAY_NAME, name)
          put(MediaStore.MediaColumns.MIME_TYPE, mime)
          put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath(kind))
          put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
      val uri = resolver.insert(collection(kind), values) ?: error(E_DIR_ACCESS)
      return Output(uri, displayName(uri) ?: name)
    }
    return fileOutput(fallbackDir(kind), name)
  }

  private fun fileOutput(dir: File, name: String): Output {
    val unique = RecordingNames.unique(name) { File(dir, it).exists() }
    val file = File(dir, unique)
    file.createNewFile()
    return Output(Uri.fromFile(file), unique)
  }

  /** Publishes a MediaStore entry once its content is complete. */
  fun finish(uri: Uri) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && uri.authority == MediaStore.AUTHORITY) {
      resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
    }
  }

  fun openWrite(uri: Uri): ParcelFileDescriptor =
    if (uri.scheme == ContentResolver.SCHEME_FILE) {
      ParcelFileDescriptor.open(File(uri.path!!), ParcelFileDescriptor.MODE_READ_WRITE or ParcelFileDescriptor.MODE_CREATE or ParcelFileDescriptor.MODE_TRUNCATE)
    } else {
      resolver.openFileDescriptor(uri, "rw") ?: error(E_DIR_ACCESS)
    }

  fun openRead(uri: Uri): ParcelFileDescriptor =
    if (uri.scheme == ContentResolver.SCHEME_FILE) {
      ParcelFileDescriptor.open(File(uri.path!!), ParcelFileDescriptor.MODE_READ_ONLY)
    } else {
      resolver.openFileDescriptor(uri, "r") ?: error("not_found")
    }

  fun size(uri: Uri): Long =
    try {
      if (uri.scheme == ContentResolver.SCHEME_FILE) File(uri.path!!).length()
      else resolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
        if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else -1L
      } ?: -1L
    } catch (_: Exception) {
      -1L
    }

  fun exists(uri: Uri): Boolean =
    if (uri.scheme == ContentResolver.SCHEME_FILE) File(uri.path!!).isFile else size(uri) >= 0

  fun delete(uri: Uri): Boolean =
    try {
      when {
        uri.scheme == ContentResolver.SCHEME_FILE -> File(uri.path!!).delete()
        DocumentsContract.isDocumentUri(context, uri) -> DocumentsContract.deleteDocument(resolver, uri)
        else -> resolver.delete(uri, null, null) > 0
      }
    } catch (_: Exception) {
      false
    }

  /** Renames in place; returns the (possibly new) URI, or null on failure. */
  fun rename(uri: Uri, newName: String): Uri? =
    try {
      when {
        uri.scheme == ContentResolver.SCHEME_FILE -> {
          val from = File(uri.path!!)
          val to = File(from.parentFile, RecordingNames.unique(newName) { File(from.parentFile, it).exists() })
          if (from.renameTo(to)) Uri.fromFile(to) else null
        }
        DocumentsContract.isDocumentUri(context, uri) -> DocumentsContract.renameDocument(resolver, uri, newName)
        else -> {
          val values = ContentValues().apply { put(MediaStore.MediaColumns.DISPLAY_NAME, newName) }
          if (resolver.update(uri, values, null, null) > 0) uri else null
        }
      }
    } catch (_: Exception) {
      null
    }

  fun displayName(uri: Uri): String? =
    try {
      if (uri.scheme == ContentResolver.SCHEME_FILE) File(uri.path!!).name
      else resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) c.getString(0) else null
      }
    } catch (_: Exception) {
      null
    }

  /** Free bytes where [kind] is written (the primary volume for picked folders). */
  fun freeBytes(kind: OutputKind, tree: String?): Long =
    try {
      val dir =
        when {
          kind == OutputKind.SEGMENTS && tree.isNullOrEmpty() -> defaultSegmentsDir()
          else -> context.getExternalFilesDir(null) ?: context.filesDir
        }
      StatFs(dir.path).availableBytes
    } catch (_: Exception) {
      Long.MAX_VALUE
    }

  fun hasGrant(tree: Uri): Boolean =
    resolver.persistedUriPermissions.any { it.uri == tree && it.isWritePermission && it.isReadPermission }

  /** Takes a lasting read/write grant on a folder the user just picked. */
  fun persist(tree: Uri) {
    resolver.takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
  }

  fun release(tree: String) {
    try {
      resolver.releasePersistableUriPermission(Uri.parse(tree), Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
    } catch (_: SecurityException) {
    }
  }

  fun status(kind: OutputKind, tree: String?): DirStatus {
    if (tree.isNullOrEmpty()) {
      val label =
        when {
          kind == OutputKind.SEGMENTS -> "Android/data/${context.packageName}/files/recordings/segments"
          Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q -> relativePath(kind)
          else -> fallbackDir(kind).path
        }
      return DirStatus(label, custom = false, accessible = true)
    }
    val uri = Uri.parse(tree)
    val name =
      try {
        val doc = DocumentsContract.buildDocumentUriUsingTree(uri, DocumentsContract.getTreeDocumentId(uri))
        displayName(doc)
      } catch (_: Exception) {
        null
      }
    return DirStatus(name ?: tree, custom = true, accessible = hasGrant(uri) && name != null)
  }

  /** Creates, writes and deletes a small probe file. */
  fun testWrite(kind: OutputKind, tree: String?): Boolean =
    try {
      val out = create(kind, tree, ".akshar-write-test-${System.currentTimeMillis()}.txt", "text/plain")
      try {
        openWrite(out.uri).use { pfd ->
          ParcelFileDescriptor.AutoCloseOutputStream(ParcelFileDescriptor.dup(pfd.fileDescriptor)).use { it.write(1) }
        }
        true
      } finally {
        delete(out.uri)
      }
    } catch (_: Exception) {
      false
    }

  companion object {
    const val FOLDER = "Akshar"
    const val E_DIR_ACCESS = "dir_access"
  }
}
