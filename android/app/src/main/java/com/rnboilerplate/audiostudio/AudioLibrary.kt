package com.rnboilerplate.audiostudio

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.provider.OpenableColumns
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest

/**
 * Song lookup for 8D Audio Studio: the MediaStore music library and files
 * picked with the document picker. Blocking — call off the main thread.
 * Produces the Song JSON of src/specs/NativeAudioStudio.ts.
 */
object AudioLibrary {
  private const val MIN_DURATION_MS = 20_000
  private const val UNKNOWN = "<unknown>"
  private const val ART_DIR = "audiostudio-art"
  private const val ART_MAX_PX = 512

  fun hasPermission(context: Context): Boolean {
    val permission =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        Manifest.permission.READ_MEDIA_AUDIO
      } else {
        Manifest.permission.READ_EXTERNAL_STORAGE
      }
    return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
  }

  fun scan(context: Context): JSONArray {
    val collection =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
      } else {
        MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
      }
    val folderColumn = folderColumn()
    val genreColumn = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) MediaStore.Audio.AudioColumns.GENRE else null
    val projection =
      listOfNotNull(
        MediaStore.Audio.Media._ID,
        MediaStore.Audio.Media.TITLE,
        MediaStore.Audio.Media.ARTIST,
        MediaStore.Audio.Media.ALBUM,
        MediaStore.Audio.Media.ALBUM_ID,
        MediaStore.Audio.Media.DURATION,
        MediaStore.Audio.Media.DATE_ADDED,
        MediaStore.Audio.Media.MIME_TYPE,
        MediaStore.Audio.Media.SIZE,
        MediaStore.Audio.Media.DISPLAY_NAME,
        folderColumn,
        genreColumn,
      ).toTypedArray()
    val selection = "${MediaStore.Audio.Media.IS_MUSIC} != 0 OR ${MediaStore.Audio.Media.DURATION} > $MIN_DURATION_MS"
    val out = JSONArray()
    context.contentResolver
      .query(collection, projection, selection, null, "${MediaStore.Audio.Media.TITLE} COLLATE NOCASE ASC")
      ?.use { c ->
        val id = c.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
        val title = c.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
        val artist = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
        val album = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
        val albumId = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID)
        val duration = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
        val dateAdded = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_ADDED)
        val mime = c.getColumnIndexOrThrow(MediaStore.Audio.Media.MIME_TYPE)
        val size = c.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE)
        val name = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME)
        val folder = c.getColumnIndexOrThrow(folderColumn)
        val genre = genreColumn?.let { c.getColumnIndexOrThrow(it) } ?: -1
        while (c.moveToNext()) {
          val mediaId = c.getLong(id)
          val album0 = c.getLong(albumId)
          out.put(
            JSONObject().apply {
              put("id", mediaId.toString())
              put("uri", ContentUris.withAppendedId(collection, mediaId).toString())
              put("title", known(c.getString(title)) ?: stripExtension(c.getString(name).orEmpty()))
              put("artist", known(c.getString(artist)).orEmpty())
              put("album", known(c.getString(album)).orEmpty())
              put("albumId", album0)
              put("genre", if (genre >= 0) c.getString(genre).orEmpty() else "")
              put("durationMs", c.getLong(duration))
              put("folder", folderOf(c.getString(folder)))
              put("dateAdded", c.getLong(dateAdded) * 1000L)
              put("mimeType", c.getString(mime).orEmpty())
              put("size", c.getLong(size))
              put("artUri", if (album0 != 0L) "content://media/external/audio/albumart/$album0" else JSONObject.NULL)
              put("source", "library")
            },
          )
        }
      }
    return out
  }

  /** Songs for picked content:// URIs; files that cannot be read as audio are skipped. */
  fun import(context: Context, uris: List<String>): JSONArray {
    val out = JSONArray()
    for (raw in uris) {
      val uri = runCatching { Uri.parse(raw) }.getOrNull() ?: continue
      try {
        context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      } catch (_: Exception) {
        // Not a persistable grant (e.g. a file:// or MediaStore URI); reading may still work now.
      }
      describe(context, uri, raw)?.let { out.put(it) }
    }
    return out
  }

  private fun describe(context: Context, uri: Uri, raw: String): JSONObject? {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(context, uri)
      val hash = stableHash(raw)
      var displayName = ""
      var size = 0L
      runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
          if (c.moveToFirst()) {
            displayName = c.getString(0).orEmpty()
            if (!c.isNull(1)) size = c.getLong(1)
          }
        }
      }
      val title = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE)
      return JSONObject().apply {
        put("id", "import:$hash")
        put("uri", raw)
        put("title", title?.takeIf { it.isNotBlank() } ?: stripExtension(displayName).ifEmpty { uri.lastPathSegment.orEmpty() })
        put("artist", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST).orEmpty())
        put("album", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM).orEmpty())
        put("albumId", 0)
        put("genre", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_GENRE).orEmpty())
        put("durationMs", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L)
        put("folder", "")
        put("dateAdded", System.currentTimeMillis())
        put(
          "mimeType",
          context.contentResolver.getType(uri) ?: retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_MIMETYPE).orEmpty(),
        )
        put("size", size)
        put("artUri", saveArt(context, retriever, hash) ?: JSONObject.NULL)
        put("source", "import")
      }
    } catch (_: Exception) {
      return null
    } finally {
      runCatching { retriever.release() }
    }
  }

  /** Embedded cover art, downscaled into the cache as a file:// URI (null when none). */
  private fun saveArt(context: Context, retriever: MediaMetadataRetriever, hash: String): String? {
    val bytes = retriever.embeddedPicture ?: return null
    val dir = File(context.cacheDir, ART_DIR).apply { mkdirs() }
    val file = File(dir, "$hash.jpg")
    if (!file.exists()) {
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
      var sample = 1
      while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= ART_MAX_PX) sample *= 2
      val bitmap =
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
          ?: return null
      try {
        FileOutputStream(file).use { bitmap.compress(Bitmap.CompressFormat.JPEG, 85, it) }
      } finally {
        bitmap.recycle()
      }
    }
    return Uri.fromFile(file).toString()
  }

  /** Stable across launches (unlike String.hashCode collisions across many files). */
  fun stableHash(value: String): String =
    MessageDigest
      .getInstance("SHA-1")
      .digest(value.toByteArray())
      .take(10)
      .joinToString("") { "%02x".format(it) }

  private fun known(value: String?): String? = value?.takeIf { it.isNotBlank() && it != UNKNOWN }

  private fun stripExtension(name: String): String = name.substringBeforeLast('.', name)

  @Suppress("DEPRECATION") // DATA is the only folder column below Android 10.
  private fun folderColumn(): String =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) MediaStore.Audio.Media.RELATIVE_PATH else MediaStore.Audio.Media.DATA

  /** RELATIVE_PATH ("Music/Rock/") → "Music/Rock"; DATA (a file path) → its parent folder. */
  private fun folderOf(value: String?): String {
    if (value.isNullOrEmpty()) return ""
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) value.trimEnd('/') else File(value).parent.orEmpty()
  }
}
