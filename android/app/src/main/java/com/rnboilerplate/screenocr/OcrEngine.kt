package com.rnboilerplate.screenocr

import android.content.Context
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import com.google.android.gms.tasks.Task
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.devanagari.DevanagariTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * On-device OCR across three recognisers:
 * - ML Kit Text Recognition v2, Latin (English) — bundled model;
 * - ML Kit Text Recognition v2, Devanagari (Hindi) — bundled model;
 * - Tesseract 5 `guj+eng` (Gujarati) — ML Kit has no Gujarati model.
 *
 * Only the recognisers the mode needs run, in parallel; their lines are then
 * merged per mode (see [OcrTextAssembler]). Everything stays on the device.
 * ML Kit runs on its own threads; Tesseract on a dedicated worker. The
 * callback arrives on the main thread. Recognisers are created on first use
 * and reused until [close].
 */
class OcrEngine(context: Context) {
  private val appContext = context.applicationContext
  private val main = Handler(Looper.getMainLooper())
  private val tessExecutor: ExecutorService = Executors.newSingleThreadExecutor()
  private var latin: TextRecognizer? = null
  private var devanagari: TextRecognizer? = null
  private var gujarati: GujaratiRecognizer? = null

  private fun latin(): TextRecognizer =
    latin ?: TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS).also { latin = it }

  private fun devanagari(): TextRecognizer =
    devanagari
      ?: TextRecognition.getClient(DevanagariTextRecognizerOptions.Builder().build())
        .also { devanagari = it }

  private class Outputs {
    @Volatile var latin: List<OcrLine>? = null
    @Volatile var devanagari: List<OcrLine>? = null
    @Volatile var gujarati: List<OcrLine>? = null
    @Volatile var error: Exception? = null
  }

  /** The bitmap must stay valid until [onDone] runs. */
  fun recognize(bitmap: Bitmap, mode: OcrMode, onDone: (Result<String>) -> Unit) {
    val outputs = Outputs()
    val pending = AtomicInteger(listOf(mode.latin, mode.devanagari, mode.gujarati).count { it })
    val finishOne = {
      if (pending.decrementAndGet() == 0) main.post { onDone(combine(mode, outputs)) }
    }
    val image = InputImage.fromBitmap(bitmap, 0)
    if (mode.latin) mlkit(latin().process(image), outputs, finishOne) { outputs.latin = it }
    if (mode.devanagari) mlkit(devanagari().process(image), outputs, finishOne) { outputs.devanagari = it }
    if (mode.gujarati) {
      tessExecutor.execute {
        try {
          val recognizer = gujarati ?: GujaratiRecognizer(appContext).also { gujarati = it }
          outputs.gujarati = recognizer.recognize(bitmap)
        } catch (e: Exception) {
          outputs.error = e
        }
        finishOne()
      }
    }
  }

  private fun mlkit(
    task: Task<Text>,
    outputs: Outputs,
    finishOne: () -> Unit,
    store: (List<OcrLine>) -> Unit,
  ) {
    task.addOnCompleteListener {
      if (it.isSuccessful) store(toLines(it.result)) else outputs.error = it.exception
      finishOne()
    }
  }

  private fun combine(mode: OcrMode, o: Outputs): Result<String> {
    val lat = o.latin
    val dev = o.devanagari
    val guj = o.gujarati
    val A = OcrTextAssembler
    val lines: List<OcrLine>? =
      when (mode) {
        OcrMode.ENGLISH -> lat
        OcrMode.HINDI -> dev
        OcrMode.GUJARATI -> guj
        OcrMode.HINDI_ENGLISH -> pair(dev, lat) { d, l -> A.mergeMixed(d, l, A.DEVANAGARI) }
        OcrMode.GUJARATI_ENGLISH -> pair(guj, lat) { g, l -> A.mergeMixed(g, l, A.GUJARATI) }
        OcrMode.HINDI_GUJARATI ->
          pair(dev, guj) { d, g -> A.mergeByConfidence(d, A.DEVANAGARI, g, A.GUJARATI) }
        OcrMode.ALL -> {
          val indic = pair(dev, guj) { d, g -> A.mergeByConfidence(d, A.DEVANAGARI, g, A.GUJARATI) }
          pair(indic, lat) { i, l -> A.mergeMixed(i, l, A.DEVANAGARI_OR_GUJARATI) }
        }
      }
    return if (lines == null) {
      Result.failure(o.error ?: IllegalStateException("OCR failed"))
    } else {
      Result.success(OcrTextAssembler.assemble(lines))
    }
  }

  /** Merges two outputs; if one recogniser failed, uses the other alone. */
  private fun pair(
    a: List<OcrLine>?,
    b: List<OcrLine>?,
    merge: (List<OcrLine>, List<OcrLine>) -> List<OcrLine>,
  ): List<OcrLine>? =
    when {
      a != null && b != null -> merge(a, b)
      else -> a ?: b
    }

  fun close() {
    latin?.close()
    devanagari?.close()
    latin = null
    devanagari = null
    val tess = gujarati
    gujarati = null
    tessExecutor.execute { tess?.close() }
    tessExecutor.shutdown()
  }

  private fun toLines(text: Text): List<OcrLine> =
    text.textBlocks.flatMapIndexed { blockIndex, block ->
      block.lines.map { line ->
        val box = line.boundingBox ?: block.boundingBox
        OcrLine(
          text = line.text,
          left = box?.left ?: 0,
          top = box?.top ?: 0,
          right = box?.right ?: 0,
          bottom = box?.bottom ?: 0,
          block = blockIndex,
          confidence = line.confidence.coerceIn(0f, 1f),
        )
      }
    }
}
