package com.rnboilerplate.recorder

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

/** What a tap on the recording button does (chosen from its long-press menu). */
enum class RecorderMode(val id: String, val video: Boolean, val audio: Boolean) {
  SCREENSHOT("screenshot", video = false, audio = false),
  SCREEN("screen", video = true, audio = false),
  VOICE("voice", video = false, audio = true),
  SCREEN_VOICE("screen_voice", video = true, audio = true);

  val records: Boolean
    get() = video || audio

  companion object {
    fun from(id: String?): RecorderMode = entries.firstOrNull { it.id == id } ?: SCREENSHOT
  }
}

/** Where recorded sound comes from. System audio is Android playback capture (API 29+). */
enum class AudioSource(val id: String, val system: Boolean, val mic: Boolean) {
  SYSTEM("system", system = true, mic = false),
  MIC("mic", system = false, mic = true),
  SYSTEM_MIC("system_mic", system = true, mic = true);

  companion object {
    fun from(id: String?): AudioSource = entries.firstOrNull { it.id == id } ?: SYSTEM
  }
}

/** Output locations a user can point at a folder (Storage Access Framework tree URI). */
enum class OutputKind(val id: String) {
  SCREENSHOT("screenshot"),
  VIDEO("video"),
  VOICE("voice"),
  MERGED("merged"),
  SEGMENTS("segments");

  companion object {
    fun from(id: String?): OutputKind? = entries.firstOrNull { it.id == id }
  }
}

data class VideoQuality(val height: Int, val fps: Int, val bitrate: Int) {
  companion object {
    val LOW = VideoQuality(480, 15, 1_500_000)
    val MEDIUM = VideoQuality(720, 30, 4_000_000)
    val HIGH = VideoQuality(1080, 30, 8_000_000)

    fun preset(id: String, custom: VideoQuality): VideoQuality =
      when (id) {
        "low" -> LOW
        "high" -> HIGH
        "custom" -> custom
        else -> MEDIUM
      }
  }
}

data class AudioQuality(val sampleRate: Int, val bitrate: Int, val channels: Int) {
  companion object {
    val LOW = AudioQuality(22_050, 64_000, 1)
    val STANDARD = AudioQuality(44_100, 128_000, 2)
    val HIGH = AudioQuality(48_000, 192_000, 2)

    fun preset(id: String, custom: AudioQuality): AudioQuality =
      when (id) {
        "low" -> LOW
        "high" -> HIGH
        "custom" -> custom
        else -> STANDARD
      }
  }
}

/**
 * Everything the recorder service needs while the React Native UI may not be
 * running. Persisted as one JSON object in SharedPreferences; the JS settings
 * screen reads and patches the same object (see RecorderModule).
 */
