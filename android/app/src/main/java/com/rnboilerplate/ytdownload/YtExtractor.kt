package com.rnboilerplate.ytdownload

import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response
import org.schabi.newpipe.extractor.exceptions.AgeRestrictedContentException
import org.schabi.newpipe.extractor.exceptions.ContentNotAvailableException
import org.schabi.newpipe.extractor.exceptions.GeographicRestrictionException
import org.schabi.newpipe.extractor.exceptions.PaidContentException
import org.schabi.newpipe.extractor.exceptions.PrivateContentException
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException
import org.schabi.newpipe.extractor.stream.AudioStream
import org.schabi.newpipe.extractor.stream.AudioTrackType
import org.schabi.newpipe.extractor.stream.DeliveryMethod
import org.schabi.newpipe.extractor.stream.Stream
import org.schabi.newpipe.extractor.stream.StreamInfo
import org.schabi.newpipe.extractor.stream.StreamType
import org.schabi.newpipe.extractor.stream.VideoStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** Video details plus the qualities offered for it. */
data class VideoDetails(
  val id: String,
  val url: String,
  val title: String,
  val author: String,
  val durationSec: Long,
  val thumbnail: String,
  val video: List<DownloadOption>,
  val audio: List<DownloadOption>,
) {
  fun option(id: String): DownloadOption? = (video + audio).firstOrNull { it.id == id }

  fun toJson(): JSONObject =
    JSONObject().apply {
      put("id", id)
      put("url", url)
      put("title", title)
      put("author", author)
      put("durationSec", durationSec)
      put("thumbnail", thumbnail)
      put("video", JSONArray(video.map { it.toJson() }))
      put("audio", JSONArray(audio.map { it.toJson() }))
    }
}

/** Failure with a stable code for JS (see youtube.service.ts). */
class YtException(val code: String, cause: Throwable? = null) : Exception(code, cause)

/**
 * Reads a YouTube video's details and stream URLs with NewPipeExtractor
 * (which also solves YouTube's signature / throttling challenges). Runs on a
 * background thread; never logs titles or URLs.
 */
object YtExtractor {
  const val USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0"

  @Volatile private var initialised = false

  private fun ensureInit() {
    if (initialised) return
    synchronized(this) {
      if (!initialised) {
        NewPipe.init(UrlConnectionDownloader)
        initialised = true
      }
    }
  }

  fun isYouTubeUrl(url: String): Boolean =
    try {
      ServiceList.YouTube.streamLHFactory.acceptUrl(url)
    } catch (_: Exception) {
      false
    }

  fun fetch(url: String): VideoDetails {
    ensureInit()
    if (!isYouTubeUrl(url)) throw YtException("invalid_url")
    val info =
      try {
        StreamInfo.getInfo(ServiceList.YouTube, url)
      } catch (e: AgeRestrictedContentException) {
        throw YtException("age_restricted", e)
      } catch (e: PrivateContentException) {
        throw YtException("private", e)
      } catch (e: PaidContentException) {
        throw YtException("paid", e)
      } catch (e: GeographicRestrictionException) {
        throw YtException("geo_blocked", e)
      } catch (e: ContentNotAvailableException) {
        throw YtException("unavailable", e)
      } catch (e: ReCaptchaException) {
        throw YtException("rate_limited", e)
      } catch (e: IOException) {
        throw YtException("network", e)
      } catch (e: Exception) {
        throw YtException("extract_failed", e)
      }
    if (info.streamType == StreamType.LIVE_STREAM || info.streamType == StreamType.AUDIO_LIVE_STREAM) {
      throw YtException("live_unsupported")
    }

    val videos = info.videoOnlyStreams.mapNotNull(::toCandidate)
    val audios =
      info.audioStreams
        .filter { it.audioTrackType == null || it.audioTrackType == AudioTrackType.ORIGINAL }
        .ifEmpty { info.audioStreams }
        .mapNotNull(::toCandidate)
    val duration = info.duration
    val sdk = Build.VERSION.SDK_INT
    val details =
      VideoDetails(
        id = info.id,
        url = info.url,
        title = info.name,
        author = info.uploaderName ?: "",
        durationSec = duration,
        thumbnail = info.thumbnails.maxByOrNull { it.height }?.url ?: "",
        video = YtFormats.videoOptions(videos, audios, duration, sdk),
        audio = YtFormats.audioOptions(audios, duration, sdk),
      )
    if (details.video.isEmpty() && details.audio.isEmpty()) throw YtException("no_streams")
    return details
  }

  private fun container(stream: Stream): String? =
    when (stream.format?.suffix) {
      "mp4", "m4a" -> "mp4"
      "webm" -> "webm"
      else -> null
    }

  private fun toCandidate(stream: VideoStream): StreamCandidate? {
    if (!stream.isUrl || stream.deliveryMethod != DeliveryMethod.PROGRESSIVE_HTTP) return null
    return StreamCandidate(
      itag = stream.itag,
      url = stream.content,
      container = container(stream) ?: return null,
      codec = (stream.codec ?: "").lowercase(),
      bitrate = stream.bitrate,
      contentLength = stream.itagItem?.contentLength ?: -1,
      height = stream.height,
      fps = stream.fps,
    )
  }

  private fun toCandidate(stream: AudioStream): StreamCandidate? {
    if (!stream.isUrl || stream.deliveryMethod != DeliveryMethod.PROGRESSIVE_HTTP) return null
    return StreamCandidate(
      itag = stream.itag,
      url = stream.content,
      container = container(stream) ?: return null,
      codec = (stream.codec ?: "").lowercase(),
      bitrate = if (stream.bitrate > 0) stream.bitrate else stream.averageBitrate * 1000,
      contentLength = stream.itagItem?.contentLength ?: -1,
    )
  }

  /** NewPipe's network hook, on plain HttpURLConnection (no extra HTTP library). */
  private object UrlConnectionDownloader : Downloader() {
    override fun execute(request: Request): Response {
      val connection = URL(request.url()).openConnection() as HttpURLConnection
      try {
        connection.connectTimeout = 20_000
        connection.readTimeout = 30_000
        connection.requestMethod = request.httpMethod()
        connection.setRequestProperty("User-Agent", USER_AGENT)
        request.headers().forEach { (name, values) ->
          connection.setRequestProperty(name, values.joinToString(", "))
        }
        request.dataToSend()?.let { body ->
          connection.doOutput = true
          connection.outputStream.use { it.write(body) }
        }
        val code = connection.responseCode
        if (code == 429) throw ReCaptchaException("reCaptcha Challenge requested", request.url())
        val stream = if (code >= 400) connection.errorStream else connection.inputStream
        val body = stream?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
        val headers = connection.headerFields.filterKeys { it != null }
        return Response(code, connection.responseMessage, headers, body, connection.url.toString())
      } finally {
        connection.disconnect()
      }
    }
  }
}
