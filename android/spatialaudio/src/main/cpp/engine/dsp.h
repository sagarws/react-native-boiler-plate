// Small DSP building blocks shared by every stage of the engine. Everything
// here is allocation-free after prepare/allocate so it is safe on the audio
// thread.
#pragma once

#include <cmath>
#include <cstdint>
#include <vector>

namespace sa {

constexpr float kPi = 3.14159265358979f;
constexpr float kTwoPi = 2.f * kPi;
constexpr float kSpeedOfSound = 343.f;
// Internal block length: parameters, motion and HRTF geometry update this
// often and are linearly ramped inside it.
constexpr int kChunk = 32;

inline float clampf(float x, float lo, float hi) { return x < lo ? lo : (x > hi ? hi : x); }
inline float dbToGain(float db) { return std::pow(10.f, db * 0.05f); }
inline float gainToDb(float g) { return 20.f * std::log10(g > 1e-9f ? g : 1e-9f); }
inline float lerp(float a, float b, float t) { return a + t * (b - a); }

// Padé tanh approximation: smooth saturation without a libm call per sample.
inline float softClip(float x) {
  x = clampf(x, -3.f, 3.f);
  const float x2 = x * x;
  return x * (27.f + x2) / (27.f + 9.f * x2);
}

// Fraction of the remaining distance a one-pole smoother covers in n samples.
inline float blockCoef(float tauSec, int n, float fs) { return 1.f - std::exp(-float(n) / (tauSec * fs)); }

// One-pole low-pass coefficient for y += c * (x - y).
inline float onePoleCoef(float hz, float fs) { return 1.f - std::exp(-kTwoPi * hz / fs); }

struct OnePole {
  float z = 0;
  float lp(float x, float c) {
    z += c * (x - z);
    return z;
  }
  void reset() { z = 0; }
};

// Block-rate value whose per-sample use is a linear ramp from the previous
// block's end value, so gain changes never step.
struct Ramp {
  float start = 0, end = 0, step = 0;
  explicit Ramp(float v = 0) : start(v), end(v) {}
  void to(float target, int n, bool snap) {
    start = snap ? target : end;
    end = target;
    step = (end - start) / float(n);
  }
  float at(int i) const { return start + step * float(i + 1); }
  bool idle() const { return start == 0.f && end == 0.f; }
  bool unity() const { return start == 1.f && end == 1.f; }
};

struct BiquadCoefs {
  float b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
};

// RBJ "Audio EQ Cookbook" designs; f0 is clamped below Nyquist.
BiquadCoefs designPeaking(float fs, float f0, float q, float gainDb);
BiquadCoefs designLowShelf(float fs, float f0, float gainDb);
BiquadCoefs designHighShelf(float fs, float f0, float gainDb);
BiquadCoefs designLowPass(float fs, float f0, float q);
BiquadCoefs designHighPass(float fs, float f0, float q);
BiquadCoefs designBandPass(float fs, float f0, float q);

// Direct form I: its state is the real past input/output, so coefficients
// gliding block by block (EQ moves) don't inject transients the way
// transposed forms do.
struct BiquadState {
  float x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  float process(const BiquadCoefs& c, float x) {
    const float y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  }
  void reset() { x1 = x2 = y1 = y2 = 0; }
};

// Power-of-two circular buffer. read*(0) is the most recently written sample.
class DelayLine {
 public:
  void allocate(int minLength) {
    int size = 16;
    while (size < minLength + 8) size <<= 1;
    buf_.assign(size_t(size), 0.f);
    mask_ = size - 1;
    pos_ = 0;
  }
  void clear() {
    for (float& v : buf_) v = 0.f;
  }
  int capacity() const { return mask_ - 4; }
  void write(float x) {
    buf_[size_t(pos_)] = x;
    pos_ = (pos_ + 1) & mask_;
  }
  float readInt(int d) const { return buf_[size_t((pos_ - 1 - d) & mask_)]; }
  float readLinear(float d) const {
    const int i = int(d);
    const float f = d - float(i);
    const float a = readInt(i);
    return a + f * (readInt(i + 1) - a);
  }
  // 4-point Hermite; d must be >= 1 so the newer neighbour exists.
  float readHermite(float d) const {
    const int i = int(d);
    const float f = d - float(i);
    const float ym1 = readInt(i - 1), y0 = readInt(i), y1 = readInt(i + 1), y2 = readInt(i + 2);
    const float c1 = 0.5f * (y1 - ym1);
    const float c2 = ym1 - 2.5f * y0 + 2.f * y1 - 0.5f * y2;
    const float c3 = 0.5f * (y2 - ym1) + 1.5f * (y0 - y1);
    return ((c3 * f + c2) * f + c1) * f + y0;
  }

 private:
  std::vector<float> buf_;
  int mask_ = 0;
  int pos_ = 0;
};

// Deterministic generator so renders (and tests) are repeatable.
struct Lcg {
  uint32_t s = 0x1234567u;
  float next() {  // [-1, 1)
    s = s * 1664525u + 1013904223u;
    return float(int32_t(s)) * (1.f / 2147483648.f);
  }
};

}  // namespace sa
