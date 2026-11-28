// The 8D stage: moving binaural source(s), distance model, early
// reflections and the virtual 8-speaker surround bed, blended against the
// original stereo by HRTF strength.
#pragma once

#include "bed.h"
#include "hrtf.h"
#include "motion.h"
#include "room.h"

namespace sa {

class SpatialStage {
 public:
  void prepare(float fs);
  // p: current parameter targets (used to start without ramps).
  void reset(const float* p);
  // L/R are processed in place; send receives the mono reverb send.
  void process(float* L, float* R, float* send, int n, const float* p);
  const Position& position() const { return pos_; }

 private:
  // Drops all audio history (delay lines, filters) but keeps the motion.
  void clearAudio();

  float fs_ = 48000;
  bool active_ = false;
  bool fresh_ = true;  // just reset: start at the targets without fades
  Motion motion_;
  Position pos_;
  BinauralVoice voices_[2];
  SpeakerBed bed_;
  EarlyReflections er_;
  OnePole air_[3], nearBass_[2];  // [0..1] voices, [2] mono send / reflections

  // Block-smoothed controls.
  float hrtf_ = 1, lowIld_ = 1, roomSize_ = 0.5f, stereo_ = 0, ambience_ = 0, surround_ = 0, pinna_ = 1, frontRear_ = 0.7f, room_ = 0;
  float speaker_[kSpeakers] = {};
  // Per-sample ramps.
  Ramp wet_, enable_, stereoR_, ambienceR_, surroundR_, sourceR_, gainR_, airR_, nearR_, sendR_;
  Ramp speakerR_[kSpeakers];

  float bufA_[kChunk], bufB_[kChunk], bufM_[kChunk], binL_[kChunk], binR_[kChunk], bedL_[kChunk], bedR_[kChunk];
};

}  // namespace sa
