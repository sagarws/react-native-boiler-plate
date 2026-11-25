package com.rnboilerplate.ytdownload

import org.json.JSONObject

/** One downloadable stream, reduced to what the picker needs (no NewPipe types, so it is JVM-testable). */
data class StreamCandidate(
  val itag: Int,
  val url: String,
  /** "mp4" | "webm" (audio m4a counts as "mp4"). */
  val container: String,
  /** Lower-case codec string, e.g. "avc1.640028", "vp9", "av01.0.08m.08", "mp4a.40.2", "opus". */
  val codec: String,
  val bitrate: Int,
  /** Bytes, or -1 when YouTube did not say. */
  val contentLength: Long,
  val height: Int = 0,
  val fps: Int = 0,
)

enum class OutputFormat(val ext: String, val mime: String) {
  MP4("mp4", "video/mp4"),
  WEBM("webm", "video/webm"),
  M4A("m4a", "audio/mp4"),
  OGG("opus", "audio/ogg"),
  WEBM_AUDIO("webm", "audio/webm"),
}

/** A quality the user can pick: one video stream + one audio stream, or one audio stream alone. */
data class DownloadOption(
  val id: String,
  val kind: String,
  val label: String,
  val video: StreamCandidate?,
  val audio: StreamCandidate,
  val output: OutputFormat,
  val sizeBytes: Long,
) {
  fun toJson(): JSONObject =
    JSONObject().apply {
      put("id", id)
      put("kind", kind)
      put("label", label)
      put("height", video?.height ?: 0)
      put("fps", video?.fps ?: 0)
      put("ext", output.ext)
      put("codec", video?.let { YtFormats.codecName(it.codec) } ?: YtFormats.codecName(audio.codec))
      put("bitrateKbps", ((video?.bitrate ?: 0) + audio.bitrate) / 1000)
      put("sizeBytes", sizeBytes)
    }
}

/**
 * Turns YouTube's stream list into the qualities offered in the app. Every
 * pick must be something Android's MediaMuxer can write, so no ffmpeg is
 * needed:
 *  - H.264 (mp4) + AAC → .mp4: plays everywhere; YouTube offers it up to 1080p.
 *  - VP9 (webm) + Opus → .webm: the only way to get 1440p/4K on every Android version.
 *  - AV1 (mp4) + AAC → .mp4: only on Android 14+, where MediaMuxer accepts AV1.
 */
object YtFormats {
  const val KIND_VIDEO = "video"
  const val KIND_AUDIO = "audio"
  private const val AV1_MUXER_SDK = 34
  private const val OGG_MUXER_SDK = 29

  fun codecName(codec: String): String =
    when {
      codec.startsWith("avc1") -> "H.264"
      codec.startsWith("vp9") || codec.startsWith("vp09") -> "VP9"
      codec.startsWith("av01") -> "AV1"
      codec.startsWith("mp4a") -> "AAC"
      codec.startsWith("opus") -> "Opus"
      else -> codec.substringBefore('.').uppercase()
    }

  private fun isAvc(s: StreamCandidate) = s.container == "mp4" && s.codec.startsWith("avc1")

  private fun isVp9(s: StreamCandidate) = s.container == "webm" && (s.codec.startsWith("vp9") || s.codec.startsWith("vp09"))

  private fun isAv1(s: StreamCandidate) = s.container == "mp4" && s.codec.startsWith("av01")

  private fun isAac(s: StreamCandidate) = s.container == "mp4" && s.codec.startsWith("mp4a")

  private fun isOpus(s: StreamCandidate) = s.container == "webm" && s.codec.startsWith("opus")

  /** Size in bytes: YouTube's figure, else bitrate × duration. */
  fun estimate(s: StreamCandidate, durationSec: Long): Long =
    if (s.contentLength > 0) s.contentLength else s.bitrate.toLong() * durationSec.coerceAtLeast(0) / 8

  /** Best video per height (highest first), each paired with matching audio. */
  fun videoOptions(
    videos: List<StreamCandidate>,
    audios: List<StreamCandidate>,
    durationSec: Long,
    sdk: Int,
  ): List<DownloadOption> {
    val aac = audios.filter(::isAac).maxByOrNull { it.bitrate }
    val opus = audios.filter(::isOpus).maxByOrNull { it.bitrate }
    return videos
      .filter { it.height > 0 }
      .groupBy { it.height }
      .toSortedMap(compareByDescending { it })
      .mapNotNull { (height, atHeight) ->
        val best = { pick: (StreamCandidate) -> Boolean -> atHeight.filter(pick).maxWithOrNull(compareBy({ it.fps }, { it.bitrate })) }
        val avc = best(::isAvc)
        val vp9 = best(::isVp9)
        val av1 = if (sdk >= AV1_MUXER_SDK) best(::isAv1) else null
        val (video, audio, output) =
          when {
            avc != null && aac != null -> Triple(avc, aac, OutputFormat.MP4)
            vp9 != null && opus != null -> Triple(vp9, opus, OutputFormat.WEBM)
            av1 != null && aac != null -> Triple(av1, aac, OutputFormat.MP4)
            else -> return@mapNotNull null
          }
        val fps = if (video.fps > 30) video.fps.toString() else ""
        DownloadOption(
          id = "v${video.itag}_a${audio.itag}",
          kind = KIND_VIDEO,
          label = "${height}p$fps",
          video = video,
          audio = audio,
          output = output,
          sizeBytes = estimate(video, durationSec) + estimate(audio, durationSec),
        )
      }
  }

  /** Best AAC (.m4a) and best Opus (.opus, or .webm before Android 10), highest bitrate first. */
  fun audioOptions(audios: List<StreamCandidate>, durationSec: Long, sdk: Int): List<DownloadOption> {
    val picks =
      listOfNotNull(
        audios.filter(::isAac).maxByOrNull { it.bitrate }?.let { it to OutputFormat.M4A },
        audios.filter(::isOpus).maxByOrNull { it.bitrate }?.let {
          it to if (sdk >= OGG_MUXER_SDK) OutputFormat.OGG else OutputFormat.WEBM_AUDIO
        },
      )
    return picks
      .sortedByDescending { it.first.bitrate }
      .map { (audio, output) ->
        DownloadOption(
          id = "a${audio.itag}",
          kind = KIND_AUDIO,
          label = "${audio.bitrate / 1000} kbps",
          video = null,
          audio = audio,
          output = output,
          sizeBytes = estimate(audio, durationSec),
        )
      }
  }

  /** "Title (1080p).mp4" with characters that are illegal in file names replaced. */
  fun fileName(title: String, label: String, ext: String): String {
    val clean =
      title
        .replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_")
        .replace(Regex("\\s+"), " ")
        .trim()
        .trim('.')
        .take(120)
        .ifBlank { "video" }
    return "$clean ($label).$ext"
  }
}
