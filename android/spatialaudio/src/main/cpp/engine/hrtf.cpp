#include "hrtf.h"

namespace sa {
namespace {

// Brown & Duda 1998 constants.
constexpr float kHeadRadius = 0.0875f;  // m
constexpr float kAlphaMin = 0.1f;
constexpr float kThetaMin = 150.f * kPi / 180.f;
constexpr float kHeadDelay = kHeadRadius / kSpeedOfSound;  // a/c, s
// Head-shadow pole/zero frequency 2*w0 with w0 = c/a (rad/s).
constexpr float kShadowBeta = 2.f * kSpeedOfSound / kHeadRadius;

// Pinna echoes, paper Table I: rho, A, B (samples at 44.1 kHz), D.
constexpr float kPinnaRho[kPinnaEchoes] = {0.5f, -1.f, 0.5f, -0.25f, 0.25f};
constexpr float kPinnaA[kPinnaEchoes] = {1.f, 5.f, 5.f, 5.f, 5.f};
constexpr float kPinnaB[kPinnaEchoes] = {2.f, 4.f, 7.f, 11.f, 13.f};
constexpr float kPinnaD[kPinnaEchoes] = {1.f, 0.5f, 0.5f, 0.5f, 0.5f};

bool hasPinna(const EarParams& p) {
  for (float g : p.pinnaGain)
    if (g != 0.f) return true;
  return false;
}

}  // namespace

Dir dirFromAngles(float azDeg, float elDeg) {
  const float az = azDeg * kPi / 180.f, el = elDeg * kPi / 180.f;
  const float ce = std::cos(el);
  return {ce * std::cos(az), ce * std::sin(az), std::sin(el)};
}

Dir rotateAzimuth(const Dir& d, float deg) {
  const float r = deg * kPi / 180.f;
  const float c = std::cos(r), s = std::sin(r);
  return {d.x * c - d.y * s, d.x * s + d.y * c, d.z};
}

float azimuthDeg(const Dir& d) { return std::atan2(d.y, d.x) * 180.f / kPi; }
float elevationDeg(const Dir& d) { return std::asin(clampf(d.z, -1.f, 1.f)) * 180.f / kPi; }

void computeEar(const Dir& d, int ear, float fs, const Cues& cues, EarParams& out) {
  // Angle of incidence between the source and this ear's axis.
  const float cosT = clampf(d.y * float(ear), -1.f, 1.f);
  const float theta = std::acos(cosT);
  out.alpha = (1.f + 0.5f * kAlphaMin) + (1.f - 0.5f * kAlphaMin) * std::cos(theta / kThetaMin * kPi);

  // Woodworth-style per-ear delay (paper eq. 3), offset by a/c to stay causal.
  const float t = theta < 0.5f * kPi ? -kHeadDelay * cosT : kHeadDelay * (theta - 0.5f * kPi);
  out.delay = (t + kHeadDelay) * fs + 1.f;
  out.gain = clampf(1.f + cues.ildBoost * cosT, 0.3f, 2.f);
  // The head barely shadows lows, so the model alone gives almost no bass
  // ILD; a sinusoidal-in-azimuth term split +-half per ear makes movement
  // audible on bass-heavy music.
  out.lowGain = dbToGain(0.5f * cues.lowIldDb * cosT);

  // Pinna and shoulder use interaural-polar angles: lateral angle in
  // [-90, 90] and polar angle (0 front, 90 up, 180 behind) in [-90, 270).
  const float lateral = std::asin(clampf(d.y, -1.f, 1.f));
  float polar = std::atan2(d.z, d.x);
  if (polar < -0.5f * kPi) polar += kTwoPi;
  const float scale = fs / 44100.f;
  for (int k = 0; k < kPinnaEchoes; ++k) {
    const float tau = kPinnaA[k] * std::cos(0.5f * lateral) * std::sin(kPinnaD[k] * (0.5f * kPi - polar)) + kPinnaB[k];
    out.pinnaDelay[k] = (tau > 0.5f ? tau : 0.5f) * scale;
    out.pinnaGain[k] = kPinnaRho[k] * cues.pinna;
  }

  // Shoulder reflection, simplified from Algazi et al. 2001 (frontal case):
  // T = 1.2 ms * (1 - 0.00004 (phi - 80)^2), strongest for raised sources.
  const float elDeg = std::asin(clampf(d.z, -1.f, 1.f)) * 180.f / kPi;
  const float tsh = 1.2e-3f * (1.f - 0.00004f * (elDeg - 80.f) * (elDeg - 80.f));
  out.shoulderDelay = (tsh > 0.3e-3f ? tsh : 0.3e-3f) * fs;
  out.shoulderGain = 0.3f * clampf((elDeg + 20.f) / 90.f, 0.f, 1.f) * cues.shoulder;

  out.rearCut = 0.6f * clampf(-d.x, 0.f, 1.f) * cues.rear;
}

void BinauralVoice::prepare(float fs) {
  line_.allocate(int(0.004f * fs) + 2 * kChunk);
  k_ = 2.f * fs;  // bilinear transform
  beta_ = kShadowBeta;
  inv_ = 1.f / (k_ + beta_);
  a1_ = (beta_ - k_) * inv_;
  rearCoef_ = onePoleCoef(3500.f, fs);
  lowCoef_ = onePoleCoef(1200.f, fs);
  reset();
}

void BinauralVoice::reset() {
  line_.clear();
  for (Ear& e : ears_) {
    e.x1 = e.y1 = 0;
    e.rear.reset();
    e.low.reset();
  }
  primed_ = false;
}

void BinauralVoice::setTarget(const EarParams& left, const EarParams& right) {
  ears_[0].tgt = left;
  ears_[1].tgt = right;
  if (!primed_) {
    ears_[0].cur = left;
    ears_[1].cur = right;
    primed_ = true;
  }
}

void BinauralVoice::process(const float* in, float* outL, float* outR, int n) {
  for (int i = 0; i < n; ++i) line_.write(in[i]);
  const float invN = 1.f / float(n);
  for (int e = 0; e < 2; ++e) {
    Ear& ear = ears_[e];
    const EarParams& a = ear.cur;
    const EarParams& b = ear.tgt;
    float* out = e == 0 ? outL : outR;
    const bool pinna = hasPinna(a) || hasPinna(b);
    const bool shoulder = a.shoulderGain != 0.f || b.shoulderGain != 0.f;
    const bool lowIld = a.lowGain != 1.f || b.lowGain != 1.f;
    for (int i = 0; i < n; ++i) {
      const float t = float(i + 1) * invN;
      // Older samples sit further back because the whole block was written first.
      const float d = lerp(a.delay, b.delay, t) + float(n - 1 - i);
      float x = line_.readHermite(d);
      if (pinna) {
        for (int k = 0; k < kPinnaEchoes; ++k)
          x += lerp(a.pinnaGain[k], b.pinnaGain[k], t) * line_.readLinear(d + lerp(a.pinnaDelay[k], b.pinnaDelay[k], t));
      }
      if (shoulder) x += lerp(a.shoulderGain, b.shoulderGain, t) * line_.readLinear(d + lerp(a.shoulderDelay, b.shoulderDelay, t));

      // Head shadow (alpha s + beta) / (s + beta), bilinear; alpha only enters the zero.
      const float alpha = lerp(a.alpha, b.alpha, t);
      const float y = (alpha * k_ + beta_) * inv_ * x + (beta_ - alpha * k_) * inv_ * ear.x1 - a1_ * ear.y1;
      ear.x1 = x;
      ear.y1 = y;
      const float lp = ear.rear.lp(y, rearCoef_);
      float z = y - lerp(a.rearCut, b.rearCut, t) * (y - lp);
      if (lowIld) z += (lerp(a.lowGain, b.lowGain, t) - 1.f) * ear.low.lp(z, lowCoef_);
      out[i] += lerp(a.gain, b.gain, t) * z;
    }
    ear.cur = ear.tgt;
  }
}

}  // namespace sa
