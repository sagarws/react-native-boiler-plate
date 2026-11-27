// Freeverb-style stereo reverb (Jezar's topology, written from scratch:
// 8 damped feedback combs + 4 series allpasses per channel) with pre-delay,
// plus a filtered ping-pong echo.
#pragma once

#include "dsp.h"

namespace sa {

class Reverb {
 public:
  static constexpr int kCombs = 8;
  static constexpr int kAllpasses = 4;

  void prepare(float fs);
  // p: parameter targets; the first block after reset starts at them.
  void reset(const float* p);
  // L/R: dry in, dry + reverb + echo out. send: mono reverb input.
  void process(float* L, float* R, const float* send, int n, const float* p);

 private:
  struct Comb {
    DelayLine line;
    float base = 0;   // tuned length at this sample rate (samples)
    float delay = 0;  // smoothed length incl. room size, ramped per sample
    float store = 0;  // damping low-pass state
    float level = 1;  // quality fade (battery saver runs half the combs)
  };
  struct Allpass {
    DelayLine line;
    int delay = 0;
  };

  float fs_ = 48000;
  bool fresh_ = true;
  Comb combs_[2][kCombs];
  Allpass allpasses_[2][kAllpasses];
  DelayLine predelay_, echo_[2];
  OnePole echoLp_[2], echoHp_[2];
  int echoDelay_[2] = {0, 0};
  float predelayS_ = 0, size_ = 0.5f, decay_ = 1.8f, damp_ = 0.5f, mixS_ = 0, echoS_ = 0;
  Ramp mix_, echoMix_, echoFb_, dryR_;
  float wetBuf_[2][kChunk];
};

}  // namespace sa
