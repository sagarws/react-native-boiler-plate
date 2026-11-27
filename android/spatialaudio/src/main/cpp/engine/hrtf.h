// Structural binaural model after C. P. Brown & R. O. Duda, "A structural
// model for binaural sound synthesis", IEEE Trans. Speech and Audio
// Processing 6(5), 1998: per ear a fractional ITD delay, a one-pole/one-zero
// head-shadow filter and a five-echo pinna model, plus a shoulder echo and a
// rear high-frequency shadow. No measured HRIR data is needed.
#pragma once

#include "dsp.h"

namespace sa {

// Unit direction: x front, y right, z up.
struct Dir {
  float x = 1, y = 0, z = 0;
};
Dir dirFromAngles(float azDeg, float elDeg);
Dir rotateAzimuth(const Dir& d, float deg);
float azimuthDeg(const Dir& d);
float elevationDeg(const Dir& d);

constexpr int kPinnaEchoes = 5;

struct EarParams {
  float delay = 1;    // samples on the direct path (>= 1 for the Hermite tap)
  float alpha = 1;    // head-shadow zero: 2 = +6 dB facing the ear, 0.1 = shadowed
  float gain = 1;     // near-field ILD
  float lowGain = 1;  // extra level below ~1.2 kHz (low-frequency ILD)
  float rearCut = 0;  // share of the high band removed for rear sources
  float pinnaDelay[kPinnaEchoes] = {};  // samples, relative to `delay`
  float pinnaGain[kPinnaEchoes] = {};
  float shoulderDelay = 0;
  float shoulderGain = 0;
};

// Cue strengths applied on top of the geometric model.
struct Cues {
  float pinna = 1;     // pinna echo amplitude (FRONT_REAR x quality)
  float rear = 1;      // rear shadow amount (FRONT_REAR)
  float shoulder = 1;  // shoulder echo (quality)
  float ildBoost = 0;  // extra near-field level difference, 0..~0.4
  float lowIldDb = 0;  // interaural level difference below ~1.2 kHz at +-90 degrees
};

// ear: -1 left, +1 right.
void computeEar(const Dir& d, int ear, float fs, const Cues& cues, EarParams& out);

// Renders one mono source to both ears; geometry targets are ramped per
// sample across each process() call so motion is click-free.
class BinauralVoice {
 public:
  void prepare(float fs);
  void reset();
  void setTarget(const EarParams& left, const EarParams& right);
  // Accumulates into outL/outR.
  void process(const float* in, float* outL, float* outR, int n);

 private:
  struct Ear {
    EarParams cur, tgt;
    float x1 = 0, y1 = 0;  // head-shadow filter state
    OnePole rear, low;
  };
  DelayLine line_;
  Ear ears_[2];
  float k_ = 0, beta_ = 0, a1_ = 0, inv_ = 0, rearCoef_ = 0, lowCoef_ = 0;
  bool primed_ = false;
};

}  // namespace sa
