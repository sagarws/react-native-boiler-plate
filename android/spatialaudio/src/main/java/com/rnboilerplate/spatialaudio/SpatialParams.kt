package com.rnboilerplate.spatialaudio

/**
 * Indices into the engine's parameter array (FloatArray of [COUNT]). The JS
 * side mirrors this list in src/features/audioStudio/dsp/params.ts — keep the
 * two in the same order. Ranges are what the engine accepts (it clamps).
 */
object SpatialParams {
  /** 8D spatial rendering on (1) or bypassed (0); EQ / dynamics still run. */
  const val ENABLED = 0
  /** 0 battery saver · 1 balanced · 2 high quality. */
  const val QUALITY = 1
  /** Base source direction, degrees: 0 front, +90 right, ±180 behind. */
  const val AZIMUTH = 2
  /** Degrees: −40 below … 0 ear level … +70 above. */
  const val ELEVATION = 3
  /** 0 extremely near … 1 very far. */
  const val DISTANCE = 4
  /**
   * Movement: 0 static · 1 circle clockwise · 2 circle anticlockwise ·
   * 3 left→right · 4 right→left · 5 front→back · 6 back→front ·
   * 7 random 3D · 8 wave · 9 figure-eight (custom path).
   */
  const val PATTERN = 5
  /** Rotations (or path cycles) per minute, 0–60. */
  const val RPM = 6
  /** How far the movement goes, 0–1. */
  const val MOVE_INTENSITY = 7
  /** 0 one source (mono sum) · 1 stereo pair (L and R as two sources) · 2 centre/vocal source + ambience bed. */
  const val SOURCE_MODE = 8
  /** Virtual 8-speaker surround bed amount, 0–1. */
  const val SURROUND = 9
  /** Binaural (HRTF) strength, 0 plain stereo … 1 full. */
  const val HRTF = 10
  /** Stereo width, 0 mono … 1 unchanged … 2 extra wide. */
  const val WIDTH = 11
  /** Early reflections / virtual room depth, 0–1. */
  const val ROOM_DEPTH = 12
  /** Front/rear cue strength (pinna + rear shadow), 0–1. */
  const val FRONT_REAR = 13
  const val REVERB_MIX = 14
  /** Seconds, 0.2–8. */
  const val REVERB_DECAY = 15
  const val ROOM_SIZE = 16
  const val REVERB_DAMP = 17
  const val ECHO = 18
  /** Milliseconds, 0–100. */
  const val PREDELAY = 19
  /** dB, −12…+6. */
  const val PREAMP = 20
  /** dB, −12…+12, at 31, 62, 125, 250, 500, 1k, 2k, 4k, 8k, 16k Hz (EQ_0 + band). */
  const val EQ_0 = 21
  /** dB, 0…+12 (low shelf + gentle harmonic bass). */
  const val BASS = 31
  /** dB, −12…+12 (high shelf). */
  const val TREBLE = 32
  const val VOCAL = 33
  const val WARMTH = 34
  const val HARSHNESS = 35
  const val SMOOTHING = 36
  const val COMPRESSOR = 37
  const val LOUDNESS = 38
  /** dB, −12…+6. */
  const val OUTPUT = 39
  /** Peak limiter on (1); keeps the output below 0 dBFS. */
  const val LIMITER = 40
  /** Speaker levels 0–1.5: FL, FR, SL, SR, RL, RR, UL, UR (SPEAKER_0 + n). */
  const val SPEAKER_0 = 41
  /** EQ section on (1) / flat (0). */
  const val EQ_ENABLED = 49
  const val COUNT = 50

  /** [SpatialEngine.state] layout. */
  const val STATE_AZIMUTH = 0
  const val STATE_ELEVATION = 1
  const val STATE_DISTANCE = 2
  const val STATE_PEAK_L = 3
  const val STATE_PEAK_R = 4
  const val STATE_GAIN_REDUCTION_DB = 5
  const val STATE_COUNT = 6
}
