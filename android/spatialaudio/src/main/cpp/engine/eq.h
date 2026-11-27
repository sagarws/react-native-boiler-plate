// Preamp, 10-band graphic EQ, bass (shelf + harmonic enrichment), treble
// shelf and vocal presence. Gains glide in dB and coefficients are
// redesigned only while a gain is still moving.
#pragma once

#include "dsp.h"
#include "params.h"

namespace sa {

class Equalizer {
 public:
  void prepare(float fs);
  // p: parameter targets; the first block after reset starts at them.
  void reset(const float* p);
  void process(float* L, float* R, int n, const float* p);

 private:
  enum Kind { kPeak, kLowShelf, kHighShelf };
  struct Band {
    Kind kind = kPeak;
    float f0 = 1000, q = 1.4f;
    float cur = 0, designed = 0;
    bool active = false;
    BiquadCoefs c;
    BiquadState s[2];
  };
  static constexpr int kFilters = kEqBands + 4;  // + bass, treble, presence, low-mid cut

  void update(Band& b, float targetDb, float k);

  float fs_ = 48000;
  bool fresh_ = true;
  Band bands_[kFilters];
  float preampDb_ = 0, harmonic_ = 0;
  Ramp preamp_{1.f}, harmonicR_;
  BiquadCoefs hLow_, hHigh_, hTop_;
  BiquadState hLowS_, hHighS_, hTopS_;
};

}  // namespace sa
