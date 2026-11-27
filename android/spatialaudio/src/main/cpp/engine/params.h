// Parameter indices — must match SpatialParams.kt (and the JS mirror) exactly.
#pragma once

namespace sa {

enum Param : int {
  kEnabled = 0,
  kQuality = 1,
  kAzimuth = 2,
  kElevation = 3,
  kDistance = 4,
  kPattern = 5,
  kRpm = 6,
  kMoveIntensity = 7,
  kSourceMode = 8,
  kSurround = 9,
  kHrtf = 10,
  kWidth = 11,
  kRoomDepth = 12,
  kFrontRear = 13,
  kReverbMix = 14,
  kReverbDecay = 15,
  kRoomSize = 16,
  kReverbDamp = 17,
  kEcho = 18,
  kPredelay = 19,
  kPreamp = 20,
  kEq0 = 21,
  kBass = 31,
  kTreble = 32,
  kVocal = 33,
  kWarmth = 34,
  kHarshness = 35,
  kSmoothing = 36,
  kCompressor = 37,
  kLoudness = 38,
  kOutput = 39,
  kLimiter = 40,
  kSpeaker0 = 41,
  kEqEnabled = 49,
  kParamCount = 50,
};

constexpr int kEqBands = 10;
constexpr int kSpeakers = 8;
static_assert(kBass == kEq0 + kEqBands, "EQ bands must precede BASS");
static_assert(kEqEnabled == kSpeaker0 + kSpeakers, "speakers must precede EQ_ENABLED");

enum Pattern : int {
  kStatic = 0,
  kCircleCw,
  kCircleCcw,
  kLeftToRight,
  kRightToLeft,
  kFrontToBack,
  kBackToFront,
  kRandom3d,
  kWave,
  kFigureEight,
  kPatternCount,
};

struct ParamSpec {
  float min, max, def;
};

extern const ParamSpec kParamSpecs[kParamCount];

void defaultParams(float* out);
// Clamps to the accepted range; non-finite input falls back to the default.
float clampParam(int index, float value);

}  // namespace sa
