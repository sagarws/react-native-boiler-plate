// Animated source position: base AZIMUTH/ELEVATION/DISTANCE plus a movement
// pattern driven by a continuous phase accumulator, so RPM or pattern changes
// never make the source jump.
#pragma once

#include "hrtf.h"
#include "params.h"

namespace sa {

struct Position {
  float az = 0;      // degrees, -180..180
  float el = 0;      // degrees
  float dist = 0.4f; // DISTANCE units, 0 near .. 1 far
  Dir dir;
};

class Motion {
 public:
  void prepare(float fs) { fs_ = fs; }
  // Jumps straight to the parameter targets (after create / reset).
  void reset(const float* p);
  // Advances by n samples and returns the position at the end of the block.
  Position advance(int n, const float* p);

 private:
  struct Offset {
    float az, el;
  };
  Offset offset(int pattern) const;
  Dir pathDir(int pattern) const;

  float fs_ = 48000;
  float baseAz_ = 0, baseEl_ = 0, dist_ = 0.4f, rpm_ = 0, intensity_ = 1;
  double phase_ = 0;
  int pattern_ = 0, fromPattern_ = 0;
  float blend_ = 1;  // 0..1 progress of a pattern change cross-fade
  bool fromFrozen_ = false;
  Dir frozen_, last_;
  Offset randPrev_{0, 0}, randNext_{0, 0};  // unit random targets for kRandom3d
  Lcg rng_;
};

}  // namespace sa
