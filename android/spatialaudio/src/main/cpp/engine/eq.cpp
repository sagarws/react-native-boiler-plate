#include "eq.h"

namespace sa {
namespace {

constexpr float kBandHz[kEqBands] = {31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000};
constexpr float kBandQ = 1.4f;
enum { kBassF = kEqBands, kTrebleF, kPresenceF, kLowMidF };

}  // namespace

void Equalizer::prepare(float fs) {
  fs_ = fs;
  for (int i = 0; i < kEqBands; ++i) {
    bands_[i].f0 = kBandHz[i];
    bands_[i].q = kBandQ;
  }
  bands_[kBassF].kind = kLowShelf;
  bands_[kBassF].f0 = 100;
  bands_[kTrebleF].kind = kHighShelf;
  bands_[kTrebleF].f0 = 8000;
  bands_[kPresenceF].f0 = 3200;  // centre of the 2.5-4 kHz presence region
  bands_[kPresenceF].q = 0.8f;
  bands_[kLowMidF].f0 = 350;
  bands_[kLowMidF].q = 1.0f;
  // Harmonic bass: isolate the lows, rectify (octave-up harmonics), keep 90-400 Hz.
  hLow_ = designLowPass(fs, 120, 0.707f);
  hHigh_ = designHighPass(fs, 90, 0.707f);
  hTop_ = designLowPass(fs, 400, 0.707f);
}

void Equalizer::reset(const float* p) {
  for (Band& b : bands_) {
    b.s[0].reset();
    b.s[1].reset();
    b.active = false;
    b.cur = 0;
  }
  hLowS_.reset();
  hHighS_.reset();
  hTopS_.reset();
  preampDb_ = p[kEqEnabled] > 0.5f ? p[kPreamp] : 0.f;
  harmonic_ = 0;
  fresh_ = true;
}

void Equalizer::update(Band& b, float targetDb, float k) {
  b.cur += k * (targetDb - b.cur);
  if (std::fabs(targetDb - b.cur) < 0.005f) b.cur = targetDb;
  if (b.cur == 0.f) {
    // Settled flat (an exact identity): skip it; a later boost starts clean.
    if (b.active) {
      b.active = false;
      b.s[0].reset();
      b.s[1].reset();
    }
    return;
  }
  if (b.active && std::fabs(b.cur - b.designed) < 0.002f) return;
  b.active = true;
  b.designed = b.cur;
  switch (b.kind) {
    case kPeak: b.c = designPeaking(fs_, b.f0, b.q, b.cur); break;
    case kLowShelf: b.c = designLowShelf(fs_, b.f0, b.cur); break;
    case kHighShelf: b.c = designHighShelf(fs_, b.f0, b.cur); break;
  }
}

void Equalizer::process(float* L, float* R, int n, const float* p) {
  const bool snap = fresh_;
  fresh_ = false;
  const float k = snap ? 1.f : blockCoef(0.05f, n, fs_);
  const float on = p[kEqEnabled] > 0.5f ? 1.f : 0.f;
  for (int i = 0; i < kEqBands; ++i) update(bands_[i], on * p[kEq0 + i], k);
  update(bands_[kBassF], on * p[kBass], k);
  update(bands_[kTrebleF], on * p[kTreble], k);
  update(bands_[kPresenceF], on * 6.f * p[kVocal], k);
  update(bands_[kLowMidF], on * -3.f * p[kVocal], k);

  preampDb_ += k * (on * p[kPreamp] - preampDb_);
  preamp_.to(dbToGain(preampDb_), n, snap);
  if (!preamp_.unity())
    for (int i = 0; i < n; ++i) {
      const float g = preamp_.at(i);
      L[i] *= g;
      R[i] *= g;
    }

  for (Band& b : bands_) {
    if (!b.active) continue;
    for (int i = 0; i < n; ++i) {
      L[i] = b.s[0].process(b.c, L[i]);
      R[i] = b.s[1].process(b.c, R[i]);
    }
  }

  harmonic_ += k * (on * 0.35f * p[kBass] / 12.f - harmonic_);
  if (harmonic_ < 1e-5f && on * p[kBass] == 0.f) harmonic_ = 0;
  harmonicR_.to(harmonic_, n, snap);
  if (harmonicR_.idle()) return;
  for (int i = 0; i < n; ++i) {
    const float low = hLowS_.process(hLow_, 0.5f * (L[i] + R[i]));
    const float h = hTopS_.process(hTop_, hHighS_.process(hHigh_, std::fabs(low)));
    const float add = harmonicR_.at(i) * h;
    L[i] += add;
    R[i] += add;
  }
}

}  // namespace sa
