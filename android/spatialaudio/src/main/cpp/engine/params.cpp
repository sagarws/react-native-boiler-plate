#include "params.h"

#include <cstdint>
#include <cstring>

namespace sa {

// Ranges from SpatialParams.kt; unit-less controls are 0..1.
const ParamSpec kParamSpecs[kParamCount] = {
    {0, 1, 1},          // ENABLED
    {0, 2, 1},          // QUALITY
    {-180, 180, 0},     // AZIMUTH
    {-40, 70, 0},       // ELEVATION
    {0, 1, 0.4f},       // DISTANCE
    {0, 9, 1},          // PATTERN
    {0, 60, 10},        // RPM
    {0, 1, 1},          // MOVE_INTENSITY
    {0, 2, 0},          // SOURCE_MODE
    {0, 1, 0.25f},      // SURROUND
    {0, 1, 1},          // HRTF
    {0, 2, 1},          // WIDTH
    {0, 1, 0.3f},       // ROOM_DEPTH
    {0, 1, 0.7f},       // FRONT_REAR
    {0, 1, 0.15f},      // REVERB_MIX
    {0.2f, 8, 1.8f},    // REVERB_DECAY
    {0, 1, 0.5f},       // ROOM_SIZE
    {0, 1, 0.5f},       // REVERB_DAMP
    {0, 1, 0},          // ECHO
    {0, 100, 20},       // PREDELAY
    {-12, 6, 0},        // PREAMP
    {-12, 12, 0}, {-12, 12, 0}, {-12, 12, 0}, {-12, 12, 0}, {-12, 12, 0},
    {-12, 12, 0}, {-12, 12, 0}, {-12, 12, 0}, {-12, 12, 0}, {-12, 12, 0},  // EQ_0..9
    {0, 12, 0},         // BASS
    {-12, 12, 0},       // TREBLE
    {0, 1, 0},          // VOCAL
    {0, 1, 0},          // WARMTH
    {0, 1, 0},          // HARSHNESS
    {0, 1, 0},          // SMOOTHING
    {0, 1, 0},          // COMPRESSOR
    {0, 1, 0},          // LOUDNESS
    {-12, 6, 0},        // OUTPUT
    {0, 1, 1},          // LIMITER
    {0, 1.5f, 1}, {0, 1.5f, 1}, {0, 1.5f, 1}, {0, 1.5f, 1},
    {0, 1.5f, 1}, {0, 1.5f, 1}, {0, 1.5f, 1}, {0, 1.5f, 1},  // SPEAKER_0..7
    {0, 1, 1},          // EQ_ENABLED
};

void defaultParams(float* out) {
  for (int i = 0; i < kParamCount; ++i) out[i] = kParamSpecs[i].def;
}

float clampParam(int index, float value) {
  // Bit test instead of std::isfinite, which -ffast-math is allowed to fold away.
  uint32_t bits;
  std::memcpy(&bits, &value, sizeof bits);
  const ParamSpec& s = kParamSpecs[index];
  if ((bits & 0x7f800000u) == 0x7f800000u) return s.def;
  return value < s.min ? s.min : (value > s.max ? s.max : value);
}

}  // namespace sa
