package com.rnboilerplate.screenocr

import android.content.Context
import android.graphics.Bitmap
import com.googlecode.tesseract.android.TessBaseAPI
import java.io.File

/**
 * Gujarati OCR with Tesseract 5 (Tesseract4Android). ML Kit has no Gujarati
 * recogniser, so this is the on-device engine for Gujarati script.
 *
 * Uses the `guj+eng` fast LSTM models (tessdata_fast, Apache-2.0) bundled in
 * assets/tessdata, so English words inside Gujarati lines are read too. The
 * models are copied to app storage on first use because Tesseract needs real
 * files. Not thread-safe: call only from one worker thread.
 */
class GujaratiRecognizer(private val context: Context) {
  private var api: TessBaseAPI? = null

  private fun ensureApi(): TessBaseAPI {
    api?.let { return it }
    val root = File(context.filesDir, "tesseract")
    val tessdata = File(root, "tessdata").apply { mkdirs() }
    for (lang in LANGUAGES) {
      val target = File(tessdata, "$lang.traineddata")
      if (!target.exists() || target.length() == 0L) {
        val partial = File(tessdata, "$lang.traineddata.part")
        context.assets.open("tessdata/$lang.traineddata").use { input ->
          partial.outputStream().use { input.copyTo(it) }
        }
        check(partial.renameTo(target)) { "could not install $lang model" }
      }
    }
    val created = TessBaseAPI()
    if (!created.init(root.absolutePath, LANGUAGES.joinToString("+"), TessBaseAPI.OEM_LSTM_ONLY)) {
      created.recycle()
      throw IllegalStateException("Tesseract init failed")
    }
    created.pageSegMode = TessBaseAPI.PageSegMode.PSM_AUTO
    api = created
    return created
  }

  /** Synchronous recognition; returns lines with boxes and confidence. */
  fun recognize(bitmap: Bitmap): List<OcrLine> {
    val tess = ensureApi()
    tess.setImage(bitmap)
    try {
      // Runs the recogniser; the iterator below walks its result.
      tess.getUTF8Text()
      val lines = ArrayList<OcrLine>()
      val iterator = tess.resultIterator ?: return lines
      try {
        iterator.begin()
        var block = -1
        do {
          if (iterator.isAtBeginningOf(TessBaseAPI.PageIteratorLevel.RIL_BLOCK)) block++
          val text = iterator.getUTF8Text(TessBaseAPI.PageIteratorLevel.RIL_TEXTLINE)
          if (text.isNullOrBlank()) continue
          val box = iterator.getBoundingRect(TessBaseAPI.PageIteratorLevel.RIL_TEXTLINE)
          lines +=
            OcrLine(
              text = text.trim(),
              left = box.left,
              top = box.top,
              right = box.right,
              bottom = box.bottom,
              block = block.coerceAtLeast(0),
              confidence =
                (iterator.confidence(TessBaseAPI.PageIteratorLevel.RIL_TEXTLINE) / 100f).coerceIn(0f, 1f),
            )
        } while (iterator.next(TessBaseAPI.PageIteratorLevel.RIL_TEXTLINE))
      } finally {
        iterator.delete()
      }
      return lines
    } finally {
      tess.clear()
    }
  }

  fun close() {
    api?.recycle()
    api = null
  }

  private companion object {
    val LANGUAGES = listOf("guj", "eng")
  }
}
