#include "dynamics.h"

namespace sa {
namespace {

float approach(float cur, float target, float k) {
  cur += k * (target - cur);
  return std::fabs(target - cur) < 1e-5f ? target : cur;
}

float powDb(float pw) { return 10.f * std::log10(pw + 1e-12f); }

}  // namespace

void ToneDynamics::prepare(float fs) {
  fs_ = fs;
  dcCoef_ = onePoleCoef(5.f, fs);
  warmLowCoef_ = onePoleCoef(250.f, fs);
  warmHighCoef_ = onePoleCoef(6000.f, fs);
  harshBp_ = designBandPass(fs, 6700.f, 0.9f);  // ~5-9 kHz
  envCoef_ = onePoleCoef(1.f / (kTwoPi * 0.01f), fs);
  rmsCoef_ = envCoef_;
  loudCoef_ = onePoleCoef(1.f / (kTwoPi * 0.3f), fs);
  loudLowCoef_ = onePoleCoef(120.f, fs);
  loudHighCoef_ = onePoleCoef(10000.f, fs);
}

void ToneDynamics::reset(const float* p) {
  for (int c = 0; c < 2; ++c) {
    dc_[c].reset();
    warmLp_[c].reset();
    warmHp_[c].reset();
    harshSt_[c].reset();
    smoothLp_[c][0].reset();
    smoothLp_[c][1].reset();
    loudLp_[c].reset();
    loudHp_[c].reset();
  }
  bandPow_ = fullPow_ = compPow_ = 0;
  compGainDb_ = 0;
  loudPow_ = 0;
  warmAmt_ = p[kWarmth];
  harshAmt_ = p[kHarshness];
  smoothAmt_ = p[kSmoothing];
  compAmt_ = p[kCompressor];
  loudAmt_ = p[kLoudness];
  outDb_ = p[kOutput];
  fresh_ = true;
}

void ToneDynamics::process(float* L, float* R, int n, const float* p) {
  const bool snap = fresh_;
  fresh_ = false;
  const float k = snap ? 1.f : blockCoef(0.05f, n, fs_);
  warmAmt_ = approach(warmAmt_, p[kWarmth], k);
  harshAmt_ = approach(harshAmt_, p[kHarshness], k);
  smoothAmt_ = approach(smoothAmt_, p[kSmoothing], k);
  compAmt_ = approach(compAmt_, p[kCompressor], k);
  loudAmt_ = approach(loudAmt_, p[kLoudness], k);
  outDb_ = approach(outDb_, p[kOutput], k);

  // Warmth: asymmetric soft saturation (even + odd harmonics) and a gentle
  // low-mid lift / top roll-off.
  warmMix_.to(0.5f * warmAmt_, n, snap);
  warmLow_.to(dbToGain(2.f * warmAmt_) - 1.f, n, snap);
  warmHigh_.to(1.f - dbToGain(-1.5f * warmAmt_), n, snap);
  if (!warmMix_.idle()) {
    for (int i = 0; i < n; ++i) {
      const float m = warmMix_.at(i), drive = 1.f + 6.f * m, bias = 0.3f * m;
      const float lo = warmLow_.at(i), hi = warmHigh_.at(i), off = softClip(bias);
      float* ch[2] = {L, R};
      for (int c = 0; c < 2; ++c) {
        float x = ch[c][i];
        x += m * ((softClip(drive * x + bias) - off) / drive - x);
        x -= dc_[c].lp(x, dcCoef_);  // the bias adds DC
        x += lo * warmLp_[c].lp(x, warmLowCoef_);
        x -= hi * (x - warmHp_[c].lp(x, warmHighCoef_));
        ch[c][i] = x;
      }
    }
  } else {
    for (int c = 0; c < 2; ++c) {
      dc_[c].reset();
      warmLp_[c].reset();
      warmHp_[c].reset();
    }
  }

  // Harshness: cut depth follows how much 5-9 kHz energy stands out.
  if (harshAmt_ > 0.f || !harsh_.idle()) {
    const float ratioDb = powDb(bandPow_) - powDb(fullPow_);
    harsh_.to(harshAmt_ * 0.7f * clampf((ratioDb + 18.f) / 12.f, 0.f, 1.f), n, snap);
    for (int i = 0; i < n; ++i) {
      const float bl = harshSt_[0].process(harshBp_, L[i]), br = harshSt_[1].process(harshBp_, R[i]);
      bandPow_ += envCoef_ * (0.5f * (bl * bl + br * br) - bandPow_);
      fullPow_ += envCoef_ * (0.5f * (L[i] * L[i] + R[i] * R[i]) - fullPow_);
      const float c = harsh_.at(i);
      L[i] -= c * bl;
      R[i] -= c * br;
    }
  } else {
    harshSt_[0].reset();
    harshSt_[1].reset();
    bandPow_ = fullPow_ = 0;
  }

  // Smoothing: 18 kHz -> 9 kHz low-pass, faded in over the first 10 %.
  smoothMix_.to(clampf(smoothAmt_ * 10.f, 0.f, 1.f), n, snap);
  smoothCoef_.to(onePoleCoef(clampf(18000.f - 9000.f * smoothAmt_, 1000.f, 0.45f * fs_), fs_), n, snap);
  if (!smoothMix_.idle()) {
    for (int i = 0; i < n; ++i) {
      const float m = smoothMix_.at(i), c = smoothCoef_.at(i);
      L[i] += m * (smoothLp_[0][1].lp(smoothLp_[0][0].lp(L[i], c), c) - L[i]);
      R[i] += m * (smoothLp_[1][1].lp(smoothLp_[1][0].lp(R[i], c), c) - R[i]);
    }
  }

  // Compressor: threshold -10..-30 dB, ratio 1..6, 6 dB soft knee, auto makeup.
  if (compAmt_ > 0.f || !compGain_.unity()) {
    const float thr = -10.f - 20.f * compAmt_, ratio = 1.f + 5.f * compAmt_, knee = 6.f;
    const float over = powDb(compPow_) - thr, slope = 1.f / ratio - 1.f;
    float gr = 0;
    if (2.f * over > knee) gr = slope * over;
    else if (2.f * over > -knee) gr = slope * (over + 0.5f * knee) * (over + 0.5f * knee) / (2.f * knee);
    const float tau = gr < compGainDb_ ? 0.01f : 0.15f;
    compGainDb_ += blockCoef(tau, n, fs_) * (gr - compGainDb_);
    const float makeup = -thr * (1.f - 1.f / ratio) * 0.5f;
    compGain_.to(dbToGain(compGainDb_ + makeup), n, snap);
    for (int i = 0; i < n; ++i) {
      compPow_ += rmsCoef_ * (0.5f * (L[i] * L[i] + R[i] * R[i]) - compPow_);
      const float g = compGain_.at(i);
      L[i] *= g;
      R[i] *= g;
    }
  } else {
    compPow_ = 0;
    compGainDb_ = 0;
  }

  // Loudness: more bass/treble lift the quieter the programme is.
  if (loudAmt_ > 0.f || !loudLow_.idle()) {
    const float quiet = clampf((-12.f - powDb(loudPow_)) / 30.f, 0.f, 1.f);
    const float lowDb = loudAmt_ * (3.f + 6.f * quiet);
    loudLow_.to(dbToGain(lowDb) - 1.f, n, snap);
    loudHigh_.to(dbToGain(0.5f * lowDb) - 1.f, n, snap);
    for (int i = 0; i < n; ++i) {
      loudPow_ += loudCoef_ * (0.5f * (L[i] * L[i] + R[i] * R[i]) - loudPow_);
      const float lo = loudLow_.at(i), hi = loudHigh_.at(i);
      float* ch[2] = {L, R};
      for (int c = 0; c < 2; ++c) {
        const float x = ch[c][i];
        ch[c][i] = x + lo * loudLp_[c].lp(x, loudLowCoef_) + hi * (x - loudHp_[c].lp(x, loudHighCoef_));
      }
    }
  } else {
    loudPow_ = 0;
    for (int c = 0; c < 2; ++c) {
      loudLp_[c].reset();
      loudHp_[c].reset();
    }
  }

  output_.to(dbToGain(outDb_), n, snap);
  if (!output_.unity())
    for (int i = 0; i < n; ++i) {
      const float g = output_.at(i);
      L[i] *= g;
      R[i] *= g;
    }
}

void Limiter::prepare(float fs) {
  look_ = int(0.0015f * fs);
  if (look_ < 2) look_ = 2;
  int size = 4;
  while (size < look_ + 2) size <<= 1;
  mask_ = size - 1;
  delayL_.assign(size_t(size), 0.f);
  delayR_.assign(size_t(size), 0.f);
  minVal_.assign(size_t(size), 1.f);
  minIdx_.assign(size_t(size), 0u);
  box_.assign(size_t(look_), 1.f);
  release_ = 1.f - std::exp(-1.f / (0.08f * fs));
  reset();
}

void Limiter::reset() {
  for (float& v : delayL_) v = 0.f;
  for (float& v : delayR_) v = 0.f;
  for (float& v : box_) v = 1.f;
  boxSum_ = double(look_);
  boxPos_ = 0;
  head_ = tail_ = 0;
  n_ = 0;
  env_ = 1.f;
  grDb_ = 0.f;
}

void Limiter::process(float* L, float* R, int n, bool enabled) {
  float minGain = 1.f;
  const uint32_t look = uint32_t(look_);
  const uint32_t mask = uint32_t(mask_);
  float blockPeak = 0;
  for (int i = 0; i < n; ++i) blockPeak = std::fmax(blockPeak, std::fmax(std::fabs(L[i]), std::fabs(R[i])));
  if (boxSum_ == double(look_) && (!enabled || blockPeak <= kCeiling)) {
    // Fully released (every gain in the window is exactly 1) and nothing to
    // catch: the output is just the delayed input. The window minimum is 1,
    // so the queue collapses to the newest sample.
    for (int i = 0; i < n; ++i) {
      delayL_[n_ & mask] = L[i];
      delayR_[n_ & mask] = R[i];
      const uint32_t r = (n_ - (look - 1u)) & mask;
      L[i] = delayL_[r];
      R[i] = delayR_[r];
      ++n_;
    }
    minVal_[0] = 1.f;
    minIdx_[0] = n_ - 1u;
    head_ = 0;
    tail_ = 1;
    env_ = 1.f;
    grDb_ = 0.f;
    return;
  }
  for (int i = 0; i < n; ++i) {
    const float peak = std::fmax(std::fabs(L[i]), std::fabs(R[i]));
    const float req = enabled && peak > kCeiling ? kCeiling / peak : 1.f;
    // Monotonic queue: running minimum of req over the last `look` samples.
    while (tail_ != head_ && minVal_[(tail_ - 1) & uint32_t(mask_)] >= req) --tail_;
    minVal_[tail_ & uint32_t(mask_)] = req;
    minIdx_[tail_ & uint32_t(mask_)] = n_;
    ++tail_;
    while (n_ - minIdx_[head_ & uint32_t(mask_)] >= look) ++head_;
    const float held = minVal_[head_ & uint32_t(mask_)];
    env_ = held < env_ ? held : env_ + release_ * (held - env_);
    boxSum_ += double(env_) - double(box_[size_t(boxPos_)]);
    box_[size_t(boxPos_)] = env_;
    if (++boxPos_ == look_) boxPos_ = 0;
    const float g = float(boxSum_ / double(look_));

    delayL_[n_ & uint32_t(mask_)] = L[i];
    delayR_[n_ & uint32_t(mask_)] = R[i];
    const uint32_t r = (n_ - (look - 1u)) & uint32_t(mask_);
    float l = delayL_[r] * g, rr = delayR_[r] * g;
    if (enabled) {  // the box average can round a hair above the minimum
      l = clampf(l, -kCeiling, kCeiling);
      rr = clampf(rr, -kCeiling, kCeiling);
    }
    L[i] = l;
    R[i] = rr;
    if (g < minGain) minGain = g;
    ++n_;
  }
  grDb_ = -gainToDb(minGain);
}

}  // namespace sa
