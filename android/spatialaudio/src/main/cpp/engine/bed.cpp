#include "bed.h"

namespace sa {
namespace {

struct SpeakerSpec {
  float az, el;
  int side;  // 0 fed by input L, 1 by input R
  float delayMs, apMs, apGain;
};

// FL FR SL SR RL RR UL UR — the order of SPEAKER_0..7.
constexpr SpeakerSpec kSpecs[kSpeakers] = {
    {-30, 0, 0, 0, 0, 0},           {30, 0, 1, 0, 0, 0},
    {-90, 0, 0, 0, 0, 0},           {90, 0, 1, 0, 0, 0},
    {-150, 0, 0, 7.1f, 4.3f, 0.5f}, {150, 0, 1, 8.3f, 5.1f, 0.5f},
    {-45, 45, 0, 2.3f, 3.1f, 0.4f}, {45, 45, 1, 2.9f, 3.7f, 0.4f},
};

}  // namespace

float SpeakerBed::Decorrelator::process(float x) {
  if (delay == 0) return x;
  pre.write(x);
  // Schroeder allpass: w[n] = v[n] + g w[n-D], y[n] = -g w[n] + w[n-D].
  const float wd = ap.readInt(apDelay - 1);
  const float w = pre.readInt(delay) + g * wd;
  ap.write(w);
  return -g * w + wd;
}

void SpeakerBed::prepare(float fs) {
  shadow_.prepare(fs);
  rearCoef_ = onePoleCoef(3500.f, fs);
  const Cues unit;
  for (int s = 0; s < kSpeakers; ++s) {
    Speaker& sp = sp_[s];
    const Dir d = dirFromAngles(kSpecs[s].az, kSpecs[s].el);
    EarParams ear[2];
    computeEar(d, -1, fs, unit, ear[0]);
    computeEar(d, 1, fs, unit, ear[1]);
    for (int k = 0; k < kEchoes; ++k) {
      const float dl = k < kPinnaEchoes ? ear[0].pinnaDelay[k] : ear[0].shoulderDelay;
      sp.echoInt[k] = int(dl);
      sp.echoFrac[k] = dl - float(sp.echoInt[k]);
      sp.echoGain[k] = k < kPinnaEchoes ? ear[0].pinnaGain[k] : ear[0].shoulderGain;
    }
    for (int e = 0; e < 2; ++e) {
      sp.itdInt[e] = int(ear[e].delay);
      const float f = ear[e].delay - float(sp.itdInt[e]), f2 = f * f, f3 = f2 * f;
      // DelayLine::readHermite expanded into fixed weights.
      sp.itdW[e][0] = -0.5f * f + f2 - 0.5f * f3;
      sp.itdW[e][1] = 1.f - 2.5f * f2 + 1.5f * f3;
      sp.itdW[e][2] = 0.5f * f + 2.f * f2 - 1.5f * f3;
      sp.itdW[e][3] = -0.5f * f2 + 0.5f * f3;
      sp.b0[e] = shadow_.b0(ear[e].alpha);
      sp.b1[e] = shadow_.b1(ear[e].alpha);
      sp.rearCut[e] = ear[e].rearCut;
    }
    Decorrelator& dc = sp.deco;
    dc.delay = int(kSpecs[s].delayMs * 1e-3f * fs);
    dc.apDelay = int(kSpecs[s].apMs * 1e-3f * fs);
    dc.g = kSpecs[s].apGain;
    dc.pre.allocate(dc.delay + 4);
    dc.ap.allocate(dc.apDelay + 4);
    sp.in.allocate(int(0.0015f * fs) + 2 * kChunk);
    sp.itd.allocate(int(0.0015f * fs) + 2 * kChunk);
  }
  reset();
}

void SpeakerBed::reset() {
  for (Speaker& sp : sp_) {
    sp.deco.pre.clear();
    sp.deco.ap.clear();
    sp.in.clear();
    sp.itd.clear();
    sp.x1[0] = sp.x1[1] = 0;
  }
  for (int e = 0; e < 2; ++e) {
    yPlain_[e] = yRear_[e] = 0;
    rearLp_[e].reset();
  }
  primed_ = false;
}

void SpeakerBed::process(const float* bedL, const float* bedR, const Ramp* gains, const Cues& cues, float* outL, float* outR, int n) {
  if (!primed_) {
    applied_ = cues;
    primed_ = true;
  }
  const float invN = 1.f / float(n);
  // Cue strengths ramp across the block (quality / FRONT_REAR changes).
  const float pin0 = applied_.pinna, dPin = (cues.pinna - pin0) * invN;
  const float sh0 = applied_.shoulder, dSh = (cues.shoulder - sh0) * invN;
  const float rear0 = applied_.rear, dRear = (cues.rear - rear0) * invN;
  applied_ = cues;
  for (int e = 0; e < 2; ++e)
    for (int i = 0; i < n; ++i) plain_[e][i] = rear_[e][i] = 0.f;

  for (int s = 0; s < kSpeakers; ++s) {
    if (gains[s].idle()) continue;
    Speaker& sp = sp_[s];
    const float* src = kSpecs[s].side == 0 ? bedL : bedR;
    // Gain first: an idle speaker's decorrelator then holds silence, not a stale signal.
    for (int i = 0; i < n; ++i) {
      u_[i] = sp.deco.process(gains[s].at(i) * src[i]);
      sp.in.write(u_[i]);
    }
    for (int i = 0; i < n; ++i) {
      const int age = n - 1 - i;  // the whole block was written first
      const float t = float(i + 1);
      const float pg = pin0 + dPin * t, sg = sh0 + dSh * t;
      float acc = u_[i];
      for (int k = 0; k < kEchoes; ++k) {
        const float x0 = sp.in.readInt(sp.echoInt[k] + age), x1 = sp.in.readInt(sp.echoInt[k] + age + 1);
        acc += sp.echoGain[k] * (k < kPinnaEchoes ? pg : sg) * (x0 + sp.echoFrac[k] * (x1 - x0));
      }
      p_[i] = acc;
    }
    for (int i = 0; i < n; ++i) sp.itd.write(p_[i]);
    for (int e = 0; e < 2; ++e) {
      const float* w = sp.itdW[e];
      const float b0 = sp.b0[e], b1 = sp.b1[e];
      float x1 = sp.x1[e];
      for (int i = 0; i < n; ++i) {
        const int at = sp.itdInt[e] + n - 1 - i;
        const float x = w[0] * sp.itd.readInt(at - 1) + w[1] * sp.itd.readInt(at) + w[2] * sp.itd.readInt(at + 1) +
                        w[3] * sp.itd.readInt(at + 2);
        // Shadow zero only; the shared pole is applied to the sum below.
        const float v = b0 * x + b1 * x1;
        x1 = x;
        const float cut = sp.rearCut[e] * (rear0 + dRear * float(i + 1));
        plain_[e][i] += v - cut * v;
        rear_[e][i] += cut * v;
      }
      sp.x1[e] = x1;
    }
  }

  // Shared shadow pole, then the rear shelf (1 - cut) y + cut * lowpass(y) on the summed speakers.
  for (int e = 0; e < 2; ++e) {
    float* out = e == 0 ? outL : outR;
    for (int i = 0; i < n; ++i) {
      yPlain_[e] = plain_[e][i] - shadow_.a1 * yPlain_[e];
      yRear_[e] = rear_[e][i] - shadow_.a1 * yRear_[e];
      out[i] += yPlain_[e] + rearLp_[e].lp(yRear_[e], rearCoef_);
    }
  }
}

}  // namespace sa
