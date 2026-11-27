#include "spatial.h"

namespace sa {
namespace {

struct SpeakerSpec {
  float az, el;
  int side;  // 0 fed by input L, 1 by input R
  float delayMs, apMs, apGain;
};

// FL FR SL SR RL RR UL UR — the order of SPEAKER_0..7.
constexpr SpeakerSpec kSpeakerSpecs[kSpeakers] = {
    {-30, 0, 0, 0, 0, 0},          {30, 0, 1, 0, 0, 0},
    {-90, 0, 0, 0, 0, 0},          {90, 0, 1, 0, 0, 0},
    {-150, 0, 0, 7.1f, 4.3f, 0.5f}, {150, 0, 1, 8.3f, 5.1f, 0.5f},
    {-45, 45, 0, 2.3f, 3.1f, 0.4f}, {45, 45, 1, 2.9f, 3.7f, 0.4f},
};

// Battery saver keeps only FL/FR/RL/RR.
bool speakerInQuality(int s, int quality) { return quality >= 1 || s == 0 || s == 1 || s == 4 || s == 5; }

constexpr float kBedNorm = 0.4f;  // four mostly coherent speakers per side
constexpr float kStereoSpread = 30.f;
// Low-frequency interaural difference at +-90 degrees (+-4 dB per ear); 8
// rather than 6 so the swing still reaches +-5 dB under the default bed.
constexpr float kLowIldDb = 8.f;

EarParams withCues(const EarParams& base, const Cues& c) {
  EarParams e = base;
  for (float& g : e.pinnaGain) g *= c.pinna;
  e.shoulderGain *= c.shoulder;
  e.rearCut *= c.rear;
  return e;
}

// One-pole toward target that lands exactly, so idle checks can use == 0.
float approach(float cur, float target, float k) {
  cur += k * (target - cur);
  return std::fabs(target - cur) < 1e-4f ? target : cur;
}

}  // namespace

float SpatialStage::Decorrelator::process(float x) {
  if (delay == 0) return x;
  pre.write(x);
  // Schroeder allpass: w[n] = v[n] + g w[n-D], y[n] = -g w[n] + w[n-D].
  const float wd = ap.readInt(apDelay - 1);
  const float w = pre.readInt(delay) + g * wd;
  ap.write(w);
  return -g * w + wd;
}

void SpatialStage::prepare(float fs) {
  fs_ = fs;
  motion_.prepare(fs);
  for (BinauralVoice& v : voices_) v.prepare(fs);
  er_.prepare(fs);
  const Cues unit;
  for (int s = 0; s < kSpeakers; ++s) {
    speakers_[s].prepare(fs);
    const Dir d = dirFromAngles(kSpeakerSpecs[s].az, kSpeakerSpecs[s].el);
    computeEar(d, -1, fs, unit, speakerEars_[s][0]);
    computeEar(d, 1, fs, unit, speakerEars_[s][1]);
    Decorrelator& dc = deco_[s];
    dc.delay = int(kSpeakerSpecs[s].delayMs * 1e-3f * fs);
    dc.apDelay = int(kSpeakerSpecs[s].apMs * 1e-3f * fs);
    dc.g = kSpeakerSpecs[s].apGain;
    dc.pre.allocate(dc.delay + 4);
    dc.ap.allocate(dc.apDelay + 4);
  }
}

void SpatialStage::reset(const float* p) {
  clearAudio();
  motion_.reset(p);
  active_ = false;
  fresh_ = true;
}

void SpatialStage::clearAudio() {
  for (BinauralVoice& v : voices_) v.reset();
  for (BinauralVoice& v : speakers_) v.reset();
  for (Decorrelator& d : deco_) {
    d.pre.clear();
    d.ap.clear();
  }
  er_.reset();
  for (OnePole& f : air_) f.reset();
  for (OnePole& f : nearBass_) f.reset();
}

void SpatialStage::renderBed(const float* bedL, const float* bedR, float* outL, float* outR, int n, const Cues& cues) {
  for (int s = 0; s < kSpeakers; ++s) {
    if (speakerR_[s].idle()) continue;
    speakers_[s].setTarget(withCues(speakerEars_[s][0], cues), withCues(speakerEars_[s][1], cues));
    const float* src = kSpeakerSpecs[s].side == 0 ? bedL : bedR;
    // Gain first: an idle speaker's decorrelator then holds silence, not a stale signal.
    for (int i = 0; i < n; ++i) bufA_[i] = deco_[s].process(speakerR_[s].at(i) * src[i]);
    speakers_[s].process(bufA_, outL, outR, n);
  }
}

void SpatialStage::process(float* L, float* R, float* send, int n, const float* p) {
  const bool on = p[kEnabled] > 0.5f;
  if (!active_ && !on) {
    for (int i = 0; i < n; ++i) send[i] = 0.5f * (L[i] + R[i]);
    return;
  }
  if (active_ && !on && enable_.end == 0.f) {
    // Fully faded out: drop to bypass and forget the old position's state.
    active_ = false;
    clearAudio();
    for (int i = 0; i < n; ++i) send[i] = 0.5f * (L[i] + R[i]);
    return;
  }
  // Geometry and levels start at their targets whenever the stage (re)starts;
  // the wet/dry mix still fades in unless this is the first block after reset.
  const bool snap = !active_;
  const float k = snap ? 1.f : blockCoef(0.03f, n, fs_);
  if (snap) {
    enable_ = Ramp(fresh_ ? 1.f : 0.f);
    wet_ = Ramp(fresh_ ? p[kHrtf] : 0.f);
    hrtf_ = p[kHrtf];
    active_ = true;
  }
  fresh_ = false;

  const int quality = int(p[kQuality] + 0.5f);
  const int mode = int(p[kSourceMode] + 0.5f);
  const float enable = approach(enable_.end, on ? 1.f : 0.f, blockCoef(0.03f, n, fs_));
  hrtf_ = approach(hrtf_, p[kHrtf], k);
  enable_.to(enable, n, false);
  wet_.to(enable * hrtf_, n, false);
  stereo_ = approach(stereo_, mode == 1 ? 1.f : 0.f, k);
  ambience_ = approach(ambience_, mode == 2 ? 1.f : 0.f, k);
  surround_ = approach(surround_, p[kSurround], k);
  pinna_ = approach(pinna_, quality >= 1 ? 1.f : 0.f, k);
  frontRear_ = approach(frontRear_, p[kFrontRear], k);
  room_ = approach(room_, quality >= 1 ? p[kRoomDepth] : 0.f, k);
  // Milder in mode 2, where the moving source is the vocal and the ambience is static.
  lowIld_ = approach(lowIld_, mode == 2 ? 0.5f : 1.f, k);
  for (int s = 0; s < kSpeakers; ++s) {
    speaker_[s] = approach(speaker_[s], speakerInQuality(s, quality) ? p[kSpeaker0 + s] : 0.f, k);
    speakerR_[s].to(speaker_[s] * kBedNorm, n, snap);
  }

  pos_ = motion_.advance(n, p);
  // DISTANCE 0..1 maps to 0.25..10 m on a log scale.
  const float meters = 0.25f * std::pow(40.f, pos_.dist);
  const float nearField = clampf((1.f - meters) / 0.75f, 0.f, 1.f);
  const float airHz = 20000.f * std::exp(-1.5f * std::pow(pos_.dist, 1.5f));
  // Inverse-distance gain, capped at +6 dB so extremely near never blows up.
  gainR_.to(1.f / std::fmax(meters, 0.5f), n, snap);
  airR_.to(onePoleCoef(airHz, fs_), n, snap);
  nearR_.to(dbToGain(6.f * nearField) - 1.f, n, snap);
  sendR_.to(0.4f + 1.2f * pos_.dist, n, snap);
  stereoR_.to(stereo_, n, snap);
  ambienceR_.to(ambience_, n, snap);
  surroundR_.to(surround_, n, snap);
  sourceR_.to(1.f - 0.35f * surround_, n, snap);

  // The fixed speakers keep the plain model; only moving sources get the low ILD.
  const Cues cues{pinna_ * frontRear_, frontRear_, pinna_, 0.35f * nearField, 0.f};
  Cues moving = cues;
  moving.lowIldDb = kLowIldDb * lowIld_ * hrtf_;
  const float spread = kStereoSpread * stereo_;
  EarParams el, er;
  computeEar(rotateAzimuth(pos_.dir, -spread), -1, fs_, moving, el);
  computeEar(rotateAzimuth(pos_.dir, -spread), 1, fs_, moving, er);
  voices_[0].setTarget(el, er);
  const bool second = !stereoR_.idle();
  if (second) {
    computeEar(rotateAzimuth(pos_.dir, spread), -1, fs_, moving, el);
    computeEar(rotateAzimuth(pos_.dir, spread), 1, fs_, moving, er);
    voices_[1].setTarget(el, er);
  }
  // Room size moves the image delays; glide it so the taps bend, not jump.
  roomSize_ = approach(roomSize_, p[kRoomSize], snap ? 1.f : blockCoef(0.3f, n, fs_));
  er_.setTarget(pos_.dir, meters, roomSize_, room_);

  const float bassCoef = onePoleCoef(200.f, fs_);
  for (int i = 0; i < n; ++i) {
    const float m = 0.5f * (L[i] + R[i]);
    const float ws = stereoR_.at(i), ac = airR_.at(i), nb = nearR_.at(i);
    const float g = gainR_.at(i) * sourceR_.at(i);
    float a = air_[0].lp(m + ws * (L[i] - m), ac);
    bufA_[i] = g * (a + nb * nearBass_[0].lp(a, bassCoef));
    if (second) {
      const float b = air_[1].lp(ws * R[i], ac);
      bufB_[i] = g * (b + nb * nearBass_[1].lp(b, bassCoef));
    }
    bufM_[i] = air_[2].lp(m, ac);
    send[i] = bufM_[i] * sendR_.at(i);
    binL_[i] = binR_[i] = 0.f;
  }
  voices_[0].process(bufA_, binL_, binR_, n);
  if (second) voices_[1].process(bufB_, binL_, binR_, n);
  if (er_.active()) er_.process(bufM_, binL_, binR_, n);
  else er_.feed(bufM_, n);

  if (!surroundR_.idle() || !ambienceR_.idle()) {
    // Mode 2 sends the side (ambience) signal through the bed regardless of SURROUND.
    for (int i = 0; i < n; ++i) {
      const float sr = surroundR_.at(i), am = ambienceR_.at(i), side = 0.5f * (L[i] - R[i]);
      bedL_[i] = sr * L[i] + am * side;
      bedR_[i] = sr * R[i] - am * side;
    }
    renderBed(bedL_, bedR_, binL_, binR_, n, cues);
  }

  for (int i = 0; i < n; ++i) {
    const float w = wet_.at(i), e = enable_.at(i);
    send[i] = e * send[i] + (1.f - e) * 0.5f * (L[i] + R[i]);
    L[i] += w * (binL_[i] - L[i]);
    R[i] += w * (binR_[i] - R[i]);
  }
}

}  // namespace sa
