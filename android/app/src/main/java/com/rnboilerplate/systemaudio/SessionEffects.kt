// Virtualizer is deprecated in favour of Spatializer, which no app can apply
// to another app's session; it is still the only per-session virtualizer.
@file:Suppress("DEPRECATION")

package com.rnboilerplate.systemaudio

import android.content.Context
import android.content.pm.PackageManager
import android.media.audiofx.AudioEffect
import android.media.audiofx.BassBoost
import android.media.audiofx.Equalizer
import android.media.audiofx.LoudnessEnhancer
import android.media.audiofx.PresetReverb
import android.media.audiofx.Virtualizer
import android.util.Log
import com.rnboilerplate.spatialaudio.SpatialParams
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Route 1 of "Other apps": Android's own audio effects on the sessions that
 * players announce (AudioEffect.ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION).
 *
 * Process-wide: the announced sessions arrive through [SessionEffectReceiver]
 * whether or not React Native is running. The enabled flag and the last
 * parameter array are kept in SharedPreferences so a session opened while
 * the process runs (but the studio screen is closed) still gets the effects.
 *
 * Never uses session 0 (the deprecated, unreliable global output mix).
 */
class SessionEffects private constructor(context: Context) {
  private val app = context.applicationContext
  private val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  private val sessions = LinkedHashMap<Int, Session>()

  /** Per effect: what the device advertises, then the result of the latest attach attempt. */
  private val supported: MutableMap<String, Boolean> = deviceEffects()

  @Volatile var enabled = prefs.getBoolean(KEY_ENABLED, false)
    private set

  @Volatile var params: FloatArray? = prefs.getString(KEY_PARAMS, null)?.let(::decode)
    private set

  private class Session(val id: Int, val packageName: String, val label: String) {
    var effects: Attached? = null
  }

  // ── Announced sessions ──

  fun open(sessionId: Int, packageName: String) {
    if (sessionId <= 0 || packageName == app.packageName) return // 0 = global mix; our own player has the 8D engine.
    synchronized(this) {
      // The manifest and the runtime receiver can both get one broadcast.
      if (sessions[sessionId]?.packageName == packageName) return
      sessions.remove(sessionId)?.effects?.release()
      val session = Session(sessionId, packageName, labelOf(packageName))
      sessions[sessionId] = session
      // Players that never send CLOSE would otherwise pile up.
      while (sessions.size > MAX_SESSIONS) {
        val oldest = sessions.keys.first()
        sessions.remove(oldest)?.effects?.release()
      }
      if (enabled) attach(session)
    }
    SystemAudioEvents.changed()
  }

  fun close(sessionId: Int) {
    synchronized(this) { sessions.remove(sessionId)?.effects?.release() }
    SystemAudioEvents.changed()
  }

  fun setEnabled(on: Boolean) {
    synchronized(this) {
      enabled = on
      prefs.edit().putBoolean(KEY_ENABLED, on).apply()
      sessions.values.forEach {
        if (on) {
          if (it.effects == null) attach(it)
        } else {
          it.effects?.release()
          it.effects = null
        }
      }
    }
    SystemAudioEvents.changed()
  }

  fun setParams(values: FloatArray) {
    if (values.size < SpatialParams.COUNT) return
    synchronized(this) {
      params = values
      prefs.edit().putString(KEY_PARAMS, values.joinToString(",")).apply()
      sessions.values.forEach { s -> s.effects?.let { apply(it, values) } }
    }
  }

  // ── Status ──

  fun sessionsJson(): JSONArray =
    synchronized(this) {
      JSONArray().also { out ->
        sessions.values.forEach {
          out.put(
            JSONObject()
              .put("sessionId", it.id)
              .put("packageName", it.packageName)
              .put("appLabel", it.label)
              .put("attached", it.effects?.hasControl() == true),
          )
        }
      }
    }

  fun supportedJson(): JSONObject =
    synchronized(this) { JSONObject().also { o -> NAMES.forEach { o.put(it, supported[it] == true) } } }

  // ── Effects ──

  /** Holds one session's effects; any of them may be missing (unsupported / refused). */
  private class Attached(
    val equalizer: Equalizer?,
    val bassBoost: BassBoost?,
    val virtualizer: Virtualizer?,
    val reverb: PresetReverb?,
    val loudness: LoudnessEnhancer?,
  ) {
    val all: List<AudioEffect> get() = listOfNotNull(equalizer, bassBoost, virtualizer, reverb, loudness)

    /** False when another app with a higher priority took the effects over. */
    fun hasControl() = all.any { runCatching { it.hasControl() }.getOrDefault(false) }

    fun release() = all.forEach { runCatching { it.release() } }
  }

