#include "reverb.h"

#include "params.h"

namespace sa {
namespace {

// Freeverb tunings at 44.1 kHz; the right channel is offset by the stereo spread.
constexpr int kCombTuning[Reverb::kCombs] = {1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617};
constexpr int kAllpassTuning[Reverb::kAllpasses] = {556, 441, 341, 225};
constexpr int kStereoSpread = 23;
constexpr float kAllpassFeedback = 0.5f;
constexpr float kScaleDamp = 0.4f;
constexpr float kMaxSizeScale = 1.4f;
constexpr float kEchoSeconds[2] = {0.33f, 0.375f};  // tempo-free, slightly different per side

float approach(float cur, float target, float k) {
  cur += k * (target - cur);
  return std::fabs(target - cur) < 1e-5f ? target : cur;
}

}  // namespace

void Reverb::prepare(float fs) {
  fs_ = fs;
  const float scale = fs / 44100.f;
  for (int c = 0; c < 2; ++c) {
    for (int k = 0; k < kCombs; ++k) {
      Comb& cb = combs_[c][k];
      cb.base = float(kCombTuning[k] + c * kStereoSpread) * scale;
      cb.line.allocate(int(cb.base * kMaxSizeScale) + 4);
    }
    for (int k = 0; k < kAllpasses; ++k) {
      Allpass& ap = allpasses_[c][k];
      ap.delay = int(float(kAllpassTuning[k] + c * kStereoSpread) * scale);
      ap.line.allocate(ap.delay + 4);
    }
    echoDelay_[c] = int(kEchoSeconds[c] * fs);
    echo_[c].allocate(echoDelay_[c] + 4);
  }
  predelay_.allocate(int(0.1f * fs) + 4);
}

void Reverb::reset(const float* p) {
  for (auto& side : combs_)
    for (Comb& cb : side) {
      cb.line.clear();
      cb.store = 0;
    }
  for (auto& side : allpasses_)
    for (Allpass& ap : side) ap.line.clear();
  predelay_.clear();
  for (int c = 0; c < 2; ++c) {
    echo_[c].clear();
    echoLp_[c].reset();
    echoHp_[c].reset();
  }
  size_ = p[kRoomSize];
  decay_ = p[kReverbDecay];
  damp_ = p[kReverbDamp];
  predelayS_ = p[kPredelay] * 1e-3f * fs_;
  mixS_ = p[kReverbMix];
  echoS_ = p[kEcho];
  for (int c = 0; c < 2; ++c)
    for (Comb& cb : combs_[c]) cb.delay = cb.base * (0.6f + 0.8f * size_);
  fresh_ = true;
}

void Reverb::process(float* L, float* R, const float* send, int n, const float* p) {
  const bool snap = fresh_;
  fresh_ = false;
  // Lengths glide slowly (a brief pitch bend of the tail instead of a jump).
  const float kSlow = snap ? 1.f : blockCoef(0.6f, n, fs_);
  const float kFast = snap ? 1.f : blockCoef(0.05f, n, fs_);
  size_ = approach(size_, p[kRoomSize], kSlow);
  const float predelayStart = predelayS_;
  predelayS_ = approach(predelayS_, p[kPredelay] * 1e-3f * fs_, kSlow);
  const float predelayStep = (predelayS_ - predelayStart) / float(n);
  decay_ = approach(decay_, p[kReverbDecay], kFast);
  damp_ = approach(damp_, p[kReverbDamp], kFast);
  mixS_ = approach(mixS_, p[kReverbMix], kFast);
  echoS_ = approach(echoS_, p[kEcho], kFast);
  mix_.to(mixS_, n, snap);
  dryR_.to(1.f - 0.3f * mixS_, n, snap);
  echoMix_.to(0.45f * echoS_, n, snap);
  echoFb_.to(0.2f + 0.4f * echoS_, n, snap);

  const bool saver = p[kQuality] < 0.5f;
  const float d = damp_ * kScaleDamp;
  float gain[2][kCombs], norm[2][kCombs], delayStep[2][kCombs];
  for (int c = 0; c < 2; ++c)
    for (int k = 0; k < kCombs; ++k) {
      Comb& cb = combs_[c][k];
      delayStep[c][k] = (cb.base * (0.6f + 0.8f * size_) - cb.delay) / float(n);
      // Feedback from the requested RT60: -60 dB after decay_ seconds.
      gain[c][k] = std::pow(10.f, -3.f * (cb.delay + delayStep[c][k] * float(n)) / (fs_ * decay_));
      const bool on = !saver || (k & 1) == 0;
      const float level = approach(cb.level, on ? (saver ? 1.41421356f : 1.f) : 0.f, kFast);
      if (level == 0.f && cb.level != 0.f) {  // just faded out: drop its stale tail
        cb.line.clear();
        cb.store = 0;
      }
      cb.level = level;
      if (level == 0.f) {  // skipped this block: jump its length instead of gliding
        cb.delay += delayStep[c][k] * float(n);
        delayStep[c][k] = 0;
      }
      // Partial energy normalisation keeps long decays from swamping the mix.
      norm[c][k] = level * std::sqrt(std::sqrt(1.f - gain[c][k] * gain[c][k])) * 0.35f;
    }

  const bool wetIdle = mix_.idle();
  for (int i = 0; i < n; ++i) {
    predelay_.write(send[i]);
    const float x = predelay_.readLinear(predelayStart + predelayStep * float(i + 1)) * 0.5f;
    for (int c = 0; c < 2; ++c) {
      float acc = 0;
      for (int k = 0; k < kCombs; ++k) {
        Comb& cb = combs_[c][k];
        if (cb.level == 0.f) continue;
        cb.delay += delayStep[c][k];
        const float out = cb.line.readLinear(cb.delay - 1.f);
        cb.store = out * (1.f - d) + cb.store * d;
        cb.line.write(x + cb.store * gain[c][k]);
        acc += out * norm[c][k];
      }
      for (Allpass& ap : allpasses_[c]) {
        const float bo = ap.line.readInt(ap.delay - 1);
        ap.line.write(acc + bo * kAllpassFeedback);
        acc = bo - acc;
      }
      wetBuf_[c][i] = acc;
    }
  }

  const float hpC = onePoleCoef(150.f, fs_), lpC = onePoleCoef(3500.f, fs_);
  for (int i = 0; i < n; ++i) {
    const float oL = echo_[0].readInt(echoDelay_[0] - 1), oR = echo_[1].readInt(echoDelay_[1] - 1);
    // Band-limited feedback so repeats darken and thin out like tape.
    const float fL = echoLp_[0].lp(oL - echoHp_[0].lp(oL, hpC), lpC);
    const float fR = echoLp_[1].lp(oR - echoHp_[1].lp(oR, hpC), lpC);
    const float fb = echoFb_.at(i);
    echo_[0].write(0.7f * L[i] + fb * fR);  // ping-pong
    echo_[1].write(0.7f * R[i] + fb * fL);
    const float dry = dryR_.at(i), wet = wetIdle ? 0.f : mix_.at(i), em = echoMix_.at(i);
    L[i] = dry * L[i] + wet * wetBuf_[0][i] + em * oL;
    R[i] = dry * R[i] + wet * wetBuf_[1][i] + em * oR;
  }
}

}  // namespace sa