data class RecorderConfig(
  val bubbleEnabled: Boolean = false,
  val mode: RecorderMode = RecorderMode.SCREENSHOT,
  val longPressMenu: Boolean = true,
  val showControls: Boolean = true,
  val previewSeconds: Int = 5,
  /** Save the screenshot when the preview times out; otherwise it is discarded. */
  val autoSaveScreenshot: Boolean = false,
  /** Keep screen-capture consent between captures (else asked every time). */
  val keepCaptureSession: Boolean = true,
  val videoPreset: String = "medium",
  val customVideo: VideoQuality = VideoQuality.MEDIUM,
  val audioSource: AudioSource = AudioSource.SYSTEM,
  val audioPreset: String = "standard",
  val customAudio: AudioQuality = AudioQuality.STANDARD,
  val segmentEnabled: Boolean = true,
  val segmentMinutes: Int = 5,
  val autoMerge: Boolean = true,
  val keepSegments: Boolean = false,
  /** Stop safely when free space falls below this. */
  val storageWarningMb: Int = 500,
  val keepScreenOn: Boolean = false,
  /** Light or dark overlay chrome; JS pushes the app theme. */
  val dark: Boolean = true,
  val accentColor: Int = 0xFFE5484D.toInt(),
  /** Folder tree URIs; empty = the default location for that kind. */
  val dirs: Map<OutputKind, String> = emptyMap(),
) {
  val video: VideoQuality
    get() = VideoQuality.preset(videoPreset, customVideo)

  val audio: AudioQuality
    get() = AudioQuality.preset(audioPreset, customAudio)

  /** 0 = one segment for the whole recording. */
  val segmentDurationUs: Long
    get() = if (segmentEnabled) segmentMinutes.toLong() * 60_000_000L else 0L

  fun toJson(): JSONObject =
    JSONObject().apply {
      put("bubbleEnabled", bubbleEnabled)
      put("mode", mode.id)
      put("longPressMenu", longPressMenu)
      put("showControls", showControls)
      put("previewSeconds", previewSeconds)
      put("autoSaveScreenshot", autoSaveScreenshot)
      put("keepCaptureSession", keepCaptureSession)
      put("videoPreset", videoPreset)
      put("customVideo", JSONObject().apply {
        put("height", customVideo.height)
        put("fps", customVideo.fps)
        put("bitrate", customVideo.bitrate)
      })
      put("audioSource", audioSource.id)
      put("audioPreset", audioPreset)
      put("customAudio", JSONObject().apply {
        put("sampleRate", customAudio.sampleRate)
        put("bitrate", customAudio.bitrate)
        put("channels", customAudio.channels)
      })
      put("segmentEnabled", segmentEnabled)
      put("segmentMinutes", segmentMinutes)
      put("autoMerge", autoMerge)
      put("keepSegments", keepSegments)
      put("storageWarningMb", storageWarningMb)
      put("keepScreenOn", keepScreenOn)
      put("dark", dark)
      put("accentColor", accentColor)
      put("dirs", JSONObject().apply { dirs.forEach { (k, v) -> put(k.id, v) } })
    }

  companion object {
    const val MIN_SEGMENT_MINUTES = 1
    const val MAX_SEGMENT_MINUTES = 120

    /** Reads [json] over [base]; unknown or out-of-range values keep the base value. */
    fun fromJson(json: JSONObject, base: RecorderConfig = RecorderConfig()): RecorderConfig {
      fun bool(key: String, d: Boolean) = if (json.has(key)) json.optBoolean(key, d) else d
      fun int(key: String, d: Int, min: Int, max: Int): Int {
        if (!json.has(key)) return d
        val v = json.optInt(key, d)
        return if (v in min..max) v else d
      }
      fun preset(key: String, d: String, all: Set<String>) =
        json.optString(key, d).takeIf { it in all } ?: d

      val cv = json.optJSONObject("customVideo")
      val customVideo =
        if (cv == null) base.customVideo
        else VideoQuality(
          height = cv.optInt("height", base.customVideo.height).coerceIn(240, 2160),
          fps = cv.optInt("fps", base.customVideo.fps).coerceIn(10, 60),
          bitrate = cv.optInt("bitrate", base.customVideo.bitrate).coerceIn(500_000, 40_000_000),
        )
      val ca = json.optJSONObject("customAudio")
      val customAudio =
        if (ca == null) base.customAudio
        else AudioQuality(
          sampleRate = ca.optInt("sampleRate", base.customAudio.sampleRate)
            .takeIf { it in setOf(16_000, 22_050, 44_100, 48_000) } ?: base.customAudio.sampleRate,
          bitrate = ca.optInt("bitrate", base.customAudio.bitrate).coerceIn(32_000, 320_000),
          channels = ca.optInt("channels", base.customAudio.channels).coerceIn(1, 2),
        )
      val dirs = json.optJSONObject("dirs")?.let { d ->
        OutputKind.entries.mapNotNull { k -> d.optString(k.id, "").takeIf { it.isNotEmpty() }?.let { k to it } }.toMap()
      } ?: base.dirs

      return RecorderConfig(
        bubbleEnabled = bool("bubbleEnabled", base.bubbleEnabled),
        mode = if (json.has("mode")) RecorderMode.from(json.optString("mode")) else base.mode,
        longPressMenu = bool("longPressMenu", base.longPressMenu),
        showControls = bool("showControls", base.showControls),
        previewSeconds = int("previewSeconds", base.previewSeconds, 2, 30),
        autoSaveScreenshot = bool("autoSaveScreenshot", base.autoSaveScreenshot),
        keepCaptureSession = bool("keepCaptureSession", base.keepCaptureSession),
        videoPreset = preset("videoPreset", base.videoPreset, setOf("low", "medium", "high", "custom")),
        customVideo = customVideo,
        audioSource = if (json.has("audioSource")) AudioSource.from(json.optString("audioSource")) else base.audioSource,
        audioPreset = preset("audioPreset", base.audioPreset, setOf("low", "standard", "high", "custom")),
        customAudio = customAudio,
        segmentEnabled = bool("segmentEnabled", base.segmentEnabled),
        segmentMinutes = int("segmentMinutes", base.segmentMinutes, MIN_SEGMENT_MINUTES, MAX_SEGMENT_MINUTES),
        autoMerge = bool("autoMerge", base.autoMerge),
        keepSegments = bool("keepSegments", base.keepSegments),
        storageWarningMb = int("storageWarningMb", base.storageWarningMb, 100, 20_000),
        keepScreenOn = bool("keepScreenOn", base.keepScreenOn),
        dark = bool("dark", base.dark),
        accentColor = if (json.has("accentColor")) json.optInt("accentColor", base.accentColor) else base.accentColor,
        dirs = dirs,
      )
    }
  }
}

/** Last bubble position: which side, and how far down the usable height (0–1). */
data class RecorderBubblePosition(val onRight: Boolean, val yRatio: Float)

/** SharedPreferences store, separate from the OCR button's preferences. */
class RecorderPrefs(context: Context) {
  private val prefs: SharedPreferences =
    context.applicationContext.getSharedPreferences("recorder_prefs", Context.MODE_PRIVATE)

  fun read(): RecorderConfig =
    try {
      prefs.getString(KEY_CONFIG, null)?.let { RecorderConfig.fromJson(JSONObject(it)) } ?: RecorderConfig()
    } catch (_: Exception) {
      RecorderConfig()
    }

  fun write(config: RecorderConfig) {
    prefs.edit().putString(KEY_CONFIG, config.toJson().toString()).apply()
  }

  fun patch(json: JSONObject): RecorderConfig = RecorderConfig.fromJson(json, read()).also { write(it) }

  fun readPosition(): RecorderBubblePosition =
    RecorderBubblePosition(prefs.getBoolean(KEY_RIGHT, true), prefs.getFloat(KEY_Y, 0.55f).coerceIn(0f, 1f))

  fun writePosition(position: RecorderBubblePosition) {
    prefs.edit().putBoolean(KEY_RIGHT, position.onRight).putFloat(KEY_Y, position.yRatio.coerceIn(0f, 1f)).apply()
  }

  fun resetPosition() {
    prefs.edit().remove(KEY_RIGHT).remove(KEY_Y).apply()
  }

  private companion object {
    const val KEY_CONFIG = "config"
    const val KEY_RIGHT = "bubble_right"
    const val KEY_Y = "bubble_y"
  }
}
