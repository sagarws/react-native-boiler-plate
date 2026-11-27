// Tone and dynamics after the reverb: warmth, de-harsh, smoothing,
// compressor, loudness contour and output gain; then the lookahead limiter.
#pragma once

#include "dsp.h"
#include "params.h"

namespace sa {

class ToneDynamics {
 public:
  void prepare(float fs);
  // p: parameter targets; the first block after reset starts at them.
  void reset(const float* p);
  void process(float* L, float* R, int n, const float* p);

 private:
  float fs_ = 48000;
  bool fresh_ = true;
  // Warmth: saturation + split-band tilt.
  Ramp warmMix_, warmLow_, warmHigh_;
  OnePole dc_[2], warmLp_[2], warmHp_[2];
  float dcCoef_ = 0, warmLowCoef_ = 0, warmHighCoef_ = 0;
  // Harshness: dynamic cut of a 5-9 kHz band (x - c * bandpass).
  BiquadCoefs harshBp_;
  BiquadState harshSt_[2];
  float bandPow_ = 0, fullPow_ = 0, envCoef_ = 0;
  Ramp harsh_;
  // Smoothing: two cascaded one-poles, whose coefficient can glide per
  // sample (a biquad redesigned near Nyquist each block would click).
  OnePole smoothLp_[2][2];
  Ramp smoothMix_, smoothCoef_;
  // Compressor (RMS detector, gain in dB smoothed with attack/release).
  float compPow_ = 0, compGainDb_ = 0, rmsCoef_ = 0;
  Ramp compGain_{1.f};
  // Loudness contour, driven by a slow level estimate.
  float loudPow_ = 0, loudCoef_ = 0, loudLowCoef_ = 0, loudHighCoef_ = 0;
  OnePole loudLp_[2], loudHp_[2];
  Ramp loudLow_, loudHigh_;
  Ramp output_{1.f};
  // Block-smoothed user controls.
  float warmAmt_ = 0, harshAmt_ = 0, smoothAmt_ = 0, compAmt_ = 0, loudAmt_ = 0, outDb_ = 0;
};

// Lookahead peak limiter: min-hold over the lookahead window, instant
// attack / smooth release, then a box filter of the same length. Because the
// box only averages values at or below the window minimum, the gain at the
// peak sample is guaranteed to bring it under the ceiling.
class Limiter {
 public:
  static constexpr float kCeiling = 0.98f;

  void prepare(float fs);
  void reset();
  void process(float* L, float* R, int n, bool enabled);
  // Largest gain reduction (dB, >= 0) of the last process() call.
  float gainReductionDb() const { return grDb_; }

 private:
  int look_ = 1;  // window length L; audio is delayed by L - 1
  std::vector<float> delayL_, delayR_, box_, minVal_;
  std::vector<uint32_t> minIdx_;
  int mask_ = 0, boxPos_ = 0;
  uint32_t head_ = 0, tail_ = 0, n_ = 0;  // wrap-around safe: only differences are used
  double boxSum_ = 0;
  float env_ = 1, release_ = 0, grDb_ = 0;
};

}  // namespace sa