  private fun attach(session: Session) {
    val id = session.id
    val attached =
      Attached(
        create(EQUALIZER) { Equalizer(PRIORITY, id) },
        create(BASS_BOOST) { BassBoost(PRIORITY, id) },
        create(VIRTUALIZER) { Virtualizer(PRIORITY, id) },
        create(REVERB) { PresetReverb(PRIORITY, id) },
        create(LOUDNESS) { LoudnessEnhancer(id) },
      )
    if (attached.all.isEmpty()) return
    attached.all.forEach { e -> e.setControlStatusListener { _, _ -> SystemAudioEvents.changed() } }
    session.effects = attached
    apply(attached, params ?: FloatArray(SpatialParams.COUNT).also { it[SpatialParams.EQ_ENABLED] = 1f })
  }

  private inline fun <T : AudioEffect> create(name: String, make: () -> T): T? =
    try {
      make().also { supported[name] = true }
    } catch (e: Exception) {
      // UnsupportedOperationException (no such effect), IllegalArgumentException
      // (dead session), RuntimeException (out of effect slots / refused).
      Log.w(TAG, "$name unavailable: ${e.javaClass.simpleName}")
      supported[name] = false
      null
    }

  private fun apply(a: Attached, p: FloatArray) {
    a.equalizer?.let { eq ->
      guard(EQUALIZER) {
        val range = eq.bandLevelRange
        val bands = eq.numberOfBands.toInt()
        for (band in 0 until bands) {
          val hz = eq.getCenterFreq(band.toShort()) / 1000.0
          val mb = EffectMapping.eqLevelMb(p, hz).coerceIn(range[0].toInt(), range[1].toInt())
          eq.setBandLevel(band.toShort(), mb.toShort())
        }
        eq.enabled = true
      }
    }
    a.bassBoost?.let { bb ->
      guard(BASS_BOOST) {
        val strength = EffectMapping.bassStrength(p)
        if (bb.strengthSupported) bb.setStrength(strength.toShort())
        bb.enabled = strength > 0
      }
    }
    a.virtualizer?.let { v ->
      guard(VIRTUALIZER) {
        val strength = EffectMapping.virtualizerStrength(p)
        if (v.strengthSupported) v.setStrength(strength.toShort())
        v.enabled = strength > 0
      }
    }
    a.reverb?.let { r ->
      guard(REVERB) {
        val preset = EffectMapping.reverbPreset(p)
        r.preset = preset
        r.enabled = preset != PresetReverb.PRESET_NONE
      }
    }
    a.loudness?.let { l ->
      guard(LOUDNESS) {
        val mb = EffectMapping.loudnessMb(p)
        l.setTargetGain(mb)
        l.enabled = mb > 0
      }
    }
  }

  /** Effects lose control or die with their session; a failed setter is not fatal. */
  private inline fun guard(name: String, block: () -> Unit) {
    try {
      block()
    } catch (e: Exception) {
      Log.w(TAG, "$name: ${e.javaClass.simpleName}")
    }
  }

  private fun labelOf(packageName: String): String =
    try {
      val pm = app.packageManager
      pm.getApplicationLabel(pm.getApplicationInfo(packageName, 0)).toString()
    } catch (_: PackageManager.NameNotFoundException) {
      packageName // Not visible to us (Android 11+ package visibility).
    }

  private fun deviceEffects(): MutableMap<String, Boolean> {
    val types =
      runCatching { AudioEffect.queryEffects()?.map { it.type }.orEmpty().toSet() }.getOrDefault(emptySet())
    return mutableMapOf(
      EQUALIZER to (AudioEffect.EFFECT_TYPE_EQUALIZER in types),
      BASS_BOOST to (AudioEffect.EFFECT_TYPE_BASS_BOOST in types),
      VIRTUALIZER to (AudioEffect.EFFECT_TYPE_VIRTUALIZER in types),
      REVERB to (AudioEffect.EFFECT_TYPE_PRESET_REVERB in types),
      LOUDNESS to (AudioEffect.EFFECT_TYPE_LOUDNESS_ENHANCER in types),
    )
  }

