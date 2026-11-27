// First-order image-source early reflections of a shoebox room around the
// listener: six taps per ear, each panned with a level and time difference.
#pragma once

#include "hrtf.h"

namespace sa {

class EarlyReflections {
 public:
  static constexpr int kTaps = 6;

  void prepare(float fs);
  void reset();
  // srcMeters: source distance; roomSize 0..1; amount 0..1 (ROOM_DEPTH).
  void setTarget(const Dir& d, float srcMeters, float roomSize, float amount);
  // Accumulates into outL/outR.
  void process(const float* in, float* outL, float* outR, int n);
  // Keeps the line current while muted so re-enabling never replays stale audio.
  void feed(const float* in, int n);
  bool active() const;

 private:
  struct Tap {
    float delay[2] = {0, 0}, gain[2] = {0, 0};
  };
  float fs_ = 48000, lpCoef_ = 0;
  DelayLine line_;
  Tap cur_[kTaps], tgt_[kTaps];
  OnePole lp_[2];
};

}  // namespace sa
