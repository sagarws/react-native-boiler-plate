// Top-level engine behind SpatialEngine.kt: input conversion, then
// EQ -> 8D spatial stage -> width -> reverb/echo -> tone/dynamics -> limiter.
// setParams/reset/state are safe from any thread while process() runs on the
// audio thread; process() never locks or allocates.
#pragma once

#include <atomic>

#include "dynamics.h"
#include "eq.h"
#include "params.h"
#include "reverb.h"
#include "spatial.h"

namespace sa {

constexpr int kStateCount = 6;  // azimuth, elevation, distance, peakL, peakR, gainReductionDb

// Triple buffer: the writer fills a private slot and swaps it into the shared
// middle slot; the reader swaps the middle out only when it is marked dirty.
class ParamHandoff {
 public:
  ParamHandoff();
  void write(const float* p, int n);  // any thread
  bool read(float* dst);              // audio thread only

 private:
  static constexpr int kDirty = 4;
  float slots_[3][kParamCount];
  float latest_[kParamCount];  // writer side, so a short array keeps the rest
  std::atomic<int> middle_{1};
  int back_ = 2;   // owned by the writer
  int front_ = 0;  // owned by the reader
  // Serialises concurrent writers only; the audio thread never touches it.
  std::atomic_flag writerBusy_ = ATOMIC_FLAG_INIT;
};

class Engine {
 public:
  explicit Engine(int sampleRate);
  void setParams(const float* p, int n);
  // in/out: interleaved 16-bit PCM or 32-bit float; output is always stereo.
  // in == out is allowed when inChannels == 2.
  void process(const void* in, int inChannels, void* out, int frames, bool isFloat);
  // Clears every delay line and tail before the next processed block.
  void reset() { resetPending_.store(true, std::memory_order_release); }
  void state(float* out, int n) const;

 private:
  void doReset();
  void render(int n);

  float fs_;
  ParamHandoff handoff_;
  float p_[kParamCount];
  std::atomic<bool> resetPending_{false};
  Equalizer eq_;
  SpatialStage spatial_;
  Reverb reverb_;
  ToneDynamics tone_;
  Limiter limiter_;
  float widthS_ = 1;
  Ramp width_{1.f};
  bool fresh_ = true;
  float L_[kChunk], R_[kChunk], send_[kChunk];
  float peakL_ = 0, peakR_ = 0, grDb_ = 0;
  std::atomic<float> state_[kStateCount];
};

}  // namespace sa
