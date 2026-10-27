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
 * Minimal Gemini REST client (no SDK, no extra dependency).
 *
 * - The key goes in the `x-goog-api-key` header, never in the URL.
 * - Off the main thread; results on the main thread.
 * - Long text is translated in paragraph chunks, sequentially, in order.
 * - Retries are bounded: once without the thinking setting if a model
 *   rejects it, once after a short backoff on HTTP 429. Nothing else.
 * - [cancel] disconnects the in-flight request; its result is dropped.
 * - Nothing about requests, responses or the key is logged; error details
 *   returned for display are redacted.
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
          Result.failure(TranslateException(TranslateError.SERVER, detail = e.javaClass.simpleName))
        }
      main.post { if (gen == generation.get()) onResult(result) }
    }
  }

  /** A minimal translation to check the key, model and thinking setting work. */
  fun test(apiKey: String, config: TranslateConfig, onResult: (Result<TranslationResult>) -> Unit) =
    translate(apiKey, config.copy(target = "hi", source = "auto"), "Hello, how are you?", onResult)

  /** The Gemini models this key can call for text generation. */
  fun listModels(apiKey: String, onResult: (Result<List<GeminiModel>>) -> Unit) {
    executor.execute {
      val result =
        try {
          val (status, body) = call(apiKey, "GET", "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", null)
          if (status in 200..299) {
            Result.success(GeminiResponse.parseModels(body))
          } else {
            Result.failure(
              TranslateException(
                GeminiResponse.errorFor(status, body),
                status,
                GeminiResponse.redact(GeminiResponse.errorMessage(body), apiKey),
              ),
            )
          }
        } catch (_: UnknownHostException) {
          Result.failure(TranslateException(TranslateError.NO_INTERNET))
        } catch (_: SocketTimeoutException) {
          Result.failure(TranslateException(TranslateError.TIMEOUT))
        } catch (_: IOException) {
          Result.failure(TranslateException(TranslateError.NO_INTERNET))
        }
      main.post { onResult(result) }
    }
  }

  fun cancel() {
    generation.incrementAndGet()
    connection?.disconnect()
  }

  fun shutdown() {
    cancel()
    executor.shutdownNow()
  }

  private fun request(apiKey: String, config: TranslateConfig, text: String, gen: Int): Result<TranslationResult> {
    var withThinking = true
    var quotaRetried = false
    while (true) {
      val model = config.model.filter { it.isLetterOrDigit() || it in ".-_" }.ifEmpty { TranslationPrompt.DEFAULT_MODEL }
      val (status, body) =
        try {
          call(
            apiKey,
            "POST",
            "https://generativelanguage.googleapis.com/v1beta/models/$model:generateContent",
            TranslationPrompt.requestBody(config, text, withThinking).toString(),
          )
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
      if (withThinking && GeminiResponse.isThinkingRejected(status, body)) {
        // Older models (or a level a model lacks) reject thinkingLevel: retry once without it.
        withThinking = false
        continue
      }
      val error = GeminiResponse.errorFor(status, body)
      if (error == TranslateError.QUOTA && !quotaRetried && gen == generation.get()) {
        quotaRetried = true
        Thread.sleep(RETRY_BACKOFF_MS)
        continue
      }
      return Result.failure(
        TranslateException(error, status, GeminiResponse.redact(GeminiResponse.errorMessage(body), apiKey)),
      )
    }
  }

  private fun call(apiKey: String, method: String, url: String, json: String?): Pair<Int, String> {
    val conn = (URL(url).openConnection() as HttpURLConnection)
    connection = conn
    try {
      conn.requestMethod = method
      conn.connectTimeout = CONNECT_TIMEOUT_MS
      conn.readTimeout = READ_TIMEOUT_MS
      conn.setRequestProperty("x-goog-api-key", apiKey)
      if (json != null) {
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        conn.outputStream.use { it.write(json.toByteArray(Charsets.UTF_8)) }
      }
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
    const val READ_TIMEOUT_MS = 45_000
    const val RETRY_BACKOFF_MS = 2_000L
  }
}
