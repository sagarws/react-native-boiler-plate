package com.rnboilerplate.screenocr

import android.graphics.Bitmap
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.devanagari.DevanagariTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions

/**
 * On-device OCR with Google ML Kit Text Recognition v2.
 *
 * Both models are the *bundled* variants (`text-recognition`,
 * `text-recognition-devanagari`): they ship inside the APK and run fully
 * offline — no Play Services download and no network on first use.
 * Recognisers are created on first use and reused until [close].
 * Inference runs on ML Kit's own worker threads; callbacks arrive on the main
 * thread.
 */
class OcrEngine {
  private var latin: TextRecognizer? = null
  private var devanagari: TextRecognizer? = null

  private fun latin(): TextRecognizer =
    latin ?: TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS).also { latin = it }

  private fun devanagari(): TextRecognizer =
    devanagari
      ?: TextRecognition.getClient(DevanagariTextRecognizerOptions.Builder().build())
        .also { devanagari = it }

  fun recognize(bitmap: Bitmap, mode: OcrMode, onDone: (Result<String>) -> Unit) {
    val image = InputImage.fromBitmap(bitmap, 0)
    when (mode) {
      OcrMode.ENGLISH -> single(latin().process(image), onDone)
      OcrMode.HINDI -> single(devanagari().process(image), onDone)
      OcrMode.MIXED -> mixed(devanagari().process(image), latin().process(image), onDone)
    }
  }

  private fun single(task: Task<Text>, onDone: (Result<String>) -> Unit) {
    task
      .addOnSuccessListener { onDone(Result.success(OcrTextAssembler.assemble(toLines(it)))) }
      .addOnFailureListener { onDone(Result.failure(it)) }
  }

  private fun mixed(
    devanagariTask: Task<Text>,
    latinTask: Task<Text>,
    onDone: (Result<String>) -> Unit,
  ) {
    Tasks.whenAllComplete(devanagariTask, latinTask).addOnCompleteListener {
      val dev = if (devanagariTask.isSuccessful) toLines(devanagariTask.result) else null
      val lat = if (latinTask.isSuccessful) toLines(latinTask.result) else null
      val lines = when {
        dev != null && lat != null -> OcrTextAssembler.mergeMixed(dev, lat)
        dev != null -> dev
        lat != null -> lat
        else -> null
      }
      if (lines == null) {
        val error = devanagariTask.exception ?: latinTask.exception
        onDone(Result.failure(error ?: IllegalStateException("OCR failed")))
      } else {
        onDone(Result.success(OcrTextAssembler.assemble(lines)))
      }
    }
  }

  fun close() {
    latin?.close()
    devanagari?.close()
    latin = null
    devanagari = null
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
        )
      }
    }
}
