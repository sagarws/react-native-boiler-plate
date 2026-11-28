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
  clearWet();
  clearEcho();
  wetOn_ = echoOn_ = false;
  size_ = size1_ = p[kRoomSize];
  decay_ = p[kReverbDecay];
  damp_ = p[kReverbDamp];
  predelayS_ = predelay1_ = p[kPredelay] * 1e-3f * fs_;
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
  const float kSlow = snap ? 1.f : blockCoef(0.3f, n, fs_);
  const float kFast = snap ? 1.f : blockCoef(0.05f, n, fs_);
  size1_ = approach(size1_, p[kRoomSize], kSlow);
  size_ = approach(size_, size1_, kSlow);
  const float predelayStart = predelayS_;
  predelay1_ = approach(predelay1_, p[kPredelay] * 1e-3f * fs_, kSlow);
  predelayS_ = approach(predelayS_, predelay1_, kSlow);
  const float predelayStep = (predelayS_ - predelayStart) / float(n);
  decay_ = approach(decay_, p[kReverbDecay], kFast);
  damp_ = approach(damp_, p[kReverbDamp], kFast);
  mixS_ = approach(mixS_, p[kReverbMix], kFast);
  echoS_ = approach(echoS_, p[kEcho], kFast);
  mix_.to(mixS_, n, snap);
  dryR_.to(1.f - 0.3f * mixS_, n, snap);
  echoMix_.to(0.45f * echoS_, n, snap);
  echoFb_.to(0.2f + 0.4f * echoS_, n, snap);

  wetOn_ = updateSleep(wetOn_, mixS_ != 0.f || p[kReverbMix] != 0.f, wetWake_, n, [this] { clearWet(); });
  echoOn_ = updateSleep(echoOn_, echoS_ != 0.f || p[kEcho] != 0.f, echoWake_, n, [this] { clearEcho(); });
  if (wetOn_) renderWet(send, n, p[kQuality] < 0.5f, kFast, predelayStart, predelayStep);

  if (!echoOn_) {
    if (!wetOn_) {
      if (!dryR_.unity())
        for (int i = 0; i < n; ++i) {
          L[i] *= dryR_.at(i);
          R[i] *= dryR_.at(i);
        }
      return;
    }
    for (int i = 0; i < n; ++i) {
      const float dry = dryR_.at(i), wet = mix_.at(i);
      L[i] = dry * L[i] + wet * wetBuf_[0][i];
      R[i] = dry * R[i] + wet * wetBuf_[1][i];
    }
    return;
  }
  const float hpC = onePoleCoef(150.f, fs_), lpC = onePoleCoef(3500.f, fs_);
  for (int i = 0; i < n; ++i) {
    const float oL = echo_[0].readInt(echoDelay_[0] - 1), oR = echo_[1].readInt(echoDelay_[1] - 1);
    // Band-limited feedback so repeats darken and thin out like tape.
    const float fL = echoLp_[0].lp(oL - echoHp_[0].lp(oL, hpC), lpC);
    const float fR = echoLp_[1].lp(oR - echoHp_[1].lp(oR, hpC), lpC);
    const float fb = echoFb_.at(i);
    const float in = 0.7f * echoWake_.at(i);
    echo_[0].write(in * L[i] + fb * fR);  // ping-pong
    echo_[1].write(in * R[i] + fb * fL);
    const float dry = dryR_.at(i), wet = wetOn_ ? mix_.at(i) : 0.f, em = echoMix_.at(i);
    L[i] = dry * L[i] + (wetOn_ ? wet * wetBuf_[0][i] : 0.f) + em * oL;
    R[i] = dry * R[i] + (wetOn_ ? wet * wetBuf_[1][i] : 0.f) + em * oR;
  }
}

void Reverb::clearWet() {
  for (auto& side : combs_)
    for (Comb& cb : side) {
      cb.line.clear();
      cb.store = 0;
    }
  for (auto& side : allpasses_)
    for (Allpass& ap : side) ap.line.clear();
  predelay_.clear();
}

void Reverb::clearEcho() {
  for (int c = 0; c < 2; ++c) {
    echo_[c].clear();
    echoLp_[c].reset();
    echoHp_[c].reset();
  }
}

void Reverb::renderWet(const float* send, int n, bool saver, float kFast, float predelayStart, float predelayStep) {
  const float d = damp_ * kScaleDamp;
  for (int i = 0; i < n; ++i) {
    predelay_.write(send[i] * wetWake_.at(i));  // fade before the pre-delay, whose line starts empty
    in_[i] = predelay_.readLinear(predelayStart + predelayStep * float(i + 1)) * 0.5f;
  }
  // Comb by comb over the block (every delay is longer than a block, so no
  // sample written here is read back within it): same result as sample by
  // sample, far better locality.
  for (int c = 0; c < 2; ++c) {
    float* acc = wetBuf_[c];
    for (int i = 0; i < n; ++i) acc[i] = 0.f;
    for (int k = 0; k < kCombs; ++k) {
      Comb& cb = combs_[c][k];
      const float target = cb.base * (0.6f + 0.8f * size_);
      const bool on = !saver || (k & 1) == 0;
      const float level = approach(cb.level, on ? (saver ? 1.41421356f : 1.f) : 0.f, kFast);
      if (level == 0.f) {
        if (cb.level != 0.f) {  // just faded out: drop its stale tail
          cb.line.clear();
          cb.store = 0;
        }
        cb.level = 0.f;
        cb.delay = target;
        continue;
      }
      cb.level = level;
      const float step = (target - cb.delay) / float(n);
      if (cb.gainDecay != decay_ || cb.gainDelay != target) {
        // Feedback from the requested RT60: -60 dB after decay_ seconds.
        cb.gain = std::pow(10.f, -3.f * target / (fs_ * decay_));
        // Partial energy normalisation keeps long decays from swamping the mix.
        cb.norm = std::sqrt(std::sqrt(1.f - cb.gain * cb.gain)) * 0.35f;
        cb.gainDecay = decay_;
        cb.gainDelay = target;
      }
      const float g = cb.gain, nm = cb.norm * level;
      float store = cb.store;
      if (step == 0.f) {
        // Static length: the fractional split is the same for every sample.
        const int di = int(cb.delay - 1.f);
        const float f = cb.delay - 1.f - float(di);
        for (int i = 0; i < n; ++i) {
          const float x0 = cb.line.readInt(di);
          const float out = x0 + f * (cb.line.readInt(di + 1) - x0);
          store = out * (1.f - d) + store * d;
          cb.line.write(in_[i] + store * g);
          acc[i] += out * nm;
        }
      } else {
        for (int i = 0; i < n; ++i) {
          cb.delay += step;
          const float out = cb.line.readLinear(cb.delay - 1.f);
          store = out * (1.f - d) + store * d;
          cb.line.write(in_[i] + store * g);
          acc[i] += out * nm;
        }
        cb.delay = target;
      }
      cb.store = store;
    }
    for (Allpass& ap : allpasses_[c])
      for (int i = 0; i < n; ++i) {
        const float bo = ap.line.readInt(ap.delay - 1);
        ap.line.write(acc[i] + bo * kAllpassFeedback);
        acc[i] = bo - acc[i];
      }
  }
}

}  // namespace sa
