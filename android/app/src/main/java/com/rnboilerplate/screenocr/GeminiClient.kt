package com.rnboilerplate.screenocr

import android.os.Handler
import android.os.Looper
import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * Minimal Gemini `generateContent` client (no SDK, no extra dependency).
 *
 * - The key goes in the `x-goog-api-key` header, never in the URL.
 * - Off the main thread; result on the main thread.
 * - Long text is translated in paragraph chunks, sequentially, in order.
 * - HTTP 429 gets one retry after a short backoff; nothing else is retried.
 * - [cancel] disconnects the in-flight request; its result is dropped.
 * - Nothing about the request, response or key is logged.
 */
class GeminiClient {
  private val executor: ExecutorService = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())
  private val generation = AtomicInteger(0)
  @Volatile private var connection: HttpURLConnection? = null

  fun translate(
    apiKey: String,
    config: TranslateConfig,
    text: String,
    onResult: (Result<TranslationResult>) -> Unit,
  ) {
    val gen = generation.incrementAndGet()
    executor.execute {
      val result =
        try {
          var detected = ""
          val parts =
            TranslationPrompt.chunks(text).map { chunk ->
              if (gen != generation.get()) throw TranslateException(TranslateError.CANCELLED)
              val part = request(apiKey, config, chunk, gen).getOrThrow()
              if (detected.isEmpty()) detected = part.detectedLanguage
              part.text
            }
          Result.success(TranslationResult(parts.joinToString("\n\n"), detected))
        } catch (e: TranslateException) {
          Result.failure(e)
        } catch (e: Exception) {
          Result.failure(TranslateException(TranslateError.SERVER))
        }
      main.post { if (gen == generation.get()) onResult(result) }
    }
  }

  /** A minimal request to check the key and model work. */
  fun test(apiKey: String, config: TranslateConfig, onResult: (Result<TranslationResult>) -> Unit) =
    translate(apiKey, config.copy(target = "hi"), "Hello", onResult)

  fun cancel() {
    generation.incrementAndGet()
    connection?.disconnect()
  }

  fun shutdown() {
    cancel()
    executor.shutdownNow()
  }

  private fun request(apiKey: String, config: TranslateConfig, text: String, gen: Int): Result<TranslationResult> {
    var attempt = 0
    while (true) {
      attempt++
      val (status, body) =
        try {
          post(apiKey, config.model, TranslationPrompt.requestBody(config, text).toString())
        } catch (_: UnknownHostException) {
          return Result.failure(TranslateException(TranslateError.NO_INTERNET))
        } catch (_: SocketTimeoutException) {
          return Result.failure(TranslateException(TranslateError.TIMEOUT))
        } catch (_: IOException) {
          return Result.failure(
            TranslateException(if (gen != generation.get()) TranslateError.CANCELLED else TranslateError.NO_INTERNET),
          )
        }
      if (status in 200..299) return GeminiResponse.parse(body)
      val error = GeminiResponse.errorFor(status, body)
      if (error == TranslateError.QUOTA && attempt == 1 && gen == generation.get()) {
        Thread.sleep(RETRY_BACKOFF_MS)
        continue
      }
      return Result.failure(TranslateException(error))
    }
  }

  private fun post(apiKey: String, model: String, json: String): Pair<Int, String> {
    val safeModel = model.filter { it.isLetterOrDigit() || it in ".-_" }.ifEmpty { TranslationPrompt.DEFAULT_MODEL }
    val url = URL("https://generativelanguage.googleapis.com/v1beta/models/$safeModel:generateContent")
    val conn = (url.openConnection() as HttpURLConnection)
    connection = conn
    try {
      conn.requestMethod = "POST"
      conn.connectTimeout = CONNECT_TIMEOUT_MS
      conn.readTimeout = READ_TIMEOUT_MS
      conn.doOutput = true
      conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
      conn.setRequestProperty("x-goog-api-key", apiKey)
      conn.outputStream.use { it.write(json.toByteArray(Charsets.UTF_8)) }
      val status = conn.responseCode
      val stream = if (status in 200..299) conn.inputStream else conn.errorStream
      val body = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
      return status to body
    } finally {
      conn.disconnect()
      if (connection === conn) connection = null
    }
  }

  private companion object {
    const val CONNECT_TIMEOUT_MS = 10_000
    const val READ_TIMEOUT_MS = 30_000
    const val RETRY_BACKOFF_MS = 2_000L
  }
}
