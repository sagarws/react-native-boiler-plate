// Virtual 8-speaker surround bed (FL FR SL SR RL RR UL UR), each speaker
// rendered binaurally with the structural model at a fixed direction.
// Because the geometry never changes, every tap is precomputed, and the
// head-shadow and rear-shelf filters (linear, one pole shared by all
// directions) run once per ear on the summed speakers instead of per speaker.
#pragma once

#include "hrtf.h"
#include "params.h"

namespace sa {

class SpeakerBed {
 public:
  void prepare(float fs);
  void reset();
  // bedL/bedR feed the left/right speakers; gains are per-speaker ramps for
  // this block (idle ones are skipped). Accumulates into outL/outR.
  void process(const float* bedL, const float* bedR, const Ramp* gains, const Cues& cues, float* outL, float* outR, int n);

 private:
  static constexpr int kEchoes = kPinnaEchoes + 1;  // pinna + shoulder

  // Short delay + Schroeder allpass so rear/upper speakers don't fuse with the front.
  struct Decorrelator {
    DelayLine pre, ap;
    int delay = 0, apDelay = 0;
    float g = 0;
    float process(float x);
  };
  struct Speaker {
    Decorrelator deco;
    DelayLine in, itd;  // raw input (echo taps) / echo output (ITD taps)
    int echoInt[kEchoes];
    float echoFrac[kEchoes], echoGain[kEchoes];  // gains at unit cue strength
    int itdInt[2];
    float itdW[2][4];  // Hermite weights for taps itdInt-1 .. itdInt+2
    float b0[2], b1[2], rearCut[2], x1[2];
  };

  Speaker sp_[kSpeakers];
  HeadShadow shadow_;
  float rearCoef_ = 0;
  // Per ear: summed shadow outputs for the plain and the rear-cut share.
  float yPlain_[2] = {0, 0}, yRear_[2] = {0, 0};
  OnePole rearLp_[2];
  Cues applied_;  // cue strengths at the end of the last block (ramp start)
  bool primed_ = false;
  float u_[kChunk], plain_[2][kChunk], rear_[2][kChunk];
};

}  // namespace sa
