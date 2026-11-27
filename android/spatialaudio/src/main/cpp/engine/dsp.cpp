#include "dsp.h"

namespace sa {
namespace {

float safeW0(float fs, float f0) { return kTwoPi * clampf(f0, 10.f, 0.45f * fs) / fs; }

BiquadCoefs normalize(float b0, float b1, float b2, float a0, float a1, float a2) {
  const float inv = 1.f / a0;
  return {b0 * inv, b1 * inv, b2 * inv, a1 * inv, a2 * inv};
}

}  // namespace

BiquadCoefs designPeaking(float fs, float f0, float q, float gainDb) {
  const float a = std::pow(10.f, gainDb / 40.f);
  const float w0 = safeW0(fs, f0);
  const float cs = std::cos(w0), al = std::sin(w0) / (2.f * q);
  return normalize(1.f + al * a, -2.f * cs, 1.f - al * a, 1.f + al / a, -2.f * cs, 1.f - al / a);
}

BiquadCoefs designLowShelf(float fs, float f0, float gainDb) {
  const float a = std::pow(10.f, gainDb / 40.f);
  const float w0 = safeW0(fs, f0);
  const float cs = std::cos(w0), sq = 2.f * std::sqrt(a) * std::sin(w0) / std::sqrt(2.f);  // shelf slope S = 1
  return normalize(a * ((a + 1.f) - (a - 1.f) * cs + sq), 2.f * a * ((a - 1.f) - (a + 1.f) * cs),
                   a * ((a + 1.f) - (a - 1.f) * cs - sq), (a + 1.f) + (a - 1.f) * cs + sq,
                   -2.f * ((a - 1.f) + (a + 1.f) * cs), (a + 1.f) + (a - 1.f) * cs - sq);
}

BiquadCoefs designHighShelf(float fs, float f0, float gainDb) {
  const float a = std::pow(10.f, gainDb / 40.f);
  const float w0 = safeW0(fs, f0);
  const float cs = std::cos(w0), sq = 2.f * std::sqrt(a) * std::sin(w0) / std::sqrt(2.f);
  return normalize(a * ((a + 1.f) + (a - 1.f) * cs + sq), -2.f * a * ((a - 1.f) + (a + 1.f) * cs),
                   a * ((a + 1.f) + (a - 1.f) * cs - sq), (a + 1.f) - (a - 1.f) * cs + sq,
                   2.f * ((a - 1.f) - (a + 1.f) * cs), (a + 1.f) - (a - 1.f) * cs - sq);
}

BiquadCoefs designLowPass(float fs, float f0, float q) {
  const float w0 = safeW0(fs, f0);
  const float cs = std::cos(w0), al = std::sin(w0) / (2.f * q);
  return normalize((1.f - cs) * 0.5f, 1.f - cs, (1.f - cs) * 0.5f, 1.f + al, -2.f * cs, 1.f - al);
}

BiquadCoefs designHighPass(float fs, float f0, float q) {
  const float w0 = safeW0(fs, f0);
  const float cs = std::cos(w0), al = std::sin(w0) / (2.f * q);
  return normalize((1.f + cs) * 0.5f, -(1.f + cs), (1.f + cs) * 0.5f, 1.f + al, -2.f * cs, 1.f - al);
}

BiquadCoefs designBandPass(float fs, float f0, float q) {
  const float w0 = safeW0(fs, f0);
  const float cs = std::cos(w0), al = std::sin(w0) / (2.f * q);
  return normalize(al, 0.f, -al, 1.f + al, -2.f * cs, 1.f - al);
}

}  // namespace sa