  companion object {
    private const val TAG = "SessionEffects"
    private const val PREFS = "system_audio"
    private const val KEY_ENABLED = "effects_enabled"
    private const val KEY_PARAMS = "effect_params"
    /** Above the default 0 so a player's own (flat) effects don't keep control. */
    private const val PRIORITY = 1
    private const val MAX_SESSIONS = 16

    const val EQUALIZER = "equalizer"
    const val BASS_BOOST = "bassBoost"
    const val VIRTUALIZER = "virtualizer"
    const val REVERB = "reverb"
    const val LOUDNESS = "loudness"
    private val NAMES = listOf(EQUALIZER, BASS_BOOST, VIRTUALIZER, REVERB, LOUDNESS)

    @Volatile private var instance: SessionEffects? = null

    fun get(context: Context): SessionEffects =
      instance ?: synchronized(this) { instance ?: SessionEffects(context).also { instance = it } }

    private fun decode(s: String): FloatArray? =
      runCatching { s.split(',').map { it.toFloat() }.toFloatArray() }.getOrNull()?.takeIf { it.size >= SpatialParams.COUNT }
  }
}

/**
 * Studio parameter array → Android's effect settings. Approximations: the
 * system effects have no 8D movement, HRTF or speaker layout.
 */
internal object EffectMapping {
  private val STUDIO_HZ = doubleArrayOf(31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0)

  /**
   * Studio EQ curve at [hz] (log-frequency interpolation between the two
   * nearest studio bands; outside 31 Hz–16 kHz the edge band), plus TREBLE
   * as a shelf rising from 2 kHz to 8 kHz, PREAMP, and a negative OUTPUT
   * (LoudnessEnhancer only boosts). In millibels.
   */
  fun eqLevelMb(p: FloatArray, hz: Double): Int {
    val eqOn = p[SpatialParams.EQ_ENABLED] >= 0.5f
    fun band(i: Int) = if (eqOn) p[SpatialParams.EQ_0 + i].toDouble() else 0.0
    val db =
      when {
        hz <= STUDIO_HZ.first() -> band(0)
        hz >= STUDIO_HZ.last() -> band(STUDIO_HZ.size - 1)
        else -> {
          val hi = STUDIO_HZ.indexOfFirst { it >= hz }
          val lo = hi - 1
          val t = ln(hz / STUDIO_HZ[lo]) / ln(STUDIO_HZ[hi] / STUDIO_HZ[lo])
          band(lo) * (1 - t) + band(hi) * t
        }
      }
    val shelf = (ln(hz / 2000.0) / ln(4.0)).coerceIn(0.0, 1.0)
    val treble = p[SpatialParams.TREBLE] * shelf
    val gain = p[SpatialParams.PREAMP] + min(p[SpatialParams.OUTPUT], 0f)
    return ((db + treble + gain) * 100).roundToInt()
  }

  /** BASS 0–12 dB → 0–1000. */
  fun bassStrength(p: FloatArray): Int = (p[SpatialParams.BASS].coerceIn(0f, 12f) / 12f * 1000).roundToInt()

  /** Stronger of SURROUND / HRTF → 0–1000; off when the 8D section is bypassed. */
  fun virtualizerStrength(p: FloatArray): Int {
    if (p[SpatialParams.ENABLED] < 0.5f) return 0
    val amount = max(p[SpatialParams.SURROUND], p[SpatialParams.HRTF]).coerceIn(0f, 1f)
    return (amount * 1000).roundToInt()
  }

  /**
   * NONE below 5 % mix; otherwise the preset closest to the studio room —
   * ROOM_SIZE (0–1) nudged up by a heavy REVERB_MIX — on the scale
   * small room · medium room · large room · medium hall · large hall.
   */
  fun reverbPreset(p: FloatArray): Short {
    val mix = p[SpatialParams.REVERB_MIX]
    if (mix < 0.05f) return PresetReverb.PRESET_NONE
    val size = (p[SpatialParams.ROOM_SIZE] * 0.8f + mix * 0.2f).coerceIn(0f, 1f)
    val scale =
      shortArrayOf(
        PresetReverb.PRESET_SMALLROOM,
        PresetReverb.PRESET_MEDIUMROOM,
        PresetReverb.PRESET_LARGEROOM,
        PresetReverb.PRESET_MEDIUMHALL,
        PresetReverb.PRESET_LARGEHALL,
      )
    return scale[(size * (scale.size - 1)).roundToInt()]
  }

  /** LOUDNESS (0–1 → up to +6 dB) plus a positive OUTPUT, in mB, capped at +800. */
  fun loudnessMb(p: FloatArray): Int {
    val db = p[SpatialParams.LOUDNESS].coerceIn(0f, 1f) * 6f + max(p[SpatialParams.OUTPUT], 0f)
    return (db * 100).roundToInt().coerceIn(0, 800).let { if (it < 10) 0 else it }
  }
}
